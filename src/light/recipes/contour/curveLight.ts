import type { ParamSpec, RecipeContext, ScatterBlur } from '../../scene'
import {
  circularArc,
  contourLength,
  metaLogo,
  metaLogoEdge,
  primitiveLength,
  primitivePoint,
  primitiveTangent,
  ring,
  roundedCorner,
  sCurve,
  signedArea,
  splitArcs,
  straightEdge,
  transformShape,
  windingNumber,
  type Contour,
  type Primitive,
  type Shape,
  type Vec2,
} from './shapes'

/**
 * Contour light: a thin emitter along the contours of a shape, seen through a
 * point-spread function (PSF). Light from every point of the emitter adds up,
 * so where two parts of a shape come close their light sums smoothly; nothing
 * here depends on the distance to the nearest edge except the antialiased edge
 * of a side mask.
 *
 * Near parts (core and glows) are the 2D kernel K(r) = (1 + r^2 / (2 p s^2))^-(p + 1/2)
 * integrated along each segment and arc in closed form, so they stay sharp at
 * any size. Across an infinite straight emitter a near part falls off as
 * (1 + h^2 / (2 p s^2))^-p and peaks at its weight (p = 1 is a long
 * inverse-square tail, 8 is close to a gaussian of sigma s).
 *
 * Far parts (haze, light scattered into a face or a sky) are the same emitter
 * blurred by the engine's scatter pass at four widths r0 * 2.5^i; a far part of
 * width s mixes the two blurs around s per channel, normalized so it also peaks
 * at its weight across a straight emitter.
 *
 * Parts can be limited to the inside or outside of the shape. Per-channel widths
 * and offsets split the colors. Two light fields, evaluated at the pixel, set
 * brightness and width along the curve.
 */

export interface CurveLightLayout {
  emitters: number
  /** Primitive slots per emitter (arcs are split into pieces of at most 45°). */
  primitives: number
  /** Analytic parts per emitter. */
  near: number
  /** Scattered parts per emitter. */
  far: number
}

export const MAX_KERNEL_POWER = 8
export const FAR_RUNGS = 4
export const FAR_STEP = 2.5

const PRIM_VEC4 = 4
const NEAR_VEC4 = 6
const FAR_VEC4 = 5
const EMIT_VEC4 = 5
/** Linear luminance, with the shader's weights (LUMA). */
const luminanceOf = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
/** Lights that light the air of the frame from outside the curves (most often from outside the frame). */
export const AIR_GLOWS = 3
const ARC_PIECE = Math.PI / 4
/** Primitives per bounding box; layouts use a multiple of it. */
const CHUNK = 4
/** Side mask softness the shader never goes below (half a pixel) for frames down to about 64 px on the short side. */
const MIN_MASK_SOFT = 0.008

function binomial(n: number, k: number): number {
  let r = 1
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i
  return r
}

/**
 * Coefficients a_k of N_p(z) = z * sum_k a_k z^(2k): the integral of (1 - t^2)^(p - 1)
 * from 0 to z, normalized so N_p(1) = 1.
 */
export function kernelCoefficients(p: number): number[] {
  const out: number[] = []
  for (let k = 0; k < p; k++) out.push((binomial(p - 1, k) * (k % 2 ? -1 : 1)) / (2 * k + 1))
  const total = out.reduce((a, b) => a + b, 0)
  return out.map((v) => v / total)
}

/** Integral of (1 + t^2)^-p over the real line: pi (2p - 3)!! / (2p - 2)!!. */
export function kernelFullConstant(p: number): number {
  let num = 1
  let den = 1
  for (let k = 1; k <= 2 * p - 3; k += 2) num *= k
  for (let k = 2; k <= 2 * p - 2; k += 2) den *= k
  return (Math.PI * num) / den
}

/** Integral of (1 + t^2)^-(p + 1/2) over the real line: 2 (2p - 2)!! / (2p - 1)!!. */
export function kernelLineConstant(p: number): number {
  let num = 1
  let den = 1
  for (let k = 1; k < p; k++) num *= 2 * k
  for (let k = 1; k <= 2 * p - 1; k += 2) den *= k
  return (2 * num) / den
}

const literal = (v: number) => {
  const s = v.toPrecision(12)
  return s.includes('.') || s.includes('e') ? s : `${s}.0`
}

/** N_p and x^p with the integer p written out: loops with a uniform trip count are slow on some GPUs. */
function polynomialsGlsl(): string {
  const cases = Array.from({ length: MAX_KERNEL_POWER - 1 }, (_, i) => {
    const p = i + 2
    const a = kernelCoefficients(p)
    let horner = literal(a[a.length - 1])
    for (let k = a.length - 2; k >= 0; k--) horner = `${literal(a[k])} + z2 * (${horner})`
    return `  if (p == ${p}) return z * (${horner});`
  }).join('\n')
  const full = Array.from({ length: MAX_KERNEL_POWER - 1 }, (_, i) => `  if (p == ${i + 2}) return ${literal(kernelFullConstant(i + 2))};`).join('\n')
  return /* glsl */ `
// The kernel's integral over a whole line in units of its width: (1 + t^2)^-p over the real line.
float clFull(int p) {
${full}
  return 1.0;
}

// Normalized antiderivative of the kernel along a line: odd, N_p(+-1) = +-1, z = x / sqrt(x^2 + c^2).
vec3 clN(vec3 z, int p) {
  if (p <= 1) return z;
  vec3 z2 = z * z;
${cases}
  return z;
}

vec3 clPow(vec3 x, int p) {
  if (p <= 1) return x;
  vec3 x2 = x * x;
  if (p == 2) return x2;
  if (p == 3) return x2 * x;
  vec3 x4 = x2 * x2;
  if (p == 4) return x4;
  if (p == 5) return x4 * x;
  if (p == 6) return x4 * x2;
  if (p == 7) return x4 * x2 * x;
  return x4 * x4;
}
`
}

function nearGlsl(layout: CurveLightLayout): string {
  const parts = Array.from({ length: layout.near }, (_, k) => k)
  const declare = parts
    .map((k) => `  vec3 s2p${k}, offs${k}, amp${k}, acc${k} = vec3(0.0); float lit${k}, cut${k}, bp${k}; int p${k};
  clNearSetup(nb + ${k * NEAR_VEC4}, sd, light1, light2, s2p${k}, offs${k}, amp${k}, lit${k}, cut${k}, p${k}, bp${k});`)
    .join('\n')
  const maxCut = parts.reduce((expr, k) => (expr ? `max(${expr}, cut${k})` : `cut${k}`), '')
  const segment = parts
    .map(
      (k) => `        if (dist < cut${k}) {
          vec3 at${k};
          vec3 lit${k}s = clSegmentLit(u, h, l, offs${k}, s2p${k}, p${k}, at${k});
          acc${k} += mix(e0, e1, at${k}) * lit${k}s;
        }`,
    )
    .join('\n')
  const arcs = parts
    .map((k) => `        if (radial < cut${k}) acc${k} += em * clArc(r, psiM, halfSweep, max(vec3(1e-6), g.z - toInside * offs${k}), s2p${k}, p${k}, bp${k});`)
    .join('\n')
  const total = parts.map((k) => `clPale(e, amp${k} * lit${k} * acc${k}, uClNear[nb + ${k * NEAR_VEC4 + 5}].z)`).join(' + ')
  return /* glsl */ `
// Near parts of emitter e, written out per part so their sums stay in registers.
vec3 clNear(int e, vec2 q, float light1, float light2, float sd) {
  int nb = e * CL_N * ${NEAR_VEC4};
${declare}
  float maxCut = ${maxCut};
  if (maxCut < 0.0) return vec3(0.0);
  int count = int(uClEmit[e * ${EMIT_VEC4}].z + 0.5);
  for (int chunk = 0; chunk < CL_CHUNKS; chunk++) {
    if (chunk * ${CHUNK} >= count) break;
    if (clBoxDistance(q, uClChunk[e * CL_CHUNKS + chunk]) > maxCut) continue;
  for (int j = 0; j < ${CHUNK}; j++) {
    int i = chunk * ${CHUNK} + j;
    if (i >= count) break;
    int base = (e * CL_P + i) * ${PRIM_VEC4};
    vec4 g = uClPrim[base];
    vec4 m = uClPrim[base + 1];
    int kind = int(m.x + 0.5);
    if (kind == 3) continue;
    vec2 rel = q - g.xy;
    if (kind == 1) {
      float l = max(m.w, 1e-9);
      vec2 d = (g.zw - g.xy) / l;
      float u = dot(rel, d);
      float dist = length(rel - d * clamp(u, 0.0, l));
      if (dist > maxCut) continue;
      float h = (d.x * rel.y - d.y * rel.x) * m.z;
      vec3 e0 = uClPrim[base + 2].rgb;
      vec3 e1 = uClPrim[base + 3].rgb;
${segment}
    } else {
      float r = length(rel);
      float radial = abs(r - g.z);
      if (radial > maxCut) continue;
      float halfSweep = 0.5 * abs(m.y);
      float psiM = clWrap(g.w + 0.5 * m.y - atan(rel.y, rel.x));
      vec3 em = mix(uClPrim[base + 2].rgb, uClPrim[base + 3].rgb, clamp(0.5 - psiM * sign(m.y) / max(abs(m.y), 1e-6), 0.0, 1.0));
      // Offsets move the emitter toward the inside; for a positive sweep the left side faces the center.
      float toInside = m.z * sign(m.y);
${arcs}
    }
  }
  }
  return ${total};
}
`
}

