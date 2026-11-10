import { hexToLinear, type Rgb } from '../color/srgb'
import type { LensSettings } from '../scene'
import type { Gpu, Target } from './gl'
import { CHUNK_LIBRARY, GLSL_HEADER } from './glsl'
import { TONE_CURVE_GLSL } from './output'
import { gaussianBlur } from './passes'
import { NO_PROFILE, type Profiler } from './profile'

/**
 * The lens works on a copy of the scene whose short side is always 512 px, so
 * every pyramid level covers the same fraction of the frame at any output
 * size. Level i has a texel of 2^i / 512 of the short side; 8 levels reach
 * about half the frame.
 */
export const LENS_BASE_SHORT_SIDE = 512
export const LENS_LEVELS = 8
const LUMA: Rgb = [0.2126, 0.7152, 0.0722]

/**
 * Gaussian sigma of pyramid level i in short-side units. Measured with a disk
 * on a grey base: about 1.2 texels of the level for levels 1..5, 0.9 for level 0.
 */
export function levelSigma(level: number): number {
  return (level <= 0 ? 0.9 : 1.2 * 2 ** level) / LENS_BASE_SHORT_SIDE
}

/** The (fractional) pyramid level whose blur is closest to a radius in short-side units. */
export function levelForRadius(radius: number): number {
  return Math.log2((Math.max(radius, 1e-5) * LENS_BASE_SHORT_SIDE) / 1.2)
}

