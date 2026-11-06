import type { ColorPack } from '../../color/packs'
import type { Rgb } from '../../color/srgb'
import type { NumberParam, ParamSpec, RecipeContext, RecipeDefinition, ScatterBlur, UniformMap, VectorParam } from '../../scene'
import { gradientNoise, NOISE_RMS } from './boundary'
import { rampBoundary, type RampUniforms } from './ramp-boundary'
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
  num('angle', 'Tilt', -180, 180, 0.1, 0),
  num('drop', 'Edge drop', -0.6, 0.6, 0.001, 0),
  num('stops', 'Stops', 1, RAMP_COLORS, 1, 5),
  ...EDGE_AT.map((value, i) => num(`at${i + 1}`, `Edge ${i + 1} at`, -8, 8, 0.001, value)),
  ...EDGE_WIDTH.map((value, i) => num(`width${i + 1}`, `Edge ${i + 1} width`, 0.004, 6, 0.001, value)),
  vec('edgeShape', "Per edge, its lean and bow at the frame's ends along it (base units), in pairs", -1, 1, 0.001, Array.from({ length: 2 * RAMP_EDGES }, () => 0)),
  vec('glowShape', "The glow line's lean and bow at the frame's ends along it (base units)", -1, 1, 0.001, [0, 0]),
  ...Array.from({ length: RAMP_COLORS }, (_, i) => num(`gain${i + 1}`, `Stop ${i + 1} gain`, 0, 4, 0.005, 1)),
  num('horizonEdge', 'Horizon edge (0: the anchor line)', 0, RAMP_EDGES, 1, 0),
  vec('zenithShade', 'First stop light: change per short side down the ramp, where it is 1, change across the frame, where it is 0', -8, 8, 0.0005, [0, 0, 0, 0]),
  num('zenithFloor', 'First stop least light, as a share of its color', 0.05, 1, 0.005, 0.35),
  num('warp', 'Horizon warp', 0, 1.5, 0.001, 0.02),
  num('warpScale', 'Horizon warp scale', 0.05, 8, 0.01, 1.4),
  num('warpPhase', 'Horizon warp phase', -20, 20, 0.01, 0),
  num('warpOctaves', 'Horizon warp octaves', 1, 3, 1, 3),
  num('warpReach', 'Horizon warp reach', 0.02, 3, 0.005, 0.2),
  num('softVary', 'Horizon softness change', 0, 1.5, 0.005, 0.4),
  num('softScale', 'Horizon softness scale', 0.05, 8, 0.01, 1),
  num('softFollow', 'Horizon softer in troughs, sharper at crests', 0, 12, 0.01, 0),
  num('softReach', 'Horizon softness reach', 0.02, 3, 0.005, 0.2),
  num('drift', 'Edge drift', 0, 0.6, 0.001, 0.06),
  num('driftScale', 'Edge drift scale', 0.1, 8, 0.01, 1.4),
  num('vary', 'Edge width change', 0, 1.5, 0.005, 0.25),
  vec('boundaryWander', 'Shared boundary wander at the sky edge, the glow, the horizon and the ground (all 0: off)', 0, 0.1, 0.0005, [0, 0, 0, 0]),
  vec('boundaryNoise', 'Shared boundary noise: share, lattice, octave gain, rows per lattice', 0, 4, 0.005, [0.35, 0.4, 0.25, 2]),
  vec('boundarySoft', 'Shared boundary softness change: amount, lattice, rows, width above which it shrinks', 0, 2, 0.005, [0.15, 0.5, 0.25, 0.15]),
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
  num('falloffRound', 'Share of the sideways width over which the falloff top is round (0: pointed)', 0, 2, 0.01, 0),
  num('lightTop', 'Sun light fades out by this height (0: no limit)', 0, 8, 0.001, 0),
  num('glow', 'Glow', 0, 8, 0.005, 0.6),
  num('glowOffset', 'Glow line offset', -4, 1, 0.001, -0.04),
  vec('glowEnd', "Depth below the glow line where its lower side ends (0: never), and the width of that fade", 0, 4, 0.001, [0, 0.1]),
  vec('veil', 'White light over the sky: under the far band, more toward the horizon, height over which that extra fades', 0, 4, 0.001, [0, 0, 0.3]),
  vec('veilFar', 'Heights above the horizon between which the veil fades out into the far band of full Meta Blue (0, 0: none)', -8, 8, 0.001, [0, 0]),
  vec('veilTint', "The veil's color away from the light, linear light at luminance 1", 0, 4, 0.001, [1, 1, 1]),
  num('veilMute', "Share of the sky's color the veil greys toward its tint at the same light (0: none)", 0, 1, 0.005, 0),
  num('hazeMass', 'Share by which the veil thickens and thins with the sky masses (0: none)', 0, 2, 0.005, 0),
  num('blueHue', "1: sky blues turned toward violet go back to Meta Blue's hue (pack frames); 0: they keep their hue", 0, 1, 1, 0),
  vec('veilNear', "The veil's color near the light, linear light at luminance 1 (0, 0, 0: the bridge's)", 0, 4, 0.001, [0, 0, 0]),
  num('glowVary', 'Glow reach change along the horizon', 0, 1.5, 0.005, 0),
  num('glowVaryScale', 'Glow reach change scale', 0.1, 8, 0.01, 1.2),
  num('glowArch', 'Glow reaches higher toward the sun', 0, 4, 0.005, 0),
  vec('glowArchShape', "Share of its reach the glow keeps far from the sun, and share of its width over which it rises toward the sun", 0.05, 2, 0.005, [1, 1]),
  num('glowLateral', 'Glow sideways falloff', 0, 1, 0.005, 0.7),
  num('glowWidth', 'Glow sideways width', 0.02, 6, 0.005, 0.7),
  num('shadowHeight', 'Far-side glow fades out below this height (0: none)', 0, 1, 0.001, 0),
  ...[1, 2].flatMap((i) => [
    num(`glow${i}Weight`, `Glow layer ${i} weight`, 0, 6, 0.001, i === 1 ? 1 : 0.4),
    num(`glow${i}Up`, `Glow layer ${i} up`, 0.003, 2, 0.001, i === 1 ? 0.12 : 0.4),
    num(`glow${i}Down`, `Glow layer ${i} down`, 0.003, 2, 0.001, i === 1 ? 0.05 : 0.1),
  ]),
  num('extinction', 'Glow extinction', 0, 4, 0.001, 0.4),
  num('horizonDim', 'Skylight dims toward the horizon', 0, 12, 0.005, 0),
  num('horizonDimHeight', 'Skylight dimming height', 0.004, 4, 0.001, 0.05),
  num('dimBelow', 'Skylight dimming below the horizon edge', 0, 1, 0.005, 1),
  num('reddenDown', 'Deeper toward the horizon', 0, 6, 0.005, 0),
  num('reddenUp', 'Paler above the glow', 0, 0.95, 0.005, 0),
  num('reddenSide', 'Deeper away from the sun', 0, 4, 0.005, 0),
  num('glowPath', 'Glow color path at the glow line', -0.95, 4, 0.005, 0),
  num('reddenEase', 'Path change starts gently at the glow line (0: at full rate)', 0, 1, 0.01, 0),
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
  num('duskStop', 'Stop that is a dark dusk band the bridge leaves alone (-1: none)', -1, RAMP_COLORS - 1, 1, -1),
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
  num('lensRadius', 'Lens radius, short sides; the scene is drawn sharp and seen through it (0: off)', 0, 0.3, 0.0005, 0),
  vec('skyPatch', 'Light change inside the sky: amount, patch size in short sides, width over height', 0, 4, 0.001, [0, 0.6, 1]),
  num('ground', 'Below the line: 0 more sky, 1 water, 2 land', 0, 2, 1, 0),
  num('groundAt', 'Line height at the frame center (frame fraction)', -1, 3, 0.001, 1.1),
  num('groundTilt', 'Line tilt, degrees (positive lowers the right)', -20, 20, 0.01, 0),
  num('groundWave', 'Long low waves of the line, short sides', 0, 0.1, 0.0005, 0),
  vec('ridge', 'Land: climb toward the light, side it climbs to (+1 right), broad bowl depth, wave length', -2, 2, 0.001, [0, 1, 0, 0.9]),
  vec('shore', 'Far bank on the water: height, change along it', 0, 1, 0.001, [0, 0]),
  vec('sunPath', "Sun's path on the water: strength, half width at the line, widening per short side of depth, height of the glow it mirrors", 0, 4, 0.001, [0, 0.05, 0.3, 0.2]),
  vec('sunLight', "Sun's path: depth over which it fades, height above the glow of the band the water around it mirrors", 0.01, 4, 0.001, [0.3, 0.15]),
  vec('water', 'Water: squeeze, degrees below the horizon half a short side under the line, ripple smear, strip strength', 0, 40, 0.001, [1.25, 9, 0.12, 0.3]),
  num('waterMirror', "Share of calm water's reflectance that a rough sea keeps", 0, 1, 0.01, 1),
  num('mirrorDeep', 'Height above the frame top over which the sky that water mirrors there dims by e (0: none)', 0, 8, 0.001, 0),
  num('waterTint', "Share of the water's own light that takes the hue of the sky it mirrors (0: its own color)", 0, 1, 0.005, 0),
  vec('groundHaze', 'Far land: share of the sky light, depth over which it fades', 0, 2, 0.001, [0.7, 0.08]),
  vec('groundVeil', 'White haze in front of far land, depth over which it fades toward the viewer', 0, 2, 0.001, [0, 0.1]),
  vec('landLit', "Land's side toward the light: extra light there, width of that side, change of light over its relief", 0, 4, 0.001, [0, 0.5, 0]),
  num('groundTopGain', 'Land top gain', 0, 4, 0.005, 1),
  num('groundBottomGain', 'Land bottom gain', 0, 4, 0.005, 0.5),
  num('waterGain', 'Water own light gain', 0, 4, 0.005, 0.3),
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
  { key: 'groundTop', label: 'Ground top' },
  { key: 'groundBottom', label: 'Ground bottom' },
  { key: 'water', label: 'Water' },
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
  const u: RampUniforms = {
    uStop: Array.from({ length: RAMP_COLORS }, (_, i) => scale(ctx.colors[i], ctx.num(`gain${i + 1}`))).flat(),
    uEdgeAt: at,
    uEdgeWidth: Array.from({ length: RAMP_EDGES }, (_, i) => ctx.num(`width${i + 1}`)),
    uEdgeWarp: near(ctx.num('warpReach')),
    uEdgeShape: ctx.vec('edgeShape'),
    uGlowShape: ctx.vec('glowShape'),
    uEdgeSoft: near(ctx.num('softReach')),
    uEdges: edges,
    uHorizonEdge: horizonEdge,
    uZenithShade: ctx.vec('zenithShade'),
    uZenithFloor: ctx.num('zenithFloor'),
    uAnchor: ctx.vec('anchor'),
    uAxis: [Math.sin(tilt), Math.cos(tilt)],
    uDrop: ctx.num('drop'),
    uWarp: [ctx.num('warp'), ctx.num('warpScale'), 3.7 + ctx.num('warpPhase'), Math.round(ctx.num('warpOctaves'))],
    uSoftVary: [ctx.num('softVary'), ctx.num('softScale')],
    uSoftFollow: ctx.num('softFollow'),
    uDrift: [ctx.num('drift'), ctx.num('driftScale'), ctx.num('vary')],
    uBlur: ctx.num('softness'),
    uHaze: [ctx.num('hazeScale'), ctx.num('hazeStretch'), ctx.num('hazeWarp'), ctx.num('hazeLight')],
    uSunAt: ctx.vec('sunAt'),
    uSunlight: sunTint.map((v) => ctx.num('sunlight') * (1 + (v - 1) * warmth)),
    uSunlightShape: [ctx.num('sunlightWidth'), ctx.num('sunlightHeight')],
    uLateral: [ctx.num('falloff'), ctx.num('widen'), ctx.num('falloffRound')],
    uLightTop: ctx.num('lightTop'),
    uGlowColor: [...scale(ctx.color('glow1'), glowIntensity), ...scale(ctx.color('glow2'), glowIntensity)],
    uGlowWeight: [ctx.num('glow1Weight'), ctx.num('glow2Weight')].slice(0, GLOW_LAYERS),
    uGlowTau: [ctx.num('glow1Up'), ctx.num('glow1Down'), ctx.num('glow2Up'), ctx.num('glow2Down')],
    uGlowOffset: ctx.num('glowOffset'),
    uGlowEnd: ctx.vec('glowEnd'),
    uVeil: ctx.vec('veil'),
    uVeilFar: ctx.vec('veilFar'),
    uVeilTint: ctx.vec('veilTint'),
    uVeilMute: ctx.num('veilMute'),
    uHazeMass: ctx.num('hazeMass'),
    uBlueHue: ctx.num('blueHue'),
    uVeilNear: ctx.vec('veilNear'),
    uGlowVary: [ctx.num('glowVary'), ctx.num('glowVaryScale'), ctx.num('glowArch')],
    uGlowArchShape: ctx.vec('glowArchShape'),
    uGlowSpread: [ctx.num('glowLateral'), ctx.num('glowWidth'), ctx.num('shadowHeight')],
    uExtinction: ctx.num('extinction'),
    uHorizonDim: [ctx.num('horizonDim'), ctx.num('horizonDimHeight')],
    uDimBelow: ctx.num('dimBelow'),
    uRedden: [ctx.num('reddenDown'), ctx.num('reddenUp'), ctx.num('reddenSide'), ctx.num('glowPath')],
    uReddenEase: ctx.num('reddenEase'),
    uSunGlowColor: Array.from({ length: SUN_LAYERS }, (_, i) =>
      scale(ctx.color('sunGlow'), sunIntensity * ctx.num(`sunGlow${i + 1}Weight`)),
    ).flat(),
    uSunGlowRadius: Array.from({ length: SUN_LAYERS }, (_, i) => ctx.num(`sunGlow${i + 1}Radius`)),
    uSunGlowShape: [ctx.num('sunGlowAspect'), ctx.num('sunGlowBeta')],
    uOcclude: [ctx.num('occlude'), ctx.num('occludeWidth')],
    uBridge: [ctx.num('bridge'), ctx.num('bridgeLift'), ctx.num('bridgeFloor')],
    uBridgeTint: bridgeTint(ctx.color('glow1'), ctx.num('bridgeWarmth')),
    uDuskStop: Math.round(ctx.num('duskStop')),
    uLand: [ctx.num('land'), ctx.num('landAt'), ctx.num('landTilt'), ctx.num('landDrop')],
    uLandWarp: [ctx.num('landWarp'), ctx.num('landWarpScale'), ctx.num('landWarpPhase'), Math.round(ctx.num('landOctaves'))],
    uLandEdge: [ctx.num('landSoft'), ctx.num('landSoftVary'), ctx.num('landDepth')],
    uLandTop: scale(ctx.color('landTop'), ctx.num('landTopGain')),
    uLandBottom: scale(ctx.color('landBottom'), ctx.num('landBottomGain')),
    uLandLightColor: scale(ctx.color('landLight'), ctx.num('landLight')),
    uLandLight: [ctx.num('landLightWidth'), ctx.num('landLightDepth')],
    uLens: ctx.num('lensRadius') > 0 ? 1 : 0,
    uSkyPatch: skyPatchUniform(ctx),
    uGround: Math.round(ctx.num('ground')),
    uGroundLine: [(ctx.num('groundAt') - 0.5) * frameShort(ctx).y, Math.tan((ctx.num('groundTilt') * Math.PI) / 180), ctx.num('groundWave')],
    uRidge: ctx.vec('ridge'),
    uShore: ctx.vec('shore'),
    uSunPath: ctx.vec('sunPath'),
    uSunLight: ctx.vec('sunLight'),
    uWater: ctx.vec('water'),
    uWaterOwn: scale(ctx.color('water'), ctx.num('waterGain')),
    uWaterMirror: ctx.num('waterMirror'),
    uMirrorDeep: ctx.num('mirrorDeep'),
    uWaterTint: ctx.num('waterTint'),
    uGroundTop: scale(ctx.color('groundTop'), ctx.num('groundTopGain')),
    uGroundBottom: scale(ctx.color('groundBottom'), ctx.num('groundBottomGain')),
    uGroundHaze: ctx.vec('groundHaze'),
    uGroundVeil: ctx.vec('groundVeil'),
    uGroundVeilTint: bridgeTint(ctx.color('groundTop'), 1),
    uLandLit: ctx.vec('landLit'),
  }
  return { ...u, ...rampBoundary(ctx, u).uniforms }
}