export function curveLightGlsl(layout: CurveLightLayout): string {
  return /* glsl */ `
#define CL_E ${layout.emitters}
#define CL_P ${layout.primitives}
#define CL_N ${layout.near}
#define CL_F ${layout.far}
#define CL_CHUNKS ${Math.ceil(layout.primitives / CHUNK)}
#define CL_AIR ${AIR_GLOWS}
#define CL_FLOOR 5e-5

// Per primitive: (ax, ay, bx, by) or (cx, cy, radius, start); (kind, sweep, inside side, length);
// emission at the start (rgb); emission at the end (rgb). Kind 1 segment, 2 arc, 3 mask-only segment.
uniform vec4 uClPrim[CL_E * CL_P * ${PRIM_VEC4}];
// Bounding box (min x, min y, max x, max y) of each run of ${CHUNK} primitives.
uniform vec4 uClChunk[CL_E * CL_CHUNKS];
// Per near part: (weight, sigma, p, side); (tint, offset); (channel widths, light); (channel offsets, light gamma);
// (grow light, grow gain, grow gamma, B_p); (mask inset, mask softness, share in the pale color, brightest emission
// channel).
uniform vec4 uClNear[CL_E * CL_N * ${NEAR_VEC4}];
// Per far part: (weight, sigma, side, light); (tint, light gamma); (channel widths, grow light);
// (grow gain, grow gamma, mask inset, mask softness); (share in the pale color, 0, 0, 0).
uniform vec4 uClFar[CL_E * CL_F * ${FAR_VEC4}];
// Per emitter: (anchor u, anchor v, primitive count, any side mask); (mask shift x, y, mask grow, reach);
// (emission rgb for scattered light from its own aux channel, ray direction); (drift ratios rgb, drift knee);
// (drift sharpness, pale color rgb at unit luminance).
uniform vec4 uClEmit[CL_E * ${EMIT_VEC4}];
// Two light fields: (kind, x, y, radius); (length, power, stretch, angle). Positions are relative to emitter 1's anchor.
uniform vec4 uClLight[4];
// Per air glow: (segment ends, frame 0..1); (color at its light's own level, level); (drift ratios, drift knee);
// (falloff, drift sharpness, power, 0): the glow is clAirGlow to the power.
uniform vec4 uClAir[CL_AIR * 4];
uniform vec3 uClBase;
// Blur widths of the four scatter rungs.
uniform vec4 uClRungs;

const vec4 CL_GL_X = vec4(-0.8611363115940526, -0.3399810435848563, 0.3399810435848563, 0.8611363115940526);
const vec4 CL_GL_W = vec4(0.3478548451374538, 0.6521451548625461, 0.6521451548625461, 0.3478548451374538);

vec2 clAnchor(int e) { return (uClEmit[e * ${EMIT_VEC4}].xy - 0.5) * uFrameAspect; }

float clWrap(float a) { return a - TAU * floor((a + PI) / TAU); }
// Distance from q to a box (min x, min y, max x, max y); 0 inside it.
float clBoxDistance(vec2 q, vec4 box) { return length(max(max(box.xy - q, q - box.zw), 0.0)); }

float clLightField(int i, vec2 q) {
  vec4 a = uClLight[2 * i];
  vec4 b = uClLight[2 * i + 1];
  int kind = int(a.x + 0.5);
  if (kind == 0) return 1.0;
  vec2 pos = a.yz;
  float r0 = max(a.w, 1e-6);
  vec2 dir = vec2(cos(b.w), sin(b.w));
  if (kind == 4) {
    float d = dot(pos - q, dir);
    return d <= 0.0 ? 1.0 : exp(-(sqrt(r0 * r0 + d * d) - r0) / max(b.x, 1e-6));
  }
  vec2 dq = q - pos;
  // Directional flat top: full at pos, falling over r0 ahead (along dir), over r0 * length behind and over
  // r0 * stretch across; the power sets the shoulder. Its slope is zero at pos, so the switch between ahead and
  // behind has no crease.
  if (kind == 6) {
    float u = dot(dq, dir);
    float su = u / (r0 * (u >= 0.0 ? 1.0 : max(b.x, 0.05)));
    float sv = dot(dq, vec2(-dir.y, dir.x)) / (r0 * max(b.z, 0.05));
    return exp(-pow(su * su + sv * sv, 0.5 * max(b.y, 2.0)));
  }
  float u = dot(dq, dir) / max(b.z, 1e-6);
  float v = dot(dq, vec2(-dir.y, dir.x));
  float r2 = u * u + v * v;
  if (kind == 1) return exp(-0.5 * r2 / (r0 * r0));
  if (kind == 2) return exp(-(sqrt(r0 * r0 + r2) - r0) / max(b.x, 1e-6));
  // Flat top, exp(-(r / r0)^power): near full out to about r0, then a rounded shoulder and a short fall.
  if (kind == 5) return exp(-pow(r2 / (r0 * r0), 0.5 * max(b.y, 2.0)));
  return pow(1.0 + r2 / (r0 * r0), -0.5 * b.y);
}
${polynomialsGlsl()}
// Straight segment of length l; u along it from its start, h across (positive on the inside).
vec3 clSegment(float u, float h, float l, vec3 offs, vec3 s2p, int p) {
  vec3 hc = h - offs;
  vec3 c2 = hc * hc + s2p;
  float x0 = -u;
  float x1 = l - u;
  vec3 z0 = x0 * inversesqrt(x0 * x0 + c2);
  vec3 z1 = x1 * inversesqrt(x1 * x1 + c2);
  return clPow(s2p / c2, p) * 0.5 * (clN(z1, p) - clN(z0, p));
}

// clSegment, and where along the segment (0 at its start, 1 at its end) the light reaching the pixel comes from on
// average: the kernel's first moment over its integral. A color that changes along the segment reaches the pixel as
// the sum of its light, so it blends over a longer stretch the farther the pixel is from the line, instead of
// taking the color of the nearest point (which drew straight color edges out from the line).
vec3 clSegmentLit(float u, float h, float l, vec3 offs, vec3 s2p, int p, out vec3 at) {
  vec3 hc = h - offs;
  vec3 c2 = hc * hc + s2p;
  float x0 = -u;
  float x1 = l - u;
  vec3 z0 = x0 * inversesqrt(x0 * x0 + c2);
  vec3 z1 = x1 * inversesqrt(x1 * x1 + c2);
  vec3 dN = clN(z1, p) - clN(z0, p);
  at = vec3(clamp(u / l, 0.0, 1.0));
  if (p >= 2) {
    vec3 moment = sqrt(c2) * (clPow(1.0 - z0 * z0, p - 1) - clPow(1.0 - z1 * z1, p - 1)) / (float(p - 1) * clFull(p));
    at = mix(at, clamp((u + moment / max(dN, vec3(1e-6))) / l, 0.0, 1.0), step(vec3(1e-6), dN));
  }
  return clPow(s2p / c2, p) * 0.5 * dN;
}

// Arc piece of radius Rc seen from distance r to its center; psiM is the piece's middle angle relative to the
// pixel's angle. Narrow kernels use the chordal coordinate x = X sin(psi / 2), wide ones Gauss-Legendre
// quadrature over psi; they blend for c / X between 0.25 and 0.4.
vec3 clArc(float r, float psiM, float halfSweep, vec3 Rc, vec3 s2p, int p, float Bp) {
  r = max(r, 1e-6);
  vec3 h = r - Rc;
  vec3 c2 = h * h + s2p;
  vec3 invC = inversesqrt(c2);
  vec3 X = 2.0 * sqrt(r * Rc);
  vec3 blend = smoothstep(0.25, 0.4, 1.0 / (invC * X));
  vec3 amp = clPow(s2p / c2, p);
  vec3 result = vec3(0.0);
  if (any(lessThan(blend, vec3(1.0)))) {
    float a0 = max(-PI, psiM - halfSweep);
    float a1 = min(PI, psiM + halfSweep);
    vec3 x0 = X * sin(0.5 * a0);
    vec3 x1 = X * sin(0.5 * a1);
    vec3 xr = clamp(vec3(0.0), x0, x1);
    vec3 J = min(vec3(4.0), inversesqrt(max(vec3(1e-6), 1.0 - xr * xr / (X * X))));
    vec3 z0 = x0 * inversesqrt(x0 * x0 + c2);
    vec3 z1 = x1 * inversesqrt(x1 * x1 + c2);
    result += (1.0 - blend) * amp * (2.0 * Rc / X) * J * 0.5 * (clN(z1, p) - clN(z0, p));
  }
  if (any(greaterThan(blend, vec3(0.0)))) {
    vec3 sum = vec3(0.0);
    vec3 ratio = X * X / c2;
    for (int i = 0; i < 4; i++) {
      float sn = sin(0.5 * (psiM + halfSweep * CL_GL_X[i]));
      vec3 y = 1.0 / (1.0 + ratio * sn * sn);
      sum += CL_GL_W[i] * clPow(y, p) * sqrt(y);
    }
    result += blend * amp * Rc * invC / Bp * halfSweep * sum;
  }
  return result;
}

// Distance from q to a primitive (also mask-only ones), or best when it cannot be closer than best.
float clPrimDistance(int base, vec2 q, float best) {
  vec4 g = uClPrim[base];
  vec4 m = uClPrim[base + 1];
  if (int(m.x + 0.5) == 2) {
    vec2 d = q - g.xy;
    if (abs(length(d) - g.z) >= best) return best;
    float rel = clWrap((atan(d.y, d.x) - g.w) * sign(m.y) - 0.5 * abs(m.y));
    if (abs(rel) <= 0.5 * abs(m.y)) return abs(length(d) - g.z);
    vec2 a = g.xy + g.z * vec2(cos(g.w), sin(g.w));
    vec2 b = g.xy + g.z * vec2(cos(g.w + m.y), sin(g.w + m.y));
    return min(length(q - a), length(q - b));
  }
  vec2 ab = g.zw - g.xy;
  float f = clamp(dot(q - g.xy, ab) / max(dot(ab, ab), 1e-12), 0.0, 1.0);
  return length(q - g.xy - ab * f);
}

// Crossing of the ray from q toward +x (toward = 1) or -x (toward = -1) with an arc piece whose y only rises or
// only falls (angles a < b at heights ya, yb; dir +1 when the path runs from a to b). Like a segment: the lower
// end counts, the upper not. A ray toward -x counts each crossing with the opposite sign (same winding number).
float clArcPieceWinding(vec4 g, float a, float b, float ya, float yb, float dir, vec2 q, float toward) {
  if (q.y < min(ya, yb) || q.y >= max(ya, yb)) return 0.0;
  float dy = q.y - g.y;
  float x = g.x + sign(cos(0.5 * (a + b))) * sqrt(max(g.z * g.z - dy * dy, 0.0));
  if ((x - q.x) * toward <= 0.0) return 0.0;
  return (yb > ya ? 1.0 : -1.0) * dir * toward;
}

// Winding number contribution of the ray from q toward +x or -x. Arcs are split where their circle turns in y,
// so every piece is crossed at most once, and their ends use the stored heights their neighbors share, so a row
// through a shared end counts it once (angle comparisons rounded badly near the top and bottom of a circle and
// left single rows with inside and outside swapped).
float clPrimWinding(int base, vec2 q, float toward) {
  vec4 g = uClPrim[base];
  vec4 m = uClPrim[base + 1];
  if (int(m.x + 0.5) == 2) {
    if (abs(q.y - g.y) > g.z) return 0.0;
    float yStart = uClPrim[base + 2].w;
    float yEnd = uClPrim[base + 3].w;
    float lo = min(g.w, g.w + m.y);
    float hi = max(g.w, g.w + m.y);
    float k = ceil((lo - 0.5 * PI) / PI);
    float turn = 0.5 * PI + k * PI;
    bool turns = turn > lo && turn < hi;
    // sin(turn) is +1 or -1; the arc's heights run from its ends to there. Rows outside them never cross it.
    float yTurn = g.y + g.z * (mod(k, 2.0) < 0.5 ? 1.0 : -1.0);
    float yMin = turns ? min(min(yStart, yEnd), yTurn) : min(yStart, yEnd);
    float yMax = turns ? max(max(yStart, yEnd), yTurn) : max(yStart, yEnd);
    if (q.y < yMin || q.y > yMax) return 0.0;
    float yLo = m.y > 0.0 ? yStart : yEnd;
    float yHi = m.y > 0.0 ? yEnd : yStart;
    float dir = m.y > 0.0 ? 1.0 : -1.0;
    if (turns) return clArcPieceWinding(g, lo, turn, yLo, yTurn, dir, q, toward) + clArcPieceWinding(g, turn, hi, yTurn, yHi, dir, q, toward);
    return clArcPieceWinding(g, lo, hi, yLo, yHi, dir, q, toward);
  }
  vec2 a = g.xy;
  vec2 b = g.zw;
  if (min(a.y, b.y) > q.y || max(a.y, b.y) < q.y) return 0.0;
  // side > 0: an upward edge lies toward +x of q, a downward one toward -x.
  float side = ((b.x - a.x) * (q.y - a.y) - (q.x - a.x) * (b.y - a.y)) * toward;
  if (a.y <= q.y) return (b.y > q.y && side > 0.0) ? toward : 0.0;
  return (b.y <= q.y && side < 0.0) ? -toward : 0.0;
}

// Signed distance to the emitter's shape (negative inside, nonzero winding), capped at the distance where the side masks saturate.
float clMaskDistance(int e, vec2 q) {
  int count = int(uClEmit[e * ${EMIT_VEC4}].z + 0.5);
  float dist = max(uClEmit[e * ${EMIT_VEC4} + 1].w, 1e-4);
  // The inside test casts its ray toward whichever side of the frame has fewer pieces of the shape.
  float toward = uClEmit[e * ${EMIT_VEC4} + 2].w < 0.0 ? -1.0 : 1.0;
  float winding = 0.0;
  for (int chunk = 0; chunk < CL_CHUNKS; chunk++) {
    if (chunk * ${CHUNK} >= count) break;
    vec4 bound = uClChunk[e * CL_CHUNKS + chunk];
    bool crosses = q.y >= bound.y && q.y <= bound.w && (toward > 0.0 ? bound.z > q.x : bound.x < q.x);
    bool near = clBoxDistance(q, bound) < dist;
    if (!crosses && !near) continue;
    for (int j = 0; j < ${CHUNK}; j++) {
      int i = chunk * ${CHUNK} + j;
      if (i >= count) break;
      int base = (e * CL_P + i) * ${PRIM_VEC4};
      if (crosses) winding += clPrimWinding(base, q, toward);
      if (near) dist = min(dist, clPrimDistance(base, q, dist));
    }
  }
  return abs(winding) > 0.5 ? -dist : dist;
}

float clSideMask(int side, float sd, float inset, float soft) {
  if (side == 0) return 1.0;
  soft = max(soft, 0.5 * uPixel);
  return side == 1 ? softStep(-sd - inset, soft) : softStep(sd - inset, soft);
}

float clLit(int li, float light1, float light2, float gamma) {
  if (li == 0) return 1.0;
  float lit = li == 1 ? light1 : light2;
  return gamma > 0.0 ? pow(lit, gamma) : lit;
}

// An emitter's light as it dims: v is its summed level at the pixel against the emitter's own color (1 is the
// light at its own hex). The largest channel follows v; the others move from the light's own ratios toward d.rgb
// times them as s falls from 1, with s = v^a (1 + k^a) / (v^a + k^a) (knee k = d.w, sharpness a). Off when k is 0.
// Another color on the same emitter (a ring's second color) keeps its own largest channel too: where the drift
// raises a channel above the light's largest, the light is scaled back down. Only down, and only where the light is
// positive: a dim pixel a little below zero has no largest channel to keep.
vec3 clDrift(vec3 raw, vec3 own, vec4 d, float sharpness) {
  if (d.w <= 0.0) return raw;
  float top = maxComponent(raw);
  float v = top / max(maxComponent(own), 1e-6);
  float va = pow(max(v, 1e-12), sharpness);
  float ka = pow(d.w, sharpness);
  float s = min(1.0, va * (1.0 + ka) / (va + ka));
  vec3 drifted = raw * mix(d.rgb, vec3(1.0), s);
  float peak = maxComponent(drifted);
  return top > 0.0 && peak > top ? drifted * (top / peak) : drifted;
}

// A part's light moved by share m into the emitter's pale color at the same luminance (a light whose pale side takes
// another pack color).
vec3 clPale(int e, vec3 c, float m) {
  if (m <= 0.0) return c;
  return mix(c, uClEmit[e * ${EMIT_VEC4} + 4].yzw * luminance(c), m);
}

// The mean over a segment from a to b of c^2 / (r^2 + c^2): the light of every point of the segment, each seen
// through haze that halves it at distance c.
float clAirGlow(vec2 p, vec2 a, vec2 b, float c) {
  vec2 q = p - a;
  vec2 d = b - a;
  float len = length(d);
  float c2 = c * c;
  if (len < 1e-4) return c2 / (dot(q, q) + c2);
  float t = dot(q, d) / len;
  float k = sqrt(max(dot(q, q) - t * t, 0.0) + c2);
  return c2 / (len * k) * (atan((len - t) / k) + atan(t / k));
}

void clNearSetup(int cb, float sd, float light1, float light2,
                 out vec3 s2p, out vec3 offs, out vec3 amp, out float lit, out float cut, out int p, out float bp) {
  vec4 c0 = uClNear[cb];
  vec4 c1 = uClNear[cb + 1];
  vec4 c2 = uClNear[cb + 2];
  vec4 c3 = uClNear[cb + 3];
  vec4 c4 = uClNear[cb + 4];
  vec4 c5 = uClNear[cb + 5];
  p = int(c0.z + 0.5);
  bp = c4.w;
  float mask = clSideMask(int(c0.w + 0.5), sd, c5.x, c5.y);
  lit = clLit(int(c2.w + 0.5), light1, light2, c3.w);
  int gi = int(c4.x + 0.5);
  float grow = gi == 0 ? 1.0 : 1.0 + c4.y * pow(gi == 1 ? light1 : light2, c4.z);
  vec3 sigma = c0.y * c2.rgb * grow;
  vec3 sigmaEff = max(sigma, vec3(0.5 * uPixel));
  s2p = 2.0 * float(p) * sigmaEff * sigmaEff;
  offs = c1.w + c3.rgb;
  amp = mask * c0.x * c1.rgb * (sigma / sigmaEff);
  // Reach: where this part's light falls below CL_FLOOR (a small fraction of one 8-bit step at black).
  float peak = maxComponent(amp) * lit * c5.w;
  bool on = c0.x > 0.0 && peak > CL_FLOOR;
  float factor = on ? pow(CL_FLOOR / peak, -1.0 / float(p)) - 1.0 : 0.0;
  cut = on ? sqrt(max(s2p.x, max(s2p.y, s2p.z)) * factor) + max(abs(offs.x), max(abs(offs.y), abs(offs.z))) : -1.0;
}
${nearGlsl(layout)}
// Thin emitter line with unit light per unit length (times its emission), for the scatter source.
vec3 clLine(int e, vec2 q, float sigma, bool ownColor) {
  int count = int(uClEmit[e * ${EMIT_VEC4}].z + 0.5);
  vec3 s2p = vec3(16.0 * sigma * sigma);
  float cut = 7.5 * sigma;
  // One channel per emitter: emission relative to the emitter's own color, so facing and stops still show.
  float ownLight = max(luminance(uClEmit[e * ${EMIT_VEC4} + 2].rgb), 1e-6);
  vec3 acc = vec3(0.0);
  for (int chunk = 0; chunk < CL_CHUNKS; chunk++) {
    if (chunk * ${CHUNK} >= count) break;
    if (clBoxDistance(q, uClChunk[e * CL_CHUNKS + chunk]) > cut) continue;
  for (int j = 0; j < ${CHUNK}; j++) {
    int i = chunk * ${CHUNK} + j;
    if (i >= count) break;
    int base = (e * CL_P + i) * ${PRIM_VEC4};
    vec4 g = uClPrim[base];
    vec4 m = uClPrim[base + 1];
    int kind = int(m.x + 0.5);
    if (kind == 3) continue;
    vec2 rel = q - g.xy;
    vec3 em;
    if (kind == 1) {
      float l = max(m.w, 1e-9);
      vec2 d = (g.zw - g.xy) / l;
      float u = dot(rel, d);
      if (length(rel - d * clamp(u, 0.0, l)) > cut) continue;
      em = mix(uClPrim[base + 2].rgb, uClPrim[base + 3].rgb, clamp(u / l, 0.0, 1.0));
      if (ownColor) em = vec3(luminance(em) / ownLight);
      acc += em * clSegment(u, d.x * rel.y - d.y * rel.x, l, vec3(0.0), s2p, 8);
    } else {
      float r = length(rel);
      if (abs(r - g.z) > cut) continue;
      float psiM = clWrap(g.w + 0.5 * m.y - atan(rel.y, rel.x));
      em = mix(uClPrim[base + 2].rgb, uClPrim[base + 3].rgb, clamp(0.5 - psiM * sign(m.y) / max(abs(m.y), 1e-6), 0.0, 1.0));
      if (ownColor) em = vec3(luminance(em) / ownLight);
      acc += em * clArc(r, psiM, 0.5 * abs(m.y), vec3(g.z), s2p, 8, ${literal(kernelLineConstant(8))});
    }
  }
  }
  // Cross-section integral of the p = 8 kernel is 4 sigma * integral (1 + t^2)^-8 dt.
  return acc / (4.0 * sigma * ${literal(Math.sqrt(Math.PI) * gammaRatio(8))});
}

// Far parts of emitter e from the four scatter blurs of its light (channel e of each when one channel per emitter).
vec3 clFar(int e, float light1, float light2, float sd, vec3 b0, vec3 b1, vec3 b2, vec3 b3, bool perEmitter) {
  vec3 total = vec3(0.0);
  vec3 own = uClEmit[e * ${EMIT_VEC4} + 2].rgb;
  vec4 rung = uClRungs * ${literal(Math.sqrt(2 * Math.PI))};
  for (int f = 0; f < CL_F; f++) {
    int fb = (e * CL_F + f) * ${FAR_VEC4};
    vec4 a = uClFar[fb];
    if (a.x <= 0.0) continue;
    vec4 b = uClFar[fb + 1];
    vec4 c = uClFar[fb + 2];
    vec4 d = uClFar[fb + 3];
    float mask = clSideMask(int(a.z + 0.5), sd, d.z, d.w);
    if (mask <= 1e-5) continue;
    float lit = clLit(int(a.w + 0.5), light1, light2, b.w);
    if (lit <= 1e-6) continue;
    int gi = int(c.w + 0.5);
    float grow = gi == 0 ? 1.0 : 1.0 + d.x * pow(gi == 1 ? light1 : light2, d.y);
    // Position on the rung ladder per channel; one step past the widest rung the light is uniform
    // (the limit of a very wide kernel, which peaks at 1 across a straight emitter).
    vec3 x = clamp(log(max(a.y * c.rgb * grow, vec3(1e-6)) / uClRungs.x) / log(uClRungs.y / uClRungs.x), 0.0, 4.0);
    vec3 w0 = max(vec3(0.0), 1.0 - abs(x));
    vec3 w1 = max(vec3(0.0), 1.0 - abs(x - 1.0));
    vec3 w2 = max(vec3(0.0), 1.0 - abs(x - 2.0));
    vec3 w3 = max(vec3(0.0), 1.0 - abs(x - 3.0));
    vec3 w4 = max(vec3(0.0), x - 3.0);
    vec3 s0 = perEmitter ? own * b0[e] : b0;
    vec3 s1 = perEmitter ? own * b1[e] : b1;
    vec3 s2 = perEmitter ? own * b2[e] : b2;
    vec3 s3 = perEmitter ? own * b3[e] : b3;
    vec3 light = w0 * rung.x * s0 + w1 * rung.y * s1 + w2 * rung.z * s2 + w3 * rung.w * s3 + w4 * own;
    total += clPale(e, mask * lit * a.x * b.rgb * light, uClFar[fb + 4].x);
  }
  return total;
}

float clEmitterMask(int e, vec2 q) {
  vec4 info = uClEmit[e * ${EMIT_VEC4}];
  vec4 maskInfo = uClEmit[e * ${EMIT_VEC4} + 1];
  return info.w > 0.5 ? clMaskDistance(e, q - maskInfo.xy) - maskInfo.z : 0.0;
}

// All light: base, near parts and far parts (needs the four blurs of clAux).
vec3 curveLight(vec2 p, vec3 b0, vec3 b1, vec3 b2, vec3 b3, bool perEmitter) {
  vec2 q0 = p - clAnchor(0);
  float light1 = clLightField(0, q0);
  float light2 = clLightField(1, q0);
  vec3 color = uClBase;
  for (int e = 0; e < CL_E; e++) {
    if (uClEmit[e * ${EMIT_VEC4}].z < 0.5) continue;
    vec2 q = p - clAnchor(e);
    float sd = clEmitterMask(e, q);
    // The color drifts with the emitter's summed light at the pixel, so a dim part (a faint fill, the end of a tail)
    // drifts like the light there, whatever part it belongs to.
    vec3 lit = clNear(e, q, light1, light2, sd) + clFar(e, light1, light2, sd, b0, b1, b2, b3, perEmitter);
    color += clDrift(lit, uClEmit[e * ${EMIT_VEC4} + 2].rgb, uClEmit[e * ${EMIT_VEC4} + 3], uClEmit[e * ${EMIT_VEC4} + 4].x);
  }
  for (int g = 0; g < CL_AIR; g++) {
    vec4 b = uClAir[g * 4 + 1];
    if (b.w <= 0.0) continue;
    vec4 a = uClAir[g * 4];
    vec4 d = uClAir[g * 4 + 3];
    float glow = pow(clAirGlow(p, (a.xy - 0.5) * uFrameAspect, (a.zw - 0.5) * uFrameAspect, d.x), d.z);
    color += clDrift(b.rgb * (b.w * glow), b.rgb, uClAir[g * 4 + 2], d.y);
  }
  return color;
}

// The scatter source: each emitter's thin line, in color, or one channel per emitter.
vec3 clAux(vec2 p, bool perEmitter) {
  float sigma = max(0.7 * uPixel, 2e-4);
  vec3 result = vec3(0.0);
  for (int e = 0; e < CL_E; e++) {
    if (uClEmit[e * ${EMIT_VEC4}].z < 0.5) continue;
    vec3 line = clLine(e, p - clAnchor(e), sigma, perEmitter);
    if (perEmitter) result[e] = line.x;
    else result += line;
  }
  return result;
}
`
}

