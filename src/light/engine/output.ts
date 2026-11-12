import type { OutputSettings, UniformMap } from '../scene'
import { activeFilters, OUTPUT_FILTERS, type FilterFrame, type FilterSource, type OutputFilter } from './filters'
import type { Gpu, Target } from './gl'
import { CHUNK_LIBRARY, GLSL_HEADER } from './glsl'
import { GRAIN_FILTER } from './grain'
import { AREA_RESAMPLE_SHADER } from './passes'

/**
 * Tone curve. Colors whose largest channel m is <= 1 pass through unchanged,
 * so a pack color at nominal intensity encodes to its exact hex. Above 1 the
 * largest channel stays at 1 and every other channel closes its gap to 1 the
 * way a camera's channels fill up: at a rate set by its own light plus some
 * crosstalk from the other channels (TONE_CROSSTALK[i][j]: how much of
 * channel j's light channel i sees). So the brighter of the two lower
 * channels fills first: orange-red goes orange, yellow, pale yellow, white.
 * Cyans, blues and violets (TONE_HOLD_HUES) then take back their own OKLab
 * hue at the curve's lightness and chroma, with the chroma lowered where the
 * color would leave sRGB, and go back to the curve's luminance: Meta Blue
 * stays a saturated blue until it whitens and Cyan never turns green. Reds,
 * oranges and yellows (TONE_WARM_HUES) whiten through yellow the same way but
 * stop just past Yellow's hue (TONE_WARM_LIMIT): bright Yellow turns a paler
 * golden yellow, not lemon.
 *
 * For r = c / m and x = m - 1: out_i = 1 - (1 - r_i) exp(-k x w_i - late x^2)
 * with w_i = f_i / (1 - r_i + 0.05) and f_i = r_i + sum_j X_ij r_j. One
 * overall rate k = lum(r) / sum_i lum_i (1 - r_i) w_i keeps linear luminance
 * continuous in value and slope at m = 1; the late term has zero slope there
 * and only closes the slowest channel far above it, so every color ends at
 * white.
 *
 * Near a tie for the largest channel the second channel's share of that sum
 * falls to 0, so k would shoot up and whiten the third channel in a thin
 * ridge where the two cross. Within TONE_TIE_BAND of the largest, each lower
 * channel's share blends (smoothstep in its gap) toward the mean of the two
 * channels' shares at the band edge, which both sides of the tie give alike.
 * There the luminance slope at m = 1 is no longer exact; farther from a tie
 * nothing changes.
 *
 * Paper toe (output.toe, off at 0): below nominal the weaker channels fall
 * faster than the largest, out = m (c / m)^p with p = 1 + toe n^2 / (n^2 + 4)
 * at n stops below nominal, so dim light gets purer while the largest
 * channel, and so the falloff, stays as it was. resolveScene pre-inverts slot
 * colors (paperToeInverse), so flat pack colors keep their hex.
 */
export const TONE_CROSSTALK = [
  [0, 0.8, 0.16],
  [0.15, 0, 0.3],
  [0.02, 0.15, 0],
] as const
const TONE_GAP_SOFTNESS = 0.05
const TONE_LATE_WHITENING = 0.005
export const TONE_TIE_BAND = 0.05
const TONE_TIE_SHARE = TONE_TIE_BAND / (TONE_TIE_BAND + TONE_GAP_SOFTNESS)
/** Stops below nominal where the paper toe reaches half its strength. */
const TOE_HALF_STOPS = 2
/**
 * OKLCh hues (degrees) where bright light keeps its own hue as it whitens: none below 160, all from 190 (cyan)
 * through Meta Blue to 300 (violet), none again from 330. Where Meta Blue brightens it stays a saturated blue, not a
 * pale blue that passes for Cyan (owner, 2026-11-09), and Cyan never turns green; yellows, reds and pinks keep the
 * curve's path.
 */
export const TONE_HOLD_HUES = [160, 190, 300, 330] as const
/**
 * Own OKLCh hues (degrees, -180 to 180) of warm light whose whitening stops at TONE_WARM_LIMIT: from red (fading in
 * over -40 to -25) through Yellow (fading out over 100 to 112). Past Yellow's hue the curve heads for sRGB's yellow
 * corner (about 110 degrees), so bright Yellow read as lemon, a hue no pack has (2026-11-10).
 */
