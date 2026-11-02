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
  const widths = hueWidths(light.hex, 0.35).map(round4)
  const parts: Record<string, number | number[]> = {
    n1Weight: 1.1,
    n1Width: round6(0.0014 / light.soften ** 0.7),
    n1Shape: 8,
    n1Side: 0,
    n1Light: 1,
    n1LightGamma: 1,
    n2Weight: 0.55,
    n2Width: 0.005,
    n2Shape: 3,
    n2Side: light.side,
    n2Light: 1,
    n2LightGamma: 1.3,
    n2ChWidth: widths,
    n2Grow: 2,
    n2GrowBy: [1.8, 2],
    n3Weight: 4.5,
    n3Width: round6(0.0035 / light.soften ** 0.5),
    n3Shape: 4,
    n3Side: 0,
    n3Light: 2,
    n3LightGamma: 2,
    f1Weight: 0.18,
    f1Width: 0.024,
    f1Side: light.side,
    f1Light: 1,
    f1LightGamma: 1.2,
    f1ChWidth: widths,
    f2Weight: 0.04,
    f2Width: 0.035,
    f2Side: 0,
    f2Light: 2,
    f2LightGamma: 1,
  }
  Object.assign(parts, { f3Weight: round4(light.face), f3Width: 0.18, f3Side: 1, f3Light: 2, f3LightGamma: 0.6 })
  return Object.fromEntries(Object.entries(parts).map(([key, value]) => [`${prefix}${key}`, value]))
}