function gammaRatio(p: number): number {
  // Gamma(p - 1/2) / Gamma(p), from Gamma(1/2) = sqrt(pi) and Gamma(1) = 1.
  let num = Math.sqrt(Math.PI)
  for (let k = 0.5; k < p - 0.5; k += 1) num *= k
  let den = 1
  for (let k = 1; k < p; k += 1) den *= k
  return num / den
}

// ---------------------------------------------------------------------------
// Packing

export interface EmissionStop {
  t: number
  color: readonly number[]
  gain: number
}

export interface NearSettings {
  weight: number
  sigma: number
  p: number
  side: number
  tint: readonly number[]
  offset: number
  channelWidth: readonly number[]
  channelOffset: readonly number[]
  light: number
  lightGamma: number
  grow: number
  growGain: number
  growGamma: number
  maskInset: number
  maskSoft: number
  /** Share (0..1) of the part's light moved into its emitter's pale color, at the same luminance. */
  pale?: number
}

export interface FarSettings {
  weight: number
  sigma: number
  side: number
  tint: readonly number[]
  channelWidth: readonly number[]
  light: number
  lightGamma: number
  grow: number
  growGain: number
  growGamma: number
  maskInset: number
  maskSoft: number
  /** Share (0..1) of the part's light moved into its emitter's pale color, at the same luminance. */
  pale?: number
}