/** The frame in short-side units: width and height. */
const frameShort = (ctx: RecipeContext) => ({ x: Math.max(ctx.aspect, 1), y: Math.max(1 / ctx.aspect, 1) })

/** The sky patches' amount, 1 / size and their mean over the top fifth of the frame, which the shader removes. */
function skyPatchUniform(ctx: RecipeContext): number[] {
  const [amount, size, stretch] = ctx.vec('skyPatch')
  if (!(amount > 0)) return [0, 1, 0, 1]
  const k = 1 / Math.max(size, 1e-3)
  const wide = Math.max(stretch, 0.1)
  const { x: w, y: h } = frameShort(ctx)
  const seed = Math.round(ctx.seed)
  let sum = 0
  let n = 0
  for (let j = 0; j <= 8; j++) {
    for (let i = 0; i <= 32; i++) {
      const px = ((-0.5 + i / 32) * w * k) / wide
      const py = (-0.5 + (0.2 * j) / 8) * h * k
      sum += (gradientNoise(px + 3.1, py + 7.7, seed + 811) + 0.5 * gradientNoise(2 * px - 5.3, 2 * py + 1.9, seed + 823)) / NOISE_RMS
      n++
    }
  }
  return [amount, k, sum / n, wide]
}

/**
 * The lens, kept in one place: the scene is drawn sharp and seen through one out-of-focus disc
 * lens of radius R. Without a lens (R 0, the 1:1 presets) the aux source is unused, so it stays
 * tiny.
 */
const LENS: ScatterBlur = { source: 'aux', shape: 'lens', radius: (ctx) => ctx.num('lensRadius'), size: () => 8 }

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
  scatter: [LENS],
  radianceScale: 0.5,
  fromPack: (pack: ColorPack) => rampPackColors(pack.id, 1),
  compose: ({ pack, controls, seed, aspect }) => composeRamp(pack.id, controls, seed, aspect),
}
