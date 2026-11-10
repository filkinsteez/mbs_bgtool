import { linearToOklab } from '../../color/oklab'
import type { PackColor } from '../../color/packs'
import { hexToLinear } from '../../color/srgb'
import { toneCurve } from '../../engine/output'
import type { ControlValues } from '../../scene'
import { airLevelFor } from './curveLight'
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

/** The light slots of a block of 8 seeds: each seed gets a different one, which picks its light's color (curveRoles). */
const SLOTS: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7]

/**
 * The slot groups the plan spreads kinds and places over: slots 0-2, 3-5 and 6-7, as a list of three light colors
 * shares out its lights (lightSlots). Fixed, so the plan reads no colors.
 */
const PLAN_GROUPS: readonly number[] = [0, 0, 0, 1, 1, 1, 2, 2]

/**
 * Light slot, shape kind and place for a seed, from the seed alone, so a seed has the same design in every pack and
 * with any colors (owner, 2026-11-09). Planned for its whole block of 8: each seed gets its own slot and place, and
 * the seeds of one slot group differ in kind where the block allows and light parts of the frame as far apart as the
 * places left allow (SHARED.md 10:15 AM: no two of seeds 1-8 look like the same frame).
 */
export function blockPlan<K>(seed: number, salt: number, kinds: readonly K[]): { slot: number; kind: K; place: Vec2 } {
  const s = Math.round(seed)
  const first = Math.floor((s - 1) / 8) * 8 + 1
  const slots = Array.from({ length: 8 }, (_, j) => blockItem(first + j, salt, SLOTS))
  const kindsLeft = Array.from({ length: 8 }, (_, j) => blockItem(first + j, salt + 1, kinds))
  const placesLeft = Array.from({ length: 8 }, (_, j) => blockItem(first + j, salt + 2, PLACES))
  const angle = (p: Vec2) => Math.atan2(p[1], p[0])
  const apart = (a: Vec2, b: Vec2) => Math.abs(Math.atan2(Math.sin(angle(a) - angle(b)), Math.cos(angle(a) - angle(b))))
  const used: { slot: number; kind: K; place: Vec2 }[] = []
  for (let j = 0; j <= (((s - 1) % 8) + 8) % 8; j++) {
    const same = used.filter((u) => PLAN_GROUPS[u.slot] === PLAN_GROUPS[slots[j]])
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
    used.push({ slot: slots[j], kind, place: placesLeft.splice(p, 1)[0] })
  }
  return used[used.length - 1]
}

/**
 * The colors bright enough to be a light (or, with none, the lightest one), shared out over the 8 light slots as
 * evenly as 8 allows, the first ones in the list taking the spare slots: four lights 2 each, three 3, 3 and 2.
 */
