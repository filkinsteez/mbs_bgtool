import { linearToOklab } from '../../color/oklab'
import type { ColorPack, PackColor } from '../../color/packs'
import { hexToLinear } from '../../color/srgb'
import { primitiveLength, primitivePoint, transformShape, type Shape, type Vec2 } from './shapes'

/** Helpers that turn a pack, the tool controls, a seed and a frame aspect into curve light params. */

/** Deterministic random numbers in [0, 1) for a seed and a salt (mulberry32 on a mixed state). */
export function seededRandom(seed: number, salt: number): () => number {
  let a = Math.round(seed) ^ Math.imul(salt + 1, 0x9e3779b9)
  a = Math.imul(a ^ (a >>> 16), 0x85ebca6b)
  a = Math.imul(a ^ (a >>> 13), 0xc2b2ae35)
  a = (a ^ (a >>> 16)) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const clamp01 = (t: number) => Math.min(1, Math.max(0, t))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Piecewise geometric through (0, lo), (0.5, mid), (1, hi); for widths and gains (all > 0). */
export function geo(t: number, lo: number, mid: number, hi: number): number {
  const u = clamp01(t)
  return u < 0.5 ? lo * (mid / lo) ** (u * 2) : mid * (hi / mid) ** ((u - 0.5) * 2)
}

export function pickWeighted<T>(rand: () => number, options: readonly (readonly [T, number])[]): T {
  const total = options.reduce((sum, [, w]) => sum + w, 0)
  let r = rand() * total
  for (const [value, w] of options) {
    r -= w
    if (r <= 0) return value
  }
  return options[options.length - 1][0]
}

/** Frame size in short-side units for width / height. */
export function frameSize(aspect: number): [number, number] {
  return aspect >= 1 ? [aspect, 1] : [1, 1 / aspect]
}

/** Frame position (0..1) of a point given in short-side units from the frame center. */
export function toFrame(point: Vec2, aspect: number): [number, number] {
  const [fw, fh] = frameSize(aspect)
  return [point[0] / fw + 0.5, point[1] / fh + 0.5]
}

const lightness = (hex: string) => linearToOklab(hexToLinear(hex))[0]

/** Pack colors bright enough to be a light, Meta Blue first and most likely. */
export function pickLight(pack: ColorPack, rand: () => number): PackColor {
  const lights = pack.colors.filter((c) => lightness(c.hex) > 0.5)
  return pickWeighted(
    rand,
    lights.map((c, i) => [c, i === 0 ? 2 : 1] as const),
  )
}

/**
 * Paper toe for a light color: warm lights (Oklab hue 20 to 140 degrees with
 * real chroma: Orange-red, Tan, Yellow, Lime) get 0.85, which keeps their dim
 * light amber instead of brick, brown or olive. Cool lights get 0: the toe
 * turns dim Cyan blue and pushes dim Meta Blue toward ultramarine.
 */
export function warmToe(hex: string): number {
  const [, a, b] = linearToOklab(hexToLinear(hex))
  const hue = (Math.atan2(b, a) * 180) / Math.PI
  return Math.hypot(a, b) > 0.04 && hue >= 20 && hue <= 140 ? 0.85 : 0
}

/** Oklab lightness of a base: dark enough that text set on it reads, light enough to tell from black. */
const BASE_LIGHTNESS = 0.1

/** Black or one of the pack's darker colors (or Meta Blue) at low light, as slot color and gain. */
export function pickBase(pack: ColorPack, rand: () => number): { hex: string; gain: number } {
  const dark = pack.colors.filter((c) => lightness(c.hex) < 0.45)
  const atLow = (hex: string) => ({ hex, gain: round4((BASE_LIGHTNESS / lightness(hex)) ** 3) })
  const options: (readonly [{ hex: string; gain: number }, number])[] = [
    [{ hex: '#000000', gain: 0 }, 3],
    [atLow(pack.colors[0].hex), 1],
    ...dark.map((c) => [atLow(c.hex), 1] as const),
  ]
  return pickWeighted(rand, options)
}

/** Channel widths that let the light's strongest channel spread a little wider, so its falloff deepens in its own hue. */
export function hueWidths(hex: string, amount: number): number[] {
  const c = hexToLinear(hex)
  const m = Math.max(c[0], c[1], c[2], 1e-6)
  return c.map((v) => 1 + amount * (v / m - 0.6))
}

/** Points along the emitting contours that fall inside the frame (with a margin), in short-side units from the frame center. */
export function visiblePath(shape: Shape, anchor: Vec2, aspect: number, margin = 0.02): Vec2[] {
  const [fw, fh] = frameSize(aspect)
  const placed = transformShape(shape, { translate: anchor })
  const points: Vec2[] = []
  for (const contour of placed.contours) {
    for (const p of contour.primitives) {
      const steps = Math.max(2, Math.ceil(primitiveLength(p) / 0.01))
      for (let i = 0; i <= steps; i++) {
        const v = primitivePoint(p, i / steps)
        if (Math.abs(v[0]) <= fw / 2 - margin && Math.abs(v[1]) <= fh / 2 - margin) points.push(v)
      }
    }
  }
  return points
}

/**
 * The shape's pieces inside the frame, each an ordered run of points from one
 * frame crossing to the next. A closed contour is read from a point outside
 * the frame, so a piece is never split where the contour starts.
 */
export function visibleRuns(shape: Shape, anchor: Vec2, aspect: number, margin = 0.02): Vec2[][] {
  const [fw, fh] = frameSize(aspect)
  const placed = transformShape(shape, { translate: anchor })
  const runs: Vec2[][] = []
  for (const contour of placed.contours) {
    const points: Vec2[] = []
    for (const p of contour.primitives) {
      const steps = Math.max(2, Math.ceil(primitiveLength(p) / 0.01))
      for (let i = 0; i < steps; i++) points.push(primitivePoint(p, i / steps))
    }
    const inFrame = (v: Vec2) => Math.abs(v[0]) <= fw / 2 - margin && Math.abs(v[1]) <= fh / 2 - margin
    const firstOut = points.findIndex((v) => !inFrame(v))
    const ordered = contour.closed && firstOut > 0 ? [...points.slice(firstOut), ...points.slice(0, firstOut)] : points
    let run: Vec2[] = []
    for (const v of ordered) {
      if (inFrame(v)) run.push(v)
      else if (run.length) {
        runs.push(run)
        run = []
      }
    }
    if (run.length) runs.push(run)
  }
  return runs
}

/**
 * How many of a shape's own points land within `margin` of the frame once the
 * shape is scaled by `size`, mirrored, rotated by `rotate` degrees and moved to
 * `anchor` (the order buildShape and the shader use).
 */
export function pointsNearFrame(points: readonly Vec2[], size: number, rotate: number, flip: boolean, anchor: Vec2, aspect: number, margin: number): number {
  const [fw, fh] = frameSize(aspect)
  const a = (rotate * Math.PI) / 180
  return points.filter(([x, y]) => {
    const sx = x * size
    const sy = (flip ? -y : y) * size
    const px = sx * Math.cos(a) - sy * Math.sin(a) + anchor[0]
    const py = sx * Math.sin(a) + sy * Math.cos(a) + anchor[1]
    return Math.abs(px) <= fw / 2 + margin && Math.abs(py) <= fh / 2 + margin
  }).length
}

/**
 * How many of the logo's parts show in or near the frame for a logo placed
 * like buildShape and the shader place it (size = the logo's height). A part
 * counts once any of its points is within 0.05 plus 0.1 of the logo's height
 * of the frame, because a loop or a notch reads from the curve around it.
 */
export function logoPartsShown(parts: Readonly<Record<string, readonly Vec2[]>>, size: number, rotate: number, flip: boolean, anchor: Vec2, aspect: number): number {
  const margin = 0.05 + 0.1 * size
  return Object.values(parts).filter((points) => pointsNearFrame(points, size, rotate, flip, anchor, aspect, margin) > 0).length
}

/** Total turning of a run of points (radians): how far its direction rotates along it, both ways counted. */
export function turning(run: readonly Vec2[]): number {
  let total = 0
  for (let i = 2; i < run.length; i++) {
    const a = Math.atan2(run[i - 1][1] - run[i - 2][1], run[i - 1][0] - run[i - 2][0])
    const b = Math.atan2(run[i][1] - run[i - 1][1], run[i][0] - run[i - 1][0])
    let d = b - a
    d -= 2 * Math.PI * Math.round(d / (2 * Math.PI))
    total += Math.abs(d)
  }
  return total
}

/** The longest run (by point count, which follows length). */
export function longestRun(runs: readonly Vec2[][]): Vec2[] {
  return runs.reduce<Vec2[]>((best, run) => (run.length > best.length ? run : best), [])
}

/** The point at fraction t of a path's length (the path is treated as ordered samples). */
export function pointAlong(points: readonly Vec2[], t: number): Vec2 | null {
  if (points.length === 0) return null
  if (points.length === 1) return points[0]
  const lengths = points.slice(1).map((p, i) => Math.min(0.05, Math.hypot(p[0] - points[i][0], p[1] - points[i][1])))
  let remaining = clamp01(t) * lengths.reduce((a, b) => a + b, 0)
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i]) {
      const f = lengths[i] > 0 ? remaining / lengths[i] : 0
      return [lerp(points[i][0], points[i + 1][0], f), lerp(points[i][1], points[i + 1][1], f)]
    }
    remaining -= lengths[i]
  }
  return points[points.length - 1]
}

