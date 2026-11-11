import { linearToOklch } from '../../color/oklab'
import type { FieldWant, StagePart } from '../../color/stageFields'
import type { ColorPack } from '../../color/packs'
import { defaultMix, mixColors } from '../../color/mix'
import { hexToLinear, type Rgb } from '../../color/srgb'
import type { ComposeInput, Composition, ControlValues, ParamSpec, RecipeContext, RecipeDefinition, UniformMap } from '../../scene'
import { bridgeLight } from './bands-light'

/**
 * Sunrise as one look (hidden; the tool shows it with `sunrise=merged`). The seed picks one of four kinds of sky, in
 * turn (`SKY_KINDS`): a low sun on the horizon; a light high in the frame with the sky graded round it; a sky lit from
 * one side; a plain sky gradient with no horizon in sight. Each is a lightness field with a stretch at each pack
 * color's own lightness:
 * - Meta Blue's sky, a wide gradient: palest (0.66-0.72) where the pale sky ends, full in the middle, deeper (0.40-0.44)
 *   far from the light, slanted against the horizon, with a soft lit patch of its own in most seeds;
 * - dim room for the dark colors (0.22-0.33, lit, never black) where light falls off: lit hills under most low suns,
 *   the far corner of an open low sky, the far corners round a high light, the far side of a side-lit sky, a soft dim
 *   band under a plain sky; elsewhere a small, light deep top (0.34-0.40);
 * - a pale sky over the glow (0.76-0.84), tallest over the light, a dome round it in some seeds and a band in others;
 * - a warm band on the horizon near the light, or a warm halo round a high light (0.6-0.7);
 * - the glow: a dome over the light, wider than tall, near white (0.92 and up); a plain sky has none.
 * Every part's lightness changes across it; there are no flat areas, and no two boundaries follow the same curve.
 * Each kind takes a dragged line its own way: a low sun's horizon runs along it with the sun where it starts; a high
 * light sits a third of the way along it; a side light's side and height come from where it starts; a plain sky's
 * gradient tilts with it and its horizon moves to the line's middle.
 *
 * The layout comes from the seed, the dragged line and the frame's aspect only, never the colors. `fillRoles` gives
 * each part a color from the colors that are on, for when the color stage is off; with it on, the stage colors the
 * look's lightness-only render (`lightnessOnlyParams`) from its parts (`mergedParts`).
 */

const NO_LIGHT = '#000000'

// ---------------------------------------------------------------------------------------------------------- layout

interface Layout {
  frameW: number
  frameH: number
  /** The kind of sky (`SKY_KINDS`). */
  kind: number
  /** The light, from the frame center in short sides, y down. */
  sun: [number, number]
  /** Unit vector from the horizon toward the far sky. */
  up: [number, number]
  /** Short sides from the horizon to the top of the sky (around a high light: from the glow to the farthest corner). */
  span: number
  /** Around a high light: how much narrower the rings are along the horizon than up. */
  squash: number
  ground: boolean
  /** The ground or dim band: lightness by the horizon and deep down, how deep it dims (short sides), edge softness. */
  groundL: [number, number, number, number]
  /** Horizon above the light, its bow (per short side squared), tilt, and drift (short sides). */
  horizon: [number, number, number, number]
  horizonWave: [number, number]
  /** The glow over the light: half-width along the horizon, height (short sides), lightness at its middle, strength (0: none). */
  dome: [number, number, number, number]
  /** The pale lower sky: reach along the horizon (short sides), height over the light (share of the span), lightness, how much its edge's softness changes. */
  pale: [number, number, number, number]
  /** Share of the pale sky's height kept far along the horizon (0: a dome over the light; 1: a band). */
  paleBase: number
  /** The warm band on the horizon: reach along it from the light, thickness (short sides), lightness. */
  warm: [number, number, number]
  /** Meta Blue's sky: lightness by the pale sky, in the middle, far from the light; the deep top's lightness. */
  sky: [number, number, number, number]
  /** Where the deep sky starts (share of the span), how soft its edge is, how much lower it comes far from the light. */
  deep: [number, number, number]
  /** How the sky's gradient and the pale sky's edge slant against the horizon (per short side). */
  slant: [number, number]
  /** How much farther the light reaches on one side of the light than on the other (-0.5..0.5). */
  skew: number
  /** Meta Blue's own lit patch: place along the horizon (short sides from the light), height (share of the span), size (short sides), strength (0: none). */
  patch: [number, number, number, number]
  /** Round a high light: the way the pale sky spreads from the light (unit, across and up from it) and how much farther it reaches that way. */
  spread: [number, number, number]
  /** Round a high light: the warm glow's place beside the light (short sides, across and up from it, across scaled by `squash`), size, strength. */
  halo: [number, number, number, number]
  /** The frame's corner where the dim far sky gathers (-0.5 or 0.5 each way from the middle), from the seed's own light. */
  farCorner: number[]
}