function lightSlots(colors: readonly PackColor[]): PackColor[] {
  const bright = colors.filter((c) => lightness(c.hex) > 0.5)
  const lights = bright.length > 0 ? bright : [...colors].sort((a, b) => lightness(b.hex) - lightness(a.hex)).slice(0, 1)
  return lights.flatMap((c, i) => Array.from({ length: Math.floor(8 / lights.length) + (i < 8 % lights.length ? 1 : 0) }, () => c))
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
 * grey, has no dark pack color to go to, so it warms toward copper amber
 * ('bright'). Null for cool lights, which keep their color as they dim.
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
 * brightness. Tan keeps its color near its own level and warms toward copper
 * amber as it falls off.
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

/**
 * How much of its wide dim light (a halo's outer fade, a pale arc's inside glow, a rim's haze) a light shows. Tan,
 * warm and nearly grey, has no dark color to fade into, and dimmed over a wide area it reads brown (C-025), so it
 * shows TAN_DIM of it, and a Tan rim keeps no face; its curve, band and hot spot stay where the design puts them.
 */
const TAN_DIM = 0.25
export const dimShare = (hex: string) => (warmTail(hex) === 'bright' ? TAN_DIM : 1)

/** Oklab lightness of a base: dark enough that text set on it reads, light enough to tell from black. */
const BASE_LIGHTNESS = 0.1
const baseAtLow = (hex: string) => ({ hex, gain: round4((BASE_LIGHTNESS / lightness(hex)) ** 3) })

/**
 * Bases a warm light's dim tail must not fade into, because the mix between
 * them is a third color: deep red over Meta Blue or Cyan turns maroon, magenta
 * or grey, Lime's green over Plum grey, and Tan's copper over Meta Blue or Cyan
 * mauve-grey, over Forest olive and over Plum maroon.
 */
const BASES_TAIL_MUDDIES: Record<WarmTail, readonly string[]> = {
  'deep red': ['#0064E0', '#1FCDF0'],
  forest: ['#4A0A3C'],
  bright: ['#0064E0', '#1FCDF0', '#0F3D33', '#4A0A3C'],
}

/** The share of seeds whose base is a dark color at low light instead of black (pickBase). */
const BASE_SHARE = 0.5

/** Oklab chroma under which a color is a grey. */
const GREY_CHROMA = 0.05

const hueOf = (hex: string) => {
  const [, a, b] = linearToOklab(hexToLinear(hex))
  return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360
}
const chromaOf = (hex: string) => {
  const [, a, b] = linearToOklab(hexToLinear(hex))
  return Math.hypot(a, b)
}
/** Degrees between two hues, 0 to 180. */
const hueApart = (x: number, y: number) => Math.abs(((x - y + 540) % 360) - 180)
const BLACK_BASE = { hex: '#000000', gain: 0 }

/**
 * The base, as slot color and gain: black, or for BASE_SHARE of the seeds (`draw`, the same in every pack, so a
 * design keeps its dark) a dark color of the list at low light that the light's dim tail fades into cleanly, the draw
 * picking among them. A list with no dark color (Bold) takes the deep shade of its deepest cool color (Meta Blue's
 * navy, or Cyan's). Black when no color fades cleanly.
 */
function pickBase(colors: readonly PackColor[], light: PackColor, draw: number): { hex: string; gain: number } {
  if (draw < 1 - BASE_SHARE) return BLACK_BASE
  const tail = warmTail(light.hex)
  const muddy = tail ? BASES_TAIL_MUDDIES[tail] : []
  const darks = colors.filter((c) => lightness(c.hex) < 0.45)
  const cool = colors
    .filter((c) => chromaOf(c.hex) >= GREY_CHROMA && hueOf(c.hex) >= 180 && hueOf(c.hex) <= 300)
    .sort((a, b) => lightness(a.hex) - lightness(b.hex))
  const options = (darks.length > 0 ? darks : cool.slice(0, 1)).filter((c) => !muddy.includes(c.hex.toUpperCase()))
  if (options.length === 0) return BLACK_BASE
  const at = Math.min(options.length - 1, Math.floor(((draw - (1 - BASE_SHARE)) / BASE_SHARE) * options.length))
  return baseAtLow(options[at].hex)
}

/**
 * Shares of a light's parts in its pale color: `body` of a band's body, `line` of a rim's thin core line, which is
 * near white wherever it shows, so a grey there stays grey, `band` of the rim's color band beside it, `air` of the dim
 * haze around the light, `face` of a rim's face, `core` of its hot core, and `edge` of the glow at the frame's edge
 * from a light dragged outside it (offFrameGlow). A part keeps its luminance, so only its color changes.
 */
export interface PaleShares {
  body: number
  line: number
  band: number
  air: number
  face: number
  core: number
  edge: number
}

/**
 * The shares by the kind of pale color. A lighter color of a nearby hue (Cyan for Meta Blue): the light stays
 * saturated and its pale side leans that color, the core taking it and the body leaning halfway. A lighter grey
 * (Steel): the core goes grey and the body keeps the light's own pale blue, since part of a grey mixed into Meta Blue
 * turns it periwinkle (Meta Blue has no red and the greys do); the haze and the face go fully grey, an overcast
 * grey-blue, as they are at or below the light's level, where the tone curve doesn't turn the mix violet. A dark color
 * (Forest): only the face, the dim air inside a rim's edge; the hot core keeps the light's own color, since at the
 * light's level Forest turned it teal beside the blue edge.
 */
const PALE_SHARES: Record<'none' | 'light' | 'grey' | 'dark', PaleShares> = {
  none: { body: 0, line: 0, band: 0, air: 0, face: 0, core: 1, edge: 0 },
  light: { body: 0.5, line: 0.5, band: 0.15, air: 0.8, face: 0.6, core: 1, edge: 0 },
  grey: { body: 0, line: 0.6, band: 0.4, air: 1, face: 1, core: 1, edge: 0.6 },
  dark: { body: 0, line: 0, band: 0, air: 0, face: 1, core: 0, edge: 0 },
}

/** A light this deep and saturated (Meta Blue) has a pale side in another color: overexposed, it whitens late and keeps its hue. */
const PALE_LIGHT_MAX_L = 0.6
const PALE_LIGHT_MIN_CHROMA = 0.15
/** How far (degrees) a lighter color's hue may be from the light's to be its pale side. */
const PALE_HUE = 45

/**
 * The pale color a light's pale side takes, from the colors given, and how much of each part takes it: a deep
 * saturated light (Meta Blue) leans a lighter color of a nearby hue (Cyan), else the nearest lighter grey (Steel),
 * else, in a rim's face only, a dark green (Oklab hue 150 to 210, Forest; a dark toward violet, Plum, turns blue
 * indigo). So a Meta Blue frame shows which colors it is with. None for other lights, which show their own color.
 */
function paleFor(colors: readonly PackColor[], light: PackColor, look: 'halo' | 'rim'): { color: PackColor | null } & PaleShares {
  const none = { color: null, ...PALE_SHARES.none }
  const L = lightness(light.hex)
  if (L >= PALE_LIGHT_MAX_L || chromaOf(light.hex) < PALE_LIGHT_MIN_CHROMA) return none
  const hue = hueOf(light.hex)
  const others = colors.filter((c) => c.hex !== light.hex)
  const lighter = others.filter((c) => lightness(c.hex) > L)
  const tint = lighter.find((c) => chromaOf(c.hex) >= GREY_CHROMA && hueApart(hueOf(c.hex), hue) <= PALE_HUE)
  if (tint) return { color: tint, ...PALE_SHARES.light }
  const grey = lighter.filter((c) => chromaOf(c.hex) < GREY_CHROMA).sort((a, b) => lightness(a.hex) - lightness(b.hex))[0]
  if (grey) return { color: grey, ...PALE_SHARES.grey }
  if (look !== 'rim') return none
  const dark = others.find((c) => lightness(c.hex) < 0.45 && chromaOf(c.hex) >= GREY_CHROMA && hueOf(c.hex) >= 150 && hueOf(c.hex) <= 210)
  return dark ? { color: dark, ...PALE_SHARES.dark } : none
}

/** Which color fills which role in a Rim or Halo design (curveRoles). */
export interface CurveRoles {
  /** The light. */
  light: PackColor
  /** The dark ground: a color at low light (slot color and gain), or black (gain 0). */
  base: { hex: string; gain: number }
  /** The color the light's pale side takes (core, haze, a rim's face; null for none) and how much of each part takes it. */
  pale: { color: PackColor | null } & PaleShares
  /** The colors a line runs through from its bright end, and the warm color whose fall it takes. */
  line: { hues: PackColor[]; dims: PackColor | null }
  /** The colors a ring's rim turns through, the light's own first. */
  ring: PackColor[]
}

/**
 * Which color fills which role in a Rim or Halo design, from the colors given (2 to 5 pack colors, in any order, with
 * or without Meta Blue) and what the seed's design asks: its light slot (blockPlan) and its base draw. The design
 * never reads the colors, so other colors only recolor it (owner, 2026-11-09). The light is the slot's share of the
 * colors bright enough to be one; the base, the pale side and the hues along a line or ring follow from the light.
 */
export function curveRoles(colors: readonly PackColor[], design: { slot: number; baseDraw: number }, look: 'halo' | 'rim'): CurveRoles {
  const light = lightSlots(colors)[design.slot]
  return {
    light,
    base: pickBase(colors, light, design.baseDraw),
    pale: paleFor(colors, light, look),
    line: lineHues(colors, light),
    ring: ringHues(colors, light),
  }
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/**
 * How far outside the frame (short sides) a dragged line is when its air glow is all there, and the haze's falloff.
 * The glow is the haze's to the power 4: a light well outside the frame lights all of it a little, and a dim tail's
 * color (deep red, Forest, copper) over the whole frame reads as a tinted dark instead of light at the edge.
 */
const OFF_FRAME_FROM = 0.15
const OFF_FRAME_FALLOFF = 0.22
const OFF_FRAME_POWER = 4
/** Past OFF_FRAME_FROM, the edge's glow is half as bright this much farther out (short sides), a fifth at twice that. */
const OFF_FRAME_FADE = 0.15

/**
 * How a dragged light whose start is outside the frame spreads along the outline: a far light lights a longer
 * stretch of an edge. Its reach grows by this times its distance from the hot spot (short sides), coming in over the
 * start's first OFF_FRAME_FROM short sides outside the frame; inside the frame the drag places the light as before.
 */
const OFF_FRAME_SPREAD = 1

/** The extra reach (short sides) of a dragged light whose start is outside the frame, `hot` its hot spot (short-side units from the center). */
export function offFrameSpread(drag: ControlValues['drag'], hot: Vec2, aspect: number): number {
  if (!drag) return 0
  const [fw, fh] = frameSize(aspect)
  const share = smoothstep(0, OFF_FRAME_FROM, segmentOutside([drag.from[0], drag.from[1], drag.from[0], drag.from[1]], aspect))
  const from: Vec2 = [(drag.from[0] - 0.5) * fw, (drag.from[1] - 0.5) * fh]
  return share * OFF_FRAME_SPREAD * Math.hypot(from[0] - hot[0], from[1] - hot[1])
}

/** How far (short sides) a segment in frame coordinates (x0, y0, x1, y1) is outside the frame; 0 if it touches it. */
function segmentOutside(line: readonly number[], aspect: number): number {
  const [fw, fh] = frameSize(aspect)
  let least = Infinity
  const steps = 64
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const x = (line[0] + (line[2] - line[0]) * t - 0.5) * fw
    const y = (line[1] + (line[3] - line[1]) * t - 0.5) * fh
    least = Math.min(least, Math.hypot(Math.max(0, Math.abs(x) - fw / 2), Math.max(0, Math.abs(y) - fh / 2)))
  }
  return least
}

/**
 * Air glow 1 for a dragged line that leaves the frame (SHARED.md, 2026-11-05 11:22 AM: no drag leaves a frame
 * nearly black). A light outside the frame still lights the air near it, so the frame's nearest edge glows in its
 * color, at its own level there, and fades into the frame; the light keeps the dragged direction. It comes in over
 * the line's first OFF_FRAME_FROM short sides outside the frame and is off while any of the line is in it; farther
 * out it dims again (OFF_FRAME_FADE), since a far light lights the air at the edge less, and the outline it lights
 * carries the frame (offFrameSpread). With a share `pale` of its haze in the light's pale color (PaleShares' `edge`),
 * that share is air glow 2 in color slot 5.
 */
export function offFrameGlow(drag: ControlValues['drag'], hex: string, aspect: number, pale = 0): Record<string, number | number[]> {
  if (!drag) return {}
  const line = [drag.from[0], drag.from[1], drag.to[0], drag.to[1]]
  const outside = segmentOutside(line, aspect)
  // Cubed: on black even a glow of a few percent shows, and the eye sees about the cube root of the light.
  const share = smoothstep(0, OFF_FRAME_FROM, outside) ** 3 / (1 + (Math.max(0, outside - OFF_FRAME_FROM) / OFF_FRAME_FADE) ** 2)
  if (share <= 0) return {}
  const power = OFF_FRAME_POWER
  const level = airLevelFor(line, OFF_FRAME_FALLOFF, aspect, power) * share
  const drift = warmDrift(hex)
  const glow = (i: number, slot: number, part: number) => ({
    [`air${i}Line`]: line.map(round4),
    [`air${i}Level`]: round4(level * part),
    [`air${i}Falloff`]: OFF_FRAME_FALLOFF,
    [`air${i}Power`]: power,
    [`air${i}Color`]: slot,
  })
  return {
    ...glow(1, 2, 1 - pale),
    ...(drift ? { air1Drift: drift.ratios, air1DriftShape: [drift.knee, drift.sharpness] } : {}),
    ...(pale > 0 ? glow(2, 5, pale) : {}),
  }
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
  /**
   * The core line at HOT_CORE times the light's level where the light is strongest, following the light along the
   * edge as its haze does, so it overexposes to white in every pack and the light's color shows in the falloff beside
   * it. The look's halation then needs about a third of its strength for the same halo.
   */
  hotCore?: boolean
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
    n1Weight: light.hotCore ? HOT_CORE : 1.1,
    n1Width: round6(0.0014 / light.soften ** 0.7),
    n1Shape: 8,
    n1Side: 0,
    n1Light: 1,
    // Without the hot core, the core line fades more slowly than the glow, so it shows along the whole edge (the
    // rim-edge reference's 1 px line is all that is left at its far end).
    n1LightGamma: light.hotCore ? 1 : 0.5,
    // The edge's light landing on the face beside it, at a grazing angle: Lambert's cosine and the inverse square from
    // every point of the edge, a light FACE_HEIGHT above the face's plane, is flat for about the height and then falls
    // as 1 / distance^2. p = 2 has the same half width and falls as 1 / distance^4 past it, which keeps the part's
    // reach short (p = 1 drew every piece of the outline out to about 0.6 of the short side and made Rim 55% slower);
    // past about 0.02 of the short side the face's even fill (f3) takes over, as in the rim-edge reference.
    n2Weight: 0.9,
    n2Width: round6(FACE_HEIGHT / FACE_HALF_WIDTH_P2),
    n2Shape: 2,
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
    // With a pale color (curveRoles), the hot core takes it; the recipe sets the core line's and color band's shares.
    n3Pale: 1,
    // The haze around the edge, on both sides (the air in front of the face too): every point of the edge glows in
    // it as e^(-r / reach) / r (clAirlightWeights), with rim-edge's reach.
    f1Weight: HAZE_GLOW,
    f1Width: round6(light.haze ?? 0.024),
    f1Airlight: HAZE_REACH,
    f1Side: 0,
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

/** Level of a rim's hot core line where its light is strongest, times the light's own level (productionParts). */
const HOT_CORE = 8
/** Height of a rim's light above the face's plane, short sides (the grazing light on the face, productionParts). */
const FACE_HEIGHT = 0.006
/** Half width of the p = 2 near kernel across a straight emitter, in units of its width: 2 sqrt(sqrt(2) - 1). */
const FACE_HALF_WIDTH_P2 = 1.2872
/** Reach of the haze glow around an edge (rim-edge's dark side, fitted on the scatter rungs) and its level. */
const HAZE_REACH = 0.028
const HAZE_GLOW = 0.08

const prefixed = (prefix: string, values: Record<string, number | number[]>) =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [`${prefix}${key}`, value]))