export const TONE_WARM_HUES = [-40, -25, 100, 112] as const
/**
 * The hue (degrees) warm light whitens at most to, or the light's own hue if that is farther: 6 degrees past Yellow's
 * 94, where sRGB still leaves bright Yellow some chroma (0.10 at 1.5x, against 0.08 held at 96 and 0.17 as lemon).
 */
export const TONE_WARM_LIMIT = 100
/**
 * Halvings of the chroma search (6 leave it within 1/64 of the curve's chroma, under 0.004), and how far past 0 or 1 a
 * channel may be and still count as inside sRGB. Each pixel above the knee in a held band pays for them, so the 12
 * there were before (2026-11-10) made bright frames up to three times slower to draw.
 */
const TONE_GAMUT_STEPS = 6
/**
 * A hold that would turn the curve's hue by less than this (radians, 0.3 degrees) is left out, and it fades in to
 * four times that, so the pixel keeps o where the hold would change it least and nothing jumps.
 */
const TONE_HOLD_SKIP = 0.005
const TONE_GAMUT_SLACK = 1e-4

const glslFloat = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v))
const crosstalkColumns = [0, 1, 2].map((j) => `vec3(${[0, 1, 2].map((i) => glslFloat(TONE_CROSSTALK[i][j])).join(', ')})`).join(', ')