export function lensBaseSize(width: number, height: number): { width: number; height: number } {
  const scale = LENS_BASE_SHORT_SIDE / Math.min(width, height)
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

function normalizeLuminance(rgb: Rgb): Rgb {
  const y = rgb[0] * LUMA[0] + rgb[1] * LUMA[1] + rgb[2] * LUMA[2]
  return y > 1e-6 ? [rgb[0] / y, rgb[1] / y, rgb[2] / y] : [1, 1, 1]
}

/**
 * Per-level bloom weights times tints. Weights sum to 1 and tints have
 * luminance 1, so bloom keeps total luminance. Explicit bloomLevels and
 * bloomLevelTints replace the gaussian over levels and the white-to-tint ramp.
 */
export function bloomLevelFactors(lens: LensSettings): Rgb[] {
  const center = lens.bloomRadius * (LENS_LEVELS - 1)
  const width = Math.max(0.05, lens.bloomWidth)
  const explicit = lens.bloomLevels
  const weights = Array.from({ length: LENS_LEVELS }, (_, i) =>
    explicit ? (explicit[i] ?? 0) : Math.exp(-0.5 * ((i - center) / width) ** 2),
  )
  const total = weights.reduce((a, b) => a + b, 0) || 1
  const tint = hexToLinear(lens.bloomTint)
  return weights.map((w, i) => {
    const t = i / (LENS_LEVELS - 1)
    const levelTint = lens.bloomLevelTints?.[i]
    const base: Rgb = levelTint ? hexToLinear(levelTint) : [1 + (tint[0] - 1) * t, 1 + (tint[1] - 1) * t, 1 + (tint[2] - 1) * t]
    const mixed = normalizeLuminance(base)
    return [(mixed[0] * w) / total, (mixed[1] * w) / total, (mixed[2] * w) / total]
  })
}

/**
 * Level weights of the camera's glare, by its near length L: least-squares fits (non-negative, relative error
 * on the point and the line spread from 0.003 to 0.45 of the short side) of half exp(-r / L) / (2 pi L^2) and
 * half a tail (1 + r / L)^-3 / (pi L^2), both of unit light. At L 0.0025, 47% of the glare lands beyond 0.005
 * of the short side, 4.3% beyond 0.05 and 0.9% beyond 0.2; at L 0.016, 95%, 29% and 5.4%.
 */
const GLARE_TABLE: readonly (readonly [number, readonly number[]])[] = [
  [0.0025, [0.3275, 0.4411, 0.1115, 0.056, 0.0315, 0.0179, 0.0074, 0.007]],
  [0.004, [0.1228, 0.3963, 0.2997, 0.0828, 0.0473, 0.0281, 0.0118, 0.0113]],
  [0.0063, [0.0545, 0.1824, 0.4193, 0.2038, 0.0608, 0.0436, 0.0178, 0.0178]],
  [0.0101, [0.018, 0.0816, 0.2547, 0.4089, 0.1218, 0.059, 0.0284, 0.0276]],
  [0.016, [0.0042, 0.0364, 0.1001, 0.3768, 0.3094, 0.0888, 0.0412, 0.0432]],
]

/** Glare weights per level for a near length, interpolated in log length between the table's rows. */
export function glareLevelWeights(length: number): number[] {
  return tableWeights(GLARE_TABLE, length)
}

/**
 * Level weights of the veil, by its reach R: non-negative least-squares fits of (1 + r / R)^-3 / (pi R^2) on the
 * point and the line spread from 0.003 to 0.45 of the short side, normalized to sum 1 (within 5% of the shape at
 * 0.02, 9% at 0.04).
 */
const VEIL_TABLE: readonly (readonly [number, readonly number[]])[] = [
  [0.005, [0.1193, 0.2355, 0.2183, 0.1878, 0.1121, 0.0694, 0.0291, 0.0285]],
  [0.01, [0.0295, 0.1163, 0.198, 0.2402, 0.1796, 0.1248, 0.0553, 0.0563]],
  [0.02, [0.0047, 0.0319, 0.1032, 0.2156, 0.2333, 0.2026, 0.0992, 0.1096]],
  [0.04, [0.0006, 0.0058, 0.0286, 0.1153, 0.2109, 0.2725, 0.1595, 0.2067]],
]

/** Level weights for a table of reaches, interpolated in log reach between its rows. */
function tableWeights(table: readonly (readonly [number, readonly number[]])[], length: number): number[] {
  const first = table[0][0]
  const last = table[table.length - 1][0]
  const x = Math.log(Math.min(last, Math.max(first, length)))
  let k = 0
  while (k < table.length - 2 && x > Math.log(table[k + 1][0])) k++
  const [l0, w0] = table[k]
  const [l1, w1] = table[k + 1]
  const t = Math.min(1, Math.max(0, (x - Math.log(l0)) / (Math.log(l1) - Math.log(l0))))
  return w0.map((w, i) => w + (w1[i] - w) * t)
}

/** Veil weights per level for a reach. */
export function veilLevelWeights(reach: number): number[] {
  return tableWeights(VEIL_TABLE, reach)
}

/**
 * The share of light the lens spreads and the per-level factors of the one pyramid that carries the recipe's
 * bloom, the camera's glare and the veil. Two spreads in a row keep (1 - first)(1 - second) of the light sharp;
 * the rest goes to the two kernels, half of the light both touch to each. The veil comes after bloom and glare.
 */
export function lensSpread(lens: LensSettings): { mix: number; factors: Rgb[] } {
  const a = Math.min(1, Math.max(0, lens.bloom))
  const b = Math.min(1, Math.max(0, lens.glare))
  const v = Math.min(1, Math.max(0, lens.veil ?? 0))
  const mix = a + b - a * b
  let factors: Rgb[] = []
  if (mix > 0) {
    const bloom = bloomLevelFactors(lens)
    const glare = glareLevelWeights(lens.glareLength)
    const sa = (a * (1 - b / 2)) / mix
    const sb = (b * (1 - a / 2)) / mix
    factors = bloom.map((f, i) => [sa * f[0] + sb * glare[i], sa * f[1] + sb * glare[i], sa * f[2] + sb * glare[i]] as Rgb)
  }
  if (v <= 0) return mix > 0 ? { mix, factors } : { mix: 0, factors: [] }
  const veil = veilLevelWeights(lens.veilReach ?? 0.02)
  const all = mix + v - mix * v
  const sm = (mix * (1 - v / 2)) / all
  const sv = (v * (1 - mix / 2)) / all
  return {
    mix: all,
    factors: veil.map((w, i) => {
      const f = factors[i] ?? [0, 0, 0]
      return [sm * f[0] + sv * w, sm * f[1] + sv * w, sm * f[2] + sv * w] as Rgb
    }),
  }
}

/** How strongly the brighter of a pixel's own light and the spread light leads its color: weights go as luminance to this power. */
export const SPREAD_LEAD_POWER = 4
/** The same for the lights a place's spread light comes from; lower, so the weights stay inside half-float range. */
const LEAD_FEED_POWER = 3
/** Luminance that weighs 1 in the lead weights, so they stay inside half-float range for lights up to 10 times it. */
const SPREAD_LEAD_LEVEL = 0.25
/** A white light's lead weight against a pure color's of the same luminance. */
const SPREAD_LEAD_WHITE = 0.05

/**
 * CPU twin of the composite's leadMix, for tests: a pixel's own light and the light the lens spreads onto it (whose
 * color is `spreadHue`, any luminance), added up in luminance and colored by whichever brings more, weighed as
 * luminance to the power p.
 */
export function leadMix(own: Rgb, spread: Rgb, spreadHue: Rgb, p = SPREAD_LEAD_POWER): Rgb {
  const lum = (c: Rgb) => c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2]
  const yo = lum(own)
  const ys = lum(spread)
  const top = Math.max(yo, ys)
  if (top <= 0) return own.map((v, i) => v + spread[i]) as Rgb
  const sh = lum(spreadHue) > 0 ? spreadHue.map((v) => v / lum(spreadHue)) : spread.map((v) => v / Math.max(ys, 1e-12))
  const wo = (yo / top) ** p
  const ws = (ys / top) ** p
  const hue = own.map((v, i) => (wo * (v / Math.max(yo, 1e-12)) + ws * sh[i]) / (wo + ws)) as Rgb
  const yh = Math.max(lum(hue), 1e-6)
  return hue.map((v) => ((yo + ys) * v) / yh) as Rgb
}

