import { BOUNDARY_GLSL } from './boundary'

export const RAMP_COLORS = 8
export const RAMP_EDGES = RAMP_COLORS - 1
export const GLOW_LAYERS = 2
export const SUN_LAYERS = 2
/** Linear light where the grey part of the sky's light (its lowest channel) starts to ease off, and where it ends. */
export const SKY_GREY_KNEE = 0.84
const SKY_GREY_TOP = 0.9

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
uniform vec2 uEdgeShape[RAMP_EDGES]; // per edge: lean across the frame's extent along it, and bow (both in base units at its ends)
uniform vec2 uGlowShape;     // the same for the glow's line
uniform float uEdgeWave[RAMP_EDGES]; // per edge: an S-shaped wave across the frame's extent along it (base units at its ends)
uniform float uGlowWave;     // the same for the glow's line
uniform float uEdgeSoft[RAMP_EDGES];
uniform int uEdges;
uniform int uHorizonEdge;    // -1: the anchor line is the horizon
uniform vec4 uZenithShade;   // the first stop's light: change per short side down the ramp, where it is 1, change across the frame, where it is 0
uniform float uZenithFloor;  // the first stop's least light, as a share of its color

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
uniform vec3 uGlowEnd;       // depth below the glow line where its lower side ends (0: never), the width of that fade, and
                             // how fully the sky's dimming under the glow lifts where the glow's light falls off
uniform vec3 uVeil;          // white light over the sky: under the far band, more toward the horizon, and the height over which that extra fades
uniform vec2 uVeilFar;       // heights above the horizon between which the veil fades out into the far band of full Meta Blue (0, 0: none)
uniform vec3 uVeilTint;      // the veil's color away from the light: a pale tint of one of the pack's colors, at luminance 1
uniform float uVeilMute;     // share of the sky's color the veil greys toward its own tint at the same light (0: none)
uniform float uVeilMuteLow;  // share of that greying kept near the horizon (0: none there, so a warm low sky keeps its own color)
uniform float uHazeMass;     // share by which the veil thickens and thins with the sky's masses (0: none)
uniform float uBlueHue;      // 1: sky blues turned toward violet go back to Meta Blue's hue (pack frames); 0: they keep it
uniform vec3 uVeilNear;      // the veil's color near the light, at luminance 1 (0, 0, 0: the bridge's)
uniform float uGlowOffset;
uniform vec3 uGlowVary;      // how much the glow's upward reach changes along its length, cycles per short side,
                             // and how much higher it reaches toward the sun (the twilight arch)
uniform vec2 uGlowArchShape; // the share of its reach the glow keeps far from the sun, and the share of
                             // its width over which it rises toward the sun (1, 1: the glow's own falloff)
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
uniform vec3 uBandTint;      // under a field of glints, the low sky's pale tint that the band along the water's far edge takes
                             // away from the light, at luminance 1
uniform float uBridgeSky;    // how far the bridge's tint turns neutral toward the sky's side of it
uniform float uBridgeCool;   // how far the bridge's tint over the sky's cool side goes through white to the cool parts' pale tint
uniform int uDuskStop;       // a dark dusk band low in the sky that the bridge leaves alone (-1: none)

uniform vec4 uSkyPatch;      // light change inside the sky: amount, 1 / patch size, mean over the top fifth (removed), width over height

uniform float uLens;         // radius of the scatter lens the scene is seen through, short sides (pack output); 0: drawn directly (1:1 presets)
uniform int uGround;         // what fills the frame below the line: 0 more sky, 1 water, 2 land
uniform vec3 uGroundLine;    // the line's height at the frame center (p.y), its slope, the amplitude of its long low waves
uniform vec4 uRidge;         // land's climb toward the light across the frame, the side it climbs to (+1 right), broad bowl depth, wave length
uniform vec2 uShore;         // a far bank on the water's horizon: height, change along it (0: none)
uniform vec3 uShoreShape;    // the far bank's height across the frame: the side where it is thickest (+1 right, -1 left,
                             // 0: even), its length from that side's edge to its spit (short sides), and its height
                             // at that edge, as a share of uShore.x
uniform vec2 uShoreFoot;     // the far bank's waterline below the horizon, as a share of its height; how many times
                             // shorter than the bank its mirror image is
uniform vec4 uWaterLift;     // under the far bank's mirror image and a strip below it the water mirrors the sky this much
                             // higher (short sides, 0: none); the strip's depth; the share of the reflection kept past it;
                             // how much more of the low sky's light the water takes just past the strip
uniform vec4 uSunPath;       // the sun's path on the water: strength, half width at the line, widening per short side of depth, height of the glow it mirrors
uniform vec4 uSunGlints;     // 0: the path mirrors the glow; 1: it is a field of glints that adds the sun's light to the water;
                             // their spread as a share of the path's width; the size of their rows; how fast the sky the
                             // water mirrors climbs per short side of depth past the far strip
uniform vec2 uSunLight;      // depth where the path's middle reaches the glow's paler top and its added light is gone, and the height
                             // of the band above the glow that its sides climb through
