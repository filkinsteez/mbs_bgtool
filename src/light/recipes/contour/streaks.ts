import type { ColorPack } from '../../color/packs'
import type { ComposeInput, Composition, ParamValue, RecipeDefinition } from '../../scene'
import {
  clipLuminanceOf,
  contourLights,
  darkMeetParam,
  fallParam,
  frameHalf,
  geo,
  hazeGainFor,
  lerp,
  lineInShorts,
  luminanceOf,
  paleTarget,
  pickContourLight,
  round4,
  seededRandom,
  seedLayout,
  seedShares,
  type ShortLine,
  tailEndUniform,
  tailParams,
  tailUniform,
  turnParam,
  veiled,
  veilParam,
  wrapAngle,
} from './beam-compose'

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
uniform vec4 uHorizonShape; // tilt (height change per unit x), bow (per unit x squared), drift (height), line fade toward the frame edges
uniform vec4 uGlow;        // offset x from the point, level, core, wide
uniform vec2 uGlowShape;   // squash (height / width), breakup by the floor streaks
uniform vec2 uLine;        // level, width
uniform vec2 uBand;        // level, depth
uniform vec4 uFloorA;      // sky reflection, pool level, pool depth, pool width
uniform vec3 uFloorB;      // streaks, streak scale x, streak scale y
uniform vec3 uPale;        // pale share, from, to (luminance)
uniform float uPaleWhite;  // how far the pale color goes from the light's color toward white
uniform vec3 uPaleTarget;  // the light's color on the camera's path to white, at unit luminance
uniform vec4 uTail;        // dim haze color at unit peak at half of w, w (share of the haze's clipping level; 0: off)
uniform vec3 uTailEnd;     // dim haze color at unit peak at a quarter of w and below
uniform vec2 uFall;        // share of the clipping level below which haze falls faster (0: off), how much faster
uniform vec2 uLook;        // base level, vignette
uniform vec4 uTurn;        // a dragged line: cos and sin of the scene's turn on screen, offset (scene = turn^-1 screen + offset)
uniform float uReach;      // a dragged line's length: the shafts fade out by about there (0: they reach the frame's edges)
uniform vec4 uNear;        // sky near the point: dark out to x, all its light from y (distance), light there (share), glare at the point (share)
uniform vec3 uTexture;     // fine streaks inside the shafts: contrast, streaks per radian, how fast they change along their length
uniform vec4 uVeil;        // a cool light's haze: veil color share (1: full color), level of the full color (share of the clipping luminance), band width (octaves), dark haze luminance
uniform float uSkyPeak;    // where across the lit sky it is brightest (0: at its first end)
uniform vec4 uDarkMeet;    // over a dark of another hue: light level its faint tail falls off below (from, to), level the dark is gone by (from, to); 0: off

const int SHADOW_TAPS = 20;
const int SHORT_TAPS = 8;

vec2 turned(vec2 screen) {
  return vec2(dot(screen, uTurn.xy), dot(screen, vec2(-uTurn.y, uTurn.x))) + uTurn.zw;
}

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
  // The brightest direction: the lit sky's first end, or a share of the way across it.
  if (uSkyPeak > 0.0) t = abs(t - uSkyPeak) / max(uSkyPeak, 1.0 - uSkyPeak);
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
  // Past the lit sky the clouds thicken: the shadow there follows the clouds, so its edge
  // breaks into shafts and gaps, and less sky light reaches the shadows.
  depth *= uClouds.z * (1.0 + uLayer.w * unlit) * dr / (r1 - r0);
  // Near the light its forward-scattered glow fills the shadows, so shafts grow out of
  // the glow instead of starting as spikes at the point.
  float fill = uClouds.w * (1.0 - 0.8 * unlit);
  fill = mix(1.0, fill, smoothstep(r0, r1 + 0.5 * (r1 - r0), r));
  return fill + (1.0 - fill) * exp(-depth);
}

