import { CHUNK_LIBRARY, GLSL_HEADER } from './glsl'

/**
 * Tone curve. Colors whose largest channel is <= 1 pass through unchanged, so
 * a pack color at nominal intensity encodes to its exact hex. Above 1 the
 * color moves toward white: out = mix(c / m, white, 1 - exp(-(m - 1) k)) with
 * m the largest channel and k = Y / (1 - Y), Y the luminance of c / m. That k
 * makes luminance continuous in value and slope at m = 1, then it rises
 * toward 1 and levels off.
 */
export const TONE_CURVE_GLSL = /* glsl */ `
vec3 toneCurve(vec3 c) {
  c = max(c, vec3(0.0));
  float m = maxComponent(c);
  if (m <= 1.0) return c;
  vec3 h = c / m;
  float y = luminance(h);
  float k = y / max(1.0 - y, 1e-4);
  float s = 1.0 - exp(-(m - 1.0) * k);
  return mix(h, vec3(1.0), s);
}
`

const LUMA = [0.2126, 0.7152, 0.0722] as const

/** CPU twin of the GLSL tone curve, for tests and checks. */
export function toneCurve(rgb: readonly number[]): [number, number, number] {
  const c = [Math.max(0, rgb[0]), Math.max(0, rgb[1]), Math.max(0, rgb[2])]
  const m = Math.max(c[0], c[1], c[2])
  if (m <= 1) return [c[0], c[1], c[2]]
  const h = c.map((v) => v / m)
  const y = LUMA[0] * h[0] + LUMA[1] * h[1] + LUMA[2] * h[2]
  const k = y / Math.max(1 - y, 1e-4)
  const s = 1 - Math.exp(-(m - 1) * k)
  return [h[0] + (1 - h[0]) * s, h[1] + (1 - h[1]) * s, h[2] + (1 - h[2]) * s]
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
  vec3 sum = vec3(0.0);
  float weights = 0.0;
  for (int i = first; i <= last; i++) {
    float w = mitchell((float(i) + 0.5 - center) / f);
    sum += w * texelFetch(uSrc, ivec2(i, px.y), 0).rgb;
    weights += w;
  }
  fragColor = vec4(sum / weights, 1.0);
}
`

/**
 * Output filter at output size: vertical half of the resolve (when
 * supersampled), exact sRGB encode, grain, then TPDF dither of about +-1 LSB
 * and rounding to 8 bits. Grain and dither are keyed to output pixels.
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
uniform float uGrain;
uniform float uGrainSize;
uniform float uGrainChroma;
uniform bool uDither;
out vec4 fragColor;

vec3 resolveColumn(ivec2 local) {
  if (uFactor == 1) return texelFetch(uSrc, local, 0).rgb;
  float f = float(uFactor);
  float center = f * (float(local.y) + 0.5) + float(uApron);
  int first = int(ceil(center - 2.0 * f - 0.5));
  int last = int(floor(center + 2.0 * f - 0.5));
  vec3 sum = vec3(0.0);
  float weights = 0.0;
  for (int j = first; j <= last; j++) {
    float w = mitchell((float(j) + 0.5 - center) / f);
    sum += w * texelFetch(uSrc, ivec2(local.x, j), 0).rgb;
    weights += w;
  }
  return sum / weights;
}

// Unit-variance grain per channel: mono plus an optional per-channel share.
vec3 grainNoise(ivec2 px) {
  if (uGrainSize <= 1.0) {
    vec3 mono = gaussianNoise3(px, uSeed + 4241);
    vec3 chroma = gaussianNoise3(px, uSeed + 7919);
    vec3 g = mix(vec3(mono.x), chroma, uGrainChroma);
    return g / sqrt((1.0 - uGrainChroma) * (1.0 - uGrainChroma) + uGrainChroma * uGrainChroma);
  }
  // Gaussian splats on a lattice of uGrainSize px, normalized to unit variance at every pixel.
  vec2 q = (vec2(px) + 0.5) / uGrainSize;
  ivec2 cell = ivec2(floor(q));
  vec3 sum = vec3(0.0);
  float energy = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      ivec2 c = cell + ivec2(i, j);
      vec2 d = q - (vec2(c) + 0.5);
      float k = exp(-dot(d, d) / (2.0 * 0.6 * 0.6));
      vec3 mono = gaussianNoise3(c, uSeed + 4241);
      vec3 chroma = gaussianNoise3(c, uSeed + 7919);
      sum += k * mix(vec3(mono.x), chroma, uGrainChroma);
      energy += k * k;
    }
  }
  float spread = sqrt((1.0 - uGrainChroma) * (1.0 - uGrainChroma) + uGrainChroma * uGrainChroma);
  return sum / (sqrt(energy) * spread);
}

void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  vec3 display = saturate(resolveColumn(px - uTileOrigin));
  vec3 encoded = linearToSrgb(display);
  if (uGrain > 0.0) {
    float luma = dot(encoded, LUMA);
    float weight = mix(0.3, 1.0, saturate(4.0 * luma * (1.0 - luma)));
    encoded += uGrain * weight * grainNoise(px);
  }
  if (uDither) encoded += tpdfNoise3(px, uSeed + 9001) / 255.0;
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
