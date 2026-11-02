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
  UniformMap,
  VectorParam,
} from '../../scene'
import { BLOOM_BOUNDARY, BLOOM_MINOR_REF, BLOOM_ROW, bloomBoundaryUniforms } from './blooms-boundary'
import { composeLayout, GLOW_COUNT, isWarm, random, SLOT, SLOT_COUNT, type BloomsLayout, type GlowSpec } from './blooms-compose'
import { bridgeAmount, bridgeGate, bridgeTint, deepen, deepFade, skyPaleTint } from './blooms-light'
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
    num(`glow${n}Angle`, `Glow ${n} tilt`, -60, 60, 0.5, glow.angle),
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
  num('zenithAngle', 'Zenith tilt', -60, 60, 0.5, -16),
  num('zenithAmount', 'Zenith amount', 0, 1, 0.01, 0.6),
  num('zenithFalloff', 'Zenith falloff', 1, 5, 0.01, 2.6),
  num('warp', 'Warp', 0, 0.3, 0.002, 0.07),
  num('warpScale', 'Warp scale', 0.2, 4, 0.05, 1.1),
  num('bridge', 'Bridge', 0, 3, 0.01, 1),
]

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
    },
    warp: ctx.num('warp'),
    warpScale: ctx.num('warpScale'),
    bridge: ctx.num('bridge'),
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

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
    warp: layout.warp,
    warpScale: layout.warpScale,
    bridge: layout.bridge,
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

const LOBES = 3
const LOBE_FALLOFF = 2.2

/**
 * The lobes of one extended source, spread along its long axis at different
 * heights across it, each with its own size and falloff. Per lobe: offsets in
 * units of the long and short radius, 1 / size and weight (`shape`), and a
 * falloff factor (`falloff`). With vary 0 they sit on top of each other and
 * make one ellipse. The weights are scaled so the brightest point is about 1.
 */
function lobes(vary: number, seed: number, index: number): { shape: number[]; falloff: number[] } {
  const r = random(seed * 7919 + index * 131 + 17)
  const raw = Array.from({ length: LOBES }, (_, j) => ({
    along: (j - 1) * 0.55 * vary * lerp(0.7, 1.3, r()),
    across: (r() - 0.5) * 0.9 * vary,
    size: 1 - vary * lerp(0, 0.4, r()),
    weight: j === 1 ? 1 : lerp(0.45, 0.9, r()),
    falloff: 1 + vary * lerp(-0.25, 0.25, r()),
  }))
  const at = (a: number, c: number) =>
    raw.reduce((sum, l) => sum + l.weight * (1 + ((a - l.along) / l.size) ** 2 + ((c - l.across) / l.size) ** 2) ** (-LOBE_FALLOFF * l.falloff), 0)
  const peak = Math.max(at(0, 0), ...raw.map((l) => at(l.along, l.across)))
  return {
    shape: raw.flatMap((l) => [l.along, l.across, 1 / l.size, l.weight / peak]),
    falloff: raw.map((l) => l.falloff),
  }
}

/** 1 for a glow with its own haze (it sits in front), 0 for a glow without (it sits behind the others' haze). */
function inFront(haze: number): number {
  const t = clamp(haze / 0.2, 0, 1)
  return t * t * (3 - 2 * t)
}

/** Share of the glow's extra lightness above the default Intensity that its bridge light may follow. */
const BRIDGE_RISE = 0.3

/**
 * Bridge light for one glow, per unit of its tint, solved at this Intensity's
 * sky and glow, so the blend stays pale on a dusk sky too. Above the default
 * Intensity the blend midpoint gets only a share of the extra lightness, so
 * the bridge stays pale and colored and only the glow core goes white.
 */
function bridgeLight(sky: Rgb, light: Rgb, tint: Rgb, haze: number, intensity: number, skyGain: number, glowGain: number): number {
  const lighter = (s: Rgb, g: Rgb) => Math.max(linearToOklab(s)[0], linearToOklab(g)[0])
  const litSky = scale(sky, skyGain)
  const litGlow = scale(light, glowGain)
  if (intensity <= 0.5) return bridgeAmount(litSky, litGlow, tint, haze)
  const atDefault = lighter(sky, light)
  const maxL = atDefault + BRIDGE_RISE * Math.max(0, lighter(litSky, litGlow) - atDefault)
  return bridgeAmount(litSky, litGlow, tint, haze, maxL)
}

/**
 * Intensity is daylight. The sky gains more than the glows (twilight skies
 * dim fastest overhead), so more light brightens the whole frame and the top
 * included, while the glows only whiten close to where they come from. At
 * 0.5 both gains are 1, so a flat sky is its exact hex. Toward 0 the glows
 * keep most of their brightness but shrink and their warm light deepens, as
 * the light of a lower sun does; toward 1 they shrink a little, so the
 * whitened part stays near the source.
 */
