import type { ColorPack } from '../../color/packs'
import type { ComposeInput, Composition, ParamValue, RecipeContext, RecipeDefinition } from '../../scene'
import {
  clipLuminanceOf,
  contourLights,
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
  wrapAngle,
} from './beam-compose'

/**
 * A beam of light from a source above the frame, seen through haze, landing
 * on a stage floor.
 *
 * World: a pinhole camera at the origin looks along +z with y down; the
 * floor is the plane y = 1 (the camera height is the unit of length). The
 * horizon sits at screen height `horizon` (a lens shift, so verticals stay
 * vertical). The stage's back edge appears at `floorY` above the beam.
 *
 * Light, all added in linear RGB:
 * - beam: light scattered by the haze inside the beam, integrated along each
 *   view ray through the beam's soft (optionally hollow) cross-section. The
 *   haze is denser under the ceiling and on the floor; a Henyey-Greenstein
 *   phase makes it brighter where the camera looks toward the source; the
 *   beam loses light to the haze on its way down.
 * - pool: the floor lit where the beam lands, plus the light the haze
 *   scatters onto the floor around it.
 * - bounce: the pool's light scattered back by the haze above it (a
 *   Lambertian emitter on the floor, so haze at grazing angles stays dark).
 * - reflection: a rough glossy floor mirrors the lit haze above the landing
 *   spot (blurred with distance, stronger at grazing angles); boards with
 *   slightly different gloss split it into lanes that run toward the camera.
 * - ambient: dim room light scattered by the haze.
 */

