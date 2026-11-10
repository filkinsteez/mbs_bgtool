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
const SHADE_GROUND = 0.012

/** How much faster a warm color's light falls below its peak than another color's (an exponent factor). */
const WARM_FALL = 1.3

/** Exponent of a pale warm color with no darker neighbour of its hue (Tan): it falls off fast, keeping its own hue. */
const TAN_FALL = 2.2

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
  /** Per-channel exponents per color below its peak (12 numbers): how the color changes as it dims. */
  dim: number[]
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

/**
 * Per-channel exponents of a color's light below its peak (light ~ level^exponent per channel), so the color dims the
 * way light of that color does: toward its darker list neighbour when that one is close in hue or grey (Yellow to
 * Orange-red, Lime to Forest, Ice to Steel, Steel to Slate); a warm color without one toward deep red, like a flame; a
 * pale warm color without one (Tan) falls off fast; any other color keeps its own hue.
 */
const dimPartner = (c: Info, next: Info | undefined) => (next && next.L < c.L && (hueGap(c.h, next.h) < 70 || next.C < 0.04) ? next : undefined)

/** A muted warm color (Oklab chroma 0.03 to 0.12) with no darker neighbour of its hue (Tan): dim, it reads brown. */
const dimsBrown = (c: Info, next: Info | undefined) => c.h >= 20 && c.h < 105 && c.C > 0.03 && c.C <= 0.12 && !dimPartner(c, next)

function dimExponents(c: Info, next: Info | undefined): [number, number, number] {
  const partner = dimPartner(c, next)
  const target = partner ? partner.lin : isWarm(c) && c.C > 0.12 ? ([1, 0.02, 0] as Rgb) : null
  const faster = isWarm(c) ? WARM_FALL : 1
  if (!target) return isWarm(c) ? [TAN_FALL, TAN_FALL, TAN_FALL] : [1, 1, 1]
  const top = (v: readonly number[]) => Math.max(...v, 1e-6)
  const own = c.lin.map((v) => v / top(c.lin))
  const to = target.map((v) => v / top(target))
  return [0, 1, 2].map((i) => {
    const keep = ((to[i] + 0.02) / (own[i] + 0.02)) ** 0.25
    return round4(faster * clamp(1 + 2.5 * Math.log(1 / keep), 0.6, 2.5))
  }) as [number, number, number]
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
  const dim: number[] = []
  for (let k = 0; k < 4; k++) dim.push(...(lights[k] ? dimExponents(lights[k], all[all.indexOf(lights[k]) + 1]) : [1, 1, 1]))
  const brown = lights.map((c) => dimsBrown(c, all[all.indexOf(c) + 1]))
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
    dim,
    groundLevel: darks[0] ? DARK_GROUND : SHADE_GROUND,
  }
}

/** The color a streak at this place in the spectrum takes: the one whose cell holds it. */
export function colorAt(colors: RushColors, place: number): number {
  for (let k = 0; k < colors.count; k++) if (place < colors.cellEnd[k]) return k
  return colors.count - 1
}
