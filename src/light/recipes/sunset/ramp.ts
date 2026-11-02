import { packHexesByLightness, type ColorPack } from '../../color/packs'
import type { RecipeDefinition } from '../../scene'

const STOP_COUNT = 6

/**
 * Vertical (or angled) ramp of up to six stops mixed in linear light along a
 * warped, optionally curved axis, blurred by a gaussian, plus a soft additive
 * glow band at the horizon.
 */
export const sunsetRamp: RecipeDefinition = {
  id: 'sunset.ramp',
  mood: 'sunset',
  label: 'Ramp',
  colorSlots: [
    { key: 'stop1', label: 'Stop 1' },
    { key: 'stop2', label: 'Stop 2' },
    { key: 'stop3', label: 'Stop 3' },
    { key: 'stop4', label: 'Stop 4' },
    { key: 'stop5', label: 'Stop 5' },
    { key: 'stop6', label: 'Stop 6' },
    { key: 'glow', label: 'Glow' },
  ],
  defaultColors: ['#2F63C8', '#7F9BD0', '#C9B8B0', '#F0A36E', '#D4552B', '#7A1F18', '#FFD9A8'],
  params: [
    { kind: 'number', key: 'stops', label: 'Stops', min: 2, max: STOP_COUNT, step: 1, default: 6 },
    { kind: 'number', key: 'pos1', label: 'Stop 1 at', min: 0, max: 1, step: 0.005, default: 0 },
    { kind: 'number', key: 'pos2', label: 'Stop 2 at', min: 0, max: 1, step: 0.005, default: 0.2 },
    { kind: 'number', key: 'pos3', label: 'Stop 3 at', min: 0, max: 1, step: 0.005, default: 0.4 },
    { kind: 'number', key: 'pos4', label: 'Stop 4 at', min: 0, max: 1, step: 0.005, default: 0.6 },
    { kind: 'number', key: 'pos5', label: 'Stop 5 at', min: 0, max: 1, step: 0.005, default: 0.8 },
    { kind: 'number', key: 'pos6', label: 'Stop 6 at', min: 0, max: 1, step: 0.005, default: 1 },
    { kind: 'number', key: 'softness', label: 'Softness', min: 0, max: 0.4, step: 0.005, default: 0.08 },
    { kind: 'number', key: 'angle', label: 'Angle', min: -90, max: 90, step: 0.5, default: 0 },
    { kind: 'number', key: 'curve', label: 'Curve', min: -2, max: 2, step: 0.01, default: 0 },
    { kind: 'number', key: 'curveCenter', label: 'Curve center', min: -1, max: 1, step: 0.01, default: 0 },
    { kind: 'number', key: 'warp', label: 'Warp', min: 0, max: 0.3, step: 0.002, default: 0.03 },
    { kind: 'number', key: 'warpScale', label: 'Warp scale', min: 0.2, max: 6, step: 0.05, default: 1.2 },
    { kind: 'number', key: 'horizon', label: 'Horizon', min: 0, max: 1, step: 0.005, default: 0.75 },
    { kind: 'number', key: 'glow', label: 'Glow', min: 0, max: 3, step: 0.01, default: 0.25 },
    { kind: 'number', key: 'glowWidth', label: 'Glow width', min: 0.01, max: 0.6, step: 0.005, default: 0.12 },
    { kind: 'number', key: 'intensity', label: 'Intensity', min: 0, max: 3, step: 0.01, default: 1 },
  ],
  fragment: /* glsl */ `
uniform vec3 uColors[MAX_STOPS];
uniform float uStops[MAX_STOPS];
uniform int uCount;
uniform vec3 uGlowColor;
uniform float uSoftness;
uniform float uAngle;
uniform float uCurve;
uniform float uCurveCenter;
uniform float uWarp;
uniform float uWarpScale;
uniform float uHorizon;
uniform float uGlow;
uniform float uGlowWidth;
uniform float uIntensity;

vec3 radiance(vec2 uv, vec2 p) {
  float a = radians(uAngle);
  vec2 axis = vec2(sin(a), cos(a));
  vec2 across = vec2(cos(a), -sin(a));
  float extent = abs(uFrameAspect.x * axis.x) + abs(uFrameAspect.y * axis.y);
  vec2 q = domainWarp(p, uWarp, uWarpScale, 3, uSeed);
  float s = dot(q, across) - uCurveCenter;
  float t = 0.5 + dot(q, axis) / extent + uCurve * s * s;

  vec3 sky = blurredRamp(t, uColors, uStops, uCount, uSoftness);

  // Glow band: width varies slowly along the horizon so it never reads as a ruled line.
  float width = uGlowWidth * (1.0 + 0.35 * fbm(vec2(s * 1.7, 3.1), 2, uSeed + 41));
  vec3 glow = uGlowColor * uGlow * gaussian(t - uHorizon, width);
  return uIntensity * (sky + glow);
}
`,
  uniforms: (ctx) => {
    const count = Math.round(ctx.num('stops'))
    const stops = Array.from({ length: 8 }, (_, i) => (i < STOP_COUNT ? ctx.num(`pos${i + 1}`) : 1))
    for (let i = 1; i < 8; i++) stops[i] = Math.max(stops[i], stops[i - 1])
    const colors = Array.from({ length: 8 }, (_, i) => ctx.colors[Math.min(i, STOP_COUNT - 1)]).flat()
    return {
      uColors: colors,
      uStops: stops,
      uCount: count,
      uGlowColor: ctx.color('glow'),
      uSoftness: ctx.num('softness'),
      uAngle: ctx.num('angle'),
      uCurve: ctx.num('curve'),
      uCurveCenter: ctx.num('curveCenter'),
      uWarp: ctx.num('warp'),
      uWarpScale: ctx.num('warpScale'),
      uHorizon: ctx.num('horizon'),
      uGlow: ctx.num('glow'),
      uGlowWidth: ctx.num('glowWidth'),
      uIntensity: ctx.num('intensity'),
    }
  },
  lens: { bloom: 0.04, bloomRadius: 0.75, bloomWidth: 1.5 },
  fromPack: (pack: ColorPack) => {
    const hexes = pack.colors.map((c) => c.hex)
    const stops = Array.from({ length: STOP_COUNT }, (_, i) => hexes[Math.min(i, hexes.length - 1)])
    return [...stops, packHexesByLightness(pack).at(-1) ?? hexes[0]]
  },
}
