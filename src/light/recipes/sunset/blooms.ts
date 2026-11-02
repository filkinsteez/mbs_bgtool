import type { ColorPack } from '../../color/packs'
import type { RecipeDefinition } from '../../scene'

const GLOW_COUNT = 4

/** A soft vertical base with up to four wide additive glows (core plus haze falloff), no horizon. */
export const sunsetBlooms: RecipeDefinition = {
  id: 'sunset.blooms',
  mood: 'sunset',
  label: 'Blooms',
  colorSlots: [
    { key: 'baseTop', label: 'Base top' },
    { key: 'baseBottom', label: 'Base bottom' },
    { key: 'glow1', label: 'Glow 1' },
    { key: 'glow2', label: 'Glow 2' },
    { key: 'glow3', label: 'Glow 3' },
    { key: 'glow4', label: 'Glow 4' },
  ],
  defaultColors: ['#0B2E7A', '#0064E0', '#1FCDF0', '#7FB4FF', '#FFD61E', '#0064E0'],
  params: [
    { kind: 'number', key: 'glows', label: 'Glows', min: 1, max: GLOW_COUNT, step: 1, default: 3 },
    ...Array.from({ length: GLOW_COUNT }, (_, i) => [
      {
        kind: 'vector' as const,
        key: `glow${i + 1}At`,
        label: `Glow ${i + 1} at`,
        min: -0.5,
        max: 1.5,
        step: 0.005,
        default: [[0.25, 0.3], [0.75, 0.55], [0.45, 0.95], [0.5, 0.5]][i],
      },
      { kind: 'number' as const, key: `glow${i + 1}Radius`, label: `Glow ${i + 1} radius`, min: 0.02, max: 2, step: 0.005, default: [0.45, 0.35, 0.5, 0.3][i] },
      { kind: 'number' as const, key: `glow${i + 1}Gain`, label: `Glow ${i + 1} gain`, min: 0, max: 4, step: 0.01, default: [0.45, 0.3, 0.35, 0.3][i] },
      { kind: 'number' as const, key: `glow${i + 1}Stretch`, label: `Glow ${i + 1} stretch`, min: 0.25, max: 4, step: 0.01, default: [1.6, 1.3, 2, 1][i] },
    ]).flat(),
    { kind: 'number', key: 'haze', label: 'Haze', min: 0, max: 1, step: 0.01, default: 0.25 },
    { kind: 'number', key: 'warp', label: 'Warp', min: 0, max: 0.3, step: 0.002, default: 0.05 },
    { kind: 'number', key: 'warpScale', label: 'Warp scale', min: 0.2, max: 6, step: 0.05, default: 1 },
    { kind: 'number', key: 'intensity', label: 'Intensity', min: 0, max: 3, step: 0.01, default: 1 },
  ],
  fragment: /* glsl */ `
#define GLOW_COUNT ${GLOW_COUNT}
uniform vec3 uBaseTop;
uniform vec3 uBaseBottom;
uniform vec3 uGlowColor[GLOW_COUNT];
uniform vec2 uGlowAt[GLOW_COUNT];
uniform float uGlowRadius[GLOW_COUNT];
uniform float uGlowGain[GLOW_COUNT];
uniform float uGlowStretch[GLOW_COUNT];
uniform int uGlows;
uniform float uHaze;
uniform float uWarp;
uniform float uWarpScale;
uniform float uIntensity;

vec3 radiance(vec2 uv, vec2 p) {
  vec3 color = mix(uBaseTop, uBaseBottom, smoothstep(-0.1, 1.1, uv.y));
  vec2 q = domainWarp(p, uWarp, uWarpScale, 3, uSeed);
  for (int i = 0; i < GLOW_COUNT; i++) {
    if (i >= uGlows) break;
    vec2 center = (uGlowAt[i] - 0.5) * uFrameAspect;
    vec2 d = q - center;
    d.x /= uGlowStretch[i];
    float r = length(d);
    float shape = gaussianSum(r, vec3(uGlowRadius[i], uGlowRadius[i] * 2.5, 1.0), vec3(1.0, uHaze, 0.0));
    color += uGlowColor[i] * uGlowGain[i] * shape;
  }
  return uIntensity * color;
}
`,
  uniforms: (ctx) => ({
    uBaseTop: ctx.color('baseTop'),
    uBaseBottom: ctx.color('baseBottom'),
    uGlowColor: [0, 1, 2, 3].flatMap((i) => ctx.color(`glow${i + 1}`)),
    uGlowAt: [0, 1, 2, 3].flatMap((i) => ctx.vec(`glow${i + 1}At`)),
    uGlowRadius: [0, 1, 2, 3].map((i) => ctx.num(`glow${i + 1}Radius`)),
    uGlowGain: [0, 1, 2, 3].map((i) => ctx.num(`glow${i + 1}Gain`)),
    uGlowStretch: [0, 1, 2, 3].map((i) => ctx.num(`glow${i + 1}Stretch`)),
    uGlows: Math.round(ctx.num('glows')),
    uHaze: ctx.num('haze'),
    uWarp: ctx.num('warp'),
    uWarpScale: ctx.num('warpScale'),
    uIntensity: ctx.num('intensity'),
  }),
  lens: { bloom: 0.08, bloomRadius: 0.8, bloomWidth: 1.5 },
  fromPack: (pack: ColorPack) => {
    const hexes = pack.colors.map((c) => c.hex)
    const dark = hexes[hexes.length - 1]
    return [dark, hexes[0], hexes[1 % hexes.length], hexes[2 % hexes.length], hexes[3 % hexes.length], hexes[0]]
  },
}
