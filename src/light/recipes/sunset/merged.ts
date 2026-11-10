import { linearToOklch } from '../../color/oklab'
import type { StagePart } from '../../color/stageFields'
import type { ColorPack } from '../../color/packs'
import { defaultMix, mixColors } from '../../color/mix'
import { hexToLinear, type Rgb } from '../../color/srgb'
import type { ComposeInput, Composition, ControlValues, ParamSpec, RecipeContext, RecipeDefinition, UniformMap } from '../../scene'
import { bridgeLight } from './bands-light'
import { gradientNoise } from './boundary'

/**
 * Sunrise as one look (hidden; the tool shows it with `sunrise=merged`): a sky lit from a low light, layered by
 * height above a drifting horizon. The design is a lightness field:
 * - the sky: Meta Blue's range (up to SKY_CAP), brightest around the light and deepening with height and along the
 *   horizon to a deep top, with layers of light by height that come and go along their length;
 * - the glow: a soft band along the horizon at the light, from a third of the frame's width to all of it, near white
 *   at its middle; the only part past Meta Blue's range;
 * - the ground (most seeds): a sliver to a low horizon, lit near the glow and darker away from it.
 * Every part's lightness changes across it; there are no flat areas.
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
  /** The light, from the frame center in short sides, y down. */
  sun: [number, number]
  /** Unit vector from the horizon toward the far sky. */
  up: [number, number]
  /** Short sides from the horizon to the top of the sky's layers. */
  span: number
  ground: boolean
  /** Horizon above the light, its bow (per short side squared), tilt, and drift (short sides). */
  horizon: [number, number, number, number]
  horizonWave: [number, number]
  /** Layer bunching toward the horizon (power), how much the layers rise near the light, soft bands: amount, count. */
  layer: [number, number, number, number]
  bandPhase: number
  /** The sky's lightness right above the horizon and at the top, how far along the horizon it stays lit, Meta Blue's own glow. */
  sky: [number, number, number, number]
  /** The bright zone around the light: reach along the horizon, reach up (short sides), lightness at its middle. */
  zone: [number, number, number]
  /** The warm core: width along the horizon, height, light. */
  core: [number, number, number]
  /** The broad field: place along the horizon (short sides from the light), height (stack units), width, height span. */
  broad: [number, number, number, number]
  /** How much farther the sky stays lit on one side of the light than on the other (-0.5..0.5). */
  skew: number
  /** The deep sky: its share of the frame, its lean toward one side (per short side), how dark. */
  deepShare: number
  deepLean: number
  deepAmount: number
  /** How far below the horizon the near ground takes over from the far bank (short sides). */
  bank: number
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