export const TONE_CURVE_GLSL = /* glsl */ `
const mat3 TONE_CROSSTALK = mat3(${crosstalkColumns});
uniform float uToe;

vec3 paperToe(vec3 c, float m) {
  if (uToe <= 0.0 || m <= 0.0) return c;
  float n = -log2(m);
  return m * pow(c / m, vec3(1.0 + uToe * n * n / (n * n + ${glslFloat(TOE_HALF_STOPS * TOE_HALF_STOPS)})));
}

vec3 toneOklab(vec3 c) {
  vec3 lms = pow(max(vec3(dot(c, vec3(0.4122214708, 0.5363325363, 0.0514459929)), dot(c, vec3(0.2119034982, 0.6806995451, 0.1073969566)), dot(c, vec3(0.0883024619, 0.2817188376, 0.6299787005))), 0.0), vec3(1.0 / 3.0));
  return vec3(dot(lms, vec3(0.2104542553, 0.793617785, -0.0040720468)), dot(lms, vec3(1.9779984951, -2.428592205, 0.4505937099)), dot(lms, vec3(0.0259040371, 0.7827717662, -0.808675766)));
}

vec3 toneFromOklab(vec3 lab) {
  vec3 lms = vec3(dot(lab, vec3(1.0, 0.3963377774, 0.2158037573)), dot(lab, vec3(1.0, -0.1055613458, -0.0638541728)), dot(lab, vec3(1.0, -0.0894841775, -1.291485548)));
  lms = lms * lms * lms;
  return vec3(dot(lms, vec3(4.0767416621, -3.3077115913, 0.2309699292)), dot(lms, vec3(-1.2684380046, 2.6097574011, -0.3413193965)), dot(lms, vec3(-0.0041960863, -0.7034186147, 1.707614701)));
}

// How far a color is past sRGB's edge: above 0 outside, at most 0 inside.
float toneOver(vec3 c) {
  return max(max(c.r, max(c.g, c.b)) - 1.0, -min(c.r, min(c.g, c.b)));
}

bool toneInside(vec3 c) {
  return all(greaterThanEqual(c, vec3(-${glslFloat(TONE_GAMUT_SLACK)}))) && all(lessThanEqual(c, vec3(1.0 + ${glslFloat(TONE_GAMUT_SLACK)})));
}

// Bright light in the TONE_HOLD_HUES band keeps its own OKLab hue (r's) at the curve's lightness and chroma (o's);
// warm light in the TONE_WARM_HUES band turns no farther than TONE_WARM_LIMIT. The chroma is lowered where that color
// would leave sRGB, then it goes back to the curve's luminance: scaled, which keeps the hue, and mixed toward the grey
// of that luminance where a channel would pass 1 (toneHoldHue in output.ts).
vec3 toneHoldHue(vec3 r, vec3 o) {
  vec3 own = toneOklab(r);
  if (length(own.yz) < 1e-6) return o;
  float hue = atan(own.z, own.y);
  float deg = mod(degrees(hue), 360.0);
  float hold = smoothstep(${glslFloat(TONE_HOLD_HUES[0])}, ${glslFloat(TONE_HOLD_HUES[1])}, deg) * (1.0 - smoothstep(${glslFloat(TONE_HOLD_HUES[2])}, ${glslFloat(TONE_HOLD_HUES[3])}, deg));
  float signedDeg = deg > 180.0 ? deg - 360.0 : deg;
  float warm = smoothstep(${glslFloat(TONE_WARM_HUES[0])}, ${glslFloat(TONE_WARM_HUES[1])}, signedDeg) * (1.0 - smoothstep(${glslFloat(TONE_WARM_HUES[2])}, ${glslFloat(TONE_WARM_HUES[3])}, signedDeg));
  if (hold <= 0.0 && warm <= 0.0) return o;
  vec3 lab = toneOklab(o);
  float chroma = length(lab.yz);
  if (chroma < 1e-6) return o;
  float curveHue = atan(lab.z, lab.y);
  float h;
  float turned = 1.0;
  if (hold > 0.0) {
    float d = mod(curveHue - hue + ${glslFloat(3 * Math.PI)}, ${glslFloat(2 * Math.PI)}) - ${glslFloat(Math.PI)};
    turned = abs(hold * d);
    if (turned < ${glslFloat(TONE_HOLD_SKIP)}) return o;
    h = hue + (1.0 - hold) * d;
  } else {
    float past = degrees(curveHue) - max(${glslFloat(TONE_WARM_LIMIT)}, signedDeg);
    if (past <= 0.0) return o;
    h = curveHue - warm * radians(past);
  }
  vec2 dir = vec2(cos(h), sin(h));
  vec3 held = toneFromOklab(vec3(lab.x, chroma * dir));
  if (!toneInside(held)) {
    float lo = 0.0;
    float hi = chroma;
    for (int i = 0; i < ${TONE_GAMUT_STEPS}; i++) {
      float mid = 0.5 * (lo + hi);
      if (toneInside(toneFromOklab(vec3(lab.x, mid * dir)))) lo = mid;
      else hi = mid;
    }
    // Between the last chroma inside and the first outside, where the edge crosses (so the result moves smoothly).
    float overLo = toneOver(toneFromOklab(vec3(lab.x, lo * dir)));
    float overHi = toneOver(toneFromOklab(vec3(lab.x, hi * dir)));
    held = toneFromOklab(vec3(lab.x, (lo + (hi - lo) * clamp(-overLo / max(overHi - overLo, 1e-9), 0.0, 1.0)) * dir));
  }
  held = max(held, vec3(0.0));
  float target = luminance(o);
  held *= target / max(luminance(held), 1e-9);
  float top = maxComponent(held);
  if (top > 1.0) held = target + (held - target) * (1.0 - target) / (top - target);
  return mix(o, saturate(held), smoothstep(${glslFloat(TONE_HOLD_SKIP)}, ${glslFloat(4 * TONE_HOLD_SKIP)}, turned));
}

vec3 toneCurve(vec3 c) {
  c = max(c, vec3(0.0));
  float m = maxComponent(c);
  if (m <= 1.0) return paperToe(c, m);
  vec3 r = c / m;
  vec3 gap = 1.0 - r;
  vec3 fill = r + TONE_CROSSTALK * r;
  vec3 w = fill / (gap + ${glslFloat(TONE_GAP_SOFTNESS)});
  // The largest channel is the one with the smallest gap; its own blended share is taken back out of the sum.
  float topFill = gap.x <= gap.y && gap.x <= gap.z ? LUMA.x * fill.x : (gap.y <= gap.z ? LUMA.y * fill.y : LUMA.z * fill.z);
  vec3 near = 1.0 - smoothstep(0.0, ${glslFloat(TONE_TIE_BAND)}, gap);
  vec3 pair = 0.5 * (LUMA * fill + topFill) * ${glslFloat(TONE_TIE_SHARE)};
  float slope = dot((1.0 - near) * LUMA * gap * w + near * pair, vec3(1.0)) - topFill * ${glslFloat(TONE_TIE_SHARE)};
  float k = luminance(r) / max(slope, 1e-6);
  float x = m - 1.0;
  return toneHoldHue(r, saturate(1.0 - gap * exp(-k * x * w - ${glslFloat(TONE_LATE_WHITENING)} * x * x)));
}
`

