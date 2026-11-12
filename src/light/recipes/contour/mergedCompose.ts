import { linearToOklab } from '../../color/oklab'
import { hexToLinear } from '../../color/srgb'
import type { FieldWant, StagePart } from '../../color/stageFields'
import type { ComposeInput, Composition, ControlValues, ParamValue } from '../../scene'
import {
  dragLight,
  flatRadius,
  frameSize,
  geo,
  lerp,
  logoPartsShown,
  longestRun,
  offFrameGlow,
  offFrameSpread,
  pointAlong,
  pointsNearFrame,
  productionParts,
  round4,
  seededRandom,
  toFrame,
  visibleRuns,
} from './curveCompose'
import { buildMergedShape, MERGED_SHAPE_KINDS, startLater, type MergedShapeSpec } from './mergedShapes'
import { outlineTips } from './rim'
import {
  META_LOGO_LANDMARKS,
  META_LOGO_PARTS,
  contourLength,
  contourPoint,
  primitiveLength,
  primitivePoint,
  segment,
  windingNumber,
  type Contour,
  type Primitive,
  type Shape,
  type Vec2,
} from './shapes'

// The merged Contour look: one light along a pre-made shape. The seed, drag and format place everything; the colors
// only fill the stretches along the edge, the haze each stretch lights and the room, all at one lightness.

// ---------------------------------------------------------------------------
// Pre-made layouts. Targets are fractions of the half frame; logo features in logo units (metaLogo, 1 tall).

type LogoFeature = 'rightTop' | 'rightEnd' | 'rightBottom' | 'ribbon'
const FEATURE: Record<LogoFeature, Vec2> = {
  rightTop: [0.3276, -0.5],
  rightEnd: [0.7524, 0.1497],
  rightBottom: [0.4931, 0.5],
  ribbon: [-0.3, 0.4],
}

interface LayoutDef {
  name: string
  kind: MergedShapeSpec['kind']
  feature?: LogoFeature
  size: number
  radius?: number
  rotate: number
  target: Vec2
  hotAt: number
  /** Size times this in a tall frame, where a shape sized for a wide one would sit whole inside it. */
  tall?: number
  /** The target in a tall frame, where the light from an edge at the wide frame's target would reach only one end. */
  tallTarget?: Vec2
  /** Out of focus: every width times this. */
  blur?: number
  /** Light scattered into the face and haze, times this. */
  fill?: number
  /** The glow and haze lie outside the shape (light behind an edge) instead of inside it. */
  outside?: boolean
  /** Rays through haze from the light behind the edge. */
  rays?: boolean
  /** The core is out of focus too, not only the glow. */
  soft?: boolean
  /** The seed's turn, times this (a horizon only leans a little). */
  turn?: number
  /** How far (logo units, each way) the seed slides the logo's crop point along its outline. */
  slide?: Vec2
  /** A wash: the light fills the whole frame on both sides of the edge, brightest along it. */
  wash?: boolean
}

// Large crops: the outline crosses the frame and the face it lights takes a real share of it.
const LAYOUTS: readonly LayoutDef[] = [
  { name: 'Arch', kind: 'logo', feature: 'rightTop', size: 4.2, rotate: 0, target: [0.1, -0.05], hotAt: 0.5, slide: [0.1, 0.01] },
  { name: 'Loop end', kind: 'logo', feature: 'rightEnd', size: 3.4, rotate: 0, target: [0.1, 0.05], hotAt: 0.45, tall: 1.4, slide: [0.01, 0.12] },
  { name: 'Bend', kind: 'logo', feature: 'rightBottom', size: 4.4, rotate: -25, target: [-0.15, 0.2], hotAt: 0.5, slide: [0.1, -0.01] },
  { name: 'Corner', kind: 'roundedSquare', size: 2.4, radius: 0.6, rotate: -12, target: [0.3, -0.2], hotAt: 0.5 },
  { name: 'Ribbon', kind: 'logo', feature: 'ribbon', size: 4.6, rotate: -30, target: [0, 0.05], hotAt: 0.5, slide: [0.08, 0.04] },
  { name: 'Close', kind: 'roundedSquare', size: 1.6, radius: 0.8, rotate: 72, target: [-0.2, 0.2], hotAt: 0.5, blur: 3.2, fill: 2.6 },
  { name: 'Horizon', kind: 'ring', size: 5, rotate: 0, target: [0, 0.3], hotAt: 0.5, blur: 1.4, fill: 1.6, outside: true, rays: true, turn: 0.3 },
  { name: 'Wash', kind: 'ring', size: 3.4, rotate: 0, target: [-0.1, -0.1], tallTarget: [-0.1, 0], hotAt: 0.5, tall: 1.2, blur: 3, fill: 3.4, soft: true, outside: true, wash: true },
]

/** The shapes in the order the panel shows them; a seed's shape is `shapeOfSeed`. */
export const MERGED_SHAPES: readonly string[] = LAYOUTS.map((l) => l.name)

const rot = (v: Vec2, degrees: number): Vec2 => {
  const a = (degrees * Math.PI) / 180
  return [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)]
}

interface Jitter {
  turn: number
  shift: Vec2
  scale: number
  mirror: boolean
  /** -1..1: which stretch of the outline the crop shows (LayoutDef.slide; a square's corner rounds more or less). */
  slide: number
}

/** A logo crop shows one part of the logo: no second part and no second landmark comes near the frame. */
function logoTooWide(spec: MergedShapeSpec, anchor: Vec2, aspect: number): boolean {
  return (
    logoPartsShown(META_LOGO_PARTS, spec.size, spec.rotate, spec.flip, anchor, aspect) > 1 ||
    pointsNearFrame(META_LOGO_LANDMARKS, spec.size, spec.rotate, spec.flip, anchor, aspect, 0.05 + 0.15 * spec.size) > 1
  )
}

function placeLayout(def: LayoutDef, aspect: number, jitter: Jitter, homeAt: number): { spec: MergedShapeSpec; anchor: Vec2 } {
  const [fw, fh] = frameSize(aspect)
  const at = aspect < 1 && def.tallTarget ? def.tallTarget : def.target
  const target: Vec2 = [(at[0] + jitter.shift[0]) * (fw / 2), (at[1] + jitter.shift[1]) * (fh / 2)]
  const radius = (def.radius ?? 0.3) * jitter.scale * (def.kind === 'roundedSquare' ? 1 + 0.4 * jitter.slide : 1)
  const rotate = def.rotate + jitter.turn * (def.turn ?? 1)
  const place = (size: number) => {
    let point: Vec2
    if (def.kind === 'logo') {
      const base = FEATURE[def.feature ?? 'rightTop']
      const slide = def.slide ?? [0, 0]
      const f: Vec2 = [base[0] + slide[0] * jitter.slide, base[1] + slide[1] * jitter.slide]
      point = rot([f[0] * size, f[1] * size], rotate)
    } else if (def.kind === 'roundedSquare') {
      const c = size - radius + radius / Math.SQRT2
      point = rot([c, c], rotate)
    } else {
      const away = Math.hypot(target[0], target[1]) > 1e-3 ? target : ([0.3, 0.4] as Vec2)
      const l = Math.hypot(away[0], away[1])
      point = [(-away[0] / l) * size, (-away[1] / l) * size]
    }
    let anchor: Vec2 = [target[0] - point[0], target[1] - point[1]]
    let spec: MergedShapeSpec = { kind: def.kind, size, radius, rotate, flip: false }
    if (jitter.mirror) {
      spec = { ...spec, flip: true, rotate: 180 - rotate }
      anchor = [-anchor[0], anchor[1]]
    }
    return { spec, anchor }
  }
  let size = def.size * jitter.scale * (aspect < 1 ? (def.tall ?? 1) : 1)
  let placed = place(size)
  // Never the whole logo: a crop that would show more than one part of it is made larger around the same point.
  for (let k = 0; def.kind === 'logo' && k < 16 && logoTooWide(placed.spec, placed.anchor, aspect); k++) {
    size *= 1.15
    placed = place(size)
  }
  // A crop whose light (the seed's place along the visible edge) sits to one side moves part of the way toward the
  // middle (not a horizon or a wash, whose edge sits low on purpose), unless that would show more of the logo.
  if (!def.outside) {
    const mid = pointAlong(longestRun(visibleRuns(buildMergedShape(placed.spec), placed.anchor, aspect)), homeAt)
    const off = mid ? Math.hypot(mid[0], mid[1]) : 0
    if (mid && off > RECENTRE_FROM) {
      const k = Math.min(RECENTRE_MAX, 0.6 * (off - RECENTRE_FROM)) / off
      const moved = { spec: placed.spec, anchor: [placed.anchor[0] - k * mid[0], placed.anchor[1] - k * mid[1]] as Vec2 }
      if (!(def.kind === 'logo' && logoTooWide(moved.spec, moved.anchor, aspect))) placed = moved
    }
  }
  return placed
}

/** Re-centring: from how far off the middle (short sides) the visible edge's midpoint moves in, and at most how far. */
const RECENTRE_FROM = 0.15
const RECENTRE_MAX = 0.3

/**
 * The layout of each of nine seeds in turn. The sixth was Halo, separate rings that the owner removed (2026-11-11,
 * "dont think we need this one"); its seeds draw another layout, and every other seed keeps its layout and design.
 */
const SEED_SLOTS: readonly (number | null)[] = [0, 1, 2, 3, 4, null, 5, 6, 7]

/**
 * A seed in a free slot: a seeded pick among the logo layouts that the seed before and after it don't show, turned a
 * quarter turn either way, so its crop shows the outline from another side than the seeds already showing that layout
 * and is not a moved copy of them. A rounded square's corner or a ring looks the same turned, so those are left out.
 */
function freedLayout(s: number, slot: number): { layout: number; turn: number } {
  const n = SEED_SLOTS.length
  const neighbours = [SEED_SLOTS[(slot + n - 1) % n], SEED_SLOTS[(slot + 1) % n]]
  const choices = LAYOUTS.map((_, i) => i).filter((i) => LAYOUTS[i].kind === 'logo' && !neighbours.includes(i))
  const rand = seededRandom(s, 6151)
  const layout = choices[Math.min(choices.length - 1, Math.floor(rand() * choices.length))]
  return { layout, turn: rand() < 0.5 ? -90 : 90 }
}

/**
 * The seed's design, from the seed alone. Seeds that share a shape (seed, seed + 9, ...) differ in which part of the
 * outline is in the frame and how big, the turn and mirror, where the light sits along it and how far its haze reaches.
 */
export function seedDesign(seed: number) {
  const s = Math.round(seed)
  const rand = seededRandom(s, 913)
  const variant = Math.floor((s - 1) / SEED_SLOTS.length)
  const turn = lerp(-24, 24, rand())
  const shift: Vec2 = [lerp(-0.12, 0.12, rand()), lerp(-0.12, 0.12, rand())]
  const scale = lerp(0.85, 1.25, rand())
  const mirror = (variant % 2 === 1) !== (rand() < 0.25)
  const draws = {
    hotShift: lerp(-0.35, 0.35, rand()),
    reachDraw: rand(),
    powerDraw: rand(),
    hotDraw: rand(),
    hazeDraw: rand(),
    rayDraw: rand(),
    keyDraw: rand(),
  }
  // Seeds that share a shape also differ in which stretch of the outline is in the frame, and in how strongly and how
  // far into the face the light reaches.
  const slot = (((s - 1) % SEED_SLOTS.length) + SEED_SLOTS.length) % SEED_SLOTS.length
  const freed = SEED_SLOTS[slot] === null ? freedLayout(s, slot) : null
  const jitter: Jitter = { turn: turn + (freed?.turn ?? 0), shift, scale, mirror, slide: lerp(-1, 1, rand()) }
  const face = { faceDraw: rand(), faceReachDraw: rand() }
  // The second light: which side it takes (the other edge when one shows, else the far stretch), where along it, how
  // strong and how long.
  const second = { secondSide: rand(), secondAt: rand(), secondGain: rand(), secondWidth: rand() }
  return { layout: freed?.layout ?? SEED_SLOTS[slot] ?? 0, jitter, ...draws, ...face, ...second }
}

