import { BOUNDARY_GLSL } from './boundary'

export const RAMP_COLORS = 8
export const RAMP_EDGES = RAMP_COLORS - 1
export const GLOW_LAYERS = 2
export const SUN_LAYERS = 2

/**
 * Sunset ramp radiance. Positions are frame fractions; lengths are in
 * short-side units. The sky is a stop ramp along a tilted, bent axis, mixed in
 * linear light, times a sideways sunlight gain. A horizon glow and a sun glow
 * add light on top; the glow's haze dims the sky behind it and the land hides
 * the sun glow. Where lights of different hues mix, a neutral pull keeps the
 * bridge pale. An optional land layer sits in front of everything.
 */
export const RAMP_FRAGMENT = /* glsl */ `
${BOUNDARY_GLSL}
#define RAMP_COLORS ${RAMP_COLORS}
#define RAMP_EDGES ${RAMP_EDGES}
#define GLOW_LAYERS ${GLOW_LAYERS}
#define SUN_LAYERS ${SUN_LAYERS}

uniform vec3 uStop[RAMP_COLORS];
uniform float uEdgeAt[RAMP_EDGES];
uniform float uEdgeWidth[RAMP_EDGES];
uniform float uEdgeWarp[RAMP_EDGES];
uniform float uEdgeSoft[RAMP_EDGES];
uniform int uEdges;
uniform int uHorizonEdge;    // -1: the anchor line is the horizon
uniform vec4 uZenithShade;   // the first stop's light: change per short side down the ramp, where it is 1, change across the frame, where it is 0

uniform int uBndOn;               // 1: the shared boundary model moves the edges and the glow; 0: the warp and drift below
uniform int uEdgeBnd[RAMP_EDGES]; // each edge's transition in the boundary model, -1 none
uniform int uGlowTopBnd;          // the transition whose softness the glow's upward decay length follows, -1 none

uniform vec2 uAnchor;
uniform vec2 uAxis;          // sin and cos of the tilt; (0, 1) points straight down
uniform float uDrop;         // how much lower the ramp sits at the side edges of the frame
uniform vec4 uWarp;          // horizon warp: amplitude, cycles per short side, phase, octaves
uniform vec2 uSoftVary;      // horizon softness change: amount, cycles per short side
uniform float uSoftFollow;   // edges get softer where the warp moves them down and sharper where it lifts them
uniform vec3 uDrift;         // every edge: bend as a share of its width, cycles per short side, width change
uniform float uBlur;         // width added to every edge in quadrature
uniform vec4 uHaze;          // cycles per short side, stretch along the horizon, ramp warp, light change

uniform vec2 uSunAt;
uniform vec3 uSunlight;      // tint times gain
uniform vec2 uSunlightShape; // sideways width, decay length with height (0: none)
uniform vec3 uLateral;       // sideways falloff exponent, widening per short side of height, share of the width over which its top is round
uniform float uLightTop;     // height above the horizon where the sun's added light and gain have faded out (0: no limit)

uniform vec3 uGlowColor[GLOW_LAYERS];
uniform float uGlowWeight[GLOW_LAYERS];
uniform vec2 uGlowTau[GLOW_LAYERS];   // decay length above and below the glow line
uniform float uGlowOffset;
uniform vec3 uGlowVary;      // how much the glow's upward reach changes along its length, cycles per short side,
                             // and how much higher it reaches toward the sun (the twilight arch)
uniform vec3 uGlowSpread;    // how much the glow falls off sideways, over what width, and the height below
                             // which the light far from the sun fades out (the Earth's shadow; 0: none)
uniform float uExtinction;
uniform vec2 uHorizonDim;    // how much skylight dims toward the horizon, and over what height
uniform float uDimBelow;     // share of that dimming on the stops below a horizon edge (ground is not skylight)
uniform vec4 uRedden;        // deeper below the glow line, paler above it, deeper away from the sun, path at the line
uniform float uReddenEase;   // 0: the path changes at full rate from the glow line; 1: it starts gently (no crease at the line)

uniform vec3 uSunGlowColor[SUN_LAYERS];
uniform float uSunGlowRadius[SUN_LAYERS];
uniform vec2 uSunGlowShape;  // width over height, falloff exponent
uniform vec2 uOcclude;       // how much the land hides the sun glow, and the width of that edge

uniform vec3 uBridge;        // amount, lift toward white, luminance below which it fades out
uniform vec3 uBridgeTint;    // luminance 1

uniform vec4 uSkyPatch;      // light change inside the sky: amount, 1 / patch size, mean over the top fifth (removed), width over height

uniform float uLens;         // 1: the scene is seen through the scatter lens (pack output); 0: drawn directly (1:1 presets)
uniform int uGround;         // what fills the frame below the line: 0 more sky, 1 water, 2 land
uniform vec3 uGroundLine;    // the line's height at the frame center (p.y), its slope, the amplitude of its long low waves
uniform vec4 uRidge;         // land's climb toward the light across the frame, the side it climbs to (+1 right), broad bowl depth, wave length
uniform vec2 uShore;         // a far bank on the water's horizon: height, change along it (0: none)
uniform vec4 uWater;         // squeeze, degrees below the horizon at the bottom edge, ripple smear per unit of depth, strip strength
uniform vec3 uWaterOwn;      // the water's own light, seen where the reflection weakens
uniform float uWaterMirror;  // share of calm water's reflectance that a rough sea keeps
uniform float uMirrorReach;  // the highest share of the visible sky the water mirrors (1: up to the top edge)
uniform vec3 uGlitter;       // the sun's path on the water: strength, width at the line, width at the bottom edge
uniform vec3 uGroundTop;     // land right under its outline
uniform vec3 uGroundBottom;  // land at the bottom edge
uniform vec2 uGroundHaze;    // share of the sky's light in far land, and the depth over which it fades

uniform vec4 uLand;          // coverage, height at the center, slope, drop at the side edges
uniform vec4 uLandWarp;      // amplitude, cycles per short side, phase, octaves
uniform vec3 uLandEdge;      // edge width, width change along the edge, depth of the color ramp
uniform vec3 uLandTop;
uniform vec3 uLandBottom;
uniform vec3 uLandLightColor;
uniform vec2 uLandLight;     // sideways width, depth

// The logistic rises from 10% to 90% over one width.
const float RISE_K = 4.394449154672439;

float rise(float x, float width) {
  return 1.0 / (1.0 + exp(clamp(-RISE_K * x / max(width, 1e-5), -60.0, 60.0)));
}

float sideFalloff(float d, float width, float power) {
  return 1.0 / (1.0 + pow(abs(d) / max(width, 1e-5), power));
}

// The same falloff with a round top: an exponent below 2 makes a pointed peak toward the sun,
// which shows as a tent of light.
float roundFalloff(float d, float width, float power) {
  float r = uLateral.z * width;
  return sideFalloff(sqrt(d * d + r * r) - r, width, power);
}

// Flat-topped exponential: rounded over half a decay length, then exp(-|d| / tau).
float softExp(float d, float tau) {
  float t = max(tau, 1e-5);
  float eps = 0.5 * t;
  return exp(-(sqrt(d * d + eps * eps) - eps) / t);
}

// 0 at the glow line, rising to 1 over the decay length tau. ease 1 starts at zero rate (a
// gamma-2 rise with the same half point), so the color has no crease at the line.
float pathRise(float d, float tau, float ease) {
  float t = max(tau, 1e-5);
  float sharp = 1.0 - exp(-d / t);
  if (ease <= 0.0) return sharp;
  float x = d / (0.413 * t);
  return mix(sharp, 1.0 - (1.0 + x) * exp(-x), ease);
}

// The same light after a longer (k > 0) or shorter (k < 0) path: Beer-Lambert powers of its unit-peak color.
vec3 pathColor(vec3 c, float k) {
  float m = maxComponent(c);
  if (m <= 0.0 || k == 0.0) return c;
  return m * pow(max(c / m, vec3(0.004)), vec3(1.0 + max(k, -0.95)));
}

uint rampHash(uint i, uint seed) {
  uint h = (i * 0x27d4eb2du) ^ (seed * 0x165667b1u);
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h = (h ^ (h >> 13u)) * 0xc2b2ae35u;
  return h ^ (h >> 16u);
}

float rampUnit(uint i, int seed) { return float(rampHash(i, uint(seed))) * (1.0 / 4294967296.0); }

// 1D gradient noise along an edge, roughly in [-1, 1].
float edgeNoise(float x, int seed) {
  float i = floor(x);
  float f = x - i;
  uint c = uint(int(i));
  float g0 = rampUnit(c, seed) * 2.0 - 1.0;
  float g1 = rampUnit(c + 1u, seed) * 2.0 - 1.0;
  float u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float v0 = g0 * f;
  float v1 = g1 * (f - 1.0);
  return (v0 + (v1 - v0) * u) * 2.0;
}

float edgeFbm(float x, int seed, int octaves) {
  float sum = 0.0;
  float amplitude = 1.0;
  float norm = 0.0;
  float frequency = 1.0;
  for (int o = 0; o < 4; o++) {
    if (o >= octaves) break;
    sum += amplitude * edgeNoise(x * frequency + float(o) * 17.31, seed + o * 101);
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return sum / norm;
}

float hazeCorner(ivec2 cell, vec2 f, vec2 corner, int seed) {
  ivec2 c = cell + ivec2(corner);
  uint key = uint(c.x) * 0x1b873593u + uint(c.y) * 0x3c6ef372u;
  float angle = rampUnit(key, seed) * TAU;
  return cos(angle) * (f.x - corner.x) + sin(angle) * (f.y - corner.y);
}

// 2D gradient noise for haze patches, roughly in [-1, 1].
float hazeNoise(vec2 p, int seed) {
  vec2 i = floor(p);
  vec2 f = p - i;
  ivec2 cell = ivec2(i);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = mix(hazeCorner(cell, f, vec2(0.0, 0.0), seed), hazeCorner(cell, f, vec2(1.0, 0.0), seed), u.x);
  float b = mix(hazeCorner(cell, f, vec2(0.0, 1.0), seed), hazeCorner(cell, f, vec2(1.0, 1.0), seed), u.x);
  return mix(a, b, u.y) * 1.6;
}

float hazeFbm(vec2 p, int seed) {
  float sum = 0.0;
  float amplitude = 1.0;
  float norm = 0.0;
  float frequency = 1.0;
  for (int o = 0; o < 3; o++) {
    sum += amplitude * hazeNoise(p * frequency + vec2(5.17, -3.71) * float(o), seed + o * 131);
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.07;
  }
  return sum / norm;
}

// Spread of the hues of the lights that add up at a pixel (the sky as one light, each glow layer), weighted by their channel sums.
struct LightMix {
  vec3 sum;
  float total;
  float spread;
};

void gather(inout LightMix mixed, vec3 c) {
  float a = c.r + c.g + c.b;
  if (a <= 1e-6) return;
  mixed.sum += c;
  mixed.total += a;
  mixed.spread += dot(c, c) / a;
}

float hueSpread(LightMix mixed) {
  if (mixed.total <= 1e-6) return 0.0;
  return max(0.0, mixed.spread / mixed.total - dot(mixed.sum, mixed.sum) / (mixed.total * mixed.total));
}

// The sky's light, glow included, changes slowly in patches wider than they are tall, like haze,
// with zero mean over the top fifth of the frame.
float skyPatch(vec2 p) {
  if (uSkyPatch.x <= 0.0) return 1.0;
  vec2 q = vec2(p.x / uSkyPatch.w, p.y) * uSkyPatch.y;
  float n = (gradientNoise(q + vec2(3.1, 7.7), uSeed + 811) + 0.5 * gradientNoise(2.0 * q + vec2(-5.3, 1.9), uSeed + 823)) / 0.3052;
  return max(0.0, 1.0 + uSkyPatch.x * (n - uSkyPatch.z));
}

// The sky at a point: the stop ramp, the glow, the sun glow and the bridge, without anything in front.
vec3 rampSky(vec2 p) {
  float halfWidth = 0.5 * uFrameAspect.x;
  vec2 anchor = (uAnchor - 0.5) * uFrameAspect;
  vec2 d = p - anchor;
  float along = dot(d, uAxis);
  float across = d.x * uAxis.y - d.y * uAxis.x;
  float s = along - uDrop * across * across / (halfWidth * halfWidth);
  // Along the boundaries, from the frame center.
  float a = p.x * uAxis.y - p.y * uAxis.x;
  if (uBndOn != 0) s += boundaryWarp(a, s);

  vec2 sun = (uSunAt - 0.5) * uFrameAspect - anchor;
  float sunAlong = dot(sun, uAxis);
  float sunAcross = sun.x * uAxis.y - sun.y * uAxis.x;

  float hazeLight = 1.0;
  if (uHaze.z != 0.0 || uHaze.w != 0.0) {
    vec2 q = vec2(across * uHaze.x / uHaze.y, along * uHaze.x);
    s += uHaze.z * hazeFbm(q + vec2(1.3, 7.1), uSeed + 301);
    hazeLight = 1.0 + uHaze.w * hazeFbm(q + vec2(-4.2, 2.9), uSeed + 433);
  }

  float warpNoise = uWarp.x != 0.0 ? edgeFbm(across * uWarp.y + uWarp.z, uSeed, int(uWarp.w)) : 0.0;
  float softNoise = uSoftVary.x != 0.0 ? edgeFbm(across * uSoftVary.y + 11.3, uSeed + 57, 2) : 0.0;
  bool drifting = uDrift.x != 0.0 || uDrift.z != 0.0;

  float level[RAMP_EDGES];
  float horizon = uHorizonEdge < 0 ? uWarp.x * warpNoise : 0.0;
  for (int j = 0; j < RAMP_EDGES; j++) {
    level[j] = 0.0;
    if (j >= uEdges) continue;
    float m = uEdgeAt[j] + uWarp.x * warpNoise * uEdgeWarp[j];
    float w = uEdgeWidth[j] * exp((uSoftVary.x * softNoise + uSoftFollow * warpNoise) * uEdgeSoft[j]);
    if (drifting) {
      vec2 q = vec2(across * uDrift.y, uEdgeAt[j] * uDrift.y);
      m += uDrift.x * uEdgeWidth[j] * fbm(q + vec2(5.2, 1.7), 2, uSeed + 503);
      w *= exp(uDrift.z * fbm(q * vec2(0.8, 1.0) + vec2(-3.1, 8.4), 2, uSeed + 509));
    }
    if (uBndOn != 0 && uEdgeBnd[j] >= 0) w *= boundarySoft(a, uEdgeBnd[j]);
    if (j == uHorizonEdge) horizon = m;
    level[j] = rise(s - m, sqrt(w * w + uBlur * uBlur));
  }

  float height = max(0.0, horizon - s);
  float widen = 1.0 + uLateral.y * height;
  float lightReach = uLightTop > 0.0 ? 1.0 - smoothstep(0.45 * uLightTop, uLightTop, height) : 1.0;

  float sunlit = roundFalloff(across - sunAcross, uSunlightShape.x * widen, uLateral.x);
  if (uSunlightShape.y > 0.0) sunlit *= exp(-height / uSunlightShape.y);
  vec3 gain = vec3(1.0) + uSunlight * (sunlit * lightReach);

  LightMix mixed = LightMix(vec3(0.0), 0.0, 0.0);
  vec3 glow = vec3(0.0);
  float glowDepth = 0.0;
  float dh = s - horizon - uGlowOffset;
  float side = roundFalloff(across - sunAcross, uGlowSpread.y * widen, uLateral.x);
  float far = 1.0 - uGlowSpread.x;
  if (uGlowSpread.z > 0.0) far *= 1.0 - exp(-height / uGlowSpread.z);
  float spread = (far + (1.0 - far) * side) * lightReach;
  float reach = uGlowVary.x != 0.0 ? exp(uGlowVary.x * edgeFbm(across * uGlowVary.y + 31.7, uSeed + 601, 2)) : 1.0;
  reach *= 1.0 + uGlowVary.z * side;
  // How far the glow reaches up changes slowly along it. Its downward reach stays even: over that
  // long tail any change shows as soft columns.
  if (uBndOn != 0 && uGlowTopBnd >= 0) reach *= boundarySoftAt(a, uBndTrans[uGlowTopBnd].x, uBndTrans[uGlowTopBnd].y);
  for (int k = 0; k < GLOW_LAYERS; k++) {
    if (uGlowWeight[k] <= 0.0) continue;
    vec2 tau = uGlowTau[k] * vec2(reach, 1.0);
    float f = spread * uGlowWeight[k] * softExp(dh, dh < 0.0 ? tau.x : tau.y);
    float path = dh > 0.0 ? uRedden.x * pathRise(dh, tau.y, uReddenEase) : -uRedden.y * pathRise(-dh, tau.x, uReddenEase);
    vec3 c = pathColor(uGlowColor[k], uRedden.w + path + uRedden.z * (1.0 - side)) * f;
    glow += c;
    glowDepth += f;
    gather(mixed, c);
  }

  vec3 sunGlow = vec3(0.0);
  float da = along - sunAlong;
  float de = (across - sunAcross) / uSunGlowShape.x;
  float rr = da * da + de * de;
  float visible = (1.0 - uOcclude.x * rise(s - horizon, uOcclude.y)) * lightReach;
  for (int k = 0; k < SUN_LAYERS; k++) {
    if (uSunGlowRadius[k] <= 0.0 || maxComponent(uSunGlowColor[k]) <= 0.0) continue;
    float r = uSunGlowRadius[k];
    vec3 c = uSunGlowColor[k] * (visible * pow(1.0 + rr / (r * r), -uSunGlowShape.y));
    sunGlow += c;
    gather(mixed, c);
  }

  // Like the sun's added light, the dimming toward the horizon and through the glow fade out
  // below the top fifth, which holds only the sky's own light.
  float dim = uHorizonDim.x * exp(-height / max(uHorizonDim.y, 1e-4));
  if (uHorizonEdge >= 0) dim *= mix(1.0, uDimBelow, level[uHorizonEdge]);
  vec3 skyGain = gain * exp(-(uExtinction * glowDepth + dim) * lightReach);
  vec3 sky = vec3(0.0);
  float zenithShade = clamp(1.0 + uZenithShade.x * (s - uZenithShade.y) + uZenithShade.z * (a / halfWidth - uZenithShade.w), 0.8, 1.2);
  for (int k = 0; k < RAMP_COLORS; k++) {
    if (k > uEdges) break;
    float w = (k == 0 ? 1.0 : level[k - 1]) - (k < uEdges ? level[k] : 0.0);
    sky += w * uStop[k] * (k == 0 ? zenithShade : 1.0);
  }
  sky = max(sky, vec3(0.0)) * skyGain;
  gather(mixed, sky);

  vec3 light = sky + glow + sunGlow;

  if (uBridge.x > 0.0) {
    float y = luminance(light);
    float bright = uBridge.z > 0.0 ? smoothstep(0.5 * uBridge.z, 1.5 * uBridge.z, y) : 1.0;
    float pull = min(1.0, uBridge.x * hueSpread(mixed) / 0.25) * bright;
    float lifted = max(y, 1.0 - (1.0 - y) * (1.0 - uBridge.y));
    light += pull * (lifted * uBridgeTint - light);
  }
  return light * hazeLight * skyPatch(p);
}

// The 1:1 presets' land layer in front of the sky.
vec3 presetLand(vec2 p, vec3 light) {
  if (uLand.x > 0.0) {
    float halfWidth = 0.5 * uFrameAspect.x;
    float x = p.x;
    float u = x / halfWidth;
    float edge = (uLand.y - 0.5) * uFrameAspect.y + uLand.z * x + uLand.w * u * u;
    if (uLandWarp.x != 0.0) edge += uLandWarp.x * edgeFbm(x * uLandWarp.y + uLandWarp.z, uSeed + 211, int(uLandWarp.w));
    float width = uLandEdge.x * exp(uLandEdge.y * edgeFbm(x * 1.7 + 5.3, uSeed + 223, 2));
    float depth = p.y - edge;
    float below = max(depth, 0.0);
    vec3 ground = uLandBottom + (uLandTop - uLandBottom) * exp(-below / max(uLandEdge.z, 1e-4));
    float sunX = (uSunAt.x - 0.5) * uFrameAspect.x;
    ground += uLandLightColor * sideFalloff(x - sunX, uLandLight.x, uLateral.x) * exp(-below / max(uLandLight.y, 1e-4));
    light = mix(light, ground, uLand.x * rise(depth, width));
  }
  return light;
}

// Reflectance of calm water (refractive index 1.333) seen this many degrees below the horizon.
float waterFresnel(float degreesBelow) {
  float i = radians(90.0 - clamp(degreesBelow, 0.01, 89.0));
  float ci = cos(i);
  float st = sin(i) / 1.333;
  float ct = sqrt(max(0.0, 1.0 - st * st));
  float rs = (ci - 1.333 * ct) / (ci + 1.333 * ct);
  float rp = (ct - 1.333 * ci) / (ct + 1.333 * ci);
  return 0.5 * (rs * rs + rp * rp);
}

// Where the sky ends at column x (p.y, y down): level water, or land climbing once toward the
// light with one broad bowl and long low waves, never a row of bumps.
float groundLine(float x) {
  float u = clamp(x / (0.5 * uFrameAspect.x), -1.0, 1.0);
  float line = uGroundLine.x + uGroundLine.y * x;
  float toward = 0.5 + 0.5 * uRidge.y * u;
  line -= uRidge.x * (0.5 * smoothstep(0.05, 1.0, toward) + 0.5 * toward * toward - 0.35);
  line += uRidge.z * (0.35 - u * u);
  if (uGroundLine.z > 0.0) line += uGroundLine.z * edgeFbm(x / uRidge.w + 5.3, uSeed + 913, 2);
  return line;
}

// The top of a far bank on the water's horizon; its height changes along it.
float bankTop(float x, float line) {
  return line - uShore.x * (1.0 + uShore.y * edgeFbm(x * 0.8 + 2.2, uSeed + 929, 2));
}

// Land lit by the sky, darker toward the bottom; far land is seen through more air, so near its
// outline it takes on the light of the sky just above it (air).
vec3 landLight(vec2 p, float outline, vec3 air) {
  float d = max(0.0, p.y - outline);
  float room = max(0.1, 0.5 * uFrameAspect.y - outline);
  vec3 own = mix(uGroundTop, uGroundBottom, smoothstep(0.0, 1.0, d / room));
  return mix(own, air * uGroundHaze.x, exp(-d / max(uGroundHaze.y, 1e-3)));
}

// How far above an outline the air in front of the land is read.
const float AIR_ABOVE = 0.02;

// The scene the lens sees: the sky, and in front of it water or land with a sharp outline.
// rampSky is called once, at the one point each pixel needs (more call sites make the shader
// take tens of seconds to compile): the pixel itself, the air just above the land's outline, or
// what the water mirrors.
// Water mirrors the sky uWater.x times higher than it lies below the line, no higher than the
// top edge, jittered up and down by ripples (the lens averages the jitter). A reflection that
// stretched the sky would stretch its edges' waves too. Its reflectance is that of water seen
// with a long lens (the bottom edge
// uWater.y degrees below the horizon), and its own light shows where the reflection weakens. A
// soft lighter strip under the line changes along it, and ripples spread the sun's light into a
// wide, faint path under it that widens toward the viewer.
vec3 rampScene(vec2 p) {
  vec2 q = p;
  // 0 sky, 1 land, 2 water, 3 water mirroring the far bank.
  int kind = 0;
  float line = 0.0;
  float top = 0.0;
  float depth = 0.0;
  float r = 0.0;
  vec2 mirrored = p;
  if (uGround != 0) {
    line = groundLine(p.x);
    top = uGround == 1 && uShore.x > 0.0 ? bankTop(p.x, line) : line;
    if (p.y > top) {
      if (uGround == 2 || p.y <= line) {
        kind = 1;
        q = vec2(p.x, top - AIR_ABOVE);
      } else {
        kind = 2;
        depth = p.y - line;
        float below = uWater.y * depth / max(0.05, 0.5 * uFrameAspect.y - line);
        r = waterFresnel(below);
        uint texel = uint(gl_FragCoord.x) * 0x9e3779b1u ^ uint(gl_FragCoord.y) * 0x85ebca6bu;
        float ripple = 2.0 * rampUnit(texel, uSeed + 977) - 1.0;
        float up = max(uWater.x * depth * (1.0 + uWater.z * ripple), 0.002);
        float reach = uMirrorReach * max(0.0, line + 0.5 * uFrameAspect.y);
        mirrored = vec2(p.x, max(line - min(up, reach), -0.5 * uFrameAspect.y));
        q = mirrored;
        if (uShore.x > 0.0 && mirrored.y > top) {
          kind = 3;
          q = vec2(p.x, top - AIR_ABOVE);
        }
      }
    }
  }
  vec3 seen = rampSky(q);
  if (kind == 0) return seen;
  if (kind == 1) return landLight(p, top, seen);
  vec3 mirror = kind == 3 ? landLight(mirrored, top, seen) : seen;
  // A rough sea dims the reflection; it does not show more of the water's own light.
  vec3 water = uWaterMirror * r * mirror + (1.0 - r) * uWaterOwn;
  if (uWater.w > 0.0 && depth < 0.05) {
    float along = 0.7 + 0.3 * edgeFbm(p.x * 1.1 + 1.3, uSeed + 953, 2);
    water += uWater.w * along * exp(-0.5 * (depth / 0.008) * (depth / 0.008)) * mirror;
  }
  if (uGlitter.x > 0.0) {
    float toBottom = depth / max(0.05, 0.5 * uFrameAspect.y - line);
    float across = (p.x - (uSunAt.x - 0.5) * uFrameAspect.x) / mix(uGlitter.y, uGlitter.z, toBottom);
    water += uGlitter.x * (1.0 - 0.7 * toBottom) * exp(-0.5 * across * across) * uGlowColor[0];
  }
  return water;
}

// With the lens on, the scene is drawn into the aux source, blurred there by one lens (the
// scatter blur) and read back in combine; radiance itself then has nothing to draw.
vec3 radiance(vec2 uv, vec2 p) {
  return uLens > 0.0 ? vec3(0.0) : presetLand(p, rampSky(p));
}

vec3 auxRadiance(vec2 uv, vec2 p) {
  return uLens > 0.0 ? rampScene(p) : vec3(0.0);
}

vec3 combine(vec2 uv, vec2 p, vec3 direct, vec3 seen) {
  return uLens > 0.0 ? seen : direct;
}
`
