import { linearToOklch } from '../../color/oklab'
import type { ColorPack } from '../../color/packs'
import type { RecipeContext, RecipeDefinition, UniformMap } from '../../scene'
import { composeBands } from './bands-compose'
import type { Rgb } from '../../color/srgb'
import { bridgeLight, closeHues, dimDrift, paleLight } from './bands-light'
import { BAND_MAX, BANDS_COLOR_SLOTS, BANDS_PARAMS, bandKey, BUMP_MAX, LIGHT_MAX, LIGHT_PALE, lightKey, PATCH_MAX, patchKey } from './bands-params'
import { BANDS_SHAPE_GLSL, edgeSeed } from './bands-shape'

/** Gaussian sigma over the lens radius: the same 10-90 edge width as a disc of that radius. */
export const LENS_SIGMA = 0.53
/**
 * The one lens, chosen in one place. From this radius up (every pack frame) it is the engine's disc lens;
 * below it (print presets with a hard edge) a gaussian of the same edge width, since a disc that small would
 * need a source of tens of megapixels. The entry not in use gets radius 0 and an 8 px source.
 */
const DISC_FROM = 0.02
const discRadius = (ctx: RecipeContext) => (ctx.num('lens') >= DISC_FROM ? ctx.num('lens') : 0)
const gaussSigma = (ctx: RecipeContext) => (ctx.num('lens') >= DISC_FROM ? 0 : LENS_SIGMA * ctx.num('lens'))
const LENS_SCATTER: RecipeDefinition['scatter'] = [
  { source: 'aux', shape: 'lens', radius: discRadius, size: () => 8 },
  { source: 'aux', radius: gaussSigma, size: (ctx) => (gaussSigma(ctx) > 0 ? Math.min(1024, Math.ceil(4 / gaussSigma(ctx))) : 8) },
]

const luminance = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