/**
 * Level weights for the spread light's lead color: the spread's own weights one level finer. A light's share in a
 * place is its spread there times its luminance; weighing hues by that share to the power p is close to weighing
 * them by its luminance to the power p through a kernel about half as wide.
 */
export function spreadLeadFactors(factors: readonly Rgb[]): number[] {
  const luminanceWeights = factors.map((f) => f[0] * LUMA[0] + f[1] * LUMA[1] + f[2] * LUMA[2])
  const out = luminanceWeights.map((_, i) => luminanceWeights[i + 1] ?? 0)
  out[0] += luminanceWeights[0]
  return out
}

/** Gaussian weights over the pyramid levels around a (fractional) level, summing to 1. */
function levelBump(center: number): number[] {
  const clamped = Math.min(LENS_LEVELS - 1, Math.max(0, center))
  const weights = Array.from({ length: LENS_LEVELS }, (_, i) => Math.exp(-0.5 * ((i - clamped) / 0.8) ** 2))
  const total = weights.reduce((a, b) => a + b, 0)
  return weights.map((w) => w / total)
}

type Rgba = [number, number, number, number]

/**
 * Per-level halation weights: red, green, blue, and a fourth for the drift part. The halo's source is each pixel's
 * own light where its luminance is above the light's own (halationTint's), so the halo keeps the light's color, also
 * after the color stage has recolored it, and its place and size follow the light's brightness, not its color. The
 * color channels carry (1 - halationDrift) of it at halationRadius; the fourth carries its luminance,
 * halationDrift of it, halationSpread x 1.5 levels wider (0.67 is one level), for halationDriftColor.
 */
export function halationLevelFactors(lens: LensSettings): Rgba[] {
  const level = levelForRadius(lens.halationRadius)
  const main = levelBump(level)
  const outer = levelBump(level + lens.halationSpread * 1.5)
  const d = Math.min(1, Math.max(0, lens.halationDrift))
  return main.map((w, i) => [(1 - d) * w, (1 - d) * w, (1 - d) * w, d * outer[i]] as Rgba)
}