const BEAM_GLSL = /* glsl */ `
uniform vec3 uLightColor;
uniform vec3 uHazeColor;
uniform vec3 uBaseColor;
uniform vec4 uCamera;     // horizon y, focal length, stage edge y, stage roundness
uniform vec4 uWorld;      // landing depth, landing x, beam radius (world), stage edge depth
uniform vec4 uBeamShape;  // tilt x, tilt toward the camera, spread, edge exponent
uniform vec4 uBeamLight;  // power, hollow radius, hollow depth, extinction
uniform vec4 uHazeA;      // mid density, ceiling layer, ceiling layer depth, ceiling y
uniform vec4 uHazeB;      // floor layer, floor layer depth, forward scattering g, noise amount
uniform vec2 uHazeNoise;  // noise scale across, along
uniform vec4 uBounce;     // level, reach, horizontal stretch, rim
uniform vec4 uPool;       // level, spill level, spill width (beam radii), edge softness
uniform vec2 uLanes;      // gloss lane contrast, lane width (beam radii)
uniform vec4 uFloorLook;  // gloss, roughness, texture amount, texture cell
uniform vec3 uPale;       // pale share, from, to (luminance)
uniform float uPaleWhite; // how far the pale color goes from the light's color toward white
uniform vec3 uPaleTarget; // the light's color on the camera's path to white, at unit luminance
uniform vec2 uEdge;       // rounded stage edge width (beam half-widths), glow falloff over the floor (1: as above it)
uniform float uEdgeHaze;  // haze over the stage edge lit by the floor's spill there, as a share of the spill (0: none)
uniform vec4 uTail;       // dim haze color at unit peak at half of w, w (share of the haze's clipping level; 0: off)
uniform vec3 uTailEnd;    // dim haze color at unit peak at a quarter of w and below
uniform vec2 uFall;       // share of the clipping level below which haze falls faster (0: off), how much faster
uniform vec3 uAmbient;    // room level, haze share, floor level
uniform float uVignette;
uniform vec4 uTurn;       // a dragged line: cos and sin of the stage's turn on screen, offset (stage = turn^-1 screen + offset)
uniform vec2 uSource;     // world heights where the beam starts and where it has all its light
uniform float uCeilingTop; // how far above its ceiling the ceiling haze thins out (screen; 0: it doesn't)

const int BEAM_STEPS = 16;

float beamSoftDisk(float r, float k) { return exp(-0.5 * pow(max(r, 0.0), k)); }

// Beam light per unit area at radius r (in beam radii) from the axis.
float beamAperture(float r) {
  float outer = beamSoftDisk(r, uBeamShape.w);
  float hole = uBeamLight.y;
  float inner = hole > 0.001 ? uBeamLight.z * beamSoftDisk(r / hole, uBeamShape.w) : 0.0;
  return max(outer - inner, 0.0);
}

// Screen height at the beam's depth of a point at world height y.
float beamScreenHeight(float y) { return uCamera.x + y * uCamera.y / uWorld.x; }

float hazeDensity(float e) {
  float floorE = beamScreenHeight(1.0);
  float top = uHazeA.y * exp(-max(e - uHazeA.w, 0.0) / max(uHazeA.z, 1e-3));
  if (uCeilingTop > 0.0 && e < uHazeA.w) {
    float t = (uHazeA.w - e) / uCeilingTop;
    top *= exp(-t * t);
  }
  float low = uHazeB.x * exp(-abs(floorE - e) / max(uHazeB.y, 1e-3));
  return uHazeA.x + top + low;
}

// Haze between the ceiling and screen height e (for the beam's loss on its way down).
float hazeAbove(float e) {
  float ec = uHazeA.w;
  if (e <= ec) return 0.0;
  float ef = beamScreenHeight(1.0);
  float ht = max(uHazeA.z, 1e-3);
  float hf = max(uHazeB.y, 1e-3);
  float ee = min(e, ef);
  float sum = uHazeA.x * (e - ec) + uHazeA.y * ht * (1.0 - exp(-(e - ec) / ht));
  sum += uHazeB.x * hf * (exp(-(ef - ee) / hf) - exp(-(ef - ec) / hf));
  return sum;
}

float hgPhase(float cosTheta, float g) {
  float k = 1.0 + g * g - 2.0 * g * cosTheta;
  return (1.0 - g * g) / (k * sqrt(k));
}

// Beam light scattered toward the camera along the view ray through screen point s, up to depth zFar.
// mirror = -1 gives the beam mirrored in the floor; widen blurs it (rough reflections).
float beamInScatter(vec2 s, float zNear, float zFar, float mirror, float widen, float densityNoise, int steps) {
  float F = uCamera.y;
  float zb = uWorld.x;
  float xb = uWorld.y;
  float a = uWorld.z;
  float ys = (s.y - uCamera.x) / F;
  float tx = uBeamShape.x;
  float tz = uBeamShape.y;
  // Where the ray is inside the beam's cylinder (radius R around the axis): offsets across and
  // in depth are linear in z, so their squared length is a quadratic in z.
  float aMax = a * (1.0 + abs(uBeamShape.z) * 2.0) + widen;
  float R = (2.2 + 2.0 / uBeamShape.w) * aMax;
  vec2 slope = vec2(s.x / F - tx * mirror * ys, 1.0 - tz * mirror * ys);
  vec2 start = vec2(tx * mirror - xb, tz * mirror - zb);
  float qa = dot(slope, slope);
  float qb = dot(start, slope);
  float qc = dot(start, start) - R * R;
  float disc = qb * qb - qa * qc;
  if (disc <= 0.0) return 0.0;
  float root = sqrt(disc);
  float z0 = max((-qb - root) / qa, zNear);
  float z1 = min((-qb + root) / qa, zFar);
  if (z1 <= z0) return 0.0;
  float zc = 0.5 * (z0 + z1);
  float dz = (z1 - z0) / float(steps);
  float sum = 0.0;
  for (int k = 0; k < BEAM_STEPS; k++) {
    if (k >= steps) break;
    float z = z0 + (float(k) + 0.5) * dz;
    float x = s.x * z / F;
    float y = 1.0 + mirror * (ys * z - 1.0);
    // Past its start the beam widens from a fifth of its width while its light comes up, so
    // it starts in a rounded tip instead of a flat cut across it.
    float started = smoothstep(uSource.x, uSource.y, y);
    float ah = a * max(0.05, 1.0 + uBeamShape.z * (y - 1.0)) * mix(0.2, 1.0, started);
    float aw = sqrt(ah * ah + widen * widen);
    vec2 axis = vec2(xb + tx * (y - 1.0), zb + tz * (y - 1.0));
    float r = length(vec2(x, z) - axis) / aw;
    sum += beamAperture(r) * (a * a) / (aw * aw) * hazeDensity(beamScreenHeight(y)) * started;
  }
  float e = beamScreenHeight(1.0 + mirror * (ys * zc - 1.0));
  vec3 dir = vec3(s.x, s.y - uCamera.x, F);
  float cosTheta = -dot(vec3(tx, mirror, tz), dir) / (length(vec3(tx, 1.0, tz)) * length(dir));
  float loss = exp(-uBeamLight.w * hazeAbove(e));
  return sum * dz * (length(dir) / F) * hgPhase(cosTheta, uHazeB.z) * loss * max(1.0 + densityNoise, 0.0) / a;
}

// Pool light scattered by the haze at screen offset d (x from the pool's center, y its
// distance from the pool: height above it, or depth in front of it, at the pool's scale).
// It falls off as 1/distance from the pool (the view ray's integral of 1/distance^2).
// Haze right over the pool is lit from below and is brightest at the pool; beside the pool
// the floor's light arrives at a grazing angle (Lambert cosine), and the stage's rim
// shadows it.
float poolGlow(vec2 d, float halfWidth, float core, float density) {
  float across = max(d.x - 0.8 * halfWidth, 0.0) / max(uBounce.z, 0.1);
  float h = sqrt(across * across + d.y * d.y + core * core);
  float lambert = (d.y + 0.25 * core) / (sqrt(across * across + d.y * d.y) + 0.25 * core);
  float rim = smoothstep(0.25 * uBounce.w, uBounce.w, (d.y + 0.05 * core) / (across + 1e-3));
  float side = exp(-across / max(uBounce.y, 1e-3));
  return uBounce.x * density * (core / h) * exp(-d.y / max(uBounce.y, 1e-3)) * side * lambert * rim;
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

// Distance of a floor point (world x, z) from the beam's axis across the beam, in beam radii,
// so a leaning beam's pool stretches along its lean.
float floorDistance(vec2 floorAt) {
  vec2 q = (floorAt - vec2(uWorld.y, uWorld.x)) / uWorld.z;
  float along = q.x * uBeamShape.x + q.y * uBeamShape.y;
  return sqrt(max(dot(q, q) - along * along / (1.0 + dot(uBeamShape.xy, uBeamShape.xy)), 0.0));
}

// The light the haze scatters onto the floor around the pool, at that distance.
float floorSpill(float d) {
  return uPool.y * exp(-0.5 * d * d / max(uPool.z * uPool.z, 1e-4));
}

vec3 radiance(vec2 uv, vec2 screen) {
  vec2 p = vec2(dot(screen, uTurn.xy), dot(screen, vec2(-uTurn.y, uTurn.x))) + uTurn.zw;
  float F = uCamera.y;
  float horizon = uCamera.x;
  float zb = uWorld.x;
  float xb = uWorld.y;
  float a = uWorld.z;
  float aScreen = a * F / zb;
  float contactY = horizon + F / zb;
  float lumHaze = max(luminance(uHazeColor), 1e-5);
  float lumLight = max(luminance(uLightColor), 1e-5);

  // The stage's back edge: a round stage, so the edge drops toward the sides.
  float ze0 = uWorld.w;
  float xe = p.x * ze0 / F;
  float ze = max(ze0 - (xe - xb) * (xe - xb) * uCamera.w / (2.0 * ze0), 0.2 * ze0);
  float edgeY = horizon + F / ze;
  float onFloor = p.y > horizon ? smoothstep(-uPool.w, uPool.w, p.y - edgeY) : 0.0;
  float zFloor = p.y > horizon ? F / (p.y - horizon) : 1e6;
  // The stage's edge is rounded: right past it the floor curves away, so it hides the light
  // behind the edge, gets the beam's light and mirrors the haze over a short distance
  // instead of all at once.
  float rounded = p.y > horizon ? smoothstep(-uPool.w, uPool.w + uEdge.x * aScreen, p.y - edgeY) : 0.0;

  float hazeHere = hazeDensity(p.y);

  // Haze density noise, in beam-relative coordinates at the beam's depth.
  float u = (p.x * zb / F - xb) / a;
  float noise = 0.0;
  if (uHazeB.w > 0.0 && abs(u) < 4.0 + 2.0 * abs(uBeamShape.x) * (1.0 + abs(p.y))) {
    noise = uHazeB.w * fbm(vec2(u * uHazeNoise.x + 11.3, p.y * uHazeNoise.y + 3.7), 2, uSeed);
  }

  // Beam: in front of the floor where the floor is, and over the edge into the pit behind it.
  // Across the rounded edge the two views blend, so the light seen past the edge fades out
  // over the whole edge instead of stopping where the floor is fully there.
  float beamSeen = rounded < 1.0 ? beamInScatter(p, 0.01, 1e6, 1.0, 0.0, noise, 10) : 0.0;
  if (rounded > 0.0) beamSeen = mix(beamSeen, beamInScatter(p, 0.01, zFloor, 1.0, 0.0, noise, 10), rounded);
  float scatter = uBeamLight.x * beamSeen;

  // The pool's light scattered by the haze around it. The pool is a flat emitter as wide as
  // the beam, so the glow is flat across it and falls off above and to the sides. Over the
  // floor the camera looks through the lit haze in front of the pool, so the glow runs on
  // past the stage edge and falls off below the pool as it does above it.
  float beamX = uWorld.y * F / zb;
  float core = 0.35 * aScreen;
  float below = p.y - contactY;
  float glow = poolGlow(vec2(abs(p.x - beamX), below > 0.0 ? below * uEdge.y : -below), aScreen, core, hazeHere);
  scatter += uBeamLight.x * glow;

  // Haze just over the floor is lit from below by the floor's spill under it, and over the
  // pit by the spill at the stage's edge, thinning upward over the floor haze's depth. So
  // beside the pool the light rises across the edge line and the pool's contact line
  // instead of stepping or creasing there.
  if (uEdgeHaze > 0.0) {
    float t = max(edgeY - p.y, 0.0) / max(uHazeB.y, 1e-3);
    vec2 under = p.y > edgeY ? vec2(p.x * zFloor / F, zFloor) : vec2(p.x * ze / F, ze);
    scatter += uBeamLight.x * uEdgeHaze * floorSpill(floorDistance(under)) / (1.0 + t * t);
  }

  float direct = 0.0;
  float floorLight = 0.0;
  if (onFloor > 0.0) {
    vec2 floorAt = vec2(p.x * zFloor / F, zFloor);
    float d = floorDistance(floorAt);
    // The pool: the beam's light per unit area on the floor. Its edge is softer than the
    // beam's (the penumbra widens with distance from the source), so it has no rim.
    float cosIn = 1.0 / length(vec3(uBeamShape.x, 1.0, uBeamShape.y));
    float hole = uBeamLight.y;
    float footEdge = min(uBeamShape.w, 2.2);
    float inner = hole > 0.001 ? uBeamLight.z * beamSoftDisk(d / hole, footEdge) : 0.0;
    float lit = max(beamSoftDisk(d, footEdge) - inner, 0.0) * cosIn;

    // Fine surface texture, faded out where its cells get smaller than about two samples.
    float cell = uFloorLook.w;
    float cellScreen = cell * F / zFloor;
    float texFade = smoothstep(1.5, 3.0, cellScreen / max(uPixel, 1e-6));
    float tex = texFade > 0.0 ? 1.0 + uFloorLook.z * texFade * valueNoise(floorAt / cell, uSeed + 77) : 1.0;

    // Rough glossy floor: it mirrors the lit haze above the landing spot, blurred more the
    // farther the reflected light travels, and reflects more at grazing angles (Fresnel).
    // Floor boards run toward the camera with slightly different gloss, so the reflection
    // breaks into lanes along them.
    float reflection = 0.0;
    if (uFloorLook.x > 0.0) {
      float travel = max(zb - zFloor, 0.0);
      float widen = uFloorLook.y * travel;
      float mirrored = beamInScatter(p, zFloor, 1e6, -1.0, widen, noise, 6);
      // Floor behind the pool (above its contact on screen) mirrors the glow at its own
      // distance from the pool, so the reflection fades away from the pool on both sides.
      vec2 m = vec2(p.x, 2.0 * contactY - p.y);
      float mBounce = uBeamLight.x * poolGlow(vec2(abs(m.x - beamX), abs(contactY - m.y)), aScreen, core + widen * F / zb, hazeDensity(m.y));
      vec3 view = normalize(vec3(p.x, p.y - horizon, F));
      float fresnel = 0.04 + 0.96 * pow(1.0 - view.y, 5.0);
      float lanes = 1.0;
      if (uLanes.x > 0.0) {
        // Gloss varies across the floor much faster than along it, and the lanes drift. Far
        // away, at grazing angles, every board reflects alike, so the lanes fade in below the
        // pool and no dull board starts at the pool line.
        vec2 l = floorAt / (uLanes.y * a);
        l.x += 0.35 * valueNoise(vec2(l.y * 0.08, 7.3), uSeed + 127);
        l.y *= 0.08;
        float n = 0.65 * valueNoise(l, uSeed + 131) + 0.35 * valueNoise(vec2(2.1 * l.x, 2.1 * l.y + 3.5), uSeed + 137);
        lanes = exp(uLanes.x * smoothstep(0.02, 0.3, travel / zb) * n);
      }
      reflection = uFloorLook.x * fresnel * lanes * (uBeamLight.x * mirrored + mBounce);
    }

    float spill = floorSpill(d);
    direct = rounded * uPool.x * uBeamLight.x * lit * tex;
    floorLight = rounded * (spill * uBeamLight.x + reflection) * tex;
  }
  scatter += floorLight;

  float lum = scatter * lumHaze;
  float pale = saturate(uPale.x * smoothstep(uPale.y, uPale.z, lum + direct * lumLight));
  vec3 paleColor = mix(uLightColor / lumLight, uPaleTarget, uPaleWhite) * lumHaze;
  vec3 scattered = scatter * warmFall(scatter) * mix(warmTail(scatter), paleColor, pale);
  vec3 directColor = mix(uLightColor, uPaleTarget * lumLight, uPaleWhite * pale);
  vec3 ambient = uBaseColor * mix(uAmbient.x * (1.0 - uAmbient.y + uAmbient.y * hazeHere), uAmbient.z, onFloor);
  vec3 color = ambient + scattered + directColor * direct;

  vec2 half_ = 0.5 * uFrameAspect;
  float vig = 1.0 - uVignette * dot(screen, screen) / dot(half_, half_);
  return color * max(vig, 0.0);
}
`

