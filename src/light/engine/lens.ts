import { hexToLinear, type Rgb } from '../color/srgb'
import type { LensSettings, UniformMap } from '../scene'
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
  const mix = a + b - a * b
  if (mix <= 0) return { mix: 0, factors: [] }
  const bloom = bloomLevelFactors(lens)
  const glare = glareLevelWeights(lens.glareLength)
  const sa = (a * (1 - b / 2)) / mix
  const sb = (b * (1 - a / 2)) / mix
  return {
    mix,
    factors: bloom.map((f, i) => [sa * f[0] + sb * glare[i], sa * f[1] + sb * glare[i], sa * f[2] + sb * glare[i]] as Rgb),
  }
}

/** The veil's level weights at its reach, or null while it is off. It is not part of lensSpread. */
export function veilFactors(lens: LensSettings): number[] | null {
  return (lens.veil ?? 0) > 0 ? veilLevelWeights(lens.veilReach ?? 0.02) : null
}

/**
 * The light the veil adds to a pixel (CPU twin of the composite's): with x how far the pixel's own light is below
 * the light around it (through the veil's falloff) as a share of that light, `veil` x^3 of the light around it. A
 * bright core or an even field (x 0) gets nothing and keeps its light; a dark gap beside bright light (x near 1)
 * fills most; a place half as bright as its surroundings gets an eighth of that, so gradients inside a color keep
 * their range. Luminances in, a luminance out.
 */
export function veilFill(own: number, around: number, veil: number): number {
  if (!(around > 0)) return 0
  const x = Math.max(1 - own / around, 0)
  return veil * around * x * x * x
}

/** Most pack colors the veil's dim paths hold, and the darker colors along each path. */
export const GLOW_DIM_COLORS = 8
export const GLOW_DIM_STEPS = 3

/**
 * A pack color's dim path for the veil's glow: the color, then up to GLOW_DIM_STEPS darker colors, each taking over
 * below a level of the glow's light (the pixel's light against the light around it, 0..1, highest first), as Yellow
 * dims like fire to Orange-red below 0.5 and to deep red below 0.25. Colors in linear RGB, at any brightness.
 */
export interface GlowDimPath {
  color: readonly number[]
  steps: readonly { color: readonly number[]; below: number }[]
}

const atLuminance1 = (c: readonly number[]): Rgb => {
  const y = c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2]
  return y > 1e-9 ? [c[0] / y, c[1] / y, c[2] / y] : [1, 1, 1]
}

/**
 * The composite's uniforms for the veil's dim paths (the color stage passes them with its own uniforms). With none,
 * the glow keeps the color of the light it came from at every level.
 */
export function glowDimUniforms(paths: readonly GlowDimPath[]): UniformMap {
  const base = new Float32Array(GLOW_DIM_COLORS * 4)
  const steps = new Float32Array(GLOW_DIM_COLORS * GLOW_DIM_STEPS * 4)
  const count = Math.min(GLOW_DIM_COLORS, paths.length)
  for (let k = 0; k < count; k++) {
    base.set([...atLuminance1(paths[k].color), 1], k * 4)
    paths[k].steps.slice(0, GLOW_DIM_STEPS).forEach((step, j) => steps.set([...atLuminance1(step.color), step.below], (k * GLOW_DIM_STEPS + j) * 4))
  }
  return { uGlowDimBase: base, uGlowDimStep: steps, uGlowDimColors: count }
}

/**
 * How much a glow takes a path, by the cosine between the glow's color and the path's color (round white): none at
 * the first value, all at the second, smoothly between, so a glow whose color moves from one pack color toward
 * another passes from one path to the next without an edge.
 */
export const GLOW_DIM_MATCH = [0.7, 0.95] as const

/** The glow's color (luminance 1) at a level of its light along one path. */
function glowDimAlong(h: Rgb, level: number, path: GlowDimPath): Rgb {
  let above: Rgb = h
  let aboveAt = 1
  for (const step of path.steps.slice(0, GLOW_DIM_STEPS)) {
    if (!(step.below > 0)) break
    const color = atLuminance1(step.color)
    if (level >= step.below) {
      const t = Math.min(1, Math.max(0, (level - step.below) / (Math.min(aboveAt, 2 * step.below) - step.below)))
      const s = t * t * (3 - 2 * t)
      return color.map((v, i) => v + (above[i] - v) * s) as Rgb
    }
    above = color
    aboveAt = step.below
  }
  return above
}

/**
 * CPU twin of the composite's glowDimmed: the glow's color (`hue`, any brightness) at a level of its light. Each path
 * weighs by how near its color is (GLOW_DIM_MATCH) times the glow's chroma against the path color's, up to 1, so a
 * paler glow takes a path only partly. The paths' colors mix by weight; where the weights add to less than 1 the rest
 * keeps the glow's own color. Returns luminance 1.
 */
