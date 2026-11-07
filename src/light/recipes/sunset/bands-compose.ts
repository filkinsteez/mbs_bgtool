import { linearToOklch } from '../../color/oklab'
import { PACKS, type ColorPack } from '../../color/packs'
import { hexToLinear, type Rgb } from '../../color/srgb'
import type { ControlValues, LensSettings, OutputSettings, ParamValue } from '../../scene'
import { closeHues, dimDrift, isLightColor, isWarm, needsBridge, paleLight } from './bands-light'
import { BAND_MAX, bandKey, BUMP_MAX, LIGHT_MAX, LIGHT_SHADE, lightKey, MODE_ADD, MODE_COVER, MODE_LIGHT, PATCH_MAX, patchKey } from './bands-params'
import { edgeAt, edgeSeed, type Bump, type EdgeShape } from './bands-shape'
import { placeHorizon } from './horizon'

export interface BandsComposeInput {
  /** null takes the first pack. */
  pack: ColorPack | null
  seed: number
  /** Frame width / height. */
  aspect: number
  /** The three tool controls, 0..1. */
  intensity?: number
  softness?: number
  horizon?: number
  /** The line the user dragged: the stack runs along it, from the light's band at `from` to the deep sky at `to`. */
  drag?: ControlValues['drag']
}

export interface BandsComposition {
  colors: string[]
  params: Record<string, ParamValue>
  lens: Partial<LensSettings>
  output: Partial<OutputSettings>
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

interface Random {
  next(): number
  between(a: number, b: number): number
  chance(p: number): boolean
  int(a: number, b: number): number
  sign(): number
}

/** mulberry32, started from a mixed hash of the seed so that nearby seeds don't draw alike. */
function random(seed: number): Random {
  let a = Math.imul(seed | 0, 0x9e3779b1) ^ 0x5bd1e995
  a = Math.imul(a ^ (a >>> 16), 0x7feb352d)
  a = Math.imul(a ^ (a >>> 15), 0x846ca68b)
  a = (a ^ (a >>> 16)) >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    between: (lo, hi) => lerp(lo, hi, next()),
    chance: (p) => next() < p,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    sign: () => (next() < 0.5 ? -1 : 1),
  }
}

