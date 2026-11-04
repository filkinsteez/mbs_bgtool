import { linearToOklch } from '../../color/oklab'
import type { ColorPack } from '../../color/packs'
import { hexToLinear } from '../../color/srgb'
import type { ControlValues } from '../../scene'
import { toneCurve } from '../../engine/output'
import { warmToe } from './curveCompose'

/** A seeded stream of numbers in [0, 1); the same seed and salt give the same stream. */
export function seededRandom(seed: number, salt: number): () => number {
  let state = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(salt | 0, 0x85ebca6b)) >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const clamp01 = (t: number) => Math.min(1, Math.max(0, t))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Seed 1-8 is slot 0-7 of block 0, seed 9-16 slot 0-7 of block 1, and so on. */
function blockSlot(seed: number): { block: number; slot: number } {
  return { block: Math.floor((seed - 1) / 8), slot: (((seed - 1) % 8) + 8) % 8 }
}

/** The numbers 0-7 in an order fixed by the stream. */
function shuffledEight(random: () => number): number[] {
  const order = [0, 1, 2, 3, 4, 5, 6, 7]
  for (let i = 7; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}

/**
 * Shares in (0, 1) for the parts of a layout, one per part. In each block of 8 seeds (1-8,
 * 9-16, ...) every eighth of a part's range goes to exactly one seed, in an order of its own
 * for each part. `random` places each share inside its eighth.
 */
export function seedShares(seed: number, salt: number, parts: number, random: () => number): number[] {
  const { block, slot } = blockSlot(seed)
  return Array.from({ length: parts }, (_, part) => (shuffledEight(seededRandom(block, salt + 101 * (part + 1)))[slot] + lerp(0.2, 0.8, random())) / 8)
}

/**
 * Four two-way choices as bits, in pairs of opposites. Every two of these eight words differ
 * in at least two bits, and the two words of a pair in all four.
 */
const LAYOUT_PAIRS: [number, number][] = [
  [0b0000, 0b1111],
  [0b0011, 0b1100],
  [0b0101, 0b1010],
  [0b0110, 0b1001],
]

/**
 * The seed's choice (0 or 1) for each of the four main parts of a layout. In each block of 8
 * seeds (1-8, 9-16, ...) every word of LAYOUT_PAIRS goes to exactly one seed, so any two of
 * those seeds differ in at least two parts. Seeds with the same light (pickContourLight)
 * differ most: the second gets the opposite of the first in all four parts, a third a word
 * of its own. The order is fixed per block, pack and look (salt).
 */
export function seedLayout(pack: ColorPack, seed: number, salt: number): number[] {
  const { block, slot } = blockSlot(seed)
  const random = seededRandom(block, salt)
  const pairs = shuffledEight(random)
    .filter((i) => i < LAYOUT_PAIRS.length)
    .map((i) => (random() < 0.5 ? LAYOUT_PAIRS[i] : ([LAYOUT_PAIRS[i][1], LAYOUT_PAIRS[i][0]] as [number, number])))
  const used = new Set<number>()
  const given = new Map<number, number[]>()
  let word = 0
  for (let s = 0; s <= slot; s++) {
    const light = contourLightIndex(pack, block * 8 + 1 + s)
    const before = given.get(light) ?? []
    const freePair = pairs.find(([a, b]) => !used.has(a) && !used.has(b))
    const opposite = before.length === 1 ? before[0] ^ 0b1111 : -1
    if (before.length === 0 && freePair) word = freePair[0]
    else if (opposite >= 0 && !used.has(opposite)) word = opposite
    else word = pairs.flat().find((w) => !used.has(w)) ?? 0
    used.add(word)
    given.set(light, [...before, word])
  }
  return [0, 1, 2, 3].map((bit) => (word >> bit) & 1)
}

/** Piecewise geometric through (0, lo), (0.5, mid), (1, hi); for gains and widths (all > 0). */
export function geo(t: number, lo: number, mid: number, hi: number): number {
  const u = clamp01(t)
  return u < 0.5 ? lo * (mid / lo) ** (u * 2) : mid * (hi / mid) ** ((u - 0.5) * 2)
}

/** Rounds to 4 decimals, the precision presets and the lab sliders keep. */
export const round4 = (v: number) => Math.round(v * 1e4) / 1e4

/** Half the frame's width and height in short-side units for an aspect (width / height). */
export function frameHalf(aspect: number): { halfW: number; halfH: number } {
  return { halfW: 0.5 * Math.max(aspect, 1), halfH: 0.5 * Math.max(1 / aspect, 1) }
}

/** A dragged line (`ControlValues.drag`) in short-side units from the frame's center, y down. */
export interface ShortLine {
  from: [number, number]
  to: [number, number]
  length: number
  /** Its direction on screen in radians, from +x toward +y, so -pi/2 points up. */
  angle: number
}

export function lineInShorts(drag: NonNullable<ControlValues['drag']>, aspect: number): ShortLine {
  const { halfW, halfH } = frameHalf(aspect)
  const at = (point: readonly [number, number]): [number, number] => [(point[0] - 0.5) * 2 * halfW, (point[1] - 0.5) * 2 * halfH]
  const from = at(drag.from)
  const to = at(drag.to)
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  return { from, to, length: Math.hypot(dx, dy), angle: Math.atan2(dy, dx) }
}

/** The angle in [-pi, pi]. */
export const wrapAngle = (a: number) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI))