function bandUniforms(ctx: RecipeContext): UniformMap {
  const count = Math.min(Math.round(ctx.num('bands')), BAND_MAX)
  const bandColor = (i: number) => ctx.colors[1 + i]
  const edge: number[] = []
  const wave: number[] = []
  const look: number[] = []
  const tilt: number[] = []
  const sun: number[] = []
  const drift: number[] = []
  const pale: number[] = []
  const core: number[] = []
  const veil: number[] = []
  const bumps: Record<'at' | 'width' | 'top' | 'bottom' | 'cover' | 'light', number[]> = { at: [], width: [], top: [], bottom: [], cover: [], light: [] }
  for (let i = 0; i < BAND_MAX; i++) {
    const key = (name: Parameters<typeof bandKey>[1]) => bandKey(i, name)
    const [paleAmount, coreHeight, corePlace, ownLight] = ctx.vec(key('Pale'))
    const coreColor = ownLight > 0.5 ? bandColor(i).map((v) => v / Math.max(luminance(bandColor(i)), 1e-4)) : paleLight(bandColor(i) as Rgb)
    pale.push(...(paleAmount > 0 ? coreColor.map((v) => v * paleAmount) : [0, 0, 0]))
    core.push(coreHeight, corePlace)
    const [veilAmount, veilHeight] = ctx.vec(key('Veil'))
    veil.push(...(veilAmount > 0 ? paleLight(bandColor(i) as Rgb).map((v) => v * veilAmount) : [0, 0, 0]), veilHeight)
    const [top, bottom] = ctx.vec(key('Edges'))
    const [fadeTop, fadeBottom] = ctx.vec(key('Fade'))
    const [waveTop, waveBottom, wavelength] = ctx.vec(key('Wave'))
    const [tiltTop, tiltBottom, tiltCover] = ctx.vec(key('Tilt'))
    const [sunLight, sunCover] = ctx.vec(key('Sun'))
    edge.push(top, bottom, fadeTop, fadeBottom)
    wave.push(waveTop, waveBottom, Math.max(wavelength, 1e-3), ctx.num(key('FadeVary')))
    look.push(ctx.num(key('Opacity')), ctx.num(key('Light')), Math.round(ctx.num(key('Mode'))), ctx.bool(key('Line')) ? 1 : 0)
    tilt.push(tiltTop, tiltBottom, tiltCover, ctx.num(key('Lean')))
    sun.push(sunLight, sunCover, ctx.num(key('Vary')), 0)
    drift.push(...ctx.vec(key('Drift')).slice(0, 3))
    bumps.at.push(...ctx.vec(key('BumpAt')).slice(0, BUMP_MAX))
    bumps.width.push(...ctx.vec(key('BumpWidth')).slice(0, BUMP_MAX))
    bumps.top.push(...ctx.vec(key('BumpTop')).slice(0, BUMP_MAX))
    bumps.bottom.push(...ctx.vec(key('BumpBottom')).slice(0, BUMP_MAX))
    bumps.cover.push(...ctx.vec(key('BumpCover')).slice(0, BUMP_MAX))
    bumps.light.push(...ctx.vec(key('BumpLight')).slice(0, BUMP_MAX))
  }

  // A lighter neighbour of close hue (or a near-grey one) spills a little of its light across the shared edge,
  // more the lighter it is, so the spill grows smoothly as the light changes.
  const [spillAmount, spillReach] = ctx.vec('spill')
  const spillAbove: number[] = []
  const spillBelow: number[] = []
  const lit = (i: number) => {
    if (i < 0) return ctx.colors[0]
    const c = bandColor(i)
    const k = ctx.num(bandKey(i, 'Light'))
    return [c[0] * k, c[1] * k, c[2] * k]
  }
  const spillFrom = (from: number, into: number): number[] => {
    if (spillAmount <= 0 || from >= count || into >= count) return [0, 0, 0]
    const a = lit(from)
    const b = lit(into)
    const t = Math.min(1, Math.max(0, (linearToOklch(a as Rgb)[0] - linearToOklch(b as Rgb)[0] - 0.06) / 0.1))
    const lighter = t * t * (3 - 2 * t)
    return closeHues(a as Rgb, b as Rgb) ? a.map((v) => v * spillAmount * lighter) : [0, 0, 0]
  }
  for (let i = 0; i < BAND_MAX; i++) {
    spillAbove.push(...spillFrom(i - 1, i))
    spillBelow.push(...spillFrom(i + 1, i))
  }
  // Pale light across a band's top edge where it meets a color far from its own, from both sides' light.
  const bridge: number[] = []
  for (let i = 0; i < BAND_MAX; i++) {
    const amount = i < count ? ctx.num(bandKey(i, 'Bridge')) : 0
    bridge.push(...(amount > 0 ? bridgeLight(lit(i - 1) as Rgb, lit(i) as Rgb).map((v) => v * amount) : [0, 0, 0]))
  }

  const patchShape: number[] = []
  const patchLook: number[] = []
  for (let j = 0; j < PATCH_MAX; j++) {
    patchShape.push(...ctx.vec(patchKey(j, 'Shape')))
    const [opacity, light, mode] = ctx.vec(patchKey(j, 'Look'))
    patchLook.push(opacity, light, Math.round(mode), 0)
  }
  const lightShape: number[] = []
  const lightLook: number[] = []
  const lightColor: number[] = []
  for (let k = 0; k < LIGHT_MAX; k++) {
    lightShape.push(...ctx.vec(lightKey(k, 'Shape')))
    const [gain, kind, band, tail] = ctx.vec(lightKey(k, 'Look'))
    lightLook.push(gain, Math.round(kind), Math.round(band), tail)
    const color = ctx.colors[1 + BAND_MAX + PATCH_MAX + k]
    lightColor.push(...(Math.round(kind) === LIGHT_PALE ? paleLight(color) : color))
  }

  const lens = ctx.num('lens')
  const frameH = Math.max(1 / ctx.aspect, 1)
  return {
    uBandCount: count,
    uPatchCount: Math.min(Math.round(ctx.num('patches')), PATCH_MAX),
    uLightCount: Math.min(Math.round(ctx.num('lights')), LIGHT_MAX),
    uBase: ctx.colors[0],
    uBaseDrift: dimDrift(ctx.colors[0] as Rgb),
    uBandColor: Array.from({ length: BAND_MAX }, (_, i) => bandColor(i)).flat(),
    uPatchColor: Array.from({ length: PATCH_MAX }, (_, j) => ctx.colors[1 + BAND_MAX + j]).flat(),
    uLightColor: lightColor,
    uWaterColor: ctx.colors[1 + BAND_MAX + PATCH_MAX + LIGHT_MAX],
    uBandEdge: edge,
    uBandWave: wave,
    uBandLook: look,
    uBandTilt: tilt,
    uBandSun: sun,
    uBandDrift: drift,
    uBandPale: pale,
    uBandCore: core,
    uBandVeil: veil,
    uSkyVeilColor: ctx.vec('skyTint').map((v) => v * Math.max(0, ctx.vec('skyVeil')[0])),
    uSkyVeilSpan: ctx.vec('skyVeil').slice(1, 4),
    uBumpAt: bumps.at,
    uBumpWidth: bumps.width,
    uBumpTop: bumps.top,
    uBumpBottom: bumps.bottom,
    uBumpCover: bumps.cover,
    uBumpLight: bumps.light,
    uSpillAbove: spillAbove,
    uSpillBelow: spillBelow,
    uBandBridge: bridge,
    uSpillReach: (spillReach * lens) / frameH,
    uPatchShape: patchShape,
    uPatchLook: patchLook,
    uLightShape: lightShape,
    uLightLook: lightLook,
    uSun: ctx.vec('sun'),
    uIntensity: ctx.num('intensity'),
    uDeepen: ctx.num('deepen'),
    uShade: ctx.vec('shade'),
    uInk: ctx.num('ink'),
    uGrainInk: ctx.vec('grainInk'),
    uLightVary: ctx.vec('lightVary'),
    uOverlap: ctx.num('overlap'),
    uExtinction: ctx.num('extinction'),
    uSky: ctx.vec('sky'),
    uWater: ctx.vec('water'),
    uWaterLook: ctx.vec('waterLook'),
    uEdgeSeed: edgeSeed(ctx.seed),
    uBaseLum: Math.max(luminance(ctx.colors[0]), 1e-4),
    uLensDisc: discRadius(ctx) > 0 ? 1 : 0,
    uStackMap: ctx.vec('stack').slice(0, 4),
    uStackShift: ctx.vec('stack').slice(4, 6),
  }
}

