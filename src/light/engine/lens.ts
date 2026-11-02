import { hexToLinear, type Rgb } from '../color/srgb'
import type { LensSettings } from '../scene'
import type { Gpu, Target } from './gl'
import { CHUNK_LIBRARY, GLSL_HEADER } from './glsl'
import { TONE_CURVE_GLSL } from './output'
import { gaussianBlur } from './passes'

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
 * Per-level, per-channel halation weights; each channel sums to 1. Red sits at
 * halationRadius; green is narrower by halationSpread x 1.5 levels (0.67 makes
 * it one level narrower) and blue by twice that, so a white-hot light gets an
 * orange halo near it and a red one farther out.
 */
export function halationLevelFactors(lens: LensSettings): Rgb[] {
  const red = levelForRadius(lens.halationRadius)
  const step = lens.halationSpread * 1.5
  const centers = [red, red - step, red - 2 * step]
  const columns = centers.map((c) => {
    const clamped = Math.min(LENS_LEVELS - 1, Math.max(0, c))
    const weights = Array.from({ length: LENS_LEVELS }, (_, i) => Math.exp(-0.5 * ((i - clamped) / 0.8) ** 2))
    const total = weights.reduce((a, b) => a + b, 0)
    return weights.map((w) => w / total)
  })
  return Array.from({ length: LENS_LEVELS }, (_, i) => [columns[0][i], columns[1][i], columns[2][i]] as Rgb)
}

const DOWNSAMPLE_SHADER =
  GLSL_HEADER +
  /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uDstSize;
out vec4 fragColor;
// Jimenez 2014: 13 bilinear taps, weights sum to 1.
void main() {
  vec2 uv = gl_FragCoord.xy / uDstSize;
  vec2 t = 1.0 / vec2(textureSize(uSrc, 0));
  vec3 a = texture(uSrc, uv + t * vec2(-2.0, 2.0)).rgb;
  vec3 b = texture(uSrc, uv + t * vec2(0.0, 2.0)).rgb;
  vec3 c = texture(uSrc, uv + t * vec2(2.0, 2.0)).rgb;
  vec3 d = texture(uSrc, uv + t * vec2(-2.0, 0.0)).rgb;
  vec3 e = texture(uSrc, uv).rgb;
  vec3 f = texture(uSrc, uv + t * vec2(2.0, 0.0)).rgb;
  vec3 g = texture(uSrc, uv + t * vec2(-2.0, -2.0)).rgb;
  vec3 h = texture(uSrc, uv + t * vec2(0.0, -2.0)).rgb;
  vec3 i = texture(uSrc, uv + t * vec2(2.0, -2.0)).rgb;
  vec3 j = texture(uSrc, uv + t * vec2(-1.0, 1.0)).rgb;
  vec3 k = texture(uSrc, uv + t * vec2(1.0, 1.0)).rgb;
  vec3 l = texture(uSrc, uv + t * vec2(-1.0, -1.0)).rgb;
  vec3 m = texture(uSrc, uv + t * vec2(1.0, -1.0)).rgb;
  vec3 result = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  fragColor = vec4(result, 1.0);
}
`

const UPSAMPLE_SHADER =
  GLSL_HEADER +
  /* glsl */ `
uniform sampler2D uCoarse;
uniform sampler2D uFine;
uniform vec3 uFineWeight;
uniform bool uHasCoarse;
uniform vec2 uDstSize;
out vec4 fragColor;
// 3x3 tent over the coarser level (offsets of one coarse texel) plus this level times its weight.
void main() {
  vec2 uv = gl_FragCoord.xy / uDstSize;
  vec3 result = uFineWeight * texture(uFine, uv).rgb;
  if (uHasCoarse) {
    vec2 t = 1.0 / vec2(textureSize(uCoarse, 0));
    vec3 tent = texture(uCoarse, uv).rgb * 4.0;
    tent += (texture(uCoarse, uv + vec2(t.x, 0.0)).rgb + texture(uCoarse, uv - vec2(t.x, 0.0)).rgb
           + texture(uCoarse, uv + vec2(0.0, t.y)).rgb + texture(uCoarse, uv - vec2(0.0, t.y)).rgb) * 2.0;
    tent += texture(uCoarse, uv + t).rgb + texture(uCoarse, uv - t).rgb
          + texture(uCoarse, uv + vec2(t.x, -t.y)).rgb + texture(uCoarse, uv + vec2(-t.x, t.y)).rgb;
    result += tent / 16.0;
  }
  fragColor = vec4(result, 1.0);
}
`

const HOT_SHADER =
  GLSL_HEADER +
  /* glsl */ `