/** Luminance one unit of scattered light should have, whatever the pack's haze color. */
const HAZE_LUMINANCE = 0.12

/** Share of its clipping level one unit of a warm light's scattered light reaches. */
const WARM_SHARE = 0.9

/**
 * Warm haze dimmer than this share of its clipping level falls toward black faster, and
 * Lime's starts toward Forest's deep green.
 */
const TAIL_BELOW = 0.6

/** How much faster that dim warm haze falls. */
const TAIL_FALL = 2.5

/**
 * Haze over the stage's edge, as a share of the floor's spill under it: with black walls
 * beside the beam, the floor's light would otherwise step up at the edge line.
 */
const EDGE_HAZE = 1

/**
 * Stage edges at least this soft (short-side units) survive half-resolution radiance in a
 * 1x preview; crisper edges (the beam-pool reference's flare line) keep full resolution.
 */
const HALF_SCALE_EDGE = 0.012

/**
 * Pack output. A wide, nearly parallel beam lands on the stage's edge and is seen
 * from a low camera, so its pool is a bright line as wide as the beam. The glossy
 * floor mirrors the lit haze above the pool, and its narrow boards, each a little
 * more or less glossy, split that into rays fanning toward the camera. The haze is
 * lit only near the beam.
 *
 * The seed lays out the scene: where the beam stands, its lean and width, how much it
 * narrows toward the source, the floor's height, and whether it lands on the stage's
 * edge (a pool line) or in front of it (an oval pool). It also picks the light, the
 * hollow, the camera, the haze layers and the floor's gloss and lanes. Light (the mood
 * control) moves the beam across the frame from the seed's place, and a dragged line puts
 * the beam on the line instead (beamOnLine); Intensity is the source's power; Softness
 * softens the beam's edge, the haze and the floor.
 */