/** Index into MERGED_SHAPES of the seed's shape. */
export const shapeOfSeed = (seed: number): number => seedDesign(seed).layout

/** The seed that shows `shape` and keeps the seed's own place among the seeds sharing a shape, from 1 to `max`. */
export function seedWithShape(seed: number, shape: number, max = 100): number {
  const n = SEED_SLOTS.length
  const variant = Math.floor((Math.round(seed) - 1) / n)
  const k = ((Math.round(shape) % LAYOUTS.length) + LAYOUTS.length) % LAYOUTS.length
  let s = variant * n + SEED_SLOTS.indexOf(k) + 1
  while (s > max) s -= n
  return Math.max(1, s)
}

// ---------------------------------------------------------------------------
// The shape as drawn

/** Points that bound a primitive: its ends, its middle and, for arcs, the extreme points inside its sweep. */
function extremes(p: Primitive): Vec2[] {
  if (p.kind === 'segment') return [p.a, p.b]
  const points = [primitivePoint(p, 0), primitivePoint(p, 0.5), primitivePoint(p, 1)]
  const lo = Math.min(p.start, p.start + p.sweep)
  const hi = Math.max(p.start, p.start + p.sweep)
  for (let k = Math.ceil(lo / (Math.PI / 2)); k * (Math.PI / 2) <= hi; k++) points.push([p.center[0] + p.radius * Math.cos((k * Math.PI) / 2), p.center[1] + p.radius * Math.sin((k * Math.PI) / 2)])
  return points
}

const FAR_MARGIN = 0.2

/**
 * Pieces of a closed contour that stay more than FAR_MARGIN short sides from the frame are merged into chords that
 * also stay clear of it, so a large shape fits an emitter's slots. Their light fell outside the frame anyway, and the
 * contour stays closed, so the inside test near the frame is unchanged. `anchor` in short sides from the frame center.
 */
function simplifyFar(shape: Shape, anchor: Vec2, aspect: number): Shape {
  const [fw, fh] = frameSize(aspect)
  const frame = [-fw / 2 - anchor[0], -fh / 2 - anchor[1], fw / 2 - anchor[0], fh / 2 - anchor[1]]
  const outside = (v: Vec2) => Math.hypot(Math.max(frame[0] - v[0], 0, v[0] - frame[2]), Math.max(frame[1] - v[1], 0, v[1] - frame[3]))
  const far = (p: Primitive) => extremes(p).every((v) => outside(v) > FAR_MARGIN)
  // A long chord can pass between the nine samples and cut across a corner of the frame. The distance to the frame is
  // convex along a line, so narrowing in on its least value finds any such crossing.
  const crossesFrame = (a: Vec2, b: Vec2) => {
    const gap = (f: number) => outside([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f])
    let [lo, hi] = [0, 1]
    for (let k = 0; k < 48; k++) {
      const m1 = lo + (hi - lo) / 3
      const m2 = hi - (hi - lo) / 3
      if (gap(m1) < gap(m2)) hi = m2
      else lo = m1
    }
    return gap((lo + hi) / 2) <= 1e-6
  }
  const chordClear = (a: Vec2, b: Vec2) =>
    Array.from({ length: 9 }, (_, k) => k / 8).every((f) => outside([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]) > 0.5 * FAR_MARGIN) && !crossesFrame(a, b)
  return {
    contours: shape.contours.map((c): Contour => {
      if (!c.closed) return c
      const first = c.primitives.findIndex((p) => !far(p))
      if (first < 0) return c
      const ordered = [...c.primitives.slice(first), ...c.primitives.slice(0, first)]
      const out: Primitive[] = []
      let chordStart: Vec2 | null = null
      let chordEnd: Vec2 | null = null
      const flush = () => {
        if (chordStart && chordEnd) out.push(segment(chordStart, chordEnd))
        chordStart = null
        chordEnd = null
      }
      for (const p of ordered) {
        if (!far(p)) {
          flush()
          out.push(p)
          continue
        }
        const a = primitivePoint(p, 0)
        const b = primitivePoint(p, 1)
        if (chordStart && chordClear(chordStart, b)) chordEnd = b
        else {
          flush()
          chordStart = a
          chordEnd = b
        }
      }
      flush()
      return { closed: true, primitives: out.filter((p) => primitiveLength(p) > 1e-9) }
    }),
  }
}

/** The seed's shape as drawn: placed, far pieces merged, before any contour is started elsewhere. */
export function mergedShape(spec: MergedShapeSpec, anchor: Vec2, aspect: number): Shape {
  return simplifyFar(buildMergedShape(spec), anchor, aspect)
}

/** Each closed contour started `starts[i]` of its length further on (moves where the color stops sit). */
export function startedShape(shape: Shape, starts: readonly number[]): Shape {
  return { contours: shape.contours.map((c, i) => startLater(c, starts[i] ?? 0)) }
}

/** The fraction along a primitive of its point nearest q, and the distance to it. */
function nearestOnPrimitive(pr: Primitive, q: Vec2): { f: number; d: number } {
  if (pr.kind === 'segment') {
    const ab: Vec2 = [pr.b[0] - pr.a[0], pr.b[1] - pr.a[1]]
    const len2 = ab[0] * ab[0] + ab[1] * ab[1]
    const f = len2 > 1e-18 ? Math.min(1, Math.max(0, ((q[0] - pr.a[0]) * ab[0] + (q[1] - pr.a[1]) * ab[1]) / len2)) : 0
    return { f, d: Math.hypot(pr.a[0] + ab[0] * f - q[0], pr.a[1] + ab[1] * f - q[1]) }
  }
  const sweep = Math.abs(pr.sweep)
  let rel = (Math.atan2(q[1] - pr.center[1], q[0] - pr.center[0]) - pr.start) * Math.sign(pr.sweep || 1)
  rel -= 2 * Math.PI * Math.floor(rel / (2 * Math.PI))
  if (rel <= sweep) return { f: sweep > 0 ? rel / sweep : 0, d: Math.abs(Math.hypot(q[0] - pr.center[0], q[1] - pr.center[1]) - pr.radius) }
  const a = primitivePoint(pr, 0)
  const b = primitivePoint(pr, 1)
  const da = Math.hypot(a[0] - q[0], a[1] - q[1])
  const db = Math.hypot(b[0] - q[0], b[1] - q[1])
  return da <= db ? { f: 0, d: da } : { f: 1, d: db }
}

/**
 * Fraction along each contour (by length) of its point nearest p, found exactly piece by piece so it moves smoothly
 * with p, and the nearest contour overall.
 */
function nearestOnContours(shape: Shape, anchor: Vec2, p: Vec2): { contour: number; ts: number[]; ds: number[] } {
  const q: Vec2 = [p[0] - anchor[0], p[1] - anchor[1]]
  let best = { contour: 0, d: Infinity }
  const ds: number[] = []
  const ts = shape.contours.map((c, ci) => {
    const total = c.primitives.reduce((s, pr) => s + primitiveLength(pr), 0)
    let at = 0
    let bt = 0
    let bd = Infinity
    for (const pr of c.primitives) {
      const l = primitiveLength(pr)
      const { f, d } = nearestOnPrimitive(pr, q)
      if (d < bd) {
        bd = d
        bt = total > 0 ? (at + f * l) / total : 0
      }
      at += l
    }
    if (bd < best.d) best = { contour: ci, d: bd }
    ds.push(bd)
    return bt
  })
  return { contour: best.contour, ts, ds }
}

// ---------------------------------------------------------------------------
// Colors (a stand-in until the shared color stage colors the look from its parts). Only Oklab lightness, chroma and
// hue are read; no names, no pack, no position of any one color.

const oklab = (hex: string) => linearToOklab(hexToLinear(hex))
const L = (hex: string) => oklab(hex)[0]
const chroma = (hex: string) => Math.hypot(oklab(hex)[1], oklab(hex)[2])
const hue = (hex: string) => ((Math.atan2(oklab(hex)[2], oklab(hex)[1]) * 180) / Math.PI + 360) % 360
const hueApart = (a: string, b: string) => {
  const d = Math.abs(hue(a) - hue(b)) % 360
  return d > 180 ? 360 - d : d
}
const LIGHT_L = 0.45
const neutral = (hex: string) => chroma(hex) < 0.05
/** Yellows, limes and tans read olive or brown when dim. */
const warmYellow = (hex: string) => !neutral(hex) && hue(hex) >= 60 && hue(hex) <= 140
/** Colors that only read as themselves when bright: warm yellows, and light greys (dim they read as a darker grey). */
const brightOnly = (hex: string) => warmYellow(hex) || (neutral(hex) && L(hex) >= LIGHT_L)
const mixesClean = (a: string, b: string) => neutral(a) || neutral(b) || hueApart(a, b) <= 70

/**
 * The darker pack color a bright-only color dims through, the way a fire dims: the nearest darker grey for a grey;
 * for a warm yellow, the nearest-hue darker color within 60 degrees that is neither a warm yellow nor grey. Null for
 * colors that keep their hue as they dim, and for a bright-only color with no such neighbour.
 */
function dimPartner(hex: string, palette: readonly string[]): string | null {
  if (!brightOnly(hex)) return null
  const darker = palette.filter((d) => d !== hex && L(d) < L(hex) - 0.08)
  if (neutral(hex)) return darker.filter(neutral).sort((a, b) => L(b) - L(a))[0] ?? null
  return darker.filter((d) => !warmYellow(d) && !neutral(d) && hueApart(hex, d) <= 60).sort((a, b) => hueApart(hex, a) - hueApart(hex, b))[0] ?? null
}

/** Default shares: every color shows; the color with Meta Blue's hex 50%, the rest even (owner, 2026-11-09). */
export function defaultShares(colors: readonly string[]): number[] {
  const blue = colors.findIndex((c) => c.toUpperCase() === '#0064E0')
  if (blue < 0 || colors.length < 2) return colors.map(() => 1 / colors.length)
  return colors.map((_, i) => (i === blue ? 0.5 : 0.5 / (colors.length - 1)))
}

interface Stretch {
  /** Index into the colors. */
  color: number
  unit: number
  /** Along the visible edge, 0 at its low end and 1 at its high end. */
  from: number
  to: number
}

interface Unit {
  /** Color indexes, brightest first. */
  colors: number[]
  /** The unit's own color index: its largest share. */
  own: number
  /** The hex its dim light drifts to, or null. */
  dimTo: string | null
}

interface ColorPlan {
  units: Unit[]
  stretches: Stretch[]
  key: number
  /** The unit that is the second light (left out of the stretches), or -1. */
  second: number
  /** Dark room tints near the light and away from it: color index, or -1 for black. */
  ground: { near: number; far: number }
}

/** An accent's stretch is this share of its color's share of the light colors: long enough that the main ring walks
 * through the pack's colors beside its core, Meta Blue still holding the longest stretch. */
const ACCENT = 2
/** The least of the edge the key keeps at each end beyond the accents. */
const KEY_END = 0.02

/**
 * The stand-in color filler: the leading color is the light along the whole edge, through the core and out to both
 * ends, with its haze; the other light colors are accents beside the core (colors that only read when bright nearest
 * it). Up to three units of colors that dim together. `hotAt` is where the light sits along the visible edge (0..1).
 */