function layoutUniforms(layout: BloomsLayout, colors: readonly Rgb[], intensity: number, seed: number): UniformMap {
  const skyGain = 2 ** ((intensity - 0.5) * 1.6)
  const lightGain = 2 ** ((intensity - 0.5) * (intensity < 0.5 ? 0.5 : 0.8))
  const reach = 1 - 0.14 * Math.max(0, 1 - 2 * intensity) - 0.08 * Math.max(0, 2 * intensity - 1)
  const depth = 1 + 0.8 * Math.max(0, 0.5 - intensity)
  const slot = (index: number) => colors[clamp(Math.round(index), 0, SLOT_COUNT - 1)]
  const sky = colors[SLOT.sky]
  const skyPale = skyPaleTint(sky)
  const glowColor: number[] = []
  const glowTail: number[] = []
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
      glowShape.push(0, 0, 2, 0)
      glowAxis.push(1, 0, 1, 1)
      glowEdge.push(0, 1, 0, 0)
      glowDeepFade.push(0)
      glowBridge.push(0, 0, 0)
      continue
    }
    const base = slot(glow.color)
    const light = scale(isWarm(base) ? deepen(base, depth) : base, glow.gain)
    // A glow's haze may hide at most as much sky light as the glow itself adds, so haze never darkens the frame.
    const haze = Math.min(glow.haze, luminance(light) / Math.max(luminance(sky), 1e-4))
    const front = inFront(glow.haze)
    const gain = skyGain + (lightGain - skyGain) * front
    glowColor.push(...scale(light, gain))
    // The faint outer light of a glow whose hue is far from the sky's pales the sky without turning
    // its hue, at the same luminance, so a warm glow meets blue through pale blue, not a lavender ring.
    const y = luminance(light) * gain
    const tailShare = bridgeGate(sky, light)
    glowTail.push(...light.map((c, ch) => c * gain * (1 - tailShare) + skyPale[ch] * y * tailShare))
    glowShape.push(glow.at[0], glow.at[1], glow.beta, haze)
    glowAxis.push(...axis(glow.radius * reach, glow.aniso, glow.angle))
    glowEdge.push(glow.vary, 1.15, 1.7 * i + 0.3, front)
    glowDeepFade.push(deepFade(sky, slot(layout.zenith.color), light))
    const tint = bridgeTint(light)
    const amount = front * layout.bridge * bridgeLight(sky, light, tint, haze, intensity, skyGain, gain)
    glowBridge.push(...scale(tint, amount))
  }
  const z = layout.zenith
  const zenithLobes = lobes(0.8, seed, GLOW_COUNT)
  return {
    uSky: scale(sky, skyGain),
    uDeep: scale(slot(z.color), skyGain),
    uDeepLight: clamp(luminance(slot(z.color)) / Math.max(luminance(sky), 1e-4), 0, 1),
    uZenithShape: [z.at[0], z.at[1], clamp(z.amount, 0, 1), z.falloff],
    uZenithAxis: axis(z.radius, z.aniso, z.angle),
    uZenithLobe: zenithLobes.shape,
    uZenithLobeFalloff: zenithLobes.falloff,
    uGlowCount: layout.glows.length,
    uGlowColor: glowColor,
    uGlowTail: glowTail,
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

/**
 * The colors by role: Meta Blue for the sky, and the two lightest other
 * colors as lights. The sky deepens toward no light (black), so it gets
 * darker without changing hue; the pack's dark colors are not lights and do
 * not tint the sky.
 */
function rolesFromPack(pack: ColorPack): string[] {
  const [sky, ...rest] = pack.colors.map((c) => c.hex)
  const lightness = (hex: string) => linearToOklab(hexToLinear(hex))[0]
  const byLightness = [...rest].sort((a, b) => lightness(a) - lightness(b))
  const light1 = byLightness[byLightness.length - 1] ?? sky
  const light2 = byLightness[byLightness.length - 2] ?? light1
  return [sky, NO_LIGHT, NO_LIGHT, light1, light2]
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
#define TAIL_END 4.5
#define BLOOM_MINOR_REF ${BLOOM_MINOR_REF.toFixed(6)}
#define BLOOM_ROW ${BLOOM_ROW.toFixed(6)}
uniform vec3 uSky;
uniform vec3 uDeep;
uniform float uDeepLight;             // luminance of the deep color over the sky's, 0..1
uniform vec4 uZenithShape;           // center (frame fractions), amount, falloff exponent
uniform vec4 uZenithAxis;            // cos, sin, 1 / long radius, 1 / short radius
uniform vec4 uZenithLobe[LOBES];     // offset along and across (in radii), 1 / size, weight
uniform float uZenithLobeFalloff[LOBES];
uniform int uGlowCount;
uniform vec3 uGlowColor[GLOW_COUNT];
uniform vec3 uGlowTail[GLOW_COUNT];   // color of the faint outer light
uniform float uGlowDeepFade[GLOW_COUNT]; // how much the glow fades over the deepened sky
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
float bloom(vec2 P, vec2 warp, vec2 center, vec4 axis, vec2 stretch, float beta, vec3 edge, float bend, int index, float shortUnit, vec4 lobe[LOBES], float falloff[LOBES]) {
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
    across += boundaryWarp(a, across * BLOOM_MINOR_REF + float(index) * BLOOM_ROW) * fade * inversesqrt(BLOOM_MINOR_REF * max(BLOOM_MINOR_REF, minorShort));
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
  return sum;
}

vec3 radiance(vec2 uv, vec2 p) {
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
  float z = min(1.0, uZenithShape.z * bloom(P, warp, (uZenithShape.xy - 0.5) * frame, uZenithAxis, vec2(shortUnit), uZenithShape.w, vec3(0.5, 1.1, 2.3), 0.0, 9, 0.0, lobe, falloff));
  vec3 sky = mix(uSky, uDeep, z);
  float deepArea = z * z;

  float k[GLOW_COUNT];
  float ext = 0.0;
  for (int i = 0; i < GLOW_COUNT; i++) {
    k[i] = 0.0;
    if (i < uGlowCount) {
      for (int j = 0; j < LOBES; j++) {
        lobe[j] = uGlowLobe[i * LOBES + j];
        falloff[j] = uGlowLobeFalloff[i * LOBES + j];
      }
      k[i] = bloom(P, warp, (uGlowShape[i].xy - 0.5) * frame, uGlowAxis[i], stretch, uGlowShape[i].z, uGlowEdge[i].xyz, uGlowBend[i], i, shortUnit, lobe, falloff);
      ext += uGlowShape[i].w * k[i] * k[i];
    }
  }
  float T = exp(-ext);
  vec3 behind = sky;
  vec3 front = vec3(0.0);
  float lit = 0.0;
  vec3 bridge = vec3(0.0);
  for (int i = 0; i < GLOW_COUNT; i++) {
    if (i >= uGlowCount) break;
    // Where the sky is deep, light that would grey it dims as the sky does, so dim warm light never
    // lingers over a dark area as grey-brown; light of the deep area's own hue stays and deepens it.
    float ill = mix(1.0, uDeepLight, deepArea * uGlowDeepFade[i]);
    vec3 light = mix(uGlowTail[i], uGlowColor[i], smoothstep(0.05, 0.4, k[i])) * (k[i] * ill);
    float f = uGlowEdge[i].w;
    behind += (1.0 - f) * light;
    front += f * light;
    lit += f * k[i];
    bridge += uGlowBridge[i] * (k[i] * ill);
  }
  // Pale light where the glows and the sky weigh about the same, reaching further out on the sky
  // side, where faint warm light over blue would read as a lavender ring; zero at both ends, and
  // overlapping glows share one bridge instead of stacking theirs.
  float t = lit / (lit + T);
  t = t < 0.5 ? 0.5 * pow(2.0 * t, 0.7) : t;
  float bell = 4.0 * t * (1.0 - t);
  front += bridge / max(lit, 1e-4) * bell * sqrt(bell);
  return behind * T + front;
}
`,
  uniforms: (ctx) => ({
    ...layoutUniforms(readLayout(ctx), ctx.colors, ctx.num('intensity'), ctx.seed),
    ...bloomBoundaryUniforms(BLOOM_BOUNDARY, ctx.aspect, ctx.seed),
  }),
  radianceScale: 0.5,
  lens: { bloom: 0.12, bloomRadius: 0.75, bloomWidth: 1.5 },
  fromPack: rolesFromPack,
  compose: ({ pack, controls, seed }): Composition => {
    const colors = rolesFromPack(pack)
    const layout = composeLayout(colors.map(hexToLinear), seed, {
      intensity: controls.intensity,
      softness: controls.softness,
      rise: controls.mood,
    })
    const soft = clamp(controls.softness, 0, 1)
    return {
      colors,
      params: { intensity: clamp(controls.intensity, 0, 1), ...layoutParams(layout) },
      lens: { bloom: 0.07 + 0.12 * soft, bloomRadius: 0.66 + 0.2 * soft },
      output: {},
    }
  },
}
