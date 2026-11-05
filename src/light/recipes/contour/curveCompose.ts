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

/**
 * The item for a seed when a block of 8 seeds (1-8, 9-16, ...) shares out 8
 * items: each seed of the block gets a different one, in an order shuffled per
 * block (salt keeps the orders of different choices apart).
 */
export function blockItem<T>(seed: number, salt: number, items: readonly T[]): T {
  const s = Math.round(seed)
  const order = seededRandom(Math.floor((s - 1) / 8), salt)
  const slots = [...items]
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(order() * (i + 1))
    ;[slots[i], slots[j]] = [slots[j], slots[i]]
  }
  return slots[(((s - 1) % slots.length) + slots.length) % slots.length]
}

/**
 * Where a seed puts its light: eight directions from the frame center, 45
 * degrees apart (x right, y down, in shares of the half frame). Each seed of a
 * block of 8 gets a different one, so no two frames of a block light the same
 * part of the frame.
 */
export const PLACES: readonly Vec2[] = Array.from({ length: 8 }, (_, k) => [Math.round(Math.cos((k * Math.PI) / 4) * 1e6) / 1e6, Math.round(Math.sin((k * Math.PI) / 4) * 1e6) / 1e6])

/** The pack colors bright enough to be a light, shared out over 8 places as evenly as 8 allows, Meta Blue first for the spare ones. */
function lightSlots(pack: ColorPack): PackColor[] {
  const lights = pack.colors.filter((c) => lightness(c.hex) > 0.5)
  return lights.flatMap((c, i) => Array.from({ length: Math.floor(8 / lights.length) + (i < 8 % lights.length ? 1 : 0) }, () => c))
}

/**
 * The light color for a seed: a block of 8 seeds shares out the pack's lights
 * (Bold 2 each; Elemental and Atmospheric 3, 3, 2). It still takes one draw
 * from rand, so the rest of the composition draws as before.
 */
export function pickLight(pack: ColorPack, rand: () => number, seed: number, salt: number): PackColor {
  rand()
  return blockItem(seed, salt, lightSlots(pack))
}

/**
 * Light, shape kind and place for a seed, planned for its whole block of 8 so
 * that frames sharing a light color also differ in kind where the block allows
 * and light parts of the frame as far apart as the places left allow
 * (SHARED.md 10:15 AM: no two of seeds 1-8 look like the same frame).
 */