/** A colored halo band's body level, which its core tops up to the light's near-white level. */
const HALO_BODY = 1.6

/** Oklab chroma a light still has where it is overexposed to near white: a little above the palette check's white. */
const NEAR_WHITE_CHROMA = 0.04
const nearWhiteLevels = new Map<string, number>()

/**
 * How many times its own level a light can reach before the tone curve fades it to near white, at most `cap`. Cyan
 * and Lime get there by about 3, Yellow at about 8, Orange-red only past 12. A band brighter than this at its peak
 * is pure white there and no longer shows which light it is.
 */
export function nearWhiteLevel(hex: string, cap = 12): number {
  const key = `${hex}:${cap}`
  const known = nearWhiteLevels.get(key)
  if (known !== undefined) return known
  const light = hexToLinear(hex)
  const chroma = (level: number) => {
    const [, a, b] = linearToOklab(toneCurve(light.map((v) => v * level)))
    return Math.hypot(a, b)
  }
  let level = cap
  if (chroma(1) <= NEAR_WHITE_CHROMA) level = 1
  else if (chroma(cap) <= NEAR_WHITE_CHROMA) {
    let lo = 1
    let hi = cap
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2
      if (chroma(mid) > NEAR_WHITE_CHROMA) lo = mid
      else hi = mid
    }
    level = hi
  }
  nearWhiteLevels.set(key, level)
  return level
}