const LUMA = [0.2126, 0.7152, 0.0722] as const

const smoothstep = (edge: number, x: number) => {
  const t = Math.min(1, Math.max(0, x / edge))
  return t * t * (3 - 2 * t)
}

const toePower = (m: number, toe: number) => {
  const n = -Math.log2(m)
  return 1 + (toe * n * n) / (n * n + TOE_HALF_STOPS * TOE_HALF_STOPS)
}

/** The light color the paper toe prints as `c`: the same largest channel, the others raised by 1 / p. */
export function paperToeInverse(c: readonly number[], toe: number): [number, number, number] {
  const m = Math.max(c[0], c[1], c[2])
  if (toe <= 0 || m <= 0 || m >= 1) return [c[0], c[1], c[2]]
  const q = 1 / toePower(m, toe)
  return [m * (c[0] / m) ** q, m * (c[1] / m) ** q, m * (c[2] / m) ** q]
}

/** CPU twin of the GLSL tone curve, for tests and checks; `toe` is output.toe. */
export function toneCurve(rgb: readonly number[], toe = 0): [number, number, number] {
  const c = [Math.max(0, rgb[0]), Math.max(0, rgb[1]), Math.max(0, rgb[2])]
  const m = Math.max(c[0], c[1], c[2])
  if (m <= 1) {
    if (toe <= 0 || m <= 0) return [c[0], c[1], c[2]]
    const p = toePower(m, toe)
    return [m * (c[0] / m) ** p, m * (c[1] / m) ** p, m * (c[2] / m) ** p]
  }
  const r = c.map((v) => v / m)
  const gap = r.map((v) => 1 - v)
  const fill = r.map((v, i) => v + TONE_CROSSTALK[i][0] * r[0] + TONE_CROSSTALK[i][1] * r[1] + TONE_CROSSTALK[i][2] * r[2])
  const w = fill.map((f, i) => f / (gap[i] + TONE_GAP_SOFTNESS))
  let top = 0
  for (let i = 1; i < 3; i++) if (gap[i] < gap[top]) top = i
  let slope = 0
  for (let i = 0; i < 3; i++) {
    if (i === top) continue
    const near = 1 - smoothstep(TONE_TIE_BAND, gap[i])
    const pair = 0.5 * (LUMA[i] * fill[i] + LUMA[top] * fill[top]) * TONE_TIE_SHARE
    slope += (1 - near) * LUMA[i] * gap[i] * w[i] + near * pair
  }
  const k = (LUMA[0] * r[0] + LUMA[1] * r[1] + LUMA[2] * r[2]) / Math.max(slope, 1e-6)
  const x = m - 1
  const out = gap.map((g, i) => Math.min(1, Math.max(0, 1 - g * Math.exp(-k * x * w[i] - TONE_LATE_WHITENING * x * x))))
  return toneHoldHue(r, out)
}

const toneLuminance = (c: readonly number[]) => LUMA[0] * c[0] + LUMA[1] * c[1] + LUMA[2] * c[2]

function toneOklab(c: readonly number[]): [number, number, number] {
  const cbrt = (v: number) => Math.max(v, 0) ** (1 / 3)
  const l = cbrt(0.4122214708 * c[0] + 0.5363325363 * c[1] + 0.0514459929 * c[2])
  const m = cbrt(0.2119034982 * c[0] + 0.6806995451 * c[1] + 0.1073969566 * c[2])
  const s = cbrt(0.0883024619 * c[0] + 0.2817188376 * c[1] + 0.6299787005 * c[2])
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}

function toneFromOklab(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
}

const toneInside = (c: readonly number[]) => c.every((v) => v >= -TONE_GAMUT_SLACK && v <= 1 + TONE_GAMUT_SLACK)
const toneOver = (c: readonly number[]) => Math.max(Math.max(c[0], c[1], c[2]) - 1, -Math.min(c[0], c[1], c[2]))

