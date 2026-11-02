import type { ColorPack } from '../../color/packs'
import type { Rgb } from '../../color/srgb'
import type { NumberParam, ParamSpec, RecipeContext, RecipeDefinition, UniformMap, VectorParam } from '../../scene'
import { composeRamp, rampPackColors } from './ramp-compose'
import { GLOW_LAYERS, RAMP_COLORS, RAMP_EDGES, RAMP_FRAGMENT, SUN_LAYERS } from './ramp-shader'

const num = (key: string, label: string, min: number, max: number, step: number, value: number): NumberParam => ({
  kind: 'number',
  key,
  label,
  min,
  max,
  step,
  default: value,
})

const vec = (key: string, label: string, min: number, max: number, step: number, value: number[]): VectorParam => ({
  kind: 'vector',
  key,
  label,
  min,
  max,
  step,
  default: value,
})

const EDGE_AT = [-1.4, -0.75, -0.32, -0.1, 0, 0.12, 0.3]
const EDGE_WIDTH = [0.9, 0.5, 0.22, 0.08, 0.05, 0.12, 0.3]

const PARAMS: ParamSpec[] = [
  vec('anchor', 'Anchor', -2, 3, 0.005, [0.5, 0.78]),
  num('angle', 'Tilt', -60, 60, 0.1, 0),
  num('drop', 'Edge drop', -0.6, 0.6, 0.001, 0),
  num('stops', 'Stops', 1, RAMP_COLORS, 1, 5),
  ...EDGE_AT.map((value, i) => num(`at${i + 1}`, `Edge ${i + 1} at`, -4, 4, 0.001, value)),
  ...EDGE_WIDTH.map((value, i) => num(`width${i + 1}`, `Edge ${i + 1} width`, 0.004, 2, 0.001, value)),
  ...Array.from({ length: RAMP_COLORS }, (_, i) => num(`gain${i + 1}`, `Stop ${i + 1} gain`, 0, 4, 0.005, 1)),
  num('horizonEdge', 'Horizon edge (0: the anchor line)', 0, RAMP_EDGES, 1, 0),
  num('warp', 'Horizon warp', 0, 1.5, 0.001, 0.02),
  num('warpScale', 'Horizon warp scale', 0.05, 8, 0.01, 1.4),
  num('warpPhase', 'Horizon warp phase', -20, 20, 0.01, 0),
  num('warpOctaves', 'Horizon warp octaves', 1, 3, 1, 3),
  num('warpReach', 'Horizon warp reach', 0.02, 3, 0.005, 0.2),
  num('softVary', 'Horizon softness change', 0, 1.5, 0.005, 0.4),
  num('softScale', 'Horizon softness scale', 0.05, 8, 0.01, 1),
  num('softReach', 'Horizon softness reach', 0.02, 3, 0.005, 0.2),
  num('drift', 'Edge drift', 0, 0.6, 0.001, 0.06),
  num('driftScale', 'Edge drift scale', 0.1, 8, 0.01, 1.4),
  num('vary', 'Edge width change', 0, 1.5, 0.005, 0.25),
  num('softness', 'Extra softness', 0, 0.4, 0.001, 0),
  num('hazeScale', 'Haze scale', 0.2, 10, 0.01, 2),
  num('hazeStretch', 'Haze stretch', 0.3, 8, 0.01, 3),
  num('hazeWarp', 'Haze warp', 0, 0.15, 0.0005, 0),
  num('hazeLight', 'Haze light', 0, 0.4, 0.001, 0),
  vec('sunAt', 'Sun at', -3, 4, 0.005, [0.7, 0.85]),
  num('sunlight', 'Sunlight', 0, 6, 0.005, 0.3),
  num('sunlightWidth', 'Sunlight width', 0.02, 6, 0.005, 0.8),
  num('sunlightHeight', 'Sunlight fade with height (0: none)', 0, 8, 0.005, 0),
  num('sunlightWarmth', 'Sunlight warmth', 0, 1, 0.005, 1),
  num('falloff', 'Sideways falloff exponent', 0.8, 4, 0.01, 1.6),
  num('widen', 'Sideways widening with height', 0, 12, 0.01, 1),
  num('lightTop', 'Sun light fades out by this height (0: no limit)', 0, 4, 0.001, 0),
  num('glow', 'Glow', 0, 8, 0.005, 0.6),
  num('glowOffset', 'Glow line offset', -1.5, 1, 0.001, -0.04),
  num('glowVary', 'Glow reach change along the horizon', 0, 1.5, 0.005, 0),
  num('glowVaryScale', 'Glow reach change scale', 0.1, 8, 0.01, 1.2),
  num('glowLateral', 'Glow sideways falloff', 0, 1, 0.005, 0.7),
  num('glowWidth', 'Glow sideways width', 0.02, 6, 0.005, 0.7),
  num('shadowHeight', 'Far-side glow fades out below this height (0: none)', 0, 1, 0.001, 0),
  ...[1, 2].flatMap((i) => [
    num(`glow${i}Weight`, `Glow layer ${i} weight`, 0, 6, 0.001, i === 1 ? 1 : 0.4),
    num(`glow${i}Up`, `Glow layer ${i} up`, 0.003, 2, 0.001, i === 1 ? 0.12 : 0.4),
    num(`glow${i}Down`, `Glow layer ${i} down`, 0.003, 2, 0.001, i === 1 ? 0.05 : 0.1),
  ]),
  num('extinction', 'Glow extinction', 0, 4, 0.001, 0.4),
  num('horizonDim', 'Skylight dims toward the horizon', 0, 6, 0.005, 0),
  num('horizonDimHeight', 'Skylight dimming height', 0.004, 1, 0.001, 0.05),
  num('reddenDown', 'Deeper toward the horizon', 0, 6, 0.005, 0),
  num('reddenUp', 'Paler above the glow', 0, 0.95, 0.005, 0),
  num('reddenSide', 'Deeper away from the sun', 0, 4, 0.005, 0),
  num('glowPath', 'Glow color path at the glow line', -0.95, 4, 0.005, 0),
  num('sunGlow', 'Sun glow', 0, 6, 0.005, 0),
  ...[1, 2].flatMap((i) => [
    num(`sunGlow${i}Radius`, `Sun glow layer ${i} radius`, 0, 3, 0.001, i === 1 ? 0.12 : 0.45),
    num(`sunGlow${i}Weight`, `Sun glow layer ${i} weight`, 0, 6, 0.001, i === 1 ? 1 : 0.4),
  ]),
  num('sunGlowAspect', 'Sun glow width over height', 0.2, 10, 0.01, 3),
  num('sunGlowBeta', 'Sun glow falloff exponent', 0.4, 6, 0.01, 1.4),
  num('occlude', 'Land hides the sun glow', 0, 1, 0.001, 0.8),
  num('occludeWidth', 'Sun glow hidden edge width', 0.003, 0.8, 0.001, 0.06),
  num('bridge', 'Bridge light', 0, 3, 0.005, 0.5),
  num('bridgeLift', 'Bridge lift', 0, 1, 0.005, 0.25),
  num('bridgeWarmth', 'Bridge warmth', 0, 1, 0.005, 0.5),
  num('bridgeFloor', 'Bridge fades out below this luminance', 0, 1, 0.001, 0),
  num('land', 'Land', 0, 1, 0.005, 0),
  num('landAt', 'Land height', -1, 2, 0.001, 0.85),
  num('landTilt', 'Land slope', -3, 3, 0.001, 0),
  num('landDrop', 'Land edge drop', -1, 1, 0.001, 0),
  num('landWarp', 'Land warp', 0, 1, 0.001, 0.04),
  num('landWarpScale', 'Land warp scale', 0.05, 10, 0.01, 1.6),
  num('landWarpPhase', 'Land warp phase', -20, 20, 0.01, 0),
  num('landOctaves', 'Land warp octaves', 1, 3, 1, 2),
  num('landSoft', 'Land edge width', 0.002, 0.8, 0.001, 0.05),
  num('landSoftVary', 'Land edge width change', 0, 2, 0.005, 0.4),
  num('landTopGain', 'Land top gain', 0, 4, 0.005, 1),
  num('landBottomGain', 'Land bottom gain', 0, 4, 0.005, 0.5),
  num('landDepth', 'Land color depth', 0.005, 4, 0.001, 0.3),
  num('landLight', 'Land light', 0, 6, 0.005, 0),
  num('landLightWidth', 'Land light width', 0.02, 6, 0.005, 0.5),
  num('landLightDepth', 'Land light depth', 0.003, 3, 0.001, 0.08),
]

