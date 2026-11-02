import type { ColorPack } from '../../color/packs'
import type { Rgb } from '../../color/srgb'
import type { RecipeContext, RecipeDefinition, UniformMap } from '../../scene'
import { composeBands } from './bands-compose'
import { bridgeLight, isWarm, paleTint } from './bands-light'
import {
  BAND_MAX,
  BANDS_COLOR_SLOTS,
  BANDS_PARAMS,
  bandKey,
  BUMP_MAX,
  MODE_OVER,
  PATCH_MAX,
  patchKey,
} from './bands-params'

const luma = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

/** Frame heights added to every band's reach; covers the one-pixel floor on edge radii at sizes down to about 100 px. */
const REACH_MARGIN = 0.01

function bandUniforms(ctx: RecipeContext): UniformMap {
  const count = Math.round(ctx.num('bands'))
  const base = ctx.colors[0]
  const bandColor = (i: number) => ctx.colors[1 + i]
  const edge: number[] = []
  const reach: number[] = []
  const look: number[] = []
  const warp: number[] = []
  const tilt: number[] = []
  const sun: number[] = []
  const bumpAt: number[] = []
  const bumpWidth: number[] = []
  const bumpTop: number[] = []
  const bumpBottom: number[] = []
  const bumpCover: number[] = []
  const bumpLight: number[] = []
  const pale: number[] = []
  const bridge: number[] = []

  const used = Array.from({ length: Math.min(count, BAND_MAX) }, (_, i) => bandColor(i))
  const warm = used.find(isWarm)
  const lightest = [base, ...used].reduce((a, b) => (luma(b) > luma(a) ? b : a), base)
  const haze = paleTint(warm ?? lightest)
  const bridgeScale = ctx.num('bridge')

  for (let i = 0; i < BAND_MAX; i++) {
    const key = (name: Parameters<typeof bandKey>[1]) => bandKey(i, name)
    const [top, bottom] = ctx.vec(key('Edges'))
    const [above, below] = ctx.vec(key('Soft'))
    const [warpTop, warpBottom] = ctx.vec(key('Warp'))
    const [softVary, coverVary] = ctx.vec(key('Vary'))
    const [tiltTop, tiltBottom, tiltCover] = ctx.vec(key('Tilt'))
    const [sunLight, sunCover] = ctx.vec(key('Sun'))
    const mode = Math.round(ctx.num(key('Mode')))
    const line = ctx.bool(key('Line'))
    const light = ctx.num(key('Light'))
    const hazeShare = ctx.num(key('Haze'))
    const widths = ctx.vec(key('BumpWidth'))
    const sumAbs = (values: number[]) => values.reduce((s, v, j) => s + (widths[j] > 0 ? Math.abs(v) : 0), 0)
    const topShift = warpTop + Math.abs(tiltTop) / 2 + sumAbs(ctx.vec(key('BumpTop')))
    const bottomShift = topShift + warpBottom + Math.abs(tiltBottom) / 2 + sumAbs(ctx.vec(key('BumpBottom')))
    const blur = (1 + softVary) * (line ? 9 : hazeShare > 0 ? 3 : 1 + 1.7321 * ctx.num('rounding'))
    const upReach = topShift + above * blur + REACH_MARGIN
    const downReach = bottomShift + below * blur + REACH_MARGIN
    reach.push(upReach, upReach, downReach, downReach)
    edge.push(top, bottom, above, below)
    look.push(ctx.num(key('Opacity')), light, mode, line ? 1 : 0)
    warp.push(warpTop, warpBottom, ctx.num(key('Waves')), softVary)
    tilt.push(tiltTop, tiltBottom, tiltCover, coverVary)
    sun.push(sunLight, sunCover, ctx.num(key('Haze')), Math.round(ctx.num(key('Noise'))))
    bumpAt.push(...ctx.vec(key('BumpAt')).slice(0, BUMP_MAX))
    bumpWidth.push(...ctx.vec(key('BumpWidth')).slice(0, BUMP_MAX))
    bumpTop.push(...ctx.vec(key('BumpTop')).slice(0, BUMP_MAX))
    bumpBottom.push(...ctx.vec(key('BumpBottom')).slice(0, BUMP_MAX))
    bumpCover.push(...ctx.vec(key('BumpCover')).slice(0, BUMP_MAX))
    bumpLight.push(...ctx.vec(key('BumpLight')).slice(0, BUMP_MAX))
    pale.push(ctx.num(key('Pale')))

    const under = i === 0 ? base : scaled(bandColor(i - 1), Math.min(1, ctx.num(bandKey(i - 1, 'Light'))))
    const own = scaled(bandColor(i), Math.min(1, light))
    const added = i < count && mode === MODE_OVER && !line ? bridgeLight(under, own, haze, bridgeScale) : [0, 0, 0]
    bridge.push(...added)
  }

  const patchShape: number[] = []
  const patchLook: number[] = []
  for (let j = 0; j < PATCH_MAX; j++) {
    patchShape.push(...ctx.vec(patchKey(j, 'Shape')))
    const [opacity, light, mode] = ctx.vec(patchKey(j, 'Look'))
    patchLook.push(opacity, light, Math.round(mode), 0)
  }

  const [sunX, sunWidth] = ctx.vec('sun')
  return {
    uBandCount: Math.min(count, BAND_MAX),
    uPatchCount: Math.min(Math.round(ctx.num('patches')), PATCH_MAX),
    uBase: base,
    uBandColor: Array.from({ length: BAND_MAX }, (_, i) => bandColor(i)).flat(),
    uPatchColor: Array.from({ length: PATCH_MAX }, (_, j) => ctx.colors[1 + BAND_MAX + j]).flat(),
    uBandEdge: edge,
    uBandReach: reach,
    uBandLook: look,
    uBandWarp: warp,
    uBandTilt: tilt,
    uBandSun: sun,
    uBumpAt: bumpAt,
    uBumpWidth: bumpWidth,
    uBumpTop: bumpTop,
    uBumpBottom: bumpBottom,
    uBumpCover: bumpCover,
    uBumpLight: bumpLight,
    uBandPale: pale,
    uBridge: bridge,
    uPatchShape: patchShape,
    uPatchLook: patchLook,
    uSun: [sunX, sunWidth],
    uRounding: ctx.num('rounding'),
    uInk: ctx.num('ink'),
    uShade: ctx.vec('shade'),
    uDeepen: ctx.num('deepen'),
    uIntensity: ctx.num('intensity'),
  }
}

