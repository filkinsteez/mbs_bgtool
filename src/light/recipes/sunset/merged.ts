import { linearToOklch } from '../../color/oklab'
import type { StagePart } from '../../color/stageFields'
import type { ColorPack } from '../../color/packs'
import { defaultMix, mixColors } from '../../color/mix'
import { hexToLinear, type Rgb } from '../../color/srgb'
import type { ComposeInput, Composition, ControlValues, ParamSpec, RecipeContext, RecipeDefinition, UniformMap } from '../../scene'
import { bridgeLight } from './bands-light'
import { gradientNoise } from './boundary'

/**
 * Sunrise as one look (hidden; the tool shows it with `sunrise=merged`). The seed picks one of four kinds of sky, in
 * turn (`SKY_KINDS`): a low sun on the horizon; a light high in the frame with the sky graded round it; a sky lit from
 * one side; a plain sky gradient with no horizon in sight. Each is a lightness field with a stretch at each pack
 * color's own lightness:
 * - Meta Blue's sky, a wide gradient: palest (0.66-0.72) where the pale sky ends, full in the middle, deeper (0.40-0.44)
 *   far from the light, slanted against the horizon, with a soft lit patch of its own in most seeds;
 * - a small, light deep top (0.34-0.40) far from the light, its edge drifting and changing softness along its length;
 * - a pale sky over the glow (0.76-0.84), tallest over the light, a dome round it in some seeds and a band in others;
 * - a warm band on the horizon near the light, or a warm halo round a high light (0.6-0.7);
 * - the glow: a dome over the light, wider than tall, near white (0.92 and up); a plain sky has none;
 * - a dim ground under some low suns, lit by the glow near the light.
 * Every part's lightness changes across it; there are no flat areas, and no two boundaries follow the same curve.
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
  /** Where the deep top starts (share of the span), and how soft its edge is. */
  deep: [number, number]
  /** How the sky's gradient and the pale sky's edge slant against the horizon (per short side). */
  slant: [number, number]
  /** How much farther the light reaches on one side of the light than on the other (-0.5..0.5). */
  skew: number
  /** Meta Blue's own lit patch: place along the horizon (short sides from the light), height (share of the span), size (short sides), strength (0: none). */
  patch: [number, number, number, number]
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
  const warm: [number, number, number] = [lerp(0.35, 1.3, next()), lerp(0.03, 0.09, next()), lerp(0.6, 0.7, next())]
  // Meta Blue's sky: paler toward the pale sky and the glow, full in the middle, deeper away from the light; then a
  // small, light deep top far from the light.
  const sky: [number, number, number, number] = [lerp(0.66, 0.72, next()), lerp(0.53, 0.57, next()), lerp(0.4, 0.44, next()), lerp(0.34, 0.4, next())]
  const deep: [number, number] = [lerp(0.55, 0.85, next()), lerp(0.1, 0.2, next())]
  // The sky's gradient and the pale sky's edge each slant their own way against the horizon.
  const slant: [number, number] = [(next() - 0.5) * 1.4, (next() - 0.5) * 1.2]
  const skew = (next() - 0.5) * 1.0
  // Meta Blue's own light, in most seeds: a soft lit patch away from the sun, as pale as Meta Blue gets near the glow.
  const patchOn = next() < 0.85
  const patchSide = next() < 0.5 ? -1 : 1
  const patch: [number, number, number, number] = [patchSide * lerp(0.3, 1.2, next()), lerp(0.45, 0.8, next()), lerp(0.25, 0.6, next()), patchOn ? lerp(0.8, 1.0, next()) : 0]
  const leanDraw = next()
  const groundUnderLine = lerp(0.04, 0.3, next())
  const squash = lerp(0.6, 1.0, next())
  let ground = false
  let sun: [number, number]
  let tilt: number
  let mostLean: number
  if (kind === 0) {
    // A low sun on the horizon: a low ground in some seeds, else an open sky with its glow from the middle of the frame
    // down to the bottom edge. An open sky tilts up to about 30 degrees either way, a ground about 12.
    ground = groundDraw < 0.4
    sun = toP(across, ground ? lerp(0.97, 0.8, rise) : lerp(0.6, 1.0, rise))
    tilt = tiltDraw * (ground ? 0.4 : 1.05)
    mostLean = ground ? lerp(0.2, 0.4, leanDraw) : lerp(0.15, 1.1, leanDraw)
  } else if (kind === 1) {
    // A light high in the frame, the sky graded around it: a smaller glow, a warm halo, the pale sky and Meta Blue in
    // rings that waver and are wider than tall.
    sun = toP(lerp(0.2, 0.8, (across - 0.06) / 0.88), lerp(0.22, 0.55, height))
    tilt = tiltDraw * 1.2
    mostLean = 1.2
    horizon[0] = 0
    dome[0] = lerp(0.08, 0.22, domeDraw)
    dome[1] = dome[0]
    warm[1] = lerp(0.08, 0.18, rise)
  } else if (kind === 2) {
    // A sky lit from one side: the light on the left or right edge, the sky turned toward the far side.
    sun = toP(side > 0 ? lerp(0.97, 1.03, height) : lerp(-0.03, 0.03, height), lerp(0.25, 0.75, rise))
    tilt = -side * lerp(1.15, 1.65, tiltDraw + 0.5)
    mostLean = 1.7
  } else {
    // A plain sky gradient with no horizon in sight: no glow, the warm and the pale light low across the whole width.
    sun = toP(lerp(0.2, 0.8, (across - 0.06) / 0.88), lerp(1.04, 1.12, height))
    tilt = tiltDraw * 0.25
    mostLean = 0.3
    dome[3] = 0
    paleBase = 1
    pale[0] = 4
    pale[1] = lerp(0.3, 0.5, rise)
    warm[0] = 4
    warm[1] = lerp(0.1, 0.2, height)
  }
  sun = [sun[0], sun[1] + horizon[0]]
  let up: [number, number] = [Math.sin(tilt), -Math.cos(tilt)]
  const farthest = (s: readonly number[], u: readonly number[]) => Math.max(...[-0.5, 0.5].flatMap((x) => [-0.5, 0.5].map((y) => (x * frameW - s[0]) * u[0] + (y * frameH - s[1]) * u[1])))
  let span = Math.max(0.3, farthest(sun, up) - horizon[0])
  const ownSpan = span
  if (drag) {
    const f = toP(drag.from[0], drag.from[1])
    const t = toP(drag.to[0], drag.to[1])
    const len = Math.hypot(t[0] - f[0], t[1] - f[1])
    const dir = len > 1e-6 ? [(t[0] - f[0]) / len, (t[1] - f[1]) / len] : [0, -1]
    // The sky leans with the line up to the seed's own limit, and back to level as the line turns to point down, so
    // the lean never flips sides.
    const raw = Math.atan2(dir[0], -dir[1])
    const lean = limitLean(raw, mostLean) * (1 - smoothstepJs(0.55 * Math.PI, Math.PI, Math.abs(raw)))
    up = [Math.sin(lean), -Math.cos(lean)]
    // A high light sits partway along the line, inside the frame; the other kinds put the light at its start.
    sun = kind === 1 ? [f[0] + 0.35 * (t[0] - f[0]), f[1] + 0.35 * (t[1] - f[1])] : f
    // When the line starts outside the frame the glow comes up toward the sky until it reaches the frame's edge, so it
    // never sits out of sight; where the way to the sky only grazes the frame, it stops a little past the height of the
    // frame's nearest corner, so the height never jumps as the line turns. A ground's horizon lies the seed's own
    // height above that.
    const half = [frameW / 2, frameH / 2]
    const entry = (i: 0 | 1) => {
      if (Math.abs(sun[i]) <= half[i]) return 0
      const k = (Math.sign(sun[i]) * half[i] - sun[i]) / up[i]
      return k > 0 ? k : Infinity
    }
    const corners = [-0.5, 0.5].flatMap((u) => [-0.5, 0.5].map((v) => (u * frameW - sun[0]) * up[0] + (v * frameH - sun[1]) * up[1]))
    const toFrame = Math.min(Math.max(entry(0), entry(1)), Math.min(...corners) + 0.3)
    horizon[0] = ground ? toFrame + groundUnderLine : Math.max(off, toFrame)
    // A longer line spreads the light farther: the glow, the pale sky, the warm band and the blue patch grow with it,
    // easing in and out of their limits so they never start to change in a step.
    const along = (t[0] - f[0]) * up[0] + (t[1] - f[1]) * up[1] - horizon[0]
    const lineSpan = 0.5 * (along + 0.3 + Math.sqrt((along - 0.3) ** 2 + 0.01))
    const reach = 0.7 + 1.5 * smoothstepJs(0.4, 2.5, lineSpan / ownSpan)
    dome[0] *= reach
    dome[1] *= reach
    pale[0] *= reach
    warm[0] *= reach
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
  return { frameW, frameH, kind, sun, up, span, squash, ground, horizon, horizonWave, dome, pale, paleBase, warm, sky, deep, slant, skew, patch }
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
 * - a bright spot: the glow over the light (Yellow, white); a plain sky has none;
 * - a warm spot: the warm band on the horizon near the light, or the warm halo round a high light (Orange-red, Tan);
 * - a cool spot: the pale sky over the glow, or round a high light (Cyan, Lime, Ice, or the pale end of the sky).
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
  const [warmReach, warmThickness] = params.warm as number[]
  const [patchAlong, patchHeight, patchSize, patchOn] = params.patch as number[]
  const slant = (params.slant as number[])[0]
  const angle = (Math.atan2(side[1], side[0]) * 180) / Math.PI
  const skyLength = Math.hypot(up[0], up[1]) || 1
  const glowAt = [sun[0] + up[0] * off, sun[1] + up[1] * off]
  const at = (along: number, height: number) => [glowAt[0] + side[0] * along + up[0] * height, glowAt[1] + side[1] * along + up[1] * height]
  const paleTop = Math.max(0.04, paleHeight * span)
  const parts: StagePart[] = [{ kind: 'horizon', light: toFrame(glowAt), sky: [up[0] / skyLength, up[1] / skyLength] }]
  if (patchOn > 0) {
    // Where the patch's place along the horizon and height in the sky put it (round a high light, as a distance
    // from the glow).
    const reach = patchHeight * span - slant * patchAlong
    const patchAt = ringed ? at(patchAlong / squash, Math.sqrt(Math.max(0, reach * reach - patchAlong * patchAlong))) : at(patchAlong, reach)
    parts.push({ kind: 'spot', at: toFrame(patchAt), radius: 0.7 * patchSize, stretch: 1 / 0.7, angle, want: 'any' })
  }
  if (ringed) {
    if (domeOn > 0) parts.push({ kind: 'spot', at: toFrame(glowAt), radius: domeHeight, stretch: 1 / squash, angle, want: 'bright' })
    parts.push({ kind: 'spot', at: toFrame(glowAt), radius: warmThickness, stretch: 1 / squash, angle, want: 'warm' })
    parts.push({ kind: 'spot', at: toFrame(glowAt), radius: paleTop, stretch: 1 / squash, angle, want: 'cool' })
    return parts
  }
  if (domeOn > 0) parts.push({ kind: 'spot', at: toFrame(glowAt), radius: domeHeight, stretch: domeWidth / domeHeight, angle, want: 'bright' })
  parts.push({ kind: 'spot', at: toFrame(at(0, warmThickness / 2)), radius: warmThickness, stretch: warmReach / warmThickness, angle, want: 'warm' })
  parts.push({ kind: 'spot', at: toFrame(at(0, paleTop / 2)), radius: paleTop / 2, stretch: Math.max(1, paleReach / (paleTop / 2)), angle, want: 'cool' })
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
  vec('horizon', 'Horizon above the light, bow, tilt, drift', [0.03, 0, 0, 0.02]),
  vec('horizonWave', 'Horizon drift lattice, seed', [1, 11], 0, 1e6),
  vec('dome', 'Glow: half-width along the horizon, height, lightness at its middle, strength', [0.3, 0.15, 0.95, 1], 0, 10),
  vec('pale', 'Pale lower sky: reach along the horizon, height (share of the sky), lightness, edge softness change', [1, 0.3, 0.8, 0.5], 0, 10),
  num('paleBase', 'Share of the pale sky kept far along the horizon (0: a dome over the light, 1: a band)', 0, 1, 0.5),
  vec('warm', 'Warm band: reach along the horizon, thickness, lightness', [0.8, 0.05, 0.65], 0, 10),
  vec('sky', 'Meta Blue by the pale sky, in the middle, far from the light; deep top lightness', [0.65, 0.55, 0.46, 0.4], 0, 10),
  vec('deep', 'Deep top start (share of the sky), edge softness', [0.75, 0.15], 0, 10),
  vec('slant', 'Slant against the horizon of the sky gradient and of the pale sky edge', [0, 0], -2, 2),
  num('skew', 'Lit farther on one side of the light', -1, 1, 0),
  vec('patch', "Meta Blue's lit patch: place along the horizon, height (share of the sky), size, strength", [0.6, 0.55, 0.3, 0.8]),
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
uniform vec4 uHorizon;       // horizon above the light, bow, tilt, drift (short sides)
uniform float uHorizonWave;  // drift lattice (per short side)
uniform int uHorizonSeed;
uniform vec4 uDome;          // glow half-width along the horizon, height (short sides), lightness at its middle, strength
uniform vec4 uPale;          // pale lower sky reach along the horizon, height (share of the span), lightness, edge softness change
uniform float uPaleBase;     // share of the pale sky's height it keeps far along the horizon (0: a dome over the light; 1: a band)
uniform vec3 uWarm;          // warm band reach along the horizon, thickness (short sides), lightness
uniform vec4 uSkyL;          // Meta Blue by the pale sky, in the middle, far from the light; deep top lightness
uniform vec2 uDeep;          // deep top start (share of the span), edge softness
uniform vec2 uSlant;         // slant against the horizon of the sky's gradient and of the pale sky's edge (per short side)
uniform float uSkew;         // how much farther the light reaches on one side of the light
uniform vec4 uPatch;         // Meta Blue's lit patch place along the horizon, height (share of the span), size, strength
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
  return uPale.y * uSpan * mix(sideLight(a, uPale.x), 1.0, uPaleBase) * clamp(1.0 + uSlant.y * a, 0.25, 2.0) * (1.0 + 0.25 * gradientNoise(vec2(a * 1.1 + 7.3, 1.9), uHorizonSeed + 23));
}