/** halationDriftTint at luminance 1: the drift part takes this color at the halo's own luminance. */
export function halationDriftColor(lens: LensSettings): Rgb {
  const drift = hexToLinear(lens.halationDriftTint)
  const y = drift[0] * LUMA[0] + drift[1] * LUMA[1] + drift[2] * LUMA[2]
  return y > 1e-6 ? [drift[0] / y, drift[1] / y, drift[2] / y] : [0, 0, 0]
}

const DOWNSAMPLE_SHADER =
  GLSL_HEADER +
  /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uDstSize;
out vec4 fragColor;
// Jimenez 2014: 13 bilinear taps, weights sum to 1; all four channels.
void main() {
  vec2 uv = gl_FragCoord.xy / uDstSize;
  vec2 t = 1.0 / vec2(textureSize(uSrc, 0));
  vec4 a = texture(uSrc, uv + t * vec2(-2.0, 2.0));
  vec4 b = texture(uSrc, uv + t * vec2(0.0, 2.0));
  vec4 c = texture(uSrc, uv + t * vec2(2.0, 2.0));
  vec4 d = texture(uSrc, uv + t * vec2(-2.0, 0.0));
  vec4 e = texture(uSrc, uv);
  vec4 f = texture(uSrc, uv + t * vec2(2.0, 0.0));
  vec4 g = texture(uSrc, uv + t * vec2(-2.0, -2.0));
  vec4 h = texture(uSrc, uv + t * vec2(0.0, -2.0));
  vec4 i = texture(uSrc, uv + t * vec2(2.0, -2.0));
  vec4 j = texture(uSrc, uv + t * vec2(-1.0, 1.0));
  vec4 k = texture(uSrc, uv + t * vec2(1.0, 1.0));
  vec4 l = texture(uSrc, uv + t * vec2(-1.0, -1.0));
  vec4 m = texture(uSrc, uv + t * vec2(1.0, -1.0));
  fragColor = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
}
`

const UPSAMPLE_SHADER =
  GLSL_HEADER +
  /* glsl */ `
uniform sampler2D uCoarse;
uniform sampler2D uFine;
uniform vec4 uFineWeight;
uniform bool uHasCoarse;
uniform vec2 uDstSize;
out vec4 fragColor;
// 3x3 tent over the coarser level (offsets of one coarse texel) plus this level times its weight, per channel.
void main() {
  vec2 uv = gl_FragCoord.xy / uDstSize;
  vec4 result = uFineWeight * texture(uFine, uv);
  if (uHasCoarse) {
    vec2 t = 1.0 / vec2(textureSize(uCoarse, 0));
    vec4 tent = texture(uCoarse, uv) * 4.0;
    tent += (texture(uCoarse, uv + vec2(t.x, 0.0)) + texture(uCoarse, uv - vec2(t.x, 0.0))
           + texture(uCoarse, uv + vec2(0.0, t.y)) + texture(uCoarse, uv - vec2(0.0, t.y))) * 2.0;
    tent += texture(uCoarse, uv + t) + texture(uCoarse, uv - t)
          + texture(uCoarse, uv + vec2(t.x, -t.y)) + texture(uCoarse, uv + vec2(-t.x, t.y));
    result += tent / 16.0;
  }
  fragColor = result;
}
`

const HOT_SHADER =
  GLSL_HEADER +
  /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uStart;
uniform float uExposureScale;
out vec4 fragColor;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
// Each texel's own exposed light where it is brighter than the start (its luminance against uStart.x or its largest
// channel against uStart.y, whichever is more), ramping in up to twice that, from an averaged image.
void main() {
  vec3 c = max(texelFetch(uSrc, ivec2(gl_FragCoord.xy), 0).rgb, vec3(0.0)) * uExposureScale;
  float s = max(dot(c, LUMA) / uStart.x, max(c.r, max(c.g, c.b)) / uStart.y);
  fragColor = vec4(c * smoothstep(1.0, 2.0, s), 1.0);
}
`