/** 253 of 255 in linear light: at or above it in every channel a pixel is flat white (the palette check's rule). */
const FLAT_WHITE = 0.982
const flatWhiteLevels = new Map<string, number>()

/** How many times its own level a light can reach before the tone curve takes every channel to flat white, at most `cap`. */
export function flatWhiteLevel(hex: string, cap = 40): number {
  const key = `${hex}:${cap}`
  const known = flatWhiteLevels.get(key)
  if (known !== undefined) return known
  const light = hexToLinear(hex)
  const flat = (level: number) => Math.min(...toneCurve(light.map((v) => v * level))) >= FLAT_WHITE
  let level = cap
  if (flat(cap)) {
    let lo = 0
    let hi = cap
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2
      if (flat(mid)) hi = mid
      else lo = mid
    }
    level = hi
  }
  flatWhiteLevels.set(key, level)
  return level
}

/**
 * A white or grey light's band: its body and glows are held to WHITE_BODY_PER_LEVEL times the light's flat-white
 * level, a fifth of the old level for Ice, which reads a pale grey; Steel and Slate need far more light to go flat
 * and keep theirs. Overexposed, an Ice band was a flat white tube over up to 30% of the frame. Where the body is held
 * back, a thin core near the light, WHITE_CORE times that level, is the only part that reaches white.
 */