const smoothBetween = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * CPU twin of the GLSL toneHoldHue: the curve's result `o` for the light's own color `r` (largest channel 1). In the
 * TONE_HOLD_HUES band it takes r's OKLab hue at o's lightness and chroma; in the TONE_WARM_HUES band it turns o's hue
 * back to TONE_WARM_LIMIT (or r's own hue, if farther) where o has gone past it. Then it lowers the chroma where that
 * would leave sRGB and goes back to o's luminance; elsewhere it returns o.
 */
export function toneHoldHue(r: readonly number[], o: readonly number[]): [number, number, number] {
  const own = toneOklab(r)
  if (Math.hypot(own[1], own[2]) < 1e-6) return [o[0], o[1], o[2]]
  const hue = Math.atan2(own[2], own[1])
  const degrees = (hue * 180) / Math.PI
  const deg = degrees - 360 * Math.floor(degrees / 360)
  const hold = smoothBetween(TONE_HOLD_HUES[0], TONE_HOLD_HUES[1], deg) * (1 - smoothBetween(TONE_HOLD_HUES[2], TONE_HOLD_HUES[3], deg))
  const signedDeg = deg > 180 ? deg - 360 : deg
  const warm = smoothBetween(TONE_WARM_HUES[0], TONE_WARM_HUES[1], signedDeg) * (1 - smoothBetween(TONE_WARM_HUES[2], TONE_WARM_HUES[3], signedDeg))
  if (hold <= 0 && warm <= 0) return [o[0], o[1], o[2]]
  const lab = toneOklab(o)
  const chroma = Math.hypot(lab[1], lab[2])
  if (chroma < 1e-6) return [o[0], o[1], o[2]]
  const curveHue = Math.atan2(lab[2], lab[1])
  let h: number
  let turned = 1
  if (hold > 0) {
    const turn = curveHue - hue + 3 * Math.PI
    const d = turn - 2 * Math.PI * Math.floor(turn / (2 * Math.PI)) - Math.PI
    turned = Math.abs(hold * d)
    if (turned < TONE_HOLD_SKIP) return [o[0], o[1], o[2]]
    h = hue + (1 - hold) * d
  } else {
    const past = (curveHue * 180) / Math.PI - Math.max(TONE_WARM_LIMIT, signedDeg)
    if (past <= 0) return [o[0], o[1], o[2]]
    h = curveHue - (warm * past * Math.PI) / 180
  }
  const at = (C: number) => toneFromOklab(lab[0], C * Math.cos(h), C * Math.sin(h))
  let held = at(chroma)
  if (!toneInside(held)) {
    let lo = 0
    let hi = chroma
    for (let i = 0; i < TONE_GAMUT_STEPS; i++) {
      const mid = 0.5 * (lo + hi)
      if (toneInside(at(mid))) lo = mid
      else hi = mid
    }
    const overLo = toneOver(at(lo))
    const overHi = toneOver(at(hi))
    held = at(lo + (hi - lo) * Math.min(1, Math.max(0, -overLo / Math.max(overHi - overLo, 1e-9))))
  }
  held = held.map((v) => Math.max(v, 0)) as [number, number, number]
  const target = toneLuminance(o)
  const scale = target / Math.max(toneLuminance(held), 1e-9)
  held = held.map((v) => v * scale) as [number, number, number]
  const top = Math.max(held[0], held[1], held[2])
  if (top > 1) held = held.map((v) => target + ((v - target) * (1 - target)) / (top - target)) as [number, number, number]
  const fade = smoothBetween(TONE_HOLD_SKIP, 4 * TONE_HOLD_SKIP, turned)
  return [0, 1, 2].map((i) => o[i] + (Math.min(1, Math.max(0, held[i])) - o[i]) * fade) as [number, number, number]
}

/** Mitchell-Netravali (B = C = 1/3) weights, support |x| < 2. */
export const MITCHELL_GLSL = /* glsl */ `
float mitchell(float x) {
  x = abs(x);
  if (x < 1.0) return (7.0 * x * x * x - 12.0 * x * x + 16.0 / 3.0) / 6.0;
  if (x < 2.0) return (-7.0 / 3.0 * x * x * x + 12.0 * x * x - 20.0 * x + 32.0 / 3.0) / 6.0;
  return 0.0;
}
`

/**
 * Horizontal half of the supersample resolve. Reads a tile rendered at
 * uFactor times the output size with uApron extra source pixels on each side,
 * writes one column per output pixel and keeps every source row.
 */
export const RESOLVE_X_SHADER =
  GLSL_HEADER +
  MITCHELL_GLSL +
  /* glsl */ `
uniform sampler2D uSrc;
uniform int uFactor;
uniform int uApron;
out vec4 fragColor;
void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  float f = float(uFactor);
  float center = f * (float(px.x) + 0.5) + float(uApron);
  int first = int(ceil(center - 2.0 * f - 0.5));
  int last = int(floor(center + 2.0 * f - 0.5));
  vec4 sum = vec4(0.0);
  float weights = 0.0;
  for (int i = first; i <= last; i++) {
    float w = mitchell((float(i) + 0.5 - center) / f);
    sum += w * texelFetch(uSrc, ivec2(i, px.y), 0);
    weights += w;
  }
  fragColor = sum / weights;
}
`

const OUTPUT_UNIFORMS = /* glsl */ `
uniform sampler2D uSrc;
uniform ivec2 uTileOrigin;
uniform int uFactor;
uniform int uApron;
uniform int uSeed;
uniform bool uDither;
out vec4 fragColor;
`

const OUTPUT_PASS = /* glsl */ `

// Display-linear color in rgb, grain weight in alpha.
vec4 resolveColumn(ivec2 local) {
  if (uFactor == 1) return texelFetch(uSrc, local, 0);
  float f = float(uFactor);
  float center = f * (float(local.y) + 0.5) + float(uApron);
  int first = int(ceil(center - 2.0 * f - 0.5));
  int last = int(floor(center + 2.0 * f - 0.5));
  vec4 sum = vec4(0.0);
  float weights = 0.0;
  for (int j = first; j <= last; j++) {
    float w = mitchell((float(j) + 0.5 - center) / f);
    sum += w * texelFetch(uSrc, ivec2(local.x, j), 0);
    weights += w;
  }
  return sum / weights;
}

// TPDF noise of +-1 LSB; within half a code value of 0 and 255 it blends to uniform +-0.5 LSB noise, so clamping
// cannot shift the mean there and exact black and white stay exact (Gjøl, "Banding in Games").
vec3 dither(vec3 encoded, ivec2 px) {
  uvec3 a = hashKey(ivec3(px, uSeed + 9001));
  uvec3 b = pcg3d(a ^ uvec3(0x9E3779B9u, 0x85EBCA6Bu, 0xC2B2AE35u));
  vec3 u = unitFromUint(a);
  vec3 triangular = u + unitFromUint(b) - 1.0;
  vec3 v = encoded * 255.0;
  vec3 edge = min(saturate(v / 0.5), 1.0 - saturate((v - 254.5) / 0.5));
  return encoded + mix(u - 0.5, triangular, edge) / 255.0;
}

void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  vec4 resolved = resolveColumn(px - uTileOrigin);
  vec3 display = saturate(resolved.rgb);
  float weight = saturate(resolved.a);
  vec3 encoded = linearToSrgb(saturate(outputFilters(display, px, weight)));
  if (uDither) encoded = dither(saturate(encoded), px);
  fragColor = vec4(floor(saturate(encoded) * 255.0 + 0.5) / 255.0, 1.0);
}
`

const builtShaders = new Map<string, string>()

/**
 * The output pass at output size: vertical half of the resolve (when
 * supersampled), the filter stages in order, exact sRGB encode, then TPDF
 * dither of about +-1 LSB and rounding to 8 bits. Filters and dither are keyed
 * to output pixels; filter sizes follow the short side.
 */
export function buildOutputShader(stages: readonly OutputFilter[]): string {
  const key = stages.map((stage) => stage.key).join(',')
  const cached = builtShaders.get(key)
  if (cached) return cached
  const chain = stages.map((stage) => `  display = ${stage.apply}(display, px, weight);\n`).join('')
  const shader =
    GLSL_HEADER +
    CHUNK_LIBRARY +
    MITCHELL_GLSL +
    OUTPUT_UNIFORMS +
    stages.map((stage) => stage.glsl).join('\n') +
    /* glsl */ `
vec3 outputFilters(vec3 display, ivec2 px, float weight) {
${chain}  return display;
}
` +
    OUTPUT_PASS
  builtShaders.set(key, shader)
  return shader
}

/** The output pass with only the grain stage, which is off while uGrainAmp is 0. */
export const OUTPUT_SHADER = buildOutputShader([GRAIN_FILTER])

const reduceShaders = new Map<string, string>()

/** The fragment shader of a filter source's reduce pass (FilterSource.reduce). */
export function reduceShader(reduce: NonNullable<FilterSource['reduce']>): string {
  const cached = reduceShaders.get(reduce.glsl)
  if (cached) return cached
  const shader =
    GLSL_HEADER +
    CHUNK_LIBRARY +
    /* glsl */ `
uniform sampler2D uSrc;
out vec4 fragColor;
` +
    reduce.glsl +
    /* glsl */ `
void main() {
  fragColor = ${reduce.apply}(ivec2(gl_FragCoord.xy));
}
`
  reduceShaders.set(reduce.glsl, shader)
  return shader
}

/** Every output pass the tool can draw with one filter at a time (and with none), and the filters' reduce passes, for compiling ahead. */
export const OUTPUT_FILTER_SHADERS: readonly string[] = [
  buildOutputShader([]),
  ...OUTPUT_FILTERS.map((stage) => buildOutputShader([stage])),
  ...OUTPUT_FILTERS.flatMap((stage) => (stage.source?.reduce ? [reduceShader(stage.source.reduce)] : [])),
]

/** Samples per axis averaged into each texel of a filter's frame source, unless the filter sets its own (at most 8). */
const SOURCE_SAMPLES = 4
const MAX_SOURCE_SAMPLES = 8
const MAX_SOURCE_SIDE = 512

export interface OutputFilterPass {
  /** Fragment shader of the output pass with the stages that are on. */
  shader: string
  uniforms: UniformMap
  /** Frame sources, by the sampler names the stages asked for. */
  textures: Record<string, Target>
  release(): void
}

/**
 * The output pass for a scene's output settings: its shader, the uniforms of
 * the stages that are on and their frame sources. `drawFrame` draws the whole
 * frame, display-linear after the tone curve (alpha: grain weight), into a
 * target at that target's size; it runs once per frame source.
 */
export function prepareOutputFilters(gpu: Gpu, output: OutputSettings, frame: FilterFrame, drawFrame: (target: Target) => void): OutputFilterPass {
  const stages = activeFilters(output)
  const uniforms: UniformMap = {}
  const textures: Record<string, Target> = {}
  for (const stage of stages) {
    const strength = output[stage.key]
    Object.assign(uniforms, stage.uniforms(strength, frame))
    if (!stage.source) continue
    const size = stage.source.size(frame, strength)
    const width = Math.min(MAX_SOURCE_SIDE, Math.max(1, Math.round(size.width)))
    const height = Math.min(MAX_SOURCE_SIDE, Math.max(1, Math.round(size.height)))
    const wanted = typeof stage.source.samples === 'function' ? stage.source.samples(frame, strength) : stage.source.samples
    const taps = Math.min(MAX_SOURCE_SAMPLES, Math.max(1, Math.round(wanted ?? SOURCE_SAMPLES)))
    const samples = gpu.acquire(width * taps, height * taps)
    drawFrame(samples)
    const source = gpu.acquire(width, height)
    gpu.draw(gpu.program(AREA_RESAMPLE_SHADER), source, {
      textures: { uSrc: samples },
      uniforms: { uDstSize: [width, height], uTaps: taps },
    })
    gpu.release(samples)
    textures[stage.source.uniform] = source
    const reduce = stage.source.reduce
    if (reduce) {
      const cells = reduce.size(frame, strength)
      const target = gpu.acquire(Math.max(1, Math.round(cells.width)), Math.max(1, Math.round(cells.height)))
      gpu.draw(gpu.program(reduceShader(reduce)), target, { textures: { uSrc: source }, uniforms })
      textures[reduce.uniform] = target
    }
  }
  return {
    shader: buildOutputShader(stages),
    uniforms,
    textures,
    release: () => {
      for (const target of Object.values(textures)) gpu.release(target)
    },
  }
}

/** Copies the top-down output texture to the canvas (whose row 0 is the bottom). */
export const PRESENT_SHADER =
  GLSL_HEADER +
  /* glsl */ `
uniform sampler2D uSrc;
out vec4 fragColor;
void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  ivec2 size = textureSize(uSrc, 0);
  fragColor = texelFetch(uSrc, ivec2(px.x, size.y - 1 - px.y), 0);
}
`