const COLOR_SLOTS = [
  ...Array.from({ length: RAMP_COLORS }, (_, i) => ({ key: `stop${i + 1}`, label: `Stop ${i + 1}` })),
  { key: 'glow1', label: 'Glow layer 1' },
  { key: 'glow2', label: 'Glow layer 2' },
  { key: 'sunGlow', label: 'Sun glow' },
  { key: 'sunlight', label: 'Sunlight tint' },
  { key: 'landTop', label: 'Land top' },
  { key: 'landBottom', label: 'Land bottom' },
  { key: 'landLight', label: 'Land light' },
]

const luma = (c: Rgb) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
const scale = (c: Rgb, k: number): number[] => [c[0] * k, c[1] * k, c[2] * k]

/** The bridge's neutral at luminance 1, warmed toward a pale member of the glow light's family. */
function bridgeTint(glow: Rgb, warmth: number): number[] {
  const m = Math.max(glow[0], glow[1], glow[2])
  if (!(m > 0) || warmth <= 0) return [1, 1, 1]
  const pale = glow.map((v) => Math.max(v / m, 0.004) ** 0.12) as Rgb
  const tint = [0, 1, 2].map((i) => 1 + (pale[i] - 1) * warmth) as Rgb
  const y = luma(tint)
  return scale(tint, 1 / y)
}