const WHITE_BODY_PER_LEVEL = 0.18
const WHITE_CORE = 1.25
const WHITE_CORE_WIDTH = 0.01
const whiteScale = (hex: string) => Math.min(1, WHITE_BODY_PER_LEVEL * flatWhiteLevel(hex))
const whiteCore = (hex: string) => (whiteScale(hex) < 1 ? round4(WHITE_CORE * flatWhiteLevel(hex)) : 0)

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
  // A broad pale arc (the yellow-halo example's, on dark): a band about a sixth of the short side wide just outside
  // the curve, with the light's saturated color in a wide glow beyond it. The band spills past the curve, so its
  // inner edge fades over about a tenth of the short side like the example's, instead of a hard limb. It widens where
  // the light dims, so its ends fade out broad instead of narrowing to a point. The tone curve turns a yellow light
  // between about 1.5 and 5 times its own level into one flat lemon, so the band's body stays near the light's level
  // and only a narrow core (near part 2) goes near white where the light is strong, up to the light's near-white level.
  // A white or grey light has no color to keep, so its band keeps a broad pale body under flat white with a thin
  // white core (whiteScale, WHITE_CORE).
  // A colored light's body is drawn from the curve's blurred light instead (far parts, on the 0.09 blur at full
  // light), which costs the same whatever its width: a near part this wide summed every piece of the curve within
  // almost a short side of each pixel. Most of the body is outside the curve (far part 1) and some of it spills
  // inside (far part 3), so the inside of the arc stays dark, as in the yellow-halo example.
  const band = { Side: 0, Offset: -0.05, Light: 1, Grow: 1, GrowBy: [-0.375, 0.5] }
  const white = nearWhiteLevel(hex) <= 1
  const pale = white ? whiteScale(hex) : 1
  const core = white ? whiteCore(hex) : round4(Math.min(9, Math.max(0, nearWhiteLevel(hex) - HALO_BODY)))
  const blurred = { Light: 1, LightGamma: 1, Grow: 1, GrowBy: [-0.375, 0.5], Width: 0.144 }
  // With a pale color (curveRoles), the core takes it; the recipe sets the body's share.
  const parts: Record<string, number | number[]> = {
    ...(white ? prefixed('n1', { ...band, Weight: round4(4 * pale), Width: 0.12, Shape: 8, LightGamma: 1 }) : { n1Weight: 0 }),
    ...prefixed('n2', { ...band, Weight: core, Width: white ? WHITE_CORE_WIDTH : 0.055, Shape: 8, LightGamma: 2.5, Pale: 1 }),
    n3Weight: 0,
    ...(white ? { f1Weight: 0 } : prefixed('f1', { ...blurred, Side: 2, Weight: 1, MaskSoft: 0.06 })),
    ...prefixed('f2', { ...outside, Weight: round4((white ? 0.8 * pale : 0.7) * dimShare(hex)), Width: 0.22, MaskSoft: 0.04 }),
    ...(white ? { f3Weight: 0 } : prefixed('f3', { ...blurred, Side: 0, Weight: 0.9 })),
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
 * `weight` (0..1 per outline point) lets a look keep the hot spot off some points without a jump.
 */
export function dragLight(
  drag: { from: readonly number[]; to: readonly number[] },
  runs: readonly (readonly Vec2[])[],
  aspect: number,
  weight?: (p: Vec2) => number,
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
    const w = Math.exp(-(d - nearest) / DRAG_SOFTNESS) * (weight ? weight(p) : 1)
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
 * Where two of a curve's colors meet, the stretch between has this times the lighter one's luminance, and this share
 * of it is white light (paleBridge), so it reads as the pale meeting of the two (contour-light-line passes through a
 * pale white between its blue and yellow), not as a third color.
 */
const BRIDGE_LIFT = 1.1
const BRIDGE_PALE = 0.6
const linearLuminance = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

/**
 * The light halfway between two colors along a curve: the sum of both, held to BRIDGE_LIFT times the lighter one's
 * luminance and BRIDGE_PALE of the way to grey. At their full sum Meta Blue and Lime met as a bright mint, a color
 * neither pack has.
 */
export function paleBridge(a: readonly number[], b: readonly number[]): number[] {
  const sum = a.map((v, c) => v + b[c])
  const scale = Math.min(1, (BRIDGE_LIFT * Math.max(linearLuminance(a), linearLuminance(b))) / Math.max(1e-9, linearLuminance(sum)))
  const bridge = sum.map((v) => v * scale)
  const grey = linearLuminance(bridge)
  return bridge.map((v) => v + (grey - v) * BRIDGE_PALE)
}

const lightnessLevels = new Map<string, number>()

/**
 * The level (times the light's own) at which the tone curve gives a light Oklab lightness `L`, at most `cap`, with a
 * share `pale` of the light moved to grey at the same luminance (a part's share in a white pale color, clPale).
 */
export function levelForLightness(hex: string, L: number, pale = 0, cap = 40): number {
  const key = `${hex}:${L}:${pale}:${cap}`
  const known = lightnessLevels.get(key)
  if (known !== undefined) return known
  const light = hexToLinear(hex)
  const grey = linearLuminance(light)
  const color = light.map((v) => v + (grey - v) * pale)
  const at = (level: number) => linearToOklab(toneCurve(color.map((v) => v * level)))[0]
  let lo = 0
  let hi = cap
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (at(mid) < L) lo = mid
    else hi = mid
  }
  lightnessLevels.set(key, hi)
  return hi
}

/**
 * A ring's rim all round is this Oklab lightness, whatever the light: contour-iridescent-rings' rims are 0.72 to 0.74
 * (170 to 190 of 255) wherever measured, nearly white, the bright edge of a band of the ring's color on its inside.
 * RING_LINE of the rim's light is a line RING_LINE_WIDTH wide, the rest that band. On the reference's large ring
 * (radius 0.65 short sides, the size of the recipe's smallest) the band holds its level to about 0.035 in, is half of
 * it at 0.06 and gone by 0.13: a near gaussian RING_BAND_WIDTH wide, RING_BAND_OFFSET inside the curve. Wider on a
 * larger ring, its inside glowed for a tenth of the frame. Outside, line and band stop within about RING_EDGE of the
 * curve. A light cool color (Cyan, Ice) has its rim at its own lightness up to RING_LIGHT_RIM_L: under its own
 * lightness a paler tint of it reads as that color only from L 0.78 up, and lower down as grey.
 */
const RING_RIM_L = 0.74
const RING_LIGHT_RIM_L = 0.84
const RING_LINE = 0.25
const RING_LINE_WIDTH = 0.003
const RING_BAND_WIDTH = 0.035
const RING_BAND_OFFSET = 0.015
const RING_EDGE = { MaskInset: -0.002, MaskSoft: 0.001 }
/**
 * Shares of the line, the band and the glows in white (the ring's pale color), so the rim reads pastel. A cool band
 * keeps RING_KEEP_CHROMA of its color's chroma on the rim (a Cyan band moved further to grey reads as Atmospheric's
 * Ice). A warm ring is pastel the way bright light is: its rim sits RING_WARM_WHITE of the way from its light's own
 * lightness to white, and its line and band move to white as far as keeps their hue within RING_WARM_HUE degrees of
 * the light's own at that lightness, up to RING_WARM_PALE (pale lime-cream for Lime, cream for Tan, apricot for
 * Orange-red, whose white share turns pink while its own light turns amber toward white). Its glows keep their color:
 * dim and moved to grey, a warm color reads olive, brown or mauve.
 */
const RING_PALE = { line: 0.6, band: 0.5 }
const RING_KEEP_CHROMA = 2 / 3
const RING_WARM_WHITE = 0.6
const RING_WARM_PALE = 0.4
const RING_WARM_HUE = 8
const ringPales = new Map<string, { line: number; band: number; glow: number }>()

function ringRimL(hex: string): number {
  const own = linearToOklab(hexToLinear(hex))[0]
  return warmTail(hex) ? own + (1 - own) * RING_WARM_WHITE : Math.min(RING_LIGHT_RIM_L, Math.max(RING_RIM_L, own))
}

/** Chroma and hue (degrees) of `hex` at Oklab lightness `L` through the tone curve, with a share `pale` moved to grey at the same luminance. */
function toneAt(hex: string, L: number, pale: number): [number, number] {
  const light = hexToLinear(hex)
  const grey = linearLuminance(light)
  const color = light.map((v) => v + (grey - v) * pale)
  const [, a, b] = linearToOklab(toneCurve(color.map((v) => v * levelForLightness(hex, L, pale))))
  return [Math.hypot(a, b), (Math.atan2(b, a) * 180) / Math.PI]
}

/** The largest share up to `most` that `keeps` (true at 0, false past some share). */
function largestShare(most: number, keeps: (share: number) => boolean): number {
  if (keeps(most)) return most
  let lo = 0
  let hi = most
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2
    if (keeps(mid)) lo = mid
    else hi = mid
  }
  return lo
}