export const round4 = (v: number) => Math.round(v * 1e4) / 1e4
export const round6 = (v: number) => Math.round(v * 1e6) / 1e6

export interface ProductionLight {
  /** Light color hex, for the per-channel widths. */
  hex: string
  /** 1 inside, 2 outside, 0 both sides. */
  side: number
  /** Overall width multiplier from Softness (the recipe applies it to every width). */
  soften: number
  /** Light scattered deep into the face (inside only). */
  face: number
  /** Glow width (near part 2) and haze width (far part 1), short-side units. */
  glow?: number
  haze?: number
  /** Extra width the glow gains where the light is strongest (it fans out there). */
  fan?: number
  /** Colors split across the line: red and blue glow offset to opposite sides by this much. */
  spread?: number
}

/**
 * The point-spread function every Contour pack image uses, as near (n1..n3)
 * and far (f1, f2, f3) part params under a key prefix: a thin core along the
 * whole curve, a glow on the lit side that widens where the light is strong,
 * a hot core that only shows near the hot spot (where it overexposes to
 * white), haze on the lit side, a faint halo on both sides and, for edges,
 * a little light scattered into the face. Light field 1 is the falloff
 * along the curve, light field 2 the hot spot.
 */
export function productionParts(prefix: string, light: ProductionLight): Record<string, number | number[]> {
  // Kept small so the falloff stays in the light's own color family (a wider strongest channel turns Cyan blue).
  const widths = hueWidths(light.hex, 0.15).map(round4)
  const spread = light.spread ?? 0
  const parts: Record<string, number | number[]> = {
    n1Weight: 1.1,
    n1Width: round6(0.0014 / light.soften ** 0.7),
    n1Shape: 8,
    n1Side: 0,
    n1Light: 1,
    n1LightGamma: 1,
    n2Weight: 0.55,
    n2Width: round6(light.glow ?? 0.005),
    n2Shape: 3,
    n2Side: light.side,
    n2Light: 1,
    n2LightGamma: 1.2,
    n2ChWidth: widths,
    n2ChOffset: [round6(spread), 0, round6(-spread)],
    n2Grow: 2,
    n2GrowBy: [round4(light.fan ?? 1.8), 2],
    n3Weight: 6,
    n3Width: round6(0.0035 / light.soften ** 0.5),
    n3Shape: 4,
    n3Side: 0,
    n3Light: 2,
    n3LightGamma: 2,
    f1Weight: 0.18,
    f1Width: round6(light.haze ?? 0.024),
    f1Side: light.side,
    f1Light: 1,
    f1LightGamma: 1,
    f1ChWidth: widths,
    f2Weight: 0.05,
    f2Width: 0.035,
    f2Side: 0,
    f2Light: 2,
    f2LightGamma: 1,
  }
  Object.assign(parts, { f3Weight: round4(light.face), f3Width: 0.18, f3Side: 1, f3Light: 2, f3LightGamma: 0.6 })
  return Object.fromEntries(Object.entries(parts).map(([key, value]) => [`${prefix}${key}`, value]))
}

