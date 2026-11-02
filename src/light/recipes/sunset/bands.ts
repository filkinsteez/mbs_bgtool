import type { ColorPack } from '../../color/packs'
import type { RecipeDefinition } from '../../scene'

const BAND_COUNT = 6

/**
 * Three to six stacked bands in linear light. Every edge is blurred by a
 * gaussian whose width changes along the edge, and every edge has its own
 * low-frequency warp, so no two boundaries are parallel rules.
 */
export const sunsetBands: RecipeDefinition = {
  id: 'sunset.bands',
  mood: 'sunset',
  label: 'Bands',
  colorSlots: [
    { key: 'band1', label: 'Band 1' },
    { key: 'band2', label: 'Band 2' },
    { key: 'band3', label: 'Band 3' },
    { key: 'band4', label: 'Band 4' },
    { key: 'band5', label: 'Band 5' },
    { key: 'band6', label: 'Band 6' },
  ],
  defaultColors: ['#C33A2A', '#1A1416', '#3E7BC0', '#6E7175', '#E8443A', '#E8443A'],
  params: [
    { kind: 'number', key: 'bands', label: 'Bands', min: 2, max: BAND_COUNT, step: 1, default: 5 },
    { kind: 'number', key: 'edge1', label: 'Edge 1', min: 0, max: 1, step: 0.005, default: 0.15 },
    { kind: 'number', key: 'edge2', label: 'Edge 2', min: 0, max: 1, step: 0.005, default: 0.3 },
    { kind: 'number', key: 'edge3', label: 'Edge 3', min: 0, max: 1, step: 0.005, default: 0.48 },
    { kind: 'number', key: 'edge4', label: 'Edge 4', min: 0, max: 1, step: 0.005, default: 0.64 },
    { kind: 'number', key: 'edge5', label: 'Edge 5', min: 0, max: 1, step: 0.005, default: 0.8 },
    { kind: 'number', key: 'softness', label: 'Softness', min: 0, max: 0.3, step: 0.002, default: 0.06 },
    { kind: 'number', key: 'softVary', label: 'Softness variation', min: 0, max: 1.5, step: 0.01, default: 0.4 },
    { kind: 'number', key: 'angle', label: 'Angle', min: -90, max: 90, step: 0.5, default: 0 },
    { kind: 'number', key: 'warp', label: 'Warp', min: 0, max: 0.2, step: 0.002, default: 0.025 },
    { kind: 'number', key: 'warpScale', label: 'Warp scale', min: 0.2, max: 6, step: 0.05, default: 1.4 },
    { kind: 'number', key: 'bandLight', label: 'Light variation', min: 0, max: 0.6, step: 0.01, default: 0.08 },
    { kind: 'number', key: 'intensity', label: 'Intensity', min: 0, max: 3, step: 0.01, default: 1 },
  ],
  fragment: /* glsl */ `
uniform vec3 uColors[MAX_STOPS];
uniform float uEdges[MAX_STOPS];
uniform int uCount;
uniform float uSoftness;
uniform float uSoftVary;
uniform float uAngle;
uniform float uWarp;
uniform float uWarpScale;
uniform float uBandLight;
uniform float uIntensity;

vec3 radiance(vec2 uv, vec2 p) {
  float a = radians(uAngle);
  vec2 axis = vec2(sin(a), cos(a));
  vec2 across = vec2(cos(a), -sin(a));
  float extent = abs(uFrameAspect.x * axis.x) + abs(uFrameAspect.y * axis.y);
  float t = 0.5 + dot(p, axis) / extent;
  float s = dot(p, across);

  float edges[MAX_STOPS];
  float sigmas[MAX_STOPS];
  for (int k = 0; k < MAX_STOPS; k++) {
    float n = fbm(vec2(s * uWarpScale, float(k) * 3.7), 3, uSeed + k * 17);
    float m = fbm(vec2(s * uWarpScale * 0.7 + 11.0, float(k) * 5.3), 2, uSeed + k * 29 + 5);
    edges[k] = uEdges[k] + uWarp * n;
    sigmas[k] = uSoftness * exp(uSoftVary * m);
  }
  vec3 color = blurredBands(t, uColors, edges, sigmas, uCount);
  float light = 1.0 + uBandLight * fbm(p * 1.3 + vec2(7.0, 2.0), 3, uSeed + 3);
  return uIntensity * color * light;
}
`,
  uniforms: (ctx) => {
    const edges = Array.from({ length: 8 }, (_, i) => (i < BAND_COUNT - 1 ? ctx.num(`edge${i + 1}`) : 1))
    for (let i = 1; i < 8; i++) edges[i] = Math.max(edges[i], edges[i - 1])
    return {
      uColors: Array.from({ length: 8 }, (_, i) => ctx.colors[Math.min(i, BAND_COUNT - 1)]).flat(),
      uEdges: edges,
      uCount: Math.round(ctx.num('bands')),
      uSoftness: ctx.num('softness'),
      uSoftVary: ctx.num('softVary'),
      uAngle: ctx.num('angle'),
      uWarp: ctx.num('warp'),
      uWarpScale: ctx.num('warpScale'),
      uBandLight: ctx.num('bandLight'),
      uIntensity: ctx.num('intensity'),
    }
  },
  lens: { bloom: 0.05, bloomRadius: 0.7, bloomWidth: 1.5 },
  fromPack: (pack: ColorPack) => {
    const hexes = pack.colors.map((c) => c.hex)
    return Array.from({ length: BAND_COUNT }, (_, i) => hexes[i % hexes.length])
  },
}