export function glowDimmed(hue: readonly number[], level: number, paths: readonly GlowDimPath[]): Rgb {
  const h = atLuminance1(hue)
  const ch = h.map((v) => v - 1)
  const nh = Math.hypot(ch[0], ch[1], ch[2])
  if (nh < 1e-3) return h
  const sum = [0, 0, 0]
  let total = 0
  for (const path of paths.slice(0, GLOW_DIM_COLORS)) {
    const ck = atLuminance1(path.color).map((v) => v - 1)
    const nk = Math.hypot(ck[0], ck[1], ck[2])
    const cos = (ch[0] * ck[0] + ch[1] * ck[1] + ch[2] * ck[2]) / Math.max(nh * nk, 1e-6)
    const t = Math.min(1, Math.max(0, (cos - GLOW_DIM_MATCH[0]) / (GLOW_DIM_MATCH[1] - GLOW_DIM_MATCH[0])))
    const w = t * t * (3 - 2 * t) * Math.min(1, nh / Math.max(nk, 1e-6))
    if (w <= 0) continue
    const along = glowDimAlong(h, level, path)
    for (let i = 0; i < 3; i++) sum[i] += w * along[i]
    total += w
  }
  if (total <= 0) return h
  return (total > 1 ? sum.map((v) => v / total) : sum.map((v, i) => v + (1 - total) * h[i])) as Rgb
}

/**
 * How strongly the more colored light of a pixel's own and the veil's leads its color: weights go as luminance times
 * colorfulness to this power.
 */
export const SPREAD_LEAD_POWER = 4
/** The same for the lights a place's veil light comes from; lower, so the weights stay inside half-float range. */
const LEAD_FEED_POWER = 3
/** Luminance that weighs 1 in the lead weights, so they stay inside half-float range for lights up to 10 times it. */
const SPREAD_LEAD_LEVEL = 0.25
/** A white light's colorfulness against a pure color's: its weight in the lead at the same luminance. */
const SPREAD_LEAD_WHITE = 0.05

/** How far apart two colors at luminance 1 are round white (CPU twin): 0 within 45 degrees or near white, 1 at 90 or more. */
export function hueApart(a: readonly number[], b: readonly number[]): number {
  const ca = a.map((v) => v - 1)
  const cb = b.map((v) => v - 1)
  const na = Math.hypot(ca[0], ca[1], ca[2])
  const nb = Math.hypot(cb[0], cb[1], cb[2])
  if (na < 1e-3 || nb < 1e-3) return 0
  const t = Math.min(1, Math.max(0, (ca[0] * cb[0] + ca[1] * cb[1] + ca[2] * cb[2]) / (na * nb) / 0.7))
  return 1 - t * t * (3 - 2 * t)
}

/**
 * CPU twin of the composite's leadMix, for tests: a pixel's own light and the light the veil adds to it (whose color
 * is `spreadHue`, any luminance), added up in luminance. Colors within 45 degrees of each other round white add as
 * light does; colors 90 degrees or more apart are colored by whichever brings more colored light, weighed as its
 * luminance times its colorfulness (purity squared, at least SPREAD_LEAD_WHITE) to the power p.
 */
export function leadMix(own: Rgb, spread: Rgb, spreadHue: Rgb, p = SPREAD_LEAD_POWER): Rgb {
  const lum = (c: Rgb) => c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2]
  const yo = lum(own)
  const ys = lum(spread)
  if (Math.max(yo, ys) <= 0) return own.map((v, i) => v + spread[i]) as Rgb
  const sh = lum(spreadHue) > 0 ? spreadHue.map((v) => v / lum(spreadHue)) : spread.map((v) => v / Math.max(ys, 1e-12))
  const colorfulness = (c: readonly number[]) => {
    const top = Math.max(c[0], c[1], c[2])
    const purity = top > 0 ? 1 - Math.min(c[0], c[1], c[2]) / top : 0
    return SPREAD_LEAD_WHITE + (1 - SPREAD_LEAD_WHITE) * purity * purity
  }
  const co = yo * colorfulness(own)
  const cs = ys * colorfulness(sh)
  const top = Math.max(co, cs)
  const q = 1 + (p - 1) * hueApart(own.map((v) => v / Math.max(yo, 1e-12)), sh)
  const wo = top > 0 ? (co / top) ** q : 1
  const ws = top > 0 ? (cs / top) ** q : 1
  const hue = own.map((v, i) => (wo * (v / Math.max(yo, 1e-12)) + ws * sh[i]) / (wo + ws)) as Rgb
  const yh = Math.max(lum(hue), 1e-6)
  return hue.map((v) => ((yo + ys) * v) / yh) as Rgb
}