uniform vec4 uWater;         // squeeze, degrees below the horizon half a short side under the line, ripple smear per unit of depth, strip strength
uniform vec3 uWaterOwn;      // the water's own light, seen where the reflection weakens
uniform float uWaterMirror;  // share of calm water's reflectance that a rough sea keeps
uniform float uMirrorDeep;   // height above the frame's top over which the sky that water mirrors there dims by e (0: none)
uniform float uWaterTint;    // share of the water's own light that takes the hue of the sky it mirrors (0: its own color)
uniform vec3 uGroundTop;     // land right under its outline
uniform vec3 uGroundBottom;  // land at the bottom edge
uniform vec3 uGroundHaze;    // share of the sky's light in far land, the depth over which it fades, and how much deeper that light is (pathColor)
uniform vec2 uGroundVeil;    // pale haze in front of far land, and the depth over which it fades toward the viewer
uniform vec3 uGroundVeilTint; // the haze's color: a pale tint of the land's own, at luminance 1
uniform vec3 uLandLit;       // land's and the water's own light on their side toward the sun: extra light there, the width of that side, and how much land's relief or the water's wind patches change it

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
// with zero mean over the top fifth of the frame. The haze is in front of land and water too, so
// it follows the pixel, not the sky a point mirrors.
float skyMass(vec2 p) {
  vec2 q = vec2(p.x / uSkyPatch.w, p.y) * uSkyPatch.y;
  return (gradientNoise(q + vec2(3.1, 7.7), uSeed + 811) + 0.5 * gradientNoise(2.0 * q + vec2(-5.3, 1.9), uSeed + 823)) / 0.3052 - uSkyPatch.z;
}

float skyPatch(vec2 p) {
  if (uSkyPatch.x <= 0.0) return 1.0;
  return max(0.0, 1.0 + uSkyPatch.x * skyMass(p));
}

// How warm a light is: -1 blue, 0 neutral, 1 red.
float warmth(vec3 c) {
  return (c.r - c.b) / max(c.r + c.b, 1e-4);
}

// Where two sky colors blend in linear light they can lose most of their color: Meta Blue and Lime
// or Tan mix grey or teal. The parts of a blend: their luminance, their Oklab chroma per lightness
// weighted by it, how much of both is warm, and the cool parts' pale tint.
struct Parts {
  float y;
  float sat;
  float warm;
  float warmSat;
  vec3 coolPale;
};

// How deep the cool side's pale tint is (0 white, 1 its own color), as for the band along the water's far edge.
const float GREY_DEPTH = 0.35;
// Where a blend loses all its color, the share of the way to white its light goes.
const float GREY_LIFT = 0.8;
// The share of the color lost over which the lighter bridge takes over from the blend.
const vec2 GREY_PULL = vec2(0.15, 0.5);

void addPart(inout Parts parts, vec3 c) {
  float y = luminance(c);
  if (y <= 1e-6) return;
  vec3 lab = linearToOklab(c);
  vec2 hue = lab.yz / max(lab.x, 1e-3);
  parts.y += y;
  parts.sat += y * length(hue);
  float warm = smoothstep(-0.25, 0.25, warmth(c));
  parts.warm += y * warm;
  parts.warmSat += y * warm * length(hue);
  // The pale tint keeps the Oklab hue: paled in linear light, Meta Blue turns toward cyan or violet.
  parts.coolPale += y * (1.0 - warm) * max(oklabToLinear(vec3(1.0, GREY_DEPTH * hue)), vec3(0.0));
}

// Meta Blue's Oklab hue, in radians (259 degrees).
const float BLUE_HUE = -1.7628;

// White light over Meta Blue turns its hue toward violet, which reads periwinkle or lavender. A
// blue up to 30 degrees past Meta Blue's hue on the violet side goes back to it, and the
// correction fades out by 60 degrees past it, so mauve and Plum keep their own hues.
vec3 keepBlueHue(vec3 c) {
  vec3 lab = linearToOklab(max(c, vec3(0.0)));
  float chroma = length(lab.yz);
  if (chroma < 1e-5) return c;
  float over = mod(atan(lab.z, lab.y) - BLUE_HUE + 3.14159265, 6.28318531) - 3.14159265;
  if (over <= 0.0) return c;
  float h = BLUE_HUE + over * smoothstep(0.5236, 1.0472, over);
  lab.yz = chroma * vec2(cos(h), sin(h));
  return max(oklabToLinear(lab), vec3(0.0));
}

// Past SKY_GREY_KNEE the grey part of the sky's light, the share all three channels have, eases off
// toward SKY_GREY_TOP, about Ice's own level (#F2F4F7 is 0.89 in its lowest channel), so the
// brightest overcast is a pale grey and never a flat white.
const float SKY_GREY_KNEE = ${SKY_GREY_KNEE.toFixed(3)};
const float SKY_GREY_TOP = ${SKY_GREY_TOP.toFixed(3)};

// Pale light past nominal also eases off in strength, the paler the sooner: the tone curve fills a
// pale color's lower channels to white a little above nominal, a saturated color's only far above.
const float PALE_ROOM = 2.0;

vec3 holdGrey(vec3 c) {
  float grey = min(c.r, min(c.g, c.b));
  if (grey > SKY_GREY_KNEE) {
    float room = SKY_GREY_TOP - SKY_GREY_KNEE;
    c -= grey - SKY_GREY_KNEE - room * (1.0 - exp(-(grey - SKY_GREY_KNEE) / room));
  }
  float top = maxComponent(c);
  if (top <= 1.0) return c;
  float pale = min(c.r, min(c.g, c.b)) / top;
  float most = 1.0 + PALE_ROOM * (1.0 - pale) * (1.0 - pale);
  float held = 1.0 + (most - 1.0) * (1.0 - exp(-(top - 1.0) / (most - 1.0)));
  return c * mix(1.0, held / top, smoothstep(0.45, 0.75, pale));
}

