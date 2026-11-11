import { hueOrder, type ColorPack, type PackColor, type PackId } from './packs'

/** How much of the picture each pack color gets: one share per pack color, in pack order, summing to 1. 0 is off. */
export interface ColorMix {
  readonly shares: readonly number[]
}

/** One pack color that is on, with its share of the picture. */
export interface MixColor {
  readonly color: PackColor
  readonly share: number
}

export const META_BLUE_HEX = '#0064E0'
/** The most one color can have, so at least two colors are always on. */
export const MAX_SHARE = 0.9
/**
 * The share a color's slider moves in, per pack: one Nth of the picture in a pack of N colors (owner, 2026-11-11
 * 8:38 AM: "segmented. so in 25% increments", "or 20 if there are 5 colors").
 */
export const MIX_STEPS: Readonly<Record<PackId, number>> = { bold: 0.25, elemental: 0.2, atmospheric: 0.2 }
/** Meta Blue's share in a pack's default mix; the pack's other colors share the rest evenly. */
export const DEFAULT_META_BLUE_SHARE = 0.5
/** The fewest colors a mix has on. */
export const MIN_COLORS_ON = 2

const EPSILON = 1e-9
/** Shares closer than this to a step count as on it, so float error never skips or repeats a step. */
const ON_STEP = 1e-6

export function metaBlueIndex(pack: ColorPack): number {
  return pack.colors.findIndex((color) => color.hex.toUpperCase() === META_BLUE_HEX)
}

export function mixStep(pack: ColorPack): number {
  return MIX_STEPS[pack.id]
}

export function defaultMix(pack: ColorPack): ColorMix {
  const count = pack.colors.length
  const blue = metaBlueIndex(pack)
  if (blue < 0) return { shares: pack.colors.map(() => 1 / count) }
  const rest = (1 - DEFAULT_META_BLUE_SHARE) / (count - 1)
  return { shares: pack.colors.map((_, index) => (index === blue ? DEFAULT_META_BLUE_SHARE : rest)) }
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0)

function normalized(shares: readonly number[]): number[] {
  const total = sum(shares)
  return shares.map((share) => share / total)
}

/** The other colors' shares with color `index` at 0; the default mix's when all of them are off. */
function othersOf(pack: ColorPack, mix: ColorMix, index: number): number[] {
  const others = mix.shares.map((share, i) => (i === index ? 0 : share))
  return sum(others) > EPSILON ? others : defaultMix(pack).shares.map((share, i) => (i === index ? 0 : share))
}

/** The lowest share color `index` can have with the others keeping their ratios and none above MAX_SHARE. */
function lowestShare(pack: ColorPack, mix: ColorMix, index: number): number {
  const others = othersOf(pack, mix, index)
  return Math.max(0, 1 - MAX_SHARE / (Math.max(...others) / sum(others)))
}

/**
 * Sets one color's share. The other colors keep their ratios to each other and fill the rest; if all of them were
 * off, they come back in the default mix's ratios. The value is held between 0 and MAX_SHARE, and above the share
 * that would push another color over MAX_SHARE (the last two colors on never go below 10% each).
 */
export function setShare(pack: ColorPack, mix: ColorMix, index: number, value: number): ColorMix {
  if (index < 0 || index >= pack.colors.length) throw new Error(`No color ${index} in ${pack.id}`)
  const others = othersOf(pack, mix, index)
  const othersTotal = sum(others)
  const share = Math.min(MAX_SHARE, Math.max(lowestShare(pack, mix, index), Number.isFinite(value) ? value : 0))
  const shares = others.map((other, i) => (i === index ? share : (other / othersTotal) * (1 - share)))
  return { shares: normalized(shares) }
}

/**
 * The lowest and highest share color `index` can be set to on its pack's steps: up to one step short of the whole
 * picture, and down to 0 (off) unless that would leave fewer than two colors on or push another color over
 * MAX_SHARE, then to the first step above.
 */
export function stepRange(pack: ColorPack, mix: ColorMix, index: number): readonly [number, number] {
  const step = mixStep(pack)
  const highest = 1 - step
  const lowest = Math.max(0, Math.ceil(lowestShare(pack, mix, index) / step - ON_STEP)) * step
  return [Math.min(lowest, highest), highest]
}

/** Sets color `index` to the step nearest `value` within its range (stepRange); the others keep their ratios. */
export function setStep(pack: ColorPack, mix: ColorMix, index: number, value: number): ColorMix {
  const step = mixStep(pack)
  const [lowest, highest] = stepRange(pack, mix, index)
  return setShare(pack, mix, index, Math.min(highest, Math.max(lowest, Math.round(value / step) * step)))
}

/**
 * The step a key moves color `index` to, or null for other keys: an arrow or Page key moves one step from the step at
 * or past its share, Home and End go to the ends of its range (stepRange).
 */
export function stepForKey(pack: ColorPack, mix: ColorMix, index: number, key: string): number | null {
  const step = mixStep(pack)
  const share = mix.shares[index]
  const [lowest, highest] = stepRange(pack, mix, index)
  let next: number
  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp':
    case 'PageUp':
      next = (Math.floor(share / step + ON_STEP) + 1) * step
      break
    case 'ArrowLeft':
    case 'ArrowDown':
    case 'PageDown':
      next = (Math.ceil(share / step - ON_STEP) - 1) * step
      break
    case 'Home':
      next = lowest
      break
    case 'End':
      next = highest
      break
    default:
      return null
  }
  return Math.min(highest, Math.max(lowest, next))
}

export function isColorOn(mix: ColorMix, index: number): boolean {
  return mix.shares[index] > EPSILON
}