/**
 * Level weights for the veil light's lead color: the veil's own weights one level finer. A light's share in a
 * place is its spread there times its luminance; weighing hues by that share to the power p is close to weighing
 * them by its luminance to the power p through a kernel about half as wide.
 */
export function spreadLeadFactors(weights: readonly number[]): number[] {
  const out = weights.map((_, i) => weights[i + 1] ?? 0)
  out[0] += weights[0]
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

const GLOW_DIM_SHADER =
  GLSL_HEADER +
  CHUNK_LIBRARY +
  /* glsl */ `
uniform sampler2D uBase;
uniform sampler2D uLensVeilTex;
uniform sampler2D uLensLeadTex;
uniform float uLensVeil;
uniform float uExposureScale;
uniform vec4 uGlowDimBase[${GLOW_DIM_COLORS}]; // each path's pack color at luminance 1 (glowDimUniforms)
uniform vec4 uGlowDimStep[${GLOW_DIM_COLORS * GLOW_DIM_STEPS}]; // its darker colors at luminance 1, w the level below which each takes over
uniform int uGlowDimColors;
out vec4 fragColor;
// The glow's color (at luminance 1) at a level of its light along path k (glowDimAlong in lens.ts).
vec3 glowDimAlong(int k, vec3 hue, float level) {
  vec3 above = hue;
  float aboveAt = 1.0;
  for (int j = 0; j < ${GLOW_DIM_STEPS}; j++) {
    vec4 st = uGlowDimStep[k * ${GLOW_DIM_STEPS} + j];
    if (st.w <= 0.0) break;
    if (level >= st.w) return mix(st.xyz, above, smoothstep(st.w, min(aboveAt, 2.0 * st.w), level));
    above = st.xyz;
    aboveAt = st.w;
  }
  return above;
}

// The glow's color (at luminance 1) at a level of its light: every path weighed by how near its color is, times the
// glow's chroma against the path color's, and the rest of the weight left to the glow's own color (glowDimmed in
// lens.ts).
vec3 glowDimmed(vec3 hue, float level) {
  vec3 ch = hue - 1.0;
  float nh = length(ch);
  if (nh < 1e-3) return hue;
  vec3 sum = vec3(0.0);
  float total = 0.0;
  for (int k = 0; k < ${GLOW_DIM_COLORS}; k++) {
    if (k >= uGlowDimColors) break;
    vec3 ck = uGlowDimBase[k].xyz - 1.0;
    float nk = length(ck);
    float w = smoothstep(${GLOW_DIM_MATCH[0]}, ${GLOW_DIM_MATCH[1]}, dot(ch, ck) / max(nh * nk, 1e-6)) * min(1.0, nh / max(nk, 1e-6));
    if (w <= 0.0) continue;
    sum += w * glowDimAlong(k, hue, level);
    total += w;
  }
  if (total <= 0.0) return hue;
  return total > 1.0 ? sum / total : sum + (1.0 - total) * hue;
}

// The veil's lead color at each base pixel, dimmed along its pack color's path by the level of the light there
// against the light around it (the composite's fill, at the base's size), stored as the color and weight 1.
void main() {
  vec2 uv = gl_FragCoord.xy / vec2(textureSize(uLensLeadTex, 0));
  vec4 lead = texture(uLensLeadTex, uv);
  vec3 hue = lead.a > 0.0 ? lead.rgb / lead.a : vec3(1.0);
  hue /= max(luminance(hue), 1e-6);
  float own = luminance(texture(uBase, uv).rgb) * uExposureScale;
  float around = luminance(texture(uLensVeilTex, uv).rgb) * uExposureScale;
  float x = around > 0.0 ? max(1.0 - own / around, 0.0) : 0.0;
  float level = around > 0.0 ? (own + uLensVeil * around * x * x * x) / around : 1.0;
  fragColor = vec4(glowDimmed(hue, level), 1.0);
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
uniform sampler2D uLensLeadTex;
uniform sampler2D uHalationTex;
uniform sampler2D uHalationSurround;
uniform float uBloomMix;
uniform sampler2D uLensVeilTex;
uniform float uLensVeil; // the veil's strength, 0 off
uniform float uHalation;
uniform vec2 uHalationLevel; // the light's own luminance and largest channel (halationTint)
uniform vec3 uHalationDriftColor; // halationDriftTint at luminance 1
uniform float uExposure;
uniform float uLensVignette;
uniform vec2 uLensVignetteAxes; // frame proportions scaled so the corners are at distance 1

// The pixel's own light and the light the lens spreads onto it, added up in luminance, in the color of whichever
// brings more (weighed as luminance to the power p); the spread light's own color is that of the light that brings
// the most of it here (lead: hue times weight, and the weight).
float leadColorfulness(vec3 c) {
  float top = max(c.r, max(c.g, c.b));
  float purity = top > 0.0 ? 1.0 - min(c.r, min(c.g, c.b)) / top : 0.0;
  return mix(${SPREAD_LEAD_WHITE}, 1.0, purity * purity);
}
// How far apart two colors at luminance 1 are round white: 0 within 45 degrees (or when either is near white), 1 at
// 90 degrees or more.
float hueApart(vec3 a, vec3 b) {
  vec3 ca = a - 1.0;
  vec3 cb = b - 1.0;
  float na = length(ca);
  float nb = length(cb);
  if (na < 1e-3 || nb < 1e-3) return 0.0;
  return 1.0 - smoothstep(0.0, 0.7, dot(ca, cb) / (na * nb));
}

vec3 leadMix(vec3 own, vec3 spread, vec4 lead, float p) {
  float yo = luminance(own);
  float ys = luminance(spread);
  if (max(yo, ys) <= 0.0) return own + spread;
  vec3 spreadHue = lead.a > 0.0 ? lead.rgb / lead.a : spread / max(ys, 1e-12);
  spreadHue /= max(luminance(spreadHue), 1e-6);
  // Each counts by its luminance times how colored it is, so a pale glow over a dim colored place brightens that
  // place in its own color instead of greying it; relative to the larger, so they never both round to zero.
  float co = yo * leadColorfulness(own);
  float cs = ys * leadColorfulness(spreadHue);
  float top = max(co, cs);
  // Near hues add as light does; only hues far apart (90 degrees or more round white) lead.
  float q = mix(1.0, p, hueApart(own / max(yo, 1e-12), spreadHue));
  float wo = top > 0.0 ? pow(co / top, q) : 1.0;
  float ws = top > 0.0 ? pow(cs / top, q) : 1.0;
  vec3 hue = (wo * own / max(yo, 1e-12) + ws * spreadHue) / (wo + ws);
  return (yo + ys) * hue / max(luminance(hue), 1e-6);
}

vec3 lensAndTone(vec3 radiance, vec2 uv) {
  vec3 c = radiance;
  if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
  float exposure = exp2(uExposure);
  c = max(c, vec3(0.0)) * exposure;
  if (uBloomMix > 0.0) c = mix(c, sampleSmooth(uBloomTex, uv) * exposure, uBloomMix);
  if (uLensVeil > 0.0) {
    // The light around this pixel through the veil's falloff; where it is brighter than the pixel, part of the
    // difference comes in as glow (veilFill), in the color of the light that brings the most of it here.
    float around = luminance(sampleSmooth(uLensVeilTex, uv)) * exposure;
    float x = around > 0.0 ? max(1.0 - luminance(c) / around, 0.0) : 0.0;
    float lift = uLensVeil * around * x * x * x;
    vec4 lead = sampleSmooth4(uLensLeadTex, uv);
    if (lift > 0.0) c = leadMix(c, vec3(lift), lead, ${SPREAD_LEAD_POWER.toFixed(1)});
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
  /** With the veil on: the scene through the veil's falloff, else null. */
  veil: Target | null
  /** With the veil on: the veil light's lead color (hue times weight, and the weight), else null. */
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
export function runLens(gpu: Gpu, base: Target, lens: LensSettings, exposure: number, profiler: Profiler = NO_PROFILE, dim: UniformMap = {}): LensOutput {
  const spread = lensSpread(lens)
  const bloom = spread.mix > 0 ? pyramid(gpu, base, spread.factors) : null
  if (bloom) profiler.mark('lens bloom', bloom)
  const veilWeights = veilFactors(lens)
  let veil: Target | null = null
  let lead: Target | null = null
  if (veilWeights) {
    veil = pyramid(gpu, base, veilWeights.map((w) => [w, w, w, 0]))
    const feed = gpu.acquire(base.width, base.height)
    gpu.draw(gpu.program(LEAD_FEED_SHADER), feed, { textures: { uSrc: base } })
    lead = pyramid(gpu, feed, spreadLeadFactors(veilWeights).map((w) => [w, w, w, w]))
    gpu.release(feed)
    // With the color stage's dim paths (glowDimUniforms), the lead color dims along its pack color's path.
    if (Number(dim.uGlowDimColors ?? 0) > 0) {
      const dimmed = gpu.acquire(lead.width, lead.height)
      gpu.draw(gpu.program(GLOW_DIM_SHADER), dimmed, {
        textures: { uBase: base, uLensVeilTex: veil, uLensLeadTex: lead },
        uniforms: {
          uLensVeil: lens.veil,
          uExposureScale: 2 ** exposure,
          uGlowDimBase: dim.uGlowDimBase,
          uGlowDimStep: dim.uGlowDimStep,
          uGlowDimColors: dim.uGlowDimColors,
        },
      })
      gpu.release(lead)
      lead = dimmed
    }
    profiler.mark('lens veil', lead)
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
  return { bloom, veil, lead, halation, surround }
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
