import type { ColorPack } from '../../color/packs'
import type { ComposeInput, Composition, RecipeDefinition } from '../../scene'
import { contourLights, frameHalf, geo, lerp, luminanceOf, pickContourLight, round4, seededRandom } from './beam-compose'

/**
 * Shafts of light through gaps in a cloud layer, converging on a point on
 * the horizon (perspective makes parallel shafts meet there), over a rough
 * glossy floor.
 *
 * - Sky: the light comes from the point's direction through a screen-space
 *   cloud layer around it. Haze at p is lit by what the clouds on the line
 *   between the point and p let through (transmission exp(-optical depth)),
 *   so each gap draws a shaft that keeps its angle and widens with distance,
 *   with shadow between shafts. Shadowed haze keeps some light from the
 *   bright sky. The lit part of the sky is a range of directions from the
 *   point, brightest at one end and brighter farther from the point; past
 *   it the clouds are thicker, so only an occasional gap lets a shaft through.
 * - Horizon: a glow at the light, a thin horizon line, and a band of lit haze
 *   over the horizon, all falling off sideways from the light like a twilight
 *   glow and changing in brightness and width along their length. They get
 *   a short radial integral, so they smear a little toward the point.
 * - Floor: it mirrors the sky (blurred), shows the light as one hot spot
 *   under it stretched toward the camera, and has faint horizontal streaks.
 */

