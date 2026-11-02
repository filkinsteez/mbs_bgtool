export const NOISE_GLSL = /* glsl */ `
vec2 quintic(vec2 f) { return f * f * f * (f * (f * 6.0 - 15.0) + 10.0); }

// Value noise in [-1, 1].
float valueNoise(vec2 p, int seed) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = quintic(f);
  ivec2 c = ivec2(i);
  float a = hash1(c, seed);
  float b = hash1(c + ivec2(1, 0), seed);
  float d = hash1(c + ivec2(0, 1), seed);
  float e = hash1(c + ivec2(1, 1), seed);
  return mix(mix(a, b, u.x), mix(d, e, u.x), u.y) * 2.0 - 1.0;
}

vec2 latticeGradient(ivec2 c, int seed) {
  float a = hash1(c, seed) * TAU;
  return vec2(cos(a), sin(a));
}

// Gradient (Perlin) noise, roughly in [-1, 1].
float gradientNoise(vec2 p, int seed) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = quintic(f);
  ivec2 c = ivec2(i);
  float n00 = dot(latticeGradient(c, seed), f);
  float n10 = dot(latticeGradient(c + ivec2(1, 0), seed), f - vec2(1.0, 0.0));
  float n01 = dot(latticeGradient(c + ivec2(0, 1), seed), f - vec2(0.0, 1.0));
  float n11 = dot(latticeGradient(c + ivec2(1, 1), seed), f - vec2(1.0, 1.0));
  return 1.41421356 * mix(mix(n00, n10, u.x), mix(n01, n11, u.x), u.y);
}

// Fractal sum of gradient noise, normalized to roughly [-1, 1]. At most 8 octaves.
float fbm(vec2 p, int octaves, float lacunarity, float gain, int seed) {
  float sum = 0.0;
  float amplitude = 1.0;
  float norm = 0.0;
  const mat2 turn = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    sum += amplitude * gradientNoise(p, seed + i * 131);
    norm += amplitude;
    p = turn * p * lacunarity + vec2(17.31, 9.17);
    amplitude *= gain;
  }
  return sum / max(norm, 1e-6);
}

float fbm(vec2 p, int octaves, int seed) { return fbm(p, octaves, 2.0, 0.5, seed); }

// Offsets p by low-frequency noise: amount in the units of p, frequency in cycles per unit.
vec2 domainWarp(vec2 p, float amount, float frequency, int octaves, int seed) {
  vec2 q = p * frequency;
  vec2 offset = vec2(fbm(q, octaves, seed), fbm(q + vec2(31.7, 11.3), octaves, seed + 17));
  return p + amount * offset;
}
`