/** Edges catch more light where they face it: emission times mix(1, max(0, outward normal . light direction)^power, strength). */
export interface FacingSettings {
  strength: number
  /** Direction the light comes from, degrees (atan2 convention, y down). */
  angle: number
  power: number
}

export interface EmitterSettings {
  shape: Shape | null
  /** Frame position (0..1) of the shape's origin. */
  anchor: readonly number[]
  stops: readonly EmissionStop[]
  near: readonly NearSettings[]
  far: readonly FarSettings[]
  maskShift: readonly number[]
  maskGrow: number
  facing?: FacingSettings
  drift?: DriftSettings
  /** The light's own color at its own level, which `drift` measures against (default: the first stop's). */
  own?: readonly number[]
  /** Linear color that near parts with a `pale` share take on (another pack color for the light's pale side). */
  pale?: readonly number[]
}

/**
 * A light outside the curves, most often outside the frame, lighting the frame's air: the light of every point of
 * a segment (both ends the same for a point), each falling to half at `falloff` short sides through the haze.
 */
export interface AirSettings {
  /** Frame positions (0..1) of the segment's ends: x0, y0, x1, y1. */
  line: readonly number[]
  /** Linear color at its light's own level. */
  color: readonly number[]
  /** Times its own level the glow has where the haze has its full light (0 is off). */
  level: number
  falloff: number
  /** The haze's glow to this power: above 1 it stays nearer its source. */
  power?: number
  drift?: DriftSettings
}

