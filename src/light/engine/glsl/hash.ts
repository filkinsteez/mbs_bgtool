// Integer hashes, so results are identical on every GPU for a given seed.
export const HASH_GLSL = /* glsl */ `
// Mark Jarzynski and Marc Olano, "Hash Functions for GPU Rendering" (2020).
uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  return v;
}

uint pcgHash(uint v) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

// [0, 1) with 24 bits.
float unitFromUint(uint v) { return float(v >> 8u) * (1.0 / 16777216.0); }
vec3 unitFromUint(uvec3 v) { return vec3(v >> 8u) * (1.0 / 16777216.0); }

uvec3 hashKey(ivec3 p) { return pcg3d(uvec3(p + 1048576)); }

float hash1(ivec3 p) { return unitFromUint(hashKey(p).x); }
vec2 hash2(ivec3 p) { return unitFromUint(hashKey(p)).xy; }
vec3 hash3(ivec3 p) { return unitFromUint(hashKey(p)); }

float hash1(ivec2 cell, int seed) { return hash1(ivec3(cell, seed)); }
vec2 hash2(ivec2 cell, int seed) { return hash2(ivec3(cell, seed)); }
vec3 hash3(ivec2 cell, int seed) { return hash3(ivec3(cell, seed)); }

// One value per (index, seed), e.g. per band or per glow.
float hashIndex(int index, int seed) { return hash1(ivec3(index, 7919, seed)); }
`