const STREAKS_GLSL = /* glsl */ `
uniform vec3 uLightColor;
uniform vec3 uHazeColor;
uniform vec3 uBaseColor;
uniform vec2 uCenter;      // convergence point (screen, short-side units); the horizon passes through it
uniform vec4 uSky;         // lit directions from, to (radians, 0 = right, -pi/2 = up), edge softness, ramp shape
uniform vec3 uSkyLevel;    // level at the bright end, at the dim end, share of the dim level beyond the lit sky
uniform vec4 uRise;        // amount, start, scale (distance from the point), power (toward straight up)
uniform vec4 uClouds;      // cloud size (per short side), edge contrast, optical depth, light in the shadows
uniform vec4 uLayer;       // cloud layer inner and outer radius, density beyond it, extra density beyond the lit sky
uniform vec4 uHorizon;     // sideways reach, level far to the side, variation along it, short smear
uniform vec4 uGlow;        // offset x from the point, level, core, wide
uniform vec2 uGlowShape;   // squash (height / width), breakup by the floor streaks
uniform vec2 uLine;        // level, width
uniform vec2 uBand;        // level, depth
uniform vec4 uFloorA;      // sky reflection, pool level, pool depth, pool width
uniform vec3 uFloorB;      // streaks, streak scale x, streak scale y
uniform vec3 uPale;        // pale share, from, to (luminance)
uniform vec2 uLook;        // base level, vignette

const int SHADOW_TAPS = 20;
const int SHORT_TAPS = 8;

// Gradient noise with one integer hash per lattice corner; the gradient comes from the
// hash's two 16-bit halves (no trigonometry). About [-1, 1].
vec2 cornerGradient(ivec2 c, uint seed) {
  uint h = pcgHash(uint(c.x) * 1597334677u ^ uint(c.y) * 3812015801u ^ seed);
  return vec2(float(h & 0xffffu), float(h >> 16u)) * (2.0 / 65535.0) - 1.0;
}

float cloudNoise(vec2 p, uint seed) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  ivec2 c = ivec2(i);
  float n00 = dot(cornerGradient(c, seed), f);
  float n10 = dot(cornerGradient(c + ivec2(1, 0), seed), f - vec2(1.0, 0.0));
  float n01 = dot(cornerGradient(c + ivec2(0, 1), seed), f - vec2(0.0, 1.0));
  float n11 = dot(cornerGradient(c + ivec2(1, 1), seed), f - vec2(1.0, 1.0));
  return 1.5 * mix(mix(n00, n10, u.x), mix(n01, n11, u.x), u.y);
}

// Cloud cover of the screen-space cloud layer at q: 0 in a gap, 1 in thick cloud.
float cloudCover(vec2 q) {
  vec2 x = q * uClouds.x;
  float sum = 0.0;
  float amplitude = 1.0;
  uint seed = uint(uSeed) * 7919u + 17u;
  const mat2 turn = mat2(0.8, 0.6, -0.6, 0.8);
  for (int o = 0; o < 3; o++) {
    sum += amplitude * cloudNoise(x, seed + uint(o) * 131u);
    x = turn * x * 2.0 + vec2(17.31, 9.17);
    amplitude *= 0.5;
  }
  return saturate(0.5 + uClouds.y * sum);
}

float rampLevel(float t) {
  return uSkyLevel.x * pow(max(uSkyLevel.y, 1e-4) / max(uSkyLevel.x, 1e-4), pow(saturate(t), uSky.w));
}

// Sky light by direction from the convergence point (x), and how far into the unlit
// side the direction is (y).
vec2 skyDirection(float theta) {
  float from = uSky.x;
  float to = uSky.y;
  float soft = uSky.z;
  float t = (theta - from) / (to - from);
  float a = min(from, to);
  float b = max(from, to);
  float window = smoothstep(a - soft, a + soft, theta) * (1.0 - smoothstep(b - soft, b + soft, theta));
  return vec2(rampLevel(t) * mix(uSkyLevel.z, 1.0, window), 1.0 - window);
}

// Share of the light that reaches the haze at p: the light comes from the point's
// direction, so clouds on the line between the point and p shadow p (transmission
// exp(-optical depth)). Past the cloud layer each gap's shaft keeps its angle, so it
// widens with distance; the shadowed haze still gets some light from the bright sky.
float shaftLight(vec2 d, float r, float unlit) {
  float r0 = uLayer.x;
  float r1 = max(uLayer.y, r0 + 1e-3);
  float rFar = r0 + 2.0 * (r1 - r0);
  float dr = (rFar - r0) / float(SHADOW_TAPS);
  vec2 dir = d / max(r, 1e-5);
  float depth = 0.0;
  for (int k = 0; k < SHADOW_TAPS; k++) {
    float rk = r0 + (float(k) + 0.5) * dr;
    float between = smoothstep(rk - dr, rk + dr, r);
    if (between <= 0.0) break;
    float density = mix(1.0, uLayer.z, smoothstep(r1 - dr, r1 + dr, rk));
    depth += between * density * cloudCover(uCenter + dir * rk);
  }
  depth *= uClouds.z * (1.0 + uLayer.w * unlit) * dr / (r1 - r0);
  return uClouds.w + (1.0 - uClouds.w) * exp(-depth);
}

// The sky seen at p (above the horizon): the light by direction, brighter away from the
// point, times the share that comes through the clouds.
float skyShafts(vec2 p) {
  vec2 d = p - uCenter;
  float r = length(d);
  float theta = atan(d.y, d.x);
  vec2 dirLight = skyDirection(theta);
  if (dirLight.x <= 1e-5) return 0.0;
  float rise = 1.0 + uRise.x * pow(abs(sin(theta)), uRise.w) * smoothstep(uRise.y, uRise.z, r);
  return dirLight.x * rise * shaftLight(d, r, dirLight.y);
}

float floorStreaks(vec2 q) {
  vec2 x = vec2(q.x * uFloorB.y, q.y * uFloorB.z);
  return 0.65 * gradientNoise(x + vec2(8.1, 0.6), uSeed + 211) + 0.35 * gradientNoise(2.1 * x + vec2(1.7, 4.4), uSeed + 223);
}

// The horizon light falls off sideways from the light's azimuth like a twilight glow,
// 1 / (1 + (azimuth / reach)^1.6), toward a far level.
float sideways(float x) {
  float dx = abs(x - uCenter.x - uGlow.x);
  return uHorizon.y + (1.0 - uHorizon.y) / (1.0 + pow(dx / max(uHorizon.x, 1e-3), 1.6));
}

// Slow brightness and width changes along the horizon, about [-1, 1].
vec2 alongHorizon(float x) {
  return vec2(valueNoise(vec2(x * 2.3, 0.5), uSeed + 307), valueNoise(vec2(x * 1.7 + 4.1, 2.5), uSeed + 311));
}

// Soft horizon light at q: the glow at the light, the band of lit haze over the horizon
// (thicker and brighter near the light) and, below the horizon, the light's reflection
// on a rough floor: one hot spot under it, stretched toward the camera.
float horizonGlow(vec2 q, float streak) {
  float cy = uCenter.y;
  float dx = q.x - uCenter.x - uGlow.x;
  float dy = (q.y - cy) / max(uGlowShape.x, 0.02);
  float r2 = dx * dx + dy * dy;
  float core = max(uGlow.z, 1e-3);
  float wide = max(uGlow.w, 1e-3);
  float glow = uGlow.y * (0.4 * exp(-0.5 * r2 / (core * core)) + 0.6 * exp(-0.5 * r2 / (wide * wide)));
  glow *= max(0.0, 1.0 + uGlowShape.y * streak);
  float side = sideways(q.x);
  vec2 drift = alongHorizon(q.x);
  float bandLevel = uBand.x * side * max(0.0, 1.0 + 0.5 * uHorizon.z * drift.x);
  float bandDepth = max(uBand.y, 1e-3) * (0.45 + 0.55 * side) * (1.0 + 0.4 * uHorizon.z * drift.y) * (q.y < cy ? 1.0 : 0.5);
  float band = bandLevel * exp(-abs(cy - q.y) / bandDepth);
  float pool = 0.0;
  if (q.y > cy) {
    // Peaks a little below the horizon and fades toward the camera; nearer floor is wider.
    float t = (q.y - cy) / max(uFloorA.z, 1e-3);
    float across = dx / (max(uFloorA.w, 1e-3) * (1.0 + 0.5 * t));
    pool = uFloorA.y * t * exp(0.5 - 0.5 * t * t) * exp(-0.5 * across * across) * max(0.0, 1.0 + 0.6 * uFloorB.x * streak);
  }
  return glow + band + pool;
}

// The smooth, costly part, rendered once at the scatter pass's working size: the sky's
// shafts (mirrored on the floor), the soft horizon light after a short radial integral,
// and how the floor's streaks change the sky's reflection.
vec3 auxRadiance(vec2 uv, vec2 p) {
  float cy = uCenter.y;
  bool floorSide = p.y > cy;
  vec2 skyPoint = floorSide ? vec2(p.x, 2.0 * cy - p.y) : p;
  float sky = skyShafts(skyPoint);
  float streak = floorStreaks(p);
  vec2 d = p - uCenter;
  float span = -log(max(1.0 - uHorizon.w, 1e-3));
  float step = span / float(SHORT_TAPS - 1);
  float soft = 0.0;
  for (int i = 0; i < SHORT_TAPS; i++) soft += horizonGlow(uCenter + d * exp(-step * float(i)), streak);
  return vec3(sky, soft / float(SHORT_TAPS), max(0.0, 1.0 + 0.5 * uFloorB.x * streak));
}

// The horizon line, at full resolution (a line through the point stays sharp in the
// radial integral). combine() adds the rest and turns the light into color.
vec3 radiance(vec2 uv, vec2 p) {
  float across = (p.y - uCenter.y) / max(uLine.y, 1e-4);
  float side = sideways(p.x);
  return vec3(uLine.x * exp(-0.5 * across * across) * side * side, 0.0, 0.0);
}

vec3 combine(vec2 uv, vec2 p, vec3 line, vec3 cached) {
  // The far floor is seen through the haze at the horizon, so its reflection fades into
  // the sky there instead of stopping at a line.
  float below = max(p.y - uCenter.y, 0.0);
  float far = exp(-below / max(2.0 * uBand.y, 1e-3));
  float sky = cached.x * mix(uFloorA.x * cached.z, 1.0, far);
  float scatter = sky + cached.y + line.x;
  float lumHaze = max(luminance(uHazeColor), 1e-5);
  float lumLight = max(luminance(uLightColor), 1e-5);
  float pale = saturate(uPale.x * smoothstep(uPale.y, uPale.z, scatter * lumHaze));
  vec3 color = uBaseColor * uLook.x + scatter * mix(uHazeColor, uLightColor * (lumHaze / lumLight), pale);
  vec2 half_ = 0.5 * uFrameAspect;
  float vig = 1.0 - uLook.y * dot(p, p) / dot(half_, half_);
  return color * max(vig, 0.0);
}
`

