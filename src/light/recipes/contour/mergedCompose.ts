import { linearToOklab } from '../../color/oklab'
import { hexToLinear } from '../../color/srgb'
import type { StagePart } from '../../color/stageFields'
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
import {
  META_LOGO_LANDMARKS,
  META_LOGO_PARTS,
  primitiveLength,
  primitivePoint,
  segment,
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
}

const LAYOUTS: readonly LayoutDef[] = [
  { name: 'Arch', kind: 'logo', feature: 'rightTop', size: 2.6, rotate: 0, target: [0.15, 0.35], hotAt: 0.5 },
  { name: 'Loop end', kind: 'logo', feature: 'rightEnd', size: 2.0, rotate: 0, target: [-0.36, 0.05], hotAt: 0.45, tall: 1.8 },
  { name: 'Bend', kind: 'logo', feature: 'rightBottom', size: 2.8, rotate: -25, target: [0.25, -0.45], hotAt: 0.5 },
  { name: 'Corner', kind: 'roundedSquare', size: 1.5, radius: 0.45, rotate: -12, target: [0.3, 0.2], hotAt: 0.5 },
  { name: 'Ribbon', kind: 'logo', feature: 'ribbon', size: 3.0, rotate: -30, target: [0.05, 0.15], hotAt: 0.5 },
  { name: 'Halo', kind: 'ring', size: 1.5, rotate: 0, target: [0.1, 0.1], hotAt: 0.5 },
  { name: 'Close', kind: 'roundedSquare', size: 1.1, radius: 0.7, rotate: -18, target: [0.12, 0.05], hotAt: 0.5, blur: 3.2, fill: 2.6 },
  { name: 'Horizon', kind: 'ring', size: 5, rotate: 0, target: [0, 0.42], hotAt: 0.5, blur: 1.4, fill: 1.6, outside: true, rays: true, turn: 0.3 },
  { name: 'Wash', kind: 'ring', size: 3.4, rotate: 0, target: [-0.15, -0.3], tallTarget: [-0.15, -0.05], hotAt: 0.5, tall: 1.2, blur: 7, fill: 3.4, soft: true, outside: true },
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
}

/** A logo crop shows one part of the logo: no second part and no second landmark comes near the frame. */
function logoTooWide(spec: MergedShapeSpec, anchor: Vec2, aspect: number): boolean {
  return (
    logoPartsShown(META_LOGO_PARTS, spec.size, spec.rotate, spec.flip, anchor, aspect) > 1 ||
    pointsNearFrame(META_LOGO_LANDMARKS, spec.size, spec.rotate, spec.flip, anchor, aspect, 0.05 + 0.15 * spec.size) > 1
  )
}