float paleAt(float a, float h) {
  float top = paleTop(a);
  float soft = top * (0.2 + 0.5 * uPale.w * (0.5 + 0.5 * gradientNoise(vec2(a * 0.9 + 3.7, 8.2), uHorizonSeed + 29)));
  return 1.0 - smoothstep(top - soft, top + soft, h);
}

// The warm band on the horizon: thickest near the light and thinning away from it, its thickness wavering.
float warmAt(float a, float h) {
  float along = sideLight(a, uWarm.x);
  float th = uWarm.y * (0.4 + 0.6 * along) * (1.0 + 0.4 * gradientNoise(vec2(a * 1.7 + 5.1, 3.3), uHorizonSeed + 31));
  return along * (1.0 - smoothstep(0.3 * th, 1.3 * th, h));
}

// Height in the sky as a share of the span, slanted against the horizon and wavering, so the sky's gradient never
// runs along the horizon.
float skyHeight(float a, float h) {
  return (max(h, 0.0) + uSlant.x * a) / uSpan + 0.05 * gradientNoise(vec2(a * 0.6 + 2.1, h * 0.6 + 5.3), uHorizonSeed + 3);
}

// How far into the deep top a place is (0 to 1); the edge drifts and changes softness along its length.
float deepAt(float a, float t) {
  float edge = uDeep.x + 0.08 * gradientNoise(vec2(a * 0.8 + 6.6, 2.2), uHorizonSeed + 5);
  float soft = uDeep.y * (0.6 + 0.8 * (0.5 + 0.5 * gradientNoise(vec2(a * 0.7 + 1.4, 9.9), uHorizonSeed + 9)));
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
  // From the pale sky's edge (Meta Blue at its palest) up to where the deep top starts.
  float edge = paleTop(a) / uSpan;
  float u = clamp((t - edge) / max(uDeep.x - edge, 0.1), 0.0, 1.0);
  float L = u < 0.5 ? mix(uSkyL.x, uSkyL.y, smoothstep(0.0, 0.5, u)) : mix(uSkyL.y, uSkyL.z, smoothstep(0.5, 1.0, u));
  L -= 0.05 * (1.0 - sideLight(a, 1.2));
  L = mix(L, uSkyL.w, deepAt(a, t));
  L = mix(L, max(L, uSkyL.x), patchAt(a, t));
  float pale = paleAt(a, h);
  L = mix(L, uPale.z + 0.04 * (1.0 - clamp(h / max(uPale.y * uSpan, 0.05), 0.0, 1.0)), pale);
  L = mix(L, uWarm.z, warmAt(a, h));
  L = mix(L, uDome.z, domeAt(a, h));
  return min(L, 0.97);
}

// The ground: dim, lit by the glow near the light, darker away and down.
float groundLightness(float a, float depth) {
  float L = 0.24 + 0.03 * gradientNoise(vec2(a * 1.3 + 9.1, depth * 2.0 + 1.7), uHorizonSeed + 7) - 0.05 * smoothstep(0.05, 0.4, depth);
  return L + 0.3 * domeAt(a, 0.0) * exp(-depth / 0.12) + 0.06 * sideLight(a, uWarm.x) * exp(-depth / 0.05);
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
    // A light high in the frame: height in the sky is the distance from the glow, in rings narrower along the
    // horizon than up that waver with the direction (read from the direction itself, so there is no seam).
    vec2 q = vec2(a * uSquash, v - uHorizon.x);
    float len = length(q);
    h = len * (1.0 + 0.22 * gradientNoise(q / max(len, 1e-5) * 1.3 + vec2(5.0, 2.0), uHorizonSeed + 41));
    a = q.x;
  }
  float edge = smoothstep(-0.5 * uPixel, 0.5 * uPixel, h);
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