/** Oklab chroma over lightness of a cool light's dim haze: a pale veil of its color. */
const VEIL_CHROMA = 0.15

/** Luminance of the faint haze in a cool light's darks, about Oklab L 0.1. */
const DARK_HAZE = 0.0012

/**
 * The `veil` param [color share, full color level, band width, dark haze] for a light. A cool
 * light's haze keeps only enough of its color for chroma VEIL_CHROMA times its lightness, with
 * its full color in a band about an octave either side of 0.35 of its clipping luminance, and
 * leaves a faint haze in black darks. Warm lights keep their warm tails (a pale veil of them
 * reads brown), and so does a light over a dark of another hue, such as Meta Blue over Plum,
 * where a pale veil would mix with the dark into mauve.
 */
export function veilParam(light: ContourLight): number[] {
  if (!veiled(light)) return [1, 1, 1, 0]
  const [l, c] = linearToOklch(hexToLinear(light.haze))
  return [round4(Math.min(1, (VEIL_CHROMA * l) / Math.max(c, 1e-4))), 0.35, 0.8, light.base === '#000000' ? DARK_HAZE : 0]
}

/** Whether a light's haze is a pale veil: a cool light over a dark that matches it. */
export function veiled(light: ContourLight): boolean {
  return !light.tail && darkMatches(light)
}

/**
 * Whether a light's dark is black, nearly grey or of about the light's own hue, so the light's
 * dim tail can spread over it without mixing into a third color (as Meta Blue over Plum does,
 * into indigo).
 */
export function darkMatches(light: ContourLight): boolean {
  if (light.base === '#000000') return true
  const [, , h] = linearToOklch(hexToLinear(light.haze))
  const [, baseC, baseH] = linearToOklch(hexToLinear(light.base))
  return baseC <= 0.02 || Math.abs(wrapAngle(((h - baseH) * Math.PI) / 180)) <= Math.PI / 3
}

/**
 * Turn param of a scene turned on screen by `turn` (radians, from +x toward +y) so that its
 * point `sceneAt` shows at `screenAt`: cos and sin of the turn, then the offset in
 * scene = turn^-1 (screen) + offset.
 */
export function turnParam(turn: number, screenAt: readonly [number, number], sceneAt: readonly [number, number]): number[] {
  const c = Math.cos(turn)
  const s = Math.sin(turn)
  return [c, s, sceneAt[0] - (screenAt[0] * c + screenAt[1] * s), sceneAt[1] - (-screenAt[0] * s + screenAt[1] * c)].map(round4)
}

export function luminanceOf(hex: string): number {
  const [r, g, b] = hexToLinear(hex)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Luminance of a color's light at the brightness where its brightest channel reaches 1. */
export function clipLuminanceOf(hex: string): number {
  return luminanceOf(hex) / Math.max(...hexToLinear(hex), 1e-6)
}

/**
 * Gain for one unit of scattered light: `luminance` over the haze's luminance for cool
 * lights; for warm ones `warmShare` of the haze's own clipping level (times the light's
 * lift), so warm light sits near nominal (dimmer, it reads brown and olive).
 */
export function hazeGainFor(light: ContourLight, luminance: number, warmShare: number): number {
  if (light.toe > 0) return (warmShare * light.lift) / Math.max(...hexToLinear(light.haze), 1e-6)
  return luminance / Math.max(luminanceOf(light.haze), 0.01)
}

/** A color (linear RGB) scaled so its brightest channel is 1. */
function unitPeak(rgb: readonly number[]): number[] {
  const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-6)
  return [rgb[0] / peak, rgb[1] / peak, rgb[2] / peak]
}

