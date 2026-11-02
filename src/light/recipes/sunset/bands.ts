import type { ColorPack } from '../../color/packs'
import type { Rgb } from '../../color/srgb'
import type { RecipeContext, RecipeDefinition, UniformMap } from '../../scene'
import { bandBoundary } from './bands-boundary'
import { composeBands } from './bands-compose'
import { bridgeEnds } from './bands-light'
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
import { BOUNDARY_GLSL } from './boundary'

/** Frame heights added to every band's reach; covers the one-pixel floor on edge radii at sizes down to about 100 px. */
const REACH_MARGIN = 0.01

function bandUniforms(ctx: RecipeContext): UniformMap {
  const count = Math.round(ctx.num('bands'))
  const base = ctx.colors[0]
  const bandColor = (i: number) => ctx.colors[1 + i]
  const boundary = bandBoundary(ctx, Math.min(count, BAND_MAX))
  const edge: number[] = []
  const reach: number[] = []
  const look: number[] = []
  const tilt: number[] = []
  const sun: number[] = []
  const bumpAt: number[] = []
  const bumpWidth: number[] = []
  const bumpTop: number[] = []
  const bumpBottom: number[] = []
  const bumpCover: number[] = []
  const bumpLight: number[] = []
  const pale: number[] = []
  const down: number[] = []
  const bridgeUnder: number[] = []
  const bridgeOwn: number[] = []

  const bridgeScale = ctx.num('bridge')

  for (let i = 0; i < BAND_MAX; i++) {
    const key = (name: Parameters<typeof bandKey>[1]) => bandKey(i, name)
    const [top, bottom] = ctx.vec(key('Edges'))
    const [above, below] = ctx.vec(key('Soft'))
    const [tiltTop, tiltBottom, tiltCover] = ctx.vec(key('Tilt'))
    const [sunLight, sunCover] = ctx.vec(key('Sun'))
    const mode = Math.round(ctx.num(key('Mode')))
    const line = ctx.bool(key('Line'))
    const light = ctx.num(key('Light'))
    const hazeShare = ctx.num(key('Haze'))
    const softVary = ctx.num(key('SoftVary'))
    const widths = ctx.vec(key('BumpWidth'))
    const sumAbs = (values: number[]) => values.reduce((s, v, j) => s + (widths[j] > 0 ? Math.abs(v) : 0), 0)
    const [moveTop, moveBottom] = boundary.move[i]
    const leanTop = Math.abs(tiltTop) / 2 + sumAbs(ctx.vec(key('BumpTop')))
    const topShift = leanTop + moveTop
    const bottomShift = leanTop + Math.abs(tiltBottom) / 2 + sumAbs(ctx.vec(key('BumpBottom'))) + moveBottom
    const blur = boundary.softMax ** softVary * (line ? 9 : hazeShare > 0 ? 3 : 1 + 1.7321 * ctx.num('rounding'))
    const upReach = topShift + above * blur + REACH_MARGIN
    const downReach = bottomShift + below * blur + REACH_MARGIN
    reach.push(upReach, upReach, downReach, downReach)
    edge.push(top, bottom, above, below)
    look.push(ctx.num(key('Opacity')), light, mode, line ? 1 : 0)
    tilt.push(tiltTop, tiltBottom, tiltCover, 0)
    sun.push(sunLight, sunCover, hazeShare, softVary)
    bumpAt.push(...ctx.vec(key('BumpAt')).slice(0, BUMP_MAX))
    bumpWidth.push(...ctx.vec(key('BumpWidth')).slice(0, BUMP_MAX))
    bumpTop.push(...ctx.vec(key('BumpTop')).slice(0, BUMP_MAX))
    bumpBottom.push(...ctx.vec(key('BumpBottom')).slice(0, BUMP_MAX))
    bumpCover.push(...ctx.vec(key('BumpCover')).slice(0, BUMP_MAX))
    bumpLight.push(...ctx.vec(key('BumpLight')).slice(0, BUMP_MAX))
    pale.push(ctx.num(key('Pale')))
    down.push(...ctx.vec(key('LightDown')))

    const under = i === 0 ? base : scaled(bandColor(i - 1), Math.min(1, ctx.num(bandKey(i - 1, 'Light'))))
    const own = scaled(bandColor(i), Math.min(1, light))
    const [atUnder, atOwn] = i < count && mode === MODE_OVER && !line ? bridgeEnds(under, own, bridgeScale, ctx.num('intensity')) : [[0, 0, 0], [0, 0, 0]]
    bridgeUnder.push(...atUnder)
    bridgeOwn.push(...atOwn)
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
    ...boundary.uniforms,
    uBandCount: Math.min(count, BAND_MAX),
    uPatchCount: Math.min(Math.round(ctx.num('patches')), PATCH_MAX),
    uBase: base,
    uBandColor: Array.from({ length: BAND_MAX }, (_, i) => bandColor(i)).flat(),
    uPatchColor: Array.from({ length: PATCH_MAX }, (_, j) => ctx.colors[1 + BAND_MAX + j]).flat(),
    uBandEdge: edge,
    uBandReach: reach,
    uBandLook: look,
    uBandTilt: tilt,
    uBandSun: sun,
    uBumpAt: bumpAt,
    uBumpWidth: bumpWidth,
    uBumpTop: bumpTop,
    uBumpBottom: bumpBottom,
    uBumpCover: bumpCover,
    uBumpLight: bumpLight,
    uBandPale: pale,
    uBandDown: down,
    uBridgeUnder: bridgeUnder,
    uBridgeOwn: bridgeOwn,
    uPatchShape: patchShape,
    uPatchLook: patchLook,
    uSun: [sunX, sunWidth],
    uRounding: ctx.num('rounding'),
    uInk: ctx.num('ink'),
    uShade: ctx.vec('shade'),
    uDeepen: ctx.num('deepen'),
    uIntensity: ctx.num('intensity'),
    uGrainInk: ctx.vec('grainInk'),
    uLightVary: ctx.vec('lightVary'),
  }
}

