import type { PostPass, RecipeContext } from '../scene'
import type { Gpu, Target } from './gl'
import { CHUNK_LIBRARY, GLSL_HEADER } from './glsl'
import { NO_PROFILE, type Profiler } from './profile'

/** Post passes run at this short side at most; their output is upsampled with a cubic filter. */
export const POST_MAX_SHORT_SIDE = 2048

const GAUSSIAN_SHADER =
  GLSL_HEADER +
  /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uDirection;
uniform float uSigma;
out vec4 fragColor;
// Separable gaussian out to 3 sigma; pairs of taps share one bilinear fetch. A pair fades in over the first quarter
// texel of reach past where it starts, so the blur doesn't step as sigma grows.
void main() {
  vec2 size = vec2(textureSize(uSrc, 0));
  vec2 uv = gl_FragCoord.xy / size;
  vec2 texel = uDirection / size;
  float reach = 3.0 * uSigma;
  int radius = int(ceil(reach));
  vec4 sum = texture(uSrc, uv);
  float total = 1.0;
  for (int i = 1; i <= 96; i += 2) {
    if (i > radius) break;
    float a = exp(-0.5 * float(i * i) / (uSigma * uSigma));
    float b = exp(-0.5 * float((i + 1) * (i + 1)) / (uSigma * uSigma));
    float w = (a + b) * smoothstep(0.0, 0.25, reach - float(i - 1));
    float offset = (float(i) * a + float(i + 1) * b) / (a + b);
    sum += w * (texture(uSrc, uv + texel * offset) + texture(uSrc, uv - texel * offset));
    total += 2.0 * w;
  }
  fragColor = sum / total;
}
`

const DIRECTIONAL_SHADER =
  GLSL_HEADER +
  /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uStep;
out vec4 fragColor;
// 16 taps centered on the pixel, uStep apart (uv units). Two passes with steps L/256 and L/16 give 256 even taps.
void main() {
  vec2 uv = gl_FragCoord.xy / vec2(textureSize(uSrc, 0));
  vec4 sum = vec4(0.0);
  for (int k = 0; k < 16; k++) sum += texture(uSrc, uv + uStep * (float(k) - 7.5));
  fragColor = sum / 16.0;
}
`

const RADIAL_SHADER =
  GLSL_HEADER +
  /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uCenter;
uniform float uLogStep;
out vec4 fragColor;
// 16 taps toward uCenter at scales exp(-k * uLogStep). Two passes give 256 taps evenly spaced in log scale.
void main() {
  vec2 uv = gl_FragCoord.xy / vec2(textureSize(uSrc, 0));
  vec4 sum = vec4(0.0);
  for (int k = 0; k < 16; k++) sum += texture(uSrc, uCenter + (uv - uCenter) * exp(-float(k) * uLogStep));
  fragColor = sum / 16.0;
}
`

const HALVE_SHADER =
  GLSL_HEADER +
  /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uDstSize;
out vec4 fragColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uDstSize;
  vec2 t = 0.5 / vec2(textureSize(uSrc, 0));
  vec4 sum = texture(uSrc, uv + vec2(-t.x, -t.y)) + texture(uSrc, uv + vec2(t.x, -t.y))
           + texture(uSrc, uv + vec2(-t.x, t.y)) + texture(uSrc, uv + vec2(t.x, t.y));
  fragColor = sum * 0.25;
}
`

/** Downsamples uSrc to the target size by averaging uTaps x uTaps bilinear samples per pixel. */
export const AREA_RESAMPLE_SHADER =
  GLSL_HEADER +
  /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uDstSize;
uniform int uTaps;
out vec4 fragColor;
void main() {
  vec2 corner = gl_FragCoord.xy - 0.5;
  float inv = 1.0 / float(uTaps);
  vec4 sum = vec4(0.0);
  for (int j = 0; j < 8; j++) {
    if (j >= uTaps) break;
    for (int i = 0; i < 8; i++) {
      if (i >= uTaps) break;
      sum += texture(uSrc, (corner + (vec2(float(i), float(j)) + 0.5) * inv) / uDstSize);
    }
  }
  fragColor = sum * inv * inv;
}
`

/** uA at the target's size and uB at any size over the same frame (bilinear), mixed by uMix (0 all uA). */
export const MIX_SHADER =
  GLSL_HEADER +
  /* glsl */ `