/** Uniform for the `tail` param [r, g, b, from]: the color at unit peak, and `from`. */
export function tailUniform(tail: readonly number[]): [number, number, number, number] {
  const [r, g, b] = unitPeak(tail)
  return [r, g, b, tail[3] ?? 0]
}

/** Uniform for the `tailEnd` param [r, g, b]: the color at unit peak. */
export function tailEndUniform(tail: readonly number[]): [number, number, number] {
  const [r, g, b] = unitPeak(tail)
  return [r, g, b]
}

/**
 * Dim haze params for a light (colors linear, at unit peak): `tail` [r, g, b, from] is the
 * color its haze has at half of `from` of its clipping level, and `tailEnd` the color at a
 * quarter and below. `from` is the light's tailFrom, or the look's `lookFrom` for lights
 * that leave it to the look; 0 (off) for lights that keep their hue.
 */
export function tailParams(light: ContourLight, lookFrom: number): { tail: number[]; tailEnd: number[] } {
  if (!light.tail) return { tail: [1, 1, 1, 0], tailEnd: [1, 1, 1] }
  return { tail: [...light.tail[0].map(round4), round4(light.tailFrom ?? lookFrom)], tailEnd: light.tail[1].map(round4) }
}

/**
 * The `fall` param [from, factor] for a light: haze dimmer than `from` of its clipping level
 * falls toward black `factor` times faster. Warm lights take the look's `from` and `factor`;
 * a light with its own fall (Tan) starts it at nominal. Cool lights keep their falloff.
 */
export function fallParam(light: ContourLight, from: number, factor: number): number[] {
  if (light.fall > 1) return [1, light.fall]
  return light.toe > 0 ? [from, factor] : [0, 1]
}

/**
 * The color a light (linear RGB) turns as it overexposes, at unit luminance: the camera
 * tone curve's own path to white three times past clipping, so Meta Blue goes toward a
 * pale cyan-white and never toward lavender.
 */
export function paleTarget(light: readonly number[]): [number, number, number] {
  const peak = Math.max(light[0], light[1], light[2], 1e-6)
  const c = toneCurve(light.map((v) => (3 * v) / peak))
  const lum = Math.max(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2], 1e-6)
  return [c[0] / lum, c[1] / lum, c[2] / lum]
}

/** One light for a Contour image: the direct light's color, the color the haze scatters, and the base. */
export interface ContourLight {
  light: string
  haze: string
  base: string
  /** Level of the base color (dim room light); 0 with black. */
  baseLevel: number
  /** Paper toe: warm lights 0.85 (as Rim and Halo), cool lights 0. */
  toe: number
  /**
   * The colors (linear, at unit peak) a warm light's dim haze passes through as it fades, at
   * half of tailFrom of its clipping level and at a quarter and below: Yellow like a flame,
   * to Orange-red and then deep red; Orange-red to deep red; Tan to a muted and then a burnt
   * orange; Lime halfway to Forest and then to Forest's deep green. Null for cool lights.
   */
  tail: [number[], number[]] | null
  /**
   * The share of its clipping level below which the haze leaves its own color: 1 (its
   * nominal) for Yellow, Orange-red and Tan; null for Lime, which takes the look's level.
   */
  tailFrom: number | null
  /** How much faster the light's dim haze falls toward black below nominal (1: as the look's). */
  fall: number
  /** Gain on the light's haze (1: as the look's). */
  lift: number
}

/** The red a warm haze ends on as it fades, deeper than Orange-red. */
const DEEP_RED = '#FF1A00'

/**
 * Tan's dim haze: amber, then a deeper orange, warmer and purer than dim Tan (which reads
 * grey-brown). The paper toe turns dim warm light redder, so these sit on the yellow side
 * of where they show.
 */
const TAN_DIM = '#FFB000'
const TAN_FAINT = '#FF9A00'

/** A hex's linear color scaled so its brightest channel is 1. */
function peakColor(hex: string): number[] {
  return unitPeak(hexToLinear(hex))
}

/** Halfway between two colors, at unit peak. */
function halfway(a: string, b: string): number[] {
  const pa = peakColor(a)
  const pb = peakColor(b)
  return unitPeak(pa.map((v, i) => (v + pb[i]) / 2))
}