function scaled(color: Rgb, k: number): Rgb {
  return [color[0] * k, color[1] * k, color[2] * k]
}

/**
 * Up to six stacked bands of light, each a translucent layer over the ones
 * above it (or light added to them, or a filter on them), with lens-defocus
 * (disk) edges. Every edge wanders and changes softness along its length
 * through the shared boundary model (boundary.ts, edge mode), on top of its
 * own tilt and bumps; light and cover can fall off sideways from the sun. Up
 * to four soft patches go on top. Where two distant hues blend, pale light is
 * added so the middle is lighter, not grey.
 */
export const sunsetBands: RecipeDefinition = {
  id: 'sunset.bands',
  mood: 'sunset',
  label: 'Bands',
  colorSlots: BANDS_COLOR_SLOTS,
  defaultColors: composeBands({ pack: null, seed: 1, aspect: 16 / 9 }).colors,
  params: BANDS_PARAMS,
  fragment: /* glsl */ `
${BOUNDARY_GLSL}
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
uniform vec3 uEdgeBnd[2 * BAND_MAX]; // per band, top then bottom edge: boundary transition (-1: none), distance from its group's anchor (frame heights, 0 or less), amount of the factor on that distance
uniform vec4 uBandTilt[BAND_MAX];   // tilt of the top edge, extra tilt of the bottom edge, cover tilt, 0
uniform vec4 uBandSun[BAND_MAX];    // light toward the sun, cover toward the sun, haze share, power on the softness change
uniform vec4 uBumpAt[BAND_MAX];
uniform vec4 uBumpWidth[BAND_MAX];
uniform vec4 uBumpTop[BAND_MAX];
uniform vec4 uBumpBottom[BAND_MAX];
uniform vec4 uBumpCover[BAND_MAX];
uniform vec4 uBumpLight[BAND_MAX];
uniform float uBandPale[BAND_MAX];
uniform vec2 uBandDown[BAND_MAX];   // share of the light above nominal at the top edge, depth where it is full (frame heights; 0 off)
uniform vec3 uBridgeUnder[BAND_MAX]; // pale light added where a band blends with what is under it, at the under end
uniform vec3 uBridgeOwn[BAND_MAX];   // the same at the band's own end
uniform vec4 uPatchShape[PATCH_MAX]; // x, y, radius x, radius y
uniform vec4 uPatchLook[PATCH_MAX];  // opacity, light, mode
uniform vec2 uSun;                   // x, width of the sideways falloff (frame widths)
uniform float uRounding;
uniform float uInk;
uniform vec2 uShade;
uniform float uDeepen;
uniform float uIntensity;
uniform vec2 uGrainInk;              // how much grain follows ink, grain on bare base
uniform vec3 uLightVary;             // slow change of light: RMS share, lattice along and down (short-side units)

// Set by radiance() for grainWeight(), which the engine calls right after it for the same point.
float gGrainWeight = 1.0;

// The last transition evaluated at this point, so the edges of one group (a glow's top and its
// horizon) share the work. radiance() resets it.
int gBndJ = -1;
float gBndMove = 0.0;
float gBndSoft = 1.0;

// An edge's move from the boundary model, in frame heights: its group's displacement and, for an edge
// above the group's anchor, its distance from the anchor times a slow positive factor, so the two never
// cross. soft gets the edge's softness factor, raised to the band's power.
float edgeMove(float a, float frameH, vec3 link, float power, inout float soft) {
  if (link.x < 0.0) return 0.0;
  int j = int(link.x + 0.5);
  if (j != gBndJ) {
    gBndJ = j;
    gBndMove = boundaryEdge(a, j);
    gBndSoft = boundarySoft(a, j);
  }
  float move = gBndMove / frameH;
  if (link.z > 0.0) {
    // Two octaves on the model's own lattice along the edge.
    float n = gradientNoise(vec2(a * uBndWarp.y + 13.7, 3.1 * float(j) + 0.4), uBndSeed + 4243);
    n += uBndShape.x * gradientNoise(vec2(a * 2.0 * uBndWarp.y + 16.0, 3.1 * float(j) + 2.9), uBndSeed + 4304);
    move += link.y * (exp(link.z * clamp(n / BND_RMS, -2.5, 2.5)) - 1.0);
  }
  soft = pow(gBndSoft, power);
  return move;
}

// The model's fine feather of an edge at signed distance d (frame heights) from it.
float edgeFeather(float a, float frameH, float transition, float d) {
  if (transition < 0.0 || uBndFeather.x <= 0.0) return 0.0;
  int j = int(transition + 0.5);
  return boundaryFeather(a, uBndTrans[j].x + d * frameH, j) / frameH;
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
  float frameH = uFrameAspect.y;
  float pixel = uPixel / frameH;
  gBndJ = -1;
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
    vec3 linkTop = uEdgeBnd[2 * i];
    vec3 linkBottom = uEdgeBnd[2 * i + 1];
    vec4 tilt = uBandTilt[i];
    vec4 sun = uBandSun[i];
    bool line = look.w > 0.5;
    bool nearTop = line || v < edge.x + reach.y;
    bool nearBottom = line || v > edge.y - reach.z;
    // The bottom edge follows the top edge's tilt and bumps; each edge has its own move from the boundary model.
    float shift = 0.0;
    float shiftBottom = 0.0;
    float moveTop = 0.0;
    float moveBottom = 0.0;
    float softTop = 1.0;
    float softBottom = 1.0;
    if (nearTop || nearBottom) {
      shift = tilt.x * dx;
      if (nearTop) moveTop = edgeMove(p.x, frameH, linkTop, sun.w, softTop);
      if (nearBottom) {
        shiftBottom = tilt.y * dx;
        moveBottom = edgeMove(p.x, frameH, linkBottom, sun.w, softBottom);
      }
    }
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
    cover = max(cover, 0.0) * mix(1.0, sunFall, sun.y);
    light = max(light, 0.0) * mix(1.0, sunFall, sun.x);
    float top = edge.x + shift + moveTop;
    float bottom = edge.y + shift + shiftBottom + moveBottom;
    vec2 down = uBandDown[i];
    if (down.y > 0.0 && light > 1.0) light = 1.0 + (light - 1.0) * mix(down.x, 1.0, smoothstep(0.0, 1.0, (v - top) / down.y));
    float above = max(edge.z * softTop, pixel);
    float below = max(edge.w * softBottom, pixel);
    float shape = 1.0;
    if (line) {
      float d = v - 0.5 * (top + bottom);
      shape = lineCover(d, d < 0.0 ? above : below);
    } else if (nearTop || nearBottom) {
      float enter = nearTop ? edgeStep(v - top + edgeFeather(p.x, frameH, linkTop.x, v - top), above, sun.z) : 1.0;
      float leave = nearBottom ? edgeStep(v - bottom + edgeFeather(p.x, frameH, linkBottom.x, v - bottom), below, sun.z) : 0.0;
      shape = max(0.0, enter - leave);
    }
    if (shape <= 1e-5) continue;
    int mode = int(look.z + 0.5);
    float a = mode == 2 ? shape * cover : min(1.0, shape * cover * look.x);
    vec3 color = deepen(uBandColor[i], light * uIntensity);
    float paleShare = uBandPale[i] * (1.0 - min(a, 1.0));
    if (paleShare > 0.0) color = paleOf(color, paleShare);
    vec3 emit = toMix(color * light);
    vec3 bridge = mix(uBridgeUnder[i], uBridgeOwn[i], a) * (4.0 * a * (1.0 - a) * min(light, 1.0));
    layer(acc, pass, emit, bridge, a, mode, base);
  }
  acc += pass * base;

  vec3 lit = uInk > 0.0 ? pow(max(acc, vec3(0.0)), vec3(1.0 + uInk)) : acc;
  float shade = max(0.0, 1.0 + uShade.x * dx + uShade.y * (v - 0.5));
  if (uLightVary.x > 0.0) {
    // Two octaves; 0.3234 is the RMS of the sum, so the share is the RMS change of light.
    vec2 q = p / max(uLightVary.yz, vec2(1e-3));
    float n = gradientNoise(q + vec2(3.7, 1.9), uSeed + 811) + 0.35 * gradientNoise(2.0 * q + vec2(8.1, 5.3), uSeed + 977);
    shade *= 1.0 + uLightVary.x * clamp(n / 0.3234, -2.5, 2.5);
  }
  if (uGrainInk.x > 0.0) {
    float darkness = saturate(1.0 - luminance(lit) / max(luminance(deepen(uBase, uIntensity)), 1e-4));
    gGrainWeight = mix(1.0, mix(uGrainInk.y, 1.0, darkness), uGrainInk.x);
  }
  return lit * shade * uIntensity;
}

float grainWeight(vec2 uv, vec2 p) { return gGrainWeight; }
`,
  uniforms: bandUniforms,
  grainWeight: true,
  // Half-resolution radiance when every edge, at its sharpest along its length, is wider than about 0.6% of the frame height.
  radianceScale: (ctx) => {
    const count = Math.min(Math.round(ctx.num('bands')), BAND_MAX)
    const sharpest = Math.exp(-2.5 * ctx.vec('boundarySoft')[0])
    let thinnest = Infinity
    for (let i = 0; i < count; i++) {
      const [above, below] = ctx.vec(bandKey(i, 'Soft'))
      const [top, bottom] = ctx.vec(bandKey(i, 'Edges'))
      const k = sharpest ** ctx.num(bandKey(i, 'SoftVary'))
      thinnest = Math.min(thinnest, top > -0.5 ? above * k : Infinity, bottom < 1.5 ? below * k : Infinity)
    }
    return thinnest >= 0.006 ? 0.5 : 1
  },
  fromPack: (pack: ColorPack) => composeBands({ pack, seed: 1, aspect: 16 / 9 }).colors,
  compose: ({ pack, controls, seed, aspect }) =>
    composeBands({ pack, seed, aspect, intensity: controls.intensity, softness: controls.softness, horizon: controls.mood }),
}