/**
 * How a light's color changes as it dims: below `knee` of its own level the
 * channels other than the largest move toward `ratios` times their own values
 * (the largest channel's ratio is 1, so brightness follows the light), faster
 * with a higher `sharpness`. Knee 0 turns it off.
 */
export interface DriftSettings {
  ratios: readonly number[]
  knee: number
  sharpness: number
}

export interface LightSettings {
  kind: number
  /** Relative to emitter 1's anchor, short-side units. */
  at: readonly number[]
  radius: number
  length: number
  power: number
  stretch: number
  /** Degrees. */
  angle: number
}

function stopAt(stops: readonly EmissionStop[], t: number): number[] {
  if (stops.length === 0) return [0, 0, 0]
  const sorted = [...stops].sort((a, b) => a.t - b.t)
  const value = (s: EmissionStop) => s.color.map((c) => c * s.gain)
  if (t <= sorted[0].t) return value(sorted[0])
  const last = sorted[sorted.length - 1]
  if (t >= last.t) return value(last)
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]
    const b = sorted[i + 1]
    if (t <= b.t) {
      const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0
      const va = value(a)
      const vb = value(b)
      return va.map((v, k) => v + (vb[k] - v) * f)
    }
  }
  return value(last)
}

/** Cuts a primitive at fractions (sorted, inside 0..1). */
function cutPrimitive(p: Primitive, cuts: number[]): Primitive[] {
  if (cuts.length === 0) return [p]
  const bounds = [0, ...cuts, 1]
  const out: Primitive[] = []
  for (let i = 0; i < bounds.length - 1; i++) {
    const f0 = bounds[i]
    const f1 = bounds[i + 1]
    if (f1 - f0 < 1e-6) continue
    if (p.kind === 'segment') {
      out.push({ kind: 'segment', a: primitivePoint(p, f0), b: primitivePoint(p, f1) })
    } else {
      out.push({ kind: 'arc', center: p.center, radius: p.radius, start: p.start + p.sweep * f0, sweep: p.sweep * (f1 - f0) })
    }
  }
  return out
}

export interface PackedPrimitive {
  primitive: Primitive
  kind: 1 | 2 | 3
  inside: number
  /** Index of the contour; each contour's entries are consecutive and form a closed chain. */
  contour: number
  e0: number[]
  e1: number[]
}

/** Far segments that close an open contour around its left side, so the winding test sees an inside. */
function closingSegments(c: Contour): Primitive[] {
  const first = c.primitives[0]
  const last = c.primitives[c.primitives.length - 1]
  const start = primitivePoint(first, 0)
  const end = primitivePoint(last, 1)
  const t0 = primitiveTangent(first, 0)
  const t1 = primitiveTangent(last, 1)
  const far = 40
  const leftOf = (d: Vec2): Vec2 => [-d[1], d[0]]
  const endFar: Vec2 = [end[0] + t1[0] * far, end[1] + t1[1] * far]
  const startFar: Vec2 = [start[0] - t0[0] * far, start[1] - t0[1] * far]
  const l1 = leftOf(t1)
  const l0 = leftOf(t0)
  const corner1: Vec2 = [endFar[0] + l1[0] * far, endFar[1] + l1[1] * far]
  const corner0: Vec2 = [startFar[0] + l0[0] * far, startFar[1] + l0[1] * far]
  const points: Vec2[] = [end, endFar, corner1, corner0, startFar, start]
  return points.slice(0, -1).map((a, i) => ({ kind: 'segment', a, b: points[i + 1] }))
}

/** +1 when the filled side (nonzero winding over every contour) is on the contour's left, else -1. */
function filledSide(contour: Contour, maskPrimitives: readonly Primitive[]): number {
  if (!contour.closed) return 1
  const longest = contour.primitives.reduce((a, b) => (primitiveLength(b) > primitiveLength(a) ? b : a))
  const point = primitivePoint(longest, 0.4371)
  const tangent = primitiveTangent(longest, 0.4371)
  const eps = 1e-5 + 1e-4 * primitiveLength(longest)
  const probe: Vec2 = [point[0] - tangent[1] * eps, point[1] + tangent[0] * eps]
  if (windingNumber(maskPrimitives, probe) !== 0) return 1
  return signedArea(contour) === 0 ? 1 : -1
}

function facingAt(p: Primitive, f: number, inside: number, facing: FacingSettings | undefined): number {
  if (!facing || facing.strength <= 0) return 1
  const t = primitiveTangent(p, f)
  // The inside is on the left when inside = 1; the outward normal points the other way.
  const outward: Vec2 = [t[1] * inside, -t[0] * inside]
  const a = (facing.angle * Math.PI) / 180
  const lit = Math.max(0, outward[0] * Math.cos(a) + outward[1] * Math.sin(a)) ** Math.max(0.1, facing.power)
  return 1 + (lit - 1) * Math.min(1, facing.strength)
}

function packShape(shape: Shape, stops: readonly EmissionStop[], facing?: FacingSettings): PackedPrimitive[] {
  const split = splitArcs(shape, ARC_PIECE)
  const out: PackedPrimitive[] = []
  const stopTimes = stops
    .map((s) => s.t)
    .filter((t) => t > 0 && t < 1)
    .sort((a, b) => a - b)
  const contours = split.contours.filter((c) => c.primitives.length > 0)
  const closures = contours.map((c) => (c.closed ? [] : closingSegments(c)))
  const maskPrimitives = contours.flatMap((c, i) => [...c.primitives, ...closures[i]])
  for (const [index, contour] of contours.entries()) {
    const total = contourLength(contour)
    const inside = filledSide(contour, maskPrimitives)
    let at = 0
    for (const primitive of contour.primitives) {
      const l = primitiveLength(primitive)
      const t0 = total > 0 ? at / total : 0
      const t1 = total > 0 ? (at + l) / total : 1
      const cuts = stopTimes.filter((t) => t > t0 + 1e-6 && t < t1 - 1e-6).map((t) => (t - t0) / (t1 - t0))
      let f = 0
      for (const piece of cutPrimitive(primitive, cuts)) {
        const pl = primitiveLength(piece)
        const a = t0 + (t1 - t0) * f
        f += l > 0 ? pl / l : 1
        const b = t0 + (t1 - t0) * f
        const f0 = facingAt(piece, 0, inside, facing)
        const f1 = facingAt(piece, 1, inside, facing)
        out.push({
          primitive: piece,
          kind: piece.kind === 'segment' ? 1 : 2,
          inside,
          contour: index,
          e0: stopAt(stops, a).map((v) => v * f0),
          e1: stopAt(stops, b).map((v) => v * f1),
        })
      }
      at += l
    }
    for (const s of closures[index]) out.push({ primitive: s, kind: 3, inside, contour: index, e0: [0, 0, 0], e1: [0, 0, 0] })
  }
  return out
}