function scaled(color: Rgb, k: number): Rgb {
  return [color[0] * k, color[1] * k, color[2] * k]
}

/**
 * Up to six stacked bands of light, each a translucent layer over the ones
 * above it (or light added to them, or a filter on them), with lens-defocus
 * (disk) edges. Every edge has its own warp, tilt, bumps and softness that
 * change along its length; light and cover can fall off sideways from the
 * sun. Up to four soft patches go on top. Where two distant hues blend, pale
 * light is added so the middle is lighter, not grey.
 */
export const sunsetBands: RecipeDefinition = {
  id: 'sunset.bands',
  mood: 'sunset',
  label: 'Bands',
  colorSlots: BANDS_COLOR_SLOTS,
  defaultColors: composeBands({ pack: null, seed: 1, aspect: 16 / 9 }).colors,
  params: BANDS_PARAMS,
  fragment: /* glsl */ `
#define BAND_MAX ${BAND_MAX}
#define PATCH_MAX ${PATCH_MAX}

uniform int uBandCount;
uniform int uPatchCount;
uniform vec3 uBase;
uniform vec3 uBandColor[BAND_MAX];
uniform vec3 uPatchColor[PATCH_MAX];
uniform vec4 uBandEdge[BAND_MAX];   // top, bottom, softness above, softness below (frame heights)
uniform vec4 uBandReach[BAND_MAX];  // how far each edge's blur and shift reach: above top, below top, above bottom, below bottom
uniform vec4 uBandLook[BAND_MAX];   // opacity, light, mode (0 over, 1 multiply, 2 add), thin line
uniform vec4 uBandWarp[BAND_MAX];   // warp of the top edge, extra warp of the bottom edge, waves across, softness variation
uniform vec4 uBandTilt[BAND_MAX];   // tilt of the top edge, extra tilt of the bottom edge, cover tilt, cover variation
uniform vec4 uBandSun[BAND_MAX];    // light toward the sun, cover toward the sun, haze share, noise number
uniform vec4 uBumpAt[BAND_MAX];
uniform vec4 uBumpWidth[BAND_MAX];
uniform vec4 uBumpTop[BAND_MAX];
uniform vec4 uBumpBottom[BAND_MAX];
uniform vec4 uBumpCover[BAND_MAX];
uniform vec4 uBumpLight[BAND_MAX];
uniform float uBandPale[BAND_MAX];
uniform vec3 uBridge[BAND_MAX];
uniform vec4 uPatchShape[PATCH_MAX]; // x, y, radius x, radius y
uniform vec4 uPatchLook[PATCH_MAX];  // opacity, light, mode
uniform vec2 uSun;                   // x, width of the sideways falloff (frame widths)
uniform float uRounding;
uniform float uInk;
uniform vec2 uShade;
uniform float uDeepen;
uniform float uIntensity;

float edgeHash(int i, int seed) {
  uint h = pcgHash(uint(i + 65536) ^ (uint(seed) * 2654435769u));
  return float(h >> 8u) * (1.0 / 16777216.0);
}

// Low-frequency 1D value noise, roughly in [-1, 1].
float edgeNoise(float x, int seed, int octaves) {
  float sum = 0.0;
  float amplitude = 1.0;
  float norm = 0.0;
  for (int o = 0; o < 3; o++) {
    if (o >= octaves) break;
    float i = floor(x);
    float f = x - i;
    float u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    int s = seed + o * 7919;
    sum += amplitude * (mix(edgeHash(int(i), s), edgeHash(int(i) + 1, s), u) * 2.0 - 1.0);
    norm += amplitude;
    amplitude *= 0.5;
    x = x * 2.03 + 7.31;
  }
  return sum / norm;
}

// Share of a defocus disk of radius 1 that lies past an edge at signed distance t.
float diskStep(float t) {
  t = clamp(t, -1.0, 1.0);
  return 0.5 + (t * sqrt(1.0 - t * t) + asin(t)) * (1.0 / PI);
}

// Blurred step across an edge: a defocus disk, optionally rounded by a small
// gaussian (3-point Gauss-Hermite), mixed with a haze that is a disk three times as wide.
float edgeStep(float d, float radius, float haze) {
  float t = d / radius;
  float core = diskStep(t);
  if (uRounding > 0.0) {
    float o = 1.7320508 * uRounding;
    core = (4.0 * core + diskStep(t + o) + diskStep(t - o)) * (1.0 / 6.0);
  }
  return haze > 0.0 ? mix(core, diskStep(t * (1.0 / 3.0)), haze) : core;
}

// A thin line: sharp core and long tail, peak 1.
float lineCover(float d, float width) {
  float x = d / width;
  float x2 = 0.5 * x * x;
  return 0.55 * exp(-x2 / 0.36) + 0.35 * exp(-x2 / 1.44) + 0.1 * exp(-x2 / 9.0);
}

// Dim light gets deeper (Beer-Lambert powers of its own unit-peak color), so a
// fading warm light reads amber or red instead of olive or brown.
vec3 deepen(vec3 c, float level) {
  float fade = saturate(1.0 - level);
  if (uDeepen <= 0.0 || fade <= 0.0) return c;
  float m = maxComponent(c);
  if (m <= 1e-6) return c;
  return m * pow(c / m, vec3(1.0 + uDeepen * fade));
}

// The pale member of a color's light family (Beer-Lambert power below 1), at the color's own luminance.
vec3 paleOf(vec3 c, float share) {
  float m = maxComponent(c);
  if (m <= 1e-6) return c;
  vec3 pale = pow(c / m, vec3(1.0 - 0.85 * share));
  return pale * (luminance(c) / max(luminance(pale), 1e-6));
}

vec3 toMix(vec3 c) { return uInk > 0.0 ? pow(max(c, vec3(0.0)), vec3(1.0 / (1.0 + uInk))) : c; }

// Front-to-back compositing: acc gathers light from the layers in front, through
// the share of each channel (pass) that the layers in front let through.
// over: a translucent layer; multiply: a filter on what is behind; add: light added.
void layer(inout vec3 acc, inout vec3 pass, vec3 emit, vec3 added, float a, int mode, vec3 base) {
  if (mode == 2) {
    acc += pass * (a * emit);
  } else if (mode == 1) {
    pass *= 1.0 - a + a * emit / max(base, vec3(1e-4));
  } else {
    acc += pass * (a * emit + added);
    pass *= 1.0 - a;
  }
}

vec3 radiance(vec2 uv, vec2 p) {
  float x = uv.x;
  float v = uv.y;
  float dx = x - 0.5;
  float pixel = uPixel / uFrameAspect.y;
  float sunFall = 1.0 / (1.0 + pow(abs(x - uSun.x) / max(uSun.y, 1e-3), 1.6));
  vec3 base = toMix(deepen(uBase, uIntensity));
  vec3 acc = vec3(0.0);
  vec3 pass = vec3(1.0);

  for (int j = PATCH_MAX - 1; j >= 0; j--) {
    if (j >= uPatchCount) continue;
    vec4 shape = uPatchShape[j];
    vec4 look = uPatchLook[j];
    vec2 q = vec2((x - shape.x) / max(shape.z, 1e-4), (v - shape.y) / max(shape.w, 1e-4));
    float cover = exp(-0.5 * dot(q, q));
    if (cover <= 1e-5) continue;
    int mode = int(look.z + 0.5);
    vec3 emit = toMix(deepen(uPatchColor[j], look.y * uIntensity) * look.y);
    layer(acc, pass, emit, vec3(0.0), mode == 2 ? cover : min(1.0, cover * look.x), mode, base);
  }

  for (int i = BAND_MAX - 1; i >= 0; i--) {
    if (i >= uBandCount) continue;
    if (maxComponent(pass) < 1e-3) break;
    vec4 edge = uBandEdge[i];
    vec4 reach = uBandReach[i];
    if (v < edge.x - reach.x || v > edge.y + reach.w) continue;
    vec4 look = uBandLook[i];
    vec4 warp = uBandWarp[i];
    vec4 tilt = uBandTilt[i];
    vec4 sun = uBandSun[i];
    bool line = look.w > 0.5;
    bool nearTop = line || v < edge.x + reach.y;
    bool nearBottom = line || v > edge.y - reach.z;
    int noise = int(sun.w + 0.5);
    int seed = uSeed * 7 + noise * 131;
    float phase = 3.7 * float(noise);
    float shift = 0.0;
    float shiftBottom = 0.0;
    float softness = 1.0;
    if (nearTop || nearBottom) {
      shift = tilt.x * dx;
      if (warp.x > 0.0) shift += warp.x * edgeNoise(x * warp.z + phase, seed, 3);
      if (nearBottom) {
        shiftBottom = tilt.y * dx;
        if (warp.y > 0.0) shiftBottom += warp.y * edgeNoise(x * warp.z + phase + 11.3, seed + 1, 3);
      }
      if (warp.w > 0.0) softness = max(0.05, 1.0 + warp.w * edgeNoise(x * warp.z * 0.8 + phase + 21.1, seed + 2, 2));
    }
    float cover = 1.0 + tilt.z * dx;
    if (tilt.w > 0.0) cover *= 1.0 + tilt.w * edgeNoise(x * warp.z * 0.7 + phase + 31.7, seed + 3, 2);
    float light = look.y;
    for (int j = 0; j < 4; j++) {
      float width = uBumpWidth[i][j];
      if (width <= 0.0) continue;
      float r = (x - uBumpAt[i][j]) / width;
      float g = exp(-0.5 * r * r);
      shift += uBumpTop[i][j] * g;
      shiftBottom += uBumpBottom[i][j] * g;
      cover *= 1.0 + uBumpCover[i][j] * g;
      light *= 1.0 + uBumpLight[i][j] * g;
    }
    cover = max(cover, 0.0) * mix(1.0, sunFall, sun.y);
    light = max(light, 0.0) * mix(1.0, sunFall, sun.x);
    float top = edge.x + shift;
    float bottom = edge.y + shift + shiftBottom;
    float above = max(edge.z * softness, pixel);
    float below = max(edge.w * softness, pixel);
    float shape = 1.0;
    if (line) {
      float d = v - 0.5 * (top + bottom);
      shape = lineCover(d, d < 0.0 ? above : below);
    } else if (nearTop || nearBottom) {
      float enter = nearTop ? edgeStep(v - top, above, sun.z) : 1.0;
      float leave = nearBottom ? edgeStep(v - bottom, below, sun.z) : 0.0;
      shape = max(0.0, enter - leave);
    }
    if (shape <= 1e-5) continue;
    int mode = int(look.z + 0.5);
    float a = mode == 2 ? shape * cover : min(1.0, shape * cover * look.x);
    vec3 color = deepen(uBandColor[i], light * uIntensity);
    float paleShare = uBandPale[i] * (1.0 - min(a, 1.0));
    if (paleShare > 0.0) color = paleOf(color, paleShare);
    vec3 emit = toMix(color * light);
    layer(acc, pass, emit, uBridge[i] * (4.0 * a * (1.0 - a) * min(light, 1.0)), a, mode, base);
  }
  acc += pass * base;

  vec3 lit = uInk > 0.0 ? pow(max(acc, vec3(0.0)), vec3(1.0 + uInk)) : acc;
  float shade = max(0.0, 1.0 + uShade.x * dx + uShade.y * (v - 0.5));
  return lit * shade * uIntensity;
}
`,
  uniforms: bandUniforms,
  fromPack: (pack: ColorPack) => composeBands({ pack, seed: 1, aspect: 16 / 9 }).colors,
  compose: ({ pack, controls, seed, aspect }) =>
    composeBands({ pack, seed, aspect, intensity: controls.intensity, softness: controls.softness, horizon: controls.mood }),
}