export function blockPlan<K>(pack: ColorPack, seed: number, salt: number, kinds: readonly K[]): { light: PackColor; kind: K; place: Vec2 } {
  const s = Math.round(seed)
  const first = Math.floor((s - 1) / 8) * 8 + 1
  const lights = Array.from({ length: 8 }, (_, j) => blockItem(first + j, salt, lightSlots(pack)))
  const kindsLeft = Array.from({ length: 8 }, (_, j) => blockItem(first + j, salt + 1, kinds))
  const placesLeft = Array.from({ length: 8 }, (_, j) => blockItem(first + j, salt + 2, PLACES))
  const angle = (p: Vec2) => Math.atan2(p[1], p[0])
  const apart = (a: Vec2, b: Vec2) => Math.abs(Math.atan2(Math.sin(angle(a) - angle(b)), Math.cos(angle(a) - angle(b))))
  const used: { light: PackColor; kind: K; place: Vec2 }[] = []
  for (let j = 0; j <= (((s - 1) % 8) + 8) % 8; j++) {
    const same = used.filter((u) => u.light.hex === lights[j].hex)
    const k = Math.max(0, kindsLeft.findIndex((kind) => !same.some((u) => u.kind === kind)))
    const kind = kindsLeft.splice(k, 1)[0]
    let p = 0
    let far = -1
    placesLeft.forEach((place, i) => {
      const nearest = Math.min(Math.PI, ...same.map((u) => apart(u.place, place)))
      if (nearest > far + 1e-9) {
        far = nearest
        p = i
      }
    })
    used.push({ light: lights[j], kind, place: placesLeft.splice(p, 1)[0] })
  }
  return used[used.length - 1]
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

/** Where Orange-red's own dim tail ends up (linear): the deep red that Yellow's tail also drifts to. */
const DEEP_RED = [1, 0.02, 0]
const FOREST = hexToLinear('#0F3D33')
/** A copper amber (linear) that dim Tan warms toward, so it reads as warm light rather than grey-brown. */
const COPPER = [1, 0.41, 0.1]

/**
 * Where a warm light's dim tail goes (C-025, SHARED.md 10:40 AM): Yellow and
 * Orange-red to deep red, Lime to Forest's deep green; Tan, warm but nearly
 * grey, has no dark pack color to go to, so its halo stays bright and ends
 * sooner instead. Null for cool lights, which keep their color as they dim.
 */
export type WarmTail = 'deep red' | 'forest' | 'bright'

export function warmTail(hex: string): WarmTail | null {
  if (warmToe(hex) === 0) return null
  const [, a, b] = linearToOklab(hexToLinear(hex))
  if (Math.hypot(a, b) < 0.1) return 'bright'
  return (Math.atan2(b, a) * 180) / Math.PI > 110 ? 'forest' : 'deep red'
}

/**
 * How a warm light's color changes as it dims, or null. Yellow drifts like
 * fire: it keeps its color down to about a third of its level, is Orange-red's
 * hue at half its peak lightness and deep red below a quarter, like
 * Orange-red's own tail; Orange-red drifts to the same deep red. Lime drifts
 * to Forest's ratios right away, since it reads olive one stop under its own
 * brightness. Tan keeps its color through its bright band and warms toward
 * copper amber in the short fall at its edge.
 */
export function warmDrift(hex: string): { ratios: number[]; knee: number; sharpness: number } | null {
  const tail = warmTail(hex)
  if (!tail) return null
  const light = hexToLinear(hex)
  const target = tail === 'forest' ? FOREST : tail === 'bright' ? COPPER : DEEP_RED
  const m = light.indexOf(Math.max(...light))
  const ratios = light.map((c, k) => (k === m || c < 1e-6 ? 1 : round4(Math.min(8, target[k] / target[m] / (c / light[m])))))
  switch (tail) {
    case 'deep red':
      return { ratios, knee: 0.6, sharpness: 3 }
    case 'forest':
      return { ratios, knee: 1, sharpness: 3 }
    case 'bright':
      return { ratios, knee: 0.6, sharpness: 2 }
    default: {
      const unknown: never = tail
      throw new Error(`Unknown warm tail: ${String(unknown)}`)
    }
  }
}

/** Oklab lightness of a base: dark enough that text set on it reads, light enough to tell from black. */
const BASE_LIGHTNESS = 0.1

/**
 * Bases a warm light's dim tail must not fade into, because the mix between
 * them is a third color: deep red over Meta Blue turns maroon and magenta,
 * Lime's green over Plum grey, and Tan's copper over Meta Blue mauve-grey,
 * over Forest olive and over Plum maroon.
 */
const BASES_TAIL_MUDDIES: Record<WarmTail, readonly string[]> = {
  'deep red': ['#0064E0'],
  forest: ['#4A0A3C'],
  bright: ['#0064E0', '#0F3D33', '#4A0A3C'],
}

/** Black or one of the pack's darker colors (or Meta Blue) at low light, as slot color and gain, that the light's dim tail fades into cleanly. */
export function pickBase(pack: ColorPack, rand: () => number, lightHex: string): { hex: string; gain: number } {
  const dark = pack.colors.filter((c) => lightness(c.hex) < 0.45)
  const atLow = (hex: string) => ({ hex, gain: round4((BASE_LIGHTNESS / lightness(hex)) ** 3) })
  const tail = warmTail(lightHex)
  const muddy = tail ? BASES_TAIL_MUDDIES[tail] : []
  const options: (readonly [{ hex: string; gain: number }, number])[] = [
    [{ hex: '#000000', gain: 0 }, 3],
    [atLow(pack.colors[0].hex), 1],
    ...dark.map((c) => [atLow(c.hex), 1] as const),
  ]
  return pickWeighted(
    rand,
    options.filter(([o]) => !muddy.includes(o.hex.toUpperCase())),
  )
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
  const spread = light.spread ?? 0
  const parts: Record<string, number | number[]> = {
    n1Weight: 1.1,
    n1Width: round6(0.0014 / light.soften ** 0.7),
    n1Shape: 8,
    n1Side: 0,
    n1Light: 1,
    // The core line fades more slowly than the glow, so it shows along the whole edge (the rim-edge reference's
    // 1 px line is all that is left at its far end).
    n1LightGamma: 0.5,
    // A narrow band of full color beside the pale core, falling off quickly into the face (the rim-edge reference
    // is at Oklab L 0.82, 0.56 and 0.28 at 0.01, 0.02 and 0.04 of the short side from the edge near its corner).
    n2Weight: 0.9,
    n2Width: round6(light.glow ?? 0.005),
    n2Shape: 8,
    n2Side: light.side,
    n2Light: 1,
    n2LightGamma: 1.2,
    n2ChOffset: [round6(spread), 0, round6(-spread)],
    // The glow widens where the light along the edge is strong (the rim-edge reference's glow is about 0.012 of the
    // short side near the corner and a few pixels at its far end).
    n2Grow: 1,
    n2GrowBy: [round4(light.fan ?? 1.5), 2],
    n3Weight: 2.5,
    n3Width: round6(0.0035 / light.soften ** 0.5),
    n3Shape: 4,
    n3Side: 0,
    n3Light: 2,
    n3LightGamma: 2,
    f1Weight: 0.06,
    f1Width: round6(light.haze ?? 0.024),
    f1Side: light.side,
    f1Light: 1,
    f1LightGamma: 1,
    f2Weight: 0.05,
    f2Width: 0.035,
    f2Side: 0,
    f2Light: 2,
    f2LightGamma: 1,
  }
  Object.assign(parts, { f3Weight: round4(light.face), f3Width: 0.35, f3Side: 1, f3Light: 2, f3LightGamma: 0.6 })
  return Object.fromEntries(Object.entries(parts).map(([key, value]) => [`${prefix}${key}`, value]))
}

const prefixed = (prefix: string, values: Record<string, number | number[]>) =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [`${prefix}${key}`, value]))