const FEED_SHADER =
  GLSL_HEADER +
  /* glsl */ `
uniform sampler2D uSrc;
out vec4 fragColor;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
// The halo's source: each pixel's own light above the start, in its own color, with its luminance for the drift part.
void main() {
  vec3 hot = max(texelFetch(uSrc, ivec2(gl_FragCoord.xy), 0).rgb, vec3(0.0));
  fragColor = vec4(hot, dot(hot, LUMA));
}
`

const LEAD_FEED_SHADER =
  GLSL_HEADER +
  /* glsl */ `
uniform sampler2D uSrc;
out vec4 fragColor;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
// Each texel's hue (its light at luminance 1) times its weight in the spread light's lead color, and the weight:
// (luminance / ${SPREAD_LEAD_LEVEL})^${LEAD_FEED_POWER}, kept inside half-float range, times how colored the light
// is (1 for a pure color, ${SPREAD_LEAD_WHITE} for white), so a pale light's glow takes the color of a colored
// neighbour's instead of reading grey in the dark.
void main() {
  vec3 c = max(texelFetch(uSrc, ivec2(gl_FragCoord.xy), 0).rgb, vec3(0.0));
  float y = dot(c, LUMA);
  float top = max(c.r, max(c.g, c.b));
  float purity = top > 0.0 ? 1.0 - min(c.r, min(c.g, c.b)) / top : 0.0;
  float w = min(pow(y / ${SPREAD_LEAD_LEVEL}, ${LEAD_FEED_POWER.toFixed(1)}), 60000.0) * mix(${SPREAD_LEAD_WHITE}, 1.0, purity * purity);
  fragColor = y > 0.0 ? vec4(c / y * w, w) : vec4(0.0);
}
`

/**
 * The light's own level, from halationTint (the light's own hex): its luminance and its largest channel. A pixel is k
 * times the light's level when its luminance or its largest channel, whichever is more, is k times the light's. The
 * color stage gives each pixel the design's luminance or, where that would take a channel past the design's
 * brightest, the design's largest channel, so one of the two always keeps the design's level and the halo keeps its
 * place and size whatever colors the stage gives the light.
 */
export function halationLevel(lens: LensSettings): [number, number] {
  const light = hexToLinear(lens.halationTint)
  return [Math.max(1e-3, light[0] * LUMA[0] + light[1] * LUMA[1] + light[2] * LUMA[2]), Math.max(1e-3, ...light)]
}

/** Where light starts to feed the halo, as a luminance and a largest channel (after exposure): never below the light's own. */
export function halationStart(lens: LensSettings): [number, number] {
  const t = Math.max(1, lens.halationThreshold)
  const [y, v] = halationLevel(lens)
  return [t * y, t * v]
}

/** Short side of the surroundings map that holds halation back on bright backgrounds, and its blur in px. */
const SURROUND_SHORT_SIDE = 64
const SURROUND_BLUR_PX = 4

const SURROUND_SHADER =
  GLSL_HEADER +
  /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uDstSize;
uniform int uTaps;
uniform float uExposureScale;
uniform vec2 uLevelScale;
out vec4 fragColor;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
// Area-averaged brightness of the exposed scene in multiples of the light's own level (luminance or largest channel,
// whichever is more), each sample capped at 1, so a hot source itself barely counts as surroundings.
void main() {
  vec2 corner = gl_FragCoord.xy - 0.5;
  float inv = 1.0 / float(uTaps);
  float sum = 0.0;
  for (int j = 0; j < 8; j++) {
    if (j >= uTaps) break;
    for (int i = 0; i < 8; i++) {
      if (i >= uTaps) break;
      vec3 c = texture(uSrc, (corner + (vec2(float(i), float(j)) + 0.5) * inv) / uDstSize).rgb * uExposureScale;
      vec3 lit = max(c, vec3(0.0));
      sum += min(max(dot(lit, LUMA) * uLevelScale.x, max(lit.r, max(lit.g, lit.b)) * uLevelScale.y), 1.0);
    }
  }
  fragColor = vec4(vec3(sum * inv * inv), 1.0);
}
`

/**
 * Lens composite, all in exposed light: exposure, energy-conserving bloom mix,
 * halation (each light's own blurred light above the light's luminance, in its
 * own color, and the drift part in the drift color), tone curve. Needs
 * CHUNK_LIBRARY.
 */
export const LENS_COMPOSITE_GLSL =
  TONE_CURVE_GLSL +
  /* glsl */ `