function planColors(colors: readonly string[], shares: readonly number[], keyDraw: number, hotAt: number, accentScale: number, cleanOnly: boolean): ColorPlan {
  const on = colors.map((_, i) => i).filter((i) => shares[i] > 0.001)
  const lights = on.filter((i) => L(colors[i]) >= LIGHT_L)
  const darks = on.filter((i) => L(colors[i]) < LIGHT_L)
  const pool = lights.length ? lights : on
  const total = pool.reduce((s, i) => s + shares[i], 0) || 1
  const share = (i: number) => shares[i] / total
  const most = Math.max(...pool.map(share))
  const leading = pool.filter((i) => share(i) >= 0.5 * most - 1e-9)
  const key = leading[Math.min(leading.length - 1, Math.floor(keyDraw * leading.length))]

  // A bright-only color and the light color it dims through share a unit; every other light is its own.
  const byBright = [...pool].sort((a, b) => L(colors[b]) - L(colors[a]))
  const taken = new Set<number>()
  let units: Unit[] = []
  for (const i of byBright) {
    if (taken.has(i)) continue
    taken.add(i)
    const partner = dimPartner(colors[i], on.map((k) => colors[k]))
    const partnerIndex = partner ? pool.find((k) => colors[k] === partner && !taken.has(k)) : undefined
    const members = partnerIndex !== undefined ? [i, partnerIndex] : [i]
    if (partnerIndex !== undefined) taken.add(partnerIndex)
    const own = members.reduce((a, b) => (share(b) > share(a) + 1e-9 ? b : a))
    units.push({ colors: members, own, dimTo: dimPartner(colors[own], on.map((k) => colors[k])) })
  }
  if (units.length > 3) units = [...units].sort((a, b) => b.colors.reduce((s, i) => s + share(i), 0) - a.colors.reduce((s, i) => s + share(i), 0)).slice(0, 3)
  const unitOf = (i: number) => units.findIndex((u) => u.colors.includes(i))
  const keyUnit = unitOf(key)
  const shownTotal = units.flatMap((u) => u.colors).reduce((s, i) => s + share(i), 0) || 1
  const width = (i: number) => share(i) / shownTotal

  // The second light takes the warmest other unit (red over blue; else the lightest) and leaves the core's accents.
  const warmth = (i: number) => warmthOf(colors[i])
  const second = units
    .map((_, k) => k)
    .filter((k) => k !== keyUnit)
    .sort((a, b) => warmth(units[b].own) - warmth(units[a].own) || L(colors[units[b].own]) - L(colors[units[a].own]))[0] ?? -1
  // Far out of focus an accent spreads over the key's light, so there only colors that mix clean with the key show.
  const accents = units.map((_, k) => k).filter((k) => k !== keyUnit && k !== second && (!cleanOnly || mixesClean(colors[units[k].own], colors[key])))
  // With accents on both sides the key's partner gets no stretch, so the key's unit turns only four times and its
  // eight stops reach both ends of the edge.
  const keyPartners = accents.length >= 2 ? [] : units[keyUnit].colors.filter((i) => i !== key)
  const needsLight = (k: number) => (brightOnly(colors[units[k].own]) ? 0 : 1)
  accents.sort((a, b) => needsLight(a) - needsLight(b) || units[b].colors.reduce((s, i) => s + width(i), 0) - units[a].colors.reduce((s, i) => s + width(i), 0))
  const sides: number[][] = [[...keyPartners], []]
  accents.forEach((k, n) => sides[(n + (keyPartners.length ? 1 : 0)) % 2].push(...units[k].colors))
  const core = Math.max(0.04, Math.min(0.12, 0.25 * width(key)))
  // The accents shrink together where they would leave the key less than KEY_END of the edge at either end, so the key
  // still lights the edge out to both ends.
  const rawWidth = (i: number) => ACCENT * accentScale * width(i)
  const rawAccents = [...sides[0], ...sides[1]].reduce((s, i) => s + rawWidth(i), 0)
  const fit = Math.min(1, Math.max(0, 1 - core - 2 * KEY_END) / Math.max(rawAccents, 1e-9))
  const accentWidth = (i: number) => rawWidth(i) * fit
  const lowAccents = sides[0].reduce((s, i) => s + accentWidth(i), 0)
  const highAccents = sides[1].reduce((s, i) => s + accentWidth(i), 0)
  const coreFrom = Math.min(Math.max(hotAt - core / 2, lowAccents + KEY_END), 1 - highAccents - core - KEY_END)
  const stretches: Stretch[] = []
  const push = (color: number, from: number, to: number) => {
    if (to - from > 1e-4) stretches.push({ color, unit: unitOf(color), from, to })
  }
  let at = coreFrom - lowAccents
  push(key, 0, at)
  for (const i of [...sides[0]].reverse()) {
    push(i, at, at + accentWidth(i))
    at += accentWidth(i)
  }
  push(key, at, at + core)
  at += core
  for (const i of sides[1]) {
    push(i, at, at + accentWidth(i))
    at += accentWidth(i)
  }
  push(key, at, 1)

  // The room: a dark color that mixes clean with the key near the light, another (or the same) away from it.
  const byShare = [...darks].sort((a, b) => shares[b] - shares[a])
  const near = byShare.find((i) => mixesClean(colors[i], colors[key])) ?? -1
  const far = byShare.find((i) => i !== near) ?? near
  return { units, stretches, key, second, ground: { near, far } }
}

// ---------------------------------------------------------------------------

export interface MergedInput {
  colors: readonly string[]
  shares?: readonly number[]
  controls: ControlValues
  seed: number
  aspect: number
  /** Pin a shape (index into MERGED_SHAPES) instead of the seed's. */
  layout?: number
}

/** Ratios that move a color's non-largest channels toward `to`'s, for the shader's dim drift. */
function driftRatios(own: string, to: string): number[] {
  const c = hexToLinear(own)
  const t = hexToLinear(to)
  const m = c.indexOf(Math.max(...c))
  return c.map((v, k) => (k === m || v < 1e-6 ? 1 : round4(Math.min(8, Math.max(0.02, t[k] / Math.max(t[m], 1e-6) / (v / c[m]))))))
}

/** Crossfade half-width along the edge (fraction of the visible edge); a narrow stretch is all fade. */
const FADE = 0.1
const STOPS = 8
/** Oklab lightness of the room's dark tint: under the same-design check's rank step, so a black room counts the same. */
const ROOM_L = 0.05
/**
 * The stand-in whose lightness every light stands at (Meta Blue's, the default lead): an off-frame light's glow is
 * shaped for it, so its reach never follows the color.
 */
const STAND_IN = '#0064E0'
/** How much farther the second edge must be than the nearest (frame units) before the accents show in full. */
const BETWEEN = 0.25

/** Emitter units in the recipe (merged.ts UNITS). */
const MERGED_UNITS = 3
/** The second light along its edge: stop offsets (times its half length) and levels (times its peak). */
const SECOND_SHAPE = [-1, -0.65, -0.3, 0, 0.3, 0.65, 1]
const SECOND_LEVEL = [0, 0.35, 0.8, 1, 0.8, 0.35, 0]
/** Outside a wash the second light fades in and out along the outline over a third of its length at each end, so it
 * reads as the outline's light changing color: stop offsets (times its half length) and levels. On the main edge it is
 * this much longer than it was. */
const FADE_SHAPE = [-1, -0.67, -0.33, 0, 0.33, 0.67, 1]
const FADE_LEVEL = [0, 0.25, 0.75, 1, 0.75, 0.25, 0]
const SECOND_LONGER = 1.35
/** A warm and a cool second light's peak range, times the main light's level. */
const WARM_PEAK = [0.65, 0.9]
const COOL_PEAK = [0.38, 0.5]
/** Outside a wash its haze and face light against the main light's: its own glow carries its color, and a wide dim
 * halo around it would take the main light's color through the stage. */
const STRETCH_FAR = 0.2
/** A second light that is a ring of its own (another edge, clear of the main one): its haze and face light and their
 * reach (times the main light's), and how wide its color stage parts are, so its color fills its halo. */
const RING_FAR = 0.45
const RING_REACH = 0.8
const RING_PART_WIDTH = 0.16
/** A ring's face light against its haze's share of the main light's. */
const RING_FACE = 2.5
/** How far a ring's stretch keeps from the main light's edge (short sides): nearer, its halo met the main light's. */
const RING_CLEAR = 0.4
/** How far a ring's stretch keeps from the main light's edge (short sides) to be warm: its halo and the main light's
 * haze then stay apart. */
const WARM_RING_CLEAR = 0.45
/** A ring's core line against the main light's. */
const RING_CORE = 1.6
/** Another edge's own light: its half length (this share of its visible length, within these bounds), how far its
 * hottest place keeps from the main light, and its core line (times the main one). */
const EDGE_SHARE = 0.33
const EDGE_HALF_MIN = 0.25
const EDGE_HALF_MAX = 0.8
const EDGE_KEEP_OFF = 0.45
/** How far inside the frame's sides another edge's light has its hottest place (short sides). */
const EDGE_MARGIN = 0.04
const EDGE_CORE = 0.6
/** Its glow's width against the main glow's, and its strength. */
const EDGE_GLOW = 1.2
const EDGE_GLOW_WEIGHT = 1.4
/** How far (short sides) another edge's light keeps from the main edge everywhere along it to take a warm color, and
 * the most a layout may be out of focus for it (further out, its glow spreads over the main light's face). */
const WARM_CLEAR = 0.3
const WARM_BLUR = 1.5
/** The second light's colors' Oklab lightness, the same in every pack. */
const SECOND_L = 0.75
/** A part that is not in this frame (off it, so its field is empty). */
const PART_OFF = [-9, -9, -9, -9]
/** The second light's stretch of edge as the color stage's parts: this many equal pieces along it. */
const SECOND_PIECES = 16
const SECOND_OFF = new Array<number>(2 * (SECOND_PIECES + 1)).fill(-9)
/** How far the third light's stretch keeps from the second light's (short sides). */
const THIRD_APART = 0.2
/** How far the third light's middle keeps from the main light's place (short sides), so it reads as a light of its own. */
const THIRD_FROM_MAIN = 0.4
/** The third light's half length (short sides), at most the second light's. */
const THIRD_HALF = 0.15
/** Places tried along the second light's edge for the third light (a large shape's contour is mostly out of frame). */
const THIRD_SAMPLES = 400
/** Where the second and third lights share a unit, each has four stops: dark at its ends, full over its middle. */
const SHARED_SHAPE = [-1, -0.3, 0.3, 1]
const SHARED_LEVEL = [0, 1, 1, 0]
/** Color-stage pieces along the third light. */
const THIRD_PIECES = 8
const THIRD_OFF = new Array<number>(2 * (THIRD_PIECES + 1)).fill(-9)
/** Along the second light (u from -1 at its end nearer the main light to 1 at its far end) its parts walk through three
 * of the pack's colors, each strongest at its place here: the cool one (Cyan), the warm one round its middle (Yellow,
 * Tan) and the pack's other warm color (`warm2`: Orange-red, Lime). Two neighbours' ratio changes by e^CROSS_SLOPE per
 * half length, the same slow change all along, so wherever the stage's weights put a turn, the colors turn over the
 * same stretch. */
const CROSS_SLOPE = 1.2
const WALK = [-1, 0, 1.5]
/** From this share of its half length out, the second light's parts weaken, by this much at its ends: past half its
 * half length the main light takes the line back (HANDOVER_DARK), so its color is Meta Blue's there. */
const SECOND_END_TAPER = [0.35, 0.9]
/** The second light's parts fade out between these distances (frame units) from the main light's part. */
const LEAD_CLEAR = [0.12, 0.28]
/** How far (short sides) the second light keeps from a dragged main light: nearer, it slides along its edge. */
const SLIDE_CLEAR = 0.55
/** Where the main light's far stretch is, along its edge from the seed's place for the light, in short sides. */
const COOL_AT = [0.5, 0.8, 1.1]
/** How wide the parts along an edge are: its light and the face light just beside it. */
const EDGE_PART_WIDTH = 0.1
/** The second light's parts hug its glow on the edge, so its color stays on its light and not on the main light's
 * face beside it. */
const WARM_PART_WIDTH = 0.05
/** The dark colors' stretches of outline (short sides): half their length; how far from the seed's place for the main
 * light, past the second light's ends and from the far stretch's middle they keep; how far apart the two are; how far
 * inside the frame's sides; places tried per contour; the parts' width. The second is a little longer and wider: with
 * the second light's own glow in the frame, its color needs more of the outline to show. */
