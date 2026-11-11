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

/** How many groups seedLayout spreads each block's seeds over (seedOrder). */
const LAYOUT_GROUPS = 3

/**
 * Which word of a block's four pairs of opposite words a seed's layout takes: the pair (0 to 3,
 * in the order the block takes them) and the word in it (0 or 1). In each block of 8 seeds
 * (1-8, 9-16, ...) every word goes to exactly one seed. The first seed of a group (seedOrder over
 * LAYOUT_GROUPS) takes a pair's first word and the second seed its other word, the opposite one; a
 * later seed takes the first word left.
 */
function layoutWord(seed: number): [number, number] {
  const { block, slot } = blockSlot(seed)
  const taken = [0, 0, 0, 0]
  const given = new Map<number, [number, number][]>()
  let word: [number, number] = [0, 0]
  for (let s = 0; s <= slot; s++) {
    const group = seedOrder(LAYOUT_GROUPS, block * 8 + 1 + s)
    const before = given.get(group) ?? []
    const free = taken.indexOf(0)
    if (before.length === 0 && free >= 0) word = [free, 0]
    else if (before.length === 1 && !(taken[before[0][0]] & (1 << (1 - before[0][1])))) word = [before[0][0], 1 - before[0][1]]
    else {
      const pair = taken.findIndex((t) => t !== 0b11)
      word = [pair, taken[pair] & 1 ? 1 : 0]
    }
    taken[word[0]] |= 1 << word[1]
    given.set(group, [...before, word])
  }
  return word
}

/**
 * The seed's choice (0 or 1) for each of the four main parts of a layout: its word of
 * LAYOUT_PAIRS (layoutWord), with the pairs in an order fixed per block and look (salt). Any two
 * seeds of a block differ in at least two parts, and the two seeds of a pair in all four. The
 * colors take no part, so a seed has the same layout whatever the pack.
 */
export function seedLayout(seed: number, salt: number): number[] {
  const random = seededRandom(blockSlot(seed).block, salt)
  const pairs = shuffledEight(random)
    .filter((i) => i < LAYOUT_PAIRS.length)
    .map((i) => (random() < 0.5 ? LAYOUT_PAIRS[i] : ([LAYOUT_PAIRS[i][1], LAYOUT_PAIRS[i][0]] as [number, number])))
  const [pair, side] = layoutWord(seed)
  const word = pairs[pair][side]
  return [0, 1, 2, 3].map((bit) => (word >> bit) & 1)
}

/**
 * The seed's place among n: seeds come in runs of n, and each run takes every one of 0 to
 * n - 1 once, in an order of its own.
 */