// The sky seen at p (above the horizon): the light by direction, brighter away from the
// point, times the share that comes through the clouds. Close to the light its glare is
// the same in every direction, so the pattern by direction grows out of it instead of
// meeting at a corner on the point.
float skyShafts(vec2 p) {
  vec2 d = p - uCenter;
  float r = length(d);
  float theta = atan(d.y, d.x);
  vec2 dirLight = skyDirection(theta);
  float glare = uNear.w / (1.0 + r * r / max(0.1 * uLayer.x * uLayer.x, 1e-6));
  dirLight = vec2(mix(dirLight.x, uSkyLevel.x, glare), dirLight.y * (1.0 - glare));
  if (dirLight.x <= 1e-5) return 0.0;
  float rise = 1.0 + uRise.x * pow(abs(sin(theta)), uRise.w) * smoothstep(uRise.y, uRise.z, r);
  float reach = uReach > 0.0 ? 1.0 / (1.0 + pow(r / (0.75 * uReach), 3.0)) : 1.0;
  // The clouds are thickest around the light, so the sky right above the point is dark and
  // the shafts brighten away from it.
  float near = mix(uNear.z, 1.0, smoothstep(uNear.x, uNear.y, r));
  // Fine streaks inside the shafts, as if the lit haze were smeared along the rays: noise
  // around a circle (so it has no seam), changing slowly along each ray.
  float streaks = 1.0;
  if (uTexture.x > 0.0) {
    vec2 dir = d / max(r, 1e-5);
    streaks = max(0.0, 1.0 + uTexture.x * gradientNoise(dir * uTexture.y + vec2(3.1, log(max(r, 1e-3)) * uTexture.z), uSeed + 401));
  }
  return dirLight.x * rise * shaftLight(d, r, dirLight.y) * reach * near * streaks;
}

float floorStreaks(vec2 q) {
  vec2 x = vec2(q.x * uFloorB.y, q.y * uFloorB.z);
  return 0.65 * gradientNoise(x + vec2(8.1, 0.6), uSeed + 211) + 0.35 * gradientNoise(2.1 * x + vec2(1.7, 4.4), uSeed + 223);
}