const DARK_HALF = 0.15
const DARK_FROM_MAIN = 0.4
const DARK_CLEAR = 0.1
const DARK_COOL_CLEAR = 0.3
const DARK_APART = 0.34
const DARK_MARGIN = 0.06
const DARK_SAMPLES = 160
const DARK_PART_WIDTH = 0.035
const DARK2_HALF = 0.19
const DARK2_PART_WIDTH = 0.042
/** The dim room round the lit shapes asks for the pack's dark colors (Forest and Plum, Slate and Near-black; Meta
 * Blue's navy in a pack with none) over a soft spot this wide (short sides) round each dark stretch, so the stage
 * paints the dim haze and face there in them instead of grey; the stage keeps a dark color to where the light is dim.
 * The first is wider: the second (the darker color, Plum or Near-black) takes the dimmest light wherever both reach. */
const DARK_SPOT = [0.28, 0.16]
const DARK_WASH = true
/** How far into the face the main light's part sits from the light. */
const LEAD_INTO = 0.15
/** The main light hands over to the second light along the line: it is dark over this share of the second light's half
 * length round its middle and comes back over the rest, full again at the second light's ends, as the second light
 * fades out, so the line stays lit all along with no dark gap between the two. A warm second light is pale where the
 * main light comes back (the two colors' bridge), so blue and warm light never add up to pink or violet. */
const HANDOVER_DARK = 0.5
/** How far the second light keeps from the frame's sides (short sides). */
const SECOND_MARGIN = 0.12
/** The second light's core line against the main light's: a smaller light whose core turns white only at its peak. */
const SECOND_CORE = 0.35
/** The main light's glow: wider and stronger, so Meta Blue's own light is the brightest and widest and its brightest
 * part reaches its own color's lightness. The second light keeps the glow strength it had (SECOND_GLOW_WEIGHT, at
 * the base width): wider, its own color reached into the main light's face and mixed to indigo or mauve. */
const MAIN_GLOW = 2.2
const MAIN_GLOW_WEIGHT = 1.65
const SECOND_GLOW_WEIGHT = 1.1
/** Red over blue in sRGB: above zero for warm colors. */
const warmthOf = (hex: string) => parseInt(hex.slice(1, 3), 16) - parseInt(hex.slice(5, 7), 16)

/** The face's light (times the layout's fill) and how far into the face it reaches (short sides). */
const FACE = 0.1
const FACE_REACH = 0.1
/** A wash: its light on both sides of the edge, how far that reaches, and its haze. */
const WASH_FACE = 0.6
const WASH_REACH = 0.9
const WASH_HAZE = 0.4

/**
 * No light at a pinch point (the owner, 2026-11-09): where the outline turns sharply (outlineTips, as Rim finds them),
 * every unit's own light goes out within TIP_DARK of the tip along the outline and comes back over TIP_FADE (both
 * times the Softness width), and the hot spot keeps TIP_CLEAR from every tip. Rim's numbers.
 */
const TIP_DARK = 0.04
const TIP_FADE = 0.12
const TIP_CLEAR = 0.2
const TIPS = 4

/** The stretches of a run where `keep` holds. */
function keptStretches(run: readonly Vec2[], keep: (p: Vec2) => boolean): Vec2[][] {
  const out: Vec2[][] = []
  let current: Vec2[] = []
  for (const p of run) {
    if (keep(p)) current.push(p)
    else if (current.length) {
      out.push(current)
      current = []
    }
  }
  if (current.length) out.push(current)
  return out
}