uniform sampler2D uBloomTex;
uniform sampler2D uLeadTex;
uniform sampler2D uHalationTex;
uniform sampler2D uHalationSurround;
uniform float uBloomMix;
uniform float uSpreadLead; // 0: the spread light mixes in as it is; else the power its lead color is weighed by
uniform float uHalation;
uniform vec2 uHalationLevel; // the light's own luminance and largest channel (halationTint)
uniform vec3 uHalationDriftColor; // halationDriftTint at luminance 1
uniform float uExposure;
uniform float uLensVignette;
uniform vec2 uLensVignetteAxes; // frame proportions scaled so the corners are at distance 1

// The pixel's own light and the light the lens spreads onto it, added up in luminance, in the color of whichever
// brings more (weighed as luminance to the power p); the spread light's own color is that of the light that brings
// the most of it here (lead: hue times weight, and the weight).
vec3 leadMix(vec3 own, vec3 spread, vec4 lead, float p) {
  float yo = luminance(own);
  float ys = luminance(spread);
  float top = max(yo, ys);
  if (top <= 0.0) return own + spread;
  vec3 spreadHue = lead.a > 0.0 ? lead.rgb / lead.a : spread / max(ys, 1e-12);
  spreadHue /= max(luminance(spreadHue), 1e-6);
  // Weights relative to the brighter, so they never both round to zero in the dark.
  float wo = pow(yo / top, p);
  float ws = pow(ys / top, p);
  vec3 hue = (wo * own / max(yo, 1e-12) + ws * spreadHue) / (wo + ws);
  return (yo + ys) * hue / max(luminance(hue), 1e-6);
}

vec3 lensAndTone(vec3 radiance, vec2 uv) {
  vec3 c = radiance;
  if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
  float exposure = exp2(uExposure);
  c = max(c, vec3(0.0)) * exposure;
  if (uBloomMix > 0.0) {
    vec3 spread = sampleSmooth(uBloomTex, uv) * exposure;
    if (uSpreadLead > 0.0) c = leadMix(c * (1.0 - uBloomMix), spread * uBloomMix, sampleSmooth4(uLeadTex, uv), uSpreadLead);
    else c = mix(c, spread, uBloomMix);
  }
  if (uHalation > 0.0) {
    // Not over the hot core itself (only light above the light's own level fades it), and held back only where
    // the wide surroundings are brighter than 0.15 of that level, so a light on a bright background does not
    // tint it while halos in dark scenes, including inside a recipe's own glow, keep their full strength.
    float level = max(luminance(c) / uHalationLevel.x, maxComponent(c) / uHalationLevel.y);
    float fade = 1.0 / (1.0 + max(level - 1.0, 0.0));
    float hold = 1.0 / (1.0 + 4.0 * max(sampleSmooth(uHalationSurround, uv).r - 0.15, 0.0));
    vec4 halo = sampleSmooth4(uHalationTex, uv);
    c += uHalation * (halo.rgb + halo.a * uHalationDriftColor) * fade * hold;
  }
  if (uLensVignette > 0.0) {
    vec2 q = (2.0 * uv - 1.0) * uLensVignetteAxes;
    c *= pow(1.0 + dot(q, q), -2.0 * uLensVignette);
  }
  return toneCurve(c);
}
`

/** Composite for recipes with post passes: reads the post-processed radiance instead of evaluating it. */
export const TEXTURE_COMPOSITE_SHADER =
  GLSL_HEADER +
  CHUNK_LIBRARY +
  LENS_COMPOSITE_GLSL +
  /* glsl */ `
