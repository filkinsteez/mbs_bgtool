import { linearToOklab } from '../../color/oklab'
import type { ColorPack } from '../../color/packs'
import { hexToLinear, type Rgb } from '../../color/srgb'
import { NO_LIGHT } from '../../compose'
import type {
  Composition,
  NumberParam,
  ParamSpec,
  ParamValue,
  RecipeContext,
  RecipeDefinition,
  ScatterBlur,
  UniformMap,
  VectorParam,
} from '../../scene'
import { BLOOM_BOUNDARY, BLOOM_MINOR_REF, BLOOM_ROW, bloomBoundaryUniforms } from './blooms-boundary'
import {
  composeLayout,
  GLOW_COUNT,
  isSourceLight,
  isWarm,
  LOBES,
  lobes,
  SLOT,
  SLOT_COUNT,
  TAIL_END,
  ZENITH_LOBE_INDEX,
  ZENITH_VARY,
  type BloomsLayout,
  type GlowSpec,
} from './blooms-compose'
import { bridgeAmount, bridgeGate, bridgeTint, deepen, deepFade, deepMember, otherHue, skyPaleTint } from './blooms-light'
import { BOUNDARY_GLSL } from './boundary'

const DEFAULT_GLOWS: readonly GlowSpec[] = [
  { color: SLOT.light1, at: [-0.09, 0.88], radius: 0.62, aniso: 4.4, angle: 21, gain: 0.9, beta: 2.2, haze: 1.45, vary: 0.65, bend: 0.12 },
  { color: SLOT.light1, at: [0.26, 1.08], radius: 0.38, aniso: 4.4, angle: 16, gain: 0.42, beta: 2.2, haze: 0.8, vary: 0.6, bend: 0.1 },
  { color: SLOT.light2, at: [1.02, 1.08], radius: 0.48, aniso: 4.0, angle: -8, gain: 0.38, beta: 2.2, haze: 0.5, vary: 0.6, bend: 0.1 },
  { color: SLOT.sky, at: [0.7, 1.06], radius: 0.6, aniso: 4.6, angle: -5, gain: 0.6, beta: 2.0, haze: 0, vary: 0.6, bend: 0.08 },
]

function num(key: string, label: string, min: number, max: number, step: number, value: number): NumberParam {
  return { kind: 'number', key, label, min, max, step, default: value }
}

function vec(key: string, label: string, min: number, max: number, step: number, value: readonly number[]): VectorParam {
  return { kind: 'vector', key, label, min, max, step, default: value }
}

function glowParams(i: number, glow: GlowSpec): ParamSpec[] {
  const n = i + 1
  return [
    num(`glow${n}Color`, `Glow ${n} color`, 0, SLOT_COUNT - 1, 1, glow.color),
    vec(`glow${n}At`, `Glow ${n} at`, -1, 2, 0.005, glow.at),
    num(`glow${n}Radius`, `Glow ${n} radius`, 0.05, 2.5, 0.005, glow.radius),
    num(`glow${n}Aniso`, `Glow ${n} width / height`, 1, 12, 0.05, glow.aniso),
    num(`glow${n}Angle`, `Glow ${n} tilt`, -360, 360, 0.01, glow.angle),
    num(`glow${n}Gain`, `Glow ${n} gain`, 0, 4, 0.01, glow.gain),
    num(`glow${n}Beta`, `Glow ${n} falloff`, 1, 5, 0.01, glow.beta),
    num(`glow${n}Haze`, `Glow ${n} haze`, 0, 8, 0.01, glow.haze),
    num(`glow${n}Vary`, `Glow ${n} edge variation`, 0, 1, 0.01, glow.vary),
    num(`glow${n}Bend`, `Glow ${n} bend`, -0.6, 0.6, 0.005, glow.bend),
  ]
}

const PARAMS: readonly ParamSpec[] = [
  num('intensity', 'Intensity', 0, 1, 0.01, 0.5),
  num('glows', 'Glows', 1, GLOW_COUNT, 1, DEFAULT_GLOWS.length),
  ...DEFAULT_GLOWS.flatMap((glow, i) => glowParams(i, glow)),
  num('zenithColor', 'Zenith color', 0, SLOT_COUNT - 1, 1, SLOT.deep1),
  vec('zenithAt', 'Zenith at', -1, 2, 0.005, [1.16, -0.12]),
  num('zenithRadius', 'Zenith radius', 0.1, 3, 0.005, 0.48),
  num('zenithAniso', 'Zenith width / height', 1, 8, 0.05, 1.9),
  num('zenithAngle', 'Zenith tilt', -360, 360, 0.01, -16),
  num('zenithAmount', 'Zenith amount', 0, 2, 0.01, 0.6),
  num('zenithFalloff', 'Zenith falloff', 1, 5, 0.01, 2.6),
  num('zenithHold', 'Zenith keeps its hex under the darker top (0: darkens with the sky)', 0, 1, 0.01, 0),
  num('zenithMeet', 'Share of the blue taken away where the zenith comes in', 0, 0.9, 0.01, 0),
  num('warp', 'Warp', 0, 0.3, 0.002, 0.07),
  num('warpScale', 'Warp scale', 0.2, 4, 0.05, 1.1),
  num('bridge', 'Bridge', 0, 3, 0.01, 1),
  num('skyTop', 'Sky stops darker at the top', 0, 3, 0.01, 0),
  num('skyMid', 'Sky exact hex height', 0, 1, 0.005, 0.5),
  num('skyTilt', 'Sky darkening tilt', -1, 1, 0.005, 0),
  num('skyTurn', 'Sky darkening turned about the frame middle, degrees', -180, 180, 0.01, 0),
  num('skyVeil', 'Pale light over the sky toward the light, in units of the sky luminance (0: none)', 0, 6, 0.001, 0),
  num('skyLine', '1: the sky darkens from skyLineFrom to skyLineTo (a dragged line) instead of across the frame', 0, 1, 1, 0),
  vec('skyLineFrom', 'Start of the line the sky darkens along', -2, 3, 0.001, [0.5, 1]),
  vec('skyLineTo', 'End of the line the sky darkens along', -2, 3, 0.001, [0.5, 0]),
  num('skyVary', 'Sky light variation', 0, 0.1, 0.001, 0),
  num('lensRadius', 'Lens radius, short sides; the scene is seen through it (0: off)', 0, 0.3, 0.0005, 0),
  num('glowCore', 'Glow core: extra light in a narrower core at each source, over its peak', 0, 2, 0.01, 0),
  num('bridgeFloor', 'Lowest Oklab L a bridge aims for (0: the lighter side only)', 0, 1, 0.005, 0),
  num('hazeFloor', 'How far the glows haze is kept from hiding more sky light than they add (0: no limit)', 0, 1, 0.01, 0),
  num('bridgeSky', 'How much a bridge takes the sky hue on the sky side (0: the lights tint throughout)', 0, 1, 0.01, 0),
]