/** A seeded generator in [0, 1). */
function random(seed: number): () => number {
  let t = (Math.imul((Math.round(seed) | 0) ^ 0x2c1b3c6d, 0x9e3779b1) ^ 0x6a09e667) >>> 0
  return () => {
    t = (t + 0x6d2b79f5) >>> 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
const smoothstepJs = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

/** Lean past `most` is eased toward it, so a steep line still turns the sky a little and never in a step. */
function limitLean(lean: number, most: number): number {
  if (most >= Math.PI) return lean
  const s = Math.sign(lean)
  const x = Math.abs(lean)
  return s * (x <= 0.6 * most ? x : 0.6 * most + 0.4 * most * Math.tanh((x - 0.6 * most) / (0.4 * most)))
}

/** The kinds of sky in the one look; the seed picks one. */
export const SKY_KINDS = ['low sun', 'high light', 'side light', 'plain'] as const

export function mergedLayout(seed: number, aspect: number, drag?: ControlValues['drag']): Layout {
  const next = random(seed * 7919 + 17)
  const frameW = Math.max(aspect, 1)
  const frameH = Math.max(1 / aspect, 1)
  const toP = (u: number, v: number): [number, number] => [(u - 0.5) * frameW, (v - 0.5) * frameH]
  // The kinds of sky take turns as the seed rises (seed 1 is a low sun), so any run of seeds shows all of them. Every
  // seed draws the same values in the same order; its kind then places them.
  const kind = (((Math.round(seed) - 1) % SKY_KINDS.length) + SKY_KINDS.length) % SKY_KINDS.length
  const groundDraw = next()
  const rise = next()
  const zoneOfSun = Math.floor(next() * 3)
  const across = [lerp(0.06, 0.3, next()), lerp(0.36, 0.64, next()), lerp(0.7, 0.94, next())][zoneOfSun]
  const height = next()
  const off = lerp(0.0, 0.06, next())
  const tiltDraw = next() - 0.5
  const side = next() < 0.5 ? -1 : 1
  const horizon: [number, number, number, number] = [off, (next() - 0.6) * 0.3, (next() - 0.5) * 0.3, lerp(0.01, 0.04, next())]
  const horizonWave: [number, number] = [lerp(0.7, 1.6, next()), Math.floor(next() * 90000) + 11]
  // The glow: a dome over the light, wider than tall, from a small sun to a wide one.
  const domeDraw = next()
  const dome: [number, number, number, number] = [lerp(0.14, 0.5, domeDraw), 0, lerp(0.92, 0.97, next()), 1]
  dome[1] = dome[0] * lerp(0.35, 0.65, next())
  // The pale sky: from a fifth to over half the sky over the light, reaching a little or far along the horizon; a
  // dome of pale light around the sun in some seeds, a band along the whole horizon in others.
  const pale: [number, number, number, number] = [lerp(0.4, 1.6, next()), lerp(0.22, 0.55, next()), lerp(0.76, 0.84, next()), next()]
  let paleBase = next() < 0.45 ? 0 : lerp(0.3, 0.7, next())
  // The warm band: an accent near the glow, not the width of the sky.
  const warm: [number, number, number] = [lerp(0.25, 0.7, next()), lerp(0.03, 0.09, next()), lerp(0.6, 0.7, next())]
  // Meta Blue's sky: paler toward the pale sky and the glow, full in the middle, deeper away from the light; then a
  // small, light deep top far from the light.
  const sky: [number, number, number, number] = [lerp(0.66, 0.72, next()), lerp(0.53, 0.57, next()), lerp(0.4, 0.44, next()), 0]
  const deepDraw = next()
  const deep: [number, number, number] = [0, lerp(0.1, 0.2, next()), 0]
  const dimDraw = next()
  // The sky's gradient and the pale sky's edge each slant their own way against the horizon.
  const slant: [number, number] = [(next() - 0.5) * 1.4, (next() - 0.5) * 1.2]
  const skew = (next() - 0.5) * 1.0
  // Meta Blue's own light, in most seeds: a soft lit patch away from the sun, as pale as Meta Blue gets near the glow.
  const patchOn = next() < 0.85
  const patchSide = next() < 0.5 ? -1 : 1
  const patch: [number, number, number, number] = [patchSide * lerp(0.3, 1.2, next()), lerp(0.45, 0.8, next()), lerp(0.25, 0.6, next()), patchOn ? lerp(0.8, 1.0, next()) : 0]
  const leanDraw = next()
  const squash = lerp(0.6, 1.0, next())
  // Dim room for the dark colors, at or a little below their own lightness (Plum and Near-black about 0.27, Forest
  // 0.33, Slate 0.39; above it the stage pales them), lit and never black, where light falls off: lit hills under most
  // low suns, the far corner of an open low sky, the far corners round a high light, the far side of a side-lit sky,
  // the dim band under a plain sky's warm light. Where a kind has no dim room the deep top stays small and light.
  const groundL: [number, number, number, number] = [lerp(0.29, 0.33, dimDraw), lerp(0.22, 0.25, next()), lerp(0.12, 0.3, next()), 0]
  // Round a high light: the way the pale sky spreads from the light (in the light's frame: across, up), anywhere from
  // nearly straight down through sideways to up and sideways, and how much farther it reaches that way; the warm glow
  // runs to one side of the light, turned up to about 40 degrees from square, on the side away from Meta Blue's patch.
  const spreadTurn = (next() < 0.5 ? -1 : 1) * lerp(0.2, 2.4, next())
  const spread: [number, number, number] = [Math.sin(spreadTurn), -Math.cos(spreadTurn), lerp(1.3, 3.0, next())]
  const haloAcross = -patchSide * lerp(0.12, 0.2, next())
  const haloAlong = lerp(-0.14, 0.04, next())
  const halo: [number, number, number, number] = [
    spread[0] * haloAlong - spread[1] * haloAcross,
    spread[1] * haloAlong + spread[0] * haloAcross,
    lerp(0.14, 0.28, next()),
    lerp(0.85, 1, next()),
  ]
  const farDim = () => {
    deep[0] = lerp(0.58, 0.72, deepDraw)
    deep[2] = lerp(0.1, 0.25, dimDraw)
    sky[3] = lerp(0.24, 0.3, dimDraw)
  }
  const smallTop = () => {
    deep[0] = lerp(0.75, 0.9, deepDraw)
    sky[3] = lerp(0.34, 0.4, dimDraw)
  }
  let ground = false
  let sun: [number, number]
  let tilt: number
  let mostLean: number
  if (kind === 0) {
    // A low sun on the horizon: lit hills over the bottom sixth to a quarter in most seeds, else an open sky with its
    // glow from the middle of the frame down to the bottom edge. An open sky tilts up to about 30 degrees either way,
    // hills about 12.
    ground = groundDraw < 0.75
    sun = toP(across, ground ? lerp(0.84, 0.72, rise) : lerp(0.6, 1.0, rise))
    // A low sun always has a clear glow round it, which a plain sky never has.
    dome[0] = lerp(0.24, 0.55, domeDraw)
    dome[1] = dome[0] * lerp(0.4, 0.7, height)
    tilt = tiltDraw * (ground ? 0.4 : 1.05)
    mostLean = lerp(0.2, 0.45, leanDraw)
    if (ground) {
      horizon[3] = lerp(0.03, 0.07, height)
      groundL[3] = lerp(0.006, 0.012, height)
      smallTop()
    } else farDim()
  } else if (kind === 1) {
    // A light high in the frame: no glow of its own; the pale sky spreads one way from it, brightest at the light, a
    // warm glow sits off to one side, and Meta Blue deepens away from it.
    sun = toP(lerp(0.2, 0.8, (across - 0.06) / 0.88), lerp(0.22, 0.55, height))
    tilt = tiltDraw * 1.2
    mostLean = 1.2
    horizon[0] = 0
    dome[3] = 0
    farDim()
    deep[0] -= 0.08
  } else if (kind === 2) {
    // A sky lit from one side: the light on the left or right edge, anywhere from a top corner to a bottom corner,
    // the sky turned toward the far side and in some seeds on down past it; the seed picks the glow along the edge
    // from narrow to wide and how far the warm band reaches, so two side lights differ in shape and not only in which
    // side they are on.
    sun = toP(side > 0 ? lerp(0.97, 1.03, height) : lerp(-0.03, 0.03, height), lerp(0.08, 0.92, rise))
    tilt = -side * lerp(1.15, 2.2, tiltDraw + 0.5)
    mostLean = 1.7
    dome[0] = lerp(0.12, 0.7, domeDraw)
    dome[1] = dome[0] * lerp(0.3, 0.8, height)
    warm[0] = lerp(0.2, 1.1, (warm[0] - 0.25) / 0.45)
    farDim()
  } else {
    // A plain sky gradient with no light in sight: no glow, the pale light low across the width and the warm light
    // low near where the light would be, over a soft dim band along the bottom. It leans less than a low sun's ground,
    // and under a line its ground sits lower, so the two kinds differ in shape. The horizon bows and waves, the warm
    // band's top and the pale sky's edge each rise and fall their own way, so no two boundaries run parallel.
    sun = toP(lerp(0.2, 0.8, (across - 0.06) / 0.88), lerp(0.74, 0.86, height))
    tilt = tiltDraw * 0.15
    mostLean = 0.2
    ground = true
    groundL[3] = lerp(0.05, 0.1, rise)
    horizon[3] = lerp(0.03, 0.06, dimDraw)
    dome[3] = 0
    paleBase = lerp(0.35, 0.7, height)
    pale[0] = lerp(1.0, 2.0, rise)
    pale[1] = lerp(0.3, 0.5, rise)
    warm[0] = lerp(0.6, 1.2, tiltDraw + 0.5)
    warm[1] = lerp(0.08, 0.16, height)
    slant[1] *= 1.5
    smallTop()
  }
  sun = [sun[0], sun[1] + horizon[0]]
  let up: [number, number] = [Math.sin(tilt), -Math.cos(tilt)]
  const farthest = (s: readonly number[], u: readonly number[]) => Math.max(...[-0.5, 0.5].flatMap((x) => [-0.5, 0.5].map((y) => (x * frameW - s[0]) * u[0] + (y * frameH - s[1]) * u[1])))
  let span = Math.max(0.3, farthest(sun, up) - horizon[0])
  const ownSpan = span
  // The frame's corner where the dim far sky gathers, chosen from the seed's own light (round a high light, the
  // farthest corner; otherwise the one farthest up the sky and to the side), so a line never moves it to another
  // corner.
  const ownGlow = [sun[0] + up[0] * horizon[0], sun[1] + up[1] * horizon[0]]
  const farOf = ([u, v]: readonly number[]) => {
    const d = [u * frameW - ownGlow[0], v * frameH - ownGlow[1]]
    return kind === 1 ? Math.hypot(d[0], d[1]) : d[0] * up[0] + d[1] * up[1] + deep[2] * Math.abs(-d[0] * up[1] + d[1] * up[0])
  }
  const farCorner = [-0.5, 0.5].flatMap((u) => [-0.5, 0.5].map((v) => [u, v])).reduce((best, c) => (farOf(c) > farOf(best) ? c : best))
  if (drag) {
    const f = toP(drag.from[0], drag.from[1])
    const t = toP(drag.to[0], drag.to[1])
    const len = Math.hypot(t[0] - f[0], t[1] - f[1])
    const dir = len > 1e-6 ? [(t[0] - f[0]) / len, (t[1] - f[1]) / len] : [0, -1]
    const mid = [(f[0] + t[0]) / 2, (f[1] + t[1]) / 2]
    // Held inside a range, easing into its ends, so nothing stops in a step.
    const hold = (x: number, lo: number, hi: number) => (lo + hi) / 2 + ((hi - lo) / 2) * limitLean((x - (lo + hi) / 2) / ((hi - lo) / 2), 1)
    const atV = (v: number) => (v - 0.5) * frameH
    // A longer line spreads the light farther, easing in and out of its limits.
    let reach = 0.8 + 0.9 * smoothstepJs(0.3, 2.2, len)
    if (kind === 0 || kind === 3) {
      // A low sun: the line is the horizon, leaning with it up to the seed's limit and coming level as the line turns
      // upright, at the height of the line's middle; the sun sits on it where the line starts, inside the frame.
      // A plain sky: the line tilts the gradient, leaning with it as above and back to level as it turns to point down,
      // and its horizon moves to the height of the line's middle, low in the frame; no light in sight.
      let lean: number
      if (kind === 0) {
        const angle = Math.atan2(dir[1], dir[0])
        const fold = angle > Math.PI / 2 ? angle - Math.PI : angle <= -Math.PI / 2 ? angle + Math.PI : angle
        lean = limitLean(fold, mostLean) * (1 - smoothstepJs(0.3 * Math.PI, 0.5 * Math.PI, Math.abs(fold)))
      } else {
        const raw = Math.atan2(dir[0], -dir[1])
        lean = limitLean(raw, mostLean) * (1 - smoothstepJs(0.55 * Math.PI, Math.PI, Math.abs(raw)))
      }
      up = [Math.sin(lean), -Math.cos(lean)]
      const along = [-up[1], up[0]]
      // A plain sky's ground stays lower and flatter than a low sun's, so the two differ in shape under a line too.
      const base = [mid[0], kind === 3 ? hold(mid[1], atV(0.76), atV(0.94)) : ground ? hold(mid[1], atV(0.62), atV(0.9)) : hold(mid[1], atV(0.5), atV(1.0))]
      const s = kind === 0 ? (f[0] - base[0]) * along[0] + (f[1] - base[1]) * along[1] : 0
      const room = (0.44 * frameW) / Math.max(along[0], 0.3)
      const onLine = hold(s + base[0] / Math.max(along[0], 0.3), -room, room) - base[0] / Math.max(along[0], 0.3)
      sun = [base[0] + along[0] * onLine - up[0] * horizon[0], base[1] + along[1] * onLine - up[1] * horizon[0]]
    } else if (kind === 1) {
      // A high light sits partway along the line and the sky leans with it; when that point is outside the frame the
      // glow comes up toward the sky until it reaches the frame's edge, stopping a little past the nearest corner's
      // height where the way only grazes the frame, so the height never jumps as the line turns.
      const raw = Math.atan2(dir[0], -dir[1])
      const lean = limitLean(raw, mostLean) * (1 - smoothstepJs(0.55 * Math.PI, Math.PI, Math.abs(raw)))
      up = [Math.sin(lean), -Math.cos(lean)]
      sun = [f[0] + 0.35 * (t[0] - f[0]), f[1] + 0.35 * (t[1] - f[1])]
      const half = [frameW / 2, frameH / 2]
      const entry = (i: 0 | 1) => {
        if (Math.abs(sun[i]) <= half[i]) return 0
        const k = (Math.sign(sun[i]) * half[i] - sun[i]) / up[i]
        return k > 0 ? k : Infinity
      }
      const corners = [-0.5, 0.5].flatMap((u) => [-0.5, 0.5].map((v) => (u * frameW - sun[0]) * up[0] + (v * frameH - sun[1]) * up[1]))
      horizon[0] = Math.max(0, Math.min(Math.max(entry(0), entry(1)), Math.min(...corners) + 0.3))
      const outward = (t[0] - f[0]) * up[0] + (t[1] - f[1]) * up[1] - horizon[0]
      const lineSpan = 0.5 * (outward + 0.3 + Math.sqrt((outward - 0.3) ** 2 + 0.01))
      reach = 0.7 + 1.5 * smoothstepJs(0.4, 2.5, lineSpan / ownSpan)
    } else {
      // A side light: where the line starts picks the side (the light slides across as the start crosses the middle,
      // the sky turning through straight up) and how high the light sits.
      const toRight = smoothstepJs(0.3, 0.7, drag.from[0])
      const lean = lerp(1.3, -1.3, toRight)
      up = [Math.sin(lean), -Math.cos(lean)]
      sun = toP(lerp(-0.03, 1.03, toRight), hold(drag.from[1], 0.15, 0.85))
    }
    dome[0] *= reach
    dome[1] *= reach
    pale[0] *= reach
    warm[0] *= reach
    halo[0] *= Math.min(reach, 1.2)
    halo[1] *= Math.min(reach, 1.2)
    patch[0] *= reach
    patch[2] *= reach
  }
  // The sky's height runs from the horizon to the frame's farthest corner (around a high light, from the glow to the
  // farthest corner), so the deep top is always in the frame and far from the light.
  const glow = [sun[0] + up[0] * horizon[0], sun[1] + up[1] * horizon[0]]
  span =
    kind === 1
      ? Math.max(0.3, ...[-0.5, 0.5].flatMap((x) => [-0.5, 0.5].map((y) => Math.hypot(x * frameW - glow[0], y * frameH - glow[1]))))
      : Math.max(0.3, farthest(sun, up) - horizon[0])
  if (kind === 1) {
    // The warm glow stays in the frame: its middle eases in before the frame's edge, wherever a line puts the light.
    const sideWay = [-up[1], up[0]]
    const reachOf = (x: number, half: number) => half * limitLean(x / half, 1)
    const placed = [0, 1].map((i) => glow[i] + sideWay[i] * (halo[0] / squash) + up[i] * halo[1])
    const kept = [reachOf(placed[0], frameW / 2 - 0.1) - glow[0], reachOf(placed[1], frameH / 2 - 0.1) - glow[1]]
    halo[0] = (kept[0] * sideWay[0] + kept[1] * sideWay[1]) * squash
    halo[1] = kept[0] * up[0] + kept[1] * up[1]
  }
  return { frameW, frameH, kind, sun, up, span, squash, ground, groundL, horizon, horizonWave, dome, pale, paleBase, warm, sky, deep, slant, skew, patch, spread, halo, farCorner }
}

// ---------------------------------------------------------------------------------------------------------- colors

interface Roles {
  lowest: [number, number, number, number]
  sky: string
  glow: string
  warm: string
  pale: string
  bank: string
  near: string
  deep: string
}

/**
 * For when the color stage is off: a color for each part, from the list of colors that are on. The sky takes the
 * deepest saturated blue (Meta Blue; else Cyan; else a cool grey); the glow the lightest warm or near-white color; the
 * warm band a deeper warm color (else a grey); the pale sky a light cool color (else the lightest pale color); the
 * ground and the deep top the dark colors (else the sky's own, dimmed). It never reads a pack id; the layout never
 * reads it.
 */
export function fillRoles(colors: readonly { hex: string }[], colorSeed: number): Roles {
  const next = random(colorSeed * 104729 + 7)
  const cs = colors.map(({ hex }) => {
    const [L, C, h] = linearToOklch(hexToLinear(hex))
    return { hex, L, C, h }
  })
  type Entry = (typeof cs)[number]
  const isGlow = (x: Entry) => (x.C >= 0.04 && x.h >= 20 && x.h <= 135 && x.L >= 0.5) || (x.L > 0.9 && x.C < 0.03)
  const darks = cs.filter((x) => x.L < 0.45).sort((p, q) => q.L - p.L)
  if (darks.length > 1 && next() < 0.5) darks.reverse()
  const lights = cs.filter((x) => x.L >= 0.45)
  const blues = lights.filter((x) => !isGlow(x) && x.C >= 0.08 && x.h >= 200 && x.h <= 290).sort((p, q) => p.L - q.L)
  const greys = lights.filter((x) => !isGlow(x)).sort((p, q) => p.L - q.L)
  const glows = lights.filter(isGlow).sort((p, q) => q.L - p.L)
  const sky = blues[0] ?? greys[0] ?? glows[glows.length - 1] ?? cs[0]
  const glowing = glows.filter((x) => x !== sky)
  const glow = glowing[0] ?? sky
  const warm = glowing.find((x) => x.L < 0.8 && x.C >= 0.06) ?? greys.find((x) => x !== sky) ?? glow
  const pale =
    lights.filter((x) => x !== sky && x.L >= 0.7 && x.C >= 0.05 && x.h >= 150 && x.h <= 260).sort((p, q) => q.L - p.L)[0] ??
    lights.filter((x) => x !== sky && x.L >= 0.85).sort((p, q) => q.L - p.L)[0] ??
    sky
  // How far below its own light each part's color may go: light that only reads as itself when bright (Yellow, Lime,
  // Ice) stays near its level; the others (Meta Blue, Cyan, Orange-red, Tan, the greys) follow the design down.
  const lowest = (x: Entry) => ((isGlow(x) && x.L > 0.75) || (x.L > 0.9 && x.C < 0.03) ? 0.85 : 0.25)
  return {
    lowest: [lowest(sky), lowest(glow), lowest(warm), Math.min(lowest(pale), 0.5)],
    sky: sky.hex,
    glow: glow.hex,
    warm: warm.hex,
    pale: pale.hex,
    bank: darks[0]?.hex ?? sky.hex,
    near: darks[1]?.hex ?? darks[0]?.hex ?? sky.hex,
    deep: darks[1]?.hex ?? darks[0]?.hex ?? sky.hex,
  }
}

// ---------------------------------------------------------------------------------------------------------- compose

export interface MergedInput extends ComposeInput {
  /** One share per pack color in pack order; only which colors are on is used here (the stage sets the shares). */
  mix?: readonly number[]
}

export function composeMerged({ pack, controls, seed, aspect, mix }: MergedInput): Composition {
  const L = mergedLayout(seed, aspect, controls.drag)
  const on = mixColors(pack, { shares: mix ?? defaultMix(pack).shares }).map((entry) => ({ hex: entry.color.hex }))
  const roles = fillRoles(on, seed)
  return {
    colors: [roles.sky, roles.glow, roles.warm, roles.pale, roles.bank, roles.near, roles.deep, NO_LIGHT],
    params: {
      lens: lerp(0.045, 0.12, clamp(controls.softness, 0, 1)),
      level: 2 ** ((clamp(controls.intensity, 0, 1) - 0.5) * 1.2),
      kind: L.kind,
      sun: L.sun.map((v) => clamp(v, -6, 6)),
      up: L.up,
      span: clamp(L.span, 0.1, 20),
      squash: L.squash,
      ground: L.ground,
      groundL: L.groundL,
      horizon: L.horizon,
      horizonWave: L.horizonWave,
      dome: L.dome,
      pale: L.pale,
      paleBase: L.paleBase,
      warm: L.warm,
      sky: L.sky,
      deep: L.deep,
      slant: L.slant,
      skew: L.skew,
      patch: L.patch,
      spread: L.spread,
      halo: L.halo,
      farCorner: L.farCorner,
      lowest: roles.lowest,
    },
    lens: { bloom: 0, halation: 0 },
    output: { grain: 0, exposure: 0 },
  }
}

// ---------------------------------------------------------------------------------------------------------- parts

/**
 * The look's parts for the shared color stage, from its params and the frame's aspect (frame units, x from the left,
 * y from the top; sizes in short sides; `angle` in degrees from the frame's x axis):
 * - horizon: the glow (for a plain sky, the light below the frame) and the way from it to the deep sky (short-side
 *   units, as the stage measures height);
 * - Meta Blue's own lit patch, in the seeds that have one (want `any`: the lead color's own light, not an accent);
 * - a bright spot: the glow over the light (Yellow, white), at the glow's strength; a plain sky and a high light have
 *   none;
 * - two warm spots: the warm band on the horizon near the light (round a high light, the warm glow to one side of
 *   it) and its wider, dimmer outer glow, so Yellow has the core and Orange-red the outside (Tan in Elemental);
 * - a cool spot: the pale sky over the glow, or the pale sky spreading one way from a high light (Cyan, Ice, or the
 *   pale end of the sky);
 * - two dark spots for the dim room, one per dark color: its lit side (Forest, Slate) and its shadow side (Plum,
 *   Near-black), on the lit hills or a plain sky's dim band, or on the way to the sky's corner farthest from the light.
 * Every frame of a seed has the same parts in the same order; they move and resize smoothly as a line moves.
 * The rest is the sky's: Meta Blue paler toward the pale sky and the glow, full in the middle, deeper far from the
 * light. The stage colors the look's lightness-only render (`lightnessOnlyParams`).
 */
export function mergedParts(params: Record<string, unknown>, aspect: number): StagePart[] {
  const frameW = Math.max(aspect, 1)
  const frameH = Math.max(1 / aspect, 1)
  const toFrame = (p: readonly number[]): [number, number] => [p[0] / frameW + 0.5, p[1] / frameH + 0.5]
  const ringed = Math.round(params.kind as number) === 1
  const squash = (params.squash as number) || 1
  const sun = params.sun as number[]
  const up = params.up as number[]
  const side = [-up[1], up[0]]
  const span = params.span as number
  const [off] = params.horizon as number[]
  const [domeWidth, domeHeight, , domeOn] = params.dome as number[]
  const [paleReach, paleHeight] = params.pale as number[]
  const paleBase = params.paleBase as number
  const [warmReach, warmThickness] = params.warm as number[]
  const [patchAlong, patchHeight, patchSize, patchOn] = params.patch as number[]
  const slant = (params.slant as number[])[0]
  const angle = (Math.atan2(side[1], side[0]) * 180) / Math.PI
  const skyLength = Math.hypot(up[0], up[1]) || 1
  const glowAt = [sun[0] + up[0] * off, sun[1] + up[1] * off]
  const at = (along: number, height: number) => [glowAt[0] + side[0] * along + up[0] * height, glowAt[1] + side[1] * along + up[1] * height]
  const paleTop = Math.max(0.04, paleHeight * span)
  const parts: StagePart[] = [{ kind: 'horizon', light: toFrame(glowAt), sky: [up[0] / skyLength, up[1] / skyLength] }]
  // A spot as the stage reads it: half-lengths of radius * sqrt(stretch) along `angle` and radius / sqrt(stretch)
  // across. `turn` tilts a spot off the horizon (degrees), so the parts' edges don't all run along it; a `strength`
  // under 1 makes the part's color weaker than its neighbours'.
  const spot = (center: readonly number[], along: number, across: number, want: FieldWant, turn = 0, strength = 1): StagePart => {
    const a = Math.max(along, 0.005)
    const c = Math.max(across, 0.005)
    const radius = Math.sqrt(a * c)
    const shape = { kind: 'spot' as const, at: toFrame(center), radius, stretch: a / c, angle: angle + turn, want }
    return strength < 1 ? { ...shape, strength: Math.max(0, strength) } : shape
  }
  // The turn of a way given across and up from the light: the frame's y runs down, so up is a quarter turn back.
  const turnOf = (across: number, upward: number) => (-Math.atan2(upward, across) * 180) / Math.PI
  const [, , horizonSlope] = params.horizon as number[]
  const paleSlant = (params.slant as number[])[1]
  if (patchOn > 0) {
    // Where the patch's place along the horizon and height in the sky put it (round a high light, as a distance
    // from the glow).
    const reach = patchHeight * span - slant * patchAlong
    // The constant under the root keeps the patch moving smoothly where the root nears zero.
    const patchAt = ringed ? at(patchAlong / squash, Math.sqrt(Math.max(0, reach * reach - patchAlong * patchAlong) + 0.0225)) : at(patchAlong, reach)
    parts.push(spot(patchAt, patchSize, 0.7 * patchSize, 'any'))
  }
  if (ringed) {
    // Round a high light: the warm glow off to one side with its wider, dimmer outer glow (Yellow at its core,
    // Orange-red outside), and the pale sky spreading one way from the light, the light at its brightest end. No
    // rings and no glow of its own.
    const [spreadAcross, spreadUp, spreadReach] = params.spread as number[]
    const [haloAcross, haloUp, haloSize] = params.halo as number[]
    const way = [spreadAcross / squash, spreadUp]
    const wayLength = Math.hypot(way[0], way[1]) || 1
    const wayTurn = turnOf(way[0], way[1])
    const acrossLength = Math.hypot(spreadUp / squash, spreadAcross)
    // The pale sky's brightest end, by the light and drawn out the way it spreads (Lime, Ice).
    const end = Math.min(0.3 * paleTop, 0.18)
    parts.push(spot(at(way[0] * 1.2 * end, way[1] * 1.2 * end), end * wayLength, 0.65 * end * acrossLength, 'bright', wayTurn, 0.9))
    // The warm lobe from the light to one side, one part along it: a wider warm part there met the pale sky and Meta
    // Blue over a large area, which the stage blends toward grey.
    const haloOff = Math.hypot(haloAcross, haloUp) || 1
    const lobe = [haloAcross / haloOff, haloUp / haloOff]
    const lobeReach = haloOff + 0.6 * haloSize
    const lobeWay = [lobe[0] / squash, lobe[1]]
    parts.push(spot(at(lobeWay[0] * 0.55 * lobeReach, lobeWay[1] * 0.55 * lobeReach), 0.65 * lobeReach * Math.hypot(lobeWay[0], lobeWay[1]), 0.56 * haloSize * Math.hypot(lobe[1] / squash, lobe[0]), 'warm', turnOf(lobeWay[0], lobeWay[1])))
    const ahead = paleTop * Math.max(spreadReach, 1)
    const middle = (ahead - paleTop) / 2
    parts.push(spot(at(way[0] * middle, way[1] * middle), ((ahead + paleTop) / 2) * wayLength, paleTop * acrossLength, 'cool', wayTurn))
  } else {
    // The glow over the light; the warm band as an accent by the glow, along the horizon's own slope there, with its
    // wider, dimmer outer glow (Yellow at its core, Orange-red outside), which also covers the ridge beside the light;
    // the pale sky along its own slant.
    if (domeOn > 0) parts.push(spot(glowAt, domeWidth, domeHeight, 'bright', 0, domeOn))
    parts.push(spot(at(0, warmThickness / 2), 0.5 * warmReach, warmThickness, 'warm', turnOf(1, horizonSlope)))
    parts.push(spot(at(0, 0), 1.4 * warmReach, 1.4 * warmThickness, 'warm', turnOf(1, horizonSlope), 0.8))
    parts.push(spot(at(0, paleTop / 2), paleReach + (paleBase * Math.hypot(frameW, frameH)) / 2, paleTop / 2, 'cool', turnOf(1, 0.5 * paleTop * paleSlant)))
  }
  // Two dark spots in every frame: the first on the dim room's lit side (Forest, Slate), the second on its shadow
  // side (Plum, Near-black), placed by smooth weights so they glide as a line moves.
  const corners = [-0.5, 0.5].flatMap((x) => [-0.5, 0.5].map((y) => [x * frameW, y * frameH]))
  if (params.ground) {
    // The lit hills or a plain sky's dim band: its lit side under the ridge toward the light, and beside it, at about
    // the same depth, the shadow side, weaker so the lit side keeps its color, toward the end of the frame farther
    // from the light and tilted a little against it, so the two sit side by side instead of stacking into bands. It
    // moves smoothly to the other end as the light crosses the middle. Thin where the horizon sits low, so they fade
    // instead of vanishing.
    const depth = Math.max(0, ...corners.map((c) => -((c[0] - glowAt[0]) * up[0] + (c[1] - glowAt[1]) * up[1])))
    const middle = -(glowAt[0] * side[0] + glowAt[1] * side[1])
    const width = 0.5 * (Math.abs(frameW * side[0]) + Math.abs(frameH * side[1]))
    const awaySide = Math.tanh(middle / 0.25)
    parts.push(spot(at(0, -0.35 * depth), 0.6, 0.35 * depth, 'dark', turnOf(1, horizonSlope)))
    parts.push(spot(at(middle + 0.45 * width * awaySide, -0.5 * depth), 0.8 * width, 0.5 * depth, 'dark', turnOf(1, horizonSlope) + 8 * awaySide, 0.75))
  } else {
    // The dim far sky: its lit edge on the way to the seed's far corner, then that corner; both fade as a line brings
    // the light near that corner.
    const [deepStart] = params.deep as number[]
    const [cornerU, cornerV] = params.farCorner as number[]
    const corner = [cornerU * frameW, cornerV * frameH]
    const toCorner = [corner[0] - glowAt[0], corner[1] - glowAt[1]]
    const fade = smoothstepJs(0.25, 0.55, Math.hypot(toCorner[0], toCorner[1]) / Math.max(span, 0.3))
    const edgeAt = [glowAt[0] + 0.8 * toCorner[0], glowAt[1] + 0.8 * toCorner[1]]
    const cornerTurn = (Math.atan2(toCorner[1], toCorner[0]) * 180) / Math.PI + 90 - angle
    const size = Math.max(0.15, 0.8 * (1 - deepStart) * span)
    // With the light close to the corner the way to it has no clear direction and its angle swings while the light
    // barely moves: the spots go round there instead of pointing.
    const t = Math.min(1, Math.max(0, (Math.hypot(toCorner[0], toCorner[1]) / (0.5 * Math.hypot(frameW, frameH)) - 0.1) / 0.2))
    const pointed = t * t * (3 - 2 * t)
    const shaped = (along: number, across: number) => [Math.sqrt(along * across) * (along / across) ** (pointed / 2), Math.sqrt(along * across) * (across / along) ** (pointed / 2)] as const
    const [edgeAlong, edgeAcross] = shaped(1.5 * size, 0.5 * size)
    const [cornerAlong, cornerAcross] = shaped(1.1 * size, 0.8 * size)
    parts.push(spot([0.9 * edgeAt[0], 0.9 * edgeAt[1]], edgeAlong, edgeAcross, 'dark', cornerTurn, fade))
    parts.push(spot([0.88 * corner[0], 0.88 * corner[1]], cornerAlong, cornerAcross, 'dark', cornerTurn, fade))
  }
  return parts
}

/** The params that make the look render its design lightness alone, as grey: what the color stage colors. */
export function lightnessOnlyParams<T extends Record<string, unknown>>(params: T): T & { lightnessOnly: true } {
  return { ...params, lightnessOnly: true }
}

// ---------------------------------------------------------------------------------------------------------- recipe

const vec = (key: string, label: string, def: number[], min = -20, max = 20): ParamSpec => ({ kind: 'vector', key, label, min, max, step: 1e-4, default: def })
const num = (key: string, label: string, min: number, max: number, def: number): ParamSpec => ({ kind: 'number', key, label, min, max, step: 1e-4, default: def })

const PARAMS: readonly ParamSpec[] = [
  num('lens', 'Lens radius (short sides)', 0.02, 0.2, 0.0975),
  num('level', 'Light level', 0, 4, 1),
  vec('sun', 'Light', [0, 0.7]),
  num('kind', 'Kind of sky: low sun, high light, side light, plain', 0, 3, 0),
  vec('up', 'Toward the far sky', [0, -1], -1, 1),
  num('span', 'Sky span (short sides)', 0.1, 20, 1),
  num('squash', 'Around a high light: how much narrower the rings are along the horizon', 0.2, 2, 0.8),
  { kind: 'boolean', key: 'ground', label: 'Ground', default: false },
  vec('groundL', 'Ground or dim band: lightness by the horizon, deep down, how deep it dims, edge softness', [0.35, 0.26, 0.25, 0], 0, 2),
  vec('horizon', 'Horizon above the light, bow, tilt, drift', [0.03, 0, 0, 0.02]),
  vec('horizonWave', 'Horizon drift lattice, seed', [1, 11], 0, 1e6),
  vec('dome', 'Glow: half-width along the horizon, height, lightness at its middle, strength', [0.3, 0.15, 0.95, 1], 0, 10),
  vec('pale', 'Pale lower sky: reach along the horizon, height (share of the sky), lightness, edge softness change', [1, 0.3, 0.8, 0.5], 0, 10),
  num('paleBase', 'Share of the pale sky kept far along the horizon (0: a dome over the light, 1: a band)', 0, 1, 0.5),
  vec('warm', 'Warm band: reach along the horizon, thickness, lightness', [0.8, 0.05, 0.65], 0, 10),
  vec('sky', 'Meta Blue by the pale sky, in the middle, far from the light; deep sky lightness', [0.65, 0.55, 0.46, 0.4], 0, 10),
  vec('deep', 'Deep sky start (share of the sky), edge softness, how much lower it comes far from the light', [0.75, 0.15, 0], 0, 10),
  vec('slant', 'Slant against the horizon of the sky gradient and of the pale sky edge', [0, 0], -2, 2),
  num('skew', 'Lit farther on one side of the light', -1, 1, 0),
  vec('patch', "Meta Blue's lit patch: place along the horizon, height (share of the sky), size, strength", [0.6, 0.55, 0.3, 0.8]),
  vec('spread', 'Round a high light: the way the pale sky spreads from it (across, up) and how much farther it reaches', [0, -1, 2], -10, 10),
  vec('halo', 'Round a high light: the warm glow beside it (across, up), size, strength', [0.1, 0, 0.1, 0], -10, 10),
  vec('farCorner', 'The corner where the dim far sky gathers', [0.5, -0.5], -0.5, 0.5),
  { kind: 'boolean', key: 'lightnessOnly', label: 'Show the design lightness only (grey)', default: false },
  vec('lowest', 'Lowest light of the sky, glow, warm band and pale sky colors', [0.25, 0.85, 0.25, 0.5], 0, 1),
]

function uniforms(ctx: RecipeContext): UniformMap {
  const c = (i: number) => ctx.colors[i] as Rgb
  return {
    uLevel: ctx.num('level'),
    uKind: Math.round(ctx.num('kind')),
    uSun: ctx.vec('sun'),
    uUp: ctx.vec('up'),
    uSpan: ctx.num('span'),
    uSquash: ctx.num('squash'),
    uGroundOn: ctx.bool('ground') ? 1 : 0,
    uGround: ctx.vec('groundL'),
    uHorizon: ctx.vec('horizon'),
    uHorizonWave: ctx.vec('horizonWave')[0],
    uHorizonSeed: Math.round(ctx.vec('horizonWave')[1]),
    uDome: ctx.vec('dome'),
    uPale: ctx.vec('pale'),
    uPaleBase: ctx.num('paleBase'),
    uWarm: ctx.vec('warm'),
    uSkyL: ctx.vec('sky'),
    uDeep: ctx.vec('deep'),
    uSlant: ctx.vec('slant'),
    uSkew: ctx.num('skew'),
    uPatch: ctx.vec('patch'),
    uSpread: ctx.vec('spread'),
    uHalo: ctx.vec('halo'),
    uLightnessOnly: ctx.bool('lightnessOnly') ? 1 : 0,
    uLowest: ctx.vec('lowest'),
    uSky: c(0),
    uGlowColor: c(1),
    uWarmColor: c(2),
    uPaleColor: c(3),
    uBankColor: c(4),
    uNearColor: c(5),
    uDeepColor: c(6),
    // The pale light between the warm band and the sky, and between the pale sky and the sky.
    uBridgeWarm: bridgeLight(c(2), c(0)),
    uBridgePale: bridgeLight(c(3), c(0)),
  }
}

const FRAGMENT = /* glsl */ `
uniform float uLevel;
uniform int uKind;           // 0 low sun, 1 high light, 2 side light, 3 plain gradient
uniform vec2 uSun;
uniform vec2 uUp;
uniform float uSpan;
uniform float uSquash;       // around a high light: how much narrower the rings are along the horizon than up
uniform int uGroundOn;
uniform vec4 uGround;        // ground or dim band: lightness by the horizon, deep down, how deep it dims, edge softness
uniform vec4 uHorizon;       // horizon above the light, bow, tilt, drift (short sides)
uniform float uHorizonWave;  // drift lattice (per short side)
uniform int uHorizonSeed;
uniform vec4 uDome;          // glow half-width along the horizon, height (short sides), lightness at its middle, strength
uniform vec4 uPale;          // pale lower sky reach along the horizon, height (share of the span), lightness, edge softness change
uniform float uPaleBase;     // share of the pale sky's height it keeps far along the horizon (0: a dome over the light; 1: a band)
uniform vec3 uWarm;          // warm band reach along the horizon, thickness (short sides), lightness
uniform vec4 uSkyL;          // Meta Blue by the pale sky, in the middle, far from the light; deep top lightness
uniform vec3 uDeep;          // deep sky start (share of the span), edge softness, how much lower it comes far from the light
uniform vec2 uSlant;         // slant against the horizon of the sky's gradient and of the pale sky's edge (per short side)
uniform float uSkew;         // how much farther the light reaches on one side of the light
uniform vec4 uPatch;         // Meta Blue's lit patch place along the horizon, height (share of the span), size, strength
uniform vec3 uSpread;        // round a high light: the way the pale sky spreads from it (across, up), how much farther
uniform vec4 uHalo;          // round a high light: the warm glow beside it (across, up), size, strength
float gHalo = 0.0;           // round a high light: the warm glow at this pixel
float gHaloOuter = 0.0;      // round a high light: the warm glow's wider, dimmer outer light at this pixel
float gHaloLight = 0.0;      // round a high light: the warm glow's lightness at this pixel, falling from the light
float gPatch = 0.0;          // round a high light: Meta Blue's lit patch at this pixel
float gPaleWave = 0.0;       // round a high light: how far the pale sky's edge bulges out (+) or dips in (-) here
float gPaleSoft = 0.5;       // round a high light: how soft the pale sky's edge is here (0 to 1)
float gDeepWave = 0.0;       // round a high light: how far the deep sky's edge comes in (-) or stays out (+) here
float gDeepSoft = 0.5;       // round a high light: how soft the deep sky's edge is here (0 to 1)
uniform int uLightnessOnly;  // 1: the design's lightness as grey, for proof sheets and the color stage
uniform vec4 uLowest;        // lowest light of the sky, glow, warm band and pale sky colors (share of their own)
uniform vec3 uSky;
uniform vec3 uGlowColor;
uniform vec3 uWarmColor;
uniform vec3 uPaleColor;
uniform vec3 uBankColor;
uniform vec3 uNearColor;
uniform vec3 uDeepColor;
uniform vec3 uBridgeWarm;
uniform vec3 uBridgePale;

float baseAt(float a) {
  return uHorizon.x + uHorizon.y * a * a + uHorizon.z * a + uHorizon.w * gradientNoise(vec2(a * uHorizonWave + 3.1, 7.7), uHorizonSeed);
}

// How far light reaches along the horizon from the light: 1 at the light and falling away, farther on one side.
float sideLight(float a, float reach) {
  float r = reach * (1.0 + uSkew * tanh(a / 0.3));
  return 1.0 / (1.0 + pow(abs(a) / max(r, 0.05), 1.6));
}

// The glow: a dome over the light, wider than tall; its edge wavers a little so it never reads as a drawn ellipse.
float domeAt(float a, float h) {
  float wob = 1.0 + 0.12 * gradientNoise(vec2(atan(h, a + 1e-5) * 1.3 + 2.0, 4.4), uHorizonSeed + 21);
  float x = a / (uDome.x * wob);
  float y = h / (uDome.y * wob);
  return uDome.w * exp(-(x * x + y * y));
}

// The pale lower sky: tallest over the light and lower along the horizon away from it, its edge soft in some places
// and firmer in others.
float paleTop(float a) {
  // A bell with a rounded top and curved sides, never a peak with straight sides; the slant eases into its limits
  // instead of rising in a straight line. The seed picks where the edge bulges up or dips, by how much and how wide,
  // so the pale sky's outline differs from seed to seed.
  float x = a / max(uPale.x, 0.05);
  float bell = 1.0 / (1.0 + x * x);
  float slant = exp(0.7 * tanh(uSlant.y * a / 0.7));
  float bulgeAt = 0.9 * gradientNoise(vec2(3.7, 1.1), uHorizonSeed + 91);
  float bulgeBy = 0.4 * gradientNoise(vec2(5.3, 2.9), uHorizonSeed + 93);
  float bulgeWide = 0.3 + 0.3 * (0.5 + 0.5 * gradientNoise(vec2(1.9, 7.7), uHorizonSeed + 95));
  float bulgeX = (a - bulgeAt) / bulgeWide;
  float bulge = 1.0 + bulgeBy * exp(-bulgeX * bulgeX);
  float waver = 1.0 + 0.25 * gradientNoise(vec2(a * 1.1 + 7.3, 1.9), uHorizonSeed + 23);
  // Over a low sun and in a plain sky, where the pale sky rises over the horizon; a side light and a high light keep
  // their own pale sky.
  if (uKind == 0 || uKind == 3) return 0.94 * uPale.y * uSpan * mix(bell, 1.0, uPaleBase) * slant * bulge * waver;
  return uPale.y * uSpan * mix(sideLight(a, uPale.x), 1.0, uPaleBase) * clamp(1.0 + uSlant.y * a, 0.25, 2.0) * waver;
}

float paleAt(float a, float h) {
  float top = paleTop(a);
  float softBy = 0.5 + 0.5 * gradientNoise(vec2(a * 0.9 + 3.7, 8.2), uHorizonSeed + 29);
  if (uKind == 1) {
    top *= 1.0 + 0.6 * gPaleWave;
    softBy = gPaleSoft;
  }
  float soft = top * (0.2 + 0.5 * uPale.w * softBy);
  return 1.0 - smoothstep(top - soft, top + soft, h);
}

// The warm band on the horizon: thickest near the light and thinning away from it, its thickness wavering; round a
// high light, its warm glow to one side.
float warmAt(float a, float h) {
  if (uKind == 1) return gHalo;
  float along = sideLight(a, uWarm.x);
  // The band's top drifts and its softness changes along its length, so it never runs parallel to the horizon or to
  // the ground's edge.
  float th = uWarm.y * (0.4 + 0.6 * along) * (1.0 + 0.6 * gradientNoise(vec2(a * 1.1 + 5.1, 3.3), uHorizonSeed + 31));
  float soft = 0.5 + 0.35 * gradientNoise(vec2(a * 1.2 + 8.3, 1.2), uHorizonSeed + 33);
  // Its light keeps more of its strength along the horizon past the hot middle, where it has fallen near Orange-red's
  // own lightness, so Orange-red has a broad stretch there.
  return sqrt(along) * (1.0 - smoothstep((0.8 - soft) * th, (0.8 + soft) * th, h));
}

// The warm light's outer glow: wider and dimmer than the warm band (round a high light, than its warm glow).
float warmOuterAt(float a, float h) {
  if (uKind == 1) return gHaloOuter;
  float x = a / max(1.4 * uWarm.x, 0.1);
  float y = h / max(1.4 * uWarm.y, 0.02);
  return exp(-(x * x + y * y));
}

// Height in the sky as a share of the span, slanted against the horizon and wavering, so the sky's gradient never
// runs along the horizon.
float skyHeight(float a, float h) {
  return (max(h, 0.0) + uSlant.x * a) / uSpan + 0.05 * gradientNoise(vec2(a * 0.6 + 2.1, h * 0.6 + 5.3), uHorizonSeed + 3);
}

// How far into the deep sky a place is (0 to 1); the edge drifts, changes softness along its length, and comes lower
// far from the light, so the deep sky can be a far corner rather than a band across the top.
float deepAt(float a, float t) {
  float wave = 0.08 * gradientNoise(vec2(a * 0.8 + 6.6, 2.2), uHorizonSeed + 5);
  float softBy = 0.5 + 0.5 * gradientNoise(vec2(a * 0.7 + 1.4, 9.9), uHorizonSeed + 9);
  // Round a high light the edge's waver and softness follow the place in the frame, so the edge curves instead of
  // running straight along the spread.
  if (uKind == 1) {
    wave = 0.2 * gDeepWave;
    softBy = gDeepSoft;
  }
  float edge = uDeep.x + wave - uDeep.z * (1.0 - sideLight(a, 1.0));
  float soft = uDeep.y * (0.6 + 0.8 * softBy);
  return smoothstep(edge - soft, edge + soft + 0.15, t);
}

// Meta Blue's own lit patch, away from the sun.
float patchAt(float a, float t) {
  float pa = (a - uPatch.x) / max(uPatch.z, 0.05);
  float pt = (t - uPatch.y) * uSpan / max(0.7 * uPatch.z, 0.05);
  return uPatch.w * exp(-(pa * pa + pt * pt));
}

// The design's lightness in the sky (Oklab L): Meta Blue's wide gradient (paler toward the pale sky and the glow, full
// in the middle, deeper away from the light) with its own lit patch, the small deep top, the pale sky over the glow,
// the warm band on the horizon, and the glow over the light.
float skyLightness(float a, float h) {
  float t = skyHeight(a, h);
  // From the pale sky's edge (Meta Blue at its palest) up to where the deep top starts; round a high light, from a
  // fixed distance, so no waver across the frame draws bands in Meta Blue's light.
  float edge = uKind == 1 ? 0.15 : paleTop(a) / uSpan;
  float u = clamp((t - edge) / max(uDeep.x - edge, 0.1), 0.0, 1.0);
  float L = u < 0.5 ? mix(uSkyL.x, uSkyL.y, smoothstep(0.0, 0.5, u)) : mix(uSkyL.y, uSkyL.z, smoothstep(0.5, 1.0, u));
  L -= 0.05 * (1.0 - sideLight(a, 1.2));
  L = mix(L, uSkyL.w, deepAt(a, t));
  L = mix(L, max(L, uSkyL.x), uKind == 1 ? gPatch : patchAt(a, t));
  float pale = paleAt(a, h);
  // The pale sky and the warm band are the glow's light spreading: brightest by the glow (round a high light, at the
  // light itself), dimming with height and along the horizon away from it, with no level stretch.
  // Squares are written out: pow of a negative number is undefined in GLSL.
  float paleScale = max(0.45 * uPale.y * uSpan, 0.03);
  float paleRise = max(h, 0.0) / paleScale;
  float paleLight = uPale.z - 0.03 + 0.11 * exp(-paleRise * paleRise) + 0.05 * sideLight(a, uPale.x);
  L = mix(L, paleLight, pale);
  // The warm light's wider, dimmer outer glow only adds light where the sky is dimmer than it.
  L += max(0.0, uWarm.z - 0.03 - L) * 0.8 * warmOuterAt(a, h);
  float warmLight = uWarm.z + 0.1 * sideLight(a, max(0.15, 0.5 * uWarm.x)) - 0.05 * clamp(h / max(uWarm.y, 0.02), 0.0, 1.0);
  // Round a high light the warm lobe only adds light, running down its own slope from the light.
  L = uKind == 1 ? mix(L, max(L, gHaloLight), gHalo) : mix(L, warmLight, warmAt(a, h));
  L = mix(L, uDome.z, domeAt(a, h));
  // Below the horizon line the sky's light rises to white over a short distance.
  L = mix(L, 0.97, 1.0 - smoothstep(-0.3 * paleScale, 0.0, h));
  return min(L, 0.97);
}

// The ground, or a plain sky's dim band: dim but lit, lit most under the ridge on the side toward the light and
// falling into the dim room down the slopes and away from the light, so each color on it runs from its lit side to
// its shadow side. Under a low sun a nearer ridge, tilted against the far one, catches the light on its crest. Soft
// everywhere, with no bright rim.
float groundLightness(float a, float depth) {
  float lit = sideLight(a, 0.7);
  // How deep it dims drifts along the horizon, so the dim room's edge curves on its own.
  float fall = max(uGround.z, 0.05) * (0.65 + 0.7 * (0.5 + 0.5 * gradientNoise(vec2(a * 1.4 + 1.9, 2.8), uHorizonSeed + 65)));
  float L = mix(uGround.x + 0.03 * lit, uGround.y, smoothstep(0.0, fall, depth));
  if (uKind == 0) {
    float crest = depth - 0.4 * fall - 0.06 * uSlant.x * a - 0.03 * gradientNoise(vec2(a * 2.3 + 4.1, 6.6), uHorizonSeed + 47);
    float nearL = mix(uGround.x - 0.02 + 0.04 * lit, uGround.y, smoothstep(0.0, 0.7 * fall, crest));
    L = mix(L, nearL, smoothstep(-0.035, 0.035, crest));
  }
  return L + 0.02 * gradientNoise(vec2(a * 1.3 + 9.1, depth * 2.0 + 1.7), uHorizonSeed + 7) + 0.02 * domeAt(a, 0.0) * exp(-depth / 0.15);
}

// The color each part gives, blended like overlapping light; where two far hues meet, a pale light between them.
// The fourth value is how far below its own light the blend may go.
vec4 skyHue(float a, float h) {
  float dome = domeAt(a, h);
  float inner = smoothstep(0.35, 0.85, dome);
  float warmPart = clamp(max(smoothstep(0.3, 0.8, warmAt(a, h)), smoothstep(0.1, 0.45, dome)), 0.0, 1.0);
  vec3 warmColor = mix(uWarmColor, uGlowColor, inner);
  float pale = paleAt(a, h);
  float palePart = smoothstep(0.4, 0.8, pale) * (1.0 - warmPart);
  float skyPart = (1.0 - smoothstep(0.05, 0.4, pale)) * (1.0 - warmPart);
  float gap = max(0.0, 1.0 - warmPart - palePart - skyPart);
  vec3 col = uSky * skyPart + uPaleColor * palePart + warmColor * warmPart + mix(uBridgePale, uBridgeWarm, warmPart) * gap;
  float lowest = uLowest.x * skyPart + uLowest.w * palePart + mix(uLowest.z, uLowest.y, inner) * warmPart + 0.5 * gap;
  float d = deepAt(a, skyHeight(a, h));
  return vec4(mix(col, uDeepColor, d * d), mix(clamp(lowest, 0.2, 0.9), 0.3, d));
}

// A color shown at a lightness: scaled in linear light to that luminance. Light that only reads as itself when bright
// (Yellow, Lime, Ice) never goes far below its own level; dark colors never far above theirs; a blue brightens at most
// as far as it stays a saturated blue.
vec3 atLightness(vec3 col, float L, float lowest) {
  float own = max(luminance(col), 1e-4);
  float highest = mix(mix(1.6, 2.1, smoothstep(0.06, 0.1, own)), 3.4, smoothstep(0.18, 0.24, own));
  return col * clamp(L * L * L / own, lowest, highest);
}

vec3 auxRadiance(vec2 uv, vec2 p) {
  vec2 d = p - uSun;
  float a = dot(d, vec2(-uUp.y, uUp.x));
  float v = dot(d, uUp);
  float h = v - baseAt(a);
  if (uKind == 1) {
    // A light high in the frame: height in the sky is the distance from the light, stretched the way the pale sky
    // spreads so the light sits at its brightest end, wavering with the direction (read from the direction itself,
    // so there is no seam). The warm glow sits off to one side of the light, not round it.
    // The pale sky is a lobe ahead of the light, narrower across and short behind it; the warm glow is a second lobe
    // from the light to one side. Both are brightest at the light, where they meet in white, and run down their own
    // slopes; between them the sky is dimmer, so their colors meet at the light or across that dip.
    vec2 q = vec2(a * uSquash, v - uHorizon.x);
    float ahead = dot(q, uSpread.xy);
    vec2 e = vec2(dot(q, vec2(-uSpread.y, uSpread.x)), ahead / (ahead > 0.0 ? max(uSpread.z, 1.0) : 1.0));
    float len = length(e);
    h = len * (1.0 + 0.22 * gradientNoise(e / max(len, 1e-5) * 1.3 + vec2(5.0, 2.0), uHorizonSeed + 41));
    a = e.x;
    vec2 lobe = uHalo.xy / max(length(uHalo.xy), 1e-4);
    float lobeReach = length(uHalo.xy) + 0.6 * uHalo.z;
    float along = dot(q, lobe);
    float wob = 1.0 + 0.2 * gradientNoise(q * 2.0 + vec2(1.3, 6.1), uHorizonSeed + 43);
    float width = 0.7 * uHalo.z * (0.6 + 0.4 * clamp(along / max(lobeReach, 0.05), 0.0, 1.5)) * wob;
    float across = dot(q, vec2(-lobe.y, lobe.x)) / max(width, 0.02);
    float lobeOut = max(along, 0.0) / (1.4 * lobeReach);
    float lobeFall = max(along, 0.0) / max(lobeReach, 0.05);
    gHalo = uHalo.w * exp(-across * across) * smoothstep(-0.06, 0.02, along) * exp(-lobeOut * lobeOut);
    gHaloLight = 0.62 + 0.31 * exp(-lobeFall * lobeFall);
    // Meta Blue's lit patch as a soft blob placed in the frame where the color stage's patch part is, its outline
    // wavering with position. Placed by distance from the light it would stretch into a straight band along the
    // spread far from the light.
    float patchReach = uPatch.y * uSpan - uSlant.x * uPatch.x;
    vec2 patchCenter = vec2(uPatch.x, sqrt(max(0.0, patchReach * patchReach - uPatch.x * uPatch.x) + 0.0225));
    vec2 patchOff = q - patchCenter + 0.3 * uPatch.z * vec2(gradientNoise(q * 1.3 + vec2(2.1, 8.4), uHorizonSeed + 81), gradientNoise(q * 1.3 + vec2(6.7, 3.2), uHorizonSeed + 83));
    vec2 patchScaled = vec2(patchOff.x / max(1.35 * uPatch.z * uSquash, 0.05), patchOff.y / max(0.95 * uPatch.z, 0.05));
    gPatch = uPatch.w * exp(-dot(patchScaled, patchScaled));
    // The pale sky's edge bulges, dips and changes softness with the place in the frame. Read from the distance and
    // the direction alone, its sides run straight along the spread where the frame cuts through the long lobe.
    gPaleWave = 0.75 * gradientNoise(q * 1.2 + vec2(4.2, 0.7), uHorizonSeed + 85) + 0.45 * gradientNoise(q * 2.3 + vec2(1.6, 9.4), uHorizonSeed + 99);
    gPaleSoft = 0.5 + 0.5 * gradientNoise(q * 1.1 + vec2(9.1, 5.5), uHorizonSeed + 87);
    gDeepWave = 0.75 * gradientNoise(q * 1.2 + vec2(2.6, 6.3), uHorizonSeed + 89) + 0.45 * gradientNoise(q * 2.3 + vec2(5.8, 0.3), uHorizonSeed + 101);
    gDeepSoft = 0.5 + 0.5 * gradientNoise(q * 1.1 + vec2(7.4, 1.8), uHorizonSeed + 97);
  }
  // The ground's edge drifts off the horizon line and its softness changes along its length.
  float edgeSoft = uGround.w * (0.4 + 1.2 * (0.5 + 0.5 * gradientNoise(vec2(a * 1.3 + 3.9, 8.8), uHorizonSeed + 69)));
  float edgeOff = 1.2 * uGround.w * gradientNoise(vec2(a * 1.6 + 6.2, 1.4), uHorizonSeed + 71);
  float edge = smoothstep(-0.5 * uPixel - edgeSoft, 0.5 * uPixel + edgeSoft, h - edgeOff);
  if (uLightnessOnly == 1) {
    float L = skyLightness(a, h);
    if (uGroundOn == 1) L = mix(groundLightness(a, -h), L, edge);
    return vec3(L * L * L) * uLevel;
  }
  vec4 hue = skyHue(a, h);
  vec3 col = atLightness(hue.rgb, skyLightness(a, h), hue.a);
  if (uGroundOn == 1) {
    vec3 ground = atLightness(mix(uBankColor, uNearColor, smoothstep(0.03, 0.15, -h)), groundLightness(a, -h), 0.05);
    col = mix(ground, col, edge);
  }
  return col * uLevel;
}

vec3 radiance(vec2 uv, vec2 p) { return vec3(0.0); }

vec3 combine(vec2 uv, vec2 p, vec3 radiance, vec3 lensed) { return lensed; }
`

const SLOTS = [
  { key: 'sky', label: 'Sky' },
  { key: 'glow', label: 'Glow' },
  { key: 'warm', label: 'Warm band' },
  { key: 'pale', label: 'Pale sky' },
  { key: 'bank', label: 'Ground' },
  { key: 'near', label: 'Near ground' },
  { key: 'deep', label: 'Deep top' },
  { key: 'spare', label: 'Unused' },
]

export const sunsetMerged: RecipeDefinition = {
  id: 'sunset.merged',
  mood: 'sunset',
  label: 'Sunrise',
  colorSlots: SLOTS,
  defaultColors: ['#0064E0', '#FFD61E', '#FF4F00', '#1FCDF0', '#0064E0', '#0064E0', '#0064E0', NO_LIGHT],
  params: PARAMS,
  fragment: FRAGMENT,
  uniforms,
  scatter: [{ source: 'aux', shape: 'lens', radius: (ctx) => ctx.num('lens'), size: () => 8 }],
  radianceScale: 0.5,
  fromPack: (pack: ColorPack) => composeMerged({ pack, controls: { intensity: 0.5, softness: 0.7, mood: 0.5 }, seed: 1, aspect: 16 / 9 }).colors,
  compose: (input) => composeMerged(input),
}