const smooth01 = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export function composeMerged(input: MergedInput): Composition & { layoutName: string } {
  const { colors, controls, seed, aspect } = input
  const shares = input.shares ?? defaultShares(colors)
  const design = seedDesign(seed)
  const def = LAYOUTS[input.layout ?? design.layout]
  const seedAt = Math.min(0.75, Math.max(0.25, def.hotAt + design.hotShift))
  const placed = placeLayout(def, aspect, design.jitter, seedAt)
  const anchor = placed.anchor
  const spec: MergedShapeSpec = placed.spec
  const shape0 = buildMergedShape(spec)
  const runs = visibleRuns(shape0, anchor, aspect)
  const run = longestRun(runs)
  const [fw, fh] = frameSize(aspect)
  // The mood control (Light position; the tool holds it at 0.5) moves the light along the edge from the seed's place.
  // The seed's place stays in the middle half of the visible edge, so the face it lights is in the frame.
  const homeAt = Math.min(0.75, Math.max(0.25, def.hotAt + design.hotShift + 0.4 * (controls.mood - 0.5)))
  // The hot spot stays on a smooth stretch: along the longest stretch of the run clear of every sharp tip, and a drag
  // counts outline points near a tip less (fading in from half of TIP_CLEAR to TIP_CLEAR), as Rim's does.
  const tips = outlineTips(shape0, anchor, aspect)
  const tipDistance = (p: Vec2) => Math.min(Infinity, ...tips.map((tip) => Math.hypot(tip.at[0] - p[0], tip.at[1] - p[1])))
  const clearRun = longestRun(keptStretches(run, (p) => tipDistance(p) >= TIP_CLEAR))
  const home = pointAlong(clearRun.length > 1 ? clearRun : run, homeAt) ?? anchor
  const awayFromTips = (p: Vec2) => {
    const t = Math.min(1, Math.max(0, (tipDistance(p) / TIP_CLEAR - 0.5) * 2))
    return 0.02 + 0.98 * t * t * (3 - 2 * t)
  }
  const dragged = controls.drag ? dragLight(controls.drag, runs, aspect, tips.length ? awayFromTips : undefined) : null
  const hot = dragged?.hot ?? home
  const gain = geo(controls.intensity, 0.35, 1, 2.8)
  const blur = def.blur ?? 1
  const soften = geo(controls.softness, 0.3, 1, 1.7) * blur
  // Per seed, how the light falls along its edge, so seeds that share a shape differ in where their light is, not only
  // in color: its falloff's power, and how many times dimmer it is by the far end of the visible stretch, 2.5 to 16
  // times, so the far stretch still carries a dimmer light and no dim stretch opens before the second light (a wash's
  // whole edge is lit).
  const power = lerp(1.8, 3.4, design.powerDraw)
  const factor = def.wash ? 2 : lerp(2.5, 16, design.reachDraw)
  const reach = flatRadius(run, home, factor, power)
  const hazeScale = lerp(0.7, 1.5, design.hazeDraw)
  const dragReach = dragged ? Math.hypot(dragged.lineLength, 0.12) : 0
  const spread = dragged ? offFrameSpread(controls.drag, dragged.hot, aspect) : 0
  const dragT = dragged ? Math.min(1, dragged.lineLength / 0.15) : 0
  const dragWay = dragT * dragT * (3 - 2 * dragT)

  // The stops are placed along the contour as the recipe draws it: far pieces merged first (from the seed's shape and
  // the origin as rounded in the params, so a moving light never changes the merge), then each contour started so its
  // point nearest the light sits halfway along it. Only the contour the light is on carries stops.
  const atFrame = toFrame(anchor, aspect).map(round4)
  const anchorR: Vec2 = [(atFrame[0] - 0.5) * fw, (atFrame[1] - 0.5) * fh]
  const merged = mergedShape(spec, anchorR, aspect)
  // The contour the light is on starts at the light; every other contour at the seed's place for the light, so a drag
  // never moves where a light of its own sits along it.
  const seedPlace = pointAlong(clearRun.length > 1 ? clearRun : run, Math.min(0.75, Math.max(0.25, def.hotAt + design.hotShift))) ?? anchor
  const fromHot = nearestOnContours(merged, anchorR, hot)
  const fromSeed = nearestOnContours(merged, anchorR, seedPlace)
  const starts = fromHot.ts.map((t, i) => round4(i === fromHot.contour ? t - 0.5 : fromSeed.ts[i] - 0.5))
  const drawn = startedShape(merged, starts)
  const drawnTips = outlineTips(drawn, anchorR, aspect)
  const onDrawn = nearestOnContours(drawn, anchorR, hot)
  const tHot = onDrawn.ts[onDrawn.contour]
  // The visible piece the light is on, and its ends measured along the light's own contour (signed, within half a
  // turn), so the stops' span moves smoothly with the light.
  const dist2 = (a: Vec2, b: Vec2) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2
  const lit = runs.reduce<Vec2[]>((best, r) => {
    const near = (rr: Vec2[]) => Math.min(...rr.map((p) => dist2(p, hot)))
    return best.length === 0 || (r.length > 1 && near(r) < near(best)) ? r : best
  }, run)
  const along = (p: Vec2) => {
    const d = nearestOnContours(drawn, anchorR, p).ts[onDrawn.contour] - tHot
    return d - Math.round(d)
  }
  const ends = lit.length > 1 ? [along(lit[0]), along(lit[lit.length - 1])] : [-0.1, 0.1]
  const below = Math.max(0.01, -Math.min(ends[0], ends[1]))
  const above = Math.max(0.01, Math.max(ends[0], ends[1]))
  const hotAt = below / (below + above)
  const tAt = (u: number) => round4(Math.min(0.999, Math.max(0.001, tHot - below + u * (below + above))))
  // Where the light sits between two edges, the accents shrink away, so when the stops pass to the other edge there
  // is only the key's color to move.
  const [d1, d2] = [...onDrawn.ds].sort((a, b) => a - b)
  // Kept above zero, so an accent's unit never switches off as the light crosses between edges.
  const oneEdge = d2 === undefined ? 1 : Math.max(0.02, smooth01(0, BETWEEN, d2 - d1))
  // Out of focus, an accent spreads into a wide patch, so it is shorter there and only clean with the key.
  const plan = planColors(colors, shares, design.keyDraw, hotAt, (blur > 1 ? 0.35 : 1) * oneEdge, blur >= 3)
  const slotOf = (i: number) => i + 2
  const keyUnit = plan.units.findIndex((u) => u.colors.includes(plan.key))
  // The pack's lightest light color that isn't warm (Cyan, Ice): it meets Meta Blue's light cleanly, lighter where the
  // two overlap, and keeps its hue in dim light, so it lights the other edges. A cool second light takes it too, or
  // where there is none (Elemental) the pack's lightest light color besides the key's (Lime), which reads as itself
  // only in bright light, so there the other edges keep the key's color.
  const lightOthers = colors.map((_, i) => i).filter((i) => i !== plan.key && shares[i] > 0.001 && L(colors[i]) >= LIGHT_L)
  const byLightness = (a: number, b: number) => L(colors[b]) - L(colors[a])
  const trueCool = lightOthers.filter((i) => !(chroma(colors[i]) > 0.04 && hue(colors[i]) >= 20 && hue(colors[i]) <= 140)).sort(byLightness)[0]
  const coolest = trueCool ?? lightOthers.sort(byLightness)[0] ?? plan.key
  // Stops per unit: its colors on its stretches, black elsewhere; where two units meet, the accent's unit carries a
  // pale bridge (code 10a + b), so a turn never makes a third hue, and the key's unit needs only two stops per turn,
  // so its eight stops reach both ends of the edge.
  const unitStops: { u: number; slot: number }[][] = plan.units.map(() => [])
  const keyStretches = plan.stretches.map((s, k) => (s.color === plan.key ? k : -1)).filter((k) => k >= 0)
  const keyPos = keyStretches.find((k) => plan.stretches[k].from <= hotAt + 1e-6 && plan.stretches[k].to >= hotAt - 1e-6) ?? keyStretches[Math.floor(keyStretches.length / 2)]
  plan.stretches.forEach((s, k) => {
    const next = plan.stretches[k + 1]
    if (!next) return
    const b = s.to
    // A fade spans up to half of each neighbouring stretch, so colors turn slowly and neighbouring fades keep order.
    const f = Math.min(FADE, 0.5 * Math.min(s.to - s.from, next.to - next.from))
    if (s.unit === next.unit) {
      unitStops[s.unit].push({ u: b - f, slot: slotOf(s.color) }, { u: b + f, slot: slotOf(next.color) })
      return
    }
    const bridge = 10 * slotOf(s.color) + slotOf(next.color)
    if (next.unit !== keyUnit && (s.unit === keyUnit || k + 1 <= keyPos)) {
      unitStops[next.unit].push({ u: b - f, slot: 1 }, { u: b, slot: bridge }, { u: b + f, slot: slotOf(next.color) })
      unitStops[s.unit].push({ u: b - f, slot: slotOf(s.color) }, { u: b, slot: 1 })
    } else {
      unitStops[s.unit].push({ u: b - f, slot: slotOf(s.color) }, { u: b, slot: bridge }, { u: b + f, slot: 1 })
      unitStops[next.unit].push({ u: b, slot: 1 }, { u: b + f, slot: slotOf(next.color) })
    }
  })
  plan.stretches.forEach((s) => {
    if (!unitStops[s.unit].length) unitStops[s.unit].push({ u: (s.from + s.to) / 2, slot: slotOf(s.color) })
  })
  const unitParams: Record<string, ParamValue> = {}
  plan.units.forEach((unit, e) => {
    const stops = [...unitStops[e]].sort((a, b) => a.u - b.u).slice(0, STOPS)
    const pad = (values: number[], fill: number) => [...values, ...Array<number>(STOPS - values.length).fill(fill)]
    const at = pad(stops.map((s) => tAt(s.u)), 1)
    const slot = pad(stops.map((s) => s.slot), 1)
    Object.assign(unitParams, {
      // A unit with no stretch (an accent left out of an out-of-focus shape) draws nothing.
      [`e${e + 1}On`]: stops.length > 0,
      [`e${e + 1}Own`]: slotOf(unit.own),
      // The other contours are lit by the key's unit in the pack's cool color, so each visible edge near the main light
      // shows a color of its own with its own halo; the other units leave them dark.
      [`e${e + 1}Rest`]: unit.colors.includes(plan.key) ? slotOf(trueCool ?? plan.key) : 1,
      [`e${e + 1}Stops`]: Math.max(1, stops.length),
      [`e${e + 1}StopAt`]: at.slice(0, 4),
      [`e${e + 1}StopAt2`]: at.slice(4),
      [`e${e + 1}StopColor`]: slot.slice(0, 4),
      [`e${e + 1}StopColor2`]: slot.slice(4),
      ...(unit.dimTo ? { [`e${e + 1}Drift`]: driftRatios(colors[unit.own], unit.dimTo), [`e${e + 1}DriftShape`]: [0.75, 3] } : {}),
    })
  })

  // The second light: a light of its own from another side, on the other edge in the crop when one shows, else on the
  // far stretch of the light's own edge: a fifth to a third of the visible edge long, at half to three quarters of
  // the main light, with its own hot core, glow and face light. It is placed from the seed's place for the main light,
  // not the dragged one, so a drag never moves it in a jump, and it fades out as the main light comes near it.
  const runLength = (r: Vec2[]) => r.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - r[i][0], p[1] - r[i][1]), 0)
  // The seed's own place for the main light, without the controls, so nothing a drag moves can move the second light.
  const seedHome = pointAlong(clearRun.length > 1 ? clearRun : run, Math.min(0.75, Math.max(0.25, def.hotAt + design.hotShift))) ?? anchor
  const homeContour = nearestOnContours(drawn, anchorR, seedHome).contour
  const shown = runs.filter((r) => r.length > 3).map((r) => ({ r, contour: nearestOnContours(drawn, anchorR, r[Math.floor(r.length / 2)]).contour }))
  const homeRun = shown.filter((x) => x.contour === homeContour).map((x) => x.r).sort((a, b) => Math.min(...a.map((p) => dist2(p, seedHome))) - Math.min(...b.map((p) => dist2(p, seedHome))))[0] ?? run
  // Another edge: the longest other visible run, of another contour or of the main one (a ribbon's other side).
  const other = shown.filter((x) => x.r !== homeRun && runLength(x.r) > 0.4).sort((a, b) => runLength(b.r) - runLength(a.r))[0]
  const baseHalf = Math.min(0.45, Math.max(0.12, 0.5 * lerp(0.2, 0.33, design.secondWidth) * runLength(homeRun))) * (def.wash ? 1.3 : 1)
  const stretchHalf = baseHalf * (def.wash ? 1 : SECOND_LONGER)
  const keepOff = Math.max(0.45, baseHalf + 0.3)
  // Kept inside the frame (SECOND_MARGIN from its sides), so its hot core shows.
  const inFrame = (p: Vec2) => Math.abs(p[0]) <= fw / 2 - SECOND_MARGIN && Math.abs(p[1]) <= fh / 2 - SECOND_MARGIN
  const insideRun = (r: Vec2[]) => r.filter(inFrame)
  // Another edge in the frame is a light of its own, like a ring: lit over most of its visible length, hottest at a
  // seeded place inside the frame and far enough from the main light.
  const otherIn = other ? other.r.filter((p) => Math.abs(p[0]) <= fw / 2 - EDGE_MARGIN && Math.abs(p[1]) <= fh / 2 - EDGE_MARGIN) : []
  const otherPoint = !def.wash && otherIn.length > 3 ? pointAlong(otherIn, lerp(0.3, 0.7, design.secondAt)) : null
  const edgeLight = !!otherPoint && Math.sqrt(dist2(otherPoint, seedHome)) >= EDGE_KEEP_OFF
  const halfLength = edgeLight ? Math.min(EDGE_HALF_MAX, Math.max(EDGE_HALF_MIN, EDGE_SHARE * runLength(otherIn))) : stretchHalf
  const i0 = homeRun.reduce((best, p, i) => (dist2(p, seedHome) < dist2(homeRun[best], seedHome) ? i : best), 0)
  const arms = [homeRun.slice(0, i0 + 1).reverse(), homeRun.slice(i0)].map(insideRun).sort((a, b) => runLength(b) - runLength(a))
  // A wash's glow sits far from the arc's hot core, at the far end of its longer arm.
  const tries = def.wash
    ? [arms[0].length > 3 ? pointAlong(arms[0], lerp(0.85, 0.95, design.secondAt)) : null]
    : [
        arms[0].length > 3 ? pointAlong(arms[0], lerp(0.6, 0.85, design.secondAt)) : null,
        arms[1].length > 3 ? pointAlong(arms[1], lerp(0.65, 0.9, design.secondAt)) : null,
      ]
  const secondPoint = edgeLight ? otherPoint : (tries.find((p): p is Vec2 => !!p && Math.sqrt(dist2(p, seedHome)) >= keepOff) ?? null)
  const host = plan.second >= 0 ? plan.second : plan.units.length < MERGED_UNITS ? plan.units.length : -1
  const secondParams: Record<string, ParamValue> = { secondUnit: 0, secondAt: [-40, -40] }
  let secondOn: { contour: number; t: number; t0: number; tSpan: number; near: number } | null = null
  // The second light is warm wherever its glow stays off the main light's face (over it the two blend into violet): in
  // focus, on the main edge, where the main light hands over to it, or on another edge that keeps clear of the main
  // edge; so the frame shows the pack's warm color beside the main light's and its accents' (the owner, 2026-11-10
  // 7:08 PM: the frames showed one color). Elsewhere it is cool.
  let edgeWarm = false
  let ringLight = false
  let secondStretch: Vec2[] = []
  let secondColor = -1
  let secondLight: { e: number; contour: number; t: number; tSpan: number; peak: number; level: number; end: number; side: number; brightest: number; cool: boolean } | null = null
  if (secondPoint && host >= 0) {
    const on2 = nearestOnContours(drawn, anchorR, secondPoint)
    const tSpan = halfLength / (contourLength(drawn.contours[on2.contour]) || 1)
    // As a dragged main light comes near, it slides along its edge away from the seed's place for the main light,
    // keeping the clearance it has at the default view (up to SLIDE_CLEAR), as far as its edge stays in the frame; only
    // past that does it fade. Its colors are chosen at its seed's place, so a drag never changes them.
    const c2 = drawn.contours[on2.contour]
    const wrap = (d: number) => (c2.closed ? d - Math.round(d) : d)
    const t0 = on2.ts[on2.contour]
    const fromHome = wrap(t0 - nearestOnContours(drawn, anchorR, seedHome).ts[on2.contour])
    const dir = fromHome >= 0 ? 1 : -1
    const need = Math.min(dir * fromHome, Math.sqrt(Math.max(0, SLIDE_CLEAR ** 2 - onDrawn.ds[on2.contour] ** 2)) / (contourLength(c2) || 1))
    const ahead = dir * wrap(t0 - onDrawn.ts[on2.contour])
    const nearest = (r: Vec2[]) => Math.min(Infinity, ...r.map((p) => dist2(p, secondPoint)))
    const run2 = edgeLight ? otherIn : ([...arms].sort((a, b) => nearest(a) - nearest(b))[0] ?? [])
    const ends = run2.length > 1 ? [run2[0], run2[run2.length - 1]].map((p) => wrap(nearestOnContours(drawn, anchorR, p).ts[on2.contour] - t0)) : [0]
    const room = Math.max(0, dir * (dir > 0 ? Math.max(...ends) : Math.min(...ends)) - 0.5 * tSpan)
    const t2 = t0 + dir * Math.min(room, Math.max(0, need - ahead))
    const onC2 = (t: number) => contourPoint(c2, c2.closed ? t - Math.floor(t) : Math.min(1, Math.max(0, t))).point
    const [p0, p2] = [onC2(t0), onC2(t2)]
    const slid: Vec2 = [secondPoint[0] + p2[0] - p0[0], secondPoint[1] + p2[1] - p0[1]]
    const near = smooth01(0.3, 0.55, Math.sqrt(dist2(hot, slid)))
    secondOn = { contour: on2.contour, t: t2, t0, tSpan, near }
    const stretchPoints = [-1, -0.5, 0, 0.5, 1].map((k) => {
      const c = drawn.contours[on2.contour]
      const t = on2.ts[on2.contour] + k * tSpan
      const q = contourPoint(c, c.closed ? t - Math.floor(t) : Math.min(1, Math.max(0, t))).point
      return [q[0] + anchorR[0], q[1] + anchorR[1]] as Vec2
    })
    secondStretch = stretchPoints
    const clearOfMain = stretchPoints.every((p) => homeRun.every((q) => dist2(p, q) >= WARM_CLEAR * WARM_CLEAR))
    // On another edge well clear of the main one and in focus it is a ring of its own, like the moodboard's separate
    // colored rings: a halo as wide and strong as the main light's, in its own color. On the main light's own line its
    // halo would lie over the main light's and the two would add up to mauve or maroon, so there it keeps the narrow
    // glow.
    const ringClear = stretchPoints.every((p) => homeRun.every((q) => dist2(p, q) >= RING_CLEAR * RING_CLEAR))
    ringLight = !def.wash && edgeLight && blur <= WARM_BLUR && ringClear
    // A ring is cool (Cyan, Ice): a cool halo meets the main light's blue cleanly and keeps its hue in dim light, where
    // a warm one read red, and mauve wherever a drag brought the main light near it.
    // A ring far enough from the main light's edge that the two halos stay apart may be warm again (Orange-red round a
    // Yellow core), since faint warm light over faint blue haze is what read mauve or as a hard edge.
    const farRing = ringLight && stretchPoints.every((p) => homeRun.every((q) => dist2(p, q) >= WARM_RING_CLEAR * WARM_RING_CLEAR))
    edgeWarm = !def.wash && blur <= WARM_BLUR && (!ringLight || farRing) && (!edgeLight || clearOfMain)
    // A cool light stays dimmer than the main light's glow: through the stage only its hottest part takes its color
    // and the rest of it is Meta Blue, which would then be Meta Blue's brightest light, lit only beside another color.
    // A ring is as bright as a warm light, so a light color reads as itself in its halo (Lime only shows near its own
    // lightness).
    const level = def.wash ? lerp(0.5, 0.75, design.secondGain) : edgeWarm || ringLight ? lerp(WARM_PEAK[0], WARM_PEAK[1], design.secondGain) : lerp(COOL_PEAK[0], COOL_PEAK[1], design.secondGain)
    const peak = level * near
    const at = (def.wash ? SECOND_SHAPE : FADE_SHAPE).map((o) => round4(Math.min(0.999, Math.max(0.001, t2 + o * tSpan))))
    const gains = (def.wash ? SECOND_LEVEL : FADE_LEVEL).map((g) => round4(g * peak))
    // The pack's warm or bright color: the unit's warmest (Orange-red) along the stretch and its brightest at the core
    // (Yellow); a wash's glow takes the brightest, like the poster's yellow glow in the blue.
    const members = plan.second >= 0 ? plan.units[plan.second].colors : [plan.key]
    // A cool one takes the cool color (never the key's, which would only make the frame bluer). Only the color changes
    // with the pack: the light is a cool light's in every pack.
    const cool = !def.wash && !edgeWarm
    const warmest = slotOf(cool ? coolest : members.reduce((a, b) => (warmthOf(colors[b]) > warmthOf(colors[a]) ? b : a)))
    const brightest = slotOf(cool ? coolest : members.reduce((a, b) => (L(colors[b]) > L(colors[a]) ? b : a)))
    const side = def.wash ? brightest : warmest
    secondColor = side - 2
    // A warm one's ends, where the main light comes back, are the pale bridge between the key's color and its own.
    const end = edgeWarm ? 10 * slotOf(plan.key) + side : side
    const e = host + 1
    secondLight = { e, contour: on2.contour, t: t0, tSpan, peak, level, end, side, brightest, cool }
    delete unitParams[`e${e}Drift`]
    delete unitParams[`e${e}DriftShape`]
    // As it dims it follows its color's own dim path inside the pack (Lime through Forest, Ice through Steel), which
    // still reads as that color, not olive or grey.
    const sideHex = colors[side - 2]
    const dimTo = dimPartner(sideHex, colors.filter((_, i) => shares[i] > 0.001))
    // (Not a wash's glow, which takes the key's color: there a dim path would change the design between packs.)
    if (dimTo && !def.wash) Object.assign(unitParams, { [`e${e}Drift`]: driftRatios(sideHex, dimTo), [`e${e}DriftShape`]: [0.75, 3] })
    Object.assign(unitParams, {
      [`e${e}On`]: true,
      [`e${e}Own`]: side,
      [`e${e}Rest`]: 1,
      [`e${e}Stops`]: SECOND_SHAPE.length,
      [`e${e}StopAt`]: at.slice(0, 4),
      [`e${e}StopAt2`]: [...at.slice(4), 1],
      [`e${e}StopColor`]: [end, end, side, brightest],
      [`e${e}StopColor2`]: [side, end, end, 1],
      [`e${e}StopGain`]: gains.slice(0, 4),
      [`e${e}StopGain2`]: [...gains.slice(4), 0],
      [`e${e}StopContour`]: on2.contour,
      // A wash's glow takes the key's color, so its own stays at the stand-in's lightness (pushed brighter, a saturated
      // color clips in one channel and the design changes between packs over the glow's wide area).
      [`e${e}Level`]: def.wash ? 0 : SECOND_L,
    })
    Object.assign(secondParams, {
      secondUnit: e,
      secondAt: [round4(slid[0] - anchorR[0]), round4(slid[1] - anchorR[1])],
      // An edge's own light turns near white where it is hottest, like a ring's; a ring's core reaches the lightness of a
      // light pack color (Ice near white, Lime about 0.9), or the color stage keeps that color out of it.
      secondCore: ringLight ? RING_CORE : edgeLight ? EDGE_CORE : SECOND_CORE,
      // A cool one's glow is a little wider than the main one's, so its color reads in it; a warm one keeps the narrow
      // glow: wider, its color reached the main light's and mixed to mauve or indigo.
      secondGlow: round4(ringLight ? 1 : def.wash || edgeWarm ? 1 / MAIN_GLOW : EDGE_GLOW),
      secondGlowWeight: round4(ringLight ? 1 : (def.wash || edgeWarm ? SECOND_GLOW_WEIGHT : EDGE_GLOW_WEIGHT) / MAIN_GLOW_WEIGHT),
      // Its glow lies on both sides of its line.
      secondGlowSide: def.wash ? -1 : 0,
      // Along the second light's stretch the main light's line hands over to it: dark round the second light's middle
      // and back to full at its ends, so the line has no dark gap.
      gapAt: round4(t2),
      gapContour: on2.contour,
      // The hand-over fades out with the second light as a dragged main light comes near, so the main light is never
      // cut; its length stays (shrinking it left a sharp notch on the main light that flickered as it moved).
      gapDark: round4(HANDOVER_DARK * halfLength),
      gapFade: round4((1 - HANDOVER_DARK) * halfLength),
      gapDepth: round4(near),
      // Its own soft light on the nearby face, in its own color; a wash's is a wide soft glow, at a third of the wash's
      // own fill so the frame keeps its blue.
      // A wash's glow takes the key's color at the same luminance (in its own color it read green, teal or mauve), and
      // the color stage colors it from its warm part.
      secondFar: def.wash ? 0.8 : ringLight ? RING_FAR : STRETCH_FAR,
      // A ring's face light, a faint wash of its own color inside it (the moodboard's ring interiors), stronger than its
      // haze; never a fill.
      ...(ringLight ? { secondReach: RING_REACH, secondFace: RING_FACE } : {}),
      secondPale: def.wash ? 1 : 0,
    })
  }
  // A third light: a ring of its own on another visible edge, clear of the main light's edge and of the second light,
  // in its own color with its own halo, so a frame can show separate rings like the moodboard's. Like the second light
  // it is placed from the seed's place for the main light, so a drag never moves it, and it fades out as a dragged main
  // light comes near. Far enough from the main edge that the two halos stay apart, it takes the pack's brightest light
  // color that isn't the cool one (Yellow, Lime), whose dim glow falls through its own dim path; nearer, the cool color,
  // which meets Meta Blue's light cleanly. Only the color changes with the pack.
  const thirdParams: Record<string, ParamValue> = { thirdUnit: 0, thirdAt: [-40, -40] }
  let thirdOn: { contour: number; t: number; tSpan: number; near: number; bright: boolean } | null = null
  // The main light's colors can take all three units WebGL leaves room for, so the third light shares the second light's
  // unit, four color stops each, and is on the second light's edge: another edge, or another stretch of the main one.
  if (!def.wash && blur <= WARM_BLUR && secondLight) {
    const s = secondLight
    // Found on the seed's shape (the same for any drag, as the dark parts are), so a drag never moves it.
    const mc = merged.contours[s.contour]
    const length = contourLength(mc) || 1
    const onSeed = (t: number): Vec2 => {
      const q = contourPoint(mc, mc.closed ? t - Math.floor(t) : Math.min(1, Math.max(0, t))).point
      return [q[0] + anchorR[0], q[1] + anchorR[1]]
    }
    const secondMid = secondStretch[2]
    const secondHalf = s.tSpan * length
    const inMargin = (p: Vec2) => Math.abs(p[0]) <= fw / 2 - EDGE_MARGIN && Math.abs(p[1]) <= fh / 2 - EDGE_MARGIN
    const tSpan3 = Math.min(s.tSpan, THIRD_HALF / length)
    const stretch = (t: number) => [-1, -0.5, 0, 0.5, 1].map((k) => onSeed(t + k * tSpan3))
    // A place whose bright middle is in the frame and clear of every sharp tip (so its hot spot is on a smooth stretch),
    // apart from the second light and far enough from the main light to read as a light of its own; the one farthest
    // from both.
    const fits = (t: number) => {
      if (!mc.closed && (t - tSpan3 < 0 || t + tSpan3 > 1)) return false
      if (!inMargin(onSeed(t))) return false
      const pts = stretch(t)
      return (
        pts.slice(1, 4).every(inMargin) &&
        pts.slice(1, 4).every((p) => drawnTips.every((tip) => dist2(p, tip.at) >= TIP_CLEAR * TIP_CLEAR)) &&
        Math.sqrt(dist2(pts[2], seedHome)) >= THIRD_FROM_MAIN &&
        Math.sqrt(dist2(pts[2], secondMid)) >= secondHalf + THIRD_APART &&
        pts.every((p) => secondStretch.every((q) => dist2(p, q) >= THIRD_APART * THIRD_APART))
      )
    }
    const away = (t: number) => Math.min(dist2(onSeed(t), seedHome), dist2(onSeed(t), secondMid))
    const seedT = Array.from({ length: THIRD_SAMPLES }, (_, k) => (k + 0.5) / THIRD_SAMPLES)
      .filter(fits)
      .sort((a, b) => away(b) - away(a))[0]
    if (seedT !== undefined && secondMid) {
      const pts = stretch(seedT)
      const p3 = pts[2]
      // Along the contour as drawn (started from the light), like the second light.
      const t3 = nearestOnContours(drawn, anchorR, p3).ts[s.contour]
      // Warm or bright only where its halo stays clear of the main light's; else the cool color.
      const bright = pts.every((p) => homeRun.every((q) => dist2(p, q) >= WARM_RING_CLEAR * WARM_RING_CLEAR))
      const notCool = (i: number) => chroma(colors[i]) > 0.04 && hue(colors[i]) >= 20 && hue(colors[i]) <= 140
      const brightPick = lightOthers.filter((i) => i !== trueCool && i !== secondColor).sort(byLightness)[0]
      const coolPick = lightOthers.filter((i) => i !== secondColor && !notCool(i)).sort(byLightness)[0] ?? coolest
      // One unit has one dim path: where either light's color needs one (Lime through Forest, Ice through Steel, Yellow
      // through Orange-red), the third light takes the second light's color with the stage off; the color stage still
      // asks it for a color of its own.
      const own3 = bright ? (brightPick ?? coolest) : coolPick
      const inPack = colors.filter((_, i) => shares[i] > 0.001)
      const ownPath = (i: number) => !!dimPartner(colors[i], inPack)
      const slot3 = ownPath(own3) || ownPath(s.side - 2) ? s.side : slotOf(own3)
      const near3 = smooth01(0.3, 0.55, Math.sqrt(dist2(hot, p3)))
      const peak3 = lerp(WARM_PEAK[0], WARM_PEAK[1], 1 - design.secondGain) * near3
      // Sharing a unit with the third light, the second light stays at its own place and fades as the main light comes
      // near: sliding, its stops could pass the third light's.
      const home2 = secondPoint ?? secondMid
      const near2 = smooth01(0.3, 0.55, Math.sqrt(dist2(hot, home2)))
      const peak2 = s.level * near2
      if (secondOn) secondOn = { ...secondOn, t: secondOn.t0, near: near2 }
      Object.assign(secondParams, {
        secondAt: [round4(home2[0] - anchorR[0]), round4(home2[1] - anchorR[1])],
        gapAt: round4(s.t),
        gapDepth: round4(near2),
      })
      const four = (t: number, span: number) => SHARED_SHAPE.map((o) => round4(Math.min(0.999, Math.max(0.001, t + o * span))))
      const lights = [
        { at: four(s.t, s.tSpan), gain: SHARED_LEVEL.map((g) => round4(g * peak2)), color: [s.end, s.side, s.brightest, s.end] },
        { at: four(t3, tSpan3), gain: SHARED_LEVEL.map((g) => round4(g * peak3)), color: [slot3, slot3, slot3, slot3] },
      ].sort((a, b) => a.at[0] - b.at[0])
      const at = lights.flatMap((l) => l.at)
      const gain = lights.flatMap((l) => l.gain)
      const color = lights.flatMap((l) => l.color)
      const e = s.e
      Object.assign(unitParams, {
        [`e${e}Stops`]: 8,
        [`e${e}StopAt`]: at.slice(0, 4),
        [`e${e}StopAt2`]: at.slice(4),
        [`e${e}StopColor`]: color.slice(0, 4),
        [`e${e}StopColor2`]: color.slice(4),
        [`e${e}StopGain`]: gain.slice(0, 4),
        [`e${e}StopGain2`]: gain.slice(4),
      })
      const half3 = tSpan3 * length
      Object.assign(thirdParams, {
        thirdUnit: e,
        thirdAt: [round4(p3[0] - anchorR[0]), round4(p3[1] - anchorR[1])],
        gap3At: round4(t3),
        gap3Contour: s.contour,
        gap3Dark: round4(HANDOVER_DARK * half3),
        gap3Fade: round4((1 - HANDOVER_DARK) * half3),
        gap3Depth: round4(near3),
      })
      // The unit's core reaches a light color's own lightness, so the color stage can show that color in it.
      secondParams.secondCore = Math.max(Number(secondParams.secondCore), RING_CORE)
      // Through the stage it asks the color the frame lacks: the bright one beside a cool second light, else the cool one.
      thirdOn = { contour: s.contour, t: t3, tSpan: tSpan3, near: near3, bright: s.cool }
    }
  }
  // Into the face at the light (for the color stage's parts): the side of the edge the face is on.
  const tangent = contourPoint(drawn.contours[onDrawn.contour], tHot).tangent
  const normal: Vec2 = [-tangent[1], tangent[0]]
  const probe: Vec2 = [hot[0] - anchorR[0] + 0.02 * normal[0], hot[1] - anchorR[1] + 0.02 * normal[1]]
  const inside = Math.abs(windingNumber(drawn.contours.flatMap((c) => c.primitives), probe)) > 0.5
  const faceSign = (inside ? 1 : -1) * (def.outside && !def.wash ? -1 : 1)
  const faceDir = [round4(faceSign * normal[0]), round4(faceSign * normal[1])]


  // In focus, Rim's hot core: the core line 8 times the light's level where it is strongest, so it overexposes to
  // white and the light's color shows in the falloff beside it.
  const hotCore = blur <= 1
  const parts = productionParts('', { side: def.outside ? 2 : 1, soften, face: 0.035 * (def.fill ?? 1), glow: 0.009, haze: round4(0.04 * hazeScale), fan: 2, hotCore })
  // A light brightens in its own color first: a small hot spot over a strong colored glow, so a blue light blooms
  // saturated blue and only a thin core goes to white.
  Object.assign(parts, {
    ...(hotCore ? {} : { n1Weight: 0.8 }),
    n2Weight: MAIN_GLOW_WEIGHT,
    n2Width: round4(Number(parts.n2Width) * MAIN_GLOW),
    n3Weight: 1.2,
    f1Weight: round4(0.09 * (def.fill ?? 1)),
    f2Width: round4(0.035 * hazeScale),
  })
  // The face takes soft light from the whole lit stretch of its edge: brighter near it, deep at the far side.
  Object.assign(parts, {
    f3Weight: round4(FACE * (def.fill ?? 1) * lerp(0.6, 1.4, design.faceDraw)),
    f3Width: round4(FACE_REACH * lerp(0.55, 1.3, design.faceReachDraw)),
    f3Light: 1,
    f3LightGamma: 1,
  })
  // A wash fills the frame on both sides of its edge, brightest along it, and the edge still reads through it.
  if (def.wash) Object.assign(parts, { f3Side: 0, f3Weight: WASH_FACE, f3Width: WASH_REACH, f1Weight: WASH_HAZE, f1Width: round4(0.25 * hazeScale) })
  const coreBlur = def.soft ? blur : blur ** 0.6
  // Out of focus, the hot core spreads over a large area, so it carries less light there, as a defocused lamp does.
  if (blur > 1) Object.assign(parts, { n1Width: round4(0.0014 * coreBlur), n3Width: round4(0.0035 * coreBlur), n3Weight: round4(1.2 / blur ** 0.7) })
  if (def.outside && !def.wash) Object.assign(parts, { f3Side: 2 })
  // A light outside the frame lights a wider stretch of the edge, but the face behind the edge stays near the edge:
  // lit as widely as the hot spot it read as a flat field of haze.
  if (spread > 0) Object.assign(parts, { f3Weight: round4(Number(parts.f3Weight) * (1 - 0.92 * smooth01(0, 0.35, spread))) })

  // Parts for the color stage, in frame units, placed so they move only as far as the light does: the second light and
  // the main light's far stretch from the seed alone; the main light and the dim room from the light, into the face
  // the seed's light faces (the face direction at the dragged light flips, and the parts jumped with it).
  const framePoint = (p: Vec2) => [round4(p[0] / fw + 0.5), round4(p[1] / fh + 0.5)]
  const pointOn = (contour: number, t: number): Vec2 => {
    const c = drawn.contours[contour]
    const p = contourPoint(c, c.closed ? t - Math.floor(t) : Math.min(1, Math.max(0, t))).point
    return [p[0] + anchorR[0], p[1] + anchorR[1]]
  }
  const partParams: Record<string, ParamValue> = { partSecond: SECOND_OFF, partWarmFade: 0, partWarmSide: 1, partEdgeWarm: 0, partSecondWidth: ringLight ? RING_PART_WIDTH : WARM_PART_WIDTH, partRing: ringLight ? 1 : 0 }
  if (secondOn && Number(secondParams.secondUnit) > 0) {
    const { contour, t, tSpan, near } = secondOn
    // Points at equal steps along it, so each piece stays on the light it colors and the colors can cross-fade.
    const points = Array.from({ length: SECOND_PIECES + 1 }, (_, k) => framePoint(pointOn(contour, t + (-1 + (2 * k) / SECOND_PIECES) * tSpan)))
    // The half farther from the seed's place for the main light is the warm one, away from the main light's face.
    const farSecond = dist2(pointOn(contour, secondOn.t0 + tSpan), seedHome) >= dist2(pointOn(contour, secondOn.t0 - tSpan), seedHome)
    Object.assign(partParams, { partSecond: points.flat(), partWarmFade: round4(near), partWarmSide: farSecond ? 1 : 0, partEdgeWarm: edgeWarm ? 1 : 0 })
  }
  if (thirdOn) {
    const { contour, t, tSpan, near, bright } = thirdOn
    const points = Array.from({ length: THIRD_PIECES + 1 }, (_, k) => framePoint(pointOn(contour, t + (-1 + (2 * k) / THIRD_PIECES) * tSpan)))
    Object.assign(partParams, { partThird: points.flat(), partThirdFade: round4(near), partThirdBright: bright ? 1 : 0 })
  }
  const onHome = nearestOnContours(drawn, anchorR, seedHome)
  const tHome = onHome.ts[onHome.contour]
  const homeTangent = contourPoint(drawn.contours[onHome.contour], tHome).tangent
  const homeNormal: Vec2 = [-homeTangent[1], homeTangent[0]]
  const homeProbe: Vec2 = [seedHome[0] - anchorR[0] + 0.02 * homeNormal[0], seedHome[1] - anchorR[1] + 0.02 * homeNormal[1]]
  const homeInside = Math.abs(windingNumber(drawn.contours.flatMap((c) => c.primitives), homeProbe)) > 0.5
  const homeSign = (homeInside ? 1 : -1) * (def.outside && !def.wash ? -1 : 1)
  const homeLength = contourLength(drawn.contours[onHome.contour]) || 1
  let away = 1
  if (secondOn && secondOn.contour === onHome.contour) {
    const d = secondOn.t - tHome
    away = (drawn.contours[onHome.contour].closed ? d - Math.round(d) : d) > 0 ? -1 : 1
  } else {
    const ahead = pointOn(onHome.contour, tHome + 0.6 / homeLength)
    const behind = pointOn(onHome.contour, tHome - 0.6 / homeLength)
    away = Math.hypot(ahead[0], ahead[1]) <= Math.hypot(behind[0], behind[1]) ? 1 : -1
  }
  // From the seed's own place for the light, so it never moves during a drag (from the dragged light it jumped when the
  // edge nearest the light switched, or the light's nearest point on the edge flipped sides).
  const [c1, c2, c3] = COOL_AT.map((d) => framePoint(pointOn(onHome.contour, tHome + (away * d) / homeLength)))
  Object.assign(partParams, { partCool: [...c1, ...c2], partCool2: [...c2, ...c3] })
  // The dark colors are dim stretches of the outline itself: inside the frame, clear of the main light's core, the
  // second light and the far stretch, and as near the main light as that allows, so its falloff still lights them
  // dimly and they are never out in the black. Narrow, so a dark color glows faintly along the line and the face stays
  // dark. Found on the seed's shape (the same for any drag), so a drag never moves them.
  const onMerged = (ci: number, t: number): Vec2 => {
    const c = merged.contours[ci]
    const q = contourPoint(c, c.closed ? t - Math.floor(t) : Math.min(1, Math.max(0, t))).point
    return [q[0] + anchorR[0], q[1] + anchorR[1]]
  }
  const secondMiddle = secondOn ? pointOn(secondOn.contour, secondOn.t0) : null
  const coolMiddle = pointOn(onHome.contour, tHome + (away * COOL_AT[1]) / homeLength)
  const clearOf = (p: Vec2) =>
    Math.abs(p[0]) <= fw / 2 - DARK_MARGIN &&
    Math.abs(p[1]) <= fh / 2 - DARK_MARGIN &&
    Math.sqrt(dist2(p, seedHome)) >= DARK_FROM_MAIN &&
    // A dark stretch's middle keeps clear of all of the second light's stretch: the main light lights the line up to
    // and across its ends, and a dark color on its warm stretch mixed to a plum haze.
    (!secondMiddle || Math.sqrt(dist2(p, secondMiddle)) >= halfLength + DARK_CLEAR) &&
    Math.sqrt(dist2(p, coolMiddle)) >= DARK_COOL_CLEAR
  const darkSamples = merged.contours.flatMap((c, ci) => {
    const length = contourLength(c) || 1
    return Array.from({ length: DARK_SAMPLES }, (_, k) => {
      const t = (k + 0.5) / DARK_SAMPLES
      return { ci, t, length, p: onMerged(ci, t) }
    }).filter((s) => clearOf(s.p))
  })
  const nearestDark = (keepFrom: Vec2 | null) =>
    darkSamples
      .filter((s) => !keepFrom || Math.sqrt(dist2(s.p, keepFrom)) >= DARK_APART)
      .reduce<(typeof darkSamples)[number] | null>((best, s) => (!best || dist2(s.p, seedHome) < dist2(best.p, seedHome) ? s : best), null)
  const darkAt = (s: (typeof darkSamples)[number] | null, half = DARK_HALF) =>
    s ? [...framePoint(onMerged(s.ci, s.t - half / s.length)), ...framePoint(onMerged(s.ci, s.t + half / s.length))] : PART_OFF
  const dark1 = nearestDark(null)
  // With no clear place for the second, it continues the first along the outline, on the side away from the main
  // light, so the dim stretch changes from one dark color to the other along its length.
  const beside = (s: NonNullable<typeof dark1>) => {
    const sides = [-1, 1].map((k) => ({ ...s, t: s.t + (2 * k * DARK_HALF) / s.length, p: onMerged(s.ci, s.t + (2 * k * DARK_HALF) / s.length) }))
    return dist2(sides[0].p, seedHome) >= dist2(sides[1].p, seedHome) ? sides[0] : sides[1]
  }
  partParams.partDark = darkAt(dark1)
  partParams.partDark2 = darkAt(nearestDark(dark1 ? dark1.p : null) ?? (dark1 ? beside(dark1) : null), DARK2_HALF)
  // The main light with the face near it: from the light, a little into the face the seed's light faces.
  const lead: Vec2 = [hot[0] + homeSign * homeNormal[0] * LEAD_INTO, hot[1] + homeSign * homeNormal[1] * LEAD_INTO]
  partParams.partLead = [...framePoint(lead), 0.3, 0]

  const rayAt: Vec2 = [hot[0], hot[1] + 0.04]
  const params: Record<string, ParamValue> = {
    shape: MERGED_SHAPE_KINDS.indexOf(spec.kind) + 1,
    at: atFrame,
    size: round4(spec.size),
    radius: round4(spec.radius),
    rotate: round4(spec.rotate),
    flip: spec.flip,
    starts: [...starts, 0, 0, 0].slice(0, 3),
    stopContour: onDrawn.contour,
    // The light goes out before each sharp tip of the outline as drawn; the unlit stretch widens with the glow.
    tipAt: Array.from({ length: TIPS }, (_, i) => (drawnTips[i] ? round4(drawnTips[i].t) : -1)),
    tipContour: Array.from({ length: TIPS }, (_, i) => drawnTips[i]?.contour ?? 0),
    tipDark: round4(TIP_DARK * soften),
    tipFade: round4(TIP_FADE * soften),
    keySlot: slotOf(plan.key),
    restBlend: d2 === undefined ? 1 : round4(smooth01(0, BETWEEN, d2 - d1)),
    // A warm second light's light meets the others' by the engine's meeting rule (lighter where lit, through its own
    // dark shades where dim), so warm light never adds to Meta Blue's into maroon, purple or mauve.
    meetUnit: edgeWarm ? Number(secondParams.secondUnit) : 0,
    ...unitParams,
    ...secondParams,
    ...thirdParams,
    faceDir,
    ...partParams,
    ...parts,
    // Scatter blurs from 0.01 to about 0.33 of the short side (times the softness), so the face's light falls off
    // across it instead of filling it flat.
    farWidth: 0.01,
    farStep: 3.2,
    light1Kind: dragged ? 6 : 5,
    light1At: [round4(hot[0] - anchor[0]), round4(hot[1] - anchor[1])],
    light1Radius: round4(dragged ? Math.hypot(dragReach / Math.log(factor) ** (1 / power), spread) : reach),
    light1Power: round4(power),
    ...(dragged ? { light1Length: round4(lerp(1, 0.35, dragWay)), light1Stretch: round4(lerp(1, 0.75, dragWay)), light1Angle: round4(dragged.lineAngle) } : {}),
    light2Kind: 1,
    light2At: [round4(hot[0] - anchor[0]), round4(hot[1] - anchor[1])],
    light2Radius: round4(Math.hypot(lerp(0.12, 0.24, design.hotDraw) * (dragged ? Math.min(1.4, Math.max(0.45, dragReach / 0.5)) : 1), 0.5 * spread)),
    groundNear: plan.ground.near >= 0 ? slotOf(plan.ground.near) : 1,
    groundFar: plan.ground.far >= 0 ? slotOf(plan.ground.far) : 1,
    groundL: ROOM_L,
    // The room is lit toward the light and darker away from it.
    // Away from the light; near the frame's middle the gradient shortens and softens instead of turning fast.
    groundDir: [round4(-hot[0] / Math.max(0.3, Math.hypot(hot[0], hot[1]))), round4(-hot[1] / Math.max(0.3, Math.hypot(hot[0], hot[1]))), -0.5, 0.7],
    gain: round4(gain),
    soften: round4(soften),
    ...(def.rays
      ? {
          rayOn: true,
          rayAt: [round4(rayAt[0] / fw + 0.5), round4(rayAt[1] / fh + 0.5)],
          rayShape: [round4(lerp(22, 40, design.rayDraw)), 0.6, round4(design.rayDraw * 17), round4(0.6 * blur)],
          rayLevel: 0.9,
          rayReach: round4(lerp(0.35, 0.6, design.hazeDraw)),
          rayUnit: keyUnit + 1,
        }
      : {}),
  }
  // The glow an off-frame light leaves at the frame's edge is shaped for the stand-in and takes the key's color.
  const edgeGlow = offFrameGlow(controls.drag, STAND_IN, aspect, 0)
  if ('air1Color' in edgeGlow) Object.assign(edgeGlow, { air1Color: slotOf(plan.key) })
  Object.assign(params, edgeGlow)
  const slots = ['#000000', ...colors, '#000000', '#000000'].slice(0, 8)
  while (slots.length < 8) slots.push('#000000')
  return {
    colors: slots,
    params,
    // A little bloom on the finest levels spreads each light in its own color around its core, and a faint veil lets
    // each light's glow reach the dim places around it.
    lens: { bloom: 0.05, bloomRadius: 0.12, bloomWidth: 1, halation: 0, veil: 0.1 },
    output: { grain: 0, toe: 0 },
    layoutName: def.name,
  }
}