/** The one lens: without it (radius 0, the 1:1 presets) the aux source is unused, so it stays tiny. */
const LENS: ScatterBlur = { source: 'aux', shape: 'lens', radius: (ctx) => ctx.num('lensRadius'), size: () => 8 }

function readLayout(ctx: RecipeContext): BloomsLayout {
  const count = Math.round(ctx.num('glows'))
  const glows: GlowSpec[] = Array.from({ length: count }, (_, i) => {
    const n = i + 1
    const at = ctx.vec(`glow${n}At`)
    return {
      color: Math.round(ctx.num(`glow${n}Color`)),
      at: [at[0], at[1]],
      radius: ctx.num(`glow${n}Radius`),
      aniso: ctx.num(`glow${n}Aniso`),
      angle: ctx.num(`glow${n}Angle`),
      gain: ctx.num(`glow${n}Gain`),
      beta: ctx.num(`glow${n}Beta`),
      haze: ctx.num(`glow${n}Haze`),
      vary: ctx.num(`glow${n}Vary`),
      bend: ctx.num(`glow${n}Bend`),
    }
  })
  const zenithAt = ctx.vec('zenithAt')
  return {
    glows,
    zenith: {
      color: Math.round(ctx.num('zenithColor')),
      at: [zenithAt[0], zenithAt[1]],
      radius: ctx.num('zenithRadius'),
      aniso: ctx.num('zenithAniso'),
      angle: ctx.num('zenithAngle'),
      amount: ctx.num('zenithAmount'),
      falloff: ctx.num('zenithFalloff'),
      hold: ctx.num('zenithHold'),
      meet: ctx.num('zenithMeet'),
    },
    sky: {
      top: ctx.num('skyTop'),
      mid: ctx.num('skyMid'),
      tilt: ctx.num('skyTilt'),
      vary: ctx.num('skyVary'),
      turn: ctx.num('skyTurn'),
      veil: ctx.num('skyVeil'),
      line: ctx.num('skyLine') > 0.5 ? { from: vec2(ctx.vec('skyLineFrom')), to: vec2(ctx.vec('skyLineTo')) } : undefined,
    },
    core: ctx.num('glowCore'),
    warp: ctx.num('warp'),
    warpScale: ctx.num('warpScale'),
    bridge: ctx.num('bridge'),
    bridgeFloor: ctx.num('bridgeFloor'),
    hazeFloor: ctx.num('hazeFloor'),
    bridgeSky: ctx.num('bridgeSky'),
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const vec2 = (v: readonly number[]): [number, number] => [v[0], v[1]]

/** The layout as recipe params, each clamped to its range. */
function layoutParams(layout: BloomsLayout): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {
    glows: layout.glows.length,
    zenithColor: layout.zenith.color,
    zenithAt: layout.zenith.at,
    zenithRadius: layout.zenith.radius,
    zenithAniso: layout.zenith.aniso,
    zenithAngle: layout.zenith.angle,
    zenithAmount: layout.zenith.amount,
    zenithFalloff: layout.zenith.falloff,
    zenithHold: layout.zenith.hold,
    zenithMeet: layout.zenith.meet,
    skyTop: layout.sky.top,
    skyMid: layout.sky.mid,
    skyTilt: layout.sky.tilt,
    skyTurn: layout.sky.turn,
    skyVeil: layout.sky.veil,
    skyLine: layout.sky.line ? 1 : 0,
    skyLineFrom: layout.sky.line ? [...layout.sky.line.from] : [0.5, 1],
    skyLineTo: layout.sky.line ? [...layout.sky.line.to] : [0.5, 0],
    skyVary: layout.sky.vary,
    glowCore: layout.core,
    warp: layout.warp,
    warpScale: layout.warpScale,
    bridge: layout.bridge,
    bridgeFloor: layout.bridgeFloor,
    hazeFloor: layout.hazeFloor,
    bridgeSky: layout.bridgeSky,
  }
  layout.glows.forEach((glow, i) => {
    const n = i + 1
    out[`glow${n}Color`] = glow.color
    out[`glow${n}At`] = glow.at
    out[`glow${n}Radius`] = glow.radius
    out[`glow${n}Aniso`] = glow.aniso
    out[`glow${n}Angle`] = glow.angle
    out[`glow${n}Gain`] = glow.gain
    out[`glow${n}Beta`] = glow.beta
    out[`glow${n}Haze`] = glow.haze
    out[`glow${n}Vary`] = glow.vary
    out[`glow${n}Bend`] = glow.bend
  })
  for (const spec of PARAMS) {
    const value = out[spec.key]
    if (value === undefined) continue
    if (spec.kind === 'number' && typeof value === 'number') out[spec.key] = clamp(value, spec.min, spec.max)
    if (spec.kind === 'vector' && Array.isArray(value)) out[spec.key] = value.map((v) => clamp(v, spec.min, spec.max))
  }
  return out
}

function axis(radius: number, aniso: number, angle: number): number[] {
  const a = (angle * Math.PI) / 180
  const stretch = Math.sqrt(Math.max(aniso, 1e-3))
  return [Math.cos(a), Math.sin(a), 1 / Math.max(radius * stretch, 1e-4), stretch / Math.max(radius, 1e-4)]
}

const scale = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k]
const luminance = (c: Rgb) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** 1 for a glow with its own haze (it sits in front), 0 for a glow without (it sits behind the others' haze). */
function inFront(haze: number): number {
  const t = clamp(haze / 0.2, 0, 1)
  return t * t * (3 - 2 * t)
}

/**
 * Share of the glow's extra lightness above the default Intensity that its bridge light may follow.
 * None: a bridge as light as the whitening core reads as a white rim around it.
 */
const BRIDGE_RISE = 0
/** Highest Oklab L a bridge aims for, so the bridge to a very light glow (Lime) stays pale and colored, not white. */
const BRIDGE_MAX_L = 0.9
/** Oklab chroma a pack bridge brings the blend down to where it can: bridges between blue and warm are near neutral. */
const BRIDGE_MAX_C = 0.06
/**
 * A light whose hex is darker than this (Tan, Orange-red) and that meets the sky through a bridge gets a
 * stronger core, by CORE_LIFT per unit of Oklab L short, so its brightest point stays above its pale
 * bridge (BloomsLayout.bridgeFloor) and the light rises toward its source instead of standing flat at
 * the bridge's lightness.
 */
const CORE_ABOVE_BRIDGE = 0.86
const CORE_LIFT = 10
const MAX_CORE = 2

/**
 * Bridge light for one glow, per unit of its tint, solved at this Intensity's
 * sky and glow, so the blend stays pale on a dusk sky too. Above the default
 * Intensity the blend midpoint gets at most BRIDGE_RISE of the extra
 * lightness, so the bridge stays pale and colored and only the glow core goes
 * white.
 */
function bridgeLight(sky: Rgb, light: Rgb, tint: Rgb, haze: number, intensity: number, skyGain: number, glowGain: number, floor: number): number {
  const lighter = (s: Rgb, g: Rgb) => Math.max(linearToOklab(s)[0], linearToOklab(g)[0])
  const litSky = scale(sky, skyGain)
  const litGlow = scale(light, glowGain)
  // The floor holds above the default too, so the bridge fades out as the blend gets light by itself, not at once.
  const atDefault = Math.max(Math.min(lighter(sky, light), BRIDGE_MAX_L), floor)
  const above = atDefault + BRIDGE_RISE * Math.max(0, lighter(litSky, litGlow) - atDefault)
  // The aim moves from BRIDGE_MAX_L to `above` between Intensity 0.5 and 0.65, so no step jumps.
  const t = clamp((intensity - 0.5) / 0.15, 0, 1)
  // A pack bridge (one with a floor) is also near neutral; the 1:1 presets keep their fitted bridges.
  return bridgeAmount(litSky, litGlow, tint, haze, lerp(BRIDGE_MAX_L, above, t * t * (3 - 2 * t)), floor, floor > 0 ? BRIDGE_MAX_C : Infinity)
}

/**
 * Intensity is daylight. The sky gains more than the glows (twilight skies
 * dim fastest overhead), so more light brightens the whole frame and the top
 * included, while the glows only whiten close to where they come from. At
 * 0.5 both gains are 1, so a flat sky is its exact hex. Toward 0 the sky
 * dims while the glows keep their brightness but shrink, and their warm light
 * turns a deeper hue at the same luminance, as the light of a lower sun does
 * (dimmed, Yellow reads dark gold); toward 1 they shrink a little, so the
 * whitened part stays near the source.
 */
function layoutUniforms(layout: BloomsLayout, colors: readonly Rgb[], intensity: number, seed: number): UniformMap {
  const skyGain = 2 ** ((intensity - 0.5) * 1.6)
  // Above the default the glow's body gains little: the extra light goes to its core (layout.core), so a
  // glow brightens toward its source and goes white there instead of whitening flat across its middle.
  const lightGain = intensity < 0.5 ? 1 : 2 ** ((intensity - 0.5) * 0.3)
  const reach = 1 - 0.14 * Math.max(0, 1 - 2 * intensity) - 0.08 * Math.max(0, 2 * intensity - 1)
  const depth = 1 + 0.8 * Math.max(0, 0.5 - intensity)
  const paleLight = 1 - 0.45 * Math.max(0, 2 * intensity - 1)
  const slot = (index: number) => colors[clamp(Math.round(index), 0, SLOT_COUNT - 1)]
  const sky = colors[SLOT.sky]
  const skyPale = skyPaleTint(sky)
  const deep = slot(layout.zenith.color)
  const glowColor: number[] = []
  const glowTail: number[] = []
  const glowLow: number[] = []
  const glowWarm: number[] = []
  const glowCore: number[] = []
  const glowCoreTint: number[] = []
  const glowShape: number[] = []
  const glowAxis: number[] = []
  const glowEdge: number[] = []
  const glowDeepFade: number[] = []
  const glowBridge: number[] = []
  const glowLobes: number[] = []
  const glowLobeFalloff: number[] = []
  const glowBend: number[] = []
  for (let i = 0; i < GLOW_COUNT; i++) {
    const glow = layout.glows[i]
    const lobe = lobes(glow?.vary ?? 0, seed, i)
    glowLobes.push(...lobe.shape)
    glowLobeFalloff.push(...lobe.falloff)
    glowBend.push(glow?.bend ?? 0)
    if (!glow) {
      glowColor.push(0, 0, 0)
      glowTail.push(0, 0, 0)
      glowLow.push(0, 0, 0)
      glowWarm.push(0)
      glowCore.push(0)
      glowCoreTint.push(0, 0, 0)
      glowShape.push(0, 0, 2, 0)
      glowAxis.push(1, 0, 1, 1)
      glowEdge.push(0, 1, 0, 0)
      glowDeepFade.push(0)
      glowBridge.push(0, 0, 0)
      continue
    }
    const base = slot(glow.color)
    const deepened = deepen(base, depth)
    const light = scale(isWarm(base) ? scale(deepened, luminance(base) / Math.max(luminance(deepened), 1e-6)) : base, glow.gain)
    // A glow's haze may hide at most as much sky light as the glow itself adds, so haze does not darken
    // the frame; only below the glow's center, where the light crosses more air, it hides a little more.
    // Both at this Intensity's gains: with more daylight the sky gains more than the glows, and a core
    // whose haze hid more sky than it adds would sit darker than its own rim. A light brighter than the
    // sky may hide all of it; a dimmer one only as much as it adds: 1 - exp(-haze) <= its share.
    const front = inFront(glow.haze)
    const gain = skyGain + (lightGain - skyGain) * front
    const share = (luminance(light) * gain) / Math.max(luminance(sky) * skyGain, 1e-4)
    const haze = share >= 0.99 ? glow.haze : Math.min(glow.haze, -Math.log(1 - share))
    glowColor.push(...scale(light, gain))
    // Where the sky still shows through, the light of a glow whose hue is far from the sky's (or of
    // near-white light) pales the sky without turning its hue, at the same luminance, so a warm or
    // white glow meets blue through pale blue, not a lavender ring. Above the default Intensity the
    // sky is already light there, and that much pale light would whiten into a rim around the core.
    const y = luminance(light) * gain * paleLight
    const tailShare = otherHue(sky, light)
    glowTail.push(...light.map((c, ch) => c * gain * (1 - tailShare) + skyPale[ch] * y * tailShare))
    // A muted warm light (Tan) has no deeper member that is still a light: deepened, it reads brown, so it
    // keeps its own color low down and over a deep area.
    const lab = linearToOklab(base)
    const muted = isWarm(base) && Math.hypot(lab[1], lab[2]) < MUTED_CHROMA
    // A warm light's deeper member keeps its luminance, so its low side is a brighter amber, not a dark one.
    const deeper = deepMember(light)
    const lowLight = isWarm(base) ? scale(deeper, luminance(light) / Math.max(luminance(deeper), 1e-6)) : deeper
    glowLow.push(...scale(muted ? light : lowLight, gain))
    glowWarm.push(isWarm(base) && !muted ? 1 : 0)
    // Only a light has a source to brighten toward; a patch of sky or a pack grey stays soft throughout.
    const short = bridgeGate(sky, light) * Math.max(0, CORE_ABOVE_BRIDGE - linearToOklab(base)[0])
    const core = isSourceLight(glow.color, base) ? Math.min(MAX_CORE, layout.core * (1 + CORE_LIFT * short)) : 0
    glowCore.push(core)
    const tint = bridgeTint(light)
    glowCoreTint.push(...scale(tint, luminance(light) * gain))
    glowShape.push(glow.at[0], glow.at[1], glow.beta, haze)
    glowAxis.push(...axis(glow.radius * reach, glow.aniso, glow.angle))
    glowEdge.push(glow.vary, 1.15, 1.7 * i + 0.3, front)
    glowDeepFade.push(deepFade(sky, deep, light))
    // A dim glow's bridge stays below its own brightest point, so it never gets a pale ring lighter than itself.
    const floor = Math.min(layout.bridgeFloor, linearToOklab(scale(light, gain * (1 + core)))[0] - 0.04)
    const amount = front * layout.bridge * bridgeLight(sky, light, tint, haze, intensity, skyGain, gain, floor)
    glowBridge.push(...scale(tint, amount))
  }
  const z = layout.zenith
  const zenithLobes = lobes(ZENITH_VARY, seed, ZENITH_LOBE_INDEX)
  return {
    uSky: scale(sky, skyGain),
    uDeep: scale(slot(z.color), skyGain),
    uSkyRamp: [layout.sky.top, layout.sky.mid, layout.sky.tilt, layout.sky.vary],
    uSkyTurn: [Math.cos((layout.sky.turn * Math.PI) / 180), Math.sin((layout.sky.turn * Math.PI) / 180)],
    uSkyVeil: [...scale(skyPale, luminance(scale(sky, skyGain))), layout.sky.veil],
    uSkyLine: layout.sky.line ? [...layout.sky.line.from, ...layout.sky.line.to] : [0.5, 1, 0.5, 0],
    uSkyLineOn: layout.sky.line ? 1 : 0,
    uHazeFloor: clamp(layout.hazeFloor, 0, 1),
    uBridgeSky: clamp(layout.bridgeSky, 0, 1),
    uZenithShape: [z.at[0], z.at[1], clamp(z.amount, 0, 2), z.falloff],
    uZenithHold: clamp(z.hold, 0, 1),
    uZenithMeet: clamp(z.meet, 0, 0.9),
    uZenithAxis: axis(z.radius, z.aniso, z.angle),
    uZenithLobe: zenithLobes.shape,
    uZenithLobeFalloff: zenithLobes.falloff,
    uGlowCount: layout.glows.length,
    uGlowColor: glowColor,
    uGlowTail: glowTail,
    uGlowLow: glowLow,
    uGlowWarm: glowWarm,
    uGlowCore: glowCore,
    uGlowCoreTint: glowCoreTint,
    uGlowDeepFade: glowDeepFade,
    uGlowShape: glowShape,
    uGlowAxis: glowAxis,
    uGlowEdge: glowEdge,
    uGlowBridge: glowBridge,
    uGlowLobe: glowLobes,
    uGlowLobeFalloff: glowLobeFalloff,
    uGlowBend: glowBend,
    uWarp: [layout.warp, layout.warpScale],
  }
}

/** Pack colors darker than this Oklab L are grounds the sky deepens toward, not lights. */
const DARK_L = 0.45

/** Oklab chroma under which a warm light is muted (Tan), with no deeper member that still reads as a light. */
const MUTED_CHROMA = 0.1

/**
 * The colors by role: Meta Blue for the sky, the pack's dark colors (in pack
 * order) as the colors the sky deepens toward, and the two lightest other
 * colors as lights. A pack with no dark colors deepens toward no light
 * (black), so its sky only gets darker.
 */
function rolesFromPack(pack: ColorPack): string[] {
  const [sky, ...rest] = pack.colors.map((c) => c.hex)
  const lightness = (hex: string) => linearToOklab(hexToLinear(hex))[0]
  const dark = rest.filter((hex) => lightness(hex) < DARK_L)
  const lights = rest.filter((hex) => lightness(hex) >= DARK_L).sort((a, b) => lightness(b) - lightness(a))
  const light1 = lights[0] ?? sky
  const light2 = lights[1] ?? light1
  return [sky, dark[0] ?? NO_LIGHT, dark[1] ?? dark[0] ?? NO_LIGHT, light1, light2]
}

/**
 * No horizon: a Meta Blue sky with up to four wide, flat glows coming from
 * off-frame and the sky deepening away from the light. Light adds in linear
 * light; where a glow meets the sky a pale bridge light is added so the blend
 * is lighter and near neutral, never grey. A shared low-frequency warp bends
 * every edge; each glow's edge also wanders across its long axis by the shared
 * boundary field (boundary.ts) and softens unevenly along its arc.
 */
export const sunsetBlooms: RecipeDefinition = {
  id: 'sunset.blooms',
  mood: 'sunset',
  label: 'Blooms',
  colorSlots: [
    { key: 'sky', label: 'Sky' },
    { key: 'deep1', label: 'Deep 1' },
    { key: 'deep2', label: 'Deep 2' },
    { key: 'light1', label: 'Light 1' },
    { key: 'light2', label: 'Light 2' },
  ],
  defaultColors: ['#0064E0', '#000000', '#000000', '#FFD61E', '#1FCDF0'],
  params: PARAMS,
  fragment: `${BOUNDARY_GLSL}
#define GLOW_COUNT ${GLOW_COUNT}
#define LOBES ${LOBES}
#define TAIL_END ${TAIL_END.toFixed(2)}
#define LOW_HAZE 1.5
#define CORE_RADIUS 0.3
#define BEHIND_REACH 1.0
#define BLOOM_MINOR_REF ${BLOOM_MINOR_REF.toFixed(6)}
#define BLOOM_ROW ${BLOOM_ROW.toFixed(6)}
uniform float uLens;                  // 1: seen through the scatter lens (pack output); 0: drawn directly (1:1 presets)
uniform float uGlowCore[GLOW_COUNT];  // light in a narrower core at each glow's source, over its peak
uniform vec3 uGlowCoreTint[GLOW_COUNT]; // color of that core light, the light's pale tint at its body's luminance
uniform vec3 uSky;
uniform vec3 uDeep;
uniform vec4 uSkyRamp;                // stops darker at the top, height of the exact hex, tilt, light variation
uniform vec2 uSkyTurn;                // cos, sin of the angle the sky ramp is turned by about the frame middle
uniform vec4 uSkyVeil;                // pale light in the sky's own hue at the sky's luminance, and how much of it toward the light
uniform vec4 uSkyLine;                // a dragged line's start and end (frame fractions) the sky darkens along, with uSkyLineOn
uniform float uSkyLineOn;
uniform float uHazeFloor;             // 1: the glows' haze hides at most as much sky light as they add (0: no limit)
uniform float uBridgeSky;             // 1: on the sky side a bridge is pale light of the sky's hue (0: the lights' tint throughout)
uniform vec4 uZenithShape;           // center (frame fractions), amount, falloff exponent
uniform float uZenithHold;           // 1: the deep area keeps its hex under the darker top; 0: it darkens with the sky
uniform float uZenithMeet;           // share of the blue's light taken away where the deep area comes in
uniform vec4 uZenithAxis;            // cos, sin, 1 / long radius, 1 / short radius
uniform vec4 uZenithLobe[LOBES];     // offset along and across (in radii), 1 / size, weight
uniform float uZenithLobeFalloff[LOBES];
uniform int uGlowCount;
uniform vec3 uGlowColor[GLOW_COUNT];
uniform vec3 uGlowTail[GLOW_COUNT];   // color of the faint outer light toward the open sky
uniform vec3 uGlowLow[GLOW_COUNT];    // the glow's deeper member, for its lower side and over a deep area
uniform float uGlowWarm[GLOW_COUNT];  // 1 for warm light, whose lower part takes the deeper member
uniform float uGlowDeepFade[GLOW_COUNT]; // how far the glow's hue is from the deepened sky's, 0..1
uniform vec4 uGlowShape[GLOW_COUNT];  // center (frame fractions), falloff exponent, haze
uniform vec4 uGlowAxis[GLOW_COUNT];   // cos, sin, 1 / long radius, 1 / short radius
uniform vec4 uGlowEdge[GLOW_COUNT];   // edge variation, its frequency, its phase, in front 0..1
uniform vec3 uGlowBridge[GLOW_COUNT];
uniform vec4 uGlowLobe[GLOW_COUNT * LOBES];
uniform float uGlowLobeFalloff[GLOW_COUNT * LOBES];
uniform float uGlowBend[GLOW_COUNT];
uniform vec2 uWarp;                   // amount, frequency

// Three smooth 1D noises in -1..1 from one pair of hashed lattice values.
vec3 noise1x3(float x, int seed) {
  float i = floor(x);
  float f = x - i;
  float u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  ivec2 c = ivec2(int(i), 0);
  return mix(hash3(c, seed), hash3(c + ivec2(1, 0), seed), u) * 2.0 - 1.0;
}

// Two smooth 2D noises in about -1..1: gradient noise with gradients straight from the hash, no trigonometry.
vec2 noise2x2(vec2 p, int seed) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = quintic(f);
  ivec2 c = ivec2(i);
  vec4 g00 = vec4(hash3(c, seed).xy, hash3(c, seed + 1).xy) * 2.0 - 1.0;
  vec4 g10 = vec4(hash3(c + ivec2(1, 0), seed).xy, hash3(c + ivec2(1, 0), seed + 1).xy) * 2.0 - 1.0;
  vec4 g01 = vec4(hash3(c + ivec2(0, 1), seed).xy, hash3(c + ivec2(0, 1), seed + 1).xy) * 2.0 - 1.0;
  vec4 g11 = vec4(hash3(c + ivec2(1, 1), seed).xy, hash3(c + ivec2(1, 1), seed + 1).xy) * 2.0 - 1.0;
  vec2 f10 = f - vec2(1.0, 0.0);
  vec2 f01 = f - vec2(0.0, 1.0);
  vec2 f11 = f - vec2(1.0, 1.0);
  vec2 n00 = vec2(dot(g00.xy, f), dot(g00.zw, f));
  vec2 n10 = vec2(dot(g10.xy, f10), dot(g10.zw, f10));
  vec2 n01 = vec2(dot(g01.xy, f01), dot(g01.zw, f01));
  vec2 n11 = vec2(dot(g11.xy, f11), dot(g11.zw, f11));
  return 1.7 * mix(mix(n00, n10, u.x), mix(n01, n11, u.x), u.y);
}

// Where (1 + x^2)^-b falls to half.
float halfReach(float b) { return sqrt(exp2(1.0 / b) - 1.0); }

// Light from an extended source: a few lobes spread along a rotated, stretched
// axis, added up, each a power-law falloff whose tail fades out by about two
// and a half radii (so the sky beyond keeps its exact color). The long axis
// bows, the length along it drifts across it, the falloff exponent drifts
// along the edge, and the warp grows with distance from the source. A glow
// (shortUnit > 0) also moves across its long axis by the shared boundary
// field, scaled to its own minor radius and read on its own rows, and its
// falloff softens and hardens along the arc around a fixed half-brightness
// edge, so its edges wander and soften unevenly and its inner and outer
// edges move apart.
float bloom(vec2 P, vec2 warp, vec2 center, vec4 axis, vec2 stretch, float beta, vec3 edge, float bend, int index, float shortUnit, vec4 lobe[LOBES], float falloff[LOBES], float core, out float corePart) {
  vec2 scaleAxes = vec2(axis.z * stretch.x, axis.w * stretch.y);
  vec2 d0 = P - center;
  float reach0 = length(vec2(dot(d0, axis.xy), dot(d0, vec2(-axis.y, axis.x))) * scaleAxes);
  vec2 d = d0 + warp * (0.6 + 0.8 * smoothstep(0.0, 2.5, reach0));
  float along = dot(d, axis.xy) * scaleAxes.x;
  float across = dot(d, vec2(-axis.y, axis.x)) * scaleAxes.y;
  across -= bend * along * along;
  float soft = 1.0;
  if (shortUnit > 0.0) {
    // Along the glow in short-side units from the frame center; across it in units the field was calibrated for.
    // A glow larger than the calibrated size moves no further than one of that size, and the movement fades
    // into the faint outer light, which scatters from the whole source and so is smoother than its edge.
    float a = dot(P, axis.xy) * shortUnit;
    float minorShort = shortUnit / scaleAxes.y;
    float fade = 1.0 / (1.0 + across * across * 0.25);
    float row = float(min(index, GLOW_COUNT)) * BLOOM_ROW;
    across += boundaryWarp(a, across * BLOOM_MINOR_REF + row) * fade * inversesqrt(BLOOM_MINOR_REF * max(BLOOM_MINOR_REF, minorShort));
    soft = boundarySoftAt(a, float(index), 0.0);
  }
  float alongNoise = noise1x3(along * edge.y + edge.z, uSeed + 101 + 7 * index).y;
  float acrossNoise = noise1x3(across * 1.3 + edge.z, uSeed + 307 + 7 * index).x;
  float length = exp(0.3 * edge.x * acrossNoise);
  float b0 = beta * (1.0 + 0.22 * edge.x * alongNoise);
  float b = clamp(b0 / soft, 1.1, 5.0);
  float keepHalf = halfReach(b) / halfReach(b0);
  keepHalf *= keepHalf;
  along /= length;
  float sum = 0.0;
  for (int j = 0; j < LOBES; j++) {
    vec2 q = (vec2(along, across) - lobe[j].xy) * lobe[j].z;
    float d2 = dot(q, q);
    // (1 + d2)^(-b) times the tail fade exp(-(d2 / TAIL_END)^2), as one exp2.
    sum += lobe[j].w * exp2(-b * falloff[j] * log2(1.0 + d2 * keepHalf) - d2 * d2 * (1.4426950 / (TAIL_END * TAIL_END)));
  }
  // A narrower core where the light comes from: brightness keeps rising toward the source and goes
  // white there, instead of standing flat across the glow, and the color stays in the falloff.
  float c2 = (along * along + across * across) * (keepHalf / (CORE_RADIUS * CORE_RADIUS));
  corePart = core * exp2(-2.0 * b * log2(1.0 + c2));
  return sum + corePart;
}

vec3 bloomsScene(vec2 uv) {
  vec2 frame = uFrameAspect * inversesqrt(uFrameAspect.x * uFrameAspect.y);
  vec2 P = (uv - 0.5) * frame;
  // Taller frames get taller, less stretched glows (radius x tall, width / height / tall).
  float tall = clamp(pow(uFrameAspect.y / uFrameAspect.x / 0.5625, 0.25), 0.8, 1.5);
  vec2 stretch = vec2(inversesqrt(tall), pow(tall, -1.5));
  vec2 warp = uWarp.x * noise2x2(P * uWarp.y + vec2(3.7, 1.9), uSeed + 11);

  // The darkening is sized by the short side, so it stays in its corner in every format.
  float shortUnit = 1.0 / min(frame.x, frame.y);
  vec4 lobe[LOBES];
  float falloff[LOBES];
  for (int j = 0; j < LOBES; j++) {
    lobe[j] = uZenithLobe[j];
    falloff[j] = uZenithLobeFalloff[j];
  }
  // The deep area's edge drifts like a glow's, on the field row after the glows'.
  float noCore;
  float z = min(1.0, uZenithShape.z * bloom(P, warp, (uZenithShape.xy - 0.5) * frame, uZenithAxis, vec2(shortUnit), uZenithShape.w, vec3(0.5, 1.1, 2.3), 0.0, 9, shortUnit, lobe, falloff, 0.0, noCore));
  // The sky keeps changing up to the top edge: it is its exact hex along a mid-sky line (tilted, and
  // bent by the shared warp) and above it gets darker without changing hue; a dark pack color comes in
  // only where it is already dark, so blue and it meet without a lighter purple or teal band between.
  // It also varies slowly in brightness, with the hex at the mean.
  // The ramp is read in a frame turned by uSkyTurn (in short-side units, so the turn keeps its angle).
  vec2 turned = vec2(uSkyTurn.x * P.x - uSkyTurn.y * P.y, uSkyTurn.y * P.x + uSkyTurn.x * P.y) / frame + 0.5;
  float vSky = turned.y + uSkyRamp.z * (turned.x - 0.5) + warp.y / frame.y;
  // The length (frame units) the ramp runs over, for the drift of its levels: the frame's height, or a line's.
  float span = frame.y;
  if (uSkyLineOn > 0.5) {
    // Along a dragged line the sky is palest at its start, where the light is, and reaches the far sky at its
    // end. Behind the start it deepens slowly with distance, reaching the far sky BEHIND_REACH short sides
    // away, so a light outside the frame pointing away leaves the frame its pale, lit side.
    vec2 F = (uSkyLine.xy - 0.5) * frame;
    vec2 D = (uSkyLine.zw - 0.5) * frame - F;
    float len = max(length(D), 1e-4);
    vec2 dir = D / len;
    float along = dot(P - F, dir);
    float depth = along >= 0.0 ? along / len : -along * shortUnit / BEHIND_REACH;
    span = max(len, BEHIND_REACH / shortUnit);
    vSky = 1.0 - depth + (uSkyRamp.z * dot(P - F, vec2(-dir.y, dir.x)) + warp.y) / span;
  }
  // The line drifts like a glow edge, on the field row after the deep area's, and its lighter and
  // darker levels drift apart, so the darker top has no ruled edge and no parallel steps.
  float fromLine = (vSky - uSkyRamp.y) * span * shortUnit;
  vSky += boundaryWarp(P.x * shortUnit, fromLine + float(GLOW_COUNT + 1) * BLOOM_ROW) / (shortUnit * span);
  float above = clamp((uSkyRamp.y - vSky) / max(uSkyRamp.y, 0.05), 0.0, 1.0);
  float topLight = exp2(-uSkyRamp.x * pow(above, 1.4));
  // With uZenithHold the dark color is the pack's ground, not darker sky: it keeps its hex under the darker
  // top. With uZenithMeet the blue darkens where it comes in, so a dark color of another hue (Plum, Forest)
  // and the blue meet where both are dark, with no lighter purple or teal band between them.
  float meet = 1.0 - uZenithMeet * smoothstep(0.0, 0.6, z);
  vec3 sky = mix(uSky * meet, uDeep * mix(1.0, 1.0 / topLight, uZenithHold), z);
  sky *= topLight * exp(uSkyRamp.w * 3.0 * noise2x2(P * 2.6 + vec2(7.1, 2.3), uSeed + 23).x);
  // The sky pales toward its light: a veil of pale light in its own hue rises from the line where it is its
  // exact hex toward the light, so full-strength blue is only a band toward the far edge. Not over the dark
  // ground.
  float toLight = clamp((vSky - uSkyRamp.y) / max(1.0 - uSkyRamp.y, 0.05), 0.0, 1.0);
  sky += uSkyVeil.rgb * (uSkyVeil.a * toLight * toLight * (3.0 - 2.0 * toLight) * (1.0 - z));

  float k[GLOW_COUNT];
  float kc[GLOW_COUNT];
  float low[GLOW_COUNT];
  float ext = 0.0;
  for (int i = 0; i < GLOW_COUNT; i++) {
    k[i] = 0.0;
    kc[i] = 0.0;
    low[i] = 0.0;
    if (i < uGlowCount) {
      for (int j = 0; j < LOBES; j++) {
        lobe[j] = uGlowLobe[i * LOBES + j];
        falloff[j] = uGlowLobeFalloff[i * LOBES + j];
      }
      k[i] = bloom(P, warp, (uGlowShape[i].xy - 0.5) * frame, uGlowAxis[i], stretch, uGlowShape[i].z, uGlowEdge[i].xyz, uGlowBend[i], i, shortUnit, lobe, falloff, uGlowCore[i], kc[i]);
      vec2 c = (uGlowShape[i].xy - 0.5) * frame;
      low[i] = smoothstep(-0.25, 1.0, (P.y - c.y) * uGlowAxis[i].w * stretch.y);
      // Low down the light passes through more air, which hides more of the sky behind it. Not where the sky
      // below it is the deep sky (a light above the frame): hiding the deep blue leaves a dim warm light, dark gold.
      ext += uGlowShape[i].w * k[i] * k[i] * (1.0 + LOW_HAZE * low[i] * (1.0 - above));
    }
  }
  float T = exp(-ext);
  vec3 behind = sky;
  vec3 front = vec3(0.0);
  float lit = 0.0;
  vec3 bridge = vec3(0.0);
  float deepArea = z * z * z;
  // A held deep area is the pack's dark ground in front of the sky: the glows' light stops at it, so the
  // ground keeps its hex.
  float ground = 1.0 - uZenithHold * smoothstep(0.0, 0.5, z);
  for (int i = 0; i < GLOW_COUNT; i++) {
    if (i >= uGlowCount) break;
    // A glow shows its own color where it outweighs the sky; where the sky still shows through, its
    // light pales the sky in the sky's own hue and meets it through the pale bridge, so warm or
    // white light over blue never reads lavender. Low down a warm glow's own color is its deeper
    // member, so it keeps its chroma toward the horizon. Over a deep area the faint light is the
    // deeper member too, added as light: pink-white turns coral and makes violet over indigo.
    // A glow is a light: its core and inner body keep their brightness wherever it sits, so its brightest
    // part is at least as light as its own hex and only goes toward white. Over a deep sky its own color
    // keeps to its middle and its edge is its pale faint light, still lit, so it fades through pale light,
    // never dark gold, olive or brown. Farther out its light dims with the sky as before, so the deep sky
    // stays deep and the blue and a dark ground meet where both are dark. The deeper member on the low side
    // belongs to a low sun over the pale horizon sky; over deep sky the light keeps its own color to its edge.
    float deepLit = mix(1.0, topLight, uGlowDeepFade[i]);
    float bodyLit = mix(deepLit, 1.0, smoothstep(0.35, 0.7, k[i]));
    float edgeLit = mix(deepLit, 1.0, smoothstep(0.15, 0.3, k[i]) * (1.0 - smoothstep(0.5, 0.8, k[i])));
    // Against a sky much dimmer than the light, its own color keeps to where it is bright.
    float skyRel = dot(sky, vec3(0.2126, 0.7152, 0.0722)) / max(dot(uGlowColor[i], vec3(0.2126, 0.7152, 0.0722)), 1e-4);
    float bodyShare = smoothstep(mix(0.5, 0.15, smoothstep(0.45, 1.0, skyRel) * deepLit), 0.8, k[i]);
    vec3 body = mix(uGlowColor[i], uGlowLow[i], low[i] * uGlowWarm[i] * toLight);
    vec3 faint = mix(uGlowTail[i], uGlowLow[i], deepArea);
    // The core is the light's own pale tint, so an overexposed source whitens the way fire does (Orange-red
    // through yellow-white), not through pink.
    vec3 light = (mix(faint * edgeLit, body * bodyLit, bodyShare) * (k[i] - kc[i]) + uGlowCoreTint[i] * kc[i]) * ground;
    float f = uGlowEdge[i].w;
    behind += (1.0 - f) * light;
    front += f * light;
    lit += f * k[i];
    // The pale light where a glow meets the sky is its own light, so it does not dim with the deeper sky: dimmed,
    // warm light and blue meet in a grey. Near a held dark ground it still dims with the sky, so it lays no grey
    // veil over the ground's soft edge.
    float bridgeLit = mix(1.0, deepLit, uZenithHold * smoothstep(0.0, 0.3, z));
    bridge += uGlowBridge[i] * (k[i] * bridgeLit * ground * (1.0 - deepArea));
  }
  // The glows' haze is lit by their light, so it hides at most as much of the sky's light as they add: no
  // ring darker than the open sky around a glow, below it or where the sky is pale.
  if (uHazeFloor > 0.0) {
    vec3 luma = vec3(0.2126, 0.7152, 0.0722);
    float need = (dot(sky, luma) - dot(front, luma)) / max(dot(behind, luma), 1e-5);
    T = mix(T, max(T, clamp(need, 0.0, 1.0)), uHazeFloor);
  }
  // Pale light where the glows and the sky weigh about the same, reaching further out on the sky
  // side, where faint warm light over blue would read as a lavender ring; zero at both ends, and
  // overlapping glows share one bridge instead of stacking theirs.
  float t = lit / (lit + T);
  t = t < 0.5 ? 0.5 * pow(2.0 * t, 0.7) : t;
  float bell = 4.0 * t * (1.0 - t);
  vec3 pale = bridge / max(lit, 1e-4) * bell * sqrt(bell);
  // On the sky side the bridge is pale light of the sky's own hue and on the light side the lights' own pale
  // tint, so the blend runs from pale blue through near-white to the light's tint, not through lavender.
  pale = mix(pale, uSkyVeil.rgb / max(dot(uSkyVeil.rgb, vec3(0.2126, 0.7152, 0.0722)), 1e-5) * dot(pale, vec3(0.2126, 0.7152, 0.0722)), uBridgeSky * (1.0 - smoothstep(0.3, 0.6, t)));
  front += pale;
  return behind * T + front;
}

// With a lens (pack output) the scene is drawn into the scatter source and seen only through the one
// out-of-focus lens, so every bloom shares one softness floor; without one (1:1 presets) it is drawn directly.
vec3 radiance(vec2 uv, vec2 p) {
  return uLens > 0.0 ? vec3(0.0) : bloomsScene(uv);
}

vec3 auxRadiance(vec2 uv, vec2 p) {
  return uLens > 0.0 ? bloomsScene(uv) : vec3(0.0);
}

vec3 combine(vec2 uv, vec2 p, vec3 direct, vec3 seen) {
  return uLens > 0.0 ? seen : direct;
}
`,
  uniforms: (ctx) => ({
    ...layoutUniforms(readLayout(ctx), ctx.colors, ctx.num('intensity'), ctx.seed),
    ...bloomBoundaryUniforms(BLOOM_BOUNDARY, ctx.aspect, ctx.seed),
    uLens: ctx.num('lensRadius') > 0 ? 1 : 0,
  }),
  scatter: [LENS],
  radianceScale: 0.5,
  lens: { bloom: 0.12, bloomRadius: 0.75, bloomWidth: 1.5 },
  fromPack: rolesFromPack,
  compose: ({ pack, controls, seed, aspect }): Composition => {
    const colors = rolesFromPack(pack)
    const layout = composeLayout(
      colors.map(hexToLinear),
      seed,
      { intensity: controls.intensity, softness: controls.softness, rise: controls.mood, drag: controls.drag },
      aspect,
    )
    const soft = clamp(controls.softness, 0, 1)
    return {
      colors,
      // One lens over the whole scene: Softness is its radius.
      params: { intensity: clamp(controls.intensity, 0, 1), ...layoutParams(layout), lensRadius: lerp(0.045, 0.12, soft) },
      lens: { bloom: 0.07 + 0.12 * soft, bloomRadius: 0.66 + 0.2 * soft },
      output: {},
    }
  },
}