uniform sampler2D uRadianceTex;
uniform vec2 uRenderSize;
uniform vec2 uTileOrigin;
out vec4 fragColor;
void main() {
  vec2 uv = (gl_FragCoord.xy + uTileOrigin) / uRenderSize;
  vec4 scene = sampleSmooth4(uRadianceTex, uv);
  fragColor = vec4(lensAndTone(scene.rgb, uv), scene.a);
}
`

/**
 * The composite for a radiance texture at render resolution: one texel per pixel, unfiltered. A supersampled tile's
 * apron reaches past the frame, where the edge texels repeat.
 */
export const TEXEL_COMPOSITE_SHADER =
  GLSL_HEADER +
  CHUNK_LIBRARY +
  LENS_COMPOSITE_GLSL +
  /* glsl */ `
uniform sampler2D uRadianceTex;
uniform vec2 uRenderSize;
uniform vec2 uTileOrigin;
out vec4 fragColor;
void main() {
  vec2 px = gl_FragCoord.xy + uTileOrigin;
  vec4 scene = texelFetch(uRadianceTex, clamp(ivec2(floor(px)), ivec2(0), textureSize(uRadianceTex, 0) - 1), 0);
  fragColor = vec4(lensAndTone(scene.rgb, px / uRenderSize), scene.a);
}
`

/**
 * The lens base from a radiance texture at render resolution: the area
 * average of the texels under each base pixel, and (output 1) of each texel's
 * own exposed light where its luminance is above the halo's start, as the
 * radiance pass takes it per sample. At most 7 texels per base pixel per axis.
 * A texture smaller than the base is read with bilinear filtering instead.
 */
export const BASE_FROM_RADIANCE_SHADER =
  GLSL_HEADER +
  /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uDstSize;
uniform vec2 uStart;
uniform float uExposureScale;
layout(location = 0) out vec4 fragColor;
layout(location = 1) out vec4 hotColor;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
void main() {
  vec2 scale = vec2(textureSize(uSrc, 0)) / uDstSize;
  if (scale.x < 1.0 || scale.y < 1.0) {
    vec4 c = texture(uSrc, gl_FragCoord.xy / uDstSize);
    vec3 exposed = max(c.rgb, vec3(0.0)) * uExposureScale;
    fragColor = c;
    hotColor = vec4(exposed * smoothstep(1.0, 2.0, max(dot(exposed, LUMA) / uStart.x, max(exposed.r, max(exposed.g, exposed.b)) / uStart.y)), 1.0);
    return;
  }
  vec2 lo = (gl_FragCoord.xy - 0.5) * scale;
  vec2 hi = lo + scale;
  vec4 sum = vec4(0.0);
  vec3 hot = vec3(0.0);
  float total = 0.0;
  for (int j = 0; j < 8; j++) {
    float y = floor(lo.y) + float(j);
    if (y >= hi.y) break;
    float wy = min(y + 1.0, hi.y) - max(y, lo.y);
    for (int i = 0; i < 8; i++) {
      float x = floor(lo.x) + float(i);
      if (x >= hi.x) break;
      float w = wy * (min(x + 1.0, hi.x) - max(x, lo.x));
      vec4 c = texelFetch(uSrc, ivec2(x, y), 0);
      vec3 exposed = max(c.rgb, vec3(0.0)) * uExposureScale;
      sum += w * c;
      hot += w * exposed * smoothstep(1.0, 2.0, max(dot(exposed, LUMA) / uStart.x, max(exposed.r, max(exposed.g, exposed.b)) / uStart.y));
      total += w;
    }
  }
  fragColor = sum / total;
  hotColor = vec4(hot / total, 1.0);
}
`

export interface LensOutput {
  bloom: Target | null
  /** With the veil on: the spread light's lead color (hue times weight, and the weight), else null. */
  lead: Target | null
  halation: Target | null
  /** Luminance of the wide surroundings (scene clamped to nominal, about 0.03 of the short side blur). */
  surround: Target | null
}