/** Sigma of the scatter pass's blur of the cached sky: it sets the cache's size (about 330 px on the short side). */
const SKY_CACHE_BLUR = 0.012

/** Luminance one unit of scattered light should have, whatever the pack's haze color. */
const HAZE_LUMINANCE = 0.12

/**
 * Pack output. Light (the mood control) moves the point where the shafts meet along the
 * horizon. The seed picks the light, which side of the point is lit (the other side stays
 * dark for text), how far the lit sky reaches, the horizon's height, the clouds (gap size,
 * where the layer sits) and the floor. Intensity is the light's power; Softness thins the
 * clouds and lets more sky light into the shadows (denser haze), so the shafts soften,
 * and widens the horizon line.
 */
function composeStreaks({ pack, controls, seed, aspect }: ComposeInput): Composition {
  const random = seededRandom(seed, 0x57e4)
  const { intensity, softness, mood } = controls
  const { halfW, halfH } = frameHalf(aspect)
  const wide = aspect >= 1
  const light = pickContourLight(pack, random)
  const hazeGain = HAZE_LUMINANCE / Math.max(luminanceOf(light.haze), 0.01)
  const soft = (lo: number, hi: number) => lerp(lo, hi, softness)
  const power = geo(intensity, 0.35, 0.75, 1.7) * hazeGain

  const horizonAt = wide ? lerp(0.58, 0.74, random()) : lerp(0.62, 0.78, random())
  const cy = -halfH + 2 * halfH * horizonAt
  const along = Math.min(0.88, Math.max(0.12, lerp(0.15, 0.85, mood) + lerp(-0.06, 0.06, random())))
  const cx = (along - 0.5) * 2 * halfW
  // Most seeds light the side toward the nearer frame edge, so the dark sky covers the
  // wider part of the frame.
  const litLeft = random() < 0.25 ? along >= 0.5 : along < 0.5
  const end = lerp(1.6, 2.4, random())
  const sky = litLeft ? [lerp(-3.3, -3.05, random()), -Math.PI + end] : [lerp(-0.1, 0.15, random()), -end]
  const glowSide = litLeft ? -1 : 1
  const layerIn = round4(lerp(0.15, 0.25, random()) * Math.min(1, 2 * halfH))

  return {
    colors: [light.light, light.haze, light.base],
    params: {
      center: [round4(cx), round4(cy)],
      sky: [round4(sky[0]), round4(sky[1]), round4(soft(0.3, 0.5)), round4(lerp(0.8, 1.2, random()))],
      skyLevel: [round4(Math.min(8, 2.6 * power)), round4(0.16 * power), round4(lerp(0.15, 0.35, random()))],
      rise: [round4(lerp(4, 7, random())), round4(lerp(0.2, 0.32, random())), round4(lerp(0.9, 1.2, random())), round4(lerp(3.5, 5, random()))],
      clouds: [round4(lerp(4, 8, random())), round4(soft(2.4, 1.4)), round4(soft(3.2, 1.8)), round4(soft(0.15, 0.4))],
      layer: [layerIn, round4(layerIn + lerp(0.25, 0.4, random())), round4(lerp(0.25, 0.5, random())), round4(lerp(0.8, 2.2, random()))],
      horizon: [round4(lerp(0.45, 0.75, random())), round4(lerp(0.03, 0.1, random())), round4(lerp(0.4, 0.8, random())), round4(soft(0.1, 0.25))],
      glow: [round4(glowSide * lerp(0, 0.05, random())), round4(Math.min(4, 1.4 * power)), round4(lerp(0.1, 0.2, random())), round4(lerp(0.25, 0.4, random()))],
      glowShape: [round4(lerp(0.08, 0.2, random())), round4(lerp(0.3, 0.7, random()))],
      line: [round4(Math.min(4, 0.35 * power)), round4(soft(0.005, 0.014))],
      band: [round4(Math.min(6, 2.4 * power)), round4(soft(0.015, 0.03))],
      floor: [round4(lerp(0.25, 0.45, random())), round4(Math.min(8, 2.4 * power)), round4(lerp(0.06, 0.1, random())), round4(lerp(0.2, 0.32, random()))],
      floorStreaks: [round4(lerp(0.2, 0.45, random())), 1.6, 14],
      pale: [0, 0.15, 0.8],
      base: light.baseLevel,
      vignette: round4(lerp(0.08, 0.15, random())),
    },
    lens: { bloom: round4(soft(0.03, 0.06)), bloomLevels: [1, 0.5, 0.25, 0.1, 0, 0, 0, 0], halation: 0 },
    output: { grain: 0 },
  }
}

