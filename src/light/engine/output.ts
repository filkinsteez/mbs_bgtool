import { CHUNK_LIBRARY, GLSL_HEADER } from './glsl'
import { GRAIN_GLSL } from './grain'

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
 * with w_i = (r_i + sum_j X_ij r_j) / (1 - r_i + 0.05). One overall rate k
 * keeps linear luminance continuous in value and slope at m = 1; the late
 * term has zero slope there and only closes the slowest channel far above
 * it, so every color ends at white.
 */
export const TONE_CROSSTALK = [
  [0, 0.8, 0.16],
  [0.15, 0, 0.3],
  [0.02, 0.15, 0],
] as const
const TONE_GAP_SOFTNESS = 0.05
const TONE_LATE_WHITENING = 0.005

const glslFloat = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v))
const crosstalkColumns = [0, 1, 2].map((j) => `vec3(${[0, 1, 2].map((i) => glslFloat(TONE_CROSSTALK[i][j])).join(', ')})`).join(', ')

export const TONE_CURVE_GLSL = /* glsl */ `
const mat3 TONE_CROSSTALK = mat3(${crosstalkColumns});

vec3 toneCurve(vec3 c) {
  c = max(c, vec3(0.0));
  float m = maxComponent(c);
  if (m <= 1.0) return c;
  vec3 r = c / m;
  vec3 gap = 1.0 - r;
  vec3 w = (r + TONE_CROSSTALK * r) / (gap + ${glslFloat(TONE_GAP_SOFTNESS)});
  float k = luminance(r) / max(dot(LUMA, gap * w), 1e-6);
  float x = m - 1.0;
  return saturate(1.0 - gap * exp(-k * x * w - ${glslFloat(TONE_LATE_WHITENING)} * x * x));
}
`

const LUMA = [0.2126, 0.7152, 0.0722] as const

/** CPU twin of the GLSL tone curve, for tests and checks. */
export function toneCurve(rgb: readonly number[]): [number, number, number] {
  const c = [Math.max(0, rgb[0]), Math.max(0, rgb[1]), Math.max(0, rgb[2])]
  const m = Math.max(c[0], c[1], c[2])
  if (m <= 1) return [c[0], c[1], c[2]]
  const r = c.map((v) => v / m)
  const gap = r.map((v) => 1 - v)
  const w = r.map((v, i) => (v + TONE_CROSSTALK[i][0] * r[0] + TONE_CROSSTALK[i][1] * r[1] + TONE_CROSSTALK[i][2] * r[2]) / (gap[i] + TONE_GAP_SOFTNESS))
  const slope = LUMA[0] * gap[0] * w[0] + LUMA[1] * gap[1] * w[1] + LUMA[2] * gap[2] * w[2]
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

/**
 * Output filter at output size: vertical half of the resolve (when
 * supersampled), exact sRGB encode, grain (mono, on Oklab L; see grain.ts),
 * then TPDF dither of about +-1 LSB and rounding to 8 bits. Grain and dither
 * are keyed to output pixels; grain sizes follow the short side.
 */
export const OUTPUT_SHADER =
  GLSL_HEADER +
  CHUNK_LIBRARY +
  MITCHELL_GLSL +
  /* glsl */ `
uniform sampler2D uSrc;
uniform ivec2 uTileOrigin;
uniform int uFactor;
uniform int uApron;
uniform int uSeed;
uniform bool uDither;
out vec4 fragColor;
` +
  GRAIN_GLSL +
  /* glsl */ `

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
  vec3 encoded = linearToSrgb(display);
  if (uGrainAmp > 0.0 && weight > 0.0) encoded = linearToSrgb(applyGrain(display, px, weight));
  if (uDither) encoded = dither(saturate(encoded), px);
  fragColor = vec4(floor(saturate(encoded) * 255.0 + 0.5) / 255.0, 1.0);
}
`

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
