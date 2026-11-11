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
  { name: 'Halo', kind: 'ring', size: 2.2, rotate: 0, target: [0.3, 0.05], hotAt: 0.5 },
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
 * The seed's design, from the seed alone. Seeds that share a shape (seed, seed + 9, ...) differ in which part of the
 * outline is in the frame and how big, the turn and mirror, where the light sits along it and how far its haze reaches.
 */
export function seedDesign(seed: number) {
  const s = Math.round(seed)
  const rand = seededRandom(s, 913)
  const variant = Math.floor((s - 1) / LAYOUTS.length)
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
  const jitter: Jitter = { turn, shift, scale, mirror, slide: lerp(-1, 1, rand()) }
  const face = { faceDraw: rand(), faceReachDraw: rand() }
  // The second light: which side it takes (the other edge when one shows, else the far stretch), where along it, how
  // strong and how long.
  const second = { secondSide: rand(), secondAt: rand(), secondGain: rand(), secondWidth: rand() }
  // Whether the second light asks for a warm color (Yellow, Tan) or a cool one (Cyan, Ice, Steel), where its glow stays
  // off the main light's face.
  const edge = { edgeWarm: rand() < 0.5 }
  return { layout: (((s - 1) % LAYOUTS.length) + LAYOUTS.length) % LAYOUTS.length, jitter, ...draws, ...face, ...second, ...edge }
}

/** Index into MERGED_SHAPES of the seed's shape. */
export const shapeOfSeed = (seed: number): number => seedDesign(seed).layout