const oklchOf = new Map<string, readonly number[]>()
const oklch = (hex: string) => {
  let lch = oklchOf.get(hex)
  if (!lch) oklchOf.set(hex, (lch = linearToOklch(hexToLinear(hex))))
  return lch
}
const lightness = (hex: string) => oklch(hex)[0]
const luminanceOf = (hex: string) => {
  const [r, g, b] = hexToLinear(hex)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const hue = (hex: string) => oklch(hex)[2]
/** The order of a run's choices, by pack, frame shape and run (see `stack`). */
const runOrders = new Map<string, number[]>()

/**
 * A view of a choice for the seed order, as the palette check compares seeds (scripts/light/palette-check.mjs,
 * thumbOf, layoutDistance and colorFamilies): the lightness of each row, and how much colored light each Oklab hue
 * family has (red to orange, yellow and tan, green, blue from Cyan to Meta Blue, purple), counting a row from
 * chroma 0.035 and fully from 0.07, as a share of the rows lit at L 0.1 and up.
 */
const HUE_FAMILIES: readonly [number, string][] = [[55, 'red'], [105, 'yellow'], [190, 'green'], [290, 'blue'], [345, 'purple'], [360, 'red']]
function viewOf(rows: readonly (readonly number[])[]): { L: number[]; colors: Map<string, number> } {
  const lch = rows.map((rgb) => linearToOklch(rgb))
  const colors = new Map<string, number>()
  const lit = lch.filter(([L]) => L >= 0.1)
  for (const [, C, h] of lit) {
    const name = HUE_FAMILIES.find(([end]) => h < end)?.[1] ?? 'red'
    colors.set(name, (colors.get(name) ?? 0) + clamp((C - 0.035) / 0.035, 0, 1) / lit.length)
  }
  return { L: lch.map(([L]) => L), colors }
}

/**
 * How far apart two views are against the palette check's thresholds (layout 0.2, colors 0.15): above 1, not alike.
 * `stretched`: by layout alone, each view's lightness stretched to 0-1 first.
 */
function viewApart(x: ReturnType<typeof viewOf>, y: ReturnType<typeof viewOf>, { stretched = false } = {}): number {
  if (stretched) {
    const stretch = (L: number[]) => {
      const [lo, hi] = [Math.min(...L), Math.max(...L)]
      return L.map((v) => (hi > lo ? (v - lo) / (hi - lo) : 0))
    }
    const [sx, sy] = [stretch(x.L), stretch(y.L)]
    const lit = sx.reduce((s, v) => s + v, 0) + sy.reduce((s, v) => s + v, 0)
    return sx.reduce((s, v, k) => s + Math.abs(v - sy[k]), 0) / Math.max(lit, 1e-6) / 0.2
  }
  const base = (L: number[]) => Math.min(...L, 0.35)
  const [bx, by] = [base(x.L), base(y.L)]
  let num = 0
  let den = 0
  x.L.forEach((v, k) => {
    num += Math.abs(v - bx - (y.L[k] - by))
    den += v - bx + (y.L[k] - by)
  })
  const layout = den > 0 ? num / den : 0
  const colors = 0.5 * [...new Set([...x.colors.keys(), ...y.colors.keys()])].reduce((s, k) => s + Math.abs((x.colors.get(k) ?? 0) - (y.colors.get(k) ?? 0)), 0)
  return Math.max(layout / 0.2, colors / 0.15)
}

/** A band of the scene, from its top edge down to below the frame. */
interface Band {
  color: string
  edge: EdgeShape
  mode: number
  /** Scene 10-90 width of the top edge, frame heights; 0 is a sharp outline. */
  fade: number
  fadeVary: number
  light: number
  lean: number
  /** Pale light across the top edge (0 none). */
  bridge: number
  /** Share of the image's light change inside the band. */
  vary: number
  /** Share of the band's light that gathers around the light's column (0: even across the frame). */
  sun: number
  /** How fast red, green and blue deepen as the band's light dims. */
  drift: [number, number, number]
  /** Thickness floor in lens radii, at every point. */
  floor: number
  /** A thin bright line in the middle of its place, between its top edge and the next band's. */
  line?: boolean
  /** The top edge is a long ramp, its width set in frame heights rather than by the lens. */
  ramp?: boolean
  /** Pale light of the band's own hue at its core, near the light's column (0 or none: no pale core). */
  pale?: number
  /** The core is more of the band's own light instead, which the tone curve pales. */
  paleOwn?: boolean
  /** Pale light of the band's own hue at its lower edge, rising across it: the haze near a light below. */
  veil?: number
  /** Its light falls off away from the light: amount at the far side, and the side (1 its bottom, -1 its top). */
  fall?: [number, number]
}

interface LightTerm {
  color: string
  shape: [number, number, number, number]
  look: [number, number, number, number]
}

interface Patch {
  color: string
  shape: [number, number, number, number]
  look: [number, number, number]
}

/**
 * Every band stays thick at every point: at least 2 lens radii, and 3.2 for a
 * band darker than both neighbours (a thin dark band through the lens is a
 * dirty seam). The sky above the first band counts too, at a lens radius and a
 * twentieth of the frame since it has one edge in the frame. Where a band is too
 * thin, the shapes of its two edges are scaled toward their base heights until
 * it holds. A null seed leaves the edges' broad wave out (its noise comes from
 * the scene's seed); then the broad bumps alone need fewer points across.
 */
function keepThick(bands: Band[], R: number, frameW: number, frameH: number, seed: number | null) {
  const points = seed === null ? 32 : 96
  const xs = Array.from({ length: points }, (_, k) => (k + 0.5) / points)
  const scales = bands.map(() => 1)
  const scaled = (e: EdgeShape, s: number): EdgeShape => ({ ...e, tilt: e.tilt * s, bumps: e.bumps.map(([bx, bw, sh]) => [bx, bw, sh * s] as Bump), wave: e.wave * s })
  for (let it = 0; it < 16; it++) {
    // Every edge's height at every x, at the current scales.
    const heights = bands.map((b, i) => {
      const e = scaled(seed === null ? { ...b.edge, wave: 0 } : b.edge, scales[i])
      return xs.map((x) => edgeAt(e, x, frameW, seed ?? 0))
    })
    let ok = true
    if (bands.length > 0 && Math.min(...heights[0]) < R / frameH + 0.05) {
      ok = false
      scales[0] *= 0.8
    }
    for (let i = 0; i < bands.length; i++) {
      const need = (bands[i].floor * R) / frameH
      const thinnest = Math.min(...xs.map((_, k) => (i + 1 < bands.length ? heights[i + 1][k] : 1 + need) - heights[i][k]))
      if (thinnest >= need) continue
      ok = false
      scales[i] *= 0.8
      if (i + 1 < bands.length) scales[i + 1] *= 0.8
    }
    if (ok) break
  }
  bands.forEach((b, i) => (b.edge = scaled(b.edge, scales[i])))
}

/**
 * A pack scene for sunset.bands: the pack's colors in order as bands of
 * light, seen through one out-of-focus lens whose radius is Softness. Every
 * seed is a stack of three to five bands; the seed changes which optional
 * colors stay, the band heights and every edge's shape. In some seeds the
 * shared horizon makes the stack's lowest boundary a ridge or bank of land.
 * Softness and Horizon only resize and move the seed's bands, and Intensity
 * only changes their light.
 * Light changes slowly inside every band, with the exact pack hex at the
 * nominal light.
 */
export function composeBands(input: BandsComposeInput): BandsComposition {
  const pack = input.pack ?? PACKS[0]
  const intensity = input.intensity ?? 0.5
  const softness = input.softness ?? 0.5
  // With a line set, the line alone places the stack: Horizon keeps the seed's own heights.
  const horizon = input.drag ? 0.5 : (input.horizon ?? 0.5)
  const aspect = clamp(input.aspect, 0.25, 4)
  const seed = Math.round(input.seed)
  const frameW = Math.max(aspect, 1)
  const frameH = Math.max(1 / aspect, 1)
  // Softness is the lens radius, short-side units.
  const R = lerp(0.045, 0.12, clamp(softness, 0, 1))
  // Intensity is the scene's light level: the light rises most, the other bands less.
  const level = 2 ** ((clamp(intensity, 0, 1) - 0.5) * 1.2)
  const along = input.drag ? dragAlong(input.drag, frameW, frameH) : undefined
  // How far the line's start, the light, lies outside the frame (short sides; inside, minus its distance to the
  // nearest edge).
  const from = input.drag?.from
  const over = from ? [Math.max(-from[0], from[0] - 1) * frameW, Math.max(-from[1], from[1] - 1) * frameH] : [-1, -1]
  const startOut = over[0] > 0 || over[1] > 0 ? Math.hypot(Math.max(0, over[0]), Math.max(0, over[1])) : Math.max(over[0], over[1])
  const scene = stack(pack, seed, R, level, clamp(horizon, 0, 1), aspect, frameW, frameH, along, startOut)
  return writeScene(scene, R, stackMap(scene, input.drag, frameW, frameH))
}

interface Scene {
  sky: string
  bands: Band[]
  lights: LightTerm[]
  patches: Patch[]
  sun: [number, number]
  lightVary: number
  /** Stops the sky's light falls per frame height above its middle. */
  skyFall: number
  /** Extra sky light at the light's column, as a share of the sky's own. */
  skyLift: number
  /** The whole scene's light, below 1 at the low end of Intensity. */
  dim: number
  /** The middle of the light's band, frame heights. */
  lightAt: number
  /** Where the middle of the light's band is before a long line draws the stack out, at this Softness and Horizon. */
  seedSpan: number
  /** The sky's pale veil toward the light: amount, where it starts and is full (frame heights), light gain. */
  skyVeil: [number, number, number, number]
  /** Where that veil gives way again to the sky's own color, above a dark band (frame heights). */
  skyVeilEnd: [number, number]
  /** How far the sky's own boundaries wander (frame heights, RMS) and their lattice (short sides). */
  skyDrift: [number, number, number, number]
  /** The light that veil adds, linear: the pack's own tint. */
  skyTint: number[]
  /** Under a long line: the dark pack color the farthest sky sinks toward, how far, and where (frame heights). */
  farSky?: { hex: string; amount: number; full: number; gone: number }
  /** Water in front of the frame: its line (frame heights, below the frame), the height it mirrors about, squeeze, smear, far reflection, ripple length. */
  foreWater: { line: number; axis: number; squeeze: number; smear: number; reflect: number; ripple: number }
}

/** A color of the stack: its hex and the share of nominal light it gets (a deep band is the same color under less light). */
interface Entry {
  hex: string
  under: number
  /** A thin bright line in the middle of its place instead of a band. */
  line?: boolean
}

/**
 * Three to five bands in pack order. Every frame shows its pack: Bold's Meta
 * Blue, Cyan and one warm color (Yellow or Orange-red), ending with a color
 * again under less light; Elemental's Meta Blue, one light (Lime or Tan) and
 * at least one dark band (Forest or Plum); Atmospheric's Meta Blue, Ice, Steel
 * and at least one of Slate and Near-black. Only a second dark color or the
 * color added again at the bottom may go, by the seed. The seed's horizon
 * makes the lowest boundary open (the last band runs off the frame) or a
 * ridge or bank of land.
 * The seed lays the scene out once, for the middle Softness and Horizon:
 * which colors show, land or open, every band's height and edge. Softness and
 * Horizon then only resize and move those bands: Horizon moves the lowest
 * boundary, a wider lens gives thin bands more room, and edges flatten as
 * their bands shrink.
 * Dark masses have outlines, sharp in the scene and softer in some stretches;
 * lighter colors fade into each other as light, and where two colors far apart
 * meet, pale light added across the transition keeps its middle pale.
 */
function stack(pack: ColorPack, seed: number, R: number, level: number, horizon: number, aspect: number, frameW: number, frameH: number, along?: number, startOut = 0): Scene {
  // The middle Softness's lens, which the seed's layout is made for.
  const R0 = lerp(0.045, 0.12, 0.5)
  const warmHex = (hex: string) => isWarm(hexToLinear(hex)) || isLightColor(hexToLinear(hex))
  const rnd = random(seed * 6151 + pack.id.length * 17 + 3)
  const place = placeHorizon(0.5, seed, aspect)
  const [sky, ...rest] = pack.colors.map((c) => c.hex)

  const lights = rest.filter((hex) => isLightColor(hexToLinear(hex)))
  const darks = rest.filter((hex) => lightness(hex) < 0.45)
  // The sky's pale side takes the pack's own tint: the pack's light color nearest the sky in hue that isn't warm or
  // near-white (pale Cyan in Bold; Steel in Atmospheric, a grey kept at more of its own light for an overcast
  // grey-blue), else the sky's own pale tint (a pale sky blue in Elemental). A tint far from the sky's hue makes a
  // third hue on the way (Meta Blue to Lime passes teal, to Tan mauve), and a white veil over Meta Blue reads
  // periwinkle, which made every pack look alike in a frame of sky.
  const hueGap = (a: string, b: string) => Math.abs(((hue(a) - hue(b) + 540) % 360) - 180)
  const tintHex = rest.find((hex) => !isWarm(hexToLinear(hex)) && lightness(hex) >= 0.45 && lightness(hex) <= 0.95 && hueGap(hex, sky) <= 60)
  // A colored tint is half its own light and half its pale light: all pale it is near-white and turns Meta Blue
  // violet; all its own it keeps the sky at full strength too far.
  const ownAndPale = (rgb: Rgb) => paleLight(rgb).map((v, j) => 0.5 * v + 0.5 * rgb[j])
  const skyTint = tintHex
    ? oklch(tintHex)[1] < 0.04
      ? hexToLinear(tintHex).map((v) => v * 1.6)
      : ownAndPale(hexToLinear(tintHex))
    : paleLight(hexToLinear(sky))
  // A sky that carries its tint's color (no band of it left) pales into the tint's own color, so that it reads as it.
  const carriedTint = tintHex ? hexToLinear(tintHex).map((v) => v * (oklch(tintHex)[1] < 0.04 ? 1.25 : 1)) : skyTint
  const tintOf = (carries?: boolean) => (carries ? carriedTint : skyTint)
  // A frame's colors: one light (if the pack has one) and the pack's other colors; two dark colors show one, the
  // other or both. A pack with no dark color (Bold) may end with a color again under less light: Meta Blue sunk to
  // a deep navy, or Orange-red itself, since Meta Blue right below Orange-red meets it through the lens as
  // magenta. Orange-red keeps most of its light: much dimmer it reads as brick.
  // A pack whose light is near-white (Atmospheric) may also put its darkest chosen color as a band above the sky
  // (a night top), Meta Blue again, under less light, as a band low in the frame (a low blue), or its near-white
  // light as a thin bright line instead of a band (an ice line). Its greys change places too: an overcast grey top
  // with Meta Blue as a band lower down (a grey top), or the grey between the sky and the light (steel first), so
  // its seeds differ in where Meta Blue sits and in the order of their greys.
  type Form = 'plain' | 'nightTop' | 'lowBlue' | 'iceLine' | 'greyTop' | 'steelFirst'
  const build = (chosenLight: string | undefined, chosenDarks: readonly string[], base: boolean, form: Form = 'plain'): Entry[] => {
    const picked = rest.filter((hex) => (lights.includes(hex) ? hex === chosenLight : darks.includes(hex) ? chosenDarks.includes(hex) : true))
    const list: Entry[] = [{ hex: sky, under: 1 }, ...picked.map((hex) => ({ hex, under: 1 }))]
    if (base && chosenLight) list.push(hue(chosenLight) < 60 ? { hex: chosenLight, under: 0.68 } : { hex: sky, under: 0.22 })
    if (form === 'nightTop' && chosenDarks.length) {
      const darkest = chosenDarks.reduce((a, b) => (lightness(b) < lightness(a) ? b : a))
      const at = list.findIndex((e) => e.hex === darkest)
      if (at > 0) list.unshift(...list.splice(at, 1))
    }
    if (form === 'lowBlue') {
      const at = list.findIndex((e, i) => i > 0 && lightness(e.hex) < 0.45)
      list.splice(at > 0 ? at : list.length, 0, { hex: sky, under: 0.7 })
    }
    const greyAt = list.findIndex((e, i) => i > 0 && e.hex === tintHex)
    if (form === 'greyTop' && greyAt > 0) list.unshift(...list.splice(greyAt, 1))
    if (form === 'steelFirst' && greyAt > 1) list.splice(1, 0, ...list.splice(greyAt, 1))
    if (form === 'iceLine') {
      // The line lies over the band below it: over Meta Blue it would read lavender through the lens.
      const at = list.findIndex((e, i) => i > 0 && i < list.length - 1 && lightness(e.hex) > 0.95)
      if (at > 0 && lightness(list[at + 1].hex) >= 0.45) {
        const [near] = list.splice(at, 1)
        list.splice(at + 1, 0, { ...near, line: true })
      }
    }
    return list
  }
  const shown = (e: Entry) => lightness(e.hex) * Math.cbrt(e.under)
  const dark = (e: Entry) => shown(e) < 0.45
  // Each band's least height in frame heights for a lens of radius r: 2 lens radii, 3.2 for a band darker than
  // both neighbours, and at least an eighth of the frame, so that in a tall frame its color still shows after the
  // lens. The sky and the last band have one edge in the frame, so they may be thinner: the lens's blur of that
  // edge and a twentieth of the frame more, so that their own color still covers that much.
  const leastOf = (list: readonly Entry[], r: number) =>
    list.map((e, i) => {
      if (i === 0 || i === list.length - 1) return Math.max(r / frameH + 0.05, 0.1)
      const darker = shown(e) < Math.min(shown(list[i - 1]), shown(list[i + 1])) - 0.1
      return Math.max(((darker ? 3.2 : 2) * r) / frameH, 0.125)
    })
  // A band's light at the middle Intensity: a deep band is a color under less light, and a cool band next to one
  // of similar lightness gets less light, so neighbours contrast.
  const baseLight = (list: readonly Entry[], i: number) => {
    const e = list[i]
    if (e.under < 1) return e.under
    const similar = [list[i - 1], list[i + 1]].some((o) => o && Math.abs(lightness(o.hex) - lightness(e.hex)) < 0.1)
    return similar && !isWarm(hexToLinear(e.hex)) ? 0.75 : 1
  }
  // Shares of the spare height: the wide bands take most of it. A field takes nearly all of it; the two bands of a
  // ramp share it, so both have a floor of their own color beside the ramp. The sky is an area of its own beside
  // them, never only a strip along the top, and a thin line takes no more than its least height. Ice stays
  // smaller, never a wide white band, and so does a color repeated under less light at the bottom, so it doesn't
  // read as a second, muddier color.
  const shareOf = (e: Entry, i: number, wide: readonly number[], draw: (lo: number, hi: number) => number, structure: Structure = 'stack') => {
    if (e.line) return draw(0, 0.05)
    // The sky is anything from a sliver to a wide area; as one of the seed's wide parts, most of the frame.
    if (i === 0 && !wide.includes(0)) return structure === 'field' ? draw(0.6, 3.5) : structure === 'ramp' ? draw(0.4, 2.5) : draw(0.4, 3.5)
    const white = lightness(e.hex) > 0.95 ? 0.5 : 1
    if (structure === 'field') return (wide.includes(i) ? draw(6, 9) : draw(0.1, 0.3)) * white
    if (structure === 'ramp') return (wide.includes(i) ? draw(2.5, 3.5) : draw(0.05, 0.2)) * white
    return (wide.includes(i) ? (wide.length > 1 ? draw(2.5, 3.5) : draw(3.5, 5)) : draw(0.15, 0.6) * (e.under < 1 ? 0.6 : 1)) * white
  }

  // The seed's choices: the colors, one or two wide bands (near-white Ice only half as wide), and whether the sky
  // darkens toward the top. Every combination is listed, the second light (Orange-red, Tan) in about a third of
  // them.
  // The structure the wide bands make: one wide band is a dominant field with thin accents (Ice, never a wide
  // white band, stays a plain stack); two light bands next to each other, in a stack of at most four, are two tall
  // floors of color meeting in one long ramp; other pairs are a stack of bands.
  type Structure = 'field' | 'ramp' | 'stack'
  type Choice = { light: string | undefined; darks: readonly string[]; base: boolean; wide: readonly number[]; zenith: number; form: Form; structure: Structure }
  const choices: Choice[] = []
  const forms: Form[] = lights.length ? ['plain'] : ['plain', 'nightTop', 'lowBlue', 'iceLine', 'greyTop', 'steelFirst']
  for (const [li, l] of (lights.length ? lights : [undefined]).entries()) {
    for (const d of darks.length > 1 ? [[darks[0]], [darks[1]], darks] : [darks]) {
      for (const base of darks.length ? [false] : [true, false]) {
        for (const form of forms) {
          // A low blue only with one dark color: with two, the stack is too crowded for the lens.
          if (form === 'lowBlue' && d.length > 1) continue
          const list = build(l, d, base, form)
          const can = list.map((e, i) => (e.line ? -1 : i)).filter((i) => i >= 0)
          const wides = [...can.map((i) => [i]), ...can.flatMap((i, k) => can.slice(k + 1).map((j) => [i, j]))]
          const structureOf = (wide: number[]): Structure =>
            wide.length === 1
              ? lightness(list[wide[0]].hex) > 0.95
                ? 'stack'
                : 'field'
              : wide[1] === wide[0] + 1 && !dark(list[wide[0]]) && !dark(list[wide[1]]) && list.length <= 4
                ? 'ramp'
                : 'stack'
          wides.forEach((wide, k) => {
            if (li > 0 && k % 2 === 1) return
            for (const zenith of [0, 1.1]) choices.push({ light: l, darks: d, base, wide, zenith, form, structure: structureOf(wide) })
          })
        }
      }
    }
  }
  // The light's pale core and the haze near the light, at the middle Intensity; the seed order's look sees them too.
  // The light's band (not near-white Ice, pale already) has a core that pales toward white in its own hue, bringing
  // a color's light to about the same pale level whatever its own lightness. Orange-red paled in its own hue reads
  // salmon, so its core is more of its own light instead, which the tone curve takes through orange toward amber.
  // The sky keeps its full color only near its far edge and pales in its own hue toward the light, also behind a
  // dark band in front of the light; there it has its own color again over the lens's reach above the dark band, so
  // the lens mixes only the two pack colors (a pale sky over Forest read grey-teal). A light band between the sky
  // and the light pales toward its lower edge, unless a dark band lies below it. A sky or a band that is short in
  // the frame keeps its full color, so every color still shows its own hex; a dark sky (a night top) stays as it
  // is. Heights count as the frame shows them (`zoom`: a long dragged line draws the stack out, and a short sky can
  // fill the frame). How far a seed's sky and middles pale is its own (`paling`), so seeds differ in it. `lens` is
  // the lens radius (short sides); the seed order's look uses the middle Softness's, so no slider changes the order.
  const hazeOf = (
    list: readonly Entry[],
    bands: readonly Band[],
    lightBand: number,
    paling: { sky: number; middles: number; carries?: boolean; full?: number; fullAt?: number },
    zoom = 1,
    blueTo = 0,
    lens = R0,
  ) => {
    const height = (k: number) => (bands[k + 1]?.edge.base ?? 1) - bands[k].edge.base
    const room = (h: number) => smoothstep(0.15, 0.35, h * zoom)
    const lightColor = bands[lightBand].color
    const paleOwn = hue(lightColor) < 50
    // A dark color left as the brightest (Slate where Ice and Steel went) is no light: paled, it reads as Steel.
    const pale =
      lightness(lightColor) > 0.95 || lightness(lightColor) < 0.45 ? 0 : paleOwn ? 1.2 * luminanceOf(lightColor) : clamp(1.25 - luminanceOf(lightColor), 0.3, 0.9)
    // The sky shows down to the first band that isn't a thin line: a line there is drawn on the sky.
    const firstArea = bands.findIndex((b) => !b.line)
    const skyHeight = firstArea >= 0 ? bands[firstArea].edge.base : 1
    const underSky = firstArea >= 0 ? list[firstArea + 1] : undefined
    // The sky's own light gives way to the tint as it pales, most where it pales most. A sky that carries its tint's
    // color (no band of it left) pales fully into the tint, however short it is. A tall sky pales most of the way at
    // least, so full-strength Meta Blue stays near a quarter of the frame.
    const skyRoom = paling.carries ? 1 : room(skyHeight)
    const skyPale = paling.carries ? Math.max(paling.sky, 0.9) : Math.max(paling.sky, 0.8 * smoothstep(0.25, 0.5, skyHeight * zoom))
    // A sky that carries its tint keeps its own color over its top fifth, so Meta Blue still shows, and is full tint
    // 40% of the way down from there, or 0.35 of the frame, whichever comes first, so the tint covers enough of the
    // frame to read as its color clear of the lens's blur of the light below, and full-strength Meta Blue stays
    // near a quarter of the frame.
    const skyFrom = paling.carries ? Math.max(blueTo, 0.2 * skyHeight) : blueTo
    const skyFull = paling.carries ? Math.min(lerp(skyFrom, skyHeight, 0.4), skyFrom + 0.35 / zoom) : skyHeight
    // Under a long line (`full` 1) all of the sky's own light gives way, and the sky is all tint from `fullAt` of the
    // way down from its full color, so the side near the light is the tint's own color.
    const full = paling.full ?? 0
    const reach = lens / (frameH * zoom)
    // Above a dark band under the sky, or a dark line right under it, the veil gives way again to the sky's own
    // color: a pale sky meets a dark one through the lens as grey (grey-teal over Forest).
    const darkLine = bands[0]?.line && dark(list[1]) ? 0.5 * (bands[0].edge.base + (bands[1]?.edge.base ?? 1)) : undefined
    const giveWayAt = darkLine ?? (underSky && dark(underSky) ? skyHeight : undefined)
    const skyEnd: [number, number] = giveWayAt !== undefined ? [giveWayAt - 2 * reach, giveWayAt - reach] : [9, 10]
    // A sky too short to pale before it gives way again above a dark band keeps more of its own color: paled only
    // near its top, it would read upside down. A sky that carries its tint's color pales all the same.
    const tall = paling.carries ? 1 : smoothstep(0.5, 0.7, skyEnd[0] / Math.max(skyHeight, 1e-6))
    const sky: [number, number, number, number] = dark(list[0])
      ? [0, 0, 1, 0]
      : [
          skyPale * skyRoom * tall,
          skyFrom,
          lerp(skyFull, lerp(skyFrom, skyFull, paling.fullAt ?? 0.6), full),
          -lerp(paling.carries ? 1 : 0.9 * Math.min(1, skyPale / 0.7), 1, full) * skyRoom * tall,
        ]
    const veils = bands.map((b, k) =>
      k < lightBand && b.mode === MODE_LIGHT && !dark(list[k + 1]) && bands[k + 1]?.mode !== MODE_COVER ? paling.middles * room(height(k)) : 0,
    )
    return { pale, paleOwn, sky, skyEnd, veils }
  }
  // A boundary between a band and the one above: an outline where a dark color meets another (a warm color
  // through the lens into a dark one goes olive, khaki or brown, so that edge stays sharp and only the lens
  // softens it), or light fading into light, with pale light across it where two colors far apart meet.
  const edgeKind = (list: readonly Entry[], i: number) => {
    const [e, upper] = [list[i], list[i - 1]]
    const outline = dark(e) || dark(upper)
    const warmOnDark = outline && (warmHex(upper.hex) || warmHex(e.hex))
    const bridge = !outline && needsBridge(hexToLinear(upper.hex), hexToLinear(e.hex))
    return { outline, warmOnDark, bridge }
  }
  // The scene width of a band's top edge from 10 to 90%, in lens radii. A wide near-white band (Ice) has very
  // soft edges: a glow rather than a stripe. In a field, a light edge of the field is a long fade and a light edge
  // between two accents is near-crisp, so one frame has both.
  const fadeOf = (list: readonly Entry[], wide: readonly number[], i: number, draw: (lo: number, hi: number) => number, structure: Structure = 'stack') => {
    const { outline, warmOnDark, bridge } = edgeKind(list, i)
    const glow = [i - 1, i].some((j) => wide.includes(j) && lightness(list[j].hex) > 0.95) ? 1.8 : 1
    if (warmOnDark) return draw(0.05, 0.1) * glow
    if (outline) return draw(0.3, 0.8) * glow
    if (bridge) return draw(1.2, 1.8) * glow
    if (structure === 'field') return (wide.includes(i - 1) || wide.includes(i) ? draw(2.2, 3.2) : draw(0.4, 0.9)) * glow
    return draw(1.2, 2.6) * glow
  }

  // Each run of seeds as long as the list takes every choice once: from a seeded first one, each next choice is
  // the one whose look is farthest from the last seven, so any eight seeds in a row look different. A seed's
  // layout is drawn from its run and its choice, so the order sees every seed's layout.
  const n0 = seed - 1
  const run = Math.floor(n0 / choices.length)
  const layoutDraws = (index: number) => random(run * 7919 + index * 104729 + pack.id.length * 31 + 5)
  const skyDrawOf = (index: number) => random(run * 6271 + index * 92821 + pack.id.length * 17 + 3).next()
  // A choice's layout at the middle Softness and Horizon: its colors and every band's height and edge. The wide
  // bands take most of the spare height, so the light sits low, in the middle or high, and the others stay near
  // their least heights. When the bands don't fit, the color added again goes first, then a second dark color, so
  // the pack's colors stay; when even the least heights don't fit, all bands shrink together. Where the seed's
  // horizon has water or land in the frame (`ground`), the last (dark) band is land, a ridge or bank from the line
  // down. (Water is left out: mirrored, a stack reads as stripes, and the mirrored bridges go pink.)
  const layoutOf = (c: Choice, rnd: Random, ground: boolean, skyDraw: number) => {
    const list = build(c.light, c.darks, c.base, c.form)
    const wideEntries = c.wide.map((i) => list[i])
    // Few, unequal parts: the sky and the wide bands are wide areas with long gradients inside them. A part that
    // isn't wide is a thin bright line (two at most; a light one only where it meets its neighbours without a
    // bridge, since through the lens an Orange-red line on Meta Blue reads pink; a dark one anywhere but at the
    // bottom). Otherwise it goes if the frame still shows three pack colors without it, and a warm one where the
    // pack has warm colors (a thin line counts, and so does the sky's pale tint, Cyan in Bold or Steel in
    // Atmospheric, when the sky pales fully into it: `carries`); if not, it stays as an area of its own.
    let lineCount = list.filter((e) => e.line).length
    const meets = (a: Entry, b: Entry | undefined) => !b || !needsBridge(hexToLinear(a.hex), hexToLinear(b.hex))
    // Some seeds' sky is a sliver along the top. A sliver is too short to pale into the tint, so there the tint's
    // color keeps a part of its own.
    const sliver = !c.wide.includes(0) && skyDraw < 0.3
    // A grey tint (Atmospheric's Steel) reads as its own color only where the sky pales all the way into it, which
    // the lens and a dark band below often cut short, so only a colored tint (Bold's Cyan) counts.
    const tinted = !!tintHex && !dark(list[0]) && !sliver && oklch(tintHex)[1] >= 0.04
    // Meta Blue always stays.
    const keeps = (e: Entry) => e.under === 1 && e.hex === sky
    // A thin line too dim through the lens to reach its own color doesn't read as one of the frame's colors: a dark
    // one, or a near-white one (an Ice line peaks well under Ice).
    const unread = (o: Entry) => o.line && (dark(o) || lightness(o.hex) > 0.95)
    const enough = (i: number) => {
      const others = list.filter((o, j) => j !== i && !unread(o))
      return (
        !keeps(list[i]) &&
        new Set([...others.map((o) => o.hex), ...(tinted ? [tintHex] : [])]).size >= 3 &&
        (!warmHex(list[i].hex) || others.some((o) => warmHex(o.hex)))
      )
    }
    for (let i = list.length - 1; i >= 1; i--) {
      const e = list[i]
      if (wideEntries.includes(e) || e.line) continue
      const bright = lightness(e.hex) >= 0.6
      const lineable = e.under === 1 && lineCount < 2 && i < list.length - 1 && (bright ? meets(e, list[i - 1]) && meets(e, list[i + 1]) : dark(e))
      // A line that doesn't read as one of the frame's colors only takes its color where the frame keeps three
      // without it.
      if (lineable && ((bright && lightness(e.hex) <= 0.95) || enough(i))) {
        list[i] = { ...e, line: true }
        lineCount++
      } else if (enough(i)) {
        list.splice(i, 1)
      } else {
        wideEntries.push(e)
      }
    }
    // The tint carries a color when no band of that color is left in full.
    const carries = tinted && !list.some((e) => e.hex === tintHex && !e.line)
    while (list.length > 3 && leastOf(list, R0).reduce((s, v) => s + v, 0) > 0.97) {
      const added = list.findIndex((e) => e.under < 1)
      const darkAt = list.map((e, i) => (dark(e) ? i : -1)).filter((i) => i >= 0)
      const drop = added >= 0 ? added : darkAt.length > 1 ? darkAt[darkAt.length - 1] : -1
      if (drop < 0) break
      list.splice(drop, 1)
    }
    const n = list.length
    const kept = wideEntries.map((e) => list.indexOf(e)).filter((i) => i >= 0)
    const wide = kept.length ? kept : [n - 1]
    const below: 'open' | 'land' = ground && dark(list[n - 1]) ? 'land' : 'open'
    // A sliver sky takes 8 to 14 % of the spare height; a sky that carries its tint's color at least 30 %, so the
    // tint covers enough of the frame to read.
    const shares = list.map((e, i) => shareOf(e, i, wide, (lo, hi) => rnd.between(lo, hi), c.structure))
    const others = shares.slice(1).reduce((s, v) => s + v, 0)
    const skyShare = (f: number) => (f / (1 - f)) * others
    if (sliver) shares[0] = skyShare(lerp(0.08, 0.14, skyDraw / 0.3))
    else if (carries) shares[0] = Math.max(shares[0], skyShare(0.3))
    const least = leastOf(list, R0)
    const leastSum = least.reduce((s, v) => s + v, 0)
    const shareSum = shares.reduce((s, v) => s + v, 0)
    const spans = shares.map((v, i) => least[i] * Math.min(1, 1 / leastSum) + (Math.max(0, 1 - leastSum) * v) / shareSum)
    // Each band's top edge: the sky's is the frame's top, and the last band's is the lowest boundary.
    const tops = spans.map((_, i) => spans.slice(0, i).reduce((s, v) => s + v, 0))
    // The whole stack leans one way or the other, and every edge curves more or less, a ramp's too.
    const stackTilt = (rnd.between(-0.06, 0.06) * frameW) / frameH
    const curve = rnd.between(0.8, 1.8)
    // The long ramp between a ramp's two bands: 27 to 30 % of the frame height together with the lens.
    const lensWidth = (1.38 * R0) / frameH
    const ramp = Math.sqrt(Math.max(0, rnd.between(0.27, 0.3) ** 2 - lensWidth ** 2))
    const bands: Band[] = []
    const under: number[] = []
    list.forEach((e, i) => {
      if (i === 0) return
      const upper = list[i - 1]
      const { outline, warmOnDark, bridge } = edgeKind(list, i)
      // Every band draws the same random numbers, land or not, so no other edge depends on whether there is land.
      // Each edge leans its own way and meanders on its own lattice, so no two neighbours run parallel and the gap
      // between them changes along their length.
      let tilt = stackTilt + (rnd.between(-0.1, 0.1) * frameW) / frameH
      let wave = (curve * rnd.between(0.015, 0.04)) / frameH
      const wavelength = rnd.between(0.8, 1.6)
      const side = rnd.sign()
      const ridge = rnd.chance(0.5)
      const count = rnd.int(1, 2)
      const draws = [0, 1].map(() => [rnd.next(), rnd.next(), rnd.sign(), rnd.next()] as const)
      const kind = rnd.int(0, 2)
      const lobes: Bump[] = []
      if (below === 'land' && i === n - 1) {
        // Land: one ridge rising toward one side, or a low bank, tilted up to the seed's horizon tilt.
        const rise = (Math.tan((Math.abs(place.tilt) * Math.PI) / 180) * frameW) / frameH
        const [at, width, sign, shift] = draws[0]
        if (ridge) {
          tilt = -side * rise
          lobes.push([side > 0 ? lerp(0.7, 1.05, at) : lerp(-0.05, 0.3, at), lerp(0.45, 0.8, width) / frameW, -lerp(0.03, 0.06, shift) / frameH])
        } else {
          tilt = -side * Math.min(rise, (0.03 * frameW) / frameH)
          lobes.push([lerp(0.2, 0.8, at), lerp(0.5, 0.9, width) / frameW, (sign * lerp(0.01, 0.02, shift)) / frameH])
        }
        wave *= 0.6
      } else {
        // Each edge has one shape of its own over its whole length: a long slow curve, a lean, or a big bulge in one
        // place, sometimes with a second low lobe. The small wave on top comes and goes along the edge
        // (`edgeSwell`), so it never reads as a steady ripple.
        const [at, width, sign, shift] = draws[0]
        if (kind === 0) lobes.push([lerp(0.2, 0.8, at), Math.min(1, lerp(0.8, 1.4, width) / frameW), (sign * curve * lerp(0.035, 0.07, shift)) / frameH])
        else if (kind === 1) lobes.push([lerp(0.1, 0.9, at), lerp(0.25, 0.45, width) / frameW, (sign * curve * lerp(0.05, 0.1, shift)) / frameH])
        else tilt += (sign * lerp(0.05, 0.1, shift) * frameW) / frameH
        if (count === 2) {
          const [at2, width2, sign2, shift2] = draws[1]
          lobes.push([lerp(0.05, 0.95, at2), Math.max(3 * R0, lerp(0.45, 0.9, width2)) / frameW, (sign2 * curve * lerp(0.01, 0.025, shift2)) / frameH])
        }
        wave *= 0.4
      }
      const darker = i + 1 < list.length && shown(e) < Math.min(shown(upper), shown(list[i + 1])) - 0.1
      const fade = fadeOf(list, wide, i, (lo, hi) => rnd.between(lo, hi), c.structure)
      // A ramp's long edge only between two light bands: into a dark band (Lime into Forest) it is a wide olive mix.
      const rampEdge = c.structure === 'ramp' && wide.includes(i - 1) && wide.includes(i) && !dark(upper) && !dark(e)
      // No fade is wider than the bands it joins can hold: a thin band across a long fade never shows its own color.
      const room = 0.6 * Math.min(spans[i - 1], spans[i])
      bands.push({
        color: e.hex,
        edge: { base: tops[i], tilt, bumps: lobes, wave, wavelength, row: 2 * bands.length },
        mode: outline ? MODE_COVER : MODE_LIGHT,
        // A line is sharp in the scene, a third of a lens radius; the lens spreads it. Under a sky that carries its
        // tint's color, the first band's edge stays within a quarter of the sky, so its light doesn't cover the tint.
        fade: rampEdge
          ? ramp
          : e.line
            ? (0.35 * R0) / frameH
            : Math.min((fade * R0) / frameH, room, i === 1 && carries ? 0.25 * spans[0] : Infinity),
        fadeVary: e.line ? 0.3 : rampEdge ? 0.2 : warmOnDark ? 0.5 : outline ? 0.9 : 0.35,
        ramp: rampEdge,
        light: 1,
        lean: rnd.between(-0.15, 0.15),
        bridge: bridge && !e.line ? 1 : 0,
        vary: 1,
        sun: 0,
        drift: dimDrift(hexToLinear(e.hex)),
        // A line only has to stay clear of the next boundary, so it can come close to it and draw away again.
        floor: e.line ? 0.6 : darker ? 3.2 : 2,
        line: e.line,
      })
      under.push(e.under)
    })
    const landBand = below === 'land' ? bands.length - 1 : -1
    // A dome: a band lighter than the one above rises into it (not in a ramp, whose edges stay calm).
    const domes = bands.map((_, i) => i).filter((i) => i !== landBand && lightness(bands[i].color) > lightness(i === 0 ? list[0].hex : bands[i - 1].color) + 0.05)
    if (c.structure !== 'ramp' && domes.length && rnd.chance(0.75)) {
      const b = bands[domes[rnd.int(0, domes.length - 1)]]
      const dome: Bump = [rnd.between(0.15, 0.85), rnd.between(0.4, 0.7) / frameW, -rnd.between(0.035, 0.06) / frameH]
      b.edge = { ...b.edge, bumps: [...b.edge.bumps, dome].slice(0, BUMP_MAX) }
    }
    // A dark mass: every dark band's top edge swells broadly into the band above on one side, or dips; every band
    // draws the same random numbers.
    bands.forEach((b, i) => {
      const side = rnd.chance(0.5) ? rnd.between(0.0, 0.3) : rnd.between(0.7, 1.0)
      const width = rnd.between(0.4, 0.75)
      const shift = (rnd.chance(0.7) ? -1 : 1) * curve * rnd.between(0.025, 0.045)
      if (i === landBand || lightness(b.color) * Math.cbrt(under[i]) >= 0.45) return
      b.edge = { ...b.edge, bumps: [...b.edge.bumps, [side, width / frameW, shift / frameH] as Bump].slice(0, BUMP_MAX) }
    })
    keepThick(bands, R0, frameW, frameH, null)
    // How far the sky and the bands between it and the light pale toward the light (drawn last, so no other draw
    // moves): a sky that darkens toward the top stays deeper, the others pale further, so the two kinds differ.
    const deep = c.zenith > 0
    const paling = {
      sky: deep ? rnd.between(0.4, 0.5) : rnd.between(0.65, 0.8),
      middles: deep ? rnd.between(0.2, 0.3) : rnd.between(0.4, 0.5),
      carries,
    }
    return { list, bands, under, tops, paling }
  }
  const key = `${pack.id}|${aspect.toFixed(4)}|${run}`
  let order = runOrders.get(key)
  if (!order) {
    // A choice's look as the palette check judges seed variety at thumbnail size (`viewOf`), in the frame and under
    // a long line. It comes from a render of the frame's column average at the middle Intensity: the sky, each band
    // over it blended as in bands.ts, the disc lens and the thumbnail's blur of about a row, in linear light.
    const FINE = 96
    const ROWS = 24
    // The shader's edge cover (a disk past the edge, 10-90 width w) and thin line.
    const sceneStep = (d: number, w: number) => {
      const t = clamp(d / (w / 1.38), -1, 1)
      return 0.5 + (t * Math.sqrt(1 - t * t) + Math.asin(t)) / Math.PI
    }
    const lineCover = (d: number, w: number) => {
      const x2 = 0.5 * (d / w) ** 2
      return 0.55 * Math.exp(-x2 / 0.36) + 0.35 * Math.exp(-x2 / 1.44) + 0.1 * Math.exp(-x2 / 9)
    }
    // A bump's mean height across the frame's width (the tilt and the wave average out).
    const across = (at: number, width: number) =>
      width > 0 ? Array.from({ length: 16 }, (_, k) => Math.exp(-0.5 * (((k + 0.5) / 16 - at) / width) ** 2)).reduce((s, v) => s + v, 0) / 16 : 0
    // The disc lens's line spread (a semicircle) and the thumbnail's blur of about a row (a Gaussian), as one
    // kernel in fine rows.
    const reach = Math.max(1, Math.round((R0 / frameH) * FINE))
    const disc = Array.from({ length: 2 * reach + 1 }, (_, k) => Math.sqrt(Math.max(0, 1 - ((k - reach) / (reach + 0.5)) ** 2)))
    const sigma = (1.05 * FINE) / 23
    const thumbReach = Math.ceil(3 * sigma)
    const thumb = Array.from({ length: 2 * thumbReach + 1 }, (_, k) => Math.exp(-0.5 * ((k - thumbReach) / sigma) ** 2))
    const kernel = new Float64Array(disc.length + thumb.length - 1)
    disc.forEach((a, i) => thumb.forEach((b, j) => (kernel[i + j] += a * b)))
    const kernelSum = kernel.reduce((s, v) => s + v, 0)
    const half = (kernel.length - 1) / 2
    const look = (c: Choice, index: number) => {
      const { list, bands, under, paling } = layoutOf(c, layoutDraws(index), false, skyDrawOf(index))
      const tops = bands.map((b) => b.edge.base + b.edge.bumps.reduce((s, [at, width, shift]) => s + shift * across(at, width), 0))
      const lights = bands.map((b, i) => baseLight(list, i + 1) * (b.line ? 1 : iceCap(b.color, 1)))
      const emit = bands.map((b, i) => hexToLinear(b.color).map((v) => v * lights[i]))
      const sky = hexToLinear(list[0].hex)
      // The light's pale core (averaged across the frame, where it gathers at the light's column) and the haze.
      const lightColor = c.light ?? list.slice(1).reduce((a, b) => (lightness(b.hex) > lightness(a.hex) ? b : a)).hex
      const lightBand = Math.max(0, bands.findIndex((b, i) => b.color === lightColor && under[i] === 1))
      const coreHeight = (tops[lightBand + 1] ?? 1) - tops[lightBand]
      const corePlace = lightBand === bands.length - 1 ? 1 : 0.5
      // The light at height v with a given haze.
      const shade = (haze: ReturnType<typeof hazeOf>) => {
        const coreColor = hexToLinear(bands[lightBand].color).map((v) => (haze.paleOwn ? v / luminanceOf(bands[lightBand].color) : v))
        const core = (haze.paleOwn ? coreColor : paleLight(hexToLinear(bands[lightBand].color))).map((v) => v * haze.pale * 0.3 * lights[lightBand])
        // The middles' veil gathers at the light's column like the core: about half of it on average across the frame.
        const veils = bands.map((b, i) => paleLight(hexToLinear(b.color)).map((v) => v * haze.veils[i] * 0.5 * lights[i]))
        const skyVeil = tintOf(paling.carries).map((v) => v * haze.sky[0])
        return (v: number) => {
          const gain = 2 ** (-c.zenith * Math.max(0, 0.5 - v))
          const t = smoothstep(haze.sky[1], haze.sky[2], v) * (1 - smoothstep(haze.skyEnd[0], haze.skyEnd[1], v))
          const color = sky.map((x, j) => x * gain * (1 + haze.sky[3] * t) + skyVeil[j] * t * gain)
          bands.forEach((band, i) => {
            const a = Math.min(1, band.line ? lineCover(v - 0.5 * (tops[i] + (tops[i + 1] ?? 1)), band.fade) : sceneStep(v - tops[i], Math.max(band.fade, 1e-3)))
            const [keep, add] = band.mode === MODE_COVER ? [1 - a, a] : [(1 - a) ** 0.65, a ** 0.65]
            const height = (tops[i + 1] ?? 1) - tops[i]
            const depth = clamp((v - tops[i]) / Math.max(height, 1e-3), 0, 1)
            const d = (v - tops[i]) / Math.max(coreHeight, 1e-3) - corePlace
            const glow = i === lightBand ? Math.exp((-d * d) / 0.12) : 0
            for (let j = 0; j < 3; j++) color[j] = color[j] * keep + (emit[i][j] + core[j] * glow + veils[i][j] * depth * depth) * add
          })
          return color
        }
      }
      const atFrame = shade(hazeOf(list, bands, lightBand, paling))
      const fine = new Float64Array(3 * FINE)
      for (let k = 0; k < FINE; k++) fine.set(atFrame((k + 0.5) / FINE), 3 * k)
      // The whole frame, through the lens and the thumbnail's blur.
      const frameRows = Array.from({ length: ROWS }, (_, r) => {
        const k = Math.floor(((r + 0.5) / ROWS) * FINE)
        return [0, 1, 2].map((j) => {
          let s = 0
          for (let d = 0; d < kernel.length; d++) s += kernel[d] * fine[3 * clamp(k + d - half, 0, FINE - 1) + j]
          return s / kernelSum
        })
      })
      // What a long line shows: the stack from the top of the sky to the middle of the light's band, drawn out
      // along it, so that every part is tall enough to pale fully; the sky keeps its full color over its far part,
      // and a sky right above the light sinks toward the pack's darkest color farther out (`stack`, at the middle of
      // its draws).
      const lightAt = tops[lightBand] + 0.5 * ((tops[lightBand + 1] ?? 1) - tops[lightBand])
      const darkest = list.slice(1).filter((e) => darks.includes(e.hex)).reduce<Entry | undefined>((a, e) => (!a || lightness(e.hex) < lightness(a.hex) ? e : a), undefined)
      const farTo = darkest && lightBand === 0 && !dark(list[0]) ? 0.42 * tops[0] : 0
      const atLine = shade(hazeOf(list, bands, lightBand, paling, MAX_ZOOM, (farTo > 0 ? 0.8 : 0.32) * tops[0]))
      // A line from corner to corner shows most of the frame around its middle and little at its ends: rows sit at
      // equal shares of the frame's area along it.
      const lineRows = Array.from({ length: ROWS }, (_, r) => {
        const a = (r + 0.5) / ROWS
        const v = (a < 0.5 ? Math.sqrt(a / 2) : 1 - Math.sqrt((1 - a) / 2)) * lightAt
        return darkest && v < farTo ? hexToLinear(darkest.hex) : atLine(v)
      })
      return { frame: viewOf(frameRows), line: viewOf(lineRows) }
    }
    const looks = choices.map(look)
    // How far apart two choices look, in the frame and under a long line, against the palette check's thresholds
    // (alike: layout 0.2 or less and colors 0.15 or less); above 1 they don't look alike in either. A pack of greys
    // around a near-white light (Atmospheric) shows Meta Blue over Ice under every long line, so there only the
    // frame counts, by where its light sits (lightness stretched to 0-1): which grey a pixel reads as is uncertain.
    const apart = (a: number, b: number) =>
      lights.length
        ? Math.min(viewApart(looks[a].frame, looks[b].frame), viewApart(looks[a].line, looks[b].line))
        : viewApart(looks[a].frame, looks[b].frame, { stretched: true })
    const runRnd = random(run * 7919 + pack.id.length * 31 + 17)
    const made = [runRnd.int(0, choices.length - 1)]
    const left = new Set(choices.map((_, i) => i).filter((i) => i !== made[0]))
    while (left.size) {
      let best = -1
      let bestScore = -1
      for (const i of left) {
        const score = Math.min(...made.slice(-7).map((o) => apart(i, o))) + 1e-6 * runRnd.next()
        if (score > bestScore) {
          best = i
          bestScore = score
        }
      }
      made.push(best)
      left.delete(best)
    }
    order = made
    runOrders.set(key, order)
  }
  const index = order[((n0 % choices.length) + choices.length) % choices.length]
  const choice = choices[index]
  const { list, bands, under, tops, paling } = layoutOf(choice, layoutDraws(index), place.y < 1 && place.below !== 'open', skyDrawOf(index))
  const n = list.length
  const leastAt = (r: number) => leastOf(list, r)
  // Every other seed's sky darkens toward the top.
  const zenith = choice.zenith
  // The image's light: its warm or light color, else the brightest after the sky (Ice).
  const light = choice.light ?? list.slice(1).reduce((a, b) => (lightness(b.hex) > lightness(a.hex) ? b : a)).hex
  keepThick(bands, R0, frameW, frameH, edgeSeed(seed))
  // Edge widths scale with the lens, except a ramp's, which is set by the frame.
  bands.forEach((b) => (b.fade *= b.ramp ? 1 : R / R0))

  // Softness and Horizon move and resize the seed's bands. Every band is at least as tall as the lens rule asks
  // (2 lens radii, 3.2 for a band darker than both neighbours) and at least an eighth of the frame, so that in a
  // tall frame its color still shows after the lens; the height above that is spare. Horizon moves
  // spare height between the last band (land, or the band running off the frame) and the bands above it: none
  // for the last band at 0, the seed's own share at 0.5, all of it at 1. A lens wider than the middle one raises
  // every least height, and the spare height shrinks; when none is left, all bands shrink together. Edges
  // flatten as their bands shrink.
  const was = list.map((_, i) => (i + 1 < n ? tops[i + 1] : 1) - tops[i])
  const leastSeed = leastAt(R0)
  const spareSeed = was.map((w, i) => Math.max(0, w - leastSeed[i]))
  const leastNow = leastAt(Math.max(R, R0))
  const spare = 1 - leastNow.reduce((s, v) => s + v, 0)
  const spareSeedSum = Math.max(1e-9, spareSeed.reduce((s, v) => s + v, 0))
  const lastSeed = (spareSeed[n - 1] * Math.max(spare, 0)) / spareSeedSum
  const lastSpare = horizon < 0.5 ? lerp(0, lastSeed, horizon / 0.5) : lerp(lastSeed, Math.max(spare, 0), (horizon - 0.5) / 0.5)
  const aboveSeed = spareSeedSum - spareSeed[n - 1]
  const now =
    spare <= 0
      ? leastNow.map((v) => v / (1 - spare))
      : leastNow.map((v, i) =>
          i === n - 1 ? v + lastSpare : v + (aboveSeed > 0 ? (spareSeed[i] / aboveSeed) * (spare - lastSpare) : (spare - lastSpare) / (n - 1)),
        )
  // A dragged line sets the span from the top of the sky to the middle of the light's band (`along`, frame
  // heights). Shorter than the seed's own span, the bands above the light give up spare height, down to their
  // least heights; a longer line draws the whole stack out along it (`stackMap`).
  const lightBand = Math.max(0, bands.findIndex((b, i) => b.color === light && under[i] === 1))
  const spanOf = (h: readonly number[]) => h.slice(0, lightBand + 1).reduce((s, v) => s + v, 0) + h[lightBand + 1] / 2
  const ownSpan = spanOf(now)
  const lastTopOwn = now.slice(0, n - 1).reduce((s, v) => s + v, 0)
  let lineSky: { blueTo: number; pale: number; tintAt: number; far?: { hex: string; amount: number; full: number; gone: number } } = { blueTo: 0, pale: 0, tintAt: 0.6 }
  if (along !== undefined && along < ownSpan) {
    const room = now.slice(0, lightBand + 1).map((v, j) => Math.max(0, v - leastNow[j]))
    const roomSum = room.reduce((s, v) => s + v, 0)
    if (roomSum > 1e-6) {
      const keep = softLimit((along - (ownSpan - roomSum)) / roomSum, 0, Infinity, 0.1)
      room.forEach((r, j) => (now[j] -= r * (1 - keep)))
    }
  } else if (along !== undefined) {
    // A longer line draws the stack out along it, each band keeping its own order and share of the span, and
    // across the line its own edges (`stackMap`). At the far end the sky keeps its full color over a share of its
    // height before it pales (`hazeOf`), and a sky right above the light, with no band between them for a second
    // pack color, sinks farther out toward the pack's darkest color, as a dusk sky deepens away from the light; both
    // come in fully once the line is twice the seed's span. Meta Blue has about twenty times the light of a dark
    // pack color, so any of it left in the mix reads as blue: that far sky is all dark over its share and gives way
    // to the sky over a short stretch after it.
    const draws = random(seed * 7477 + pack.id.length * 13 + 11)
    const own = (e: Entry) => darks.includes(e.hex)
    const darkest = list.slice(1).filter(own).reduce<Entry | undefined>((a, b) => (!a || lightness(b.hex) < lightness(a.hex) ? b : a), undefined)
    const w = smoothstep(1, 2, along / ownSpan)
    const farShare = darkest && lightBand === 0 && !dark(list[0]) ? draws.between(0.25, 0.7) : 0
    const farFade = draws.between(0.08, 0.15)
    const blueShare = Math.min(0.85, (farShare > 0 ? farShare + farFade : 0) + draws.between(0.25, 0.4))
    // A line whose start, the light, lies outside the frame looks past the light into the sky, so the frame may show
    // only sky, which then has to show two pack colors itself. What follows comes in as the start leaves the frame
    // (fully a quarter of the short side out) and as the line grows to 1.6 times the seed's span (the owner's line
    // is about 1.5 times it at 9:16). The far part of the span keeps the sky's full
    // color, or its dark one, over at least 17% of the span, which at the owner's line covers about 4% of a 16:9
    // frame and 6% of a 9:16 one; a sky too short for that and a tenth of the span to pale over grows into the bands
    // between it and the light, down to their least heights. The far dark comes in at full strength, and also over
    // a sky whose bands down to the light are all dark. A sky with no far dark that takes most of the span pales
    // fully into its tint near the light (`hazeOf`; a grey tint, Atmospheric's Steel, at its own light: `skyTint`),
    // as the bands near the light then show little of the frame. The seed's own numbers come from their own
    // draws, so frames under any other line keep theirs.
    const fix = smoothstep(1, 1.6, along / ownSpan) * smoothstep(-0.1, 0.25, startOut)
    const extra = random(seed * 7489 + pack.id.length * 17 + 3)
    const deepLeast = 0.17 * ownSpan
    const tintAt = extra.between(0.4, 0.8)
    const farOwn = darkest && lightBand > 0 && !dark(list[0]) && list.slice(1, lightBand + 1).every((e) => dark(e)) ? extra.between(0.35, 0.5) : 0
    const paleLeast = dark(list[0]) ? 0 : 0.1 * ownSpan
    const room = now.slice(1, lightBand + 1).map((v, j) => Math.max(0, v - leastNow[j + 1]))
    const roomSum = room.reduce((s, v) => s + v, 0)
    const grow = Math.min(fix * Math.max(0, deepLeast + paleLeast - now[0]), roomSum)
    if (grow > 0) {
      room.forEach((r, j) => (now[j + 1] -= (grow * r) / roomSum))
      now[0] += grow
    }
    const sky = now[0]
    const far = farShare > 0 ? farShare : farOwn
    // Each comes in from what the line gives without it, in step with `fix`, so it changes evenly as the start
    // leaves the frame.
    const farOwnLine = farShare > 0 ? w : 0
    const farSpan = farOwnLine + (1 - farOwnLine) * fix
    const blueOwn = w * blueShare * sky
    const deep = Math.max(Math.min(deepLeast, sky - paleLeast), farOwn > 0 ? Math.min(0.8, farOwn + farFade + 0.25) * sky : 0)
    lineSky = {
      blueTo: blueOwn + fix * Math.max(0, deep - blueOwn),
      pale: far > 0 || !tintHex ? 0 : fix * smoothstep(0.5, 0.7, sky / ownSpan),
      tintAt,
      far:
        darkest && far > 0
          ? { hex: darkest.hex, amount: farOwnLine + (1 - farOwnLine) * smoothstep(0, 1, fix), full: farSpan * far * sky, gone: farSpan * (far + farFade) * sky }
          : undefined,
    }
  }
  const seedSpan = spanOf(now)
  let edgeTop = 0
  bands.forEach((b, k) => {
    edgeTop += now[k]
    const s = Math.min(1, now[k] / was[k], now[k + 1] / was[k + 1])
    b.edge = { ...b.edge, base: edgeTop, tilt: b.edge.tilt * s, bumps: b.edge.bumps.map(([bx, bw, sh]) => [bx, bw, sh * s] as Bump), wave: b.edge.wave * s }
  })

  // In front of the frame, below its bottom edge, the ground is water that mirrors the light and the sky beyond the
  // bank, so a drag that shows only ground still shows the pack's colors. Its line lies a seed's distance below the
  // light, below the frame and the lens's reach, and keeps its distance below the bank as a drag moves the bands.
  // It mirrors about the top of the bank (the light's middle when the light's band is the last), so just below
  // the shore it shows the light, then the bands above it and the sky. It is a dimmed clean mirror: its own blue
  // under mirrored warm light would turn it pink. Its ripples stay small and broad: ripples that reach across two
  // mirrored colors far apart (Orange-red and Meta Blue) speckle them, and the lens mixes the speckles to pink.
  const shore = random(seed * 3571 + pack.id.length * 7 + 13)
  const shoreAt = Math.max(1 + R / frameH + 0.05, ownSpan + shore.between(0.45, 0.7))
  const bankTop = bands[bands.length - 1].edge.base
  const foreWater = {
    line: Math.min(1.98, shoreAt + bankTop - lastTopOwn),
    axis: lightBand === bands.length - 1 ? seedSpan : bankTop,
    squeeze: shore.between(1, 1.8),
    smear: shore.between(0.03, 0.07),
    reflect: shore.between(0.6, 0.85),
    ripple: shore.between(0.15, 0.3),
  }
  const zoom = along === undefined ? 1 : zoomOf(along, seedSpan)
  // Drawn out along a line, each edge keeps its own softness on the frame.
  if (zoom > 1) bands.forEach((b) => (b.fade /= zoom))

  // Light: the image's light rises most with Intensity, and above the middle the extra light gathers around the
  // light's column, so white shows only near the light, never as a flat band across the frame. Below the middle
  // the whole scene dims (`dim`), warm bands half as much in stops (much dimmer, and mixed with their neighbours
  // through the lens, they read khaki and mauve), and each band's color deepens as it dims: warm ones toward amber
  // or deep red, a lime toward deep green (`drift`). Next to a dark band, where the lens dims a warm color
  // further, its light changes half as much.
  const haze = hazeOf(list, bands, lightBand, { ...paling, sky: Math.max(paling.sky, 0.85 * lineSky.pale), full: lineSky.pale, fullAt: lineSky.tintAt }, zoom, lineSky.blueTo, R)
  const dim = Math.min(1, level) ** 1.6
  const darkAt = (j: number) => j >= 0 && j < bands.length && lightness(bands[j].color) * Math.cbrt(under[j]) < 0.45
  const warmAt = (j: number) => j >= 0 && j < bands.length && warmHex(bands[j].color)
  bands.forEach((b, i) => {
    const isLight = b.color === light && under[i] === 1
    const warmLight = warmAt(i)
    const lift = level >= 1 ? level ** (isLight ? 1.6 : 0.8) : 1
    // A near-white light (Atmospheric's Ice) gathers part of its light around the light's column at every
    // Intensity, so the bright part of the frame moves with the seed.
    const column = !lights.length && lightness(b.color) > 0.95 ? 0.4 : 0
    // A thin line's light spreads through the lens, so its light isn't held below white.
    // A muted warm color (Tan) has no dark partner to deepen into, so it keeps its light as the scene dims: dimmer,
    // it reads brown.
    const keep = warmLight ? (oklch(b.color)[1] < 0.12 ? dim ** -1 : dim ** -0.5) : 1
    b.light = baseLight(list, i + 1) * lift * keep * (b.line ? 1 : iceCap(b.color, level)) * (1 + 0.6 * column)
    b.sun = Math.max(column, 1 - 1 / lift)
    if (warmLight && (darkAt(i - 1) || darkAt(i + 1))) b.vary = 0.5
    // The light's pale core grows with Intensity up to the middle (`hazeOf`).
    if (i === lightBand && haze.pale > 0) {
      b.paleOwn = haze.paleOwn
      b.pale = haze.pale * Math.min(1, level) ** 1.2
    }
  })
  // Some seeds gather the light of the light's band around the light's column: a bright glow in one part with
  // deeper sides, instead of an even field. Only in a band that covers the sky: a band of light adds to the sky,
  // and dimmed, its color mixes with the sky's pale tint (Orange-red on pale Cyan reads pink). Not in Lime or Tan:
  // dimmed, they read olive and khaki.
  const olive = (hex: string) => (hue(hex) > 100 && hue(hex) < 150) || (warmHex(hex) && oklch(hex)[1] < 0.12)
  const glowRnd = random(seed * 3307 + pack.id.length * 7 + 29)
  const glow = glowRnd.chance(0.4) ? glowRnd.between(0.6, 0.85) : 0
  const glowing = bands[lightBand]
  if (glow > 0 && glowing && !glowing.line && glowing.mode !== MODE_LIGHT && !olive(glowing.color)) glowing.sun = Math.max(glowing.sun, glow)

  // Light terms: a darker stretch in one band that isn't warm (a warm color dimmed reads olive or khaki), and a
  // neighbour's light spilled into a band of close hue.
  const lightTerms: LightTerm[] = []
  const patches: Patch[] = []
  const coolBands = bands.map((_, i) => i).filter((i) => !warmAt(i))
  const shaded = coolBands[rnd.int(0, Math.max(0, coolBands.length - 1))]
  const shadeShape: [number, number, number, number] = [rnd.chance(0.5) ? rnd.between(0.05, 0.3) : rnd.between(0.7, 0.95), 0, rnd.between(0.15, 0.3), 0]
  const shadeLook: [number, number, number, number] = [rnd.between(0.1, 0.18), LIGHT_SHADE, shaded ?? 0, 0]
  if (shaded !== undefined) lightTerms.push({ color: sky, shape: shadeShape, look: shadeLook })
  for (let k = rnd.int(1, 2); k > 0; k--) {
    const bi = rnd.int(0, bands.length - 1)
    const from = rnd.chance(0.5) && bi + 1 < bands.length ? bands[bi + 1].color : bi > 0 ? bands[bi - 1].color : list[0].hex
    // None between a grey and a color (Meta Blue into Slate), as with the spill in `bands.ts`.
    const greyPair = (oklch(from)[1] < 0.04) !== (oklch(bands[bi].color)[1] < 0.04)
    if (bands[bi].line || greyPair || !closeHues(hexToLinear(from), hexToLinear(bands[bi].color))) continue
    const top = bands[bi].edge.base
    const bottom = bi + 1 < bands.length ? bands[bi + 1].edge.base : 1
    // A patch adds at most the band's own light, so a dark band keeps its own color (as the spill in `bands.ts`).
    const most = (luminanceOf(bands[bi].color) * bands[bi].light) / Math.max(luminanceOf(from), 1e-6)
    patches.push({
      color: from,
      shape: [rnd.between(0.1, 0.9), lerp(top, bottom, rnd.between(0.3, 0.7)), (rnd.between(2.5, 5) * R0) / frameW, (rnd.between(0.9, 1.4) * R0) / frameH],
      look: [1, Math.min(rnd.between(0.08, 0.18) * level ** 0.8, most), MODE_ADD],
    })
  }

  // Light changes slowly inside every band; a ramp's floors are nearly flat.
  const lightVary = rnd.between(0.1, 0.17) * (choice.structure === 'ramp' ? 0.35 : 1)
  // The light's column: where Intensity above the middle gathers its extra light.
  const sun: [number, number] = [rnd.between(0.2, 0.8), rnd.between(0.22, 0.35)]
  // Haze near the light (`hazeOf`).
  const skyVeil = haze.sky
  // The sky's own boundaries (where it pales, where its far part turns dark) wander like the band edges.
  const skyRnd = random(seed * 9241 + pack.id.length * 5 + 19)
  const skyWander = skyRnd.between(0.025, 0.05)
  const skyLattice = skyRnd.between(0.9, 1.5)
  // Where the sky pales leans against the sky's lower edge, and where its far part turns dark leans against that,
  // so no two of them run parallel.
  const skyEdgeLean = bands[0] ? (bands[0].edge.tilt * frameH) / frameW : 0
  const veilLean = skyEdgeLean - (Math.sign(skyEdgeLean) || skyRnd.sign()) * skyRnd.between(0.05, 0.12)
  const farLean = veilLean - Math.sign(veilLean) * skyRnd.between(0.06, 0.14)
  const skyDrift: [number, number, number, number] = [skyWander, skyLattice, (veilLean * frameW) / frameH, (farLean * frameW) / frameH]
  // A wide area's own light falls off away from the light: deeper toward its far side, paler toward the light. Not
  // in Lime or Tan: dimmed, they read olive and khaki.
  const fallRnd = random(seed * 5113 + pack.id.length * 3 + 23)
  bands.forEach((b, k) => {
    if (haze.veils[k] > 0) b.veil = haze.veils[k]
    const amount = fallRnd.between(0.3, 0.55)
    const height = (bands[k + 1]?.edge.base ?? 1) - b.edge.base
    // Not in a grey either (Atmospheric's): greys are told apart by lightness, so a deeper Slate reads Near-black.
    const grey = oklch(b.color)[1] < 0.04
    if (k !== lightBand && !b.line && height > 0.12 && !olive(b.color) && !grey) b.fall = [amount * smoothstep(0.12, 0.3, height), k > lightBand ? 1 : -1]
  })
  return {
    sky: list[0].hex,
    bands,
    lights: lightTerms,
    patches,
    sun,
    lightVary,
    skyFall: zenith + 3 * Math.max(0, 1 - level),
    skyLift: 1.2 * Math.max(0, level - 1),
    dim,
    lightAt: spanOf(now),
    seedSpan,
    skyVeil,
    skyVeilEnd: haze.skyEnd,
    // The sky's own boundaries (where it pales, where its far part turns dark) wander like the band edges.
    skyDrift,
    // Where the sky pales fully under a long line (`lineSky.pale`), a grey tint (Atmospheric's Steel) comes down to
    // its own hex's light, so the sky greys into Steel itself rather than into a lighter blue-grey, which reads as
    // Meta Blue's pale side.
    skyTint:
      tintHex && oklch(tintHex)[1] < 0.04 ? tintOf(paling.carries).map((v, k) => lerp(v, hexToLinear(tintHex)[k], lineSky.pale)) : tintOf(paling.carries),
    farSky: lineSky.far,
    foreWater,
  }
}

/**
 * The most the stack may be drawn out along a drag, in spans of the seed's own stack: enough that a line across the
 * whole frame still ends at the top of the sky, so the frame shows the sky's paling and not the sky beyond it.
 */
const MAX_ZOOM = 8

/** x held between lo and hi: unchanged more than `knee` inside them, bending smoothly onto them beyond. */
function softLimit(x: number, lo: number, hi: number, knee: number): number {
  if (x < lo + knee) return lo + knee * Math.exp((x - lo) / knee - 1)
  if (x > hi - knee) return hi - knee * Math.exp((hi - x) / knee - 1)
  return x
}

/**
 * How far a line `along` frame heights long draws out a stack whose own span is `seedSpan`: about 1 for a shorter
 * one. The zoom starts softly around the seed's span, where a shorter line only tightens the bands above the light,
 * so the frame doesn't start changing faster all at once.
 */
const ZOOM_ONSET = 0.06
const zoomOf = (along: number, seedSpan: number) => {
  const x = along / seedSpan
  const k = x > 1 + 30 * ZOOM_ONSET ? x : 1 + ZOOM_ONSET * Math.log1p(Math.exp((x - 1) / ZOOM_ONSET))
  return softLimit(k, -Infinity, MAX_ZOOM, 0.25)
}

/** The dragged line's length in frame heights. */
const dragAlong = (drag: NonNullable<BandsComposeInput['drag']>, frameW: number, frameH: number) =>
  Math.hypot((drag.to[0] - drag.from[0]) * frameW, (drag.to[1] - drag.from[1]) * frameH) / frameH

/**
 * The stack along a dragged line: the middle of the light's band at the line's start (at the light's column) and
 * the top of the sky at its end, so the line's length is the stack's span from the light to the deep sky. A line
 * shorter than the seed's span has already tightened the bands above the light (`stack`); a longer one draws the
 * whole stack out along the line, at most MAX_ZOOM times. The map takes a frame point p (short sides from the
 * frame's center, y down) to the scene point (a b; c d) p + (e, f); without a drag it is the identity. `frame` is
 * the shader's `stackFrame`: how far the stack is drawn out along the line and the light's scene point.
 */
function stackMap(scene: Scene, drag: BandsComposeInput['drag'], frameW: number, frameH: number): { map: number[]; frame: number[] } {
  const identity = { map: [1, 0, 0, 1, 0, 0], frame: [1, 0, 0] }
  if (!drag) return identity
  const from = [(drag.from[0] - 0.5) * frameW, (drag.from[1] - 0.5) * frameH]
  const along = dragAlong(drag, frameW, frameH)
  if (along < 1e-6) return identity
  // The line's direction, short-side units. A short line turns the stack only part of the way from upright, fully
  // from 0.3 of the short side: the tool keeps the line's ends to 0.001 of the frame, which turns a line a few lens
  // radii long by up to 2 degrees from one step to the next.
  const toward = Math.atan2((drag.to[1] - drag.from[1]) / along, ((drag.to[0] - drag.from[0]) * frameW) / (along * frameH))
  const fromUp = Math.atan2(Math.sin(toward + Math.PI / 2), Math.cos(toward + Math.PI / 2))
  const turned = -Math.PI / 2 + smoothstep(0, 0.3, along * frameH) * fromUp
  const [ux, uy] = [Math.cos(turned), Math.sin(turned)]
  const zoom = zoomOf(along, scene.seedSpan)
  // Along the line toward `to` is up the stack, toward the sky, drawn out `zoom` times; across it to the line's right
  // is the stack's x at the frame's own scale, so each band keeps its own edges (the shader divides their wander and
  // compose their softness by the same zoom).
  const [a, b, c, d] = [-uy, ux, -ux / zoom, -uy / zoom]
  const light = [(scene.sun[0] - 0.5) * frameW, (scene.lightAt - 0.5) * frameH]
  return {
    map: [a, b, c, d, light[0] - (a * from[0] + b * from[1]), light[1] - (c * from[0] + d * from[1])],
    frame: [zoom, light[0], light[1]],
  }
}

/** Ice is close to white: below white at the default Intensity. */
function iceCap(hex: string, level: number): number {
  return lightness(hex) > 0.95 ? Math.min(1, 0.58 / level ** 0.4) : 1
}

function writeScene(scene: Scene, R: number, stack: ReturnType<typeof stackMap>): BandsComposition {
  const params: Record<string, ParamValue> = { stack: stack.map, stackFrame: stack.frame }
  const colors = [scene.sky]
  scene.bands.slice(0, BAND_MAX).forEach((b, i) => {
    const key = (name: Parameters<typeof bandKey>[1]) => bandKey(i, name)
    colors.push(b.color)
    const bumps = b.edge.bumps.slice(0, BUMP_MAX)
    const pad = (values: number[], fill: number) => Array.from({ length: BUMP_MAX }, (_, j) => values[j] ?? fill)
    params[key('Edges')] = [b.edge.base, b.line ? (scene.bands[i + 1]?.edge.base ?? 1) : 2]
    params[key('Fade')] = [b.fade, 0]
    params[key('FadeVary')] = b.fadeVary
    params[key('Opacity')] = 1
    params[key('Light')] = b.light
    params[key('Mode')] = b.mode
    params[key('Line')] = b.line ?? false
    params[key('Tilt')] = [b.edge.tilt, 0, 0]
    params[key('Lean')] = b.lean
    params[key('Wave')] = [b.edge.wave, 0, b.edge.wavelength]
    params[key('Sun')] = [b.sun, 0]
    params[key('Vary')] = b.vary
    params[key('BumpAt')] = pad(bumps.map((x) => x[0]), 0.5)
    params[key('BumpWidth')] = pad(bumps.map((x) => x[1]), 0)
    params[key('BumpTop')] = pad(bumps.map((x) => x[2]), 0)
    params[key('BumpBottom')] = pad([], 0)
    params[key('BumpCover')] = pad([], 0)
    params[key('BumpLight')] = pad([], 0)
    params[key('Bridge')] = b.bridge
    params[key('Drift')] = b.drift
    // The core sits in the middle of the band, or for the last band at the frame's edge: the light's end.
    const next = scene.bands[i + 1]?.edge.base
    params[key('Pale')] = [b.pale ?? 0, Math.max(0.05, (next ?? 1) - b.edge.base), next === undefined ? 1 : 0.5, b.paleOwn ? 1 : 0]
    params[key('Veil')] = [b.veil ?? 0, Math.max(0.05, (next ?? 1) - b.edge.base)]
    params[key('Fall')] = b.fall ?? [0, 1]
  })
  while (colors.length < 1 + BAND_MAX) colors.push(scene.sky)
  scene.patches.slice(0, PATCH_MAX).forEach((patch, j) => {
    colors.push(patch.color)
    params[patchKey(j, 'Shape')] = patch.shape
    params[patchKey(j, 'Look')] = patch.look
  })
  while (colors.length < 1 + BAND_MAX + PATCH_MAX) colors.push(scene.sky)
  scene.lights.slice(0, LIGHT_MAX).forEach((light, k) => {
    colors.push(light.color)
    params[lightKey(k, 'Shape')] = light.shape
    params[lightKey(k, 'Look')] = light.look
  })
  while (colors.length < 1 + BAND_MAX + PATCH_MAX + LIGHT_MAX) colors.push(scene.sky)
  colors.push(scene.sky)

  params.bands = Math.min(scene.bands.length, BAND_MAX)
  params.patches = Math.min(scene.patches.length, PATCH_MAX)
  params.lights = Math.min(scene.lights.length, LIGHT_MAX)
  params.intensity = scene.dim
  params.lens = R
  params.sun = scene.sun
  params.deepen = 0.8
  params.shade = [0, 0]
  params.ink = 0
  params.lightVary = [scene.lightVary, 1.3, 0.9]
  params.overlap = 0.65
  params.extinction = 0
  params.spill = [0.12, 1.2]
  params.sky = [scene.skyLift, scene.skyFall, 0.5]
  params.skyVeil = scene.skyVeil
  params.skyVeilEnd = scene.skyVeilEnd
  params.skyDrift = scene.skyDrift
  params.skyTint = scene.skyTint
  const far = scene.farSky
  params.farSky = far ? [...hexToLinear(far.hex), far.amount] : [0, 0, 0, 0]
  params.farSpan = far ? [far.full, far.gone] : [0, 0.1]
  const fore = scene.foreWater
  params.water = [fore.line, fore.squeeze, fore.smear, fore.reflect]
  params.waterLook = [0, 0, 0.008, fore.ripple]
  params.waterAxis = fore.axis
  return { colors, params, lens: { bloom: 0, halation: 0 }, output: { grain: 0, exposure: 0 } }
}