export function colorsOn(mix: ColorMix): number {
  return mix.shares.filter((share) => share > EPSILON).length
}

/** A color's switch can turn it off while more than MIN_COLORS_ON colors are on. */
export function canTurnOff(mix: ColorMix, index: number): boolean {
  return isColorOn(mix, index) && colorsOn(mix) > MIN_COLORS_ON
}

/**
 * A color's switch: off is the color at 0%, the others keeping their ratios; on brings it back at `restore` (the share
 * it had, or the default mix's). The mix stays as it is when the switch already matches, or when turning the color off
 * would leave fewer than MIN_COLORS_ON on.
 */
export function setColorOn(pack: ColorPack, mix: ColorMix, index: number, on: boolean, restore = defaultMix(pack).shares[index]): ColorMix {
  if (on === isColorOn(mix, index) || (!on && !canTurnOff(mix, index))) return mix
  return setShare(pack, mix, index, on ? restore : 0)
}

export function isMetaBlueOn(pack: ColorPack, mix: ColorMix): boolean {
  const blue = metaBlueIndex(pack)
  return blue >= 0 && isColorOn(mix, blue)
}

/** The Meta Blue switch: off is Meta Blue at 0%; on brings it back at `restore` (the share it had, or the default's). */
export function setMetaBlue(pack: ColorPack, mix: ColorMix, on: boolean, restore = DEFAULT_META_BLUE_SHARE): ColorMix {
  const blue = metaBlueIndex(pack)
  return blue < 0 ? mix : setColorOn(pack, mix, blue, on, restore)
}

/**
 * The mix a newly picked pack starts with: Meta Blue keeps its share (0% if it was off) and the new pack's other
 * colors share the rest evenly. Packs never mix, so no other color's share carries over.
 */
export function mixForPack(from: ColorPack, mix: ColorMix, to: ColorPack): ColorMix {
  const fromBlue = metaBlueIndex(from)
  const toBlue = metaBlueIndex(to)
  if (fromBlue < 0 || toBlue < 0) return defaultMix(to)
  const share = mix.shares[fromBlue]
  return Math.abs(share - DEFAULT_META_BLUE_SHARE) < EPSILON ? defaultMix(to) : setShare(to, defaultMix(to), toBlue, share)
}

/** The colors that are on, in pack order, with their shares (summing to 1). */
export function mixColors(pack: ColorPack, mix: ColorMix): MixColor[] {
  return pack.colors.map((color, index) => ({ color, share: mix.shares[index] })).filter((entry) => entry.share > EPSILON)
}

/**
 * Whole percents in pack order that sum to 100, by largest remainder, for labels and the URL; of equal remainders the
 * color first in hue order gets the extra percent, so the rows read the same way down whatever the pack order.
 */
export function mixPercents(pack: ColorPack, mix: ColorMix): number[] {
  const exact = mix.shares.map((share) => share * 100)
  const percents = exact.map(Math.floor)
  const rank = new Map(hueOrder(pack).map((index, place) => [index, place]))
  const order = exact
    .map((value, index) => ({ index, rest: value - Math.floor(value) }))
    .sort((a, b) => b.rest - a.rest || (rank.get(a.index) ?? a.index) - (rank.get(b.index) ?? b.index))
  const missing = 100 - sum(percents)
  for (let k = 0; k < missing; k++) percents[order[k % order.length].index]++
  return percents
}

/** A mix from shares in pack order, or null when they don't make a valid mix for the pack. */
export function mixFromShares(pack: ColorPack, shares: readonly number[]): ColorMix | null {
  if (shares.length !== pack.colors.length) return null
  if (shares.some((share) => !Number.isFinite(share) || share < 0)) return null
  const total = sum(shares)
  if (total <= 0) return null
  const result = normalized(shares)
  if (result.filter((share) => share > EPSILON).length < MIN_COLORS_ON) return null
  if (result.some((share) => share > MAX_SHARE + 0.005)) return null
  return { shares: result }
}

/** A pack color's key in a link's mix=: its name in lower case with hyphens for spaces ("meta-blue", "orange-red"). */
export function mixKey(color: PackColor): string {
  return color.name.toLowerCase().replace(/\s+/g, '-')
}

/**
 * Reads `mix=`: each color that is on as its key and whole percent ("meta-blue:25,cyan:75"), in any order; colors it
 * doesn't name are off. Missing, unreadable, or not a valid mix for the pack gives the pack's default mix.
 */
export function parseMix(pack: ColorPack, param: string | null | undefined): ColorMix {
  if (!param) return defaultMix(pack)
  const shares = pack.colors.map(() => 0)
  const named = new Set<number>()
  for (const part of param.split(',')) {
    const match = /^([a-z-]+):(\d{1,3})$/.exec(part.trim())
    const index = match ? pack.colors.findIndex((color) => mixKey(color) === match[1]) : -1
    if (!match || index < 0 || named.has(index)) return defaultMix(pack)
    named.add(index)
    shares[index] = Number(match[2])
  }
  return mixFromShares(pack, shares) ?? defaultMix(pack)
}

/**
 * The `mix=` value: each color that is on, in hue order, as its key and whole percent ("meta-blue:25,cyan:75"), so a
 * link keeps its colors whatever the pack order. Null for the pack's default mix, so default links carry no mix=.
 */
export function formatMix(pack: ColorPack, mix: ColorMix): string | null {
  const percents = mixPercents(pack, mix)
  const defaults = mixPercents(pack, defaultMix(pack))
  if (percents.every((percent, i) => percent === defaults[i])) return null
  return hueOrder(pack)
    .filter((index) => percents[index] > 0)
    .map((index) => `${mixKey(pack.colors[index])}:${percents[index]}`)
    .join(',')
}