/** The seed that shows `shape` and keeps the seed's own place among the seeds sharing a shape, from 1 to `max`. */
export function seedWithShape(seed: number, shape: number, max = 100): number {
  const n = LAYOUTS.length
  const variant = Math.floor((Math.round(seed) - 1) / n)
  const k = ((Math.round(shape) % n) + n) % n
  let s = variant * n + k + 1
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
  const chordClear = (a: Vec2, b: Vec2) => Array.from({ length: 9 }, (_, k) => k / 8).every((f) => outside([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]) > 0.5 * FAR_MARGIN)
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

/** An accent's stretch is this share of its color's share of the light colors. */
const ACCENT = 0.6

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
  const accentWidth = (i: number) => ACCENT * accentScale * width(i)
  const core = Math.max(0.04, Math.min(0.12, 0.25 * width(key)))
  const lowAccents = sides[0].reduce((s, i) => s + accentWidth(i), 0)
  const highAccents = sides[1].reduce((s, i) => s + accentWidth(i), 0)
  const coreFrom = Math.min(Math.max(hotAt - core / 2, lowAccents + 0.02), 1 - highAccents - core - 0.02)
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
/** The dark colors keep clear of the second light's brighter middle only (this share of its half length), since its
 * ends fade to black. */
const DARK_SECOND_SHARE = 0.7
/** Outside a wash its haze and face light against the main light's: its own glow carries its color, and a wide dim
 * halo around it would take the main light's color through the stage. */
const STRETCH_FAR = 0.2
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
  const { spec, anchor } = placeLayout(def, aspect, design.jitter, Math.min(0.75, Math.max(0.25, def.hotAt + design.hotShift)))
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
  const starts = nearestOnContours(merged, anchorR, hot).ts.map((t) => round4(t - 0.5))
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
      // The other contours take the key's color whole (the key's unit) or no light.
      [`e${e + 1}Rest`]: unit.colors.includes(plan.key) ? slotOf(plan.key) : 1,
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
  let secondOn: { contour: number; t: number; tSpan: number; near: number } | null = null
  // A warm second light only where its glow stays off the main light's face (over it the two blend into violet): in
  // focus, on the main edge, where the main light goes dark along it, or on another edge that keeps clear of the main
  // edge.
  let edgeWarm = false
  if (secondPoint && host >= 0) {
    const on2 = nearestOnContours(drawn, anchorR, secondPoint)
    const tSpan = halfLength / (contourLength(drawn.contours[on2.contour]) || 1)
    const near = smooth01(0.3, 0.55, Math.sqrt(dist2(hot, secondPoint)))
    secondOn = { contour: on2.contour, t: on2.ts[on2.contour], tSpan, near }
    const stretchPoints = [-1, -0.5, 0, 0.5, 1].map((k) => {
      const c = drawn.contours[on2.contour]
      const t = on2.ts[on2.contour] + k * tSpan
      const q = contourPoint(c, c.closed ? t - Math.floor(t) : Math.min(1, Math.max(0, t))).point
      return [q[0] + anchorR[0], q[1] + anchorR[1]] as Vec2
    })
    const clearOfMain = stretchPoints.every((p) => homeRun.every((q) => dist2(p, q) >= WARM_CLEAR * WARM_CLEAR))
    edgeWarm = !def.wash && blur <= WARM_BLUR && design.edgeWarm && (!edgeLight || clearOfMain)
    // A cool light stays dimmer than the main light's glow: through the stage only its hottest part takes its color
    // and the rest of it is Meta Blue, which would then be Meta Blue's brightest light, lit only beside another color.
    const peak = (def.wash ? lerp(0.5, 0.75, design.secondGain) : edgeWarm ? lerp(WARM_PEAK[0], WARM_PEAK[1], design.secondGain) : lerp(COOL_PEAK[0], COOL_PEAK[1], design.secondGain)) * near
    const at = (def.wash ? SECOND_SHAPE : FADE_SHAPE).map((o) => round4(Math.min(0.999, Math.max(0.001, on2.ts[on2.contour] + o * tSpan))))
    const gains = (def.wash ? SECOND_LEVEL : FADE_LEVEL).map((g) => round4(g * peak))
    // The pack's warm or bright color: the unit's warmest (Orange-red) along the stretch and its brightest at the core
    // (Yellow); a wash's glow takes the brightest, like the poster's yellow glow in the blue.
    const members = plan.second >= 0 ? plan.units[plan.second].colors : [plan.key]
    // A cool one takes the pack's lightest light color that isn't warm (Cyan, Ice), or the key's where there is none
    // (Elemental), as the stage colors it.
    const coolest = colors
      .map((_, i) => i)
      .filter((i) => i !== plan.key && shares[i] > 0.001 && L(colors[i]) >= LIGHT_L && !(chroma(colors[i]) > 0.04 && hue(colors[i]) >= 20 && hue(colors[i]) <= 140))
      .sort((a, b) => L(colors[b]) - L(colors[a]))[0] ?? plan.key
    const cool = !def.wash && !edgeWarm
    const warmest = slotOf(cool ? coolest : members.reduce((a, b) => (warmthOf(colors[b]) > warmthOf(colors[a]) ? b : a)))
    const brightest = slotOf(cool ? coolest : members.reduce((a, b) => (L(colors[b]) > L(colors[a]) ? b : a)))
    const side = def.wash ? brightest : warmest
    // A warm one's ends, where the main light comes back, are the pale bridge between the key's color and its own.
    const end = edgeWarm ? 10 * slotOf(plan.key) + side : side
    const e = host + 1
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
      secondAt: [round4(secondPoint[0] - anchorR[0]), round4(secondPoint[1] - anchorR[1])],
      // An edge's own light turns near white where it is hottest, like a ring's.
      secondCore: edgeLight ? EDGE_CORE : SECOND_CORE,
      // A cool one's glow is a little wider than the main one's, so its color reads in it; a warm one keeps the narrow
      // glow: wider, its color reached the main light's and mixed to mauve or indigo.
      secondGlow: round4(def.wash || edgeWarm ? 1 / MAIN_GLOW : EDGE_GLOW),
      secondGlowWeight: round4((def.wash || edgeWarm ? SECOND_GLOW_WEIGHT : EDGE_GLOW_WEIGHT) / MAIN_GLOW_WEIGHT),
      // Its glow lies on both sides of its line.
      secondGlowSide: def.wash ? -1 : 0,
      // Along the second light's stretch the main light's line hands over to it: dark round the second light's middle
      // and back to full at its ends, so the line has no dark gap.
      gapAt: round4(on2.ts[on2.contour]),
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
      secondFar: def.wash ? 0.8 : STRETCH_FAR,
      secondPale: def.wash ? 1 : 0,
    })
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
  const partParams: Record<string, ParamValue> = { partWarm: PART_OFF, partWarm2: PART_OFF, partWarmFade: 0, partEdgeWarm: 0 }
  if (secondOn && Number(secondParams.secondUnit) > 0) {
    const { contour, t, tSpan, near } = secondOn
    const [a, b, c] = [-1, 0, 1].map((k) => framePoint(pointOn(contour, t + k * tSpan)))
    Object.assign(partParams, { partWarm: [...a, ...b], partWarm2: [...b, ...c], partWarmFade: round4(near), partEdgeWarm: edgeWarm ? 1 : 0 })
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
  const secondMiddle = secondOn ? pointOn(secondOn.contour, secondOn.t) : null
  const coolMiddle = pointOn(onHome.contour, tHome + (away * COOL_AT[1]) / homeLength)
  const clearOf = (p: Vec2) =>
    Math.abs(p[0]) <= fw / 2 - DARK_MARGIN &&
    Math.abs(p[1]) <= fh / 2 - DARK_MARGIN &&
    Math.sqrt(dist2(p, seedHome)) >= DARK_FROM_MAIN &&
    (!secondMiddle || Math.sqrt(dist2(p, secondMiddle)) >= (def.wash ? 1 : DARK_SECOND_SHARE) * halfLength + DARK_CLEAR) &&
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
    ...unitParams,
    ...secondParams,
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
    // A little bloom on the finest levels spreads each light in its own color around its core.
    lens: { bloom: 0.05, bloomRadius: 0.12, bloomWidth: 1, halation: 0 },
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
 * Where the merged look's light is, from its params, always nine parts in this order: the main light with the face
 * near it (the lead color); the second light's stretch of edge in two pieces, asking for a warm color (Yellow over
 * Orange-red, Tan, or in a pack with no warm color its brightest left, Atmospheric's Steel or Ice) or a cool one (Cyan,
 * Ice or Steel) as the seed picks, and the same two asking for a pale color when it is cool (at strength 0 when it is
 * warm); the main light's far stretch of edge, dimmer than its brightest (cool) in two pieces; two dim stretches of the
 * outline (dark: Forest and Plum, Slate and Near-black). A part not in the frame sits off it. Nothing here reads the
 * colors.
 */