/**
 * The packed outline that fits the layout. Contours are never cut: an outline
 * missing pieces is open, and the inside test then swaps inside and outside in
 * bands. If a shape ever had more pieces than slots, whole contours from the
 * end would be left out instead (the outline tests make sure none do).
 */
function fitOutlines(packed: readonly PackedPrimitive[], capacity: number): PackedPrimitive[] {
  if (packed.length <= capacity) return [...packed]
  const out: PackedPrimitive[] = []
  for (let i = 0; i < packed.length; ) {
    let j = i
    while (j < packed.length && packed[j].contour === packed[i].contour) j++
    if (out.length + (j - i) > capacity) break
    out.push(...packed.slice(i, j))
    i = j
  }
  return out
}

/**
 * Which way the inside test casts its ray (+1 toward +x, -1 toward -x): the
 * side where, over a grid of points across the frame, the rays cross fewer
 * groups of pieces. Both give the same winding number; a large logo crop with
 * its body off one side of the frame tests far fewer pieces the other way.
 */
function rayDirection(boxes: readonly number[], aspect: number, anchor: readonly number[], shift: readonly number[]): 1 | -1 {
  const [fw, fh] = aspect >= 1 ? [aspect, 1] : [1, 1 / aspect]
  let right = 0
  let left = 0
  for (let j = 0; j < 9; j++) {
    for (let i = 0; i < 16; i++) {
      // Grid points in the mask's coordinates: frame position, minus the anchor and the mask shift.
      const x = ((i + 0.5) / 16 - anchor[0]) * fw - (shift[0] ?? 0)
      const y = ((j + 0.5) / 9 - anchor[1]) * fh - (shift[1] ?? 0)
      for (let k = 0; k < boxes.length; k += 4) {
        if (y < boxes[k + 1] || y > boxes[k + 3]) continue
        if (boxes[k + 2] > x) right++
        if (boxes[k] < x) left++
      }
    }
  }
  return left < right ? -1 : 1
}

/** Every primitive of a shape as packed for the shader (contours whole, open ones closed far away), before the layout's limit. */
export function outlinePieces(settings: Pick<EmitterSettings, 'shape' | 'stops' | 'facing'>): readonly PackedPrimitive[] {
  return settings.shape ? packShape(settings.shape, settings.stops, settings.facing) : []
}

/** Points that bound a primitive: its ends and, for arcs, the extreme points inside its sweep. */
function primitiveExtremes(p: Primitive): Vec2[] {
  if (p.kind === 'segment') return [p.a, p.b]
  const points = [primitivePoint(p, 0), primitivePoint(p, 1)]
  const lo = Math.min(p.start, p.start + p.sweep)
  const hi = Math.max(p.start, p.start + p.sweep)
  for (let k = Math.ceil(lo / (Math.PI / 2)); k * (Math.PI / 2) <= hi; k++) {
    const a = k * (Math.PI / 2)
    points.push([p.center[0] + p.radius * Math.cos(a), p.center[1] + p.radius * Math.sin(a)])
  }
  return points
}

function chunkBounds(packed: readonly PackedPrimitive[]): number[] {
  const out: number[] = []
  for (let i = 0; i < packed.length; i += CHUNK) {
    const points = packed.slice(i, i + CHUNK).flatMap((entry) => primitiveExtremes(entry.primitive))
    const xs = points.map((v) => v[0])
    const ys = points.map((v) => v[1])
    // A box (min x, min y, max x, max y), a little wider than the pieces: a run of pieces along a large outline is long
    // and thin, and a box rules out far more pixels than the circle around it.
    out.push(Math.min(...xs) - 1e-6, Math.min(...ys) - 1e-6, Math.max(...xs) + 1e-6, Math.max(...ys) + 1e-6)
  }
  return out
}

/** Blur widths of the four scatter rungs. */
export function farRungs(base: number, step = FAR_STEP): number[] {
  return Array.from({ length: FAR_RUNGS }, (_, i) => base * step ** i)
}

/** The recipe's scatter list: four blurs of its aux light at the rung widths. */
export function farScatter(base: (ctx: RecipeContext) => number, step: (ctx: RecipeContext) => number): ScatterBlur[] {
  return Array.from({ length: FAR_RUNGS }, (_, i) => ({ source: 'aux' as const, radius: (ctx: RecipeContext) => farRungs(base(ctx), step(ctx))[i] }))
}

/** Packs emitters, light fields, base and rungs into the curve light uniforms. */
export function curveLightUniforms(
  layout: CurveLightLayout,
  emitters: readonly EmitterSettings[],
  lights: readonly LightSettings[],
  base: readonly number[],
  rungBase: number,
  rungStep: number,
  /** The frame's width / height, for the inside test's ray direction (it never changes the picture, only the work). */
  aspect?: number,
  air: readonly AirSettings[] = [],
): Record<string, Float32Array | number[]> {
  const chunks = Math.ceil(layout.primitives / CHUNK)
  const prim = new Float32Array(layout.emitters * layout.primitives * PRIM_VEC4 * 4)
  const bounds = new Float32Array(layout.emitters * chunks * 4)
  const near = new Float32Array(layout.emitters * layout.near * NEAR_VEC4 * 4)
  const far = new Float32Array(layout.emitters * layout.far * FAR_VEC4 * 4)
  const emit = new Float32Array(layout.emitters * EMIT_VEC4 * 4)
  for (let e = 0; e < layout.emitters; e++) {
    const settings = emitters[e]
    if (!settings || !settings.shape) continue
    const sided = [...settings.near, ...settings.far].filter((c) => c.weight > 0 && Math.round(c.side) !== 0)
    const own = settings.own ?? stopAt(settings.stops, 0)
    // Past this distance from the edge every side mask is fully on or off (4 softness widths), so only the inside test matters.
    const maskReach = Math.max(0, ...sided.map((c) => Math.abs(c.maskInset) + 4 * Math.max(c.maskSoft, MIN_MASK_SOFT))) + Math.abs(settings.maskGrow) + 1e-3
    const packed = fitOutlines(packShape(settings.shape, settings.stops, settings.facing), layout.primitives)
    const brightest = Math.max(1e-6, ...packed.flatMap((entry) => [...entry.e0, ...entry.e1]))
    packed.forEach((entry, i) => {
      const o = (e * layout.primitives + i) * PRIM_VEC4 * 4
      const p = entry.primitive
      prim.set(p.kind === 'segment' ? [p.a[0], p.a[1], p.b[0], p.b[1]] : [p.center[0], p.center[1], p.radius, p.start], o)
      prim.set([entry.kind, p.kind === 'arc' ? p.sweep : 0, entry.inside, primitiveLength(p)], o + 4)
      // The ends' y, worked out once in double precision, so neighbors share the same numbers for the inside test.
      prim.set([entry.e0[0], entry.e0[1], entry.e0[2], primitivePoint(p, 0)[1]], o + 8)
      prim.set([entry.e1[0], entry.e1[1], entry.e1[2], primitivePoint(p, 1)[1]], o + 12)
    })
    const boxes = chunkBounds(packed)
    bounds.set(boxes, e * chunks * 4)
    const toward = sided.length > 0 && aspect !== undefined ? rayDirection(boxes, aspect, settings.anchor, settings.maskShift) : 1
    emit.set([settings.anchor[0], settings.anchor[1], packed.length, sided.length > 0 ? 1 : 0], e * EMIT_VEC4 * 4)
    emit.set([settings.maskShift[0] ?? 0, settings.maskShift[1] ?? 0, settings.maskGrow, maskReach], e * EMIT_VEC4 * 4 + 4)
    emit.set([own[0], own[1], own[2], toward], e * EMIT_VEC4 * 4 + 8)
    const drift = settings.drift ?? { ratios: [1, 1, 1], knee: 0, sharpness: 2 }
    emit.set([drift.ratios[0], drift.ratios[1], drift.ratios[2], Math.max(0, drift.knee)], e * EMIT_VEC4 * 4 + 12)
    const paleLight = settings.pale ? luminanceOf(settings.pale) : 0
    const pale = settings.pale && paleLight > 1e-6 ? settings.pale.map((v) => v / paleLight) : [0, 0, 0]
    emit.set([Math.max(0.1, drift.sharpness), pale[0], pale[1], pale[2]], e * EMIT_VEC4 * 4 + 16)
    settings.near.slice(0, layout.near).forEach((c, k) => {
      const o = (e * layout.near + k) * NEAR_VEC4 * 4
      const p = Math.min(MAX_KERNEL_POWER, Math.max(1, Math.round(c.p)))
      near.set([Math.max(0, c.weight), Math.max(0, c.sigma), p, Math.round(c.side)], o)
      near.set([c.tint[0], c.tint[1], c.tint[2], c.offset], o + 4)
      near.set([c.channelWidth[0], c.channelWidth[1], c.channelWidth[2], Math.round(c.light)], o + 8)
      near.set([c.channelOffset[0], c.channelOffset[1], c.channelOffset[2], c.lightGamma], o + 12)
      near.set([Math.round(c.grow), c.growGain, c.growGamma, kernelLineConstant(p)], o + 16)
      near.set([c.maskInset, c.maskSoft, paleLight > 1e-6 ? Math.min(1, Math.max(0, c.pale ?? 0)) : 0, brightest], o + 20)
    })
    settings.far.slice(0, layout.far).forEach((c, k) => {
      const o = (e * layout.far + k) * FAR_VEC4 * 4
      far.set([Math.max(0, c.weight), Math.max(1e-6, c.sigma), Math.round(c.side), Math.round(c.light)], o)
      far.set([c.tint[0], c.tint[1], c.tint[2], c.lightGamma], o + 4)
      far.set([c.channelWidth[0], c.channelWidth[1], c.channelWidth[2], Math.round(c.grow)], o + 8)
      far.set([c.growGain, c.growGamma, c.maskInset, c.maskSoft], o + 12)
      far.set([paleLight > 1e-6 ? Math.min(1, Math.max(0, c.pale ?? 0)) : 0, 0, 0, 0], o + 16)
    })
  }
  const light = new Float32Array(16)
  lights.slice(0, 2).forEach((l, i) => {
    light.set([Math.round(l.kind), l.at[0], l.at[1], l.radius], i * 8)
    light.set([l.length, l.power, l.stretch, (l.angle * Math.PI) / 180], i * 8 + 4)
  })
  const airGlows = new Float32Array(AIR_GLOWS * 16)
  air.slice(0, AIR_GLOWS).forEach((g, i) => {
    const drift = g.drift ?? { ratios: [1, 1, 1], knee: 0, sharpness: 2 }
    airGlows.set([g.line[0], g.line[1], g.line[2], g.line[3]], i * 16)
    airGlows.set([g.color[0], g.color[1], g.color[2], Math.max(0, g.level)], i * 16 + 4)
    airGlows.set([drift.ratios[0], drift.ratios[1], drift.ratios[2], Math.max(0, drift.knee)], i * 16 + 8)
    airGlows.set([Math.max(1e-3, g.falloff), Math.max(0.1, drift.sharpness), Math.max(0.5, g.power ?? 1), 0], i * 16 + 12)
  })
  return {
    uClPrim: prim,
    uClChunk: bounds,
    uClNear: near,
    uClFar: far,
    uClEmit: emit,
    uClLight: light,
    uClAir: airGlows,
    uClBase: [base[0], base[1], base[2]],
    uClRungs: farRungs(rungBase, rungStep),
  }
}