function composeBeam({ pack, controls, seed, aspect }: ComposeInput): Composition {
  const random = seededRandom(seed, 0xbea)
  const { intensity, softness, mood } = controls
  const { halfW, halfH } = frameHalf(aspect)
  const wide = aspect >= 1
  const light = pickContourLight(pack, seed, random)
  const hazeGain = hazeGainFor(light, HAZE_LUMINANCE, WARM_SHARE)
  const soft = (lo: number, hi: number) => lerp(lo, hi, softness)

  // The seed's layout: left or right of the middle, upright or leaning, narrow or wide, a
  // column or a cone (seedLayout, so seeds 1-8 differ in at least two of these); the
  // floor's height and the pool's kind spread over their ranges (seedShares).
  const [onRight, leaning, broad, cone] = seedLayout(pack, seed, 0xbea)
  const [floorShare, poolShare] = seedShares(seed, 0xbea, 2, random)
  const either = (choice: number, lo: [number, number], hi: [number, number]) => (choice ? lerp(hi[0], hi[1], random()) : lerp(lo[0], lo[1], random()))
  const edgeAt = wide ? lerp(0.52, 0.82, floorShare) : lerp(0.56, 0.84, floorShare)
  const floorY = -halfH + 2 * halfH * edgeAt
  const drop = lerp(0.14, 0.34, random())
  const horizon = floorY - drop
  const focal = lerp(1.15, 1.6, random())
  const width = either(broad, [0.08, 0.13], [0.2, 0.28])
  // Light moves the beam across a range around the seed's own place that stays inside
  // 0.08..0.92 of the frame, so it keeps moving up to both ends of the slider.
  const center = wide ? either(onRight, [0.18, 0.34], [0.66, 0.82]) : either(onRight, [0.26, 0.38], [0.62, 0.74])
  const reach = Math.min(wide ? 0.3 : 0.2, 0.92 - center, center - 0.08)
  const side = controls.drag ? center : center + (mood - 0.5) * 2 * reach
  const beamAt = (side - 0.5) * 2 * halfW
  // Upright, or leaning 16 to 25 degrees either way.
  const lean = leaning ? (random() < 0.5 ? -1 : 1) * lerp(0.45, 0.7, random()) : lerp(-0.06, 0.06, random())
  const tilt = [lean, lerp(-0.04, 0.04, random())]
  // Half the seeds land the beam on the stage's edge, so its pool is a line as wide as the
  // beam; the rest land it on the floor in front of the edge, an oval pool between the edge
  // and 0.9 of the frame's height. `landing` is that depth as the stage uses it (beamWorld).
  let landing = lerp(-0.15, 0.1, Math.min(1, poolShare * 2))
  if (poolShare >= 0.5) {
    const poolAt = lerp(edgeAt + 0.05, Math.min(0.9, edgeAt + 0.2), poolShare * 2 - 1)
    const k = 1 - (-halfH + 2 * halfH * poolAt - horizon) / drop
    landing = (k * focal) / width
  }

  const power = geo(intensity, 0.35, 0.75, 1.6) * hazeGain * lerp(0.9, 1.1, random())
  // Warm light already sits near nominal over the whole beam, so its pool is less hot.
  const pool = lerp(6, 8.5, random()) * (luminanceOf(light.haze) / Math.max(luminanceOf(light.light), 0.01)) * (light.toe > 0 ? 0.5 : 1)

  const params: Record<string, ParamValue> = {
    horizon: round4(horizon),
    focal: round4(focal),
    floorY: round4(floorY),
    stageRound: round4(lerp(0.4, 0.9, random())),
    beamAt: round4(beamAt),
    beamWidth: round4(width * soft(0.95, 1.05)),
    landing: round4(landing),
    tilt: tilt.map(round4),
    // A nearly parallel column, or a cone that narrows toward the source.
    spread: round4(either(cone, [-0.04, 0.03], [0.2, 0.3])),
    beamEdge: round4(soft(3.6, 2.2)),
    hollow: [round4(lerp(0.42, 0.58, random())), round4(lerp(0.35, 0.6, random()))],
    power: round4(Math.min(20, power)),
    extinction: round4(lerp(0, 0.25, random())),
    haze: round4(lerp(0.03, 0.045, random())),
    ceiling: [round4(lerp(1, 1.5, random())), round4(lerp(0.12, 0.2, random())), round4(-halfH - lerp(0, 0.1, random()))],
    floorHaze: [round4(lerp(2.6, 3.8, random())), round4(lerp(0.12, 0.2, random()))],
    forward: round4(lerp(-0.1, 0.15, random())),
    hazeNoise: [round4(lerp(0.08, 0.15, random())), round4(lerp(2, 3, random())), round4(lerp(0.6, 1.1, random()))],
    bounce: [round4(lerp(0.7, 1, random())), round4(soft(0.5, 0.8) * Math.min(1, 0.5 + halfH)), round4(lerp(1, 1.4, random())), round4(lerp(0.12, 0.2, random()))],
    pool: [round4(Math.min(10, pool)), round4(lerp(1.3, 2, random())), round4(soft(1.4, 1.9))],
    edgeSoftness: round4(soft(HALF_SCALE_EDGE, 0.024)),
    edgeHaze: EDGE_HAZE,
    gloss: [round4(lerp(2.8, 3.4, random())), round4(soft(0.22, 0.32))],
    texture: [0.05, 0.006],
    lanes: [round4(lerp(1.5, 1.9, random())), round4(lerp(0.4, 0.6, random()))],
    // The color starts toward white from 0.4 of the haze's clipping level and is there by
    // 1.3 times it, so light passing nominal keeps whitening at the same pace.
    pale: [round4(lerp(0.5, 0.7, random())), round4(0.4 * clipLuminanceOf(light.haze)), round4(1.3 * clipLuminanceOf(light.haze))],
    paleWhite: light.light === light.haze ? 0.5 : 0.2,
    ...tailParams(light, TAIL_BELOW),
    fall: fallParam(light, TAIL_BELOW, TAIL_FALL),
    ambient: [light.baseLevel, 0, light.baseLevel],
    vignette: round4(lerp(0.1, 0.18, random())),
  }
  if (controls.drag) Object.assign(params, beamOnLine(params, lineInShorts(controls.drag, aspect), halfH))

  return {
    colors: [light.light, light.haze, light.base],
    params,
    lens: { bloom: round4(soft(0.04, 0.07)), bloomLevels: [1, 0.6, 0.3, 0.15, 0.1, 0.05, 0, 0], halation: 0 },
    output: { grain: 0, toe: light.toe },
  }
}