uniform sampler2D uA;
uniform sampler2D uB;
uniform vec2 uDstSize;
uniform float uMix;
out vec4 fragColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uDstSize;
  fragColor = mix(texture(uA, uv), texture(uB, uv), uMix);
}
`

/** Resamples uSrc to the target size with a cubic B-spline (smooth upsampling). */
export const RESAMPLE_SMOOTH_SHADER =
  GLSL_HEADER +
  CHUNK_LIBRARY +
  /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uDstSize;
out vec4 fragColor;
void main() {
  fragColor = sampleSmooth4(uSrc, gl_FragCoord.xy / uDstSize);
}
`

const EXACT_GAUSSIAN_SHADER =
  GLSL_HEADER +
  /* glsl */ `
uniform sampler2D uSrc;
uniform ivec2 uDirection;
uniform float uSigma;
out vec4 fragColor;
// Separable gaussian with every tap read exactly (no filtering); edges repeat. 3 sigma, at most 32 texels, each side.
// A tap fades in over the first quarter texel of reach past the one before, so the blur doesn't step as sigma grows.
void main() {
  ivec2 size = textureSize(uSrc, 0);
  ivec2 px = ivec2(gl_FragCoord.xy);
  float reach = 3.0 * uSigma;
  int radius = min(32, int(ceil(reach)));
  vec4 sum = texelFetch(uSrc, px, 0);
  float total = 1.0;
  for (int i = 1; i <= 32; i++) {
    if (i > radius) break;
    float w = exp(-0.5 * float(i * i) / (uSigma * uSigma)) * smoothstep(0.0, 0.25, reach - float(i - 1));
    sum += w * (texelFetch(uSrc, clamp(px + i * uDirection, ivec2(0), size - 1), 0) + texelFetch(uSrc, clamp(px - i * uDirection, ivec2(0), size - 1), 0));
    total += 2.0 * w;
  }
  fragColor = sum / total;
}
`

/** The out-of-focus lens of ScatterBlur shape 'lens': rim share, horizontal stretch, and grid texels per radius. */
export const LENS_RIM = 0.35
export const LENS_STRETCH = 1.1
export const LENS_GRID_TEXELS = 6

const LENS_GATHER_SHADER =
  GLSL_HEADER +
  /* glsl */ `
uniform sampler2D uSrc;
uniform float uRadius;
uniform int uReach;
out vec4 fragColor;
// (1 - rim) of a disc of radius uRadius texels, with a one-texel rim, plus rim of a gaussian of sigma uRadius / 2;
// both stretched horizontally, each normalized by its area, the sum by the taps actually taken. Edges repeat.
void main() {
  ivec2 size = textureSize(uSrc, 0);
  ivec2 px = ivec2(gl_FragCoord.xy);
  float sigma = 0.5 * uRadius;
  float discArea = 3.14159265 * uRadius * uRadius * ${LENS_STRETCH.toFixed(2)};
  float gaussArea = 6.28318531 * sigma * sigma * ${LENS_STRETCH.toFixed(2)};
  vec4 sum = vec4(0.0);
  float total = 0.0;
  for (int dy = -uReach; dy <= uReach; dy++) {
    for (int dx = -uReach; dx <= uReach; dx++) {
      float ex = float(dx) / ${LENS_STRETCH.toFixed(2)};
      float d = sqrt(ex * ex + float(dy * dy));
      float w = ${(1 - LENS_RIM).toFixed(2)} * clamp(uRadius + 0.5 - d, 0.0, 1.0) / discArea
              + ${LENS_RIM.toFixed(2)} * exp(-d * d / (2.0 * sigma * sigma)) / gaussArea;
      sum += w * texelFetch(uSrc, clamp(px + ivec2(dx, dy), ivec2(0), size - 1), 0);
      total += w;
    }
  }
  fragColor = sum / total;
}
`

/** The lens (see LENS_GATHER_SHADER) over `input`, radius in its texels, at its size; caller releases the result. */
export function lensGather(gpu: Gpu, input: Target, radius: number): Target {
  const out = gpu.acquire(input.width, input.height)
  gpu.draw(gpu.program(LENS_GATHER_SHADER), out, {
    textures: { uSrc: input },
    uniforms: { uRadius: radius, uReach: Math.ceil(1.5 * radius * LENS_STRETCH) + 2 },
  })
  return out
}

const PAD_SHADER =
  GLSL_HEADER +
  /* glsl */ `
uniform sampler2D uSrc;
uniform ivec2 uPad;
out vec4 fragColor;
// The source uPad texels in from the bottom-left corner, its edge pixels repeated outward.
void main() {
  ivec2 size = textureSize(uSrc, 0);
  fragColor = texelFetch(uSrc, clamp(ivec2(gl_FragCoord.xy) - uPad, ivec2(0), size - 1), 0);
}
`