// ---------------------------------------------------------------------------
// Params

type Defaults = Partial<Record<string, number | number[]>>

function withDefaults(specs: ParamSpec[], prefix: string, defaults: Defaults): ParamSpec[] {
  return specs.map((spec) => {
    const value = defaults[spec.key.slice(prefix.length)]
    if (value === undefined) return spec
    if (spec.kind === 'vector' && Array.isArray(value)) return { ...spec, default: value }
    if (spec.kind === 'number' && typeof value === 'number') return { ...spec, default: value }
    return spec
  })
}

/** Param specs for one near (analytic) part, keys prefixed (e.g. 'n1' or 'ring2n1'). */
export function nearParams(prefix: string, label: string, defaults: Defaults = {}): ParamSpec[] {
  return withDefaults(
    [
      { kind: 'number', key: `${prefix}Weight`, label: `${label} weight`, min: 0, max: 40, step: 0.0005, default: 0 },
      { kind: 'number', key: `${prefix}Width`, label: `${label} width`, min: 0, max: 0.2, step: 0.00005, default: 0.002 },
      { kind: 'number', key: `${prefix}Shape`, label: `${label} falloff (1 long tail .. 8 near gaussian)`, min: 1, max: MAX_KERNEL_POWER, step: 1, default: 8 },
      { kind: 'number', key: `${prefix}Side`, label: `${label} side (0 both, 1 inside, 2 outside)`, min: 0, max: 2, step: 1, default: 0 },
      { kind: 'vector', key: `${prefix}Tint`, label: `${label} tint`, min: 0, max: 4, step: 0.001, default: [1, 1, 1] },
      { kind: 'number', key: `${prefix}Offset`, label: `${label} offset toward the inside`, min: -0.2, max: 0.2, step: 0.00005, default: 0 },
      { kind: 'vector', key: `${prefix}ChWidth`, label: `${label} channel widths`, min: 0.05, max: 8, step: 0.001, default: [1, 1, 1] },
      { kind: 'vector', key: `${prefix}ChOffset`, label: `${label} channel offsets`, min: -0.1, max: 0.1, step: 0.00005, default: [0, 0, 0] },
      { kind: 'number', key: `${prefix}Light`, label: `${label} light field (0 none, 1, 2)`, min: 0, max: 2, step: 1, default: 1 },
      { kind: 'number', key: `${prefix}LightGamma`, label: `${label} light gamma`, min: 0, max: 12, step: 0.01, default: 1 },
      { kind: 'number', key: `${prefix}Grow`, label: `${label} width grows with light (0 none, 1, 2)`, min: 0, max: 2, step: 1, default: 0 },
      { kind: 'vector', key: `${prefix}GrowBy`, label: `${label} growth gain, gamma`, min: -0.95, max: 12, step: 0.01, default: [0, 1] },
      { kind: 'number', key: `${prefix}MaskInset`, label: `${label} side edge inset`, min: -0.5, max: 0.5, step: 0.0001, default: 0 },
      { kind: 'number', key: `${prefix}MaskSoft`, label: `${label} side edge softness`, min: 0, max: 0.5, step: 0.0001, default: 0 },
      { kind: 'number', key: `${prefix}Pale`, label: `${label} share in the pale color`, min: 0, max: 1, step: 0.001, default: 0 },
    ],
    prefix,
    defaults,
  )
}

/** Param specs for the air glows: `air<i>Line` (frame x0, y0, x1, y1), level, falloff, color slot and drift. */
export function airParams(colors: number): ParamSpec[] {
  return Array.from({ length: AIR_GLOWS }, (_, k) => k + 1).flatMap((i): ParamSpec[] => [
    { kind: 'vector', key: `air${i}Line`, label: `Air glow ${i} source (frame x0, y0, x1, y1)`, min: -4, max: 5, step: 0.0001, default: [0.5, -0.5, 0.5, -0.5] },
    { kind: 'number', key: `air${i}Level`, label: `Air glow ${i} level (0 off)`, min: 0, max: 1e6, step: 0.0001, default: 0 },
    { kind: 'number', key: `air${i}Falloff`, label: `Air glow ${i} half distance`, min: 0.01, max: 2, step: 0.0005, default: 0.2 },
    { kind: 'number', key: `air${i}Power`, label: `Air glow ${i} falloff power`, min: 0.5, max: 6, step: 0.01, default: 1 },
    { kind: 'number', key: `air${i}Color`, label: `Air glow ${i} color slot`, min: 1, max: colors, step: 1, default: 2 },
    ...driftParams(`air${i}Drift`, `Air glow ${i}`),
  ])
}

export function readAir(ctx: RecipeContext, gain: number): AirSettings[] {
  return Array.from({ length: AIR_GLOWS }, (_, k) => k + 1).map((i) => ({
    line: ctx.vec(`air${i}Line`),
    color: slotColor(ctx, ctx.num(`air${i}Color`)).map((v) => v * gain),
    level: ctx.num(`air${i}Level`),
    falloff: ctx.num(`air${i}Falloff`),
    power: ctx.num(`air${i}Power`),
    drift: readDrift(ctx, `air${i}Drift`),
  }))
}

/** clAirGlow on the CPU: p, a and b in short-side units. */
export function airGlowAt(p: readonly number[], a: readonly number[], b: readonly number[], c: number): number {
  const q = [p[0] - a[0], p[1] - a[1]]
  const d = [b[0] - a[0], b[1] - a[1]]
  const len = Math.hypot(d[0], d[1])
  const c2 = c * c
  const qq = q[0] * q[0] + q[1] * q[1]
  if (len < 1e-4) return c2 / (qq + c2)
  const t = (q[0] * d[0] + q[1] * d[1]) / len
  const k = Math.sqrt(Math.max(qq - t * t, 0) + c2)
  return (c2 / (len * k)) * (Math.atan((len - t) / k) + Math.atan(t / k))
}

/**
 * The level that gives an air glow from `line` (frame x0, y0, x1, y1) its light's own level at the brightest point
 * of the frame, which is on the frame's edge for a source outside it.
 */
export function airLevelFor(line: readonly number[], falloff: number, aspect: number, power = 1): number {
  const size = aspect >= 1 ? [aspect, 1] : [1, 1 / aspect]
  const at = (u: number, v: number) => [(u - 0.5) * size[0], (v - 0.5) * size[1]]
  const a = at(line[0], line[1])
  const b = at(line[2], line[3])
  let brightest = 0
  const n = 64
  for (let i = 0; i <= n; i++) {
    const s = i / n
    for (const [u, v] of [
      [s, 0],
      [s, 1],
      [0, s],
      [1, s],
    ])
      brightest = Math.max(brightest, airGlowAt(at(u, v), a, b, falloff))
  }
  return brightest > 0 ? 1 / brightest ** power : 0
}

