import { linearToOklab } from '../../color/oklab'
import { hexToLinear, type Rgb } from '../../color/srgb'

/** Lights are list colors at or above this Oklab lightness; darker ones are ground colors, never light sources. */
const LIGHT_L = 0.45

/** Meta Blue's share of the spectrum at the default mix (owner, 10:03 PM); the other light colors share the rest evenly. */
const META_BLUE = '#0064E0'
const META_BLUE_SHARE = 0.5

/** A white streak's colors each peak at this range of their own hex, chosen so together they add to near-neutral white. */
const FRINGE_RANGE: readonly [number, number] = [0.55, 1.15]

/** The ground: the list's first dark color (or a deep shade of the first light), barely lit. */
const DARK_GROUND = 0.08
const SHADE_GROUND = 0.003

/** Deep red, the last step of a fire's dim path (Yellow, Orange-red, deep red), and its luminance for placing the step. */
const DEEP_RED: Rgb = [1, 0.02, 0]
const DEEP_RED_Y = 0.04

/** Steps on a color's dim path, at most. */
export const DIM_STEPS = 3

/**
 * Fixed stand-in colors per role, by place in the spectrum: the layout's luminance comes from these, whatever the list,
 * so the light and dark layout is the same in every pack and mix. They are Bold's colors at the default mix.
 */
const STAND_INS = ['#0064E0', '#1FCDF0', '#FFD61E', '#FF4F00']
const STAND_IN_CELLS = [0, 0.5, 2 / 3, 5 / 6, 1]

export interface RushColors {
  /** Light colors in list order (at most 4), padded with #000000, then the ground color. */
  slots: string[]
  /** Number of light colors. */
  count: number
  /** Each light color's cell of the spectrum [0, 1]; unused cells sit at 2. */
  cellStart: number[]
  cellEnd: number[]
  /**
   * Each color's place across a white streak, 0 to 1: the colors in list order, evenly spread, except a pale warm color
   * with nothing to dim into (Tan), which turns brown as it dims and so sits only in the streak's white middle (0.5).
   */
  spectrum: number[]
  /** A white streak's level for each color (FRINGE_RANGE). */
  fringe: number[]
  /**
   * Each color's dim path, DIM_STEPS steps per color (48 numbers): a darker pack color's hue at luminance 1, then the
   * level of the light below which that hue takes over (0 for no step).
   */
  ramp: number[]
  groundLevel: number
}

interface Info {
  hex: string
  lin: Rgb
  L: number
  C: number
  h: number
  Y: number
}

const luminance = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const round4 = (v: number) => Math.round(v * 1e4) / 1e4
const hueGap = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180)

function infoOf(hex: string): Info {
  const lin = hexToLinear(hex)
  const [L, a, b] = linearToOklab(lin)
  return { hex, lin, L, C: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360, Y: luminance(lin) }
}

const isWarm = (c: Info) => c.C > 0.08 && c.h >= 20 && c.h < 105

const grey = (c: Info) => c.C < 0.05
/** A muted warm color (Tan): dim, it reads brown, so it is never a step on another color's dim path. */
const mutedWarm = (c: Info) => c.h >= 20 && c.h < 105 && c.C > 0.03 && c.C <= 0.12
const unitLuminance = (c: readonly number[]): Rgb => {
  const y = Math.max(luminance(c), 1e-6)
  return [c[0] / y, c[1] / y, c[2] / y]
}

/**
 * A color's dim path: how its light turns as it dims, through darker colors of the same pack, so it never goes muddy.
 * Each step is the lightest pack color darker than the last of a near hue (within 70 degrees, not grey and not muted
 * warm) or, from a grey, the next darker grey: Yellow into Orange-red, Cyan into Meta Blue, Lime into Forest, Ice into
 * Steel, Slate and Near-black. A saturated warm color with nowhere darker to go ends in deep red, as fire does. Meta
 * Blue and Tan have no steps and keep their own hue (Tan reads brown dim, so its bands fall off steeply instead). A
 * step takes over below the level where the light is as dark as that color, well before it (fifth root), so Lime
 * turns toward Forest before it reads olive.
 */
function dimPath(c: Info, all: readonly Info[]): { hue: Rgb; at: number }[] {
  const near = (from: Info, d: Info) => (grey(from) ? grey(d) : d.C >= 0.04 && !mutedWarm(d) && hueGap(from.h, d.h) < 70)
  const stepAt = (y: number) => clamp((y / Math.max(c.Y, 1e-6)) ** 0.2, 0.15, 0.88)
  const steps: { hue: Rgb; at: number }[] = []
  let from = c
  while (steps.length < DIM_STEPS) {
    const last = from
    const next = all.filter((d) => d !== last && d.L < last.L - 0.04 && near(last, d)).sort((a, b) => b.L - a.L)[0]
    if (!next) break
    steps.push({ hue: unitLuminance(next.lin), at: stepAt(next.Y) })
    from = next
  }
  if (steps.length < DIM_STEPS && isWarm(from) && from.C > 0.12) steps.push({ hue: unitLuminance(DEEP_RED), at: stepAt(DEEP_RED_Y) })
  return steps
}