export function mergedLayout(seed: number, aspect: number, drag?: ControlValues['drag']): Layout {
  const next = random(seed * 7919 + 17)
  const frameW = Math.max(aspect, 1)
  const frameH = Math.max(1 / aspect, 1)
  const toP = (u: number, v: number): [number, number] => [(u - 0.5) * frameW, (v - 0.5) * frameH]
  const ground = next() < 0.7
  const rise = next()
  // A ground from a sliver along the bottom edge to a low horizon; an open sky has its base on or just inside the
  // bottom edge, so the glow is always in the frame or at its edge.
  const horizonV = ground ? lerp(0.975, 0.64, rise ** 1.2) : lerp(0.9, 1.0, rise)
  // The light sits toward the left, the middle or the right, on its horizon or a little below it.
  const zoneOfSun = Math.floor(next() * 3)
  const sunU = [lerp(0.02, 0.28, next()), lerp(0.36, 0.64, next()), lerp(0.72, 0.98, next())][zoneOfSun]
  const below = next() < 0.5
  const off = ground ? (below ? lerp(0.08, 0.4, next()) : lerp(0.0, 0.05, next())) : lerp(0.02, 0.1, next())
  const tilt = (next() - 0.5) * 0.5
  const topV = lerp(-0.3, 0.06, next())
  let sun = toP(sunU, horizonV)
  sun = [sun[0], sun[1] + off]
  let up: [number, number] = [Math.sin(tilt), -Math.cos(tilt)]
  let span = Math.max(0.3, (horizonV - topV) * frameH)
  const horizon: [number, number, number, number] = [off, (next() - 0.6) * 0.4, (next() - 0.5) * 0.4, lerp(0.01, 0.045, next())]
  const horizonWave: [number, number] = [lerp(0.7, 1.6, next()), Math.floor(next() * 90000) + 11]
  // Layers of light by height: two to five, bunched toward the horizon or spread, faint or clear.
  const layer: [number, number, number, number] = [lerp(0.45, 1.3, next()), lerp(0.0, 0.25, next()), lerp(0.0, 2.0, next() ** 0.8), 2 + Math.floor(next() * 4)]
  const bandPhase = next()
  // Lightness right above the horizon away from the light, at the top (deep in some seeds), how far along the
  // horizon the light reaches, Meta Blue's own glow. The sky stays in Meta Blue's range (SKY_CAP).
  const sky: [number, number, number, number] = [lerp(0.44, 0.54, next()), lerp(0.16, 0.34, next()), lerp(0.6, 1.8, next()), lerp(0.03, 0.08, next())]
  // The lit sky around the light: Meta Blue at its brightest, soft-edged, from small to half the frame.
  const zoneSize = 1 - (1 - next()) ** 2
  const zone: [number, number, number] = [lerp(0.3, 1.3, zoneSize), lerp(0.15, 0.75, zoneSize * 0.6 + next() * 0.4), lerp(0.6, 0.68, next())]
  // The glow: a soft band along the horizon, from a third of the frame's width to all of it, near white at its
  // middle; the only part of the sky past Meta Blue's range.
  const core: [number, number, number] = [lerp(0.17, 0.55, next()) * frameW, lerp(0.06, 0.18, next()) * (ground ? 1 : 1.4), lerp(0.86, 0.94, next())]
  const broadSide = next() < 0.5 ? -1 : 1
  // The broad field sits low beside the glow, where the sky is lit, so its color reads as light.
  const broad: [number, number, number, number] = [broadSide * lerp(0.25, 0.9, next()), lerp(0.02, 0.14, next()), lerp(0.5, 1.1, next()), lerp(0.08, 0.2, next())]
  const skew = (next() - 0.5) * 1.0
  const deepShare = lerp(0.08, 0.18, next())
  const deepLean = (next() - 0.5) * 1.3
  const deepAmount = lerp(0.5, 0.9, next())
  const bank = lerp(0.04, 0.14, next())
  // Under a line: how far a ground's horizon lies above the light, or above the frame's edge when the line starts
  // outside the frame.
  const groundUnderLine = lerp(0.04, 0.5, next())
  const ownSpan = span
  if (drag) {
    const f = toP(drag.from[0], drag.from[1])
    const t = toP(drag.to[0], drag.to[1])
    const len = Math.hypot(t[0] - f[0], t[1] - f[1])
    const dir = len > 1e-6 ? [(t[0] - f[0]) / len, (t[1] - f[1]) / len] : [0, -1]
    // A ground leans at most about 18 degrees, and back to level as the line turns to point down, so the lean never
    // flips sides; an open sky follows the line all the way round.
    const raw = Math.atan2(dir[0], -dir[1])
    const lean = ground ? limitLean(raw, 0.32) * (1 - smoothstepJs(0.55 * Math.PI, Math.PI, Math.abs(raw))) : raw
    up = [Math.sin(lean), -Math.cos(lean)]
    sun = f
    // When the line starts outside the frame the glow comes up toward the sky until it reaches the frame's edge, so it
    // never sits out of sight; where the way to the sky only grazes the frame, it stops a little past the height of the
    // frame's nearest corner, so the height never jumps as the line turns. A ground's horizon lies the seed's own
    // height above that.
    const half = [frameW / 2, frameH / 2]
    const entry = (i: 0 | 1) => {
      if (Math.abs(f[i]) <= half[i]) return 0
      const t = (Math.sign(f[i]) * half[i] - f[i]) / up[i]
      return t > 0 ? t : Infinity
    }
    const corners = [-0.5, 0.5].flatMap((u) => [-0.5, 0.5].map((v) => (u * frameW - f[0]) * up[0] + (v * frameH - f[1]) * up[1]))
    const toFrame = Math.min(Math.max(entry(0), entry(1)), Math.min(...corners) + 0.3)
    horizon[0] = ground ? toFrame + groundUnderLine : Math.max(off, toFrame)
    span = Math.max(0.3, (t[0] - f[0]) * up[0] + (t[1] - f[1]) * up[1] - horizon[0])
    // A longer line spreads the light farther: the bright zone, the glow and the lit sky along the horizon grow with it.
    const reach = clamp(span / ownSpan, 0.7, 2.2)
    zone[0] *= reach
    zone[1] *= reach
    core[0] *= reach
    core[1] *= reach
    sky[2] *= reach
  }
  return { frameW, frameH, sun, up, span, ground, horizon, horizonWave, layer, bandPhase, sky, zone, core, broad, skew, deepShare, deepLean, deepAmount, bank }
}