/** The tool's compose: the pack's colors with the default shares. */
export function composeMergedLook({ pack, controls, seed, aspect }: ComposeInput): Composition {
  const { colors, params, lens, output } = composeMerged({ colors: pack.colors.map((c) => c.hex), controls, seed, aspect })
  return { colors, params, lens, output }
}

// ---------------------------------------------------------------------------
// Parts for the shared color stage (interface: artifacts/color/NOTES.md). Frame units for places, short sides for sizes.

const vec = (params: Readonly<Record<string, ParamValue>>, key: string, fallback: readonly number[]) => {
  const v = params[key]
  return Array.isArray(v) ? v : fallback
}

/**
 * Where the merged look's light is, from its params, always fifty-three parts in this order: the main light with the
 * face near it (the lead color); the second light's stretch of edge in sixteen pieces asking for the warm color
 * (Yellow, Tan, or in a pack with no warm color its brightest left, Atmospheric's Steel or Ice), the same sixteen asking
 * for the pack's other warm color (`warm2`: Orange-red, Lime), and the same sixteen asking for a cool one (Cyan, Ice or
 * Steel): cool at the end nearer the main light, warm round its middle, the other warm at its far end, so its color
 * walks along its length over stretches, never at a point, weaker toward its ends and near the main light's part, and
 * all cool where the second light may not be warm (no pale part); the main light's far stretch of edge, dimmer than
 * its brightest (cool) in two pieces; two dim stretches of the outline (dark: Forest and Plum, Slate and Near-black). A
 * part not in the frame sits off it. Nothing here reads the colors.
 */