/**
 * Most a dragged line leans the beam, in radians on screen (about as far as the seeds lean
 * it); the stage turns for the rest of the line's angle.
 */
const LEAN_MOST = 0.7

/**
 * The stage for a dragged line: the beam starts at the line's start and lands at its end, with
 * its pool there. A line near straight down leans the beam; for the rest of its angle the whole
 * stage turns about the pool, all the way round, so a line pointing up gives a beam rising to a
 * pool overhead. The lean eases back to upright as the line turns to point straight up, so
 * turning the line never flips the beam from one side to the other. The beam comes out of the
 * dark at the start, under the ceiling haze, which thins out above it; the longer the line, the
 * longer the beam takes to reach all its light.
 */
function beamOnLine(params: Record<string, ParamValue>, line: ShortLine, halfH: number): Record<string, ParamValue> {
  const num = (key: string) => params[key] as number
  const horizon = num('horizon')
  const focal = num('focal')
  const edgeY = Math.max(num('floorY'), horizon + 0.01)
  const k = Math.min(0.9, (num('landing') * num('beamWidth')) / focal)
  const landingZ = focal / (edgeY - horizon) / (1 - k)
  const landingX = (num('beamAt') * landingZ) / focal
  const pool: [number, number] = [num('beamAt'), horizon + (edgeY - horizon) * (1 - k)]
  const tiltZ = (params.tilt as number[])[1]
  // The line's angle from straight down, positive toward -x, and the beam's direction on the
  // unturned stage (toward the pool) for the lean it takes of it.
  const fromDown = wrapAngle(line.angle - Math.PI / 2)
  const lean = LEAN_MOST * Math.tanh(Math.sin(fromDown) / LEAN_MOST)
  const down = Math.cos(lean)
  const tiltX = (-Math.tan(lean) * (landingZ - tiltZ) + landingX * tiltZ) / landingZ
  // Screen heights of the beam's start and of where it has all its light, and the world
  // height on the beam's axis at a screen height.
  const start = pool[1] - line.length * down
  const full = start + (0.03 + 0.25 * line.length) * down
  const heightAt = (e: number) => Math.min(2, Math.max(-50, ((e - horizon) * (landingZ - tiltZ)) / (focal - (e - horizon) * tiltZ)))
  const startHeight = round4(heightAt(start))
  const ceiling = params.ceiling as number[]
  return {
    tilt: [round4(Math.min(1, Math.max(-1, tiltX))), tiltZ],
    ceiling: [ceiling[0], ceiling[1], round4(Math.min(4, Math.max(-2, start + halfH + ceiling[2])))],
    ceilingTop: ceiling[1],
    turn: turnParam(fromDown - lean, line.to, pool),
    source: [startHeight, round4(Math.max(heightAt(full), startHeight + 0.001))],
  }
}

