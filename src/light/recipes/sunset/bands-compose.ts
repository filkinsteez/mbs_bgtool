import { linearToOklch } from '../../color/oklab'
import { PACKS, type ColorPack } from '../../color/packs'
import { hexToLinear } from '../../color/srgb'
import type { LensSettings, OutputSettings, ParamValue } from '../../scene'
import { closeHues, dimDrift, isLightColor, isWarm, needsBridge } from './bands-light'
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
}

export interface BandsComposition {
  colors: string[]
  params: Record<string, ParamValue>
  lens: Partial<LensSettings>
  output: Partial<OutputSettings>
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

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

const oklch = (hex: string) => linearToOklch(hexToLinear(hex))
const lightness = (hex: string) => oklch(hex)[0]
const hue = (hex: string) => oklch(hex)[2]
const oklab = (hex: string) => {
  const [L, C, h] = oklch(hex)
  return [L, C * Math.cos((h * Math.PI) / 180), C * Math.sin((h * Math.PI) / 180)]
}

/** The order of a run's choices, by pack, frame shape and run (see `stack`). */
const runOrders = new Map<string, number[]>()

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
 * it holds.
 */
function keepThick(bands: Band[], R: number, frameW: number, frameH: number, seed: number) {
  const xs = Array.from({ length: 96 }, (_, k) => (k + 0.5) / 96)
  const scales = bands.map(() => 1)
  const at = (i: number, x: number) => {
    const e = bands[i].edge
    const s = scales[i]
    return edgeAt({ ...e, tilt: e.tilt * s, bumps: e.bumps.map(([bx, bw, sh]) => [bx, bw, sh * s] as Bump), wave: e.wave * s }, x, frameW, seed)
  }
  for (let it = 0; it < 16; it++) {
    let ok = true
    if (bands.length > 0 && Math.min(...xs.map((x) => at(0, x))) < R / frameH + 0.05) {
      ok = false
      scales[0] *= 0.8
    }
    for (let i = 0; i < bands.length; i++) {
      const need = (bands[i].floor * R) / frameH
      const bottom = (x: number) => (i + 1 < bands.length ? at(i + 1, x) : 1 + need)
      const thinnest = Math.min(...xs.map((x) => bottom(x) - at(i, x)))
      if (thinnest >= need) continue
      ok = false
      scales[i] *= 0.8
      if (i + 1 < bands.length) scales[i + 1] *= 0.8
    }
    if (ok) break
  }
  bands.forEach((b, i) => {
    const s = scales[i]
    b.edge = { ...b.edge, tilt: b.edge.tilt * s, bumps: b.edge.bumps.map(([bx, bw, sh]) => [bx, bw, sh * s] as Bump), wave: b.edge.wave * s }
  })
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
  const horizon = input.horizon ?? 0.5
  const aspect = clamp(input.aspect, 0.25, 4)
  const seed = Math.round(input.seed)
  const frameW = Math.max(aspect, 1)
  const frameH = Math.max(1 / aspect, 1)
  // Softness is the lens radius, short-side units.
  const R = lerp(0.045, 0.12, clamp(softness, 0, 1))
  // Intensity is the scene's light level: the light rises most, the other bands less.
  const level = 2 ** ((clamp(intensity, 0, 1) - 0.5) * 1.2)
  return writeScene(stack(pack, seed, R, level, clamp(horizon, 0, 1), aspect, frameW, frameH), R)
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
}

/** A color of the stack: its hex and the share of nominal light it gets (a deep band is the same color under less light). */
interface Entry {
  hex: string
  under: number
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
function stack(pack: ColorPack, seed: number, R: number, level: number, horizon: number, aspect: number, frameW: number, frameH: number): Scene {
  // The middle Softness's lens, which the seed's layout is made for.
  const R0 = lerp(0.045, 0.12, 0.5)
  const warmHex = (hex: string) => isWarm(hexToLinear(hex)) || isLightColor(hexToLinear(hex))
  const rnd = random(seed * 6151 + pack.id.length * 17 + 3)
  const place = placeHorizon(0.5, seed, aspect)
  const [sky, ...rest] = pack.colors.map((c) => c.hex)

  const lights = rest.filter((hex) => isLightColor(hexToLinear(hex)))
  const darks = rest.filter((hex) => lightness(hex) < 0.45)
  // A frame's colors: one light (if the pack has one) and the pack's other colors; two dark colors show one, the
  // other or both. A pack with no dark color (Bold) may end with a color again under less light: Meta Blue, or
  // Orange-red itself, since Meta Blue right below Orange-red meets it through the lens as magenta. Orange-red
  // keeps most of its light: much dimmer it reads as brick.
  const build = (chosenLight: string | undefined, chosenDarks: readonly string[], base: boolean): Entry[] => {
    const picked = rest.filter((hex) => (lights.includes(hex) ? hex === chosenLight : darks.includes(hex) ? chosenDarks.includes(hex) : true))
    const list: Entry[] = [{ hex: sky, under: 1 }, ...picked.map((hex) => ({ hex, under: 1 }))]
    if (base && chosenLight) list.push(hue(chosenLight) < 60 ? { hex: chosenLight, under: 0.68 } : { hex: sky, under: 0.5 })
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
  // Shares of the spare height: the wide bands take most of it. Ice stays smaller, never a wide white band, and so
  // does a color repeated under less light at the bottom, so it doesn't read as a second, muddier color.
  const shareOf = (e: Entry, i: number, wide: readonly number[], draw: (lo: number, hi: number) => number) =>
    (wide.includes(i) ? (wide.length > 1 ? draw(2.5, 3.5) : draw(3.5, 5)) : draw(0.15, 0.6) * (e.under < 1 ? 0.6 : 1)) * (lightness(e.hex) > 0.95 ? 0.5 : 1)

  // The seed's choices: the colors, one or two wide bands (near-white Ice only half as wide), and whether the sky
  // darkens toward the top. Every combination is listed, the second light (Orange-red, Tan) in about a third of
  // them.
  type Choice = { light: string | undefined; darks: readonly string[]; base: boolean; wide: readonly number[]; zenith: number }
  const choices: Choice[] = []
  for (const [li, l] of (lights.length ? lights : [undefined]).entries()) {
    for (const d of darks.length > 1 ? [[darks[0]], [darks[1]], darks] : [darks]) {
      for (const base of darks.length ? [false] : [true, false]) {
        const can = build(l, d, base).map((_, i) => i)
        const wides = [...can.map((i) => [i]), ...can.flatMap((i, k) => can.slice(k + 1).map((j) => [i, j]))]
        wides.forEach((wide, k) => {
          if (li > 0 && k % 2 === 1) return
          for (const zenith of [0, 1.1]) choices.push({ light: l, darks: d, base, wide, zenith })
        })
      }
    }
  }
  // Each run of seeds as long as the list takes every choice once: from a seeded first one, each next choice is
  // the one whose look is farthest from the last seven, so any eight seeds in a row look different.
  const n0 = seed - 1
  const run = Math.floor(n0 / choices.length)
  const key = `${pack.id}|${aspect.toFixed(4)}|${run}`
  let order = runOrders.get(key)
  if (!order) {
    // A choice's look: its colors down the frame at the middle of each share, sampled at 16 heights in Oklab.
    const look = (c: Choice) => {
      const list = build(c.light, c.darks, c.base)
      const least = leastOf(list, R0)
      const shares = list.map((e, i) => shareOf(e, i, c.wide, (lo, hi) => (lo + hi) / 2))
      const spare = Math.max(0, 1 - least.reduce((s, v) => s + v, 0))
      const total = shares.reduce((s, v) => s + v, 0)
      const ends = least.map((v, i) => v + (spare * shares[i]) / total).map((_, i, h) => h.slice(0, i + 1).reduce((s, v) => s + v, 0))
      return Array.from({ length: 16 }, (_, k) => {
        const y = (k + 0.5) / 16
        const at = ends.findIndex((end) => y < end)
        const e = list[at < 0 ? list.length - 1 : at]
        const i = at < 0 ? list.length - 1 : at
        const sky = i === 0 ? 2 ** (-c.zenith * Math.max(0, 0.5 - y)) : 1
        return oklab(e.hex).map((v) => v * Math.cbrt((i === 0 ? 1 : baseLight(list, i) * iceCap(e.hex, 1)) * sky))
      })
    }
    const looks = choices.map(look)
    const apart = (a: number, b: number) => looks[a].reduce((s, p, k) => s + Math.hypot(p[0] - looks[b][k][0], p[1] - looks[b][k][1], p[2] - looks[b][k][2]), 0)
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
  const choice = choices[order[((n0 % choices.length) + choices.length) % choices.length]]
  const entries = build(choice.light, choice.darks, choice.base)
  const wideEntries = choice.wide.map((i) => entries[i])
  // The image's light: its warm or light color, else the brightest after the sky (Ice).
  const light = choice.light ?? entries.slice(1).reduce((a, b) => (lightness(b.hex) > lightness(a.hex) ? b : a)).hex

  // The lowest boundary: where the seed's horizon has water or land in the frame, the last (dark) band is land, a
  // ridge or bank from the line down. (Water is left out: mirrored, a stack reads as stripes, and the mirrored
  // bridges go pink.)
  let below: 'open' | 'land' = place.y < 1 && place.below !== 'open' && dark(entries[entries.length - 1]) ? 'land' : 'open'
  const leastAt = (r: number) => leastOf(entries, r)
  const fits = () => leastAt(R0).reduce((s, v) => s + v, 0) <= 0.97
  // When the bands don't fit, the color added again goes first, then a second dark color: the pack's colors stay.
  while (!fits()) {
    const added = entries.findIndex((e) => e.under < 1)
    const darkAt = entries.map((e, i) => (dark(e) ? i : -1)).filter((i) => i >= 0)
    const drop = added >= 0 ? added : darkAt.length > 1 ? darkAt[darkAt.length - 1] : -1
    if (drop < 0 || entries.length <= 3) break
    entries.splice(drop, 1)
  }
  if (below !== 'open' && !dark(entries[entries.length - 1])) below = 'open'

  // The seed's heights, land included: the wide bands take most of the spare height, so the light sits low, in the
  // middle or high, and the others stay near their least heights. When even the least heights don't fit, all
  // bands shrink together.
  const list = entries
  const n = list.length
  const kept = wideEntries.map((e) => list.indexOf(e)).filter((i) => i >= 0)
  const wide = kept.length ? kept : [n - 1]
  const weights = list.map((e, i) => shareOf(e, i, wide, (lo, hi) => rnd.between(lo, hi)))
  const l0 = leastAt(R0)
  const leastSum = l0.reduce((s, v) => s + v, 0)
  const extra = Math.max(0, 1 - leastSum)
  const squeeze = Math.min(1, 1 / leastSum)
  const weightSum = weights.reduce((s, v) => s + v, 0)
  const spans = weights.map((w, i) => l0[i] * squeeze + (extra * w) / weightSum)
  // The whole stack leans one way or the other, every edge curves more or less, and every other seed's sky
  // darkens toward the top.
  const stackTilt = (rnd.between(-0.06, 0.06) * frameW) / frameH
  const curve = rnd.between(0.8, 1.8)
  const zenith = choice.zenith
  // Each band's top edge in the seed's layout: the sky's is the frame's top, and the last band's is the lowest
  // boundary.
  const tops = list.map((_, i) => spans.slice(0, i).reduce((s, v) => s + v, 0))

  const bands: Band[] = []
  const under: number[] = []
  list.forEach((e, i) => {
    if (i === 0) return
    const upper = list[i - 1]
    const isDark = dark(e)
    const outline = isDark || dark(upper)
    // A warm color through the lens into a dark one goes olive, khaki or brown: keep that edge sharp so only the
    // lens softens it.
    const warmOnDark = outline && (warmHex(upper.hex) || warmHex(e.hex))
    const bridge = !outline && needsBridge(hexToLinear(upper.hex), hexToLinear(e.hex))
    // Every band draws the same random numbers, land or not, so no other edge depends on whether there is land.
    let tilt = stackTilt + (rnd.between(-0.05, 0.05) * frameW) / frameH
    let wave = (0.016 * curve * rnd.between(0.7, 1.3)) / frameH
    const side = rnd.sign()
    const ridge = rnd.chance(0.5)
    const count = rnd.int(1, 2)
    const draws = [0, 1].map(() => [rnd.next(), rnd.next(), rnd.sign(), rnd.next()] as const)
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
      // Broad, low lobes (from a few lens radii up to the frame width), so no edge reads as a hill, a tree line
      // or a cloud.
      for (const [at, width, sign, shift] of draws.slice(0, count)) {
        lobes.push([lerp(0.05, 0.95, at), Math.max(3 * R0, lerp(0.45, 0.9, width)) / frameW, (sign * curve * lerp(0.015, 0.035, shift)) / frameH])
      }
    }
    const darker = i + 1 < list.length && shown(e) < Math.min(shown(upper), shown(list[i + 1])) - 0.1
    bands.push({
      color: e.hex,
      edge: { base: tops[i], tilt, bumps: lobes, wave, wavelength: 1.5, row: 2 * bands.length },
      mode: outline ? MODE_COVER : MODE_LIGHT,
      fade: ((warmOnDark ? rnd.between(0.05, 0.1) : outline ? rnd.between(0.3, 0.8) : bridge ? rnd.between(1.2, 1.8) : rnd.between(1.2, 2.6)) * R) / frameH,
      fadeVary: warmOnDark ? 0.5 : outline ? 0.9 : 0.35,
      light: 1,
      lean: rnd.between(-0.15, 0.15),
      bridge: bridge ? 1 : 0,
      vary: 1,
      sun: 0,
      drift: dimDrift(hexToLinear(e.hex)),
      floor: darker ? 3.2 : 2,
    })
    under.push(e.under)
  })
  const landBand = below === 'land' ? bands.length - 1 : -1
  // A dome: a band lighter than the one above rises into it.
  const domes = bands.map((_, i) => i).filter((i) => i !== landBand && lightness(bands[i].color) > lightness(i === 0 ? sky : bands[i - 1].color) + 0.05)
  if (domes.length && rnd.chance(0.75)) {
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
  keepThick(bands, R0, frameW, frameH, edgeSeed(seed))

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
  let edgeTop = 0
  bands.forEach((b, k) => {
    edgeTop += now[k]
    const s = Math.min(1, now[k] / was[k], now[k + 1] / was[k + 1])
    b.edge = { ...b.edge, base: edgeTop, tilt: b.edge.tilt * s, bumps: b.edge.bumps.map(([bx, bw, sh]) => [bx, bw, sh * s] as Bump), wave: b.edge.wave * s }
  })

  // Light: the image's light rises most with Intensity, and above the middle the extra light gathers around the
  // light's column, so white shows only near the light, never as a flat band across the frame. Below the middle
  // the whole scene dims (`dim`), warm bands half as much in stops (much dimmer, and mixed with their neighbours
  // through the lens, they read khaki and mauve), and each band's color deepens as it dims: warm ones toward amber
  // or deep red, a lime toward deep green (`drift`). Next to a dark band, where the lens dims a warm color
  // further, its light changes half as much.
  const dim = Math.min(1, level) ** 1.6
  const darkAt = (j: number) => j >= 0 && j < bands.length && lightness(bands[j].color) * Math.cbrt(under[j]) < 0.45
  const warmAt = (j: number) => j >= 0 && j < bands.length && warmHex(bands[j].color)
  bands.forEach((b, i) => {
    const isLight = b.color === light && under[i] === 1
    const warmLight = warmAt(i)
    const lift = level >= 1 ? level ** (isLight ? 1.6 : 0.8) : 1
    b.light = baseLight(list, i + 1) * lift * (warmLight ? dim ** -0.5 : 1) * iceCap(b.color, level)
    b.sun = 1 - 1 / lift
    if (warmLight && (darkAt(i - 1) || darkAt(i + 1))) b.vary = 0.5
  })

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
    const from = rnd.chance(0.5) && bi + 1 < bands.length ? bands[bi + 1].color : bi > 0 ? bands[bi - 1].color : sky
    if (!closeHues(hexToLinear(from), hexToLinear(bands[bi].color))) continue
    const top = bands[bi].edge.base
    const bottom = bi + 1 < bands.length ? bands[bi + 1].edge.base : 1
    patches.push({
      color: from,
      shape: [rnd.between(0.1, 0.9), lerp(top, bottom, rnd.between(0.3, 0.7)), (rnd.between(2.5, 5) * R0) / frameW, (rnd.between(0.9, 1.4) * R0) / frameH],
      look: [1, rnd.between(0.08, 0.18) * level ** 0.8, MODE_ADD],
    })
  }

  const lightVary = rnd.between(0.1, 0.17)
  // The light's column: where Intensity above the middle gathers its extra light.
  const sun: [number, number] = [rnd.between(0.2, 0.8), rnd.between(0.22, 0.35)]
  return { sky, bands, lights: lightTerms, patches, sun, lightVary, skyFall: zenith + 3 * Math.max(0, 1 - level), skyLift: 1.2 * Math.max(0, level - 1), dim }
}

/** Ice is close to white: below white at the default Intensity. */
function iceCap(hex: string, level: number): number {
  return lightness(hex) > 0.95 ? Math.min(1, 0.58 / level ** 0.4) : 1
}

function writeScene(scene: Scene, R: number): BandsComposition {
  const params: Record<string, ParamValue> = {}
  const colors = [scene.sky]
  scene.bands.slice(0, BAND_MAX).forEach((b, i) => {
    const key = (name: Parameters<typeof bandKey>[1]) => bandKey(i, name)
    colors.push(b.color)
    const bumps = b.edge.bumps.slice(0, BUMP_MAX)
    const pad = (values: number[], fill: number) => Array.from({ length: BUMP_MAX }, (_, j) => values[j] ?? fill)
    params[key('Edges')] = [b.edge.base, 2]
    params[key('Fade')] = [b.fade, 0]
    params[key('FadeVary')] = b.fadeVary
    params[key('Opacity')] = 1
    params[key('Light')] = b.light
    params[key('Mode')] = b.mode
    params[key('Line')] = false
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
  params.lightVary = [scene.lightVary, 0.6, 0.5]
  params.overlap = 0.65
  params.extinction = 0
  params.spill = [0.12, 1.2]
  params.sky = [scene.skyLift, scene.skyFall, 0.5]
  params.water = [2, 1.25, 0.3, 0.4]
  params.waterLook = [0.5, 0, 0.008, 0.05]
  return { colors, params, lens: { bloom: 0, halation: 0 }, output: { grain: 0, exposure: 0 } }
}
