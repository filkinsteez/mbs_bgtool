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
uniform vec2 uLateral;       // sideways falloff exponent, widening per short side of height
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

uniform vec3 uSunGlowColor[SUN_LAYERS];
uniform float uSunGlowRadius[SUN_LAYERS];
uniform vec2 uSunGlowShape;  // width over height, falloff exponent
uniform vec2 uOcclude;       // how much the land hides the sun glow, and the width of that edge

uniform vec3 uBridge;        // amount, lift toward white, luminance below which it fades out
uniform vec3 uBridgeTint;    // luminance 1

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

// Flat-topped exponential: rounded over half a decay length, then exp(-|d| / tau).
float softExp(float d, float tau) {
  float t = max(tau, 1e-5);
  float eps = 0.5 * t;
  return exp(-(sqrt(d * d + eps * eps) - eps) / t);
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

vec3 radiance(vec2 uv, vec2 p) {
  float halfWidth = 0.5 * uFrameAspect.x;
  vec2 anchor = (uAnchor - 0.5) * uFrameAspect;
  vec2 d = p - anchor;
  float along = dot(d, uAxis);
  float across = d.x * uAxis.y - d.y * uAxis.x;
  float s = along - uDrop * across * across / (halfWidth * halfWidth);

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
    if (j == uHorizonEdge) horizon = m;
    level[j] = rise(s - m, sqrt(w * w + uBlur * uBlur));
  }

  float height = max(0.0, horizon - s);
  float widen = 1.0 + uLateral.y * height;
  float lightReach = uLightTop > 0.0 ? 1.0 - smoothstep(0.45 * uLightTop, uLightTop, height) : 1.0;

  float sunlit = sideFalloff(across - sunAcross, uSunlightShape.x * widen, uLateral.x);
  if (uSunlightShape.y > 0.0) sunlit *= exp(-height / uSunlightShape.y);
  vec3 gain = vec3(1.0) + uSunlight * (sunlit * lightReach);

  LightMix mixed = LightMix(vec3(0.0), 0.0, 0.0);
  vec3 glow = vec3(0.0);
  float glowDepth = 0.0;
  float dh = s - horizon - uGlowOffset;
  float side = sideFalloff(across - sunAcross, uGlowSpread.y * widen, uLateral.x);
  float far = 1.0 - uGlowSpread.x;
  if (uGlowSpread.z > 0.0) far *= 1.0 - exp(-height / uGlowSpread.z);
  float spread = (far + (1.0 - far) * side) * lightReach;
  float reach = uGlowVary.x != 0.0 ? exp(uGlowVary.x * edgeFbm(across * uGlowVary.y + 31.7, uSeed + 601, 2)) : 1.0;
  reach *= 1.0 + uGlowVary.z * side;
  for (int k = 0; k < GLOW_LAYERS; k++) {
    if (uGlowWeight[k] <= 0.0) continue;
    vec2 tau = uGlowTau[k] * vec2(reach, 1.0);
    float f = spread * uGlowWeight[k] * softExp(dh, dh < 0.0 ? tau.x : tau.y);
    float path = dh > 0.0
      ? uRedden.x * (1.0 - exp(-dh / max(tau.y, 1e-5)))
      : -uRedden.y * (1.0 - exp(dh / max(tau.x, 1e-5)));
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

  float dim = uHorizonDim.x * exp(-height / max(uHorizonDim.y, 1e-4));
  if (uHorizonEdge >= 0) dim *= mix(1.0, uDimBelow, level[uHorizonEdge]);
  vec3 skyGain = gain * exp(-uExtinction * glowDepth - dim);
  vec3 sky = vec3(0.0);
  for (int k = 0; k < RAMP_COLORS; k++) {
    if (k > uEdges) break;
    float w = (k == 0 ? 1.0 : level[k - 1]) - (k < uEdges ? level[k] : 0.0);
    sky += w * uStop[k];
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
  light *= hazeLight;

  if (uLand.x > 0.0) {
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
`