function seedOrder(n: number, seed: number): number {
  const index = (((seed - 1) % n) + n) % n
  const order = Array.from({ length: n }, (_, i) => i)
  const shuffle = seededRandom(Math.floor((seed - 1) / n), 0x11c7)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(shuffle() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order[index]
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

/**
 * GLSL for airGlowAt: the light of every point of a segment (screen, short-side units), each
 * falling off as c^2 / (r^2 + c^2) through thin haze, averaged over the segment.
 */
export const AIR_GLOW_GLSL = /* glsl */ `
float airGlow(vec2 p, vec4 seg, float c) {
  vec2 q = p - seg.xy;
  vec2 d = seg.zw - seg.xy;
  float len = length(d);
  if (len < 1e-4) return c * c / (dot(q, q) + c * c);
  float t = dot(q, d) / len;
  float k = sqrt(max(dot(q, q) - t * t, 0.0) + c * c);
  return c * c / (len * k) * (atan(t / k) - atan((t - len) / k));
}
`

/** airGlow (AIR_GLOW_GLSL) at p for the segment [x0, y0, x1, y1] and falloff c. */
export function airGlowAt(p: readonly [number, number], seg: readonly number[], c: number): number {
  const q = [p[0] - seg[0], p[1] - seg[1]]
  const d = [seg[2] - seg[0], seg[3] - seg[1]]
  const len = Math.hypot(d[0], d[1])
  const qq = q[0] * q[0] + q[1] * q[1]
  if (len < 1e-4) return (c * c) / (qq + c * c)
  const t = (q[0] * d[0] + q[1] * d[1]) / len
  const k = Math.sqrt(Math.max(qq - t * t, 0) + c * c)
  return ((c * c) / (len * k)) * (Math.atan(t / k) - Math.atan((t - len) / k))
}

/** Falloff (short-side units) of the glow a light outside the frame casts into it. */
const AIR_GLOW_CORE = 0.18

/**
 * Least luminance of a cool light's glow at its brightest point in the frame (about Oklab L
 * 0.55): bright enough that a veiled light shows its hue.
 */
const AIR_GLOW_LUMINANCE = 0.17

/** How far (short-side units) outside the frame the light is when its glow is all there. */
const AIR_GLOW_FROM = 0.15

/**
 * How much brighter than that least level the glow is at its brightest point in the frame: the
 * very edge turns paler toward white, and the glow shows over more of the frame at thumbnail
 * size while it keeps its shape near the edge.
 */
const AIR_GLOW_GAIN = 1.6

/**
 * The `airGlow` [level, falloff, sharpness, scale] and `glowLine` [x0, y0, x1, y1] params for a light
 * at a segment of the screen (a point if both ends are the same), for a dragged line. A light
 * outside the frame still lights the air near it, so the frame's nearest edge glows in its
 * color and fades into the frame. At its brightest point in the frame the glow is at least as
 * light as the haze's own hex (a warm glow dimmer than that reads dark gold or brown), at
 * least AIR_GLOW_LUMINANCE for a cool light, and for a warm one at least the level where its
 * haze starts to fall off faster (`fallFrom`, a share of its clipping level), so it shows its
 * own color before it fades; times `intensity`, the look's Intensity gain. The glow is squared
 * (sharpness 2), so it stays near the edge as haze keeps light near its source; its size and
 * fade are the same whatever the light's color, so the layout is too. It
 * comes in as the light leaves the frame, and is off (level 0) while any of the light is in the
 * frame. A look may give a seed its own falloff (`core`) and a faster fade (`sharper`, added
 * to the sharpness), so seeds differ under the same line, and may glow from only the part of the
 * light where its haze is lit (`seg`), while the whole light (`lightSeg`) decides whether it is
 * outside the frame. The glow is (scale * airGlow)^sharpness
 * times the level, where scale makes airGlow 1 at the frame's brightest point; the level is in
 * scattered-light units (one unit has the haze's luminance).
 */
export function airGlowParams(
  light: ContourLight,
  seg: readonly number[],
  aspect: number,
  intensity: number,
  fallFrom: number,
  core = AIR_GLOW_CORE,
  sharper = 0,
  lightSeg: readonly number[] = seg,
): { airGlow: number[]; glowLine: number[] } {
  const { halfW, halfH } = frameHalf(aspect)
  const outside = segmentOutside(lightSeg, halfW, halfH)
  const falloff = core
  const clip = clipLuminanceOf(light.haze)
  const target = AIR_GLOW_GAIN * Math.max(luminanceOf(light.haze), light.tail ? fallFrom * clip : AIR_GLOW_LUMINANCE)
  const sharpness = Math.min(3, 2 + sharper)
  const share = outside <= 0 ? 0 : smoothstep(0, AIR_GLOW_FROM, outside)
  let brightest = 0
  const n = 48
  for (let i = 0; i <= n; i++) {
    const x = -halfW + (2 * halfW * i) / n
    const y = -halfH + (2 * halfH * i) / n
    for (const p of [
      [x, -halfH],
      [x, halfH],
      [-halfW, y],
      [halfW, y],
    ] as [number, number][])
      brightest = Math.max(brightest, airGlowAt(p, seg, falloff))
  }
  const level = share > 0 && brightest > 0 ? (share * target * intensity) / Math.max(luminanceOf(light.haze), 1e-6) : 0
  return { airGlow: [round4(level), round4(falloff), sharpness, round4(1 / Math.max(brightest, 0.01))], glowLine: seg.map(round4) }
}

export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/**
 * A glow segment through `at`, spread `across` (short-side units) either way along `dir` (a unit
 * vector), shortened as needed so all of it stays at least half as far outside the frame as `at`.
 */
export function spreadOutside(at: readonly number[], dir: readonly number[], across: number, aspect: number): number[] {
  const { halfW, halfH } = frameHalf(aspect)
  const keep = 0.5 * segmentOutside([at[0], at[1], at[0], at[1]], halfW, halfH)
  const seg = (s: number) => [at[0] - dir[0] * across * s, at[1] - dir[1] * across * s, at[0] + dir[0] * across * s, at[1] + dir[1] * across * s]
  // The longest spread that keeps that distance: the segment only comes nearer the frame as it
  // grows, so halving finds it, and it changes smoothly as the light moves.
  let lo = 0
  let hi = 1
  if (segmentOutside(seg(1), halfW, halfH) >= keep) lo = 1
  else
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2
      if (segmentOutside(seg(mid), halfW, halfH) >= keep) lo = mid
      else hi = mid
    }
  return seg(lo).map(round4)
}

/** How far (short-side units) a segment is outside the frame's rectangle; 0 if it touches it. */
function segmentOutside(seg: readonly number[], halfW: number, halfH: number): number {
  let least = Infinity
  const steps = 64
  for (let i = 0; i <= steps; i++) {
    const x = seg[0] + ((seg[2] - seg[0]) * i) / steps
    const y = seg[1] + ((seg[3] - seg[1]) * i) / steps
    least = Math.min(least, Math.hypot(Math.max(0, Math.abs(x) - halfW), Math.max(0, Math.abs(y) - halfH)))
  }
  return least
}

/** Oklab chroma over lightness of a cool light's haze: a pale veil of its color. */
const VEIL_CHROMA = 0.12

/** Luminance of the faint haze in a cool light's darks, about Oklab L 0.1. */
const DARK_HAZE = 0.0012

/**
 * A cool light's least chroma along its haze's hue, over Oklab lightness, easing to 0.4 of it
 * in the white core: the moodboard's pool keeps chroma about 0.06 just around its core and
 * 0.02 to 0.035 in it, and a neutral white or grey beside blue haze reads warm, as an
 * orange-brown ring.
 */
export const VEIL_TINT = 0.07

/**
 * The `veil` param [chroma share, band level, band width, dark haze] for a light. A veiled
 * light's haze keeps only enough of its chroma for VEIL_CHROMA times its lightness (the
 * moodboard's beams and shafts), up to twice that in a band about 1.2 octaves either side of
 * its clipping luminance (where the moodboard's light is most colorful). A cool light leaves
 * a faint haze in black darks. Warm lights keep their warm tails (a pale veil of them reads
 * brown).
 */
export function veilParam(light: ContourLight, chroma = VEIL_CHROMA): number[] {
  if (light.tail) return [1, 1, 1, 0]
  const darkHaze = light.base === '#000000' ? DARK_HAZE : 0
  if (!veiled(light)) return [1, 1, 1, darkHaze]
  const [l, c] = linearToOklch(hexToLinear(light.haze))
  return [round4(Math.min(1, (chroma * l) / Math.max(c, 1e-4))), 1, 1.2, darkHaze]
}

/** Whether a light's haze is a pale veil of its color. */
export function veiled(light: ContourLight): boolean {
  return light.veil
}

/**
 * How far an unveiled cool light's bright light turns to its light color (Bold's Meta Blue to
 * Cyan): partway, so it reads as a paler, cyan-leaning Meta Blue instead of Bold's Cyan light
 * or a mint patch where Cyan meets the blue.
 */
export const UNVEILED_PALE = 0.6

/**
 * The `darkMeet` param for a light, given the gain on its dark base: over a dark of another
 * hue, the light's faint tail falls off below 0.3 to 1.2 of the dark's own level and the
 * dark is gone where the light passes 0.15 to 0.6 of it, so the two meet in near-black
 * instead of blending into a third color (Meta Blue over Plum into indigo), and the darks
 * keep the dark's own color. Levels are in the light's scattered units. Off ([0, 0, 0, 0])
 * over a dark that matches the light.
 */
export function darkMeetParam(light: ContourLight, baseGain: number): number[] {
  if (darkMatches(light)) return [0, 0, 0, 0]
  const level = (baseGain * light.baseLevel * luminanceOf(light.base)) / Math.max(luminanceOf(light.haze), 1e-4)
  return [0.3, 1.2, 0.15, 0.6].map((share) => round4(share * level))
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
 * tone curve's own path to white three times past clipping, so Meta Blue pales at its own
 * hue (the curve holds the hue of cool light) and warm lights go through yellow.
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
  /** Level of the base color (dim room light), so its luminance is BASE_LUMINANCE; 0 with black. */
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
  /**
   * Whether the light's haze is a pale veil of its color (veilParam): cool lights, except one
   * whose brightest part turns a color of its own (Meta Blue turning Cyan), which keeps its full
   * color, so it never reads as a steel-blue veil.
   */
  veil: boolean
  /**
   * Share a veiled light keeps of a look's band of extra chroma near its clipping level: 1, or
   * OVERCAST_BAND when its light, haze or base is a grey, so the veil goes to the greys.
   */
  band: number
}

/**
 * Share of the extra chroma near the clipping level that a veiled light keeps when its light,
 * haze or base is a grey (Atmospheric): Streaks' bright shafts then have about the radial-streaks
 * example's chroma (0.085 at Oklab L 0.6 to 0.8, 0.05 above), a grey-blue instead of a pale
 * cornflower.
 */
const OVERCAST_BAND = 0.5

/** The red a warm haze ends on as it fades, deeper than Orange-red. */
const DEEP_RED = '#FF1A00'

/** Orange-red, which Yellow's dim haze passes through, like a flame cooling. */
const ORANGE_RED = '#FF4F00'

/** Forest's deep green, which Lime's dim haze turns toward instead of olive. */
const FOREST = '#0F3D33'

/**
 * Tan's dim haze: a deep amber, then an orange, warmer and purer than dim Tan (which reads
 * grey-brown). The paper toe turns dim warm light a few degrees redder. Between half and all of
 * Tan's level the haze mixes Tan's own hue (Oklab 75 degrees) with the first, so that sits well
 * on the orange side (61 degrees) and the mix shows as warm light, not brown; the faint end
 * (65 degrees) stays on the yellow side, as it turns deep red-brown if it starts any redder.
 */
const TAN_DIM = '#FF9200'
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

/**
 * Tan has no dark partner: its haze gets more light, so most of its lit area is at or above
 * Tan's own lightness, and below nominal it falls toward black faster (with a rounded
 * shoulder, see the looks' shaders), over a short distance.
 */
const TAN_FALL = 2.5
const TAN_LIFT = 1.3

/** How the dim haze of each warm pack color fades (see ContourLight), by its hex. */
const WARM_HAZE: Readonly<Record<string, Pick<ContourLight, 'tail' | 'tailFrom' | 'fall' | 'lift'>>> = {
  '#FFD61E': { tail: [peakColor(ORANGE_RED), peakColor(DEEP_RED)], tailFrom: 1, fall: 1, lift: 1 },
  '#FF4F00': { tail: [peakColor(ORANGE_RED), peakColor(DEEP_RED)], tailFrom: 1, fall: 1, lift: 1 },
  '#D6F26C': { tail: [halfway('#D6F26C', FOREST), peakColor(FOREST)], tailFrom: null, fall: 1, lift: 1 },
  '#B8996E': { tail: [peakColor(TAN_DIM), peakColor(TAN_FAINT)], tailFrom: 1, fall: TAN_FALL, lift: TAN_LIFT },
}

/** Least Oklab lightness of a color that lights a frame; darker ones (Forest, Plum, Slate, Near-black) are only bases. */
const LIGHT_L = 0.5

/** Oklab chroma under which a color is a grey (Ice, Steel, Slate, Near-black). */
const GREY_C = 0.04

/** Oklab lightness over which a grey (Ice) is only a light's pale core: a haze that pale is a flat white area. */
const PALE_GREY_L = 0.9

/**
 * How much lighter (Oklab L) a cool light's pale partner is at least, and how far apart their
 * hues may be (degrees): Meta Blue's partner is Cyan (42 degrees) or Ice, Steel's is Ice.
 */
const PARTNER_LIGHTER = 0.1
const PARTNER_HUE = 60

/**
 * Luminance of a light's dark base (its level times the base color's own luminance): the same
 * whatever the dark's color, so the darks are as dark in every pack. About Oklab L 0.16, Near-black
 * at a fifth of its own level.
 */
const BASE_LUMINANCE = 0.0044

/** A color of the list with its Oklab lightness, chroma and hue (degrees), and whether it is warm (WARM_HAZE). */
interface ListColor {
  hex: string
  L: number
  C: number
  h: number
  warm: boolean
}

function listColor(hex: string): ListColor {
  const [L, C, h] = linearToOklch(hexToLinear(hex))
  return { hex, L, C, h, warm: hex.toUpperCase() in WARM_HAZE }
}

const isGrey = (c: ListColor) => c.C < GREY_C

/** Degrees between two colors' hues. */
const hueApart = (a: ListColor, b: ListColor) => Math.abs((wrapAngle(((a.h - b.h) * Math.PI) / 180) * 180) / Math.PI)

/**
 * The base under a light whose haze is `haze`: the darkest dark of the list that is nearly grey
 * or of about the haze's hue (darkMatches); for a cool light, else the darkest dark of another hue
 * (the two dim before they meet, darkMeetParam), else a deep shade of the darkest color of the
 * light's own family darker than its haze (Meta Blue under Cyan); else black. A warm light with no
 * such dark stands on black: over Meta Blue, Yellow haze turns grey-khaki and Orange-red pink, and
 * over Plum Tan turns maroon.
 */
function baseFor(haze: ListColor, list: readonly ListColor[]): ListColor | null {
  const darks = list.filter((c) => c !== haze && c.L < LIGHT_L).sort((a, b) => a.L - b.L)
  const matching = darks.find((d) => d.C <= 0.02 || hueApart(d, haze) <= 60)
  if (matching) return matching
  if (haze.warm) return null
  if (darks.length) return darks[0]
  const family = list.filter((c) => !c.warm && c.L < haze.L && (isGrey(c) || hueApart(c, haze) <= PARTNER_HUE))
  return family.sort((a, b) => a.L - b.L)[0] ?? null
}

/** The light whose brightest part turns `light`, whose haze is `haze`, over its base (baseFor). */
function lightFor(light: ListColor, haze: ListColor, list: readonly ListColor[]): ContourLight {
  const base = baseFor(haze, list)
  const colors = { light: light.hex, haze: haze.hex, base: base?.hex ?? '#000000', baseLevel: base ? round4(BASE_LUMINANCE / luminanceOf(base.hex)) : 0 }
  const warm = WARM_HAZE[haze.hex.toUpperCase()]
  if (warm) return { ...colors, ...warm, toe: warmToe(haze.hex), veil: false, band: 1 }
  const grey = [light, haze, base].some((c) => c !== null && isGrey(c))
  return { ...colors, toe: 0, tail: null, tailFrom: null, fall: 1, lift: 1, veil: light === haze || isGrey(light), band: grey ? OVERCAST_BAND : 1 }
}

/**
 * The lights a list of pack colors offers. Every color light enough (LIGHT_L) is once the haze,
 * the color that shows as the area of light, except a grey as pale as Ice, which is only a light's
 * pale core. A cool light's brightest part turns its partner, the palest cool color or grey at
 * least PARTNER_LIGHTER lighter and within PARTNER_HUE (Meta Blue turns Cyan or Ice), and a colored
 * light whose partner is a grey also lights once with its own color at its core; a warm light
 * pales along its own path. Cool lights come first, then warm ones, each lightest haze first, so
 * the order of the list doesn't matter. Works for any 2 to 5 pack colors, with or without Meta Blue.
 */
export function contourLightOptions(colors: readonly string[]): ContourLight[] {
  const list = colors.map(listColor)
  const leads = list.filter((c) => c.L >= LIGHT_L && !(isGrey(c) && c.L > PALE_GREY_L))
  if (!leads.length) leads.push(list.reduce((a, b) => (b.L > a.L ? b : a)))
  leads.sort((a, b) => Number(a.warm) - Number(b.warm) || b.L - a.L)
  const options: ContourLight[] = []
  for (const haze of leads) {
    const partners = haze.warm ? [] : list.filter((c) => !c.warm && c.L >= haze.L + PARTNER_LIGHTER && (isGrey(c) || hueApart(c, haze) <= PARTNER_HUE))
    const partner = partners.sort((a, b) => b.L - a.L)[0]
    if (partner) options.push(lightFor(partner, haze, list))
    if (!partner || (isGrey(partner) && !isGrey(haze))) options.push(lightFor(haze, haze, list))
  }
  return options
}

/**
 * Which of n lights a seed gets: every one in each block of 8 seeds, so seeds 1 to 8 show every
 * light color as the main light, and two seeds with one light laid out as differently as the
 * layout allows. With as many lights as layout groups, each group has its own (its first two
 * seeds have opposite layouts); with up to four, each pair of opposite layouts in the block shares
 * one (layoutWord); with more, every one once in each run of n seeds.
 */
function lightIndex(n: number, seed: number): number {
  if (n === LAYOUT_GROUPS || n > LAYOUT_PAIRS.length) return seedOrder(n, seed)
  const order = shuffledEight(seededRandom(blockSlot(seed).block, 0x11c8)).filter((i) => i < LAYOUT_PAIRS.length)
  return order[layoutWord(seed)[0]] % n
}

/**
 * Which colors of a list fill a Beam or Streaks frame's light, haze and base, and how each fades:
 * the seed picks one of the list's lights (contourLightOptions, lightIndex). Only the colors and
 * the seed go in, and nothing in the layout reads what comes out.
 */
export function contourColors(colors: readonly string[], seed: number): ContourLight {
  const options = contourLightOptions(colors)
  return options[lightIndex(options.length, seed)]
}

/** The seed's colors from a pack's colors (contourColors), taking one draw from the seed's stream. */
export function pickContourLight(pack: ColorPack, seed: number, random: () => number): ContourLight {
  random()
  return contourColors(pack.colors.map((c) => c.hex), seed)
}
