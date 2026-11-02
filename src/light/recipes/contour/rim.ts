import { packHexesByLightness, type ColorPack } from '../../color/packs'
import type { RecipeDefinition } from '../../scene'

/**
 * Light caught by one edge: a sharp gaussian core plus an inverse-square tail
 * along the boundary of a rounded triangle (or along a single line), lit from
 * one direction, with a faint glow filling the inside of the shape.
 */
export const contourRim: RecipeDefinition = {
  id: 'contour.rim',
  mood: 'contour',
  label: 'Rim',
  colorSlots: [
    { key: 'background', label: 'Background' },
    { key: 'interior', label: 'Interior' },
    { key: 'core', label: 'Core' },
    { key: 'tail', label: 'Tail' },
  ],
  defaultColors: ['#000000', '#06142E', '#DCE8FF', '#2F6BD8'],
  params: [
    { kind: 'boolean', key: 'line', label: 'Line', default: false },
    { kind: 'vector', key: 'a', label: 'Point A', min: -1, max: 2, step: 0.005, default: [-0.4, 0.13] },
    { kind: 'vector', key: 'b', label: 'Point B', min: -1, max: 2, step: 0.005, default: [0.72, 0.13] },
    { kind: 'vector', key: 'c', label: 'Point C', min: -1, max: 2, step: 0.005, default: [-0.05, 1.15] },
    { kind: 'number', key: 'corner', label: 'Corner', min: 0, max: 0.4, step: 0.002, default: 0.06 },
    { kind: 'number', key: 'coreWidth', label: 'Core width', min: 0.0005, max: 0.05, step: 0.0005, default: 0.004 },
    { kind: 'number', key: 'tailWidth', label: 'Tail width', min: 0.002, max: 0.4, step: 0.001, default: 0.03 },
    { kind: 'number', key: 'tailWeight', label: 'Tail weight', min: 0, max: 2, step: 0.01, default: 0.35 },
    { kind: 'number', key: 'intensity', label: 'Intensity', min: 0, max: 12, step: 0.05, default: 2.5 },
    { kind: 'vector', key: 'lightAt', label: 'Light at', min: -1, max: 2, step: 0.005, default: [0.75, 0.1] },
    { kind: 'number', key: 'lightReach', label: 'Light reach', min: 0.05, max: 4, step: 0.01, default: 0.9 },
    { kind: 'number', key: 'ambient', label: 'Ambient', min: 0, max: 1, step: 0.01, default: 0.1 },
    { kind: 'number', key: 'fill', label: 'Fill', min: 0, max: 2, step: 0.01, default: 0.6 },
    { kind: 'number', key: 'fillDepth', label: 'Fill depth', min: 0.01, max: 1.5, step: 0.01, default: 0.35 },
    { kind: 'number', key: 'fade', label: 'Line fade', min: 0, max: 1, step: 0.01, default: 1 },
    { kind: 'number', key: 'taper', label: 'Line taper', min: 0, max: 1, step: 0.01, default: 0.6 },
  ],
  fragment: /* glsl */ `
uniform vec3 uBackground;
uniform vec3 uInterior;
uniform vec3 uCore;
uniform vec3 uTail;
uniform bool uLine;
uniform vec2 uA;
uniform vec2 uB;
uniform vec2 uC;
uniform float uCorner;
uniform float uCoreWidth;
uniform float uTailWidth;
uniform float uTailWeight;
uniform float uIntensity;
uniform vec2 uLightAt;
uniform float uLightReach;
uniform float uAmbient;
uniform float uFill;
uniform float uFillDepth;
uniform float uFade;
uniform float uTaper;

float shapeDistance(vec2 p, vec2 a, vec2 b, vec2 c) {
  return sdRoundedTriangle(p, a, b, c, uCorner);
}

vec3 radiance(vec2 uv, vec2 p) {
  vec2 a = (uA - 0.5) * uFrameAspect;
  vec2 b = (uB - 0.5) * uFrameAspect;
  vec2 c = (uC - 0.5) * uFrameAspect;
  // Keep the core at least about one sample wide so thin rims do not alias.
  float core = max(uCoreWidth, 0.7 * uPixel);
  vec3 color = uBackground;

  if (uLine) {
    float d = sdSegment(p, a, b);
    float along = segmentParam(p, a, b);
    float tail = uTailWidth * mix(1.0 - uTaper, 1.0, along);
    float gain = uIntensity * mix(uFade, 1.0, along);
    color += gain * (uCore * gaussian(d, core) * (uCoreWidth / core) + uTail * uTailWeight * softInverseSquare(d, tail));
    return color;
  }

  float d = shapeDistance(p, a, b, c);
  // Brightness falls off with distance from one light position; smooth everywhere, unlike SDF normals.
  vec2 lightAt = (uLightAt - 0.5) * uFrameAspect;
  float lit = mix(uAmbient, 1.0, gaussian(length(p - lightAt), uLightReach));

  float inside = 1.0 - softStep(d, core);
  color += inside * uInterior * uFill * expHaze(-d, uFillDepth) * lit;
  float rim = gaussian(d, core) * (uCoreWidth / core);
  float glow = uTailWeight * softInverseSquare(d, uTailWidth);
  color += uIntensity * lit * (uCore * rim + uTail * glow);
  return color;
}
`,
  uniforms: (ctx) => ({
    uBackground: ctx.color('background'),
    uInterior: ctx.color('interior'),
    uCore: ctx.color('core'),
    uTail: ctx.color('tail'),
    uLine: ctx.bool('line'),
    uA: ctx.vec('a'),
    uB: ctx.vec('b'),
    uC: ctx.vec('c'),
    uCorner: ctx.num('corner'),
    uCoreWidth: ctx.num('coreWidth'),
    uTailWidth: ctx.num('tailWidth'),
    uTailWeight: ctx.num('tailWeight'),
    uIntensity: ctx.num('intensity'),
    uLightAt: ctx.vec('lightAt'),
    uLightReach: ctx.num('lightReach'),
    uAmbient: ctx.num('ambient'),
    uFill: ctx.num('fill'),
    uFillDepth: ctx.num('fillDepth'),
    uFade: ctx.num('fade'),
    uTaper: ctx.num('taper'),
  }),
  lens: { bloom: 0.06, bloomRadius: 0.45, bloomWidth: 1.5, halation: 0.15, halationThreshold: 0.8, halationRadius: 0.04 },
  fromPack: (pack: ColorPack) => {
    const byLightness = packHexesByLightness(pack)
    return ['#000000', byLightness[0], byLightness.at(-1) ?? byLightness[0], pack.colors[0].hex]
  },
}