/** Where a point sits: along the horizon from the light (a), height above the sky's base (h), place in the layers (z). */
function placeOf(L: Layout, px: number, py: number) {
  const dx = px - L.sun[0]
  const dy = py - L.sun[1]
  const a = dx * -L.up[1] + dy * L.up[0]
  const t = dx * L.up[0] + dy * L.up[1]
  const [off, bow, tilt, drift] = L.horizon
  const h = t - (off + bow * a * a + tilt * a + drift * gradientNoise(a * L.horizonWave[0] + 3.1, 7.7, L.horizonWave[1]))
  let z = (Math.max(h, 0) / L.span) ** L.layer[0]
  z = z / (1 + L.layer[1] * Math.exp(-(a * a) / 1.2))
  return { a, h, z }
}

/** Where the deep sky starts: the top `deepShare` of the frame by stack position, leaning toward one side. */
function deepStart(L: Layout, aspect: number): number {
  const nx = aspect >= 1 ? 64 : 36
  const ny = aspect >= 1 ? 36 : 64
  const zd: number[] = []
  let total = 0
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      total++
      const { a, h, z } = placeOf(L, ((i + 0.5) / nx - 0.5) * L.frameW, ((j + 0.5) / ny - 0.5) * L.frameH)
      if (!(L.ground && h < 0)) zd.push(z + L.deepLean * a)
    }
  zd.sort((x, y) => x - y)
  const count = Math.round(Math.min(L.deepShare * total, 0.5 * zd.length))
  return zd.length ? zd[Math.max(0, zd.length - 1 - count)] : 1
}

// ---------------------------------------------------------------------------------------------------------- colors

interface Roles {
  lowest: [number, number, number, number]
  sky: string
  warmInner: string
  warmOuter: string
  broad: string
  broadOn: boolean
  bank: string
  near: string
  deep: string
}

/**
 * For proof sheets until the shared color stage takes over: a color for each part, from the list of colors that
 * are on. The sky takes the deepest saturated blue (Meta Blue; else Cyan; else a cool grey); the glow's core the
 * lightest warm or near-white color and its edge the deeper warm color; the broad field a cool light color (else the
 * other glow color); the ground and the deep sky the dark colors (else the deep tone of the color they meet). It
 * never reads a pack id; the layout never reads it.
 */
