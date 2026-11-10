import type { ColorPack, PackColor } from './packs'

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
/** The panel's slider step. */
export const SHARE_STEP = 0.05
/** Meta Blue's share in a pack's default mix; the pack's other colors share the rest evenly. */
export const DEFAULT_META_BLUE_SHARE = 0.4

const EPSILON = 1e-9

export function metaBlueIndex(pack: ColorPack): number {
  return pack.colors.findIndex((color) => color.hex.toUpperCase() === META_BLUE_HEX)
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

/**
 * Sets one color's share. The other colors keep their ratios to each other and fill the rest; if all of them were
 * off, they come back in the default mix's ratios. The value is held between 0 and MAX_SHARE, and above the share
 * that would push another color over MAX_SHARE (the last two colors on never go below 10% each).
 */
export function setShare(pack: ColorPack, mix: ColorMix, index: number, value: number): ColorMix {
  const count = pack.colors.length
  if (index < 0 || index >= count) throw new Error(`No color ${index} in ${pack.id}`)
  const othersNow = mix.shares.map((share, i) => (i === index ? 0 : share))
  const fallback = defaultMix(pack).shares.map((share, i) => (i === index ? 0 : share))
  const others = sum(othersNow) > EPSILON ? othersNow : fallback
  const othersTotal = sum(others)
  const largestRatio = Math.max(...others) / othersTotal
  const lowest = Math.max(0, 1 - MAX_SHARE / largestRatio)
  const share = Math.min(MAX_SHARE, Math.max(lowest, Number.isFinite(value) ? value : 0))
  const shares = others.map((other, i) => (i === index ? share : (other / othersTotal) * (1 - share)))
  return { shares: normalized(shares) }
}

export function isMetaBlueOn(pack: ColorPack, mix: ColorMix): boolean {
  const blue = metaBlueIndex(pack)
  return blue >= 0 && mix.shares[blue] > EPSILON
}

/** The Meta Blue switch: off is Meta Blue at 0%; on brings it back at `restore` (the share it had, or the default's). */
export function setMetaBlue(pack: ColorPack, mix: ColorMix, on: boolean, restore = DEFAULT_META_BLUE_SHARE): ColorMix {
  const blue = metaBlueIndex(pack)
  if (blue < 0 || on === isMetaBlueOn(pack, mix)) return mix
  return setShare(pack, mix, blue, on ? restore : 0)
}

/** The colors that are on, in pack order, with their shares (summing to 1). */
export function mixColors(pack: ColorPack, mix: ColorMix): MixColor[] {
  return pack.colors.map((color, index) => ({ color, share: mix.shares[index] })).filter((entry) => entry.share > EPSILON)
}

/** Whole percents that sum to 100, by largest remainder, for labels and the URL. */
export function mixPercents(mix: ColorMix): number[] {
  const exact = mix.shares.map((share) => share * 100)
  const percents = exact.map(Math.floor)
  const order = exact.map((value, index) => ({ index, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest || a.index - b.index)
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
  if (result.filter((share) => share > EPSILON).length < 2) return null
  if (result.some((share) => share > MAX_SHARE + 0.005)) return null
  return { shares: result }
}

/** Reads `mix=` (whole percents in pack order, for example "40,20,20,20"). Missing or invalid gives the default. */
export function parseMix(pack: ColorPack, param: string | null | undefined): ColorMix {
  if (!param) return defaultMix(pack)
  const parts = param.split(',')
  if (parts.some((part) => !/^\d{1,3}$/.test(part.trim()))) return defaultMix(pack)
  return mixFromShares(pack, parts.map((part) => Number(part.trim()))) ?? defaultMix(pack)
}

/** The `mix=` value, or null for the pack's default mix so default links carry no `mix=`. */
export function formatMix(pack: ColorPack, mix: ColorMix): string | null {
  const value = mixPercents(mix).join(',')
  return value === mixPercents(defaultMix(pack)).join(',') ? null : value
}