export const contourStreaks: RecipeDefinition = {
  id: 'contour.streaks',
  mood: 'contour',
  label: 'Streaks',
  colorSlots: [
    { key: 'light', label: 'Light' },
    { key: 'haze', label: 'Haze' },
    { key: 'base', label: 'Base' },
  ],
  defaultColors: ['#B4D4F2', '#3A6699', '#02050B'],
  params: [
    { kind: 'vector', key: 'center', label: 'Point', min: -2, max: 2, step: 0.005, default: [-0.14, 0.22] },
    { kind: 'vector', key: 'sky', label: 'Lit sky', min: -3.6, max: 3.6, step: 0.005, default: [-3.2, -0.72, 0.22, 1.3] },
    { kind: 'vector', key: 'skyLevel', label: 'Sky level', min: 0, max: 8, step: 0.005, default: [3.4, 0.18, 0.3] },
    { kind: 'vector', key: 'rise', label: 'Rise', min: 0, max: 20, step: 0.005, default: [8, 0.25, 0.8, 4] },
    { kind: 'vector', key: 'clouds', label: 'Clouds', min: 0, max: 16, step: 0.005, default: [7, 2, 3, 0.25] },
    { kind: 'vector', key: 'layer', label: 'Cloud layer', min: 0, max: 4, step: 0.005, default: [0.15, 0.45, 0.3, 1.5] },
    { kind: 'vector', key: 'horizon', label: 'Horizon', min: 0, max: 2, step: 0.005, default: [0.55, 0.1, 0.6, 0.3] },
    { kind: 'vector', key: 'glow', label: 'Glow', min: -2, max: 4, step: 0.005, default: [-0.02, 1.35, 0.12, 0.25] },
    { kind: 'vector', key: 'glowShape', label: 'Glow shape', min: 0, max: 3, step: 0.005, default: [0.2, 0.6] },
    { kind: 'vector', key: 'line', label: 'Horizon line', min: 0, max: 4, step: 0.0005, default: [0.6, 0.005] },
    { kind: 'vector', key: 'band', label: 'Band', min: 0, max: 6, step: 0.005, default: [2.5, 0.04] },
    { kind: 'vector', key: 'floor', label: 'Floor', min: 0, max: 8, step: 0.005, default: [0.4, 2, 0.12, 0.3] },
    { kind: 'vector', key: 'floorStreaks', label: 'Floor streaks', min: 0, max: 40, step: 0.005, default: [1, 3, 22] },
    { kind: 'vector', key: 'pale', label: 'Pale', min: 0, max: 2, step: 0.005, default: [0.6, 0.15, 0.8] },
    { kind: 'number', key: 'base', label: 'Base', min: 0, max: 4, step: 0.005, default: 1 },
    { kind: 'number', key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.005, default: 0.1 },
  ],
  fragment: STREAKS_GLSL,
  uniforms: (ctx) => ({
    uLightColor: ctx.color('light'),
    uHazeColor: ctx.color('haze'),
    uBaseColor: ctx.color('base'),
    uCenter: ctx.vec('center'),
    uSky: ctx.vec('sky'),
    uSkyLevel: ctx.vec('skyLevel'),
    uRise: ctx.vec('rise'),
    uClouds: ctx.vec('clouds'),
    uLayer: ctx.vec('layer'),
    uHorizon: ctx.vec('horizon'),
    uGlow: ctx.vec('glow'),
    uGlowShape: ctx.vec('glowShape'),
    uLine: ctx.vec('line'),
    uBand: ctx.vec('band'),
    uFloorA: ctx.vec('floor'),
    uFloorB: ctx.vec('floorStreaks'),
    uPale: ctx.vec('pale'),
    uLook: [ctx.num('base'), ctx.num('vignette')],
  }),
  scatter: [{ source: 'aux', radius: () => SKY_CACHE_BLUR }],
  lens: { bloom: 0.04, bloomLevels: [1, 0.5, 0.25, 0.1, 0, 0, 0, 0], halation: 0 },
  fromPack: (pack: ColorPack) => {
    const { light, haze, base } = contourLights(pack)[0]
    return [light, haze, base]
  },
  compose: composeStreaks,
}