function ringPale(hex: string): { line: number; band: number; glow: number } {
  const known = ringPales.get(hex)
  if (known) return known
  const L = ringRimL(hex)
  const [chroma, hue] = toneAt(hex, L, 0)
  let pale: { line: number; band: number; glow: number }
  if (warmTail(hex)) {
    const turn = (share: number) => Math.abs(((toneAt(hex, L, share)[1] - hue + 540) % 360) - 180)
    const share = round4(largestShare(RING_WARM_PALE, (s) => turn(s) <= RING_WARM_HUE))
    pale = { line: share, band: share, glow: 0 }
  } else {
    const band = round4(largestShare(RING_PALE.band, (s) => toneAt(hex, L, s)[0] >= RING_KEEP_CHROMA * chroma))
    pale = { line: RING_PALE.line, band, glow: band }
  }
  ringPales.set(hex, pale)
  return pale
}
/**
 * The band's Oklab lightness at the center of the hot spot (light field 2), the rest of the rim about four fifths of
 * it; a warm ring's is RING_WARM_HOT of the way from its rim's to white. The extra light goes pale the way the light's
 * own color does toward white, with no share in white: Meta Blue moved to grey turns violet, while its own light turns
 * toward cyan.
 */
const RING_HOT_L = 0.9
const RING_WARM_HOT = 0.5
/** Faint glows inside and outside, times the rim's level. Wider or brighter, two rings' insides fill their overlap like a sail. */
const RING_INSIDE = 0.04
const RING_OUTSIDE = 0.015