const cool = { toe: 0, tail: null, tailFrom: null, fall: 1, lift: 1 }

function warm(hex: string, tail: [number[], number[]], tailFrom: number | null, fall = 1, lift = 1): Pick<ContourLight, 'toe' | 'tail' | 'tailFrom' | 'fall' | 'lift'> {
  return { toe: warmToe(hex), tail, tailFrom, fall, lift }
}

/**
 * Tan has no dark partner: its haze gets more light, so most of its lit area is at or above
 * Tan's own lightness, and below nominal it falls toward black faster (with a rounded
 * shoulder, see the looks' shaders), over a short distance.
 */
const TAN_FALL = 2.5
const TAN_LIFT = 1.3

function hexByName(pack: ColorPack, name: string): string {
  const color = pack.colors.find((c) => c.name === name)
  if (!color) throw new Error(`${pack.id} has no ${name}`)
  return color.hex
}

/**
 * The lights a pack offers, the first the one the look starts from. Each keeps
 * to one hue family, and its light and haze are the color that shows as the
 * area of light. Dark pack colors (Forest, Plum, Slate, Near-black) only appear
 * as bases, never as light. Warm lights stay on black: over a Meta Blue room,
 * Yellow haze turns grey-khaki and Orange-red pink, and Tan over Plum maroon.
 */
export function contourLights(pack: ColorPack): ContourLight[] {
  const blue = pack.colors[0].hex
  switch (pack.id) {
    case 'bold': {
      const cyan = hexByName(pack, 'Cyan')
      const yellow = hexByName(pack, 'Yellow')
      const orange = hexByName(pack, 'Orange-red')
      return [
        { light: cyan, haze: cyan, base: blue, baseLevel: 0.05, ...cool },
        { light: blue, haze: blue, base: '#000000', baseLevel: 0, ...cool },
        { light: yellow, haze: yellow, base: '#000000', baseLevel: 0, ...warm(yellow, [peakColor(orange), peakColor(DEEP_RED)], 1) },
        { light: orange, haze: orange, base: '#000000', baseLevel: 0, ...warm(orange, [peakColor(orange), peakColor(DEEP_RED)], 1) },
      ]
    }
    case 'elemental': {
      const lime = hexByName(pack, 'Lime')
      const tan = hexByName(pack, 'Tan')
      const forest = hexByName(pack, 'Forest')
      return [
        { light: blue, haze: blue, base: hexByName(pack, 'Plum'), baseLevel: 0.15, ...cool },
        { light: lime, haze: lime, base: forest, baseLevel: 0.12, ...warm(lime, [halfway(lime, forest), peakColor(forest)], null) },
        { light: tan, haze: tan, base: '#000000', baseLevel: 0, ...warm(tan, [peakColor(TAN_DIM), peakColor(TAN_FAINT)], 1, TAN_FALL, TAN_LIFT) },
      ]
    }
    case 'atmospheric':
      return [
        { light: hexByName(pack, 'Ice'), haze: hexByName(pack, 'Steel'), base: hexByName(pack, 'Near-black'), baseLevel: 0.2, ...cool },
        { light: hexByName(pack, 'Ice'), haze: blue, base: hexByName(pack, 'Near-black'), baseLevel: 0.18, ...cool },
        { light: blue, haze: blue, base: hexByName(pack, 'Slate'), baseLevel: 0.1, ...cool },
      ]
    default: {
      const unknown: never = pack.id
      throw new Error(`Unknown pack: ${String(unknown)}`)
    }
  }
}

/**
 * Index in contourLights(pack) of the seed's light. Seeds come in blocks as long as the
 * pack's list of lights, and each block uses every light once in an order of its own, so
 * seeds 1 to 8 show every light color as the main light.
 */
function contourLightIndex(pack: ColorPack, seed: number): number {
  const n = contourLights(pack).length
  const index = (((seed - 1) % n) + n) % n
  const order = Array.from({ length: n }, (_, i) => i)
  const shuffle = seededRandom(Math.floor((seed - 1) / n), 0x11c7)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(shuffle() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order[index]
}

/** Picks the light for a seed (contourLightIndex), taking one draw from the seed's stream. */
export function pickContourLight(pack: ColorPack, seed: number, random: () => number): ContourLight {
  random()
  return contourLights(pack)[contourLightIndex(pack, seed)]
}
