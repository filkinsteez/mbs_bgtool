import { packHexesByLightness, type ColorPack } from '../../color/packs'
import type { RecipeDefinition } from '../../scene'

const RING_COUNT = 3

/**
 * Up to three ring glows, usually centered off-frame so the frame crops them.
 * Each ring has a sharp core and separate inner and outer tails; the first
 * ring also splits the background into an outside and an inside color.
 */
export const contourHalo: RecipeDefinition = {
  id: 'contour.halo',
  mood: 'contour',
  label: 'Halo',
  colorSlots: [
    { key: 'outside', label: 'Outside' },
    { key: 'inside', label: 'Inside' },
    { key: 'ring1', label: 'Ring 1' },
    { key: 'ring2', label: 'Ring 2' },
    { key: 'ring3', label: 'Ring 3' },
  ],
  defaultColors: ['#9CC8E6', '#0A62E8', '#FFF29A', '#1FCDF0', '#FF8A6A'],
  params: [
    { kind: 'number', key: 'rings', label: 'Rings', min: 1, max: RING_COUNT, step: 1, default: 1 },
    ...Array.from({ length: RING_COUNT }, (_, i) => [
      {
        kind: 'vector' as const,
        key: `ring${i + 1}At`,
        label: `Ring ${i + 1} at`,
        min: -1.5,
        max: 2.5,
        step: 0.005,
        default: [[1.15, 1.05], [0.5, 0.25], [0.4, 0.85]][i],
      },
      { kind: 'number' as const, key: `ring${i + 1}Radius`, label: `Ring ${i + 1} radius`, min: 0.02, max: 3, step: 0.005, default: [1.05, 0.2, 0.3][i] },
      { kind: 'number' as const, key: `ring${i + 1}Gain`, label: `Ring ${i + 1} gain`, min: 0, max: 8, step: 0.01, default: [0.5, 0.8, 0.8][i] },
    ]).flat(),
    { kind: 'number', key: 'coreWidth', label: 'Core width', min: 0.001, max: 0.3, step: 0.001, default: 0.06 },
    { kind: 'number', key: 'tailIn', label: 'Inner tail', min: 0.002, max: 1, step: 0.002, default: 0.12 },
    { kind: 'number', key: 'tailOut', label: 'Outer tail', min: 0.002, max: 1, step: 0.002, default: 0.2 },
    { kind: 'number', key: 'tailWeight', label: 'Tail weight', min: 0, max: 2, step: 0.01, default: 0.3 },
    { kind: 'number', key: 'insideMix', label: 'Inside', min: 0, max: 1, step: 0.01, default: 1 },
    { kind: 'number', key: 'edgeSoftness', label: 'Edge softness', min: 0.002, max: 1, step: 0.002, default: 0.25 },
    { kind: 'number', key: 'warp', label: 'Warp', min: 0, max: 0.2, step: 0.002, default: 0.01 },
    { kind: 'number', key: 'intensity', label: 'Intensity', min: 0, max: 4, step: 0.01, default: 1 },
  ],
  fragment: /* glsl */ `
#define RING_COUNT ${RING_COUNT}
uniform vec3 uOutside;
uniform vec3 uInside;
uniform vec3 uRingColor[RING_COUNT];
uniform vec2 uRingAt[RING_COUNT];
uniform float uRingRadius[RING_COUNT];
uniform float uRingGain[RING_COUNT];
uniform int uRings;
uniform float uCoreWidth;
uniform float uTailIn;
uniform float uTailOut;
uniform float uTailWeight;
uniform float uInsideMix;
uniform float uEdgeSoftness;
uniform float uWarp;
uniform float uIntensity;

float ringProfile(float d) {
  float core = max(uCoreWidth, 0.7 * uPixel);
  float tail = softInverseSquare(d, d < 0.0 ? uTailIn : uTailOut);
  return gaussian(d, core) * (uCoreWidth / core) + uTailWeight * tail;
}

vec3 radiance(vec2 uv, vec2 p) {
  vec2 q = domainWarp(p, uWarp, 1.5, 2, uSeed);
  vec2 c0 = (uRingAt[0] - 0.5) * uFrameAspect;
  float d0 = length(q - c0) - uRingRadius[0];
  vec3 color = mix(uOutside, uInside, uInsideMix * softStep(-d0, uEdgeSoftness));
  for (int i = 0; i < RING_COUNT; i++) {
    if (i >= uRings) break;
    vec2 c = (uRingAt[i] - 0.5) * uFrameAspect;
    float d = length(q - c) - uRingRadius[i];
    color += uRingColor[i] * uRingGain[i] * ringProfile(d);
  }
  return uIntensity * color;
}
`,
  uniforms: (ctx) => ({
    uOutside: ctx.color('outside'),
    uInside: ctx.color('inside'),
    uRingColor: [0, 1, 2].flatMap((i) => ctx.color(`ring${i + 1}`)),
    uRingAt: [0, 1, 2].flatMap((i) => ctx.vec(`ring${i + 1}At`)),
    uRingRadius: [0, 1, 2].map((i) => ctx.num(`ring${i + 1}Radius`)),
    uRingGain: [0, 1, 2].map((i) => ctx.num(`ring${i + 1}Gain`)),
    uRings: Math.round(ctx.num('rings')),
    uCoreWidth: ctx.num('coreWidth'),
    uTailIn: ctx.num('tailIn'),
    uTailOut: ctx.num('tailOut'),
    uTailWeight: ctx.num('tailWeight'),
    uInsideMix: ctx.num('insideMix'),
    uEdgeSoftness: ctx.num('edgeSoftness'),
    uWarp: ctx.num('warp'),
    uIntensity: ctx.num('intensity'),
  }),
  lens: { bloom: 0.06, bloomRadius: 0.6, bloomWidth: 1.5 },
  fromPack: (pack: ColorPack) => {
    const hexes = pack.colors.map((c) => c.hex)
    const lightest = packHexesByLightness(pack).at(-1) ?? hexes[0]
    return ['#000000', hexes[0], lightest, hexes[1 % hexes.length], hexes[2 % hexes.length]]
  },
}
