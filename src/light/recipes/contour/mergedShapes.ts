import {
  arc,
  contourLength,
  cubicToBiarcs,
  META_LOGO_PATH,
  parsePath,
  primitiveLength,
  primitivePoint,
  ring,
  segment,
  transformShape,
  type Contour,
  type Primitive,
  type Shape,
  type Vec2,
} from './shapes'

const LOGO_BOX = { x: 1000, y: 1000, width: 1504.8272, height: 1000 }
let logoCache: Shape | null = null

/**
 * The Meta logo outline as metaLogo() draws it (1 unit tall, centered), with its curves fitted by fewer arcs: within
 * 0.003 of its height instead of 0.001. The arcs still meet with matching tangents, and a crop fits an emitter's slots.
 */
function mergedLogo(): Shape {
  if (logoCache) return logoCache
  const cx = LOGO_BOX.x + LOGO_BOX.width / 2
  const cy = LOGO_BOX.y + LOGO_BOX.height / 2
  const map = (v: Vec2): Vec2 => [(v[0] - cx) / LOGO_BOX.height, (v[1] - cy) / LOGO_BOX.height]
  logoCache = {
    contours: parsePath(META_LOGO_PATH).map((pieces) => ({
      closed: true,
      primitives: pieces.flatMap((piece): Primitive[] =>
        piece.kind === 'line' ? [segment(map(piece.a), map(piece.b))] : cubicToBiarcs(map(piece.p[0]), map(piece.p[1]), map(piece.p[2]), map(piece.p[3]), 3e-3),
      ),
    })),
  }
  return logoCache
}

/** Shape kinds of the merged Contour look's layouts. */
export const MERGED_SHAPE_KINDS = ['logo', 'roundedSquare', 'ring', 'rings'] as const
export type MergedShapeKind = (typeof MERGED_SHAPE_KINDS)[number]

export interface MergedShapeSpec {
  kind: MergedShapeKind
  /** Logo height, rounded square half side, or ring radius (short sides). */
  size: number
  /** Rounded square corner radius (short sides). */
  radius: number
  /** Degrees. */
  rotate: number
  flip: boolean
  /** Rings beside the main one (the rings kind): x, y and radius of each, around the origin as placed (short sides),
   * radius 0 for none. */
  rings?: readonly number[]
}

/** A closed rounded square around the origin, inside on the left (positive signed area). */
export function roundedSquare(half: number, radius: number): Shape {
  const h = half
  const r = Math.min(Math.max(radius, 1e-4), half)
  const q = Math.PI / 2
  return {
    contours: [
      {
        closed: true,
        primitives: [
          segment([-h + r, -h], [h - r, -h]),
          arc([h - r, -h + r], r, -q, q),
          segment([h, -h + r], [h, h - r]),
          arc([h - r, h - r], r, 0, q),
          segment([h - r, h], [-h + r, h]),
          arc([-h + r, h - r], r, q, q),
          segment([-h, h - r], [-h, -h + r]),
          arc([-h + r, -h + r], r, Math.PI, q),
        ],
      },
    ],
  }
}

function cutAt(p: Primitive, g: number): [Primitive, Primitive] {
  if (p.kind === 'segment') {
    const m = primitivePoint(p, g)
    return [segment(p.a, m), segment(m, p.b)]
  }
  return [arc(p.center, p.radius, p.start, p.sweep * g), arc(p.center, p.radius, p.start + p.sweep * g, p.sweep * (1 - g))]
}

/** The same closed contour starting `f` of its length further on. */
export function startLater(c: Contour, f: number): Contour {
  const frac = f - Math.floor(f)
  if (!c.closed || frac < 1e-6 || frac > 1 - 1e-6) return c
  const target = frac * contourLength(c)
  const before: Primitive[] = []
  const after: Primitive[] = []
  let at = 0
  for (const p of c.primitives) {
    const l = primitiveLength(p)
    if (at + l <= target) before.push(p)
    else if (at >= target) after.push(p)
    else {
      const [a, b] = cutAt(p, (target - at) / l)
      before.push(a)
      after.push(b)
    }
    at += l
  }
  return { closed: true, primitives: [...after, ...before] }
}

/** The layout's shape around the origin: scaled, turned and mirrored. */
export function buildMergedShape(s: MergedShapeSpec): Shape {
  let shape: Shape
  switch (s.kind) {
    case 'logo':
      shape = transformShape(mergedLogo(), { scale: s.size })
      break
    case 'roundedSquare':
      shape = roundedSquare(s.size, s.radius)
      break
    case 'ring':
    case 'rings':
      shape = ring(s.size)
      break
    default: {
      const unknown: never = s.kind
      throw new Error(`Unknown shape: ${String(unknown)}`)
    }
  }
  const placed = transformShape(shape, { rotate: (s.rotate * Math.PI) / 180, flip: s.flip })
  const extra = s.kind === 'rings' ? (s.rings ?? []) : []
  const beside: Contour[] = Array.from({ length: Math.floor(extra.length / 3) }, (_, k) => k)
    .filter((k) => extra[3 * k + 2] > 0)
    .map((k) => ({ closed: true, primitives: [arc([extra[3 * k], extra[3 * k + 1]], extra[3 * k + 2], 0, 2 * Math.PI)] }))
  return beside.length ? { contours: [...placed.contours, ...beside] } : placed
}
