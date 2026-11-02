/**
 * Shapes for Contour light: contours made of straight segments and circular
 * arcs. Units are fractions of the frame's short side, y down, as in the
 * recipe shaders. Angles are atan2(y, x) in these coordinates, so a positive
 * arc sweep turns from +x toward +y.
 *
 * The "left" side of a contour is its direction turned by +90° (-dy, dx). For
 * open contours the left side is the inside; closed contours use the nonzero
 * winding rule, and their left side is the inside when they run with positive
 * signed area.
 */

export type Vec2 = readonly [number, number]

export interface Segment {
  kind: 'segment'
  a: Vec2
  b: Vec2
}

export interface Arc {
  kind: 'arc'
  center: Vec2
  radius: number
  /** Angle of the first point, radians. */
  start: number
  /** Signed angle swept from the start, radians. */
  sweep: number
}

export type Primitive = Segment | Arc

export interface Contour {
  primitives: Primitive[]
  closed: boolean
}

export interface Shape {
  contours: Contour[]
}

export interface Transform {
  scale?: number
  /** Radians. */
  rotate?: number
  translate?: Vec2
  /** Mirror across the x axis before rotating. */
  flip?: boolean
}

const TAU = Math.PI * 2

const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]]
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]]
const mul = (a: Vec2, s: number): Vec2 => [a[0] * s, a[1] * s]
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1]
const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0]
const len = (a: Vec2) => Math.hypot(a[0], a[1])
const norm = (a: Vec2): Vec2 => {
  const l = len(a)
  return l > 0 ? [a[0] / l, a[1] / l] : [1, 0]
}
const dir = (angle: number): Vec2 => [Math.cos(angle), Math.sin(angle)]
const left = (d: Vec2): Vec2 => [-d[1], d[0]]

export function segment(a: Vec2, b: Vec2): Segment {
  return { kind: 'segment', a, b }
}

export function arc(center: Vec2, radius: number, start: number, sweep: number): Arc {
  return { kind: 'arc', center, radius, start, sweep }
}

export function primitiveLength(p: Primitive): number {
  return p.kind === 'segment' ? len(sub(p.b, p.a)) : Math.abs(p.sweep) * p.radius
}

/** Point at fraction f (0..1) of the primitive. */
export function primitivePoint(p: Primitive, f: number): Vec2 {
  if (p.kind === 'segment') return add(p.a, mul(sub(p.b, p.a), f))
  return add(p.center, mul(dir(p.start + p.sweep * f), p.radius))
}

/** Unit direction of travel at fraction f. */
export function primitiveTangent(p: Primitive, f: number): Vec2 {
  if (p.kind === 'segment') return norm(sub(p.b, p.a))
  const a = p.start + p.sweep * f
  const s = Math.sign(p.sweep) || 1
  return [-Math.sin(a) * s, Math.cos(a) * s]
}

export function contourLength(c: Contour): number {
  return c.primitives.reduce((sum, p) => sum + primitiveLength(p), 0)
}

/** Point and tangent at fraction t (0..1) of a contour's length. */
export function contourPoint(c: Contour, t: number): { point: Vec2; tangent: Vec2 } {
  const total = contourLength(c)
  let remaining = Math.min(1, Math.max(0, t)) * total
  for (const p of c.primitives) {
    const l = primitiveLength(p)
    if (remaining <= l || p === c.primitives[c.primitives.length - 1]) {
      const f = l > 0 ? Math.min(1, remaining / l) : 0
      return { point: primitivePoint(p, f), tangent: primitiveTangent(p, f) }
    }
    remaining -= l
  }
  const first = c.primitives[0]
  return { point: primitivePoint(first, 0), tangent: primitiveTangent(first, 0) }
}

function transformPoint(v: Vec2, t: Transform): Vec2 {
  const s = t.scale ?? 1
  const r = t.rotate ?? 0
  const x = v[0] * s
  const y = (t.flip ? -v[1] : v[1]) * s
  const c = Math.cos(r)
  const n = Math.sin(r)
  const o = t.translate ?? [0, 0]
  return [x * c - y * n + o[0], x * n + y * c + o[1]]
}

/** Scales, mirrors, rotates, then translates. A mirror reverses the direction of travel so the inside stays on the left. */
export function transformShape(shape: Shape, t: Transform): Shape {
  const s = t.scale ?? 1
  const r = t.rotate ?? 0
  const mapPrimitive = (p: Primitive): Primitive => {
    if (p.kind === 'segment') return segment(transformPoint(p.a, t), transformPoint(p.b, t))
    const start = t.flip ? -p.start : p.start
    const sweep = t.flip ? -p.sweep : p.sweep
    return arc(transformPoint(p.center, t), p.radius * s, start + r, sweep)
  }
  return {
    contours: shape.contours.map((c) => {
      const primitives = c.primitives.map(mapPrimitive)
      return { closed: c.closed, primitives: t.flip ? reverseChain(primitives) : primitives }
    }),
  }
}