const prefixed = (prefix: string, values: Record<string, number | number[]>) =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [`${prefix}${key}`, value]))

/**
 * A halo's point-spread function under a key prefix, laid out like a 22 degree
 * halo: dark inside, a fairly sharp rise at the curve, a crest band 0.035
 * outside it (near part 1, the pack color, wider where the light is strong)
 * and a long fade outward (far part 2, outside only, half at about 0.15 to 0.19
 * from the crest and close to the base by 0.5), paler toward its end because
 * the light's strongest channel spreads least. The inside keeps the base level
 * past the crest's inner side. All parts follow light field 1.
 */
export function haloParts(prefix: string, hex: string): Record<string, number | number[]> {
  // Kept small: a light with a near-zero channel (Meta Blue's red, Orange-red's green) would change hue, not pale.
  const paler = hueWidths(hex, -0.2).map(round4)
  const outside = { Side: 2, Light: 1, LightGamma: 1, ChWidth: paler, MaskSoft: 0.015 }
  const parts: Record<string, number | number[]> = {
    ...prefixed('n1', { Weight: 0.25, Width: 0.026, Shape: 8, Side: 0, Offset: -0.035, Light: 1, LightGamma: 1, Grow: 1, GrowBy: [0.5, 1.5] }),
    n2Weight: 0,
    n3Weight: 0,
    f1Weight: 0,
    ...prefixed('f2', { ...outside, Weight: 0.75, Width: 0.27 }),
    f3Weight: 0,
  }
  return Object.fromEntries(Object.entries(parts).map(([key, value]) => [`${prefix}${key}`, value]))
}

