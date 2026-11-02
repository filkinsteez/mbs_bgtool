// 2D signed distances (negative inside). Several follow Inigo Quilez's formulas.
export const SDF_GLSL = /* glsl */ `
float sdCircle(vec2 p, vec2 center, float radius) { return length(p - center) - radius; }

float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-12), 0.0, 1.0);
  return length(pa - ba * h);
}

// Position along the segment a -> b, clamped to 0..1.
float segmentParam(vec2 p, vec2 a, vec2 b) {
  vec2 ba = b - a;
  return clamp(dot(p - a, ba) / max(dot(ba, ba), 1e-12), 0.0, 1.0);
}

// Distance to a circular arc around c with radius r from angle a0 to a1 (radians, a0 < a1).
float sdArc(vec2 p, vec2 c, float r, float a0, float a1) {
  vec2 q = p - c;
  float mid = 0.5 * (a0 + a1);
  float halfSpan = 0.5 * (a1 - a0);
  float rel = mod(atan(q.y, q.x) - mid + PI, TAU) - PI;
  if (abs(rel) <= halfSpan) return abs(length(q) - r);
  vec2 e0 = c + r * vec2(cos(a0), sin(a0));
  vec2 e1 = c + r * vec2(cos(a1), sin(a1));
  return min(length(p - e0), length(p - e1));
}

float sdBox(vec2 p, vec2 center, vec2 halfSize) {
  vec2 d = abs(p - center) - halfSize;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float sdRoundedBox(vec2 p, vec2 center, vec2 halfSize, float radius) {
  return sdBox(p, center, halfSize - radius) - radius;
}

float sdTriangle(vec2 p, vec2 p0, vec2 p1, vec2 p2) {
  vec2 e0 = p1 - p0;
  vec2 e1 = p2 - p1;
  vec2 e2 = p0 - p2;
  vec2 v0 = p - p0;
  vec2 v1 = p - p1;
  vec2 v2 = p - p2;
  vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
  vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
  vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)),
                   vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
                   vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}

// Convex or concave quad, vertices in order.
float sdQuad(vec2 p, vec2 v0, vec2 v1, vec2 v2, vec2 v3) {
  vec2 v[4] = vec2[4](v0, v1, v2, v3);
  float d = dot(p - v[0], p - v[0]);
  float s = 1.0;
  for (int i = 0, j = 3; i < 4; j = i, i++) {
    vec2 e = v[j] - v[i];
    vec2 w = p - v[i];
    vec2 b = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
    d = min(d, dot(b, b));
    bvec3 c = bvec3(p.y >= v[i].y, p.y < v[j].y, e.x * w.y > e.y * w.x);
    if (all(c) || all(not(c))) s *= -1.0;
  }
  return s * sqrt(d);
}

// The triangle a, b, c grown by radius, which rounds its corners.
float sdRoundedTriangle(vec2 p, vec2 a, vec2 b, vec2 c, float radius) {
  return sdTriangle(p, a, b, c) - radius;
}

// Polynomial smooth minimum; k is the blend width.
float smin(float a, float b, float k) {
  if (k <= 0.0) return min(a, b);
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

float smax(float a, float b, float k) { return -smin(-a, -b, k); }
`