function placeLayout(def: LayoutDef, aspect: number, jitter: Jitter): { spec: MergedShapeSpec; anchor: Vec2 } {
  const [fw, fh] = frameSize(aspect)
  const at = aspect < 1 && def.tallTarget ? def.tallTarget : def.target
  const target: Vec2 = [(at[0] + jitter.shift[0]) * (fw / 2), (at[1] + jitter.shift[1]) * (fh / 2)]
  const radius = (def.radius ?? 0.3) * jitter.scale
  const rotate = def.rotate + jitter.turn * (def.turn ?? 1)
  const place = (size: number) => {
    let point: Vec2
    if (def.kind === 'logo') {
      const f = FEATURE[def.feature ?? 'rightTop']
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
  return placed
}

/**
 * The seed's design, from the seed alone. Seeds that share a shape (seed, seed + 9, ...) differ in which part of the
 * outline is in the frame and how big, the turn and mirror, where the light sits along it and how far its haze reaches.
 */
export function seedDesign(seed: number) {
  const s = Math.round(seed)
  const rand = seededRandom(s, 913)
  const variant = Math.floor((s - 1) / LAYOUTS.length)
  const jitter: Jitter = {
    turn: lerp(-24, 24, rand()),
    shift: [lerp(-0.16, 0.16, rand()), lerp(-0.16, 0.16, rand())],
    scale: lerp(0.8, 1.3, rand()),
    mirror: (variant % 2 === 1) !== (rand() < 0.25),
  }
  return {
    layout: (((s - 1) % LAYOUTS.length) + LAYOUTS.length) % LAYOUTS.length,
    jitter,
    hotShift: lerp(-0.25, 0.25, rand()),
    reachDraw: rand(),
    powerDraw: rand(),
    hotDraw: rand(),
    hazeDraw: rand(),
    rayDraw: rand(),
    keyDraw: rand(),
  }
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

  // Far out of focus an accent spreads over the key's light, so there only colors that mix clean with the key show.
  const accents = units.map((_, k) => k).filter((k) => k !== keyUnit && (!cleanOnly || mixesClean(colors[units[k].own], colors[key])))
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
  return { units, stretches, key, ground: { near, far } }
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

const smooth01 = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export function composeMerged(input: MergedInput): Composition & { layoutName: string } {
  const { colors, controls, seed, aspect } = input
  const shares = input.shares ?? defaultShares(colors)
  const design = seedDesign(seed)
  const def = LAYOUTS[input.layout ?? design.layout]
  const { spec, anchor } = placeLayout(def, aspect, design.jitter)
  const shape0 = buildMergedShape(spec)
  const runs = visibleRuns(shape0, anchor, aspect)
  const run = longestRun(runs)
  const [fw, fh] = frameSize(aspect)
  // The mood control (Light position; the tool holds it at 0.5) moves the light along the edge from the seed's place.
  const homeAt = Math.min(0.85, Math.max(0.15, def.hotAt + design.hotShift + 0.4 * (controls.mood - 0.5)))
  const home = pointAlong(run, homeAt) ?? anchor
  const dragged = controls.drag ? dragLight(controls.drag, runs, aspect) : null
  const hot = dragged?.hot ?? home
  const gain = geo(controls.intensity, 0.35, 1, 2.8)
  const blur = def.blur ?? 1
  const soften = geo(controls.softness, 0.3, 1, 1.7) * blur
  const power = lerp(2.4, 3.2, design.powerDraw)
  const factor = lerp(10, 30, design.reachDraw)
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

  const parts = productionParts('', { side: def.outside ? 2 : 1, soften, face: 0.035 * (def.fill ?? 1), glow: 0.009, haze: round4(0.04 * hazeScale), fan: 2 })
  // A light brightens in its own color first: a small hot spot over a strong colored glow, so a blue light blooms
  // saturated blue and only a thin core goes to white.
  Object.assign(parts, { n1Weight: 0.8, n2Weight: 1.1, n3Weight: 1.2, f1Weight: round4(0.09 * (def.fill ?? 1)), f2Width: round4(0.035 * hazeScale) })
  const coreBlur = def.soft ? blur : blur ** 0.6
  // Out of focus, the hot core spreads over a large area, so it carries less light there, as a defocused lamp does.
  if (blur > 1) Object.assign(parts, { n1Width: round4(0.0014 * coreBlur), n3Width: round4(0.0035 * coreBlur), n3Weight: round4(1.2 / blur ** 0.7) })
  if (def.outside) Object.assign(parts, { f3Side: 2 })
  // A light outside the frame lights a wider stretch of the edge, but the face behind the edge stays near the edge:
  // lit as widely as the hot spot it read as a flat field of haze.
  if (spread > 0) Object.assign(parts, { f3Weight: round4(Number(parts.f3Weight) * (1 - 0.92 * smooth01(0, 0.35, spread))) })

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
    keySlot: slotOf(plan.key),
    ...unitParams,
    ...parts,
    farWidth: 0.01,
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
    groundDir: [round4(-hot[0] / Math.max(1e-3, Math.hypot(hot[0], hot[1]))), round4(-hot[1] / Math.max(1e-3, Math.hypot(hot[0], hot[1]))), -0.5, 0.7],
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

const num = (params: Readonly<Record<string, ParamValue>>, key: string, fallback: number) => {
  const v = params[key]
  return typeof v === 'number' ? v : fallback
}
const vec = (params: Readonly<Record<string, ParamValue>>, key: string, fallback: readonly number[]) => {
  const v = params[key]
  return Array.isArray(v) ? v : fallback
}

/**
 * Where the merged look's light is, from its params: the light at its core with its near haze (the lead color's), then
 * the face and haze it lights on the shape's inside (outside behind a horizon). Two parts, as the stage lays its own
 * fields along the bright outline and keeps eight fields in all. Nothing here reads the colors.
 */
export function mergedParts(params: Readonly<Record<string, ParamValue>>, aspect: number): StagePart[] {
  const [fw, fh] = frameSize(aspect)
  const at = vec(params, 'at', [0.5, 0.5])
  const anchor: Vec2 = [(at[0] - 0.5) * fw, (at[1] - 0.5) * fh]
  const lightAt = vec(params, 'light1At', [0, 0])
  const hot: Vec2 = [anchor[0] + lightAt[0], anchor[1] + lightAt[1]]
  const frame = (p: Vec2): [number, number] => [round4(p[0] / fw + 0.5), round4(p[1] / fh + 0.5)]
  const side = num(params, 'f1Side', 1) === 2 ? -1 : 1
  const toMiddle: Vec2 = [anchor[0] - hot[0], anchor[1] - hot[1]]
  const len = Math.hypot(toMiddle[0], toMiddle[1]) || 1
  const inward: Vec2 = [(side * toMiddle[0]) / len, (side * toMiddle[1]) / len]
  const haze = num(params, 'f1Width', 0.04) * num(params, 'soften', 1)
  const reach = 0.12 + haze
  return [
    { kind: 'spot', at: frame(hot), radius: round4(num(params, 'light2Radius', 0.18) + 0.05), want: 'any' },
    { kind: 'spot', at: frame([hot[0] + inward[0] * reach, hot[1] + inward[1] * reach]), radius: round4(0.2 + 0.5 * num(params, 'f3Weight', 0.035) + 1.5 * haze) },
  ]
}
