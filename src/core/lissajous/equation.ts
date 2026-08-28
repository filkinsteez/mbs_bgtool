export const TAU = Math.PI * 2

// The figure family has two members the whole app can select as a base
// curve: the classic Lissajous, and the Meta ∞ mark (a fixed warp of the
// 1:2 figure). Keeping the kind here lets the layout grid, the path lab
// and the motion lab all sample the same geometry.
export type CurveKind = 'lissajous' | 'meta'

// Base curve in unit space [-1,1]²:  x = sin(a·t + phase), y = sin(b·t)
export type CurveParams = { a: number; b: number; phase: number; kind?: CurveKind }

// Legacy parametric centerline used by curve tooling and V1-era flow. It was
// numerically fitted to the former 20x14 asset and is not identity geometry;
// logo silhouettes and V2 identity checks use core/metaSymbol.ts instead.
export const META_PHASE = 1.8956 // ≈ 108.6°
export const META_ASPECT = 0.63
export const META_HARMONICS = {
  a2: -0.0812,
  a3: 0.0229,
  b0: -0.0071,
  b1: 0.2944,
  b2: -0.0945,
  b3: 0.0169,
}

// The Meta y-profile and its derivatives (2π-periodic, so bilateral symmetry
// and the single closed loop survive). Matches spring.ts shapeY at morph = 1.
function metaProfile(v: number): number {
  const { a2, a3, b0, b1, b2, b3 } = META_HARMONICS
  return (
    Math.sin(v) +
    b0 +
    a2 * Math.sin(2 * v) +
    a3 * Math.sin(3 * v) +
    b1 * Math.cos(v) +
    b2 * Math.cos(2 * v) +
    b3 * Math.cos(3 * v)
  )
}

function metaProfileD(v: number): number {
  const { a2, a3, b1, b2, b3 } = META_HARMONICS
  return (
    Math.cos(v) +
    2 * a2 * Math.cos(2 * v) +
    3 * a3 * Math.cos(3 * v) -
    b1 * Math.sin(v) -
    2 * b2 * Math.sin(2 * v) -
    3 * b3 * Math.sin(3 * v)
  )
}

function metaProfileDD(v: number): number {
  const { a2, a3, b1, b2, b3 } = META_HARMONICS
  return (
    -Math.sin(v) -
    4 * a2 * Math.sin(2 * v) -
    9 * a3 * Math.sin(3 * v) -
    b1 * Math.cos(v) -
    4 * b2 * Math.cos(2 * v) -
    9 * b3 * Math.cos(3 * v)
  )
}

// The Meta profile was fitted in the motion lab's y-UP graph space (raised
// crossing = positive y). Artboard space is y-DOWN, so negate the fitted
// profile here to keep the mark upright in layout, path and export renderers.
export function unitPos(p: CurveParams, t: number): [number, number] {
  if (p.kind === 'meta') {
    return [Math.sin(p.a * t + p.phase), -META_ASPECT * metaProfile(p.b * t)]
  }
  return [Math.sin(p.a * t + p.phase), Math.sin(p.b * t)]
}

export function unitVel(p: CurveParams, t: number): [number, number] {
  if (p.kind === 'meta') {
    return [p.a * Math.cos(p.a * t + p.phase), -META_ASPECT * p.b * metaProfileD(p.b * t)]
  }
  return [p.a * Math.cos(p.a * t + p.phase), p.b * Math.cos(p.b * t)]
}

export function unitAcc(p: CurveParams, t: number): [number, number] {
  if (p.kind === 'meta') {
    return [
      -p.a * p.a * Math.sin(p.a * t + p.phase),
      -META_ASPECT * p.b * p.b * metaProfileDD(p.b * t),
    ]
  }
  return [-p.a * p.a * Math.sin(p.a * t + p.phase), -p.b * p.b * Math.sin(p.b * t)]
}