export function fillRoles(colors: readonly { hex: string }[], colorSeed: number): Roles {
  const next = random(colorSeed * 104729 + 7)
  const cs = colors.map(({ hex }) => {
    const c = hexToLinear(hex)
    const [L, C, h] = linearToOklch(c)
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
  const inner = glowing[0] ?? sky
  const outer = glowing[1] ?? inner
  // The broad field is a lit part of the sky in every design; it takes a cool light color, else the sky's own.
  const broad = lights.filter((x) => !isGlow(x) && x !== sky).sort((p, q) => q.L - p.L)[0] ?? sky
  const tone = outer.C >= 0.1 && outer.L < 0.75 ? outer : sky
  // How far below its own light each part's color may go: light that only reads as itself when bright (Yellow, Lime,
  // Ice) stays near its level; the others (Meta Blue, Cyan, Orange-red, Tan, the greys) follow the design down.
  const lowest = (x: Entry | undefined) => (!x ? 0.3 : (isGlow(x) && x.L > 0.75) || (x.L > 0.9 && x.C < 0.03) ? 0.85 : 0.25)
  return {
    lowest: [lowest(sky), lowest(inner), lowest(outer), lowest(broad)],
    sky: sky.hex,
    warmInner: inner.hex,
    warmOuter: outer.hex,
    broad: broad.hex,
    broadOn: true,
    bank: darks[0]?.hex ?? tone.hex,
    near: darks[1]?.hex ?? darks[0]?.hex ?? tone.hex,
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
  const start = deepStart(L, aspect)
  const on = mixColors(pack, { shares: mix ?? defaultMix(pack).shares }).map((entry) => ({ hex: entry.color.hex }))
  const roles = fillRoles(on, seed)
  return {
    colors: [roles.sky, roles.warmInner, roles.warmOuter, roles.broad, roles.bank, roles.near, roles.deep, NO_LIGHT],
    params: {
      lens: lerp(0.045, 0.12, clamp(controls.softness, 0, 1)),
      level: 2 ** ((clamp(controls.intensity, 0, 1) - 0.5) * 1.2),
      sun: L.sun.map((v) => clamp(v, -6, 6)),
      up: L.up,
      span: clamp(L.span, 0.1, 20),
      ground: L.ground,
      horizon: L.horizon,
      horizonWave: L.horizonWave,
      layer: L.layer,
      bandPhase: L.bandPhase,
      sky: L.sky,
      zone: L.zone,
      core: L.core,
      broad: L.broad,
      skew: L.skew,
      broadOn: roles.broadOn,
      lowest: roles.lowest,
      deep: [start, start + 0.3, L.deepLean, L.deepAmount],
      bank: L.bank,
    },
    lens: { bloom: 0, halation: 0 },
    output: { grain: 0, exposure: 0 },
  }
}

// ---------------------------------------------------------------------------------------------------------- parts

/**
 * The look's parts for the shared color stage, from its params and the frame's aspect (frame units, x from the left,
 * y from the top; sizes in short sides; `angle` in degrees from the frame's x axis):
 * - horizon: the glow on the horizon above the light, and the way from it to the deep sky (short-side units, as the
 *   stage measures height);
 * - a warm spot: the glow band along the horizon, the only part of the design past Meta Blue's range;
 * - a cool spot: the lit sky around the light, where Meta Blue is at its brightest.
 * The stage colors the look's lightness-only render (`lightnessOnlyParams`).
 */
export function mergedParts(params: Record<string, unknown>, aspect: number): StagePart[] {
  const frameW = Math.max(aspect, 1)
  const frameH = Math.max(1 / aspect, 1)
  const toFrame = (p: readonly number[]): [number, number] => [p[0] / frameW + 0.5, p[1] / frameH + 0.5]
  const sun = params.sun as number[]
  const up = params.up as number[]
  const side = [-up[1], up[0]]
  const [off] = params.horizon as number[]
  const [coreWidth, coreHeight] = params.core as number[]
  const [zoneAlong, zoneUp] = params.zone as number[]
  const angle = (Math.atan2(side[1], side[0]) * 180) / Math.PI
  const skyLength = Math.hypot(up[0], up[1]) || 1
  const glowAt = [sun[0] + up[0] * off, sun[1] + up[1] * off]
  return [
    { kind: 'horizon', light: toFrame(glowAt), sky: [up[0] / skyLength, up[1] / skyLength] },
    { kind: 'spot', at: toFrame(glowAt), radius: 2 * coreHeight, stretch: coreWidth / (2 * coreHeight), angle, want: 'warm' },
    { kind: 'spot', at: toFrame(glowAt), radius: zoneUp, stretch: zoneAlong / zoneUp, angle, want: 'cool' },
  ]
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
  vec('up', 'Toward the far sky', [0, -1], -1, 1),
  num('span', 'Sky span (short sides)', 0.1, 20, 1),
  { kind: 'boolean', key: 'ground', label: 'Ground', default: true },
  vec('horizon', 'Horizon above the light, bow, tilt, drift', [0.05, 0, 0, 0.02]),
  vec('horizonWave', 'Horizon drift lattice, seed', [1, 11], 0, 1e6),
  vec('layer', 'Layer bunching, rise near the light, bands amount, band count', [0.8, 0.3, 0, 3], 0, 10),
  num('bandPhase', 'Band phase', 0, 1, 0),
  vec('sky', 'Sky lightness at the horizon, at the top, lit width along the horizon, blue glow', [0.6, 0.3, 1.2, 0.1], 0, 10),
  vec('zone', 'Lit sky around the light: reach along the horizon, reach up, lightness at its middle', [0.8, 0.4, 0.64], 0, 10),
  vec('core', 'Glow band: width along the horizon, height, lightness at its middle', [0.35, 0.1, 0.9], 0, 10),
  { kind: 'boolean', key: 'lightnessOnly', label: 'Show the design lightness only (grey)', default: false },
  vec('broad', 'Broad field place, height, width, height span', [0.5, 0.3, 0.7, 0.2]),
  num('skew', 'Lit farther on one side of the light', -1, 1, 0),
  { kind: 'boolean', key: 'broadOn', label: 'Broad field', default: true },
  vec('lowest', 'Lowest light of the sky, glow core, glow edge and broad field colors', [0.25, 0.85, 0.25, 0.25], 0, 1),
  vec('deep', 'Deep sky start, full, lean, amount', [1, 1.3, 0, 0.7]),
  num('bank', 'Far bank depth (short sides)', 0, 2, 0.08),
]

function uniforms(ctx: RecipeContext): UniformMap {
  const c = (i: number) => ctx.colors[i] as Rgb
  return {
    uLevel: ctx.num('level'),
    uSun: ctx.vec('sun'),
    uUp: ctx.vec('up'),
    uSpan: ctx.num('span'),
    uGroundOn: ctx.bool('ground') ? 1 : 0,
    uHorizon: ctx.vec('horizon'),
    uHorizonWave: ctx.vec('horizonWave')[0],
    uHorizonSeed: Math.round(ctx.vec('horizonWave')[1]),
    uLayer: ctx.vec('layer'),
    uBandPhase: ctx.num('bandPhase'),
    uSkyL: ctx.vec('sky'),
    uZone: ctx.vec('zone'),
    uCore: ctx.vec('core'),
    uLightnessOnly: ctx.bool('lightnessOnly') ? 1 : 0,
    uBroad: ctx.vec('broad'),
    uBroadOn: ctx.bool('broadOn') ? 1 : 0,
    uLowest: ctx.vec('lowest'),
    uSkew: ctx.num('skew'),
    uDeep: ctx.vec('deep'),
    uBank: ctx.num('bank'),
    uSky: c(0),
    uWarmInner: c(1),
    uWarmOuter: c(2),
    uBroadColor: c(3),
    uBankColor: c(4),
    uNearColor: c(5),
    uDeepColor: c(6),
    // The pale light between the warm core and the sky, and between the broad field and the sky.
    uBridgeWarm: bridgeLight(c(2), c(0)),
    uBridgeBroad: bridgeLight(c(3), c(0)),
  }
}

const FRAGMENT = /* glsl */ `
uniform float uLevel;
uniform vec2 uSun;
uniform vec2 uUp;
uniform float uSpan;
uniform int uGroundOn;
uniform vec4 uHorizon;       // horizon above the light, bow, tilt, drift (short sides)
uniform float uHorizonWave;  // drift lattice (per short side)
uniform int uHorizonSeed;
uniform vec4 uLayer;         // layer bunching toward the horizon, rise near the light, bands amount, band count
uniform float uBandPhase;
uniform vec4 uSkyL;          // sky lightness right above the horizon, at the top, lit width along the horizon, blue glow
uniform vec3 uZone;          // bright zone reach along the horizon, reach up (short sides), lightness at its middle
uniform int uLightnessOnly;  // 1: the design's lightness as grey, for proof sheets and the color stage
uniform vec3 uCore;          // glow band width along the horizon, height, lightness at its middle
uniform vec4 uBroad;         // broad field place along the horizon, height (stack units), width, height span
uniform int uBroadOn;
uniform float uSkew;         // how much farther the sky stays lit on one side of the light
uniform vec4 uLowest;        // lowest light of the sky, glow core, glow edge and broad field colors (share of their own)
uniform vec4 uDeep;          // deep sky start and full (stack units), lean (per short side), amount
uniform float uBank;         // depth where the near ground takes over from the far bank (short sides)
uniform vec3 uSky;
uniform vec3 uWarmInner;
uniform vec3 uWarmOuter;
uniform vec3 uBroadColor;
uniform vec3 uBankColor;
uniform vec3 uNearColor;
uniform vec3 uDeepColor;
uniform vec3 uBridgeWarm;
uniform vec3 uBridgeBroad;

float baseAt(float a) {
  return uHorizon.x + uHorizon.y * a * a + uHorizon.z * a + uHorizon.w * gradientNoise(vec2(a * uHorizonWave + 3.1, 7.7), uHorizonSeed);
}

// How lit a place is by its distance along the horizon from the light, as a low sun lights the sky to its sides;
// the light reaches farther on one side by the seed.
float sideLight(float a) {
  float reach = uSkyL.z * (1.0 + uSkew * tanh(a / 0.3));
  return 1.0 / (1.0 + pow(abs(a) / max(reach, 0.1), 1.6));
}

float coreAt(float a, float h) { return exp(-(a * a) / (uCore.x * uCore.x)) * exp(-max(h, 0.0) / uCore.y); }

// The broad field: a soft lit part of the sky, low beside the glow, wide and near level.
float broadAt(float a, float z) {
  float ba = (a - uBroad.x) / max(uBroad.z, 0.05);
  float bz = (z - uBroad.y) / max(uBroad.w, 0.05);
  return exp(-min(ba * ba + bz * bz, 40.0));
}

// Design lightness where Meta Blue is brightest and still exactly itself: past it the tone curve whitens it.
const float SKY_CAP = 0.6;

// The lit sky around the light: soft-edged, with a long tail along the horizon and up.
float zoneAt(float a, float h) {
  float x = a / max(uZone.x, 0.05);
  float y = max(h, 0.0) / max(uZone.y, 0.05);
  return 1.0 / (1.0 + 1.6 * pow(x * x + y * y, 0.9));
}

// The design's lightness in the sky (Oklab L): deepening with height and away from the light, Meta Blue's own glow
// wide around the light, the bright zone over the light, the warm core at the horizon, soft layers of light by
// height, the deep side.
float skyLightness(float a, float h, float z) {
  float side = sideLight(a);
  float L = mix(uSkyL.x, uSkyL.y, smoothstep(0.0, 1.0, pow(z, 0.75))) * (0.75 + 0.25 * side);
  L += uSkyL.w * side * exp(-z / 0.45);
  float zone = zoneAt(a, h);
  L = mix(L, uZone.z, zone);
  L += 0.05 * broadAt(a, z) * (1.0 - zone);
  // Soft layers of light by height; each drifts along the horizon on its own, so none runs parallel to it.
  // Clear layers drift more, and each one's strength changes along its length and fades with height, so they never
  // run like parallel, evenly spaced stripes.
  float zb = z + (0.035 + 0.025 * uLayer.z) * gradientNoise(vec2(a * 0.9 + 4.2, 2.3), uHorizonSeed + 11);
  float along = 0.35 + 0.65 * smoothstep(-0.4, 0.5, gradientNoise(vec2(a * 0.8 + 1.3, z * 1.5 + 6.1), uHorizonSeed + 13));
  L += (0.012 + uLayer.z * 0.04) * along * (1.0 - 0.5 * min(z, 1.0)) * sin(6.2831853 * (zb * uLayer.w + uBandPhase)) * (1.0 - 0.6 * zone);
  L -= 0.12 * uDeep.w * smoothstep(uDeep.x, uDeep.y, z + uDeep.z * a);
  // The sky stays where Meta Blue is a saturated blue, easing into the cap so it never flattens; only the glow band
  // along the horizon goes past it, toward white.
  float knee = SKY_CAP - 0.06;
  if (L > knee) L = SKY_CAP - 0.06 * exp(-(L - knee) / 0.06);
  L = mix(L, uCore.z, coreAt(a, h));
  return min(L, 0.95);
}

// The ground: lit near the light and darker away and down, unevenly along the horizon, with a hazier far bank.
float groundLightness(float a, float depth) {
  float side = sideLight(a);
  float L = 0.14 + 0.05 * side + 0.09 * exp(-depth / 0.1) * (0.35 + 0.65 * side) - 0.04 * smoothstep(0.1, 0.6, depth);
  L += 0.025 * gradientNoise(vec2(a * 1.3 + 9.1, depth * 2.0 + 1.7), uHorizonSeed + 7);
  L += 0.1 * zoneAt(a, 0.0) * exp(-depth / 0.08);
  return L + 0.03 * exp(-depth / 0.04);
}

// The color each part gives, blended like overlapping light; where two far hues meet, a pale light between them.
// The fourth value is how far below its own light the blend may go.
vec4 skyHue(float a, float h, float z) {
  // The warm light lies along the horizon: a wide soft band, never a disc.
  float core = coreAt(a, h);
  float warm = smoothstep(0.2, 0.8, core);
  float inner = smoothstep(0.55, 1.0, core);
  vec3 warmColor = mix(uWarmOuter, uWarmInner, inner);
  float broad = uBroadOn == 1 ? 0.9 * broadAt(a, z) * (1.0 - warm) : 0.0;
  // The sky fades out before the warm light comes in and a pale light fills the gap, so a warm color never mixes
  // with the blue (pink), even after the lens.
  float skyPart = (1.0 - smoothstep(0.0, 0.4, warm)) * (1.0 - broad);
  float warmPart = smoothstep(0.5, 0.9, warm);
  float gap = max(0.0, 1.0 - skyPart - warmPart - broad);
  vec3 col = uSky * skyPart + uBroadColor * broad + warmColor * warmPart + uBridgeWarm * gap;
  float lowest = clamp(mix(mix(uLowest.x, uLowest.w, broad), mix(uLowest.z, uLowest.y, inner), warmPart), 0.2, 0.9);
  float d = smoothstep(uDeep.x, uDeep.y, z + uDeep.z * a) * uDeep.w;
  return vec4(mix(col, uDeepColor, d * d), mix(lowest, 0.3, d));
}

vec3 groundHue(float depth) { return mix(uBankColor, uNearColor, smoothstep(uBank * 0.6, uBank * 1.5, depth)); }

// A color shown at a lightness: scaled in linear light to that luminance. Light that only reads as itself when bright
// (Yellow, Lime, Ice) never goes far below its own level; dark colors never far above theirs; a blue brightens at most
// as far as it stays a saturated blue.
vec3 atLightness(vec3 col, float L, float lowest) {
  float own = max(luminance(col), 1e-4);
  // Dark colors stay near their own light; a blue goes as far as it stays a saturated blue; warm and light colors
  // go on toward white their own way (orange to amber and cream).
  float highest = mix(mix(1.6, 2.1, smoothstep(0.06, 0.1, own)), 3.4, smoothstep(0.18, 0.24, own));
  return col * clamp(L * L * L / own, lowest, highest);
}

vec3 auxRadiance(vec2 uv, vec2 p) {
  vec2 d = p - uSun;
  float a = dot(d, vec2(-uUp.y, uUp.x));
  float h = dot(d, uUp) - baseAt(a);
  float z = pow(max(h, 0.0) / uSpan, uLayer.x);
  z = z / (1.0 + uLayer.y * exp(-(a * a) / 1.2));
  if (uLightnessOnly == 1) {
    float L = skyLightness(a, h, z);
    if (uGroundOn == 1) L = mix(groundLightness(a, -h), L, smoothstep(-0.5 * uPixel, 0.5 * uPixel, h));
    return vec3(L * L * L) * uLevel;
  }
  vec4 hue = skyHue(a, h, z);
  vec3 col = atLightness(hue.rgb, skyLightness(a, h, z), hue.a);
  if (uGroundOn == 1) {
    vec3 ground = atLightness(groundHue(-h), groundLightness(a, -h), 0.05);
    col = mix(ground, col, smoothstep(-0.5 * uPixel, 0.5 * uPixel, h));
  }
  return col * uLevel;
}

vec3 radiance(vec2 uv, vec2 p) { return vec3(0.0); }

vec3 combine(vec2 uv, vec2 p, vec3 radiance, vec3 lensed) { return lensed; }
`

const SLOTS = [
  { key: 'sky', label: 'Sky' },
  { key: 'warmInner', label: 'Glow core' },
  { key: 'warmOuter', label: 'Glow edge' },
  { key: 'broad', label: 'Broad field' },
  { key: 'bank', label: 'Far bank' },
  { key: 'near', label: 'Near ground' },
  { key: 'deep', label: 'Deep sky' },
  { key: 'spare', label: 'Unused' },
]

export const sunsetMerged: RecipeDefinition = {
  id: 'sunset.merged',
  mood: 'sunset',
  label: 'Sunrise',
  colorSlots: SLOTS,
  defaultColors: ['#0064E0', '#FFD61E', '#FF4F00', '#1FCDF0', '#FF4F00', '#FF4F00', '#0064E0', NO_LIGHT],
  params: PARAMS,
  fragment: FRAGMENT,
  uniforms,
  scatter: [{ source: 'aux', shape: 'lens', radius: (ctx) => ctx.num('lens'), size: () => 8 }],
  radianceScale: 0.5,
  fromPack: (pack: ColorPack) => composeMerged({ pack, controls: { intensity: 0.5, softness: 0.7, mood: 0.5 }, seed: 1, aspect: 16 / 9 }).colors,
  compose: (input) => composeMerged(input),
}
