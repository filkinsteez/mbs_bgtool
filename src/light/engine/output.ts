import type { OutputSettings, UniformMap } from '../scene'
import { activeFilters, OUTPUT_FILTERS, type FilterFrame, type OutputFilter } from './filters'
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
 * channels fills first: orange-red goes orange, yellow, pale yellow, white;
 * Meta Blue holds its hue, then turns pale cyan-white; pure blue drifts
 * toward cyan, not violet.
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
  return saturate(1.0 - gap * exp(-k * x * w - ${glslFloat(TONE_LATE_WHITENING)} * x * x));
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
  return [out[0], out[1], out[2]]
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

/** Every output pass the tool can draw with one filter at a time (and with none), for compiling ahead. */
export const OUTPUT_FILTER_SHADERS: readonly string[] = [buildOutputShader([]), ...OUTPUT_FILTERS.map((stage) => buildOutputShader([stage]))]

/** Samples per axis averaged into each texel of a filter's frame source. */
const SOURCE_SAMPLES = 4
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
    Object.assign(uniforms, stage.uniforms(output[stage.key], frame))
    if (!stage.source) continue
    const size = stage.source.size(frame)
    const width = Math.min(MAX_SOURCE_SIDE, Math.max(1, Math.round(size.width)))
    const height = Math.min(MAX_SOURCE_SIDE, Math.max(1, Math.round(size.height)))
    const samples = gpu.acquire(width * SOURCE_SAMPLES, height * SOURCE_SAMPLES)
    drawFrame(samples)
    const source = gpu.acquire(width, height)
    gpu.draw(gpu.program(AREA_RESAMPLE_SHADER), source, {
      textures: { uSrc: samples },
      uniforms: { uDstSize: [width, height], uTaps: SOURCE_SAMPLES },
    })
    gpu.release(samples)
    textures[stage.source.uniform] = source
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