/**
 * Builds the bloom and halation images from the 512 px base image. `hot` is
 * the base's per-sample light above nominal when the radiance pass wrote it
 * (base.second); otherwise it is taken from the averaged base. Caller
 * releases the returned targets.
 */
export function runLens(gpu: Gpu, base: Target, lens: LensSettings, exposure: number, profiler: Profiler = NO_PROFILE): LensOutput {
  const spread = lensSpread(lens)
  const bloom = spread.mix > 0 ? pyramid(gpu, base, spread.factors) : null
  if (bloom) profiler.mark('lens bloom', bloom)
  let lead: Target | null = null
  if (bloom && (lens.veil ?? 0) > 0) {
    const feed = gpu.acquire(base.width, base.height)
    gpu.draw(gpu.program(LEAD_FEED_SHADER), feed, { textures: { uSrc: base } })
    lead = pyramid(gpu, feed, spreadLeadFactors(spread.factors).map((w) => [w, w, w, w]))
    gpu.release(feed)
    profiler.mark('lens lead', lead)
  }
  let halation: Target | null = null
  let surround: Target | null = null
  if (lens.halation > 0) {
    let hot = base.second ?? null
    let owned: Target | null = null
    if (!hot) {
      owned = gpu.acquire(base.width, base.height)
      gpu.draw(gpu.program(HOT_SHADER), owned, {
        textures: { uSrc: base },
        uniforms: { uStart: halationStart(lens), uExposureScale: 2 ** exposure },
      })
      hot = owned
    }
    const feed = gpu.acquire(hot.width, hot.height)
    gpu.draw(gpu.program(FEED_SHADER), feed, { textures: { uSrc: hot } })
    gpu.release(owned)
    halation = pyramid(gpu, feed, halationLevelFactors(lens))
    gpu.release(feed)
    const scale = SURROUND_SHORT_SIDE / Math.min(base.width, base.height)
    const small = gpu.acquire(Math.max(1, Math.round(base.width * scale)), Math.max(1, Math.round(base.height * scale)))
    gpu.draw(gpu.program(SURROUND_SHADER), small, {
      textures: { uSrc: base },
      uniforms: {
        uDstSize: [small.width, small.height],
        uTaps: Math.min(8, Math.ceil(base.width / small.width)),
        uExposureScale: 2 ** exposure,
        uLevelScale: halationLevel(lens).map((v) => 1 / v),
      },
    })
    surround = gaussianBlur(gpu, small, SURROUND_BLUR_PX)
    gpu.release(small)
    profiler.mark('lens halation', surround)
  }
  return { bloom, lead, halation, surround }
}

/** Blurs `base` over the levels, `factors` per level for red, green, blue and the fourth channel (0 when not given). */
function pyramid(gpu: Gpu, base: Target, factors: readonly (readonly number[])[]): Target {
  const down = gpu.program(DOWNSAMPLE_SHADER)
  const up = gpu.program(UPSAMPLE_SHADER)
  const levels: Target[] = [base]
  for (let i = 1; i < factors.length; i++) {
    const src = levels[i - 1]
    const level = gpu.acquire(Math.max(1, Math.round(src.width / 2)), Math.max(1, Math.round(src.height / 2)))
    gpu.draw(down, level, { textures: { uSrc: src }, uniforms: { uDstSize: [level.width, level.height] } })
    levels.push(level)
  }
  let coarse: Target | null = null
  for (let i = factors.length - 1; i >= 0; i--) {
    const fine = levels[i]
    const out = gpu.acquire(fine.width, fine.height)
    gpu.draw(up, out, {
      textures: coarse ? { uFine: fine, uCoarse: coarse } : { uFine: fine },
      uniforms: { uFineWeight: [factors[i][0], factors[i][1], factors[i][2], factors[i][3] ?? 0], uHasCoarse: coarse !== null, uDstSize: [fine.width, fine.height] },
    })
    gpu.release(coarse)
    coarse = out
  }
  for (let i = 1; i < levels.length; i++) gpu.release(levels[i])
  if (!coarse) throw new Error('Lens pyramid has no levels.')
  return coarse
}
