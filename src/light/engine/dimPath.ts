import { linearToOklch, oklchToLinear } from '../color/oklab'
import { hexToLinear, type Rgb } from '../color/srgb'

/**
 * Pack colors' dim paths: how a color's light turns as it dims, through darker colors of its own pack, so a dim color
 * never reads olive, brown or teal (coordinator, 2026-11-10 1:28 AM: each pack color's own dim path inside its pack).
 * One rule for every look.
 *
 * Each step is the lightest pack color darker than the last of a near hue (within DIM_NEAR_HUE degrees), with real
 * chroma and not a muted warm color, or from a near-neutral color the next darker near-neutral: Yellow into
 * Orange-red, Cyan into Meta Blue, Lime into Forest, Ice into Steel, Slate and Near-black. Between steps the color runs
 * along the straight line in Oklab lightness, chroma and hue, so Lime turns green as soon as it dims (hue 150 by
 * lightness 0.6, as palette-check.mjs's path has it) instead of keeping its own hue down to olive and then turning
 * teal. A saturated warm color with nothing darker to turn into ends like fire, in deep red and maroon (DIM_FIRE). A
 * muted warm color (Tan) reads brown when dim and has no darker color of its hue: it keeps its hue until just above the
 * pack's first dark color's lightness and turns into that color there, so its dark tail is that color, not grey-brown.
 * Past the last point the color keeps its hue and its chroma falls with its lightness, to black.
 */

/** A point of a dim path: Oklab lightness, chroma and hue in degrees. */
export type DimPoint = readonly [number, number, number]

/** Hue difference (degrees) within which a darker pack color is a step on a color's dim path. */
export const DIM_NEAR_HUE = 70
/** A darker color is a step only if it is at least this much darker (Oklab L). */
export const DIM_STEP_L = 0.04
/** Fire's dim end after a saturated warm color: deep red, then maroon (palette-check.mjs's Bold path). */
export const DIM_FIRE: readonly DimPoint[] = [
  [0.45, 0.17, 29],
  [0.28, 0.09, 18],
]
/** Oklab lightness under which a pack color is dark (Forest, Plum, Slate, Near-black), for a muted warm color's end. */
export const DIM_DARK_L = 0.45

const hueGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180)
const isGrey = (p: DimPoint) => p[1] < 0.05
const isMutedWarm = (p: DimPoint) => p[2] >= 20 && p[2] < 105 && p[1] > 0.03 && p[1] <= 0.12
const isSaturatedWarm = (p: DimPoint) => p[2] >= 20 && p[2] < 105 && p[1] > 0.12
const luminance = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

/** Each pack color's dim path (from the color itself down), in the order of `hexes`. */
export function dimPaths(hexes: readonly string[]): DimPoint[][] {
  const colors = hexes.map((hex) => linearToOklch(hexToLinear(hex)) as unknown as DimPoint)
  const ground = colors.find((c) => c[0] < DIM_DARK_L)
  return colors.map((c) => {
    const path: DimPoint[] = [c]
    let from = c
    for (;;) {
      const last = from
      const next = colors
        .filter((d) => d !== last && d[0] < last[0] - DIM_STEP_L && (isGrey(last) ? isGrey(d) : d[1] >= 0.04 && !isMutedWarm(d) && hueGap(last[2], d[2]) < DIM_NEAR_HUE))
        .sort((a, b) => b[0] - a[0])[0]
      if (!next) break
      path.push(next)
      from = next
    }
    if (isSaturatedWarm(from)) path.push(...DIM_FIRE.filter((p) => p[0] < from[0] - DIM_STEP_L))
    else if (path.length === 1 && isMutedWarm(c) && ground && ground[0] < c[0] - 2 * DIM_STEP_L) {
      const turn = ground[0] + DIM_STEP_L
      path.push([turn, (c[1] * turn) / c[0], c[2]], ground)
    }
    return path
  })
}

/** The path's point at Oklab lightness `L`: between two points lightness, chroma and hue change together. */
export function dimPathAt(path: readonly DimPoint[], L: number): DimPoint {
  if (L >= path[0][0]) return path[0]
  for (let k = 1; k < path.length; k++) {
    const [a, b] = [path[k - 1], path[k]]
    if (L >= b[0]) {
      const t = (a[0] - L) / Math.max(a[0] - b[0], 1e-6)
      const dh = ((b[2] - a[2] + 540) % 360) - 180
      return [L, a[1] + (b[1] - a[1]) * t, (a[2] + dh * t + 360) % 360]
    }
  }
  const end = path[path.length - 1]
  return [L, (end[1] * Math.max(L, 0)) / Math.max(end[0], 1e-6), end[2]]
}

/** The path's color, in linear RGB, at a level of the light against the color's own (luminance, 0 to 1). */
export function dimPathColor(path: readonly DimPoint[], level: number): Rgb {
  const top = luminance(oklchToLinear(path[0]))
  const want = Math.max(0, Math.min(1, level)) * top
  let lo = 0
  let hi = path[0][0]
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2
    if (luminance(oklchToLinear(dimPathAt(path, mid))) < want) lo = mid
    else hi = mid
  }
  return oklchToLinear(dimPathAt(path, (lo + hi) / 2)).map((v) => Math.max(v, 0)) as Rgb
}

/**
 * A path as steps for a look that turns a color's hue by its light's level in a few steps (as Rush's dim paths and
 * the veil's glow do): at each level of `levels` (highest first), the path's color at luminance 1. Mixed in linear
 * light between neighbouring levels, the steps follow the path to within about a tenth of its chroma.
 */
export function dimPathSteps(path: readonly DimPoint[], levels: readonly number[]): { hue: Rgb; at: number }[] {
  if (path.length < 2) return []
  return levels.map((at) => {
    const c = dimPathColor(path, at)
    const y = Math.max(luminance(c), 1e-9)
    return { hue: c.map((v) => v / y) as Rgb, at }
  })
}