/**
 * Up to six stacked bands of pack-colored light, seen through one
 * out-of-focus lens. The scene is built in linear light: outlines of masses
 * are sharp in the scene (softer in some stretches), light transitions are
 * soft in the scene and add where they overlap, every band's light changes
 * slowly inside it, and glows are added light with no edge of their own.
 * Water below a level horizon mirrors the sky above it. The engine renders
 * the scene on a small grid and blurs it once with a Gaussian of the lens's
 * width (scatter), so every edge has the same softness floor and the preview
 * and an export compute the same image.
 */
export const sunsetBands: RecipeDefinition = {
  id: 'sunset.bands',
  mood: 'sunset',
  label: 'Bands',
  colorSlots: BANDS_COLOR_SLOTS,
  defaultColors: composeBands({ pack: null, seed: 1, aspect: 16 / 9 }).colors,
  params: BANDS_PARAMS,
  fragment: /* glsl */ `
${BANDS_SHAPE_GLSL}
#define BAND_MAX ${BAND_MAX}
#define PATCH_MAX ${PATCH_MAX}
#define LIGHT_MAX ${LIGHT_MAX}

uniform int uBandCount;
uniform int uPatchCount;
uniform int uLightCount;
uniform vec3 uBase;
uniform vec3 uBaseDrift;             // how fast the sky's red, green and blue deepen as it dims (0: it keeps its hue)
uniform vec3 uBandColor[BAND_MAX];
uniform vec3 uPatchColor[PATCH_MAX];
uniform vec3 uLightColor[LIGHT_MAX];
uniform vec3 uWaterColor;
uniform vec4 uBandEdge[BAND_MAX];   // top, bottom, scene 10-90 width of the top and of the bottom edge (frame heights)
uniform vec4 uBandWave[BAND_MAX];   // broad wave of the top edge, extra wave of the bottom edge (frame heights), lattice (short sides), change of the scene width along the edges
uniform vec4 uBandLook[BAND_MAX];   // opacity, light, mode (0 cover, 1 multiply, 2 add, 3 light), thin line
uniform vec4 uBandTilt[BAND_MAX];   // tilt of the top edge, extra tilt of the bottom edge, cover tilt, light lean
uniform vec4 uBandSun[BAND_MAX];    // light toward the sun, cover toward the sun, share of the light change, 0
uniform vec3 uBandDrift[BAND_MAX];  // how fast red, green and blue deepen as the band's light dims
uniform vec3 uBandPale[BAND_MAX];   // pale light of the band's own hue at its core, near the light's column (0: none)
uniform vec2 uBandCore[BAND_MAX];   // the band's height (frame heights) and where its core is (0 its top, 1 its height below)
uniform vec4 uBandVeil[BAND_MAX];   // pale light of the band's own hue at its lower edge (rgb, 0: none), the band's height
uniform vec3 uSkyVeilColor;          // light of the pack's own tint where the sky meets the light's side (0: none)
uniform vec3 uSkyVeilSpan;           // where that veil starts and is full (frame heights), the sky's own light change there
uniform vec4 uBumpAt[BAND_MAX];
uniform vec4 uBumpWidth[BAND_MAX];
uniform vec4 uBumpTop[BAND_MAX];
uniform vec4 uBumpBottom[BAND_MAX];
uniform vec4 uBumpCover[BAND_MAX];
uniform vec4 uBumpLight[BAND_MAX];
uniform vec3 uSpillAbove[BAND_MAX];  // light this band takes from the band above, near their edge
uniform vec3 uSpillBelow[BAND_MAX];  // the same from the band below
uniform vec3 uBandBridge[BAND_MAX];  // pale light added across a light band's top edge, most halfway across
uniform float uSpillReach;           // frame heights
uniform vec4 uPatchShape[PATCH_MAX]; // x, y, radius x, radius y
uniform vec4 uPatchLook[PATCH_MAX];  // opacity, light, mode
uniform vec4 uLightShape[LIGHT_MAX]; // x (frame widths), y (frame heights), size across (frame widths), size down (frame heights)
uniform vec4 uLightLook[LIGHT_MAX];  // gain, kind (0 glow, 1 dome, 2 shade), band (-1: the sky behind every band), tail up (frame heights)
uniform vec2 uSun;                   // x, width of the sideways falloff (frame widths)
uniform float uIntensity;
uniform float uDeepen;
uniform vec2 uShade;
uniform float uInk;
uniform vec2 uGrainInk;              // how much grain follows ink, grain on bare base
uniform vec3 uLightVary;             // RMS share of the light change inside bands, lattice along and down (short sides)
uniform float uOverlap;
uniform float uExtinction;           // how much a glow's light takes the place of the sky's own light
uniform vec3 uSky;                   // sky light toward the sun, stops less per frame height above the nominal height, that height
uniform vec4 uWater;                 // horizon (frame heights; above 1.5 off), squeeze, smear, reflection at the bottom edge
uniform vec4 uWaterLook;             // own light, strip gain, strip width (frame heights), ripple lattice (short sides)
uniform int uEdgeSeed;
uniform float uBaseLum;
uniform float uLensDisc;             // 1: the disc lens result, 0: the gaussian one
uniform vec4 uStackMap;              // the stack along a drag: a frame point p shows the scene at (a b; c d) p + shift
uniform vec2 uStackShift;

// Set by combine() for grainWeight(), which the engine calls right after it for the same point.
float gGrainWeight = 1.0;

// Dim light gets deeper (Beer-Lambert powers of its own unit-peak color), so a
// fading warm light reads amber or red instead of olive or brown; w sets how
// fast each channel deepens (a negative one rises), so a color can drift.
vec3 deepen(vec3 c, float level, vec3 w) {
  float fade = saturate(1.0 - level);
  if (uDeepen <= 0.0 || fade <= 0.0) return c;
  float m = maxComponent(c);
  if (m <= 1e-6) return c;
  return m * pow(c / m, max(vec3(0.05), 1.0 + uDeepen * fade * w));
}

vec3 deepen(vec3 c, float level) { return deepen(c, level, vec3(1.0)); }

vec3 toMix(vec3 c) { return uInk > 0.0 ? pow(max(c, vec3(0.0)), vec3(1.0 / (1.0 + uInk))) : c; }

// Scene coverage across an edge with a 10-90 width w: the share of a disk past the edge, as light seen
// through soft air; a disk of radius r is 1.38 r wide from 10 to 90%.
float sceneStep(float d, float w) {
  float t = clamp(d / (w / 1.38), -1.0, 1.0);
  return 0.5 + (t * sqrt(1.0 - t * t) + asin(t)) * (1.0 / PI);
}

// A thin line: sharp core and long tail, peak 1.
float lineCover(float d, float width) {
  float x = d / width;
  float x2 = 0.5 * x * x;
  return 0.55 * exp(-x2 / 0.36) + 0.35 * exp(-x2 / 1.44) + 0.1 * exp(-x2 / 9.0);
}

// Slow light change inside band k: zero mean, RMS about 1.
float lightChange(vec2 p, int k) {
  vec2 q = p / max(uLightVary.yz, vec2(1e-3));
  float n = gradientNoise(q + vec2(3.1 + 7.3 * float(k), 1.7), uEdgeSeed + 211 + 17 * k)
    + 0.3 * gradientNoise(q * 1.8 + vec2(9.4, 4.2 + 5.1 * float(k)), uEdgeSeed + 212 + 17 * k);
  return clamp(n / (0.3052 * 1.044), -2.5, 2.5);
}

// The pack-colored light of everything at frame position (x, v) in front of the lens.
vec3 scene(float x, float v, vec2 p) {
  float dx = x - 0.5;
  float frameH = uFrameAspect.y;
  float sharpest = 1.5 * uPixel / frameH;
  float sunFall = 1.0 / (1.0 + pow(abs(x - uSun.x) / max(uSun.y, 1e-3), 1.6));

  // A dim sky keeps its own hue (Meta Blue sinks to deep navy); a warm one deepens like warm light.
  vec3 base = toMix(deepen(uBase, uIntensity, uBaseDrift));
  float skyGain = (1.0 + uSky.x * sunFall) * exp2(-uSky.y * max(0.0, uSky.z - v));
  if (uLightVary.x > 0.0) skyGain *= max(0.0, 1.0 + uLightVary.x * lightChange(p, BAND_MAX));

  // Glows, pale glows and domes: light in the sky with no edge of their own. Where a glow is strong the sky's
  // own light gives way to it (as at dusk the blue fades near the glow), so the glow shows its own color.
  vec3 glow = vec3(0.0);
  float glowDepth = 0.0;
  for (int k = 0; k < LIGHT_MAX; k++) {
    if (k >= uLightCount) break;
    vec4 s = uLightShape[k];
    vec4 l = uLightLook[k];
    int kind = int(l.y + 0.5);
    if (l.z > -0.5 || kind == 2) continue;
    float across = (x - s.x) / max(s.z, 1e-3);
    float side = 1.0 / (1.0 + across * across);
    float f;
    if (kind != 1) {
      float dv = v - s.y;
      // The light reaches highest over its source, so the glow's top is a broad dome.
      float tail = max(l.w, 1e-3) * (0.55 + 0.45 * side);
      f = exp(dv < 0.0 ? dv / tail : -dv / max(s.w, 1e-3)) * side;
      // Below its peak the glow dims toward the line and the sky comes back only slowly: dusk light there is the
      // glow's own deeper color.
      if (kind == 0) glowDepth += l.x * exp(dv < 0.0 ? dv / tail : -dv / (3.0 * max(s.w, 1e-3))) * side;
    } else {
      float d2 = across * across + pow((v - s.y) / max(s.w, 1e-3), 2.0);
      f = 0.5 * exp(-2.0 * d2) + 0.5 / (1.0 + 4.0 * d2);
    }
    // A dim glow deepens like any dim warm light (amber and red instead of olive or brown).
    glow += toMix(kind == 0 ? deepen(uLightColor[k], f) : uLightColor[k]) * (l.x * f);
  }
  float giveWay = exp(-uExtinction * glowDepth);
  vec3 c = base * skyGain * giveWay;
  if (uSkyVeilColor != vec3(0.0) || uSkyVeilSpan.z != 0.0) {
    // The sky pales toward the light: its full color only at the far edge, then it gives way to a tint of the pack's
    // own colors all the way down to where the bands begin.
    float t = smoothstep(uSkyVeilSpan.x, uSkyVeilSpan.y, v);
    c = c * (1.0 + uSkyVeilSpan.z * t) + toMix(uSkyVeilColor) * t * skyGain * giveWay;
  }
  // Share of the frame here that no covering band hides; the glow shows through it.
  float open = 1.0;

  int shown = -1;
  float shownTop = 0.0;
  float shownBottom = 2.0;
  for (int i = 0; i < BAND_MAX; i++) {
    if (i >= uBandCount) break;
    vec4 edge = uBandEdge[i];
    vec4 wave = uBandWave[i];
    vec4 look = uBandLook[i];
    vec4 tilt = uBandTilt[i];
    vec4 sun = uBandSun[i];
    float shift = tilt.x * dx;
    float shiftBottom = tilt.y * dx;
    float cover = 1.0 + tilt.z * dx;
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
    if (wave.x != 0.0) shift += wave.x * edgeWave(p.x, wave.z, float(2 * i), uEdgeSeed);
    if (wave.y != 0.0) shiftBottom += wave.y * edgeWave(p.x, wave.z, float(2 * i + 1), uEdgeSeed);
    float top = edge.x + shift;
    // A bottom at 2 or more is none: the band runs on past the frame, and past the scene's own frame when a drag
    // draws the stack tighter.
    float bottom = edge.y >= 2.0 ? 1e4 : edge.y + shift + shiftBottom;
    float widthTop = edge.z;
    float widthBottom = edge.w;
    if (wave.w > 0.0) {
      widthTop *= clamp(1.0 + wave.w * gradientNoise(vec2(p.x / 0.5 + 3.7, 11.0 + 3.1 * float(2 * i)), uEdgeSeed + 91) / 0.3052, 0.05, 2.5);
      widthBottom *= clamp(1.0 + wave.w * gradientNoise(vec2(p.x / 0.5 + 8.3, 11.0 + 3.1 * float(2 * i + 1)), uEdgeSeed + 91) / 0.3052, 0.05, 2.5);
    }
    float shape;
    if (look.w > 0.5) {
      float d = v - 0.5 * (top + bottom);
      shape = lineCover(d, max(d < 0.0 ? widthTop : widthBottom, sharpest));
    } else {
      shape = max(0.0, sceneStep(v - top, max(widthTop, sharpest)) - sceneStep(v - bottom, max(widthBottom, sharpest)));
    }
    if (shape <= 1e-5) continue;
    cover = max(cover, 0.0) * mix(1.0, sunFall, sun.y);
    light = max(light, 0.0) * mix(1.0, sunFall, sun.x) * exp(2.0 * tilt.w * dx);
    if (uLightVary.x > 0.0 && sun.z > 0.0) light *= max(0.0, 1.0 + uLightVary.x * sun.z * lightChange(p, i));
    for (int k = 0; k < LIGHT_MAX; k++) {
      if (k >= uLightCount) break;
      vec4 l = uLightLook[k];
      if (l.z < -0.5 || int(l.y + 0.5) != 2 || int(l.z + 0.5) != i) continue;
      float r = (x - uLightShape[k].x) / max(uLightShape[k].z, 1e-3);
      light *= 1.0 - l.x * exp(-0.5 * r * r);
    }
    int mode = int(look.z + 0.5);
    float a = mode == 2 || mode == 3 ? shape * cover : min(1.0, shape * cover * look.x);
    vec3 emit = toMix(deepen(uBandColor[i], light * uIntensity, uBandDrift[i]) * light);
    if (uBandPale[i] != vec3(0.0)) {
      // Bright light goes pale: at its core, close to the light's column, the band's light pales toward white in
      // its own hue, and its full color shows around that.
      float d = (v - top) / max(uBandCore[i].x, 1e-3) - uBandCore[i].y;
      emit += toMix(uBandPale[i]) * light * sunFall * sunFall * exp(-d * d / 0.12);
    }
    if (uBandVeil[i].xyz != vec3(0.0)) {
      // Haze near the light below: a band above the light pales toward its lower edge in its own hue, most near
      // the light's column, so away from it the band keeps its own color.
      float depth = saturate((v - top) / max(uBandVeil[i].w, 1e-3));
      emit += toMix(uBandVeil[i].xyz) * light * sunFall * depth * depth;
    }
    if (mode == 3) {
      // Light bands are the sky's own light too, so they give way to a glow in the same way.
      emit *= giveWay;
      if (uBandBridge[i] != vec3(0.0)) {
        // Two colors far apart never cross-fade: the color above fades out over the upper part of the edge, this
        // band's light comes in over the lower part, and the pale light fills the gap between them.
        float w = max(widthTop, sharpest);
        float gone = cover * sceneStep(v - (top - 0.3 * w), 0.4 * w);
        float come = cover * sceneStep(v - (top + 0.3 * w), 0.4 * w);
        c = c * (1.0 - gone) + emit * come + uBandBridge[i] * giveWay * gone * (1.0 - come);
      } else {
        c = c * pow(1.0 - min(a, 1.0), uOverlap) + emit * pow(min(a, 1.0), uOverlap);
      }
    } else if (mode == 2) {
      c += a * emit;
    } else if (mode == 1) {
      c *= 1.0 - a + a * emit / max(base, vec3(1e-4));
    } else {
      c = mix(c, emit, a);
      open *= 1.0 - a;
    }
    if (shape > 0.5) {
      shown = i;
      shownTop = top;
      shownBottom = i + 1 < uBandCount ? uBandEdge[i + 1].x + uBandTilt[i + 1].x * dx : 2.0;
    }
  }

  c += glow * open;

  // A lighter neighbour of close hue spills a little light into the band shown here, most next to their edge.
  if (shown >= 0 && uSpillReach > 0.0) {
    c += uSpillAbove[shown] * exp(-max(0.0, v - shownTop) / uSpillReach);
    c += uSpillBelow[shown] * exp(-max(0.0, shownBottom - v) / uSpillReach);
  }

  for (int j = 0; j < PATCH_MAX; j++) {
    if (j >= uPatchCount) break;
    vec4 shape = uPatchShape[j];
    vec4 look = uPatchLook[j];
    vec2 q = vec2((x - shape.x) / max(shape.z, 1e-4), (v - shape.y) / max(shape.w, 1e-4));
    float cover = exp(-0.5 * dot(q, q));
    if (cover <= 1e-5) continue;
    int mode = int(look.z + 0.5);
    vec3 emit = toMix(deepen(uPatchColor[j], look.y * uIntensity) * look.y);
    float a = mode == 2 ? cover : min(1.0, cover * look.x);
    if (mode == 2) c += a * emit;
    else if (mode == 1) c *= 1.0 - a + a * emit / max(base, vec3(1e-4));
    else c = mix(c, emit, a);
  }

  vec3 lit = uInk > 0.0 ? pow(max(c, vec3(0.0)), vec3(1.0 + uInk)) : c;
  float shade = max(0.0, 1.0 + uShade.x * dx + uShade.y * (v - 0.5));
  return lit * shade * uIntensity;
}

// Water below a level horizon: the sky mirrored about the line, squeezed toward it, smeared up and down by
// ripples and dimmer with depth, over the water's own light; a soft lighter strip runs under the line.
vec3 water(float x, float v, vec2 p) {
  float frameH = uFrameAspect.y;
  float d = v - uWater.x;
  float ripple = gradientNoise(vec2(p.x / max(uWaterLook.w, 1e-3), d * frameH / max(0.35 * uWaterLook.w, 1e-3)), uEdgeSeed + 503) / 0.3052;
  float smear = uWater.z * d;
  float mirrored = uWater.x - uWater.y * d;
  vec2 pm = vec2(p.x, (mirrored - 0.5) * frameH);
  vec3 sky = 0.5 * (scene(x, mirrored + smear * (0.6 + 0.4 * ripple), pm) + scene(x, mirrored - smear * (0.6 - 0.4 * ripple), pm));
  // The water's own color shows only in the near half; the far water is a clean mirror, since the own color
  // mixed under mirrored warm light turns it mauve.
  float depth = smoothstep(0.5, 1.0, d / max(1.0 - uWater.x, 0.05));
  float reflect = mix(0.95, uWater.w, depth);
  vec3 own = uWaterColor * uWaterLook.x * uIntensity;
  // The bright line on the far water: ripples there catch the glow's brightest light, so the strip adds the
  // light found at the glow's peak.
  float peak = uWater.x - 0.08;
  for (int k = 0; k < LIGHT_MAX; k++) {
    if (k >= uLightCount) break;
    if (uLightLook[k].z < -0.5 && int(uLightLook[k].y + 0.5) == 0) {
      peak = uLightShape[k].y;
      break;
    }
  }
  vec3 caught = scene(x, peak, vec2(p.x, (peak - 0.5) * frameH));
  float strip = uWaterLook.y * exp(-d / max(uWaterLook.z, 1e-4)) * max(0.0, 1.0 + 0.5 * gradientNoise(vec2(p.x / 0.3 + 2.1, 4.4), uEdgeSeed + 509) / 0.3052);
  return reflect * (sky + strip * caught) + (1.0 - reflect) * own;
}

vec3 auxRadiance(vec2 uv, vec2 p) {
  // The scene point this frame point shows: the stack runs along the dragged line (the same point without a drag).
  vec2 q = vec2(dot(uStackMap.xy, p), dot(uStackMap.zw, p)) + uStackShift;
  vec2 s = q / uFrameAspect + 0.5;
  if (uWater.x < 1.5 && s.y > uWater.x) return water(s.x, s.y, q);
  return scene(s.x, s.y, q);
}

// The pipeline's radiance is the lensed scene from combine().
vec3 radiance(vec2 uv, vec2 p) { return vec3(0.0); }

vec3 combine(vec2 uv, vec2 p, vec3 radiance, vec3 disc, vec3 gauss) {
  vec3 lensed = uLensDisc > 0.5 ? disc : gauss;
  if (uGrainInk.x > 0.0) {
    float darkness = saturate(1.0 - luminance(lensed) / (uBaseLum * uIntensity));
    gGrainWeight = mix(1.0, mix(uGrainInk.y, 1.0, darkness), uGrainInk.x);
  }
  return lensed;
}

float grainWeight(vec2 uv, vec2 p) { return gGrainWeight; }
`,
  uniforms: bandUniforms,
  grainWeight: true,
  scatter: LENS_SCATTER,
  // The lensed scene is smooth at half resolution unless the lens is very small (print presets with a hard edge).
  radianceScale: (ctx) => (ctx.num('lens') >= 0.02 ? 0.5 : 1),
  fromPack: (pack: ColorPack) => composeBands({ pack, seed: 1, aspect: 16 / 9 }).colors,
  compose: ({ pack, controls, seed, aspect }) =>
    composeBands({ pack, seed, aspect, intensity: controls.intensity, softness: controls.softness, horizon: controls.mood, drag: controls.drag }),
}
