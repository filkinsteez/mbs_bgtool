// Stateless integer hash noise (ports directly to a GLSL hash function).

export function hash2(x, y, seed) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Box-Muller: two uniforms to two unit gaussians.
export function gaussPair(u1, u2, out) {
  const r = Math.sqrt(-2 * Math.log(Math.max(1e-7, u1)));
  out[0] = r * Math.cos(2 * Math.PI * u2);
  out[1] = r * Math.sin(2 * Math.PI * u2);
  return out;
}