function uniforms(ctx: RecipeContext): UniformMap {
  const edges = Math.max(0, Math.min(RAMP_EDGES, Math.round(ctx.num('stops')) - 1))
  const at = Array.from({ length: RAMP_EDGES }, (_, i) => ctx.num(`at${i + 1}`))
  const horizonEdge = Math.min(Math.round(ctx.num('horizonEdge')) - 1, edges - 1)
  const horizonAt = horizonEdge >= 0 ? at[horizonEdge] : 0
  const near = (reach: number) => at.map((m) => Math.exp(-Math.abs(m - horizonAt) / reach))
  const sunTint = ctx.color('sunlight')
  const warmth = ctx.num('sunlightWarmth')
  const tilt = (ctx.num('angle') * Math.PI) / 180
  const glowIntensity = ctx.num('glow')
  const sunIntensity = ctx.num('sunGlow')
  return {
    uStop: Array.from({ length: RAMP_COLORS }, (_, i) => scale(ctx.colors[i], ctx.num(`gain${i + 1}`))).flat(),
    uEdgeAt: at,
    uEdgeWidth: Array.from({ length: RAMP_EDGES }, (_, i) => ctx.num(`width${i + 1}`)),
    uEdgeWarp: near(ctx.num('warpReach')),
    uEdgeSoft: near(ctx.num('softReach')),
    uEdges: edges,
    uHorizonEdge: horizonEdge,
    uAnchor: ctx.vec('anchor'),
    uAxis: [Math.sin(tilt), Math.cos(tilt)],
    uDrop: ctx.num('drop'),
    uWarp: [ctx.num('warp'), ctx.num('warpScale'), 3.7 + ctx.num('warpPhase'), Math.round(ctx.num('warpOctaves'))],
    uSoftVary: [ctx.num('softVary'), ctx.num('softScale')],
    uDrift: [ctx.num('drift'), ctx.num('driftScale'), ctx.num('vary')],
    uBlur: ctx.num('softness'),
    uHaze: [ctx.num('hazeScale'), ctx.num('hazeStretch'), ctx.num('hazeWarp'), ctx.num('hazeLight')],
    uSunAt: ctx.vec('sunAt'),
    uSunlight: sunTint.map((v) => ctx.num('sunlight') * (1 + (v - 1) * warmth)),
    uSunlightShape: [ctx.num('sunlightWidth'), ctx.num('sunlightHeight')],
    uLateral: [ctx.num('falloff'), ctx.num('widen')],
    uLightTop: ctx.num('lightTop'),
    uGlowColor: [...scale(ctx.color('glow1'), glowIntensity), ...scale(ctx.color('glow2'), glowIntensity)],
    uGlowWeight: [ctx.num('glow1Weight'), ctx.num('glow2Weight')].slice(0, GLOW_LAYERS),
    uGlowTau: [ctx.num('glow1Up'), ctx.num('glow1Down'), ctx.num('glow2Up'), ctx.num('glow2Down')],
    uGlowOffset: ctx.num('glowOffset'),
    uGlowVary: [ctx.num('glowVary'), ctx.num('glowVaryScale')],
    uGlowSpread: [ctx.num('glowLateral'), ctx.num('glowWidth'), ctx.num('shadowHeight')],
    uExtinction: ctx.num('extinction'),
    uHorizonDim: [ctx.num('horizonDim'), ctx.num('horizonDimHeight')],
    uRedden: [ctx.num('reddenDown'), ctx.num('reddenUp'), ctx.num('reddenSide'), ctx.num('glowPath')],
    uSunGlowColor: Array.from({ length: SUN_LAYERS }, (_, i) =>
      scale(ctx.color('sunGlow'), sunIntensity * ctx.num(`sunGlow${i + 1}Weight`)),
    ).flat(),
    uSunGlowRadius: Array.from({ length: SUN_LAYERS }, (_, i) => ctx.num(`sunGlow${i + 1}Radius`)),
    uSunGlowShape: [ctx.num('sunGlowAspect'), ctx.num('sunGlowBeta')],
    uOcclude: [ctx.num('occlude'), ctx.num('occludeWidth')],
    uBridge: [ctx.num('bridge'), ctx.num('bridgeLift'), ctx.num('bridgeFloor')],
    uBridgeTint: bridgeTint(ctx.color('glow1'), ctx.num('bridgeWarmth')),
    uLand: [ctx.num('land'), ctx.num('landAt'), ctx.num('landTilt'), ctx.num('landDrop')],
    uLandWarp: [ctx.num('landWarp'), ctx.num('landWarpScale'), ctx.num('landWarpPhase'), Math.round(ctx.num('landOctaves'))],
    uLandEdge: [ctx.num('landSoft'), ctx.num('landSoftVary'), ctx.num('landDepth')],
    uLandTop: scale(ctx.color('landTop'), ctx.num('landTopGain')),
    uLandBottom: scale(ctx.color('landBottom'), ctx.num('landBottomGain')),
    uLandLightColor: scale(ctx.color('landLight'), ctx.num('landLight')),
    uLandLight: [ctx.num('landLightWidth'), ctx.num('landLightDepth')],
  }
}

/**
 * Sunset sky: a stop ramp in linear light along a tilted, bent axis whose
 * edges drift and change width along their length, lit by one sun (a
 * sideways gain on the sky, a horizon glow and a sun glow, both reddening with
 * path length), with a neutral bridge where different hues mix and an
 * optional land layer in front.
 */
export const sunsetRamp: RecipeDefinition = {
  id: 'sunset.ramp',
  mood: 'sunset',
  label: 'Ramp',
  colorSlots: COLOR_SLOTS,
  defaultColors: rampPackColors('bold', 1),
  params: PARAMS,
  fragment: RAMP_FRAGMENT,
  uniforms,
  fromPack: (pack: ColorPack) => rampPackColors(pack.id, 1),
  compose: ({ pack, controls, seed, aspect }) => composeRamp(pack.id, controls, seed, aspect),
}
