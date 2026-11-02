export const DITHER_GLSL = /* glsl */ `
// Jorge Jimenez, "Next Generation Post Processing in Call of Duty: Advanced Warfare" (2014). [0, 1).
float interleavedGradientNoise(vec2 pixel) {
  return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
}

// Triangular-PDF noise in [-1, 1], independent per channel.
vec3 tpdfNoise3(ivec2 pixel, int seed) {
  uvec3 a = hashKey(ivec3(pixel, seed));
  uvec3 b = pcg3d(a ^ uvec3(0x9E3779B9u, 0x85EBCA6Bu, 0xC2B2AE35u));
  return unitFromUint(a) + unitFromUint(b) - 1.0;
}

// Approximately standard normal per channel (sum of four uniforms).
vec3 gaussianNoise3(ivec2 pixel, int seed) {
  uvec3 a = hashKey(ivec3(pixel, seed));
  uvec3 b = pcg3d(a ^ uvec3(0x9E3779B9u));
  uvec3 c = pcg3d(b ^ uvec3(0x85EBCA6Bu));
  uvec3 d = pcg3d(c ^ uvec3(0xC2B2AE35u));
  vec3 sum = unitFromUint(a) + unitFromUint(b) + unitFromUint(c) + unitFromUint(d);
  return (sum - 2.0) * 1.7320508;
}
`