uniform sampler2D uSrc;
uniform float uStart;
uniform float uExposureScale;
out vec4 fragColor;
// Each channel's own exposed light above nominal, ramping in from uStart to 2 uStart, from an averaged image.
void main() {
  vec3 c = max(texelFetch(uSrc, ivec2(gl_FragCoord.xy), 0).rgb, vec3(0.0)) * uExposureScale;
  fragColor = vec4(c * smoothstep(vec3(uStart), vec3(2.0 * uStart), c), 1.0);
}
`

/** Halation only ever starts above nominal (channel value 1 after exposure), whatever the setting says. */
export function halationStart(lens: LensSettings): number {
  return Math.max(1, lens.halationThreshold)
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
out vec4 fragColor;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
// Area-averaged luminance of the exposed scene clamped to nominal, so a hot source itself barely counts as surroundings.
void main() {
  vec2 corner = gl_FragCoord.xy - 0.5;
  float inv = 1.0 / float(uTaps);
  float sum = 0.0;
  for (int j = 0; j < 8; j++) {
    if (j >= uTaps) break;
    for (int i = 0; i < 8; i++) {
      if (i >= uTaps) break;
      vec3 c = texture(uSrc, (corner + (vec2(float(i), float(j)) + 0.5) * inv) / uDstSize).rgb * uExposureScale;
      sum += dot(clamp(c, 0.0, 1.0), LUMA);
    }
  }
  fragColor = vec4(vec3(sum * inv * inv), 1.0);
}
`

/**
 * Lens composite, all in exposed light: exposure, energy-conserving bloom mix,
 * halation (each channel's own blurred light above nominal times
 * halationTint as per-channel strength), tone curve. Needs CHUNK_LIBRARY.
 */
export const LENS_COMPOSITE_GLSL =
  TONE_CURVE_GLSL +
  /* glsl */ `
uniform sampler2D uBloomTex;
uniform sampler2D uHalationTex;
uniform sampler2D uHalationSurround;
uniform float uBloomMix;
uniform float uHalation;
uniform vec3 uHalationTint;
uniform float uExposure;

vec3 lensAndTone(vec3 radiance, vec2 uv) {
  vec3 c = radiance;
  if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
  float exposure = exp2(uExposure);
  c = max(c, vec3(0.0)) * exposure;
  if (uBloomMix > 0.0) c = mix(c, sampleSmooth(uBloomTex, uv) * exposure, uBloomMix);
  if (uHalation > 0.0) {
    // Not over the hot core itself (only light above nominal fades it), and held back only where the wide
    // surroundings are brighter than 0.15, so a light on a bright background does not tint it while halos in
    // dark scenes, including inside a recipe's own glow, keep their full strength.
    float fade = 1.0 / (1.0 + max(luminance(c) - 1.0, 0.0));
    float hold = 1.0 / (1.0 + 4.0 * max(sampleSmooth(uHalationSurround, uv).r - 0.15, 0.0));
    c += uHalation * uHalationTint * sampleSmooth(uHalationTex, uv) * fade * hold;
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
  fragColor = vec4(lensAndTone(sampleSmooth(uRadianceTex, uv), uv), 1.0);
}
`

export interface LensOutput {
  bloom: Target | null
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
export function runLens(gpu: Gpu, base: Target, lens: LensSettings, exposure: number): LensOutput {
  const bloom = lens.bloom > 0 ? pyramid(gpu, base, bloomLevelFactors(lens)) : null
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
    halation = pyramid(gpu, hot, halationLevelFactors(lens))
    gpu.release(owned)
    const scale = SURROUND_SHORT_SIDE / Math.min(base.width, base.height)
    const small = gpu.acquire(Math.max(1, Math.round(base.width * scale)), Math.max(1, Math.round(base.height * scale)))
    gpu.draw(gpu.program(SURROUND_SHADER), small, {
      textures: { uSrc: base },
      uniforms: { uDstSize: [small.width, small.height], uTaps: Math.min(8, Math.ceil(base.width / small.width)), uExposureScale: 2 ** exposure },
    })
    surround = gaussianBlur(gpu, small, SURROUND_BLUR_PX)
    gpu.release(small)
  }
  return { bloom, halation, surround }
}

function pyramid(gpu: Gpu, base: Target, factors: Rgb[]): Target {
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
      uniforms: { uFineWeight: factors[i], uHasCoarse: coarse !== null, uDstSize: [fine.width, fine.height] },
    })
    gpu.release(coarse)
    coarse = out
  }
  for (let i = 1; i < levels.length; i++) gpu.release(levels[i])
  if (!coarse) throw new Error('Lens pyramid has no levels.')
  return coarse
}
