import { linearToOklch } from '../../color/oklab'
import { PACKS, type ColorPack } from '../../color/packs'
import { hexToLinear } from '../../color/srgb'
import type { LensSettings, OutputSettings, ParamValue } from '../../scene'
import { closeHues, isLightColor, isWarm, needsBridge } from './bands-light'
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

/** Hue gap in degrees between two colors with real chroma; 0 when either is near grey. */
function hueGap(a: string, b: string): number {
  const [, ca, ha] = oklch(a)
  const [, cb, hb] = oklch(b)
  if (ca < 0.06 || cb < 0.06) return 0
  const d = Math.abs(ha - hb) % 360
  return d > 180 ? 360 - d : d
}

/** The image's one light from two candidates in pack order: the first two times in three (Yellow, Lime), the second one in three (Orange-red, Tan). */
const pickLight = (pool: readonly string[], rnd: Random) => (pool.length > 1 && rnd.chance(1 / 3) ? pool[1] : pool[0])

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
 * dirty seam). The sky above the first band counts too. Where a band is too
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
    if (bands.length > 0 && Math.min(...xs.map((x) => at(0, x))) < (2 * R) / frameH) {
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
 * color added again at the bottom may go, by the seed or when the bands don't
 * fit a wide lens. The lowest boundary comes from the shared horizon: open
 * (the last band runs off the frame) or a ridge or bank of land.
 * Dark masses have outlines, sharp in the scene and softer in some stretches;
 * lighter colors fade into each other as light, and where two colors far apart
 * meet, pale light added across the transition keeps its middle pale.
 */
function stack(pack: ColorPack, seed: number, R: number, level: number, horizon: number, aspect: number, frameW: number, frameH: number): Scene {
  // Bands are laid out for at least the middle Softness's lens, so a sharper lens changes only the blur, not
  // which colors show or how tall their bands are.
  const RL = Math.max(R, lerp(0.045, 0.12, 0.5))
  const warmHex = (hex: string) => isWarm(hexToLinear(hex)) || isLightColor(hexToLinear(hex))
  const rnd = random(seed * 6151 + pack.id.length * 17 + 3)
  const place = placeHorizon(horizon, seed, aspect)
  const [sky, ...rest] = pack.colors.map((c) => c.hex)

  // One warm color and one light per image, from the seed alone: Horizon moves the line, never the colors.
  const drops = random(seed * 3571 + pack.id.length * 13 + 11)
  const warms = rest.filter((hex) => isWarm(hexToLinear(hex)))
  const warm = warms.length > 1 ? pickLight(warms, rnd) : warms[0]
  let picked = rest.filter((hex) => !isWarm(hexToLinear(hex)) || hex === warm)
  const lights = picked.filter((hex) => isLightColor(hexToLinear(hex)))
  if (lights.length > 1) {
    const keep = pickLight(lights, rnd)
    picked = picked.filter((hex) => !isLightColor(hexToLinear(hex)) || hex === keep)
  }
  // The image's light: its warm or light color, else the brightest after the sky (Ice).
  const light = picked.find((hex) => isLightColor(hexToLinear(hex))) ?? picked.reduce((a, b) => (lightness(b) > lightness(a) ? b : a), picked[0])
  const entries: Entry[] = [{ hex: sky, under: 1 }, ...picked.map((hex) => ({ hex, under: 1 }))]
  const shown = (e: Entry) => lightness(e.hex) * Math.cbrt(e.under)
  const dark = (e: Entry) => shown(e) < 0.45
  // A pack with no dark color (Bold) ends with a color again under less light: Meta Blue, or Orange-red itself,
  // since Meta Blue right below Orange-red meets it through the lens as magenta. Orange-red keeps most of its
  // light: much dimmer it reads as brick.
  if (!entries.some(dark)) {
    const red = hue(light) < 60
    entries.push({ hex: red ? light : sky, under: red ? 0.68 : 0.5 })
  }

  // Only a second dark color or the color added again may go, and never when its going brings two far-apart
  // hues together.
  const droppable = () =>
    entries
      .map((_, i) => i)
      .filter((i) => {
        const e = entries[i]
        if (i === 0 || !(e.under < 1 || (dark(e) && entries.filter(dark).length > 1))) return false
        return !(i + 1 < entries.length && hueGap(entries[i - 1].hex, entries[i + 1].hex) > 120)
      })
  if (drops.chance(0.45)) {
    const d = droppable()
    if (d.length) entries.splice(d[drops.int(0, d.length - 1)], 1)
  }

  // The lowest boundary: where the shared horizon puts water or land in the frame, the last (dark) band is land, a
  // ridge or bank from the line down. (Water is left out: mirrored, a stack reads as stripes, and the mirrored
  // bridges go pink.)
  let below: 'open' | 'land' = place.y < 1 && place.below !== 'open' && dark(entries[entries.length - 1]) ? 'land' : 'open'
  const floorOf = (list: Entry[], i: number) => {
    const e = list[i]
    const darker = i > 0 && i + 1 < list.length && shown(e) < Math.min(shown(list[i - 1]), shown(list[i + 1])) - 0.1
    // The sky leads: it keeps the most room of the end bands, a little less above land.
    return ((i === 0 ? (below === 'open' ? 2.8 : 2.4) : i === list.length - 1 ? 2.3 : darker ? 3.5 : 2.5) * RL) / frameH
  }
  const room = () => (below === 'open' ? 1 : place.y)
  const fits = () => {
    const stackFloors = (below === 'land' ? entries.slice(0, -1) : entries).reduce((s, _, i, l) => s + floorOf(l, i), 0)
    const lowFloor = below === 'open' ? 0 : (2.2 * RL) / frameH
    return stackFloors <= 0.97 * room() && 1 - room() >= lowFloor
  }
  // When the bands don't fit (a wide lens), land goes first, then the color added again, then a second dark
  // color: the pack's colors stay.
  while (!fits()) {
    if (below !== 'open') {
      below = 'open'
      continue
    }
    const added = entries.findIndex((e) => e.under < 1)
    const d = added >= 0 ? [added] : droppable()
    if (!d.length || entries.length <= 3) break
    entries.splice(d[drops.int(0, d.length - 1)], 1)
  }
  if (below !== 'open' && !dark(entries[entries.length - 1])) below = 'open'

  // Heights: unequal, each over its floor. With an open bottom, Horizon moves weight from the top bands to the
  // bottom ones; with land the line itself moves.
  const list = entries
  const stacked = below === 'land' ? list.slice(0, -1) : list
  const n = stacked.length
  const floors = stacked.map((_, i) => floorOf(stacked, i))
  // Ice is close to white, so its band stays smaller: never a wide white band. A color repeated under less light
  // at the bottom stays smaller too, so it doesn't read as a second, muddier color.
  const weights = stacked.map((e) => rnd.between(0.45, 1.9) * (lightness(e.hex) > 0.95 ? 0.35 : 1) * (e.under < 1 ? 0.55 : 1))
  const tip = below === 'open' ? lerp(0.7, 1.4, horizon) : 1
  const ws = weights.map((w, i) => w * tip ** (n > 1 ? (i - (n - 1) / 2) / ((n - 1) / 2) : 0))
  // When even the pack's own colors don't fit their floors (a wide lens on a wide frame), all of them shrink
  // together rather than one going.
  const floorSum = floors.reduce((s, v) => s + v, 0)
  const extra = Math.max(0, room() - floorSum)
  const squeeze = Math.min(1, room() / floorSum)
  const spans = floors.map((f, i) => f * squeeze + (extra * ws[i]) / ws.reduce((s, v) => s + v, 0))

  const bands: Band[] = []
  const under: number[] = []
  let at = 0
  list.forEach((e, i) => {
    const top = below === 'land' && i === list.length - 1 ? place.y : at
    at += spans[i] ?? 0
    if (i === 0) return
    const upper = list[i - 1]
    const isDark = dark(e)
    const outline = isDark || dark(upper)
    // A warm color through the lens into a dark one goes olive, khaki or brown: keep that edge sharp so only the
    // lens softens it.
    const warmOnDark = outline && (warmHex(upper.hex) || warmHex(e.hex))
    const bridge = !outline && needsBridge(hexToLinear(upper.hex), hexToLinear(e.hex))
    const lobes: Bump[] = []
    let tilt = (rnd.between(-0.05, 0.05) * frameW) / frameH
    let wave = (0.016 * rnd.between(0.7, 1.3)) / frameH
    if (below === 'land' && i === list.length - 1) {
      // Land: one ridge rising toward one side, or a low bank, tilted up to the shared horizon's tilt.
      const rise = (Math.tan((Math.abs(place.tilt) * Math.PI) / 180) * frameW) / frameH
      const side = rnd.sign()
      if (rnd.chance(0.5)) {
        tilt = -side * rise
        lobes.push([side > 0 ? rnd.between(0.7, 1.05) : rnd.between(-0.05, 0.3), rnd.between(0.45, 0.8) / frameW, -rnd.between(0.03, 0.06) / frameH])
      } else {
        tilt = -side * Math.min(rise, (0.03 * frameW) / frameH)
        lobes.push([rnd.between(0.2, 0.8), rnd.between(0.5, 0.9) / frameW, (rnd.sign() * rnd.between(0.01, 0.02)) / frameH])
      }
      wave *= 0.6
    } else {
      // Broad, low lobes (from a few lens radii up to the frame width), so no edge reads as a hill, a tree line
      // or a cloud.
      for (let k = rnd.int(1, 2); k > 0; k--) {
        lobes.push([rnd.between(0.05, 0.95), Math.max(3 * R, rnd.between(0.45, 0.9)) / frameW, (rnd.sign() * rnd.between(0.015, 0.035)) / frameH])
      }
    }
    const darker = i + 1 < list.length && shown(e) < Math.min(shown(upper), shown(list[i + 1])) - 0.1
    bands.push({
      color: e.hex,
      edge: { base: top, tilt, bumps: lobes, wave, wavelength: 1.5, row: 2 * bands.length },
      mode: outline ? MODE_COVER : MODE_LIGHT,
      fade: ((warmOnDark ? rnd.between(0.05, 0.1) : outline ? rnd.between(0.3, 0.8) : bridge ? rnd.between(1.2, 1.8) : rnd.between(1.2, 2.6)) * R) / frameH,
      fadeVary: warmOnDark ? 0.5 : outline ? 0.9 : 0.35,
      light: 1,
      lean: rnd.between(-0.15, 0.15),
      bridge: bridge ? 1 : 0,
      vary: 1,
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
  // A dark mass: the darkest band swells into the band above on one side, broadly.
  const darkest = bands.reduce((m, b, i) => (lightness(b.color) < lightness(bands[m].color) ? i : m), 0)
  if (darkest !== landBand && lightness(bands[darkest].color) < 0.45 && rnd.chance(0.6)) {
    const b = bands[darkest]
    const side = rnd.chance(0.5) ? rnd.between(0.0, 0.25) : rnd.between(0.75, 1.0)
    const swell: Bump = [side, rnd.between(0.45, 0.8) / frameW, -rnd.between(0.025, 0.045) / frameH]
    b.edge = { ...b.edge, bumps: [...b.edge.bumps, swell].slice(0, BUMP_MAX) }
  }
  keepThick(bands, RL, frameW, frameH, edgeSeed(seed))

  // Light: the image's light rises most with Intensity; deep bands are a color under less light; a cool band next
  // to one of similar lightness gets less light, so neighbours contrast. A warm color dimmed reads olive, khaki
  // or brown: below the middle of Intensity it keeps its light, and so does a dark band next to it, whose seam
  // with it the lens would widen; the other bands and the upper sky dim instead. Next to a dark band, where the
  // lens dims a warm color further, its light changes half as much.
  const darkAt = (j: number) => j >= 0 && j < bands.length && lightness(bands[j].color) * Math.cbrt(under[j]) < 0.45
  const warmAt = (j: number) => j >= 0 && j < bands.length && warmHex(bands[j].color)
  bands.forEach((b, i) => {
    const near = [i === 0 ? sky : bands[i - 1].color, bands[i + 1]?.color].filter((c): c is string => !!c)
    const similar = near.some((o) => Math.abs(lightness(o) - lightness(b.color)) < 0.1)
    const isLight = b.color === light && under[i] === 1
    const warmLight = warmAt(i)
    const holds = warmLight || (darkAt(i) && (warmAt(i - 1) || warmAt(i + 1)))
    const base = under[i] < 1 ? under[i] : similar && !isWarm(hexToLinear(b.color)) ? 0.75 : 1
    const gain = level ** (level >= 1 ? (isLight ? 1.6 : 0.8) : holds ? 0 : 0.8)
    b.light = base * gain * iceCap(b.color, level)
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
      shape: [rnd.between(0.1, 0.9), lerp(top, bottom, rnd.between(0.3, 0.7)), (rnd.between(2.5, 5) * RL) / frameW, (rnd.between(0.9, 1.4) * RL) / frameH],
      look: [1, rnd.between(0.08, 0.18) * level ** 0.8, MODE_ADD],
    })
  }

  return { sky, bands, lights: lightTerms, patches, sun: [0.5, 0.5], lightVary: rnd.between(0.1, 0.17), skyFall: 4.5 * Math.max(0, 1 - level) }
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
    params[key('Sun')] = [0, 0]
    params[key('Vary')] = b.vary
    params[key('BumpAt')] = pad(bumps.map((x) => x[0]), 0.5)
    params[key('BumpWidth')] = pad(bumps.map((x) => x[1]), 0)
    params[key('BumpTop')] = pad(bumps.map((x) => x[2]), 0)
    params[key('BumpBottom')] = pad([], 0)
    params[key('BumpCover')] = pad([], 0)
    params[key('BumpLight')] = pad([], 0)
    params[key('Bridge')] = b.bridge
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
  params.intensity = 1
  params.lens = R
  params.sun = scene.sun
  params.deepen = 0.8
  params.shade = [0, 0]
  params.ink = 0
  params.lightVary = [scene.lightVary, 0.6, 0.5]
  params.overlap = 0.65
  params.extinction = 0
  params.spill = [0.12, 1.2]
  params.sky = [0, scene.skyFall, 0.5]
  params.water = [2, 1.25, 0.3, 0.4]
  params.waterLook = [0.5, 0, 0.008, 0.05]
  return { colors, params, lens: { bloom: 0, halation: 0 }, output: { grain: 0, exposure: 0 } }
}