// The sky at a point: the stop ramp, the glow, the sun glow and the bridge, without anything in front.
// core is the sun's own light in it.
vec3 rampSky(vec2 p, out vec3 core) {
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
  for (int j = 0; j < RAMP_EDGES; j++) level[j] = 0.0;
  float horizon = uHorizonEdge < 0 ? uWarp.x * warpNoise : 0.0;
  // Loops run to the scene's own count: with the constant count the compiler writes the body out
  // once per edge, and the shader takes a second or more to compile.
  // Each edge and the glow line lean and bend a little on their own, across the frame's extent
  // along them in any direction, so neighbouring boundaries are never parallel.
  float acrossHalf = abs(halfWidth * uAxis.y) + abs(0.5 * uFrameAspect.y * uAxis.x);
  float ua = a / max(acrossHalf, 1e-3);
  float bowed = ua * ua - 1.0 / 3.0;
  // An S across the extent, zero on average and independent of the lean and the bow.
  float waved = 2.5 * ua * (ua * ua - 0.6);
  for (int j = 0; j < uEdges; j++) {
    float m = uEdgeAt[j] + uWarp.x * warpNoise * uEdgeWarp[j] + uEdgeShape[j].x * ua + uEdgeShape[j].y * bowed + uEdgeWave[j] * waved;
    float w = uEdgeWidth[j] * exp((uSoftVary.x * softNoise + uSoftFollow * warpNoise) * uEdgeSoft[j]);
    if (drifting) {
      vec2 q = vec2(across * uDrift.y, uEdgeAt[j] * uDrift.y);
      m += uDrift.x * uEdgeWidth[j] * fbm(q + vec2(5.2, 1.7), 2, uSeed + 503);
      w *= exp(uDrift.z * fbm(q * vec2(0.8, 1.0) + vec2(-3.1, 8.4), 2, uSeed + 509));
    }
    // The plain softness change: boundarySoft also moves silhouette crests, a second copy of the
    // whole boundary move that doubles the compile time.
    if (uBndOn != 0 && uEdgeBnd[j] >= 0) w *= boundarySoftAt(a, uBndTrans[uEdgeBnd[j]].x, uBndTrans[uEdgeBnd[j]].y);
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
  float dh = s - horizon - uGlowOffset - uGlowShape.x * ua - uGlowShape.y * bowed - uGlowWave * waved;
  float side = roundFalloff(across - sunAcross, uGlowSpread.y * widen, uLateral.x);
  float far = 1.0 - uGlowSpread.x;
  if (uGlowSpread.z > 0.0) far *= 1.0 - exp(-height / uGlowSpread.z);
  float spread = (far + (1.0 - far) * side) * lightReach;
  float reach = uGlowVary.x != 0.0 ? exp(uGlowVary.x * edgeFbm(across * uGlowVary.y + 31.7, uSeed + 601, 2)) : 1.0;
  // Far from the sun the glow keeps uGlowArchShape.x of its reach, and it rises toward the sun over
  // uGlowArchShape.y of the glow's width.
  float archSide = uGlowArchShape.y != 1.0 ? roundFalloff(across - sunAcross, uGlowArchShape.y * uGlowSpread.y * widen, uLateral.x) : side;
  reach *= uGlowArchShape.x + uGlowVary.z * archSide;
  // How far the glow reaches up changes slowly along it. Its downward reach stays even: over that
  // long tail any change shows as soft columns.
  if (uBndOn != 0 && uGlowTopBnd >= 0) reach *= boundarySoftAt(a, uBndTrans[uGlowTopBnd].x, uBndTrans[uGlowTopBnd].y);
  if (uGlowEnd.x > 0.0) spread *= 1.0 - smoothstep(uGlowEnd.x, uGlowEnd.x + uGlowEnd.y, dh);
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
  // Where the glow's lower side ends above the horizon, the sky dims toward that end as if the
  // horizon lay there, and past it the low sky is not dimmed. Under a warm glow lifted off its
  // horizon the dimming lifts as the glow's light falls from 0.7 to 0.3 of its light at the glow
  // line, so the glow's tail meets the sky's own light: over a darkened sky it reads red or brown.
  float dim;
  if (uGlowEnd.x > 0.0) {
    float end = 1.0 - smoothstep(uGlowEnd.x, uGlowEnd.x + uGlowEnd.y, dh);
    float lift = dh > 0.0 ? uGlowEnd.z * (1.0 - smoothstep(0.3, 0.7, softExp(dh, uGlowTau[0].y) * end)) : 0.0;
    dim = uHorizonDim.x * exp(-max(0.0, uGlowEnd.x - dh) / max(uHorizonDim.y, 1e-4)) * end * (1.0 - lift);
  } else {
    dim = uHorizonDim.x * exp(-height / max(uHorizonDim.y, 1e-4));
  }
  if (uHorizonEdge >= 0) dim *= mix(1.0, uDimBelow, level[uHorizonEdge]);
  vec3 skyGain = gain * exp(-(uExtinction * glowDepth + dim) * lightReach);
  vec3 sky = vec3(0.0);
  vec3 dusk = vec3(0.0);
  float duskCover = 0.0;
  float zenithShade = clamp(1.0 + uZenithShade.x * (s - uZenithShade.y) + uZenithShade.z * (a / halfWidth - uZenithShade.w), uZenithFloor, 2.0);
  for (int k = 0; k <= uEdges; k++) {
    float w = (k == 0 ? 1.0 : level[k - 1]) - (k < uEdges ? level[k] : 0.0);
    vec3 c = w * uStop[k] * (k == 0 ? zenithShade : 1.0);
    if (k == uDuskStop) {
      dusk += c;
      duskCover += w;
    } else {
      sky += c;
      // Each stop counts on its own, so where two sky colors blend the bridge pales the middle
      // instead of letting them mix into a third hue.
      gather(mixed, max(c, vec3(0.0)) * skyGain);
    }
  }
  // The bridge's tint holds on the glow's side and turns neutral toward the sky's, so a warm tint
  // never meets Cyan as green.
  vec3 bridgeTint = uBridgeTint;
  if (uBridgeSky > 0.0) {
    float warmLight = luminance(glow + sunGlow);
    float warmShare = warmLight / max(warmLight + luminance(max(sky, vec3(0.0)) * skyGain), 1e-4);
    bridgeTint = mix(uBridgeTint, vec3(1.0), uBridgeSky * (1.0 - smoothstep(0.3, 0.7, warmShare)));
  }
  // A veil of scattered white light over the sky's own light, thin at the top and denser toward
  // the horizon, mutes the sky's colors and pales the middles between them. It stays off the dusk
  // band, which is in front of it.
  // Near the horizon it takes on the warmth of the light, so the middles go beige and cream; at
  // the edge farthest from the light it fades out, leaving a band of full Meta Blue.
  float mute = 0.0;
  vec3 veilLight = vec3(0.0);
  if (uVeil.x > 0.0 || uVeil.y > 0.0) {
    float low = exp(-height / max(uVeil.z, 1e-4));
    float far = uVeilFar.y > uVeilFar.x ? 1.0 - smoothstep(uVeilFar.x, uVeilFar.y, height) : 1.0;
    // The haze is thicker and thinner in the sky's masses: thicker it is paler, thinner the sky's
    // own color shows through.
    float mass = uHazeMass > 0.0 ? max(0.0, 1.0 + uHazeMass * skyMass(p)) : 1.0;
    float open = (1.0 - clamp(duskCover, 0.0, 1.0)) * far * mass;
    // An overcast haze greys the sky toward the veil's own hue at the same light, so the blue
    // turns grey-blue instead of the periwinkle that white light over it makes.
    // Near the light the sky keeps its own color, and only blue greys: a warm low sky keeps its own.
    if (uVeilMute > 0.0) {
      float blue = clamp(-linearToOklab(max(sky, vec3(0.0))).z / 0.04, 0.0, 1.0);
      mute = min(1.0, uVeilMute * open * mix(1.0 - low, 1.0, uVeilMuteLow) * blue);
      sky = mix(sky, luminance(sky) * uVeilTint, mute);
    }
    veilLight = (uVeil.x + uVeil.y * low) * open * mix(uVeilTint, uVeilNear.x > 0.0 ? uVeilNear : bridgeTint, low);
    sky += veilLight;
  }
  sky = max(sky, vec3(0.0)) * skyGain;
  // The dusk band is a low bank of the sky's shadowed light in front of the glow and hides the
  // light behind it, so the two meet in one soft edge: the glow's light added over it would mix
  // into a third hue. Dimmed toward the horizon or by the glow's haze too, it goes black or vanishes.
  dusk = max(dusk, vec3(0.0)) * gain;
  float behind = 1.0 - clamp(duskCover, 0.0, 1.0);

  // Where two sky colors' blend is greyer than the greyer of the two (Meta Blue into Lime or Tan
  // goes grey or teal), the bridge between them is lighter, as the band along the water's far edge
  // is: the light's pale tint on the warm side, white in the middle and the cool side's clear pale
  // tint. The parts are the stops, each muted by the veil as the blend is, and the veil's own light.
  Parts parts = Parts(0.0, 0.0, 0.0, 0.0, vec3(0.0));
  for (int k = 0; k <= uEdges; k++) {
    if (k == uDuskStop) continue;
    float w = (k == 0 ? 1.0 : level[k - 1]) - (k < uEdges ? level[k] : 0.0);
    vec3 c = max(w * uStop[k] * (k == 0 ? zenithShade : 1.0), vec3(0.0));
    addPart(parts, mix(c, luminance(c) * uVeilTint, mute) * skyGain);
  }
  addPart(parts, veilLight * skyGain);
  float coolY = parts.y - parts.warm;
  vec3 coolPale = parts.coolPale / max(luminance(parts.coolPale), 1e-6);
  if (parts.warm > 1e-6 && coolY > 1e-6) {
    float sides = min(parts.warmSat / parts.warm, (parts.sat - parts.warmSat) / coolY);
    float both = smoothstep(0.02, 0.15, min(parts.warm, coolY) / parts.y);
    vec3 blend = linearToOklab(sky);
    float lost = both * clamp(1.0 - length(blend.yz) / max(blend.x, 1e-3) / max(sides, 1e-4), 0.0, 1.0);
    if (lost > GREY_PULL.x) {
      float cool = 1.0 - smoothstep(-0.3, 0.3, warmth(sky));
      vec3 tint = mix(mix(uBridgeTint, vec3(1.0), clamp(2.0 * cool, 0.0, 1.0)), coolPale, clamp(2.0 * cool - 1.0, 0.0, 1.0));
      // The light the glows add in front of the sky counts toward how light the bridge is.
      float y = luminance(sky);
      float total = y + luminance(glow + sunGlow) * behind;
      float lifted = max(total, 1.0 - (1.0 - total) * (1.0 - GREY_LIFT * lost));
      sky += smoothstep(GREY_PULL.x, GREY_PULL.y, lost) * behind * ((y + lifted - total) * tint - sky);
    }
  }

  vec3 light = sky + (glow + sunGlow) * behind;

  if (uBridge.x > 0.0) {
    float y = luminance(light);
    float bright = uBridge.z > 0.0 ? smoothstep(0.5 * uBridge.z, 1.5 * uBridge.z, y) : 1.0;
    float pull = min(1.0, uBridge.x * hueSpread(mixed) / 0.25) * bright * lightReach * behind;
    float lifted = max(y, 1.0 - (1.0 - y) * (1.0 - uBridge.y));
    // Where the sky's pale side is its light's own color (Elemental), the bridge over its blue side
    // takes Meta Blue's own pale tint, through white: the light's pale tint over the blue reads grey.
    vec3 tint = bridgeTint;
    if (uBridgeCool > 0.0) {
      float cool = 1.0 - smoothstep(-0.3, 0.3, warmth(max(light, vec3(0.0))));
      tint = mix(bridgeTint, mix(mix(bridgeTint, vec3(1.0), clamp(2.0 * cool, 0.0, 1.0)), coolPale, clamp(2.0 * cool - 1.0, 0.0, 1.0)), uBridgeCool);
    }
    light += pull * (lifted * tint - light);
  }
  // The bridge leaves the dusk band alone: lifted where the glow meets it, the band would draw a
  // pale line between the two.
  core = sunGlow * behind * hazeLight;
  vec3 seen = (light + dusk) * hazeLight;
  return uBlueHue > 0.5 ? keepBlueHue(seen) : seen;
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

// The top of a far bank on the water's horizon; its height changes along it. A headland is
// tallest where it runs off the frame, and its hills get lower toward its spit.
float bankTop(float x, float line) {
  float h = 1.0 + uShore.y * edgeFbm(x * 0.8 + 2.2, uSeed + 929, 2);
  if (uShoreShape.x != 0.0) {
    float toSpit = clamp((0.5 * uFrameAspect.x - uShoreShape.x * x) / uShoreShape.y, 0.0, 1.0);
    h *= uShoreShape.z * pow(1.0 - toSpit, 0.6) * (1.0 + 0.35 * edgeFbm(x * 2.4 + 6.1, uSeed + 937, 2));
  }
  return line - uShore.x * h;
}

// The far bank's waterline: a little below the horizon where the bank is tall, drifting gently.
float bankFoot(float x, float line, float top) {
  return line + uShoreFoot.x * (line - top) * (0.6 + 0.4 * edgeFbm(x * 1.7 + 3.3, uSeed + 941, 2));
}

// Land and the water's own light are lighter on their side toward the sun.
float litSide(float x) {
  if (uLandLit.x <= 0.0) return 1.0;
  float toward = (x - (uSunAt.x - 0.5) * uFrameAspect.x) / max(uLandLit.y, 1e-3);
  return 1.0 + uLandLit.x * exp(-0.5 * toward * toward);
}

// Land lit by the low sun, darker toward the bottom; its relief (noise, the ground's patches)
// catches the light. Far land is seen through more air, so near its outline it takes on the light
// of the sky just above it (air); where that share is small, the outline stays dark against the
// glow, and the lens never blurs the glow into the land's lit color.
vec3 landLight(vec2 p, float outline, vec3 air, float noise) {
  float d = max(0.0, p.y - outline);
  float room = max(0.1, 0.5 * uFrameAspect.y - outline);
  float relief = max(1.0 + uLandLit.z * noise, 0.2);
  vec3 own = mix(uGroundTop, uGroundBottom, clamp(d / room, 0.0, 1.0)) * litSide(p.x) * relief;
  vec3 hazed = mix(own, pathColor(air, uGroundHaze.z) * uGroundHaze.x, exp(-d / max(uGroundHaze.y, 1e-3)));
  // A pale haze in a tint of the land's own color lies in front of the far land, so it reads as a
  // soft silhouette without turning another hue.
  return hazed + uGroundVeil.x * exp(-d / max(uGroundVeil.y, 1e-3)) * uGroundVeilTint;
}

// How far above an outline the air in front of the land is read.
const float AIR_ABOVE = 0.02;
// Wind's patches change the water's reflectance this share of how much the land's relief changes
// its light: more, and they read as dirt on the water.
const float WATER_WIND = 0.25;
// The sun's path is brighter than the glow it mirrors by up to this share: its glints catch the sun.
const float PATH_GAIN = 0.35;
// A field of glints: the light it adds at its middle as a share of the glow's, and how far that light
// is turned toward white (the glints mirror the sun itself, which is much paler than its glow; a
// warmer white added to the blue water reads lavender).
const float GLINT_GAIN = 0.8;
const float GLINT_WHITE = 0.9;
// The widest path a field of glints takes its spread from, as a share of the frame's width, and how much its rows change its light.
const float GLINT_WIDEST = 0.36;
const float GLINT_ROWS = 0.5;
// The depth over which the extra light the water takes just past the far strip fades by e.
const float SHEEN_DEPTH = 0.18;
// How much lighter the water is where its warm reflection and its own cool light meet half and half.
const float WATER_BRIDGE = 0.3;
// The same where a field of glints' warm strip and the blue water past it meet half and half.
const float STRIP_BRIDGE = 0.6;
// How fully the band along the water's far edge under a field of glints takes the reflected sky's own tint.
const float BAND_TINT = 0.85;
// Where the band is white, the share of the way to white its light goes.
const float BAND_LIFT = 0.6;
// How much less the water near the horizon squeezes the sky it mirrors under the sun, and how much more far to its sides.
const float GATHER = 0.5;

// The scene the lens sees: the sky, and in front of it water or land with a sharp outline.
// rampSky is called once, at the one point each pixel needs (more call sites make the shader
// take tens of seconds to compile): the pixel itself, the air just above the land's outline, or
// what the water mirrors.
// Water mirrors the sky uWater.x times higher than it lies below the line, jittered up and down
// by ripples (the lens averages the jitter); deep water mirrors the zenith above the frame. A
// reflection that stretched the sky would stretch its edges' waves too. Its reflectance is that of water seen
// with a long lens (half a short side under the line is uWater.y degrees below the horizon, at
// any height of the line), and its own light shows where the reflection weakens. A
// soft lighter strip under the line changes along it. In the sun's path the ripples mirror the
// glow instead of the sky above them, so no warm light lands on the mirrored blue (that turns
// purple), and the water's surface stays smooth: the lens leaves no separate glints.
vec3 rampScene(vec2 p) {
  vec2 q = p;
  // 0 sky, 1 land, 2 water, 3 water mirroring the far bank.
  int kind = 0;
  float line = 0.0;
  float top = 0.0;
  float depth = 0.0;
  float r = 0.0;
  float patches = 0.0;
  float past = 0.0;
  float onPath = 0.0;
  float brighter = 0.0;
  float glinting = 0.0;
  float sheen = 0.0;
  float band = 0.0;
  float bandSide = 0.0;
  float bandWhite = 0.0;
  vec2 mirrored = p;
  if (uGround != 0) {
    line = groundLine(p.x);
    bool bank = uGround == 1 && uShore.x > 0.0;
    top = bank ? bankTop(p.x, line) : line;
    float foot = bank ? bankFoot(p.x, line, top) : line;
    // The ground's patches: land's relief catching the light, or wind on the water. They shrink
    // toward the horizon.
    patches = hazeFbm(vec2(1.45 * p.x, 2.5 * log(max(p.y - top, 0.0) + 0.04)), uSeed + 985);
    if (p.y > top) {
      if (uGround == 2 || p.y <= foot) {
        kind = 1;
        q = vec2(p.x, top - AIR_ABOVE);
      } else {
        kind = 2;
        depth = p.y - line;
        float below = uWater.y * depth / 0.5;
        // Wind lays faint, broad patches of ripples on the water, which mirror less of the sky.
        r = clamp(waterFresnel(below) * (1.0 + WATER_WIND * uLandLit.z * patches), 0.0, 1.0);
        uint texel = uint(gl_FragCoord.x) * 0x9e3779b1u ^ uint(gl_FragCoord.y) * 0x85ebca6bu;
        float ripple = 2.0 * rampUnit(texel, uSeed + 977) - 1.0;
        // Under the sun the ripples near the horizon mirror the sky lower down, and far to its
        // sides higher up, so the glow's mirror image is thickest under the sun and the sun's
        // path grows out of it.
        float across = p.x - (uSunAt.x - 0.5) * uFrameAspect.x;
        float gather = uSunPath.x > 0.0 ? GATHER * (1.0 - 2.0 * exp(-0.5 * across * across / 0.2)) : 0.0;
        float glowTop = uSunPath.w + uSunLight.y;
        float up = uWater.x * depth * (1.0 + uWater.z * ripple);
        up = max(up + gather * min(up, glowTop), 0.002);
        float bankDepth = 0.0;
        if (bank) {
          // The far bank's mirror image is the same share of its height at any squeeze, so the
          // bank thins mostly from its top at every view; the sky above it is mirrored as it is.
          bankDepth = (line - top) / uShoreFoot.y;
          float bankUp = uWater.x * bankDepth;
          bankUp = max(bankUp + gather * min(bankUp, glowTop), 1e-5);
          up += (line - top - bankUp) * min(up / bankUp, 1.0);
        }
        if (uWaterLift.x > 0.0) {
          // The ripples tilt toward the viewer and mirror the sky higher up: under the far bank's
          // own mirror image a strip still mirrors the glow, and past it the glow's mirror image
          // gives way to the darker high sky; only the sun's path still mirrors the glow.
          // Under a standing bank that strip is broken: gone over long stretches, so it never runs
          // along the bank as a band of its own.
          // Under a field of glints it runs unbroken along the far edge.
          float strip = uWaterLift.y;
          if (bank) strip *= mix(1.0, smoothstep(-0.2, 0.5, edgeFbm(p.x * 2.2 + 1.7, uSeed + 947, 2)), smoothstep(0.02, 0.1, line - top) * (1.0 - uSunGlints.x));
          past = smoothstep(bankDepth + 0.5 * strip, bankDepth + strip, depth);
          up += uWaterLift.x * past;
          // Under a field of glints the water past the strip mirrors the sky from just above the
          // glow up, higher with depth, so it is paler near the far edge and deeper toward the viewer.
          up = mix(up, glowTop + uSunGlints.w * max(depth - bankDepth - strip, 0.0), uSunGlints.x * past);
        }
        if (uSunPath.x > 0.0) {
          // The sun's path: ripples under the sun mirror the glow above it drawn out down the
          // water, so the path is one soft column of the sky's own colors, narrowest and brightest
          // under the sun and wider and paler toward the viewer. Along it its middle wanders and
          // its width changes, and its sides are ragged on a fine scale, so they never run straight.
          float along = 1.6 * log(depth + 0.05);
          float spread = (uSunPath.y + uSunPath.z * depth) * (1.0 + 0.35 * edgeFbm(along + 4.1, uSeed + 997, 2)) + 0.5 * uLens;
          // Under the glow's mirror image the path flares out into it, so it grows out of the
          // glow's reflection with no neck where the two meet.
          // A field of glints doesn't flare: it is narrowest at the far edge.
          float flare = max(glowTop / max(uWater.x, 0.1), 0.05);
          spread += 0.75 * flare * exp(-depth / flare) * (1.0 - uSunGlints.x);
          float middle = 0.25 * spread * edgeFbm(along + 9.7, uSeed + 1009, 2);
          float ragged = 0.1 * hazeNoise(vec2(across / 0.15, 4.0 * along), uSeed + 991);
          float a = max(abs(across - middle) / spread + ragged, 0.0);
          float reach = min(1.0, depth / uSunLight.x);
          onPath = exp(-0.5 * a * a) * (1.0 - uSunGlints.x);
          brighter = PATH_GAIN * min(1.0, uSunPath.x) * onPath * (1.0 - 0.5 * reach);
          // Down its middle it mirrors the glow, and toward the viewer the band above it; toward
          // its sides the sky higher up, at a rate that does not change with depth, so it widens
          // with the path instead of closing in like a funnel. A faint path is as wide, and paler.
          float glow = max((0.5 + 0.5 * reach) * uSunPath.w, line - top + 0.01);
          float band = max(uSunLight.y, 0.04);
          float paler = reach * reach + 1.5 * (1.0 - min(1.0, uSunPath.x));
          up = mix(up, min(up, glow + band * (paler + 0.7 * (1.0 + reach) * a * a)), 1.0 - uSunGlints.x);
          r = mix(r, max(r, 0.95), onPath);
          // Under a glow above the frame the ripples mirror the sky as the rest of the water does,
          // and those turned toward the sun are glints that add its light: densest down the middle,
          // thinning out to the sides with no outline, wider toward the viewer, and in rows that
          // grow toward the viewer as the ripples do.
          float g = abs(across - middle) / (uSunGlints.y * min(spread, GLINT_WIDEST * uFrameAspect.x)) + 0.5 * ragged;
          float rows = hazeNoise(vec2(across / (0.3 * uSunGlints.z), 2.0 * along / uSunGlints.z), uSeed + 1013);
          glinting = uSunGlints.x * min(1.0, uSunPath.x) * exp(-0.5 * g * g) * max(0.0, 1.0 + GLINT_ROWS * rows);
        }
        // Under a glow above the frame the water near its far edge takes the light of the low sky's
        // bridge, which fades toward the viewer: the water is paler there and deeper near the viewer.
        // Its light changes along the edge, so it never runs as an even band.
        float edgeLight = 1.0 + 0.4 * edgeFbm(p.x * 1.3 + 5.3, uSeed + 1021, 2);
        float sheenShape = exp(-max(depth - bankDepth - uWaterLift.y, 0.0) / SHEEN_DEPTH) * smoothstep(bankDepth + 0.5 * uWaterLift.y, bankDepth + uWaterLift.y, depth);
        sheen = uWaterLift.w * edgeLight * sheenShape;
        // The band along the far edge under a field of glints: the strip's end and the sheen past it,
        // and how far it lies off to the sun's sides.
        band = uSunGlints.x * max(4.0 * past * (1.0 - past), sheenShape);
        bandSide = smoothstep(0.3, 1.0, abs(across) / max(uGlowSpread.y, 1e-3));
        // How much of the band is the strip's end rather than the sheen past it.
        bandWhite = 4.0 * past * (1.0 - past) / max(4.0 * past * (1.0 - past) + sheenShape, 1e-4);
        mirrored = vec2(p.x, line - up);
        q = mirrored;
        if (uShore.x > 0.0 && mirrored.y > top) {
          kind = 3;
          q = vec2(p.x, top - AIR_ABOVE);
        }
      }
    }
  }
  vec3 core;
  float massLight = skyPatch(p);
  // Only the sun's core goes past the grey hold, where its own light is brighter than the held sky.
  vec3 seen = rampSky(q, core) * massLight;
  seen = max(holdGrey(seen), core * massLight);
  if (kind == 0) return seen;
  // The sky high above the frame, which near water mirrors under a high line, is darker than the
  // sky in it.
  // A glow above the frame is not part of that darker sky: the dimming starts above the band over it.
  if (kind == 2 && uMirrorDeep > 0.0) seen *= exp(-max(0.0, min(-0.5 * uFrameAspect.y, line - uSunPath.w - uSunLight.y) - q.y) / uMirrorDeep);
  // One call site, as for rampSky: land itself, or the far bank as the water mirrors it.
  vec3 mirror = kind == 2 ? seen : landLight(kind == 1 ? p : mirrored, top, seen, patches);
  if (kind == 1) return mirror;
  // The water's own light is the sky's light seen through the water: under a warm sky it takes the
  // hue of the sky it mirrors, at its own light, instead of adding blue, which reads mauve.
  vec3 own = uWaterOwn * litSide(p.x);
  float mirrorLight = luminance(mirror);
  if (uWaterTint > 0.0 && mirrorLight > 1e-5) own = mix(own, luminance(own) * mirror / mirrorLight, uWaterTint);
  // A rough sea dims the reflection; it does not show more of the water's own light.
  vec3 water = uWaterMirror * mix(1.0, uWaterLift.z, past * (1.0 - onPath)) * (1.0 + brighter) * r * mirror + (1.0 - r) * own;
  // The light the water near its far edge takes is the low sky's pale bridge above the glow, in the
  // light's own pale tint: brightened in its own color, the blue there reads grey or lavender.
  water += uWaterMirror * sheen * r * luminance(mirror) * uBridgeTint;
  // Where the water's warm reflection gives way to its own cool light, the bridge between the two
  // is lighter, never khaki or grey-brown.
  float apart = clamp(warmth(mirror) - warmth(own), 0.0, 1.0);
  water += WATER_BRIDGE * 4.0 * r * (1.0 - r) * apart * luminance(water) * uBridgeTint;
  // Under a field of glints the warm strip along the far edge gives way to the blue water past it
  // through the light's own pale tint, cream to near-white, as the sky's bridge does: mixed, the
  // two make lavender or grey.
  water += STRIP_BRIDGE * uSunGlints.x * 4.0 * past * (1.0 - past) * luminance(water) * uBridgeTint;
  // The band takes the reflected sky's own color at its own lightness: the light's pale tint near
  // the light, going over through white to the low sky's clear pale tint toward the sides, never
  // the grey, lavender or mint of the two mixed.
  // Under a deep warm light with a paler core (Bold's Orange-red) it passes through white along its
  // depth too: at the sides the strip's end takes the light's pale tint going over to white, so
  // the low sky's tint never meets the strip in the lens as salmon or grey. There it is lighter,
  // or at the water's own lightness the white reads grey.
  if (band > 1e-3) {
    float white = bandWhite * uBridgeSky;
    float side = bandSide * (1.0 - 0.75 * white);
    vec3 tint = mix(mix(uBridgeTint, vec3(1.0), clamp(2.0 * side, 0.0, 1.0)), uBandTint, clamp(2.0 * side - 1.0, 0.0, 1.0));
    float y = luminance(water);
    float lifted = max(y, 1.0 - (1.0 - y) * (1.0 - BAND_LIFT * white * (1.0 - abs(2.0 * side - 1.0))));
    water = mix(water, lifted * tint, BAND_TINT * band);
  }
  // Light adds: the glints lighten the water under them and never darken it toward grey.
  if (glinting > 1e-3) {
    vec3 sun = luminance(uSunGlowColor[0]) > 1e-4 ? uSunGlowColor[0] : uGlowColor[0];
    sun = mix(sun / max(luminance(sun), 1e-4), vec3(1.0), GLINT_WHITE);
    // Over the strip along the far edge the glints brighten the warm reflection in its own color,
    // so it goes toward white through its own hues and not through salmon or pink.
    vec3 glint = mix(mirror / max(mirrorLight, 1e-4), sun, past);
    water += GLINT_GAIN * glinting * glint;
    if (uBlueHue > 0.5) water = keepBlueHue(water);
  }
  if (uWater.w > 0.0 && depth < 0.05) {
    float along = 0.7 + 0.3 * edgeFbm(p.x * 1.1 + 1.3, uSeed + 953, 2);
    water += uWater.w * along * exp(-0.5 * (depth / 0.008) * (depth / 0.008)) * mirror;
  }
  return holdGrey(water);
}

// With the lens on, the scene is drawn into the aux source, blurred there by one lens (the
// scatter blur) and read back in combine; radiance itself then has nothing to draw.
vec3 radiance(vec2 uv, vec2 p) {
  vec3 core;
  return uLens > 0.0 ? vec3(0.0) : presetLand(p, rampSky(p, core) * skyPatch(p));
}

vec3 auxRadiance(vec2 uv, vec2 p) {
  return uLens > 0.0 ? rampScene(p) : vec3(0.0);
}

vec3 combine(vec2 uv, vec2 p, vec3 direct, vec3 seen) {
  return uLens > 0.0 ? seen : direct;
}
`