// Height of the horizon at x: through the convergence point, with a slight tilt, a bow
// and a slow drift, so it is never a straight level line.
float horizonY(float x) {
  float dx = x - uCenter.x;
  float drift = valueNoise(vec2(x * 1.3, 9.1), uSeed + 331) - valueNoise(vec2(uCenter.x * 1.3, 9.1), uSeed + 331);
  return uCenter.y + uHorizonShape.x * dx + uHorizonShape.y * dx * dx + uHorizonShape.z * drift;
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
// on a rough floor: one hot spot under it, stretched toward the camera. Light through
// haze falls off with a long tail, so none of these has a flat top or an edge.
float horizonGlow(vec2 q, float streak) {
  float hy = horizonY(q.x);
  float dx = q.x - uCenter.x - uGlow.x;
  float dy = (q.y - hy) / max(uGlowShape.x, 0.02);
  float r2 = dx * dx + dy * dy;
  float core = max(uGlow.z, 1e-3);
  float wide = max(uGlow.w, 1e-3);
  float glow = uGlow.y * (0.25 * core / (core + sqrt(r2)) + 0.75 * pow(1.0 + r2 / (wide * wide), -1.25));
  glow *= max(0.0, 1.0 + uGlowShape.y * streak);
  float side = sideways(q.x);
  vec2 drift = alongHorizon(q.x);
  float bandLevel = uBand.x * side * max(0.0, 1.0 + 0.5 * uHorizon.z * drift.x);
  float bandDepth = max(uBand.y, 1e-3) * (0.45 + 0.55 * side) * (1.0 + 0.4 * uHorizon.z * drift.y) * (q.y < hy ? 1.0 : 0.5);
  float across = (q.y - hy) / bandDepth;
  float band = bandLevel * pow(1.0 + across * across, -1.5);
  float pool = 0.0;
  if (q.y > hy) {
    // Brightest a little below the horizon, an exponential fade toward the camera and to
    // the sides; nearer floor is wider.
    float t = (q.y - hy) / max(uFloorA.z, 1e-3);
    float wideNear = min(abs(dx) / (max(uFloorA.w, 1e-3) * (1.0 + 0.5 * t)), 20.0);
    pool = uFloorA.y * t * exp(1.0 - t) / cosh(wideNear) * max(0.0, 1.0 + 0.6 * uFloorB.x * streak);
  }
  return glow + band + pool;
}

// The smooth, costly part, rendered once at the scatter pass's working size: the sky's
// shafts (mirrored on the floor), the soft horizon light after a short radial integral,
// and how the floor's streaks change the sky's reflection.
vec3 auxRadiance(vec2 uv, vec2 screen) {
  vec2 p = turned(screen);
  float hy = horizonY(p.x);
  bool floorSide = p.y > hy;
  vec2 skyPoint = floorSide ? vec2(p.x, 2.0 * hy - p.y) : p;
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
// radial integral). Its width changes along it, and it fades toward the frame edges.
// combine() adds the rest and turns the light into color.
vec3 radiance(vec2 uv, vec2 screen) {
  vec2 p = turned(screen);
  float width = uLine.y * max(0.3, 1.0 + 0.6 * uHorizon.z * valueNoise(vec2(p.x * 2.9 + 1.7, 5.3), uSeed + 317));
  float across = (p.y - horizonY(p.x)) / max(width, 1e-4);
  float side = sideways(p.x);
  float ends = 1.0 - uHorizonShape.w * smoothstep(0.45, 1.0, abs(p.x) / (0.5 * uFrameAspect.x));
  return vec3(uLine.x * exp(-0.5 * across * across) * side * side * ends, 0.0, 0.0);
}

// Color of one unit of scattered light at that level. Warm haze leaves its own color below
// uTail.w of its clipping level: at half of it the color is uTail's and at a quarter
// uTailEnd's, each at the haze's level, like a flame cooling (Yellow to Orange-red to deep
// red), so faint warm light never spreads as olive, brick or grey-brown.
vec3 warmTail(float scatter) {
  if (uTail.w <= 0.0) return uHazeColor;
  float peak = max(max(uHazeColor.r, uHazeColor.g), uHazeColor.b);
  float x = scatter * peak / uTail.w;
  vec3 mid = mix(uTail.rgb * peak, uHazeColor, smoothstep(0.5, 1.0, x));
  return mix(uTailEnd * peak, mid, smoothstep(0.25, 0.5, x));
}

// Haze dimmer than uFall.x of its clipping level falls toward black uFall.y times faster
// (light ~ level^uFall.y). The rate eases in from 1 at uFall.x, a rounded shoulder with no
// crease, and is all there from a quarter of uFall.x down.
float warmFall(float scatter) {
  if (uFall.x <= 0.0) return 1.0;
  float peak = max(max(uHazeColor.r, uHazeColor.g), uHazeColor.b);
  float x = scatter * peak / uFall.x;
  if (x >= 1.0) return 1.0;
  return exp((uFall.y - 1.0) * log(max(x, 1e-6)) * (1.0 - smoothstep(0.25, 1.0, x)));
}

vec3 combine(vec2 uv, vec2 screen, vec3 line, vec3 cached) {
  vec2 p = turned(screen);
  // The far floor is seen through the haze at the horizon, so its reflection fades into
  // the sky there instead of stopping at a line.
  float below = max(p.y - horizonY(p.x), 0.0);
  float far = exp(-below / max(2.0 * uBand.y, 1e-3));
  float sky = cached.x * mix(uFloorA.x * cached.z, 1.0, far);
  float scatter = sky + cached.y + line.x;
  float lumHaze = max(luminance(uHazeColor), 1e-5);
  float lumLight = max(luminance(uLightColor), 1e-5);
  float pale = saturate(uPale.x * smoothstep(uPale.y, uPale.z, scatter * lumHaze));
  vec3 paleColor = mix(uLightColor / lumLight, uPaleTarget, uPaleWhite) * lumHaze;
  // A cool light's haze is a pale veil of its color: its whole color path, the pale core too,
  // keeps only a share of its chroma at the same Oklab lightness and hue, rising to twice that
  // share in a wide band of levels; its darks are a faint blue-black haze, not black.
  vec3 path = mix(warmTail(scatter), paleColor, pale);
  vec3 veil = uHazeColor;
  if (uTail.w <= 0.0 && uVeil.x < 1.0) {
    float clip = lumHaze / max(max(uHazeColor.r, uHazeColor.g), uHazeColor.b);
    float octaves = log2(max(scatter * lumHaze, 1e-6) / (uVeil.y * clip)) / max(uVeil.z, 0.05);
    vec3 lab = linearToOklab(path);
    path = oklabToLinear(vec3(lab.x, lab.yz * min(1.0, uVeil.x * (1.0 + exp(-0.5 * octaves * octaves)))));
  }
  // Over a dark of another hue (Meta Blue over Plum) the light and the dark both dim toward
  // black before they meet: the dark fades out where the light is, and the light's faint tail
  // falls off faster, so they never blend into a third color over a wide fade.
  float meet = 1.0;
  float darkShows = 1.0;
  if (uDarkMeet.y > 0.0) {
    meet = smoothstep(uDarkMeet.x, uDarkMeet.y, scatter);
    darkShows = 1.0 - smoothstep(uDarkMeet.z, uDarkMeet.w, scatter);
  }
  vec3 color = uBaseColor * uLook.x * darkShows + scatter * meet * warmFall(scatter) * path + uVeil.w * veil / lumHaze;
  vec2 half_ = 0.5 * uFrameAspect;
  float vig = 1.0 - uLook.y * dot(screen, screen) / dot(half_, half_);
  return color * max(vig, 0.0);
}
`

/** Sigma of the scatter pass's blur of the cached sky, in short-side units. */
const SKY_CACHE_BLUR = 0.012

/**
 * Short side of the cached sky in px: the size that blur gave before sources had their own
 * size, with one sample per texel, so the picture is the same and a 1080p frame takes about
 * 5 ms instead of 7.5.
 */
const SKY_CACHE_SIZE = 334

/** Luminance one unit of scattered light should have, whatever the pack's haze color. */
const HAZE_LUMINANCE = 0.12

/**
 * Pack output's light level over HAZE_LUMINANCE. At the default Intensity the brightest
 * shafts and the floor pool land at 2 to 4 times nominal, so the tone curve takes them
 * toward pale white; Meta Blue gets there, as the pale hazes do.
 */
const LIGHT_GAIN = 4

/** Smallest level of the sky past the lit side, as a share of the lit side's level. */
const DARK_SHARE = 0.04

/** How much brighter a cool light's sky and floor pool are than a warm light's. */
const COOL_SKY_GAIN = 2.2
const COOL_POOL_GAIN = 1.6

/** Share of its clipping level one unit of a warm light's scattered light reaches. */
const WARM_SHARE = 0.45

/**
 * Warm haze dimmer than this share of its clipping level falls toward black faster, and
 * Lime's starts toward Forest's deep green.
 */
const TAIL_BELOW = 1.1

/** How much faster that dim warm haze falls. */
const TAIL_FALL = 2.5

/**
 * The sky's ambient light over the beam's room level: the pack's dark color shows in the
 * shadows between shafts, so a light shared by two packs still reads as its own pack.
 */
const BASE_GAIN = 4

/**
 * Pack output. Light (the mood control) moves the point where the shafts meet along the
 * horizon from the seed's place, and a dragged line sets the point, the shafts' direction and
 * their reach instead (streaksOnLine). The seed lays out the scene: where the point sits (near the
 * lit side's frame edge or past the middle, high or low), which side of it is lit (the other
 * side stays dark for text), how wide the lit sky fans out and how many gaps the clouds
 * have; it also picks the light, where the cloud layer sits and the floor. Intensity is the
 * light's power; Softness thins the clouds and lets more sky light into the shadows (denser
 * haze), so the shafts soften, and widens the horizon line.
 */
function composeStreaks({ pack, controls, seed, aspect }: ComposeInput): Composition {
  const random = seededRandom(seed, 0x57e4)
  const { intensity, softness, mood } = controls
  const { halfW, halfH } = frameHalf(aspect)
  const wide = aspect >= 1
  const light = pickContourLight(pack, seed, random)
  const hazeGain = hazeGainFor(light, HAZE_LUMINANCE, WARM_SHARE)
  const soft = (lo: number, hi: number) => lerp(lo, hi, softness)
  // A cool light's pale veil reads as light only when bright, as in the moodboard (shafts at
  // Oklab L about 0.77, the floor's pool at 0.97), so its sky and pool are brighter; a warm
  // light this bright would turn into a white plateau.
  const coolGain = veiled(light) ? COOL_SKY_GAIN : 1
  const poolGain = veiled(light) ? COOL_POOL_GAIN : 1
  // At low Intensity the light near the point stays under about twice nominal, so its hot
  // spot keeps a rounded top instead of a flat white one.
  const power = geo(intensity, 0.22, 0.75, 1.4) * hazeGain * LIGHT_GAIN

  // The seed's layout (seedLayout, so seeds 1-8 differ in at least two of these): the point
  // near the lit side's frame edge or past the middle, high in the frame or low (down to just
  // below its bottom edge), the left or the right side lit, a narrow or a wide fan of lit sky.
  // How many shafts the clouds let through spreads over the seeds (seedShares).
  const [past, low, leftLit, broadFan] = seedLayout(pack, seed, 0x57e4)
  const [rayShare] = seedShares(seed, 0x57e4, 1, random)
  const either = (choice: number, lo: [number, number], hi: [number, number]) => (choice ? lerp(hi[0], hi[1], random()) : lerp(lo[0], lo[1], random()))
  const horizonAt = wide ? either(low, [0.48, 0.62], [0.84, 1.02]) : either(low, [0.52, 0.66], [0.84, 1.02])
  const cy = -halfH + 2 * halfH * horizonAt
  const litLeft = leftLit === 1
  // How far the point sits from the lit side's frame edge, as a share of the width: near
  // it, the dark sky covers the wider part of the frame; past the middle, the shafts cross
  // the frame, and at high Light the point leaves it on the far side. Light moves the point
  // away from the lit edge over a fixed span, so more Light always lights more sky. Near the
  // lit edge the fan reaches at least about straight up, so its shafts stay in the frame.
  const from = past ? lerp(0.58, 0.92, random()) : lerp(0.24, 0.42, random())
  const near = from + (mood - 0.5) * 0.35
  const along = litLeft ? near : 1 - near
  const cx = (along - 0.5) * 2 * halfW
  const end = past ? either(broadFan, [1.1, 1.45], [1.8, 2.3]) : either(broadFan, [1.5, 1.85], [2.15, 2.6])
  const sky = litLeft ? [lerp(-3.3, -3.05, random()), -Math.PI + end] : [lerp(-0.1, 0.15, random()), -end]
  const glowSide = litLeft ? -1 : 1
  // The cloud layer sits within the sky above the point, so short skies (16:9) get it closer.
  const skyHeight = cy + halfH
  const layerIn = round4(lerp(0.2, 0.3, random()) * skyHeight)
  const layerOut = round4(layerIn + lerp(0.12, 0.22, random()) * skyHeight)
  // The horizon: a slight tilt either way, a slight bow, a slow drift; in most seeds the
  // line fades out before the frame edges. Tilt and bow never come out near zero, so no
  // seed gets a level, straight line.
  const eitherWay = (lo: number, hi: number) => (random() < 0.5 ? -1 : 1) * lerp(lo, hi, random())
  const horizonShape = [eitherWay(0.012, 0.035), eitherWay(0.01, 0.035), lerp(0.012, 0.024, random()), random() < 0.8 ? lerp(0.6, 1, random()) : lerp(0, 0.3, random())]

  const params: Record<string, ParamValue> = {
    center: [round4(cx), round4(cy)],
    sky: [round4(sky[0]), round4(sky[1]), round4(soft(0.35, 0.6)), round4(lerp(0.8, 1.2, random()))],
    skyLevel: [round4(Math.min(32, 3 * coolGain * power)), round4(0.16 * coolGain * power), round4(lerp(DARK_SHARE, 1.6 * DARK_SHARE, random()))],
    rise: [round4(lerp(4, 7, random())), round4(lerp(0.2, 0.32, random())), round4(lerp(0.9, 1.2, random())), round4(lerp(3.5, 5, random()))],
    // A few wide gaps with soft sides, and light between them: broad, soft shafts.
    clouds: [round4(lerp(5, 11, rayShare)), round4(soft(2.2, 1.2)), round4(soft(4, 1.8)), round4(soft(0.25, 0.45))],
    layer: [layerIn, layerOut, round4(lerp(0.25, 0.5, random())), round4(lerp(2.5, 5, random()))],
    horizon: [round4(lerp(0.45, 0.75, random())), round4(lerp(0.03, 0.1, random())), round4(lerp(0.4, 0.8, random())), round4(soft(0.1, 0.25))],
    horizonShape: horizonShape.map(round4),
    // No glow of its own at the point: the brightest light is the floor's wide pool just below
    // it, and the floor mirrors only a little of the sky.
    glow: [round4(glowSide * lerp(0, 0.05, random())), round4(Math.min(8, 0.35 * power)), round4(lerp(0.05, 0.1, random())), round4(lerp(0.2, 0.32, random()))],
    glowShape: [round4(lerp(0.35, 0.55, random())), round4(lerp(0.3, 0.7, random()))],
    line: [round4(Math.min(4, 0.3 * power)), round4(soft(0.005, 0.014))],
    band: [round4(Math.min(6, 0.9 * power)), round4(soft(0.015, 0.03))],
    floor: [round4(lerp(0.1, 0.2, random())), round4(Math.min(16, 1.8 * poolGain * power)), round4(lerp(0.04, 0.07, random())), round4(lerp(0.3, 0.45, random()))],
    floorStreaks: [round4(lerp(0.2, 0.45, random())), 1.6, 14],
    // A cool light starts toward pale from 0.3 of the haze's clipping level and is all pale by
    // 1.8 times it, so bright light reads pale over a wide range, as in the moodboard. A warm
    // light starts at 0.4 and is there by 2.3 times it, keeping its own color longer.
    pale: veiled(light)
      ? [1, round4(0.3 * clipLuminanceOf(light.haze)), round4(1.8 * clipLuminanceOf(light.haze))]
      : [0.8, round4(0.4 * clipLuminanceOf(light.haze)), round4(2.3 * clipLuminanceOf(light.haze))],
    paleWhite: light.light === light.haze ? 0.5 : 0.2,
    ...tailParams(light, TAIL_BELOW),
    fall: fallParam(light, TAIL_BELOW, TAIL_FALL),
    base: round4(BASE_GAIN * light.baseLevel),
    vignette: round4(lerp(0.08, 0.15, random())),
    // The sky stays dark through the cloud layer, where the light is thickest around the
    // point, and has all its light just past it, with no glare at the point; fine streaks run
    // in the shafts.
    near: [layerOut, round4(1.7 * layerOut), 0.25, 0],
    texture: [0.35, 11, 0.5],
    veil: veilParam(light),
    darkMeet: darkMeetParam(light, BASE_GAIN),
  }
  if (controls.drag) Object.assign(params, streaksOnLine(params, lineInShorts(controls.drag, aspect), skyHeight))

  return {
    colors: [light.light, light.haze, light.base],
    params,
    lens: { bloom: round4(soft(0.03, 0.06)), bloomLevels: [1, 0.5, 0.25, 0.1, 0, 0, 0, 0], halation: 0 },
    output: { grain: 0, toe: light.toe },
  }
}

/**
 * How close (radians) a dragged line may point to the horizon before the horizon tilts with
 * it, so the line stays inside the lit sky.
 */
const HORIZON_MARGIN = 0.25

/**
 * The scene for a dragged line: the shafts meet at the line's start and fan out toward its
 * end. The lit sky turns toward the line as far as it stays above the horizon; once the line
 * points closer to the horizon than that, the horizon tilts with it, and as the line turns to
 * point straight down the whole scene turns over, so turning the line never flips anything
 * from one side to the other. The line's length is the shafts' reach: the cloud layer and the
 * rise sit at the seed's shares of it, the clouds keep the seed's number of gaps, and past
 * the reach the shafts fade into the dark.
 */
function streaksOnLine(params: Record<string, ParamValue>, line: ShortLine, skyHeight: number): Record<string, ParamValue> {
  const sky = params.sky as number[]
  const layer = params.layer as number[]
  const rise = params.rise as number[]
  const clouds = params.clouds as number[]
  const near = params.near as number[]
  const skyLevel = params.skyLevel as number[]
  // The lit sky's width (bright end first) and how far it can turn either way above the horizon.
  const width = sky[1] - sky[0]
  const room = Math.max(0, (Math.PI - Math.abs(width)) / 2)
  // The line's angle from straight up, positive toward +x, and the part of it taken without
  // tilting the horizon: all of it until the line comes near the horizon, then less and less,
  // and none when it points straight down.
  const fromUp = wrapAngle(line.angle + Math.PI / 2)
  const free = Math.PI / 2 - HORIZON_MARGIN
  const past = Math.min(1, Math.max(0, (Math.abs(fromUp) - free) / (Math.PI - free)))
  const level = fromUp * (1 - past * past * (3 - 2 * past))
  const fan = room > 1e-3 ? room * Math.tanh(level / room) : 0
  const reach = Math.hypot(line.length, 0.04)
  const scale = reach / Math.max(skyHeight, 0.05)
  return {
    center: line.from.map(round4),
    sky: [round4(-Math.PI / 2 + fan - width / 2), round4(-Math.PI / 2 + fan + width / 2), sky[2], sky[3]],
    turn: turnParam(fromUp - level, line.from, line.from),
    // The light stays brightest at the floor band: the shafts brighten little away from the
    // point and fade out by the line's end.
    reach: round4(0.8 * reach),
    layer: [round4(layer[0] * scale), round4(layer[1] * scale), layer[2], layer[3]],
    rise: [round4(0.25 * rise[0]), round4(rise[1] * scale), round4(rise[2] * scale), rise[3]],
    clouds: [round4(Math.min(64, clouds[0] / scale)), clouds[1], clouds[2], clouds[3]],
    near: [round4(near[0] * scale), round4(near[1] * scale), near[2], near[3]],
    // The brightest shafts point along the line, and the rest of the fan keeps a good share of
    // their light, so the shafts spread broadly instead of gathering into one column.
    skyPeak: round4(Math.min(0.9, Math.max(0.1, 0.5 + (level - fan) / (Math.abs(width) > 1e-3 ? width : 1e-3)))),
    skyLevel: [skyLevel[0], round4(0.35 * skyLevel[0]), skyLevel[2]],
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
    { kind: 'vector', key: 'skyLevel', label: 'Sky level', min: 0, max: 32, step: 0.005, default: [3.4, 0.18, 0.3] },
    { kind: 'vector', key: 'rise', label: 'Rise', min: 0, max: 20, step: 0.005, default: [8, 0.25, 0.8, 4] },
    { kind: 'vector', key: 'clouds', label: 'Clouds', min: 0, max: 64, step: 0.005, default: [7, 2, 3, 0.25] },
    { kind: 'vector', key: 'layer', label: 'Cloud layer', min: 0, max: 6, step: 0.005, default: [0.15, 0.45, 0.3, 1.5] },
    { kind: 'vector', key: 'horizon', label: 'Horizon', min: 0, max: 2, step: 0.005, default: [0.55, 0.1, 0.6, 0.3] },
    { kind: 'vector', key: 'horizonShape', label: 'Horizon shape', min: -1, max: 1, step: 0.0005, default: [0, 0, 0, 0] },
    { kind: 'vector', key: 'glow', label: 'Glow', min: -2, max: 8, step: 0.005, default: [-0.02, 1.35, 0.12, 0.25] },
    { kind: 'vector', key: 'glowShape', label: 'Glow shape', min: 0, max: 3, step: 0.005, default: [0.2, 0.6] },
    { kind: 'vector', key: 'line', label: 'Horizon line', min: 0, max: 4, step: 0.0005, default: [0.6, 0.005] },
    { kind: 'vector', key: 'band', label: 'Band', min: 0, max: 6, step: 0.005, default: [2.5, 0.04] },
    { kind: 'vector', key: 'floor', label: 'Floor', min: 0, max: 16, step: 0.005, default: [0.4, 2, 0.12, 0.3] },
    { kind: 'vector', key: 'floorStreaks', label: 'Floor streaks', min: 0, max: 40, step: 0.005, default: [1, 3, 22] },
    { kind: 'vector', key: 'pale', label: 'Pale', min: 0, max: 4, step: 0.005, default: [0.6, 0.15, 0.8] },
    { kind: 'number', key: 'paleWhite', label: 'Pale toward white', min: 0, max: 1, step: 0.005, default: 0 },
    { kind: 'vector', key: 'tail', label: 'Dim haze color', min: 0, max: 2, step: 0.0005, default: [1, 1, 1, 0] },
    { kind: 'vector', key: 'tailEnd', label: 'Faint haze color', min: 0, max: 1, step: 0.0005, default: [1, 1, 1] },
    { kind: 'vector', key: 'fall', label: 'Dim haze falloff', min: 0, max: 8, step: 0.005, default: [0, 1] },
    { kind: 'number', key: 'base', label: 'Base', min: 0, max: 4, step: 0.005, default: 1 },
    { kind: 'number', key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.005, default: 0.1 },
    { kind: 'vector', key: 'turn', label: 'Turn', min: -8, max: 8, step: 0.0005, default: [1, 0, 0, 0] },
    { kind: 'number', key: 'reach', label: 'Reach', min: 0, max: 4, step: 0.005, default: 0 },
    { kind: 'vector', key: 'near', label: 'Sky near the point', min: 0, max: 4, step: 0.005, default: [0, 0.001, 1, 1] },
    { kind: 'vector', key: 'texture', label: 'Fine streaks', min: 0, max: 64, step: 0.005, default: [0, 12, 0.6] },
    { kind: 'vector', key: 'veil', label: 'Haze veil', min: 0, max: 4, step: 0.0005, default: [1, 1, 1, 0] },
    { kind: 'number', key: 'skyPeak', label: 'Brightest direction', min: 0, max: 1, step: 0.005, default: 0 },
    { kind: 'vector', key: 'darkMeet', label: 'Meeting another dark', min: 0, max: 4, step: 0.0005, default: [0, 0, 0, 0] },
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
    uHorizonShape: ctx.vec('horizonShape'),
    uGlow: ctx.vec('glow'),
    uGlowShape: ctx.vec('glowShape'),
    uLine: ctx.vec('line'),
    uBand: ctx.vec('band'),
    uFloorA: ctx.vec('floor'),
    uFloorB: ctx.vec('floorStreaks'),
    uPale: ctx.vec('pale'),
    uPaleWhite: ctx.num('paleWhite'),
    uPaleTarget: paleTarget(ctx.color('light')),
    uTail: tailUniform(ctx.vec('tail')),
    uTailEnd: tailEndUniform(ctx.vec('tailEnd')),
    uFall: ctx.vec('fall'),
    uLook: [ctx.num('base'), ctx.num('vignette')],
    uTurn: ctx.vec('turn'),
    uReach: ctx.num('reach'),
    uNear: ctx.vec('near'),
    uTexture: ctx.vec('texture'),
    uVeil: ctx.vec('veil'),
    uSkyPeak: ctx.num('skyPeak'),
    uDarkMeet: ctx.vec('darkMeet'),
  }),
  scatter: [{ source: 'aux', radius: () => SKY_CACHE_BLUR, size: () => SKY_CACHE_SIZE }],
  lens: { bloom: 0.04, bloomLevels: [1, 0.5, 0.25, 0.1, 0, 0, 0, 0], halation: 0 },
  fromPack: (pack: ColorPack) => {
    const { light, haze, base } = contourLights(pack)[0]
    return [light, haze, base]
  },
  compose: composeStreaks,
}