/**
 * Radius of a power-falloff light field at `hot` (exponent `power`) that is
 * `factor` times dimmer at the farthest point of the visible path, so the
 * light falls by that much along the curve inside the frame.
 */
export function falloffRadius(path: readonly Vec2[], hot: Vec2, factor: number, power: number, stretch?: { direction: Vec2; by: number }): number {
  // Distances as the light field measures them: along `direction` they count 1 / by as much.
  const distance = (v: Vec2) => {
    const d: Vec2 = [v[0] - hot[0], v[1] - hot[1]]
    if (!stretch) return Math.hypot(d[0], d[1])
    const u = (d[0] * stretch.direction[0] + d[1] * stretch.direction[1]) / stretch.by
    const w = d[0] * -stretch.direction[1] + d[1] * stretch.direction[0]
    return Math.hypot(u, w)
  }
  const far = Math.max(0.05, ...path.map(distance))
  return far / Math.sqrt(Math.max(1e-6, factor ** (2 / power) - 1))
}

/** Unit normal of a run of points at the sample nearest to p. */
export function normalNear(points: readonly Vec2[], p: Vec2): Vec2 {
  if (points.length < 2) return [0, 1]
  let k = 0
  for (let i = 1; i < points.length; i++) if (Math.hypot(points[i][0] - p[0], points[i][1] - p[1]) < Math.hypot(points[k][0] - p[0], points[k][1] - p[1])) k = i
  const a = points[Math.max(0, k - 2)]
  const b = points[Math.min(points.length - 1, k + 2)]
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
  return [-(b[1] - a[1]) / length, (b[0] - a[0]) / length]
}