/**
 * A halo's point-spread function under a key prefix, laid out like a 22 degree
 * halo: dark inside, a fairly sharp rise at the curve, a crest band 0.035
 * outside it (near part 1, the pack color, wider where the light dims, with a
 * near-white core, near part 2)
 * and a long fade outward (far part 2, outside only, half at about 0.15 to 0.19
 * from the crest and close to the base by 0.5). The inside keeps the base level
 * past the crest's inner side. All parts follow light field 1.
 */
export function haloParts(prefix: string, hex: string): Record<string, number | number[]> {
  const outside = { Side: 2, Light: 1, LightGamma: 1, MaskSoft: 0.015 }
  if (warmTail(hex) === 'bright') {
    // A Tan halo keeps most of its light at or above Tan's own brightness: three bands just outside the curve, 1.3
    // widths apart so their sum has no ripple, make a flat stretch a little above Tan's level that ends in a rounded
    // gaussian edge and a faint short tail. The inner band spills past the curve, so the inner edge fades over about
    // a seventh of the short side instead of a crisp limb. The bands widen where the light dims, so the crescent's
    // ends spread and fade instead of narrowing to a point, and its outer edge drifts away from the curve there.
    const band = { ...outside, Shape: 8, Width: 0.035, Weight: 1.25, Grow: 1 }
    const parts: Record<string, number | number[]> = {
      ...prefixed('n1', { ...band, Offset: -0.012, Side: 0, Width: 0.07, GrowBy: [-0.5, 0.5] }),
      ...prefixed('n2', { ...band, Offset: -0.057, Width: 0.07, GrowBy: [-0.1, 0.5] }),
      ...prefixed('n3', { ...band, Offset: -0.102, Width: 0.1, GrowBy: [-0.09, 0.5] }),
      f1Weight: 0,
      ...prefixed('f2', { ...outside, Weight: 0.06, Width: 0.12 }),
      f3Weight: 0,
    }
    return Object.fromEntries(Object.entries(parts).map(([key, value]) => [`${prefix}${key}`, value]))
  }
  // A broad pale arc (the yellow-halo example's, on dark): a band about a sixth of the short side wide just outside
  // the curve, with the light's saturated color in a wide glow beyond it. The band spills past the curve, so its
  // inner edge fades over about a tenth of the short side like the example's, instead of a hard limb. It widens where
  // the light dims, so its ends fade out broad instead of narrowing to a point. The tone curve turns a yellow light
  // between about 1.5 and 5 times its own level into one flat lemon, so the band's body stays near the light's level
  // and only a narrow core (near part 2) goes near white where the light is strong.
  const band = { Side: 0, Offset: -0.05, Light: 1, Grow: 1, GrowBy: [-0.375, 0.5] }
  const parts: Record<string, number | number[]> = {
    ...prefixed('n1', { ...band, Weight: 1.6, Width: 0.17, Shape: 6, LightGamma: 1 }),
    ...prefixed('n2', { ...band, Weight: 9, Width: 0.055, Shape: 8, LightGamma: 2.5 }),
    n3Weight: 0,
    f1Weight: 0,
    ...prefixed('f2', { ...outside, Weight: 0.7, Width: 0.22, MaskSoft: 0.04 }),
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

/** How far past the nearest outline point (short-side units) the dragged hot spot still takes weight from. */
const DRAG_SOFTNESS = 0.12

/**
 * The light of a dragged line on an outline (SHARED.md, "Dragging the light"): brightest at the outline point
 * nearest `from`, running along the outline the way the line points, for as long as the line is. The point is a
 * soft nearest (points up to about DRAG_SOFTNESS farther than the nearest share the weight), so it moves smoothly
 * when `from` passes between two parts of the outline; the outline's direction there is averaged the same way. A line
 * straight across the outline lights both ways alike, so the direction can flip there without a jump. Also the
 * line's own direction (degrees) and length (short-side units). Null when no part of the outline is in the frame.
 */
export function dragLight(
  drag: { from: readonly number[]; to: readonly number[] },
  runs: readonly (readonly Vec2[])[],
  aspect: number,
): { hot: Vec2; angle: number; length: number; back: number; lineAngle: number; lineLength: number } | null {
  const [fw, fh] = frameSize(aspect)
  const from: Vec2 = [(drag.from[0] - 0.5) * fw, (drag.from[1] - 0.5) * fh]
  const to: Vec2 = [(drag.to[0] - 0.5) * fw, (drag.to[1] - 0.5) * fh]
  const points = runs.flatMap((run) =>
    run.map((p, i) => {
      const a = run[Math.max(0, i - 1)]
      const b = run[Math.min(run.length - 1, i + 1)]
      return { p, d: Math.hypot(p[0] - from[0], p[1] - from[1]), tangent: Math.atan2(b[1] - a[1], b[0] - a[0]) }
    }),
  )
  if (points.length === 0) return null
  const nearest = Math.min(...points.map((x) => x.d))
  let wx = 0
  let wy = 0
  let ws = 0
  let c2 = 0
  let s2 = 0
  for (const { p, d, tangent } of points) {
    const w = Math.exp(-(d - nearest) / DRAG_SOFTNESS)
    if (w < 1e-6) continue
    wx += w * p[0]
    wy += w * p[1]
    ws += w
    c2 += w * Math.cos(2 * tangent)
    s2 += w * Math.sin(2 * tangent)
  }
  const axis = Math.atan2(s2, c2) / 2
  const line: Vec2 = [to[0] - from[0], to[1] - from[1]]
  const length = Math.hypot(line[0], line[1])
  const along = length > 1e-6 ? (line[0] * Math.cos(axis) + line[1] * Math.sin(axis)) / length : 0
  return {
    hot: [wx / ws, wy / ws],
    angle: (((along >= 0 ? axis : axis + Math.PI) * 180) / Math.PI + 360) % 360,
    // A soft floor: a very short line still lights a stretch with soft ends instead of a patch with hard sides.
    length: Math.hypot(length, 0.35),
    // Behind the hot spot the light falls 2.5 times faster when the line runs along the outline.
    back: round4(lerp(1, 0.4, Math.abs(along))),
    lineAngle: (Math.atan2(line[1], line[0]) * 180) / Math.PI,
    lineLength: length,
  }
}

/**
 * A thin glass rim under a key prefix (the iridescent-rings reference): a fine bright line on the curve with a soft
 * glow on both sides, the inside faintly lit like a translucent body and a faint glow outside. All parts follow
 * light field 1.
 */
export function ringParts(prefix: string): Record<string, number | number[]> {
  const parts: Record<string, number | number[]> = {
    ...prefixed('n1', { Weight: 0.9, Width: 0.0035, Shape: 8, Side: 0, Offset: 0, Light: 1, LightGamma: 1, Grow: 0 }),
    ...prefixed('n2', { Weight: 0.4, Width: 0.02, Shape: 4, Side: 0, Offset: 0, Light: 1, LightGamma: 1, Grow: 0 }),
    n3Weight: 0,
    ...prefixed('f1', { Weight: 0.2, Width: 0.09, Side: 1, Light: 1, LightGamma: 1, MaskSoft: 0.01 }),
    ...prefixed('f2', { Weight: 0.05, Width: 0.09, Side: 2, Light: 1, LightGamma: 1, MaskSoft: 0.01 }),
    f3Weight: 0,
  }
  return Object.fromEntries(Object.entries(parts).map(([key, value]) => [`${prefix}${key}`, value]))
}

/**
 * A broad pale arc under a key prefix (the yellow-halo reference, on dark): a wide band on the curve that goes pale
 * toward a near-white core, the light's own saturated color falling off inside it, and a short edge outside, so the
 * full color shows only in a band between the pale arc and the dark. All parts follow light field 1.
 */
export function arcParts(prefix: string): Record<string, number | number[]> {
  // The band widens where the light dims, so its two edges spread apart along the curve instead of running parallel,
  // and its ends fade out broad instead of narrowing to a point. As in haloParts, the two bands stay near the light's
  // own level and only a narrow core between them (near part 3) goes near white where the light is strong.
  const band = { Shape: 6, Side: 0, Light: 1, LightGamma: 1, Grow: 1, GrowBy: [-0.4, 0.5], Width: 0.11 }
  const parts: Record<string, number | number[]> = {
    ...prefixed('n1', { ...band, Weight: 1, Offset: 0 }),
    ...prefixed('n2', { ...band, Weight: 0.7, Offset: 0.04 }),
    ...prefixed('n3', { ...band, Weight: 8, Width: 0.04, Shape: 8, Offset: 0.02, LightGamma: 2.5 }),
    ...prefixed('f1', { Weight: 0.55, Width: 0.09, Side: 1, Light: 1, LightGamma: 1, MaskSoft: 0.015 }),
    ...prefixed('f2', { Weight: 0.12, Width: 0.03, Side: 2, Light: 1, LightGamma: 1, MaskSoft: 0.015 }),
    f3Weight: 0,
  }
  return Object.fromEntries(Object.entries(parts).map(([key, value]) => [`${prefix}${key}`, value]))
}

/**
 * The pack color a light's rim shifts toward around a ring: a color its light mixes with cleanly (Meta Blue and
 * Cyan, Orange-red toward Yellow, the Atmospheric greys) or its own dim tail's color (Lime and Forest). Null when
 * there is none: Tan, Meta Blue in Elemental, and Yellow, whose dim rim already runs to Orange-red's hue like fire (an
 * Orange-red stretch on top would leave too little Yellow to read as a Yellow light).
 */
const RING_PARTNERS: Record<string, string> = {
  '#1FCDF0': '#0064E0',
  '#FF4F00': '#FFD61E',
  '#D6F26C': '#0F3D33',
  '#F2F4F7': '#6A7788',
  '#6A7788': '#F2F4F7',
}

/**
 * Whether a light can be thin rims: not Yellow, whose rim would mostly be its Orange-red dim stretch (the fire rule),
 * leaving too little Yellow to read as a Yellow light; a Yellow halo keeps its broad crest.
 */
export function suitsRings(light: PackColor): boolean {
  const [, a, b] = linearToOklab(hexToLinear(light.hex))
  return !(warmTail(light.hex) === 'deep red' && (Math.atan2(b, a) * 180) / Math.PI > 60)
}

export function ringPartner(pack: ColorPack, light: PackColor): PackColor | null {
  const has = (hex: string) => pack.colors.find((c) => c.hex.toUpperCase() === hex) ?? null
  const hex = light.hex.toUpperCase()
  // Meta Blue's partner is Cyan in Bold and Ice in Atmospheric; in Elemental it has none (toward Plum the rim
  // passes through indigo).
  if (hex === '#0064E0') return has('#1FCDF0') ?? has('#F2F4F7')
  return RING_PARTNERS[hex] ? has(RING_PARTNERS[hex]) : null
}

/**
 * The pack color a cool light's line turns toward at its far end (the light-line reference runs from blue to
 * white): Meta Blue toward Cyan or Ice, Cyan, Ice and Steel toward Meta Blue. Null for Meta Blue in Elemental and
 * for warm lights: their drift toward deep red as they dim would take the blue out of a Meta Blue end.
 */
export function linePartner(pack: ColorPack, light: PackColor): PackColor | null {
  const has = (hex: string) => pack.colors.find((c) => c.hex.toUpperCase() === hex) ?? null
  const hex = light.hex.toUpperCase()
  if (hex === '#0064E0') return has('#1FCDF0') ?? has('#F2F4F7')
  if (hex === '#1FCDF0' || hex === '#F2F4F7' || hex === '#6A7788') return has('#0064E0')
  return null
}

/** How flat a Tan light's field is along the curve (the power of its flat-top field). */
export const FLAT_POWER = 6

/**
 * Radius of a flat-top light field (kind 5, exp(-(d / r)^power)) at `hot` that
 * is `factor` times dimmer at the farthest point of the visible path: the light
 * stays near full along most of the curve and falls over a short stretch at
 * its end.
 */
export function flatRadius(path: readonly Vec2[], hot: Vec2, factor: number, power: number, stretch?: { direction: Vec2; by: number }): number {
  const distance = (v: Vec2) => {
    const d: Vec2 = [v[0] - hot[0], v[1] - hot[1]]
    if (!stretch) return Math.hypot(d[0], d[1])
    const u = (d[0] * stretch.direction[0] + d[1] * stretch.direction[1]) / stretch.by
    const w = d[0] * -stretch.direction[1] + d[1] * stretch.direction[0]
    return Math.hypot(u, w)
  }
  const far = Math.max(0.05, ...path.map(distance))
  return far / Math.log(Math.max(1.0001, factor)) ** (1 / power)
}

/** Unit normal of a run of points at the sample nearest to p, from the samples `span` either side (wider is smoother). */
export function normalNear(points: readonly Vec2[], p: Vec2, span = 2): Vec2 {
  if (points.length < 2) return [0, 1]
  let k = 0
  for (let i = 1; i < points.length; i++) if (Math.hypot(points[i][0] - p[0], points[i][1] - p[1]) < Math.hypot(points[k][0] - p[0], points[k][1] - p[1])) k = i
  const a = points[Math.max(0, k - span)]
  const b = points[Math.min(points.length - 1, k + span)]
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
  return [-(b[1] - a[1]) / length, (b[0] - a[0]) / length]
}