/** Each color's level so that all of them together are as neutral a white as they can be. */
function whiteLevels(lights: readonly Info[]): number[] {
  const chromaOf = (f: number[]) => {
    const sum = [0, 1, 2].map((i) => lights.reduce((a, c, k) => a + f[k] * c.lin[i], 0))
    const Y = Math.max(luminance(sum), 1e-6)
    const [, x, y] = linearToOklab(sum.map((v) => v / Y))
    return x * x + y * y + 0.004 * f.reduce((a, v) => a + (v - 1) ** 2, 0)
  }
  let fringe = lights.map(() => 1)
  for (let it = 0; it < 300; it++) {
    const base = chromaOf(fringe)
    const grad = fringe.map((_, k) => {
      const moved = fringe.slice()
      moved[k] += 1e-3
      return (chromaOf(moved) - base) / 1e-3
    })
    fringe = fringe.map((v, k) => clamp(v - 0.5 * grad[k], FRINGE_RANGE[0], FRINGE_RANGE[1]))
  }
  return fringe
}

const standIns = STAND_INS.map(infoOf)

/** The layout's luminance at a place in the spectrum: the stand-in color's, whatever the list. */
export function standInLuminance(place: number): number {
  for (let k = 0; k < standIns.length; k++) if (place < STAND_IN_CELLS[k + 1]) return standIns[k].Y
  return standIns[standIns.length - 1].Y
}

/** The layout's luminance of a white streak: the stand-ins' white. */
export const STAND_IN_WHITE = whiteLevels(standIns).reduce((a, f, k) => a + f * standIns[k].Y, 0) / 2

/**
 * The one place Rush reads the color list (any 2-5 hexes, in order, with or without Meta Blue). It fills the roles the
 * layout leaves: which color each streak takes (by its place in the spectrum: the light colors in list order, Meta
 * Blue half of it at the default mix, the rest even), how each color's hue turns as it dims, a white streak's fringes,
 * and the ground. It never sets how bright anything is: that is the layout's. `shares`, one weight per list color, is
 * where a mix control's percentages would go.
 */
export function rushColors(hexes: readonly string[], shares?: readonly number[]): RushColors {
  const all = hexes.map(infoOf)
  let lights = all.filter((c) => c.L >= LIGHT_L)
  const darks = all.filter((c) => c.L < LIGHT_L)
  if (lights.length === 0) lights = [all.reduce((a, b) => (b.L > a.L ? b : a))]
  lights = lights.slice(0, 4)
  const count = lights.length
  const blue = lights.some((c) => c.hex.toUpperCase() === META_BLUE)
  const rest = Math.max(count - (blue ? 1 : 0), 1)
  const weight = (c: Info) =>
    shares ? (shares[hexes.indexOf(c.hex)] ?? 1) : !blue ? 1 : c.hex.toUpperCase() === META_BLUE ? (count > 1 ? META_BLUE_SHARE : 1) : (1 - META_BLUE_SHARE) / rest
  const total = lights.reduce((a, c) => a + weight(c), 0)
  const cellStart = [2, 2, 2, 2]
  const cellEnd = [2, 2, 2, 2]
  let at = 0
  lights.forEach((c, k) => {
    cellStart[k] = round4(at / total)
    at += weight(c)
    cellEnd[k] = round4(at / total)
  })
  const fringe = whiteLevels(lights)
  const paths = lights.map((c) => dimPath(c, all))
  const ramp: number[] = []
  for (let k = 0; k < 4; k++)
    for (let j = 0; j < DIM_STEPS; j++) {
      const step = paths[k]?.[j]
      ramp.push(...(step ? [...step.hue.map(round4), round4(step.at)] : [0, 0, 0, 0]))
    }
  // A muted warm color with no dim path (Tan) sits only in a white streak's middle.
  const brown = lights.map((c, k) => mutedWarm(c) && paths[k].length === 0)
  const edgeColors = brown.filter((b) => !b).length
  let edgeAt = 0
  const places = brown.map((b) => (b || edgeColors < 2 ? 0.5 : edgeAt++ / (edgeColors - 1)))
  const ground = darks[0]?.hex ?? lights[0].hex
  return {
    slots: [...[0, 1, 2, 3].map((k) => lights[k]?.hex ?? '#000000'), ground],
    count,
    cellStart,
    cellEnd,
    spectrum: [0, 1, 2, 3].map((k) => (k < count ? round4(places[k]) : 0)),
    fringe: [0, 1, 2, 3].map((k) => round4(fringe[k] ?? 0)),
    ramp,
    groundLevel: darks[0] ? DARK_GROUND : SHADE_GROUND,
  }
}

/** The color a streak at this place in the spectrum takes: the one whose cell holds it. */
export function colorAt(colors: RushColors, place: number): number {
  for (let k = 0; k < colors.count; k++) if (place < colors.cellEnd[k]) return k
  return colors.count - 1
}
