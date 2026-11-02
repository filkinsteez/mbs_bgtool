import { linearToOklab } from '../../color/oklab'
import type { ColorPack } from '../../color/packs'
import { hexToLinear, type Rgb } from '../../color/srgb'
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
import { composeLayout, GLOW_COUNT, isWarm, SLOT, SLOT_COUNT, type BloomsLayout, type GlowSpec } from './blooms-compose'
import { bridgeAmount, deepen, paleTint } from './blooms-light'

const DEFAULT_GLOWS: readonly GlowSpec[] = [
  { color: SLOT.light1, at: [-0.09, 0.88], radius: 0.62, aniso: 4.4, angle: 21, gain: 0.9, beta: 2.2, haze: 1.45, vary: 0.65 },
  { color: SLOT.light1, at: [0.26, 1.08], radius: 0.38, aniso: 4.4, angle: 16, gain: 0.42, beta: 2.2, haze: 0.8, vary: 0.6 },
  { color: SLOT.light2, at: [1.02, 1.08], radius: 0.48, aniso: 4.0, angle: -8, gain: 0.38, beta: 2.2, haze: 0.5, vary: 0.6 },
  { color: SLOT.sky, at: [0.7, 1.06], radius: 0.6, aniso: 4.6, angle: -5, gain: 0.6, beta: 2.0, haze: 0, vary: 0.6 },
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

/** 1 for a glow with its own haze (it sits in front), 0 for a glow without (it sits behind the others' haze). */
function inFront(haze: number): number {
  const t = clamp(haze / 0.2, 0, 1)
  return t * t * (3 - 2 * t)
}

/**
 * Intensity is daylight. The sky gains more than the glows (twilight skies
 * dim fastest overhead), so more light brightens the whole frame and the top
 * included, while the glows only whiten close to where they come from. At
 * 0.5 both gains are 1, so a flat sky is its exact hex. Below 0.5 warm light
 * also deepens, as the light of a lower sun does.
 */
function layoutUniforms(layout: BloomsLayout, colors: readonly Rgb[], intensity: number): UniformMap {
  const skyGain = 2 ** ((intensity - 0.5) * 1.6)
  const lightGain = 2 ** ((intensity - 0.5) * 1.0)
  const depth = 1 + 1.2 * Math.max(0, 0.5 - intensity)
  const slot = (index: number) => colors[clamp(Math.round(index), 0, SLOT_COUNT - 1)]
  const sky = colors[SLOT.sky]
  const glowColor: number[] = []
  const glowShape: number[] = []
  const glowAxis: number[] = []
  const glowEdge: number[] = []
  const glowBridge: number[] = []
  for (let i = 0; i < GLOW_COUNT; i++) {
    const glow = layout.glows[i]
    if (!glow) {
      glowColor.push(0, 0, 0)
      glowShape.push(0, 0, 2, 0)
      glowAxis.push(1, 0, 1, 1)
      glowEdge.push(0, 1, 0, 0)
      glowBridge.push(0, 0, 0)
      continue
    }
    const base = slot(glow.color)
    const light = scale(isWarm(base) ? deepen(base, depth) : base, glow.gain)
    const front = inFront(glow.haze)
    const gain = skyGain + (lightGain - skyGain) * front
    glowColor.push(...scale(light, gain))
    glowShape.push(glow.at[0], glow.at[1], glow.beta, glow.haze)
    glowAxis.push(...axis(glow.radius, glow.aniso, glow.angle))
    glowEdge.push(glow.vary, 1.15, 1.7 * i + 0.3, front)
    const tint = paleTint(light)
    const amount = front * layout.bridge * bridgeAmount(sky, light, tint, glow.haze) * Math.sqrt(skyGain * lightGain)
    glowBridge.push(...scale(tint, amount))
  }
  const z = layout.zenith
  return {
    uSky: scale(sky, skyGain),
    uDeep: scale(slot(z.color), skyGain),
    uZenithShape: [z.at[0], z.at[1], clamp(z.amount, 0, 1), 2.6],
    uZenithAxis: axis(z.radius, z.aniso, z.angle),
    uGlowCount: layout.glows.length,
    uGlowColor: glowColor,
    uGlowShape: glowShape,
    uGlowAxis: glowAxis,
    uGlowEdge: glowEdge,
    uGlowBridge: glowBridge,
    uWarp: [layout.warp, layout.warpScale],
  }
}

/** The colors by role: Meta Blue for the sky, the two darkest others to deepen toward (black when none is darker than the sky), the two lightest others as lights. */
function rolesFromPack(pack: ColorPack): string[] {
  const [sky, ...rest] = pack.colors.map((c) => c.hex)
  const lightness = (hex: string) => linearToOklab(hexToLinear(hex))[0]
  const skyL = lightness(sky)
  const byLightness = [...rest].sort((a, b) => lightness(a) - lightness(b))
  const darker = byLightness.filter((hex) => lightness(hex) < skyL)
  const deep1 = darker[0] ?? '#000000'
  const deep2 = darker[1] ?? deep1
  const light1 = byLightness[byLightness.length - 1] ?? sky
  const light2 = byLightness[byLightness.length - 2] ?? light1
  return [sky, deep1, deep2, light1, light2]
}

/**
 * No horizon: a Meta Blue sky with up to four wide, flat glows coming from
 * off-frame and the sky deepening away from the light. Light adds in linear
 * light; where a glow meets the sky a pale bridge light is added so the blend
 * is lighter and near neutral, never grey. A shared low-frequency warp bends
 * every edge, and each glow's reach and falloff drift along its edge.
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
  fragment: /* glsl */ `
#define GLOW_COUNT ${GLOW_COUNT}
#define TAIL_END 4.5
uniform vec3 uSky;
uniform vec3 uDeep;
uniform vec4 uZenithShape;           // center (frame fractions), amount, falloff exponent
uniform vec4 uZenithAxis;            // cos, sin, 1 / long radius, 1 / short radius
uniform int uGlowCount;
uniform vec3 uGlowColor[GLOW_COUNT];
uniform vec4 uGlowShape[GLOW_COUNT];  // center (frame fractions), falloff exponent, haze
uniform vec4 uGlowAxis[GLOW_COUNT];   // cos, sin, 1 / long radius, 1 / short radius
uniform vec4 uGlowEdge[GLOW_COUNT];   // edge variation, its frequency, its phase, in front 0..1
uniform vec3 uGlowBridge[GLOW_COUNT];
uniform vec2 uWarp;                   // amount, frequency

// Power-law falloff on a rotated, stretched axis, 1 at the center. The reach
// across the long axis and the exponent drift along the edge, so no two edges
// share a profile. The tail fades out smoothly by about two and a half radii,
// so the sky beyond it keeps its exact color.
float bloom(vec2 q, vec2 center, vec4 axis, vec2 stretch, float beta, vec3 edge, int index) {
  vec2 d = q - center;
  float along = dot(d, axis.xy) * axis.z * stretch.x;
  float across = dot(d, vec2(-axis.y, axis.x)) * axis.w * stretch.y;
  float s = along * edge.y + edge.z;
  float reach = exp(0.4 * edge.x * gradientNoise(vec2(s, 0.37), uSeed + 101 + 7 * index));
  float b = beta * (1.0 + 0.22 * edge.x * gradientNoise(vec2(s + 4.1, 2.71), uSeed + 211 + 7 * index));
  across /= reach;
  float d2 = along * along + across * across;
  return pow(1.0 + d2, -b) * exp(-d2 * d2 / (TAIL_END * TAIL_END));
}

vec3 radiance(vec2 uv, vec2 p) {
  vec2 frame = uFrameAspect * inversesqrt(uFrameAspect.x * uFrameAspect.y);
  vec2 P = (uv - 0.5) * frame;
  // Taller frames get taller, less stretched glows (radius x tall, width / height / tall).
  float tall = clamp(pow(uFrameAspect.y / uFrameAspect.x / 0.5625, 0.25), 0.8, 1.5);
  vec2 stretch = vec2(inversesqrt(tall), pow(tall, -1.5));
  vec2 w = P * uWarp.y;
  vec2 q = P + uWarp.x * vec2(fbm(w, 2, uSeed + 11), fbm(w + vec2(31.7, 11.3), 2, uSeed + 29));

  // The darkening is sized by the short side, so it stays in its corner in every format.
  vec2 shortSide = vec2(1.0 / min(frame.x, frame.y));
  float z = uZenithShape.z * bloom(q, (uZenithShape.xy - 0.5) * frame, uZenithAxis, shortSide, uZenithShape.w, vec3(0.5, 1.1, 2.3), 9);
  vec3 sky = mix(uSky, uDeep, z);

  float k[GLOW_COUNT];
  float ext = 0.0;
  for (int i = 0; i < GLOW_COUNT; i++) {
    k[i] = 0.0;
    if (i < uGlowCount) {
      k[i] = bloom(q, (uGlowShape[i].xy - 0.5) * frame, uGlowAxis[i], stretch, uGlowShape[i].z, uGlowEdge[i].xyz, i);
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
    vec3 light = uGlowColor[i] * k[i];
    float f = uGlowEdge[i].w;
    behind += (1.0 - f) * light;
    front += f * light;
    lit += f * k[i];
    bridge += uGlowBridge[i] * k[i];
  }
  // Pale light where the glows and the sky weigh about the same; zero at both ends,
  // and overlapping glows share one bridge instead of stacking theirs.
  float t = lit / (lit + T);
  float bell = 4.0 * t * (1.0 - t);
  front += bridge / max(lit, 1e-4) * bell * bell;
  return behind * T + front;
}
`,
  uniforms: (ctx) => layoutUniforms(readLayout(ctx), ctx.colors, ctx.num('intensity')),
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
      lens: { bloom: 0.08 + 0.1 * soft, bloomRadius: 0.68 + 0.17 * soft },
      output: {},
    }
  },
}