export function mergedParts(params: Readonly<Record<string, ParamValue>>): StagePart[] {
  // The second light's parts fade with it as a dragged main light comes near.
  const fading = Math.min(1, Math.max(0, Number(params.partWarmFade ?? 0)))
  const edge: FieldWant = Number(params.partEdgeWarm ?? 0) > 0.5 ? 'warm' : 'cool'
  const line = (key: string, want: FieldWant, strength = 1, width = EDGE_PART_WIDTH): StagePart => {
    const v = vec(params, key, PART_OFF)
    return { kind: 'line', from: [v[0], v[1]], to: [v[2], v[3]], width, want, strength }
  }
  const spot = (key: string, want: FieldWant, strength = 1): StagePart => {
    const v = vec(params, key, PART_OFF)
    return { kind: 'spot', at: [v[0], v[1]], radius: Math.max(0.01, v[2]), want, strength }
  }
  return [
    spot('partLead', 'any'),
    line('partWarm', edge, fading, WARM_PART_WIDTH),
    line('partWarm2', edge, fading, WARM_PART_WIDTH),
    // A cool second light asks for a pale color too (Lime, where the pack has no cool color; Ice, where Steel took the
    // cool one). Not `bright`, which takes Yellow when no part asks for a warm color.
    line('partWarm', 'pale', edge === 'cool' ? fading : 0, WARM_PART_WIDTH),
    line('partWarm2', 'pale', edge === 'cool' ? fading : 0, WARM_PART_WIDTH),
    line('partCool', 'cool'),
    line('partCool2', 'cool'),
    line('partDark', 'dark', 1, DARK_PART_WIDTH),
    line('partDark2', 'dark', 1, DARK2_PART_WIDTH),
  ]
}
