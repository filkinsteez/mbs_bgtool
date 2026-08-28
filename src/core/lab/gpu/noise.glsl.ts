export const GPU_NOISE_GLSL = /* glsl */ `
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float valueNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(cell), hash21(cell + vec2(1.0, 0.0)), u.x),
    mix(hash21(cell + vec2(0.0, 1.0)), hash21(cell + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float a = 0.5;
  float f = 1.0;
  float s = 0.0;
  for (int i = 0; i < 5; i++) {
    s += a * valueNoise(p * f);
    f *= 2.03;
    a *= 0.5;
  }
  return s;
}

vec2 domainWarp(vec2 p) {
  vec2 q = vec2(
    fbm(p + vec2(2.7, 8.3)),
    fbm(p + vec2(9.2, 1.6))
  );
  vec2 r = vec2(
    fbm(p + 3.0 * q + vec2(1.7, 9.2)),
    fbm(p + 3.0 * q + vec2(8.3, 2.8))
  );
  return p + (r - 0.5) * 2.0;
}

vec2 gradNoise(vec2 p) {
  float h = hash21(p) * 6.28318530718;
  return vec2(cos(h), sin(h));
}

vec2 curlNoise(vec2 p) {
  float e = 0.0016;
  float n1 = dot(gradNoise(p + vec2(e, 0.0)), vec2(1.0, 0.0));
  float n2 = dot(gradNoise(p - vec2(e, 0.0)), vec2(1.0, 0.0));
  float n3 = dot(gradNoise(p + vec2(0.0, e)), vec2(0.0, 1.0));
  float n4 = dot(gradNoise(p - vec2(0.0, e)), vec2(0.0, 1.0));
  float dx = (n1 - n2) / (2.0 * e);
  float dy = (n3 - n4) / (2.0 * e);
  return vec2(dy, -dx);
}

vec2 loopNoiseOffset(float phase, float energy) {
  float theta = phase * 6.28318530718;
  return vec2(cos(theta), sin(theta)) * (0.35 + 0.65 * energy);
}
`