/** A ring's level on its rim, times its light's own (ringParts). */
export function ringLevel(hex: string): number {
  const pale = ringPale(hex)
  return levelForLightness(hex, ringRimL(hex), RING_LINE * pale.line + (1 - RING_LINE) * pale.band)
}

/**
 * A warm light's drift (warmDrift) on a ring of that light, which raises no channel: Lime's drift to Forest's ratios
 * multiplies blue by about 4, which turned the rim's white share deep blue.
 */
export function ringDrift(drift: { ratios: number[]; knee: number; sharpness: number }): { ratios: number[]; knee: number; sharpness: number } {
  return { ...drift, ratios: drift.ratios.map((r) => Math.min(1, r)) }
}

/**
 * A lit glass rim under a key prefix (the iridescent-rings reference): a thin pale line on the curve, the bright edge
 * of a band of the ring's color on its inside, crisp outside, at the same lightness all round (the recipe lights a ring
 * evenly). Where two rings cross, their bands add to a soft, pale lens. Where the light is strongest the band brightens
 * toward white: a second band (near part 3) on light field 2, which fades out around the hot spot, so the Light control
 * and a drag move a bright stretch along the ring. The other parts follow light field 1.
 */
export function ringParts(prefix: string, hex: string): Record<string, number | number[]> {
  const rim = ringLevel(hex)
  const pale = ringPale(hex)
  const hotL = warmTail(hex) ? ringRimL(hex) + (1 - ringRimL(hex)) * RING_WARM_HOT : RING_HOT_L
  const hot = Math.max(0, levelForLightness(hex, hotL) - (1 - RING_LINE) * rim)
  const line = { Width: RING_LINE_WIDTH, Shape: 8, Side: 1, ...RING_EDGE, Offset: 0, Grow: 0 }
  const band = { Width: RING_BAND_WIDTH, Shape: 8, Side: 1, ...RING_EDGE, Offset: RING_BAND_OFFSET, LightGamma: 1, Grow: 0 }
  const parts: Record<string, number | number[]> = {
    ...prefixed('n1', { ...line, Weight: round4(RING_LINE * rim), Light: 1, LightGamma: 1, Pale: pale.line }),
    ...prefixed('n2', { ...band, Weight: round4((1 - RING_LINE) * rim), Light: 1, Pale: pale.band }),
    ...prefixed('n3', { ...band, Weight: round4(hot), Light: 2, Pale: 0 }),
    ...prefixed('f1', { Weight: round4(RING_INSIDE * rim), Width: 0.05, Side: 1, Light: 1, LightGamma: 1, MaskSoft: 0.01, Pale: pale.glow }),
    ...prefixed('f2', { Weight: round4(RING_OUTSIDE * rim), Width: 0.04, Side: 2, Light: 1, LightGamma: 1, MaskSoft: 0.01, Pale: pale.glow }),
    f3Weight: 0,
  }
  return Object.fromEntries(Object.entries(parts).map(([key, value]) => [`${prefix}${key}`, value]))
}

/**
 * A broad pale arc under a key prefix (the yellow-halo reference, on dark): a wide band on the curve that goes pale
 * toward a near-white core, the light's own saturated color falling off inside it, and a short edge outside, so the
 * full color shows only in a band between the pale arc and the dark. All parts follow light field 1.
 */
export function arcParts(prefix: string, hex: string): Record<string, number | number[]> {
  // The band widens where the light dims, so its two edges spread apart along the curve instead of running parallel,
  // and its ends fade out broad instead of narrowing to a point. As in haloParts, the two bands stay near the light's
  // own level and only a narrow core between them (near part 3) goes near white where the light is strong, up to the
  // light's near-white level (the two bands add to about 1.7 there). A white or grey light keeps two pale bands and
  // glows under flat white with a thin white core (whiteScale, WHITE_CORE). A
  // colored light's two bands are drawn from the curve's blurred light as one body (far part 3, on the 0.09 blur),
  // as in haloParts. It doesn't widen where the light dims: a wider blur there lays a broad haze over the frame, and
  // the core and the inside glow already give the band's ends their fade.
  const white = nearWhiteLevel(hex) <= 1
  const pale = white ? whiteScale(hex) : 1
  const band = { Shape: white ? 8 : 6, Side: 0, Light: 1, LightGamma: 1, Grow: 1, GrowBy: [-0.4, 0.5], Width: white ? 0.1 : 0.11 }
  const core = white ? whiteCore(hex) : round4(Math.min(8, Math.max(0, nearWhiteLevel(hex) - 1.7)))
  const parts: Record<string, number | number[]> = {
    ...(white
      ? { ...prefixed('n1', { ...band, Weight: round4(1.5 * pale), Offset: 0 }), ...prefixed('n2', { ...band, Weight: round4(1.1 * pale), Offset: 0.04 }) }
      : { n1Weight: 0, n2Weight: 0 }),
    ...prefixed('n3', { ...band, Weight: core, Width: white ? WHITE_CORE_WIDTH : 0.04, Shape: 8, Offset: 0.02, LightGamma: 2.5, Pale: 1 }),
    ...prefixed('f1', { Weight: round4(0.55 * pale * dimShare(hex)), Width: 0.09, Side: 1, Light: 1, LightGamma: 1, MaskSoft: 0.015 }),
    ...prefixed('f2', { Weight: round4(0.12 * pale), Width: 0.03, Side: 2, Light: 1, LightGamma: 1, MaskSoft: 0.015 }),
    ...(white ? { f3Weight: 0 } : prefixed('f3', { Weight: 1.3, Width: 0.09, Side: 0, Light: 1, LightGamma: 1 })),
  }
  return Object.fromEntries(Object.entries(parts).map(([key, value]) => [`${prefix}${key}`, value]))
}