/** Param specs for one far (scattered) part. */
export function farParams(prefix: string, label: string, defaults: Defaults = {}): ParamSpec[] {
  return withDefaults(
    [
      { kind: 'number', key: `${prefix}Weight`, label: `${label} weight`, min: 0, max: 20, step: 0.0005, default: 0 },
      { kind: 'number', key: `${prefix}Width`, label: `${label} width`, min: 0.001, max: 4, step: 0.0005, default: 0.05 },
      { kind: 'number', key: `${prefix}Side`, label: `${label} side (0 both, 1 inside, 2 outside)`, min: 0, max: 2, step: 1, default: 0 },
      { kind: 'vector', key: `${prefix}Tint`, label: `${label} tint`, min: 0, max: 4, step: 0.001, default: [1, 1, 1] },
      { kind: 'vector', key: `${prefix}ChWidth`, label: `${label} channel widths`, min: 0.05, max: 8, step: 0.001, default: [1, 1, 1] },
      { kind: 'number', key: `${prefix}Light`, label: `${label} light field (0 none, 1, 2)`, min: 0, max: 2, step: 1, default: 1 },
      { kind: 'number', key: `${prefix}LightGamma`, label: `${label} light gamma`, min: 0, max: 12, step: 0.01, default: 1 },
      { kind: 'number', key: `${prefix}Grow`, label: `${label} width grows with light (0 none, 1, 2)`, min: 0, max: 2, step: 1, default: 0 },
      { kind: 'vector', key: `${prefix}GrowBy`, label: `${label} growth gain, gamma`, min: -0.95, max: 12, step: 0.01, default: [0, 1] },
      { kind: 'number', key: `${prefix}MaskInset`, label: `${label} side edge inset`, min: -1, max: 1, step: 0.0001, default: 0 },
      { kind: 'number', key: `${prefix}MaskSoft`, label: `${label} side edge softness`, min: 0, max: 1, step: 0.0001, default: 0 },
      { kind: 'number', key: `${prefix}Pale`, label: `${label} share in the pale color`, min: 0, max: 1, step: 0.001, default: 0 },
    ],
    prefix,
    defaults,
  )
}

/** Param specs for the two light fields. */
export function lightParams(defaults: Defaults = {}): ParamSpec[] {
  const specs = [1, 2].flatMap((i): ParamSpec[] => [
    { kind: 'number', key: `light${i}Kind`, label: `Light ${i} (0 off, 1 gauss, 2 exp, 3 power, 4 plane, 5 flat top, 6 one-way flat top)`, min: 0, max: 6, step: 1, default: 0 },
    { kind: 'vector', key: `light${i}At`, label: `Light ${i} position from the shape`, min: -6, max: 6, step: 0.0005, default: [0, 0] },
    { kind: 'number', key: `light${i}Radius`, label: `Light ${i} radius`, min: 0.001, max: 6, step: 0.0005, default: 0.4 },
    { kind: 'number', key: `light${i}Length`, label: `Light ${i} falloff length`, min: 0.001, max: 6, step: 0.0005, default: 0.2 },
    { kind: 'number', key: `light${i}Power`, label: `Light ${i} power`, min: 0, max: 12, step: 0.01, default: 2 },
    { kind: 'number', key: `light${i}Stretch`, label: `Light ${i} stretch`, min: 0.05, max: 20, step: 0.001, default: 1 },
    { kind: 'number', key: `light${i}Angle`, label: `Light ${i} angle`, min: -360, max: 360, step: 0.01, default: 0 },
  ])
  return withDefaults(specs, '', defaults)
}

/** Param specs for an emitter's drift: the ratios under `key` and [knee, sharpness] under `${key}Shape`. */
export function driftParams(key: string, label: string): ParamSpec[] {
  return [
    { kind: 'vector', key, label: `${label} drifts toward (ratio per channel)`, min: 0, max: 8, step: 0.001, default: [1, 1, 1] },
    { kind: 'vector', key: `${key}Shape`, label: `${label} drift knee (0 off), sharpness`, min: 0, max: 8, step: 0.001, default: [0, 2] },
  ]
}

export function readDrift(ctx: RecipeContext, key: string): DriftSettings {
  const [knee, sharpness] = ctx.vec(`${key}Shape`)
  return { ratios: ctx.vec(key), knee, sharpness }
}

export function readNear(ctx: RecipeContext, prefix: string, widthScale: number, gainScale: number): NearSettings {
  const growBy = ctx.vec(`${prefix}GrowBy`)
  return {
    weight: ctx.num(`${prefix}Weight`) * gainScale,
    sigma: ctx.num(`${prefix}Width`) * widthScale,
    p: ctx.num(`${prefix}Shape`),
    side: ctx.num(`${prefix}Side`),
    tint: ctx.vec(`${prefix}Tint`),
    offset: ctx.num(`${prefix}Offset`) * widthScale,
    channelWidth: ctx.vec(`${prefix}ChWidth`),
    channelOffset: ctx.vec(`${prefix}ChOffset`).map((v) => v * widthScale),
    light: ctx.num(`${prefix}Light`),
    lightGamma: ctx.num(`${prefix}LightGamma`),
    grow: ctx.num(`${prefix}Grow`),
    growGain: growBy[0],
    growGamma: growBy[1],
    maskInset: ctx.num(`${prefix}MaskInset`),
    maskSoft: ctx.num(`${prefix}MaskSoft`) * widthScale,
    pale: ctx.num(`${prefix}Pale`),
  }
}

export function readFar(ctx: RecipeContext, prefix: string, widthScale: number, gainScale: number): FarSettings {
  const growBy = ctx.vec(`${prefix}GrowBy`)
  return {
    weight: ctx.num(`${prefix}Weight`) * gainScale,
    sigma: ctx.num(`${prefix}Width`) * widthScale,
    side: ctx.num(`${prefix}Side`),
    tint: ctx.vec(`${prefix}Tint`),
    channelWidth: ctx.vec(`${prefix}ChWidth`),
    light: ctx.num(`${prefix}Light`),
    lightGamma: ctx.num(`${prefix}LightGamma`),
    grow: ctx.num(`${prefix}Grow`),
    growGain: growBy[0],
    growGamma: growBy[1],
    maskInset: ctx.num(`${prefix}MaskInset`),
    maskSoft: ctx.num(`${prefix}MaskSoft`) * widthScale,
    pale: ctx.num(`${prefix}Pale`),
  }
}

export function readLights(ctx: RecipeContext): LightSettings[] {
  return [1, 2].map((i) => ({
    kind: ctx.num(`light${i}Kind`),
    at: ctx.vec(`light${i}At`),
    radius: ctx.num(`light${i}Radius`),
    length: ctx.num(`light${i}Length`),
    power: ctx.num(`light${i}Power`),
    stretch: ctx.num(`light${i}Stretch`),
    angle: ctx.num(`light${i}Angle`),
  }))
}

/** A palette slot (1-based) as a linear color; 0 or out of range gives black. */
export function slotColor(ctx: RecipeContext, slot: number): number[] {
  const i = Math.round(slot) - 1
  const c = ctx.colors[i]
  return c ? [c[0], c[1], c[2]] : [0, 0, 0]
}

// ---------------------------------------------------------------------------
// Shapes from params

export const SHAPE_KINDS = ['line', 'corner', 'arc', 'sCurve', 'logo', 'ring', 'logoEdge'] as const
export type ShapeKind = (typeof SHAPE_KINDS)[number]

export interface ShapeSettings {
  kind: ShapeKind
  /** Line length, corner radius, arc / ring / S radius, or logo height (short-side units). logoEdge is the logo's outer contour only. */
  size: number
  /** Corner inside angle, arc sweep or S sweep, degrees. */
  angle: number
  /** Ring height / width. */
  aspect: number
  /** Degrees. */
  rotate: number
  flip: boolean
}

export function shapeKindAt(index: number): ShapeKind {
  return SHAPE_KINDS[Math.min(SHAPE_KINDS.length - 1, Math.max(0, Math.round(index) - 1))]
}

export function buildShape(s: ShapeSettings): Shape {
  const radians = (s.angle * Math.PI) / 180
  let shape: Shape
  switch (s.kind) {
    case 'line':
      shape = straightEdge(s.size)
      break
    case 'corner':
      shape = roundedCorner(radians, s.size)
      break
    case 'arc':
      shape = circularArc(s.size, radians)
      break
    case 'sCurve':
      shape = sCurve(s.size, radians)
      break
    case 'logo':
      shape = transformShape(metaLogo(), { scale: s.size })
      break
    case 'ring':
      shape = ring(s.size, s.aspect)
      break
    case 'logoEdge':
      shape = transformShape(metaLogoEdge(), { scale: s.size })
      break
    default: {
      const unknown: never = s.kind
      throw new Error(`Unknown shape kind: ${String(unknown)}`)
    }
  }
  return transformShape(shape, { rotate: (s.rotate * Math.PI) / 180, flip: s.flip })
}