function reversePrimitive(p: Primitive): Primitive {
  return p.kind === 'segment' ? segment(p.b, p.a) : arc(p.center, p.radius, p.start + p.sweep, -p.sweep)
}

function reverseChain(primitives: Primitive[]): Primitive[] {
  return primitives.map(reversePrimitive).reverse()
}

/** Splits arcs into pieces of at most maxSweep radians. */
export function splitArcs(shape: Shape, maxSweep = Math.PI / 4): Shape {
  return {
    contours: shape.contours.map((c) => ({
      closed: c.closed,
      primitives: c.primitives.flatMap((p) => {
        if (p.kind === 'segment' || Math.abs(p.sweep) <= maxSweep) return [p]
        const n = Math.ceil(Math.abs(p.sweep) / maxSweep)
        return Array.from({ length: n }, (_, i) => arc(p.center, p.radius, p.start + (p.sweep * i) / n, p.sweep / n))
      }),
    })),
  }
}

/** Signed area of a closed contour (positive when the inside is on the left). */
export function signedArea(c: Contour): number {
  let area = 0
  for (const p of c.primitives) {
    if (p.kind === 'segment') {
      area += 0.5 * cross(p.a, p.b)
    } else {
      const a = primitivePoint(p, 0)
      const b = primitivePoint(p, 1)
      area += 0.5 * cross(a, b)
      // Circular segment between the chord and the arc.
      area += 0.5 * p.radius * p.radius * (p.sweep - Math.sin(p.sweep))
    }
  }
  return area
}

// ---------------------------------------------------------------------------
// Library. Every shape sits around the origin; place it with transformShape.

/** Long enough to leave any frame the shape is placed in. */
export const FAR = 6

/** A straight edge along +x through the origin; the inside is y > 0 (left of +x). */
export function straightEdge(length = 2 * FAR): Shape {
  return { contours: [{ closed: false, primitives: [segment([-length / 2, 0], [length / 2, 0])] }] }
}

/**
 * A corner at the origin with the given inside angle (radians) between its two
 * edges, rounded by radius. The edges run toward +x, at ±angle / 2 from the
 * x axis; the inside is the wedge between them.
 */
export function roundedCorner(angle: number, radius: number, legLength = FAR): Shape {
  const half = Math.min(Math.max(angle, 0.05), Math.PI - 0.05) / 2
  const rayIn = dir(half)
  const rayOut = dir(-half)
  const far1 = mul(rayIn, legLength)
  const far2 = mul(rayOut, legLength)
  if (radius <= 0) {
    return { contours: [{ closed: false, primitives: [segment(far1, [0, 0]), segment([0, 0], far2)] }] }
  }
  const tangentDistance = radius / Math.tan(half)
  const center: Vec2 = [radius / Math.sin(half), 0]
  const t1 = mul(rayIn, tangentDistance)
  const t2 = mul(rayOut, tangentDistance)
  const start = Math.atan2(t1[1] - center[1], t1[0] - center[0])
  const end = Math.atan2(t2[1] - center[1], t2[0] - center[0])
  let sweep = end - start
  // The arc turns left (positive) around the inside of the corner.
  while (sweep <= 0) sweep += TAU
  while (sweep > TAU) sweep -= TAU
  return {
    contours: [{ closed: false, primitives: [segment(far1, t1), arc(center, radius, start, sweep), segment(t2, far2)] }],
  }
}

/** An open arc of a circle around the origin, centered on +x; the inside is toward the center. */
export function circularArc(radius: number, sweep: number): Shape {
  return { contours: [{ closed: false, primitives: [arc([0, 0], radius, -sweep / 2, sweep)] }] }
}

/** A closed ring around the origin. aspect = height / width; ellipses are made of arcs (biarcs). */
export function ring(radius: number, aspect = 1): Shape {
  if (Math.abs(aspect - 1) < 1e-4) {
    return { contours: [{ closed: true, primitives: [arc([0, 0], radius, 0, TAU)] }] }
  }
  const a = radius
  const b = radius * aspect
  // Four quarter ellipses as cubic Béziers (kappa), each turned into biarcs.
  const k = 0.5522847498
  const quarters: [Vec2, Vec2, Vec2, Vec2][] = [
    [[a, 0], [a, k * b], [k * a, b], [0, b]],
    [[0, b], [-k * a, b], [-a, k * b], [-a, 0]],
    [[-a, 0], [-a, -k * b], [-k * a, -b], [0, -b]],
    [[0, -b], [k * a, -b], [a, -k * b], [a, 0]],
  ]
  const tolerance = 2e-4 * radius
  return { contours: [{ closed: true, primitives: quarters.flatMap((q) => cubicToBiarcs(q[0], q[1], q[2], q[3], tolerance)) }] }
}