/** World quantities derived once per frame from the screen-space params. */
export function beamWorld(ctx: Pick<RecipeContext, 'num'>): { landingZ: number; landingX: number; radius: number; edgeZ: number } {
  const horizon = ctx.num('horizon')
  const focal = ctx.num('focal')
  const edgeY = Math.max(ctx.num('floorY'), horizon + 0.01)
  const width = ctx.num('beamWidth')
  const landing = ctx.num('landing')
  const edgeZ = focal / (edgeY - horizon)
  const k = Math.min(0.9, landing * (width / focal))
  const landingZ = edgeZ / (1 - k)
  return { landingZ, landingX: (ctx.num('beamAt') * landingZ) / focal, radius: (width * landingZ) / focal, edgeZ }
}

export const contourBeam: RecipeDefinition = {
  id: 'contour.beam',
  mood: 'contour',
  label: 'Beam',
  colorSlots: [
    { key: 'light', label: 'Light' },
    { key: 'haze', label: 'Haze' },
    { key: 'base', label: 'Base' },
  ],
  defaultColors: ['#C6E4F8', '#366685', '#00040B'],
  params: [
    { kind: 'number', key: 'horizon', label: 'Horizon', min: -1.5, max: 1.5, step: 0.005, default: 0.1 },
    { kind: 'number', key: 'focal', label: 'Focal length', min: 0.3, max: 4, step: 0.01, default: 1.2 },
    { kind: 'number', key: 'floorY', label: 'Stage edge', min: -1.5, max: 1.5, step: 0.005, default: 0.22 },
    { kind: 'number', key: 'stageRound', label: 'Stage roundness', min: 0, max: 6, step: 0.01, default: 1 },
    { kind: 'number', key: 'beamAt', label: 'Beam', min: -1.5, max: 1.5, step: 0.005, default: 0 },
    { kind: 'number', key: 'beamWidth', label: 'Beam width', min: 0.01, max: 0.6, step: 0.005, default: 0.12 },
    { kind: 'number', key: 'landing', label: 'Landing', min: -30, max: 4, step: 0.01, default: 0 },
    { kind: 'vector', key: 'tilt', label: 'Tilt', min: -1, max: 1, step: 0.005, default: [0, 0] },
    { kind: 'number', key: 'spread', label: 'Spread', min: -1, max: 1, step: 0.005, default: 0 },
    { kind: 'number', key: 'beamEdge', label: 'Beam edge', min: 1.2, max: 10, step: 0.05, default: 3 },
    { kind: 'vector', key: 'hollow', label: 'Hollow', min: 0, max: 0.95, step: 0.005, default: [0, 0] },
    { kind: 'number', key: 'power', label: 'Power', min: 0, max: 20, step: 0.01, default: 1 },
    { kind: 'number', key: 'extinction', label: 'Extinction', min: 0, max: 5, step: 0.01, default: 0 },
    { kind: 'number', key: 'haze', label: 'Haze', min: 0, max: 4, step: 0.005, default: 0.05 },
    { kind: 'vector', key: 'ceiling', label: 'Ceiling haze', min: -2, max: 4, step: 0.005, default: [1, 0.2, -0.6] },
    { kind: 'vector', key: 'floorHaze', label: 'Floor haze', min: 0, max: 6, step: 0.005, default: [2, 0.15] },
    { kind: 'number', key: 'forward', label: 'Forward scattering', min: -0.9, max: 0.9, step: 0.005, default: 0.3 },
    { kind: 'vector', key: 'hazeNoise', label: 'Haze noise', min: 0, max: 12, step: 0.005, default: [0.12, 2.5, 1.6] },
    { kind: 'vector', key: 'bounce', label: 'Bounce', min: 0, max: 4, step: 0.005, default: [1, 0.08, 2, 0.12] },
    { kind: 'vector', key: 'pool', label: 'Pool', min: 0, max: 10, step: 0.005, default: [1.5, 0.3, 1.6] },
    { kind: 'number', key: 'edgeSoftness', label: 'Edge softness', min: 0, max: 0.1, step: 0.0005, default: 0.01 },
    { kind: 'vector', key: 'edgeLight', label: 'Light at the edge', min: 0, max: 6, step: 0.005, default: [0.18, 1] },
    { kind: 'number', key: 'edgeHaze', label: 'Haze over the edge', min: 0, max: 4, step: 0.005, default: 0 },
    { kind: 'vector', key: 'lanes', label: 'Floor lanes', min: 0, max: 4, step: 0.005, default: [0.6, 0.3] },
    { kind: 'vector', key: 'gloss', label: 'Gloss', min: 0, max: 4, step: 0.005, default: [1, 0.1] },
    { kind: 'vector', key: 'texture', label: 'Floor texture', min: 0, max: 0.3, step: 0.0005, default: [0.04, 0.004] },
    { kind: 'vector', key: 'pale', label: 'Pale', min: 0, max: 2, step: 0.005, default: [0, 0.1, 0.6] },
    { kind: 'number', key: 'paleWhite', label: 'Pale toward white', min: 0, max: 1, step: 0.005, default: 0 },
    { kind: 'vector', key: 'tail', label: 'Dim haze color', min: 0, max: 2, step: 0.0005, default: [1, 1, 1, 0] },
    { kind: 'vector', key: 'tailEnd', label: 'Faint haze color', min: 0, max: 1, step: 0.0005, default: [1, 1, 1] },
    { kind: 'vector', key: 'fall', label: 'Dim haze falloff', min: 0, max: 8, step: 0.005, default: [0, 1] },
    { kind: 'vector', key: 'ambient', label: 'Ambient', min: 0, max: 4, step: 0.005, default: [1, 0.3, 1] },
    { kind: 'number', key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.005, default: 0.1 },
    { kind: 'vector', key: 'turn', label: 'Turn', min: -8, max: 8, step: 0.0005, default: [1, 0, 0, 0] },
    { kind: 'vector', key: 'source', label: 'Beam start', min: -50, max: 2, step: 0.005, default: [-50, -49] },
    { kind: 'number', key: 'ceilingTop', label: 'Ceiling haze above', min: 0, max: 1, step: 0.005, default: 0 },
  ],
  fragment: BEAM_GLSL,
  uniforms: (ctx) => {
    const world = beamWorld(ctx)
    const tilt = ctx.vec('tilt')
    const hollow = ctx.vec('hollow')
    const ceiling = ctx.vec('ceiling')
    const floorHaze = ctx.vec('floorHaze')
    const noise = ctx.vec('hazeNoise')
    const pool = ctx.vec('pool')
    return {
      uLightColor: ctx.color('light'),
      uHazeColor: ctx.color('haze'),
      uBaseColor: ctx.color('base'),
      uCamera: [ctx.num('horizon'), ctx.num('focal'), ctx.num('floorY'), ctx.num('stageRound')],
      uWorld: [world.landingZ, world.landingX, world.radius, world.edgeZ],
      uBeamShape: [tilt[0], tilt[1], ctx.num('spread'), ctx.num('beamEdge')],
      uBeamLight: [ctx.num('power'), hollow[0], hollow[1], ctx.num('extinction')],
      uHazeA: [ctx.num('haze'), ceiling[0], ceiling[1], ceiling[2]],
      uHazeB: [floorHaze[0], floorHaze[1], ctx.num('forward'), noise[0]],
      uHazeNoise: [noise[1], noise[2]],
      uBounce: ctx.vec('bounce'),
      uPool: [pool[0], pool[1], pool[2], ctx.num('edgeSoftness')],
      uLanes: ctx.vec('lanes'),
      uFloorLook: [...ctx.vec('gloss'), ...ctx.vec('texture')],
      uPale: ctx.vec('pale'),
      uPaleWhite: ctx.num('paleWhite'),
      uPaleTarget: paleTarget(ctx.color('light')),
      uEdge: ctx.vec('edgeLight'),
      uEdgeHaze: ctx.num('edgeHaze'),
      uTail: tailUniform(ctx.vec('tail')),
      uTailEnd: tailEndUniform(ctx.vec('tailEnd')),
      uFall: ctx.vec('fall'),
      uAmbient: ctx.vec('ambient'),
      uVignette: ctx.num('vignette'),
      uTurn: ctx.vec('turn'),
      uSource: ctx.vec('source'),
      uCeilingTop: ctx.num('ceilingTop'),
    }
  },
  radianceScale: (ctx) => (ctx.num('edgeSoftness') >= HALF_SCALE_EDGE ? 0.5 : 1),
  lens: { bloom: 0.04, bloomLevels: [1, 0.6, 0.3, 0.15, 0, 0, 0, 0], halation: 0 },
  fromPack: (pack: ColorPack) => {
    const { light, haze, base } = contourLights(pack)[0]
    return [light, haze, base]
  },
  compose: composeBeam,
}