/**
 * The colors a thin ring's light runs through along its length, the light's own color first, as the hue of a thin
 * film turns with the angle around it (iridescent-rings reference): the run lineHues finds, except that a lighter
 * warm color doesn't end it, since each color of a ring sits at its own rim level (ringLevel) and none outshines the
 * light, while a darker warm color does: it would take the light's share of white (ringParts), and Orange-red with
 * Yellow's share reads salmon. Bold's Meta Blue turns into Cyan and Orange-red into Yellow, Atmospheric's Meta Blue
 * into Ice and Steel greys; Elemental's rings stay one color (Meta Blue and Lime add to a teal, and Lime's and Tan's
 * dim falls, toward Forest and toward copper, can't share a ring).
 */
export function ringHues(colors: readonly PackColor[], light: PackColor): PackColor[] {
  return hueRun(colors, light, 'ring').hues
}

/** The most two neighboring colors on a line may differ in Oklab hue (degrees), and the chroma below which a color is a grey (lineHues). */
const LINE_HUE_STEP = 60
const LINE_HUE_GREY = 0.05

/**
 * The colors a line of light runs through along its length, the light's own color first at its bright end
 * (contour-light-line: orange where it is brightest, through yellow and a pale white to blue at its far end): the
 * light colors in list order from the light, the way that has more of them. A line dims the way one warm
 * color in it does, and that fall must keep every color's largest channel (Yellow's takes all the blue out of a Meta
 * Blue stretch, Orange-red's keeps it), so a run with no such warm color stops short. A line's glow adds the light
 * of the stretches near it, so two neighbors must mix into a hue between their own: within LINE_HUE_STEP degrees,
 * or one of them a grey (Yellow and Cyan add to a green, Meta Blue and Lime to a teal, colors neither pack has).
 * A warm color lighter than the light ends the run: with the light's largest channel it outshines the light, and
 * bright warm light whitens toward lemon (the tone curve), so an Orange-red line's Yellow end was a lemon-green
 * glow brighter than its bright end; a Yellow line still turns to Orange-red.
 * Forest, Plum, Slate and Near-black are too dark to be a line's light; Tan's fall keeps no other color, so a Tan
 * line stays one color. Returns the colors and the warm color whose fall the line takes (null when none is warm).
 */
export function lineHues(colors: readonly PackColor[], light: PackColor): { hues: PackColor[]; dims: PackColor | null } {
  return hueRun(colors, light, 'line')
}

/** The run of colors from the light along a line (lineHues) or a ring (ringHues). */
function hueRun(colors: readonly PackColor[], light: PackColor, along: 'line' | 'ring'): { hues: PackColor[]; dims: PackColor | null } {
  const lit = colors.filter((c) => lightness(c.hex) >= 0.45)
  const lch = (c: PackColor) => {
    const [, a, b] = linearToOklab(hexToLinear(c.hex))
    return { chroma: Math.hypot(a, b), hue: (Math.atan2(b, a) * 180) / Math.PI }
  }
  const mixesBetween = (x: PackColor, y: PackColor) => {
    const [p, q] = [lch(x), lch(y)]
    const turn = Math.abs(((p.hue - q.hue + 540) % 360) - 180)
    return turn <= LINE_HUE_STEP || Math.min(p.chroma, q.chroma) < LINE_HUE_GREY
  }
  const keeps = (warm: PackColor, run: readonly PackColor[]) => {
    const ratios = warmDrift(warm.hex)?.ratios ?? [1, 1, 1]
    return run.every((c) => {
      const linear = hexToLinear(c.hex)
      return ratios[linear.indexOf(Math.max(...linear))] >= 1
    })
  }
  // Of the warm colors whose fall fits, the lightest: a light color that dims slowly reads olive (dark yellow).
  const fall = (run: readonly PackColor[]) => {
    const warm = run.filter((c) => warmTail(c.hex))
    if (warm.length === 0) return { fits: true, dims: null }
    const dims = warm.filter((c) => keeps(c, run)).sort((x, y) => lightness(y.hex) - lightness(x.hex))[0] ?? null
    return { fits: dims !== null, dims }
  }
  // A line ends at a lighter warm color, a ring at a darker one (lineHues, ringHues).
  const outshines = (c: PackColor) =>
    warmTail(c.hex) !== null && (along === 'line' ? lightness(c.hex) > lightness(light.hex) : lightness(c.hex) < lightness(light.hex))
  const at = lit.findIndex((c) => c.hex === light.hex)
  if (at < 0) return { hues: [light], dims: warmTail(light.hex) ? light : null }
  const longest = (ordered: readonly PackColor[]) => {
    const steps = ordered.findIndex((c, i) => i > 0 && (!mixesBetween(ordered[i - 1], c) || outshines(c)))
    const reach = steps < 0 ? ordered.length : steps
    for (let n = reach; n > 1; n--) {
      const run = ordered.slice(0, n)
      const { fits, dims } = fall(run)
      if (fits) return { hues: run, dims }
    }
    return { hues: [light], dims: warmTail(light.hex) ? light : null }
  }
  const forward = longest(lit.slice(at))
  const backward = longest(lit.slice(0, at + 1).reverse())
  return forward.hues.length > backward.hues.length ? forward : backward
}

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