export function mergedParts(params: Readonly<Record<string, ParamValue>>): StagePart[] {
  // The second light's parts fade with it as a dragged main light comes near, the warm ones faster: a warm light
  // color in dim light goes brown.
  const fading = Math.min(1, Math.max(0, Number(params.partWarmFade ?? 0)))
  const warmSign = Number(params.partWarmSide ?? 1) > 0.5 ? 1 : -1
  // Where the second light may not be warm (out of focus, or near the main edge) every piece asks the cool color.
  const warmOk = Number(params.partEdgeWarm ?? 0) > 0.5
  // A ring of its own has wider parts, so its color fills its halo.
  const partWidth = Math.min(0.3, Math.max(0.01, Number(params.partSecondWidth ?? WARM_PART_WIDTH)))
  const ring = Number(params.partRing ?? 0) > 0.5
  const given = vec(params, 'partSecond', SECOND_OFF)
  const path = given.length === SECOND_OFF.length ? given : SECOND_OFF
  const lead = vec(params, 'partLead', PART_OFF)
  const smoothstep = (a: number, b: number, v: number) => {
    const t = Math.min(1, Math.max(0, (v - a) / (b - a)))
    return t * t * (3 - 2 * t)
  }
  const seconds = Array.from({ length: SECOND_PIECES }, (_, i) => {
    const u = warmSign * (-1 + (2 * i + 1) / SECOND_PIECES)
    // Each color strongest at its own place along the light, its neighbours' ratio changing by e^CROSS_SLOPE per half
    // length (Gaussian weights 1/CROSS_SLOPE wide in variance), the strongest at full strength.
    const weights = WALK.map((at) => Math.exp((-0.5 * CROSS_SLOPE) * (u - at) ** 2))
    const top = Math.max(...weights)
    const [coolShare, warmShare, warm2Share] = warmOk ? weights.map((w) => w / top) : [1, 0, 0]
    // Weaker toward its ends, where its own light fades and the main light comes back, and near the main light's own
    // part, so its colors don't take the main light's brightest light.
    const fromLead = Math.hypot((path[2 * i] + path[2 * i + 2]) / 2 - lead[0], (path[2 * i + 1] + path[2 * i + 3]) / 2 - lead[1])
    const end = (1 - SECOND_END_TAPER[1] * smoothstep(SECOND_END_TAPER[0], 1, Math.abs(u))) * smoothstep(LEAD_CLEAR[0], LEAD_CLEAR[1], fromLead)
    const piece = (want: FieldWant, strength: number): StagePart => ({ kind: 'line', from: [path[2 * i], path[2 * i + 1]], to: [path[2 * i + 2], path[2 * i + 3]], width: partWidth, want, strength })
    return {
      warm: piece('warm', end * fading * fading * warmShare),
      // A ring asks for a light color that isn't warm (`pale`) along with the cool one: where the pack has a cool color
      // the cool ask takes it first (Cyan, Ice) and `pale` gets none; where it has none, `pale` takes Lime, so the ring
      // is never Meta Blue. Without a `warm2` ask Lime is left for it.
      warm2: ring ? piece('pale', end * fading * coolShare) : piece('warm2', end * fading * fading * warm2Share),
      cool: piece('cool', end * fading * coolShare),
    }
  })
  const line = (key: string, want: FieldWant, strength = 1, width = EDGE_PART_WIDTH): StagePart => {
    const v = vec(params, key, PART_OFF)
    return { kind: 'line', from: [v[0], v[1]], to: [v[2], v[3]], width, want, strength }
  }
  // A dark stretch as a soft spot round its middle, so its dark color takes the dim room there, not only the line.
  const darkSpot = (key: string, radius: number): StagePart => {
    const v = vec(params, key, PART_OFF)
    return { kind: 'spot', at: [(v[0] + v[2]) / 2, (v[1] + v[3]) / 2], radius, want: 'dark', strength: 1 }
  }
  const spot = (key: string, want: FieldWant, strength = 1): StagePart => {
    const v = vec(params, key, PART_OFF)
    return { kind: 'spot', at: [v[0], v[1]], radius: Math.max(0.01, v[2]), want, strength }
  }
  // The third light asks its own color: the bright one where it is bright (Yellow, Lime, Ice), else the cool one, with
  // `pale` beside it for a pack with no cool color. Without a third light its pieces ask nothing new.
  const givenThird = vec(params, 'partThird', THIRD_OFF)
  const thirdPath = givenThird.length === THIRD_OFF.length ? givenThird : THIRD_OFF
  const thirdHere = thirdPath[0] > -8
  const thirdFade = Math.min(1, Math.max(0, Number(params.partThirdFade ?? 0)))
  const thirdBright = thirdHere && Number(params.partThirdBright ?? 0) > 0.5
  const thirds = Array.from({ length: THIRD_PIECES }, (_, i) => {
    const u = -1 + (2 * i + 1) / THIRD_PIECES
    const end = (1 - SECOND_END_TAPER[1] * smoothstep(SECOND_END_TAPER[0], 1, Math.abs(u))) * thirdFade
    const piece = (want: FieldWant, strength: number): StagePart => ({ kind: 'line', from: [thirdPath[2 * i], thirdPath[2 * i + 1]], to: [thirdPath[2 * i + 2], thirdPath[2 * i + 3]], width: RING_PART_WIDTH, want, strength })
    return { own: piece(thirdBright ? 'bright' : 'cool', end), pale: thirdHere && !thirdBright ? piece('pale', end) : piece('cool', 0) }
  })
  return [
    spot('partLead', 'any'),
    ...seconds.map((s) => s.warm),
    ...seconds.map((s) => s.warm2),
    ...seconds.map((s) => s.cool),
    line('partCool', 'cool'),
    line('partCool2', 'cool'),
    ...(DARK_WASH ? [darkSpot('partDark', DARK_SPOT[0]), darkSpot('partDark2', DARK_SPOT[1])] : [line('partDark', 'dark', 1, DARK_PART_WIDTH), line('partDark2', 'dark', 1, DARK2_PART_WIDTH)]),
    ...thirds.map((s) => s.own),
    ...thirds.map((s) => s.pale),
  ]
}