/**
 * A gentle S: two arcs of the given radius and sweep turning opposite ways,
 * joined at the origin with direction +x, plus straight legs off both ends.
 * The inside is on the left of +x at the middle (y > 0).
 */
export function sCurve(radius: number, sweep: number, legLength = FAR): Shape {
  const s = Math.min(Math.abs(sweep), Math.PI * 0.9)
  // The first arc turns left into the origin (center at +y), the second turns right out of it.
  const arc1 = arc([0, radius], radius, -Math.PI / 2 - s, s)
  const arc2 = arc([0, -radius], radius, Math.PI / 2, -s)
  const start = primitivePoint(arc1, 0)
  const startDir = primitiveTangent(arc1, 0)
  const end = primitivePoint(arc2, 1)
  const endDir = primitiveTangent(arc2, 1)
  return {
    contours: [
      {
        closed: false,
        primitives: [segment(sub(start, mul(startDir, legLength)), start), arc1, arc2, segment(end, add(end, mul(endDir, legLength)))],
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// Béziers to arcs

function cubicPoint(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const u = 1 - t
  const a = u * u * u
  const b = 3 * u * u * t
  const c = 3 * u * t * t
  const d = t * t * t
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]
}

function splitCubic(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2): [[Vec2, Vec2, Vec2, Vec2], [Vec2, Vec2, Vec2, Vec2]] {
  const mid = (a: Vec2, b: Vec2): Vec2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const a = mid(p0, p1)
  const b = mid(p1, p2)
  const c = mid(p2, p3)
  const d = mid(a, b)
  const e = mid(b, c)
  const f = mid(d, e)
  return [
    [p0, a, d, f],
    [f, e, c, p3],
  ]
}

/** Arc from a, leaving in direction t, through b; a segment when they are in line. */
function arcThrough(a: Vec2, t: Vec2, b: Vec2): Primitive {
  const chord = sub(b, a)
  const n = left(t)
  const denom = 2 * dot(n, chord)
  if (Math.abs(denom) < 1e-12 * Math.max(1e-12, dot(chord, chord)) || Math.abs(denom) < 1e-14) return segment(a, b)
  const rho = dot(chord, chord) / denom
  if (Math.abs(rho) > 1e4 * len(chord)) return segment(a, b)
  const center = add(a, mul(n, rho))
  const radius = Math.abs(rho)
  const start = Math.atan2(a[1] - center[1], a[0] - center[0])
  const end = Math.atan2(b[1] - center[1], b[0] - center[0])
  let sweep = end - start
  // Turning left (rho > 0) means a positive sweep.
  if (rho > 0) {
    while (sweep <= 0) sweep += TAU
  } else {
    while (sweep >= 0) sweep -= TAU
  }
  return arc(center, radius, start, sweep)
}

function distanceToPrimitive(p: Primitive, v: Vec2): number {
  if (p.kind === 'segment') {
    const ab = sub(p.b, p.a)
    const f = Math.min(1, Math.max(0, dot(sub(v, p.a), ab) / Math.max(dot(ab, ab), 1e-30)))
    return len(sub(v, add(p.a, mul(ab, f))))
  }
  const q = sub(v, p.center)
  const a = Math.atan2(q[1], q[0])
  let rel = (a - p.start) * Math.sign(p.sweep)
  rel = ((rel % TAU) + TAU) % TAU
  if (rel <= Math.abs(p.sweep)) return Math.abs(len(q) - p.radius)
  return Math.min(len(sub(v, primitivePoint(p, 0))), len(sub(v, primitivePoint(p, 1))))
}

/** Biarc with equal tangent lengths between p0 (direction t0) and p3 (direction t3). */
function biarc(p0: Vec2, t0: Vec2, p3: Vec2, t3: Vec2): Primitive[] {
  // Tangent length alpha with |v - alpha (t0 + t3)| = 2 alpha.
  const v = sub(p3, p0)
  const t = add(t0, t3)
  const a = dot(t, t) - 4
  const b = -2 * dot(v, t)
  const c = dot(v, v)
  let alpha: number
  if (Math.abs(a) < 1e-9) {
    alpha = b < -1e-12 ? -c / b : Math.sqrt(c) / 2
  } else {
    const root = Math.sqrt(Math.max(0, b * b - 4 * a * c))
    const r1 = (-b + root) / (2 * a)
    const r2 = (-b - root) / (2 * a)
    alpha = r1 > 0 ? r1 : r2
  }
  if (!(alpha > 0) || !Number.isFinite(alpha)) return [segment(p0, p3)]
  const q1 = add(p0, mul(t0, alpha))
  const q2 = sub(p3, mul(t3, alpha))
  const joint: Vec2 = [(q1[0] + q2[0]) / 2, (q1[1] + q2[1]) / 2]
  const tj = norm(sub(q2, q1))
  return [arcThrough(p0, t0, joint), arcThrough(joint, tj, p3)]
}

/** Arcs (and segments) within tolerance of a cubic Bézier, meeting with matching tangents. */
export function cubicToBiarcs(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, tolerance: number, depth = 0): Primitive[] {
  const startHandle = len(sub(p1, p0)) > 1e-9 ? sub(p1, p0) : sub(p2, p0)
  const endHandle = len(sub(p3, p2)) > 1e-9 ? sub(p3, p2) : sub(p3, p1)
  if (len(startHandle) < 1e-12 || len(endHandle) < 1e-12) return [segment(p0, p3)]
  const t0 = norm(startHandle)
  const t3 = norm(endHandle)
  const pieces = biarc(p0, t0, p3, t3)
  let error = 0
  for (let i = 1; i < 16; i++) {
    const point = cubicPoint(p0, p1, p2, p3, i / 16)
    error = Math.max(error, Math.min(...pieces.map((piece) => distanceToPrimitive(piece, point))))
  }
  if (error <= tolerance || depth >= 8) return pieces
  const [first, second] = splitCubic(p0, p1, p2, p3)
  return [...cubicToBiarcs(...first, tolerance, depth + 1), ...cubicToBiarcs(...second, tolerance, depth + 1)]
}

// ---------------------------------------------------------------------------
// Meta logo outline

/** The Meta symbol outline (public/icon-fill.svg before commit 5efa956), viewBox 1000 1000 1504.8272 1000. */
export const META_LOGO_PATH =
  'M2080,1000c-123.3911,0-219.8478,92.936-307.164,210.9931C1652.8473,1058.2153,1552.5,1000,1432.4138,1000,1187.5862,1000,1000,1318.6207,1000,1655.8621,1000,1866.8965,1102.0956,2000,1273.1035,2000c123.0805,0,211.6-58.0259,368.9655-333.1034,0,0,65.5973-115.8413,110.7249-195.6386q23.72,38.2978,49.9647,82.5351l73.7931,124.1379C2020.2989,1918.4789,2100.39,2000,2245.5172,2000c166.5959,0,259.31-134.9233,259.31-350.3448C2504.8276,1296.5517,2313.0118,1000,2080,1000ZM1522.069,1592.4138c-127.5862,200-171.7242,244.8276-242.7587,244.8276-73.1034,0-116.5517-64.1784-116.5517-178.6207,0-244.8276,122.069-495.1724,267.5862-495.1724,78.8013,0,144.6539,45.51,245.5224,189.9131C1580.088,1500.2723,1522.069,1592.4138,1522.069,1592.4138Zm481.5283-25.178-88.23-147.1481q-35.8152-58.2482-68.8384-107.23c79.52-122.7353,145.1135-183.8919,223.1261-183.8919,162.0691,0,291.7243,238.6207,291.7243,531.7241,0,111.7242-36.5935,176.5518-112.4139,176.5518C2176.2949,1837.2414,2141.5787,1789.2474,2003.5973,1567.2358Z'

const LOGO_BOX = { x: 1000, y: 1000, width: 1504.8272, height: 1000 }

type PathPiece = { kind: 'line'; a: Vec2; b: Vec2 } | { kind: 'cubic'; p: [Vec2, Vec2, Vec2, Vec2] }

/** Parses M, L, C, Q and Z (absolute and relative, with implicit repeats) into closed subpaths. */
export function parsePath(path: string): PathPiece[][] {
  const tokens = path.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?|[a-z]/gi) ?? []
  const isCommand = (token: string) => /^[a-z]$/i.test(token)
  const subpaths: PathPiece[][] = []
  let pieces: PathPiece[] = []
  let current: Vec2 = [0, 0]
  let start: Vec2 = [0, 0]
  let command = ''
  let i = 0
  const number = () => {
    const token = tokens[i++]
    if (token === undefined || isCommand(token)) throw new Error('Bad path data')
    return Number(token)
  }
  const point = (relative: boolean, origin: Vec2): Vec2 => {
    const x = number()
    const y = number()
    return relative ? [origin[0] + x, origin[1] + y] : [x, y]
  }
  const close = () => {
    if (pieces.length === 0) return
    if (len(sub(current, start)) > 1e-9) pieces.push({ kind: 'line', a: current, b: start })
    subpaths.push(pieces)
    pieces = []
    current = start
  }
  while (i < tokens.length) {
    if (isCommand(tokens[i])) command = tokens[i++]
    const relative = command === command.toLowerCase()
    switch (command.toUpperCase()) {
      case 'Z':
        close()
        command = ''
        break
      case 'M':
        close()
        current = point(relative, current)
        start = current
        command = relative ? 'l' : 'L'
        break
      case 'L': {
        const b = point(relative, current)
        pieces.push({ kind: 'line', a: current, b })
        current = b
        break
      }
      case 'C': {
        const p1 = point(relative, current)
        const p2 = point(relative, current)
        const p3 = point(relative, current)
        pieces.push({ kind: 'cubic', p: [current, p1, p2, p3] })
        current = p3
        break
      }
      case 'Q': {
        const q = point(relative, current)
        const p3 = point(relative, current)
        const p1: Vec2 = [current[0] + (2 / 3) * (q[0] - current[0]), current[1] + (2 / 3) * (q[1] - current[1])]
        const p2: Vec2 = [p3[0] + (2 / 3) * (q[0] - p3[0]), p3[1] + (2 / 3) * (q[1] - p3[1])]
        pieces.push({ kind: 'cubic', p: [current, p1, p2, p3] })
        current = p3
        break
      }
      default:
        throw new Error(`Unsupported path command: ${command}`)
    }
  }
  close()
  return subpaths
}

let logoCache: Shape | null = null

/**
 * The Meta logo outline as closed contours of arcs and segments, 1 unit tall,
 * centered on the origin (about 1.5 wide). Use crops of it only: never the whole logo.
 */
export function metaLogo(): Shape {
  if (logoCache) return logoCache
  const cx = LOGO_BOX.x + LOGO_BOX.width / 2
  const cy = LOGO_BOX.y + LOGO_BOX.height / 2
  const s = 1 / LOGO_BOX.height
  const map = (v: Vec2): Vec2 => [(v[0] - cx) * s, (v[1] - cy) * s]
  const tolerance = 1e-3
  const contours: Contour[] = parsePath(META_LOGO_PATH).map((pieces) => ({
    closed: true,
    primitives: pieces.flatMap((piece): Primitive[] =>
      piece.kind === 'line'
        ? [segment(map(piece.a), map(piece.b))]
        : cubicToBiarcs(map(piece.p[0]), map(piece.p[1]), map(piece.p[2]), map(piece.p[3]), tolerance),
    ),
  }))
  logoCache = { contours }
  return logoCache
}

/** Only the outer contour of the Meta logo (no holes), same units and placement as metaLogo. */
export function metaLogoEdge(): Shape {
  return { contours: [metaLogo().contours[0]] }
}

/** Distance from v to the nearest point of the shape. */
export function distanceToShape(shape: Shape, v: Vec2): number {
  let best = Infinity
  for (const c of shape.contours) for (const p of c.primitives) best = Math.min(best, distanceToPrimitive(p, v))
  return best
}

/** Winding number contribution of the ray from v toward +x (same rule as the shader). */
export function primitiveWinding(p: Primitive, v: Vec2): number {
  if (p.kind === 'segment') {
    const side = (p.b[0] - p.a[0]) * (v[1] - p.a[1]) - (v[0] - p.a[0]) * (p.b[1] - p.a[1])
    if (p.a[1] <= v[1]) return p.b[1] > v[1] && side > 0 ? 1 : 0
    return p.b[1] <= v[1] && side < 0 ? -1 : 0
  }
  const dy = v[1] - p.center[1]
  if (Math.abs(dy) >= p.radius) return 0
  const dx = Math.sqrt(p.radius * p.radius - dy * dy)
  let w = 0
  for (const x of [dx, -dx]) {
    if (p.center[0] + x <= v[0]) continue
    let rel = (Math.atan2(dy, x) - p.start) * Math.sign(p.sweep)
    rel -= TAU * Math.floor(rel / TAU)
    if (rel >= Math.abs(p.sweep)) continue
    w += Math.sign(p.sweep) * Math.sign(x)
  }
  return w
}

/** Nonzero winding number of a point for a list of closed primitive chains. */
export function windingNumber(primitives: readonly Primitive[], v: Vec2): number {
  let w = 0
  for (const p of primitives) w += primitiveWinding(p, v)
  return w
}