const TENT_HALVE_SHADER =
  GLSL_HEADER +
  /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uDstSize;
out vec4 fragColor;
// [1, 3, 3, 1] / 8 per axis: four bilinear taps 0.75 source texels from the center. Positions are in uv, so odd
// sizes stay aligned with the frame.
void main() {
  vec2 uv = gl_FragCoord.xy / uDstSize;
  vec2 t = 0.75 / vec2(textureSize(uSrc, 0));
  fragColor = 0.25 * (texture(uSrc, uv + vec2(-t.x, -t.y)) + texture(uSrc, uv + vec2(t.x, -t.y))
                    + texture(uSrc, uv + vec2(-t.x, t.y)) + texture(uSrc, uv + vec2(t.x, t.y)));
}
`

/**
 * Runs a recipe's post passes on its radiance image. Returns the input itself
 * when every pass is a no-op; otherwise a new target the caller releases.
 */
export function runPostPasses(gpu: Gpu, input: Target, passes: readonly PostPass[], ctx: RecipeContext, profiler: Profiler = NO_PROFILE): Target {
  let current = input
  const short = Math.min(input.width, input.height)
  const aspect = [input.width / short, input.height / short]
  const swap = (next: Target) => {
    if (current !== input) gpu.release(current)
    current = next
  }
  for (const pass of passes) {
    runPass(pass)
    profiler.mark(`post ${pass.kind}`, current)
  }
  return current

  function runPass(pass: PostPass): void {
    switch (pass.kind) {
      case 'gaussianBlur': {
        const { radius } = pass.settings(ctx)
        if (radius > 0) swap(gaussianBlur(gpu, current, radius * short))
        break
      }
      case 'directionalBlur': {
        const { angle, length } = pass.settings(ctx)
        if (length > 0) {
          const a = (angle * Math.PI) / 180
          const dir = [Math.cos(a) / aspect[0], Math.sin(a) / aspect[1]]
          for (const step of [length / 256, length / 16]) {
            const out = gpu.acquire(current.width, current.height)
            gpu.draw(gpu.program(DIRECTIONAL_SHADER), out, {
              textures: { uSrc: current },
              uniforms: { uStep: [dir[0] * step, dir[1] * step] },
            })
            swap(out)
          }
        }
        break
      }
      case 'radialBlur': {
        const { center, amount } = pass.settings(ctx)
        if (amount > 0) {
          const logRange = -Math.log(Math.max(1e-3, 1 - Math.min(amount, 0.999)))
          for (const logStep of [logRange / 256, logRange / 16]) {
            const out = gpu.acquire(current.width, current.height)
            gpu.draw(gpu.program(RADIAL_SHADER), out, {
              textures: { uSrc: current },
              uniforms: { uCenter: [center[0], center[1]], uLogStep: logStep },
            })
            swap(out)
          }
        }
        break
      }
      default: {
        const unknown: never = pass
        throw new Error(`Unknown post pass: ${JSON.stringify(unknown)}`)
      }
    }
  }
}

/** Gaussian blur with sigma in pixels of the input. Large sigmas blur a downsampled copy. Caller releases the result. */
export function gaussianBlur(gpu: Gpu, input: Target, sigma: number): Target {
  const maxSigma = 24
  let level = input
  let scale = 1
  const owned: Target[] = []
  while (sigma / scale > maxSigma && Math.min(level.width, level.height) > 8) {
    const next = gpu.acquire(Math.max(1, Math.round(level.width / 2)), Math.max(1, Math.round(level.height / 2)))
    gpu.draw(gpu.program(HALVE_SHADER), next, {
      textures: { uSrc: level },
      uniforms: { uDstSize: [next.width, next.height] },
    })
    owned.push(next)
    level = next
    scale *= 2
  }
  // Each halving adds roughly half a texel of blur at its level.
  const reduced = Math.sqrt(Math.max(0, sigma * sigma - (scale > 1 ? 0.25 * scale * scale : 0))) / scale
  const program = gpu.program(GAUSSIAN_SHADER)
  const sigmaUniform = Math.max(reduced, 0.01)
  const horizontal = gpu.acquire(level.width, level.height)
  gpu.draw(program, horizontal, { textures: { uSrc: level }, uniforms: { uDirection: [1, 0], uSigma: sigmaUniform } })
  const both = gpu.acquire(level.width, level.height)
  gpu.draw(program, both, { textures: { uSrc: horizontal }, uniforms: { uDirection: [0, 1], uSigma: sigmaUniform } })
  gpu.release(horizontal)
  for (const t of owned) gpu.release(t)
  if (scale === 1) return both
  const out = gpu.acquire(input.width, input.height)
  gpu.draw(gpu.program(RESAMPLE_SMOOTH_SHADER), out, {
    textures: { uSrc: both },
    uniforms: { uDstSize: [out.width, out.height] },
  })
  gpu.release(both)
  return out
}

/** Blurs for sampling keep at least this sigma, in texels of the level they run on, on levels at least this short side. */
const MIN_LEVEL_SIGMA = 4
const MIN_LEVEL_SIDE = 8

export interface SamplingLevel {
  /** Halvings of the source the gaussian runs on. */
  level: number
  /** Gaussian sigma in texels of that level. */
  sigma: number
}

/**
 * Where a blur by sigma (pixels of a width x height source) runs when
 * shaders read the result with sampleSmooth: on the coarsest halving where the
 * gaussian is still MIN_LEVEL_SIGMA texels wide. Its sigma leaves room for the
 * halvings and the cubic read, so the variances add up to what a full-size
 * blur read with sampleSmooth gives: sigma² plus a third of a source pixel².
 */
export function samplingLevel(sigma: number, width: number, height: number): SamplingLevel {
  let best: SamplingLevel = { level: 0, sigma }
  let w = width
  let h = height
  for (let k = 1; ; k++) {
    w = Math.max(1, Math.round(w / 2))
    h = Math.max(1, Math.round(h / 2))
    if (Math.min(w, h) < MIN_LEVEL_SIDE) break
    const s = levelSigma(sigma, k)
    if (s < MIN_LEVEL_SIGMA) break
    best = { level: k, sigma: s }
  }
  return best
}

/** The gaussian sigma, in texels of halving `level`, that gives a blur by sigma (source pixels) on that level. */
function levelSigma(sigma: number, level: number): number {
  if (level === 0) return sigma
  const area = 4 ** level
  // Tent halvings add 0.75 texel² of their input level each, the cubic read a third of a texel² of this level.
  const left = sigma * sigma + 1 / 3 - 0.25 * (area - 1) - area / 3
  return left > 0 ? Math.sqrt(left / area) : 0
}

/** A blur up to this many times wider than a halving level switch blends the two levels. */
const LEVEL_BLEND_SPAN = 1.25

export interface SamplingLevels extends SamplingLevel {
  /** Just past a switch to this level: the level before, with its sigma for this blur, and its share (0..1). */
  previous: (SamplingLevel & { share: number }) | null
}

/**
 * samplingLevel, and for blurs up to LEVEL_BLEND_SPAN times wider than the
 * switch to their level, the level before and its share, which falls from 1 at
 * the switch to 0 (smoothstep over log sigma). Near the frame edges the coarser
 * level's halvings carry the light past the edge a little differently, so a
 * blur growing past a switch would otherwise change the image in one step there.
 */
export function samplingLevels(sigma: number, width: number, height: number): SamplingLevels {
  const at = samplingLevel(sigma, width, height)
  const before = samplingLevel(sigma / LEVEL_BLEND_SPAN, width, height)
  if (before.level === at.level) return { ...at, previous: null }
  const area = 4 ** at.level
  const switchSigma = Math.sqrt(area * (MIN_LEVEL_SIGMA * MIN_LEVEL_SIGMA + 0.25 + 1 / 3) - 0.25 - 1 / 3)
  const x = Math.min(1, Math.max(0, Math.log(sigma / switchSigma) / Math.log(LEVEL_BLEND_SPAN)))
  const level = at.level - 1
  return { ...at, previous: { level, sigma: levelSigma(sigma, level), share: 1 - x * x * (3 - 2 * x) } }
}

/**
 * Separable gaussian, sigma in texels of the input; caller releases the
 * result. Paired bilinear taps come out a few tenths of a percent dark over a
 * chain of half-float passes, so blurs on halved levels read every tap exactly;
 * full-size blurs keep the paired taps they always had.
 */
export function blurLevel(gpu: Gpu, input: Target, sigma: number, exact: boolean): Target {
  const program = gpu.program(exact ? EXACT_GAUSSIAN_SHADER : GAUSSIAN_SHADER)
  const uSigma = Math.max(sigma, 0.01)
  const horizontal = gpu.acquire(input.width, input.height)
  gpu.draw(program, horizontal, { textures: { uSrc: input }, uniforms: { uDirection: [1, 0], uSigma } })
  const both = gpu.acquire(input.width, input.height)
  gpu.draw(program, both, { textures: { uSrc: horizontal }, uniforms: { uDirection: [0, 1], uSigma } })
  gpu.release(horizontal)
  return both
}

/** Halves a target with a [1, 3, 3, 1] tent per axis (sizes round); caller releases the result. */
export function halve(gpu: Gpu, src: Target): Target {
  const next = gpu.acquire(Math.max(1, Math.round(src.width / 2)), Math.max(1, Math.round(src.height / 2)))
  gpu.draw(gpu.program(TENT_HALVE_SHADER), next, { textures: { uSrc: src }, uniforms: { uDstSize: [next.width, next.height] } })
  return next
}

/** Sigma, in texels of a blur's edge level, at which it moves to the next level. */
const EDGE_LEVEL_TEXELS = 24
/** A blur up to this many times wider than an edge level switch blends the edges of both levels. */
const EDGE_BLEND_SPAN = 1.25

/**
 * Past the frame edges, a blur by sigma (source pixels) repeats the edge
 * texels of the coarsest halving on which it is at most 24 texels wide: the
 * edge look the scatter presets were tuned with.
 */
export function edgeLevel(sigma: number, width: number, height: number): number {
  let level = 0
  let w = width
  let h = height
  while (sigma / 2 ** level > EDGE_LEVEL_TEXELS && Math.min(w, h) > 8) {
    w = Math.max(1, Math.round(w / 2))
    h = Math.max(1, Math.round(h / 2))
    level++
  }
  return level
}

export interface EdgeLevels {
  level: number
  /** The level before the last switch: the same as `level` unless the blur has only just passed the switch. */
  previous: number
  /** How far the edges have gone from `previous` toward `level`, 0..1. */
  t: number
}

/**
 * The edge level of a blur by sigma and, for blurs up to EDGE_BLEND_SPAN times
 * wider than a switch to the next level, the level before and how far to blend
 * from its edges to the new level's (smoothstep over log sigma). Repeating
 * coarser edge texels changes the light near the frame edges, so a blur
 * growing past a switch would otherwise change the image in one step.
 */
export function edgeLevels(sigma: number, width: number, height: number): EdgeLevels {
  const level = edgeLevel(sigma, width, height)
  const previous = edgeLevel(sigma / EDGE_BLEND_SPAN, width, height)
  if (previous === level) return { level, previous, t: 1 }
  const x = Math.min(1, Math.max(0, Math.log(sigma / (EDGE_LEVEL_TEXELS * 2 ** (level - 1))) / Math.log(EDGE_BLEND_SPAN)))
  return { level, previous, t: x * x * (3 - 2 * x) }
}

/** A source extended past its edges and halved on demand, shared by the blurs of it that run on halved levels. */
export interface Halvings {
  /** The extended source halved k times (k up to the `levels` it was made for), [1, 3, 3, 1] tent per axis. */
  level(k: number): Target
  /** Maps the source's uv into the levels' uv: xy scale, zw offset. */
  readonly uvMap: readonly [number, number, number, number]
  /** Releases the extended source and its halvings; the source stays with the caller. */
  release(): void
}

/**
 * Extends a source by repeating its edge pixels, which is what a blur's
 * clamped taps see past the frame on the source itself, so blurs on further
 * halvings treat the edges the same way. Four texels of the coarsest level
 * are enough: beyond them the extension is constant outward and clamping
 * repeats it. The size rounds up so that `levels` halvings are exact.
 */
export function halvings(gpu: Gpu, source: Target, levels: number): Halvings {
  const step = 2 ** levels
  const pad = 4 * step
  const width = Math.ceil((source.width + 2 * pad) / step) * step
  const height = Math.ceil((source.height + 2 * pad) / step) * step
  const extended = gpu.acquire(width, height)
  gpu.draw(gpu.program(PAD_SHADER), extended, { textures: { uSrc: source }, uniforms: { uPad: [pad, pad] } })
  const chain = [extended]
  return {
    uvMap: [source.width / width, source.height / height, pad / width, pad / height],
    level(k) {
      while (chain.length <= k) chain.push(halve(gpu, chain[chain.length - 1]))
      return chain[k]
    },
    release() {
      for (const target of chain) gpu.release(target)
    },
  }
}
