import type { ColorPack } from '../../color/packs'
import type { ComposeInput, Composition, ParamValue, RecipeContext, RecipeDefinition } from '../../scene'
import {
  AIR_GLOW_GLSL,
  airGlowParams,
  clipLuminanceOf,
  type ContourLight,
  contourLights,
  darkMatches,
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
  smoothstep,
  spreadOutside,
  tailEndUniform,
  tailParams,
  tailUniform,
  turnParam,
  UNVEILED_PALE,
  VEIL_TINT,
  veiled,
  veilParam,
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
uniform vec2 uLaneShape;  // floor gloss lanes: weight of the finer, blotchier lanes, how fast a lane changes along its length
uniform vec4 uVeil;       // a cool light's haze: chroma share (1: full color), level of the most color (share of the clipping luminance), band width (octaves), dark haze luminance
uniform vec4 uDarkMeet;   // over a dark of another hue: light level its faint tail falls off below (from, to), level the dark is gone by (from, to); 0: off
uniform float uVeilTint;  // a cool light's least chroma along its haze's hue, over Oklab lightness (0: off)
uniform float uVeilBand;  // how much more chroma the veil keeps in its band of levels (1: twice the share)
uniform vec4 uAirGlow;    // a light outside the frame: level of its glow in the air (scattered units; 0: off), falloff, sharpness (power), scale (1 at the frame's brightest point)
uniform vec4 uGlowLine;   // where that light is: its segment on screen (unturned)
uniform float uBeamHaze;  // share of the beam's light its haze scatters, over the seed's own (1)
uniform vec2 uHalo;       // the beam's light the haze scatters around it: share of the beam's light, how much wider (screen, short-side units)
uniform float uGlowCore;  // least size of the pool's glow in the haze (screen, short-side units; 0: the beam's own)
uniform vec4 uMouth;      // a hanging lamp's mouth glowing in the haze around it: level (share of the beam's light; 0: none), core (screen), where it is (screen, unturned)
${AIR_GLOW_GLSL}
const int BEAM_STEPS = 16;
const float MOUTH_REACH = 0.12; // how far (screen, short-side units) a hanging lamp's halo carries through the haze

float beamSoftDisk(float r, float k) { return exp(-0.5 * pow(max(r, 0.0), k)); }

// Beam light per unit area at radius r (in beam radii) from the axis, with edge exponent k.
float beamAperture(float r, float k) {
  float outer = beamSoftDisk(r, k);
  float hole = uBeamLight.y;
  float inner = hole > 0.001 ? uBeamLight.z * beamSoftDisk(r / hole, k) : 0.0;
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
    // it starts in a rounded tip instead of a flat cut across it. The tip carries the light
    // per area of the beam's own width there, and its edge is soft until the light is all
    // there, so it comes out of the haze instead of a bright cap with a hard outline.
    float started = smoothstep(uSource.x, uSource.y, y);
    float width = a * max(0.05, 1.0 + uBeamShape.z * (y - 1.0));
    float ah = width * mix(0.2, 1.0, started);
    float aw = sqrt(ah * ah + widen * widen);
    float flow = width * width + widen * widen;
    vec2 axis = vec2(xb + tx * (y - 1.0), zb + tz * (y - 1.0));
    float r = length(vec2(x, z) - axis) / aw;
    sum += beamAperture(r, mix(2.0, uBeamShape.w, started * started)) * (a * a) / flow * hazeDensity(beamScreenHeight(y)) * started;
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
  // Light the haze scatters out of the beam lights the haze around it: the same light spread
  // over a wider beam, added to the beam's own, so a narrow beam keeps its core and gets soft,
  // lit sides instead of reading as a stroke.
  if (uHalo.x > 0.0) {
    float widen = uHalo.y * zb / F;
    float halo = rounded < 1.0 ? beamInScatter(p, 0.01, 1e6, 1.0, widen, noise, 8) : 0.0;
    if (rounded > 0.0) halo = mix(halo, beamInScatter(p, 0.01, zFloor, 1.0, widen, noise, 8), rounded);
    beamSeen += uHalo.x * halo;
  }
  float scatter = uBeamLight.x * uBeamHaze * beamSeen;

  // The pool's light scattered by the haze around it. The pool is a flat emitter as wide as
  // the beam, so the glow is flat across it and falls off above and to the sides. Over the
  // floor the camera looks through the lit haze in front of the pool, so the glow runs on
  // past the stage edge and falls off below the pool as it does above it.
  float beamX = uWorld.y * F / zb;
  float core = max(0.35 * aScreen, uGlowCore);
  float below = p.y - contactY;
  float glow = poolGlow(vec2(abs(p.x - beamX), below > 0.0 ? below * uEdge.y : -below), aScreen, core, hazeHere);
  scatter += uBeamLight.x * glow;
  // A hanging lamp's mouth: a small source, the brightest point, whose light the haze around it
  // scatters as a soft halo (1 / distance past a small core), lost in the haze over a short way,
  // so the cone comes out of it and the rest of the room stays dark.
  if (uMouth.x > 0.0) {
    float d = length(screen - uMouth.zw);
    scatter += uBeamLight.x * uMouth.x * uMouth.y / (uMouth.y + d) * exp(-d / MOUTH_REACH);
  }

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
        l.x += 0.35 * valueNoise(vec2(l.y * uLaneShape.y, 7.3), uSeed + 127);
        l.y *= uLaneShape.y;
        float n = (1.0 - uLaneShape.x) * valueNoise(l, uSeed + 131) + uLaneShape.x * valueNoise(vec2(2.1 * l.x, 2.1 * l.y + 3.5), uSeed + 137);
        lanes = exp(uLanes.x * smoothstep(0.02, 0.3, travel / zb) * n);
      }
      reflection = uFloorLook.x * fresnel * lanes * (uBeamLight.x * mirrored + mBounce);
    }

    float spill = floorSpill(d);
    direct = rounded * uPool.x * uBeamLight.x * lit * tex;
    floorLight = rounded * (spill * uBeamLight.x + reflection) * tex;
  }
  scatter += floorLight;
  if (uAirGlow.x > 0.0) scatter += uAirGlow.x * pow(uAirGlow.w * airGlow(screen, uGlowLine, uAirGlow.y), uAirGlow.z);

  float lum = scatter * lumHaze;
  float pale = saturate(uPale.x * smoothstep(uPale.y, uPale.z, lum + direct * lumLight));
  vec3 paleColor = mix(uLightColor / lumLight, uPaleTarget, uPaleWhite) * lumHaze;
  // Warm lights are their own haze, so their pool dims along the haze's path too, by all the
  // light at the pixel: the pool's soft edge drifts and falls off like the haze around it
  // instead of showing the light's own color dimmed (grey-brown for Tan).
  float level = scatter + direct * lumLight / lumHaze;
  float fall = warmFall(level);
  vec3 tail = warmTail(level);
  vec3 path = mix(tail, paleColor, pale);
  // Over a dark of another hue (Meta Blue over Plum) the light and the dark both dim toward
  // black before they meet: the dark fades out where the light is, and the light's faint tail
  // falls off faster, so they never blend into a third color over a wide fade.
  float meet = 1.0;
  float darkShows = 1.0;
  if (uDarkMeet.y > 0.0) {
    meet = smoothstep(uDarkMeet.x, uDarkMeet.y, level);
    darkShows = 1.0 - smoothstep(uDarkMeet.z, uDarkMeet.w, level);
  }
  vec3 scattered = scatter * fall * meet * path;
  vec3 ownColor = uTail.w > 0.0 ? fall * tail * (lumLight / lumHaze) : uLightColor;
  vec3 directColor = mix(ownColor, uPaleTarget * lumLight, uPaleWhite * pale);
  vec3 ambient = uBaseColor * darkShows * mix(uAmbient.x * (1.0 - uAmbient.y + uAmbient.y * hazeHere), uAmbient.z, onFloor);
  // A cool light is a pale veil of its color: its haze and its pool alike, the pale core too,
  // keep only a share of their chroma at the same Oklab lightness and hue (more in a band of
  // levels, by uVeilBand); its darks are a faint blue-black haze, not black.
  vec3 lit = scattered + directColor * direct;
  if (uTail.w <= 0.0 && uVeil.x < 1.0) {
    float clip = lumHaze / max(max(uHazeColor.r, uHazeColor.g), uHazeColor.b);
    float octaves = log2(max(level * lumHaze, 1e-6) / (uVeil.y * clip)) / max(uVeil.z, 0.05);
    vec3 lab = linearToOklab(max(lit, vec3(0.0)));
    lit = max(oklabToLinear(vec3(lab.x, lab.yz * min(1.0, uVeil.x * (1.0 + uVeilBand * exp(-0.5 * octaves * octaves))))), vec3(0.0));
  }
  vec3 color = ambient + lit + uVeil.w * uHazeColor / lumHaze;
  // A cool light's pale light keeps its haze's hue, as the moodboard's white pool does: most
  // just around the core, less in the white core itself, and never more than half the haze's
  // own chroma for its lightness (a grey haze such as Steel stays grey). A neutral white or
  // grey beside the blue haze would read warm (an orange-brown ring) by contrast. Only what
  // falls short of that along the hue is added.
  if (uVeilTint > 0.0) {
    vec3 lab = linearToOklab(max(color, vec3(0.0)));
    vec3 hazeLab = linearToOklab(uHazeColor);
    vec2 hue = normalize(hazeLab.yz);
    float trace = min(uVeilTint, 0.5 * length(hazeLab.yz) / max(hazeLab.x, 1e-4));
    float least = trace * lab.x * mix(1.0, 0.4, smoothstep(0.8, 1.0, lab.x));
    lab.yz += hue * max(0.0, least - dot(lab.yz, hue));
    color = max(oklabToLinear(lab), vec3(0.0));
  }

  vec2 half_ = 0.5 * uFrameAspect;
  float vig = 1.0 - uVignette * dot(screen, screen) / dot(half_, half_);
  return color * max(vig, 0.0);
}
`

/** Luminance one unit of scattered light should have, whatever the pack's haze color. */
const HAZE_LUMINANCE = 0.12

/**
 * Share of its clipping level one unit of a warm light's scattered light reaches: low enough
 * that the dense haze near the floor stays the light's own color instead of a wide white area.
 */
const WARM_SHARE = 0.65

/** Warm haze dimmer than this share of its clipping level falls toward black faster. */
const TAIL_BELOW = 0.6

/** How the beam's light in its haze grows with a dragged line's length past one short side (a power of it). */
const BEAM_HAZE_GROWTH = 0.3

/**
 * Warm haze dimmer than this share of its clipping level starts toward its tail colors (Yellow
 * toward Orange-red, Lime toward Forest's deep green), so the beam's dimmer haze has turned before
 * it would read olive (dim Lime at Lime's hue) or dark gold.
 */
const TAIL_FROM = 0.85

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

/** Screen radius of a narrow beam; broader beams keep floor boards about this wide. */
const NARROW_WIDTH = 0.11

/**
 * A narrow beam's light the haze scatters around it, as a share of the beam's own light, and how
 * much wider that light spreads (screen, short-side units, added to the beam's radius in
 * quadrature): two to three times a narrow beam's radius, so it gets soft sides. A broad beam
 * already lights a wide stretch of haze.
 */
const HALO = [0.3, 0.3]

/**
 * Least size (screen, short-side units) of the glow a pool lights in the haze around it: a
 * medium beam's. How far the pool's light reaches is the room's haze, not the beam's width, so a
 * narrow beam's pool lights the haze and floor around it instead of ending in a small bright head.
 */
const GLOW_CORE = 0.056

/** Least reach (screen, short-side units) of the pool's light the haze spills onto the floor: a broad beam's. */
const SPILL_REACH = 0.22

/**
 * Share of the floor haze a warm light's beam gets, and (halved pale mix) so its bright base
 * and pool stay the light's own warm color instead of a wide white area (Tan).
 */
const WARM_FLOOR_HAZE = 0.45

/** Share of the floor's own light (pool, spill, reflection; the pool's glow gets its root) a warm light gets. */
const WARM_FLOOR_LIGHT = 0.4

/**
 * Oklab chroma over lightness of a cool beam's haze, as in the beam-pool example (chroma
 * about 0.06 at lightness 0.4 to 0.8, 0.04 at 0.2 to 0.4).
 */
const BEAM_VEIL_CHROMA = 0.115

/**
 * The `pale` param for a light, given the seed's share (drawn whatever the light, so the seed's
 * later numbers stay in place). The color starts toward the pale color from 0.4 of the haze's
 * clipping level, by the seed's share (half of it for a warm light), and is there by 1.3 times
 * it, so light passing nominal keeps whitening at the same pace. A cool light over a dark that
 * matches it starts at 0.3 and goes all the way, or UNVEILED_PALE of the way if it keeps its
 * full color.
 */
function paleParam(light: ContourLight, share: number): number[] {
  const clip = clipLuminanceOf(light.haze)
  if (!light.tail && darkMatches(light)) return [veiled(light) ? 1 : UNVEILED_PALE, round4(0.3 * clip), round4(1.3 * clip)]
  return [round4(share * (light.tail ? 0.5 : 1)), round4(0.4 * clip), round4(1.3 * clip)]
}

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
  // What else the seed's scene shows, from its own stream so the rest of each seed stays as it
  // was: the lamp hanging in the frame, so the beam starts inside it; the stage's edge high, so
  // the pool lands mid-frame with a wide floor in front of it; or neither.
  const stage = seededRandom(seed, 0xbeb)
  const [kind] = seedShares(seed, 0xbeb, 1, stage)
  // A dragged line places the beam itself, on the seed's usual stage. Only a narrow beam hangs,
  // as a cone from its lamp (a broad column starting in mid-air reads as a dome); a broad one
  // in its place has the high edge instead.
  const hanging = !controls.drag && kind < HANGING_SHARE && !broad
  const highEdge = !controls.drag && !hanging && kind < HANGING_SHARE + HIGH_EDGE_SHARE
  const either = (choice: number, lo: [number, number], hi: [number, number]) => (choice ? lerp(hi[0], hi[1], random()) : lerp(lo[0], lo[1], random()))
  let edgeAt = highEdge ? lerp(0.4, 0.5, floorShare) : wide ? lerp(0.52, 0.82, floorShare) : lerp(0.56, 0.84, floorShare)
  // A broad beam that would land in front of the edge lands on it instead, with the edge moved
  // down to where its oval pool would have been, so the pool's height still spreads over seeds.
  if (broad && poolShare >= 0.5) edgeAt = lerp(edgeAt + 0.05, Math.min(0.9, edgeAt + 0.2), poolShare * 2 - 1)
  const floorY = -halfH + 2 * halfH * edgeAt
  const drop = lerp(0.14, 0.34, random())
  const horizon = floorY - drop
  const focal = lerp(1.15, 1.6, random())
  const width = either(broad, [0.08, 0.13], [0.2, 0.28])
  // Light moves the beam across a range around the seed's own place that stays inside
  // 0.08..0.92 of the frame, so it keeps moving up to both ends of the slider. A broad beam is
  // never a cone, so its cone choice stands it near the frame's middle instead of its side.
  const nearMiddle = broad && cone
  const center = wide
    ? either(onRight, nearMiddle ? [0.36, 0.44] : [0.18, 0.34], nearMiddle ? [0.56, 0.64] : [0.66, 0.82])
    : either(onRight, nearMiddle ? [0.4, 0.46] : [0.26, 0.38], nearMiddle ? [0.54, 0.6] : [0.62, 0.74])
  const reach = Math.min(wide ? 0.3 : 0.2, 0.92 - center, center - 0.08)
  const side = controls.drag ? center : center + (mood - 0.5) * 2 * reach
  const beamAt = (side - 0.5) * 2 * halfW
  // Upright, or leaning 16 to 25 degrees either way.
  const lean = leaning ? (random() < 0.5 ? -1 : 1) * lerp(0.45, 0.7, random()) : lerp(-0.06, 0.06, random())
  const tilt = [lean, lerp(-0.04, 0.04, random())]
  // Every broad beam and half the narrow ones land on the stage's edge, so the pool is a thin
  // bright line as wide as the beam with the floor's rays fanning from it; the other narrow
  // ones land on the floor in front of the edge, an oval pool between the edge and 0.9 of the
  // frame's height (a broad oval fills the floor). `landing` is that depth as the stage uses
  // it (beamWorld).
  let landing = lerp(-0.15, 0.1, Math.min(1, poolShare * 2))
  if (poolShare >= 0.5 && !broad) {
    const poolAt = lerp(edgeAt + 0.05, Math.min(0.9, edgeAt + 0.2), poolShare * 2 - 1)
    const k = 1 - (-halfH + 2 * halfH * poolAt - horizon) / drop
    landing = (k * focal) / width
  }

  const power = geo(intensity, 0.35, 0.75, 1.6) * hazeGain * lerp(0.9, 1.1, random())
  // A warm light whitens (Tan, Lime) or holds a flat saturated color (Yellow, Orange-red) a
  // little past its clipping level, so its floor (pool, spill, the pool's glow, the floor's
  // reflection) is far less bright: its pool keeps a smooth ramp up to a pale center instead
  // of a wide flat top whose outline follows every bump of the light under it.
  const warmFloor = light.tail ? WARM_FLOOR_LIGHT : 1
  const spillReach = Math.max(soft(0.8, 1.1), SPILL_REACH / width)
  const pool = lerp(6, 8.5, random()) * (luminanceOf(light.haze) / Math.max(luminanceOf(light.light), 0.01)) * (light.tail ? 0.3 * WARM_FLOOR_LIGHT : 1)

  const params: Record<string, ParamValue> = {
    horizon: round4(horizon),
    focal: round4(focal),
    floorY: round4(floorY),
    stageRound: round4(lerp(0.4, 0.9, random())),
    beamAt: round4(beamAt),
    beamWidth: round4(width * soft(0.95, 1.05)),
    landing: round4(landing),
    tilt: tilt.map(round4),
    // A nearly parallel column, or (for narrow beams) a cone that narrows toward the source. A
    // broad beam is always a column, bright up to the frame's top as in the moodboard; a broad
    // cone thins and dims toward the top. A narrow column still widens a little toward its pool.
    spread: round4(either(cone && !broad ? 1 : 0, broad ? [-0.04, 0.03] : [0.05, 0.1], [0.2, 0.3])),
    beamEdge: round4(soft(3.6, 2.2)),
    halo: broad ? [0, 0] : HALO,
    glowCore: GLOW_CORE,
    hollow: [round4(lerp(0.42, 0.58, random())), round4(lerp(0.35, 0.6, random()))],
    power: round4(Math.min(20, power)),
    extinction: round4(lerp(0, 0.25, random())),
    haze: round4(lerp(0.03, 0.045, random())),
    ceiling: [round4(lerp(1, 1.5, random())), round4(lerp(0.12, 0.2, random())), round4(-halfH - lerp(0, 0.1, random()))],
    // Denser haze just over the floor, so the column brightens toward its pool, but not so
    // dense that its base turns into a wide white area (a warm light, already near nominal
    // over the whole beam, gets less of it).
    floorHaze: [round4(lerp(1.6, 2.3, random()) * (light.tail ? WARM_FLOOR_HAZE : 1)), round4(lerp(0.12, 0.2, random()))],
    forward: round4(lerp(-0.1, 0.15, random())),
    // Layers of denser and thinner haze along the column, about two per short side.
    hazeNoise: [round4(lerp(0.14, 0.22, random())), round4(lerp(0.8, 1.2, random())), round4(lerp(1.8, 2.6, random()))],
    // The pool lights the haze above it in a dome that falls off faster sideways than upward,
    // and the haze spills its light onto the floor just around the pool, so the floor beside
    // the pool stays dark instead of glowing across the frame.
    bounce: [round4(lerp(0.7, 1, random()) * Math.sqrt(warmFloor)), round4(soft(0.5, 0.8) * Math.min(1, 0.5 + halfH)), round4(lerp(0.5, 0.7, random())), round4(lerp(0.12, 0.2, random()))],
    // The haze spills the pool's light onto the floor around it as far as the room's haze carries
    // it (SPILL_REACH), so a narrow beam lights the floor around its pool too, a little dimmer.
    pool: [round4(Math.min(10, pool)), round4(lerp(1.3, 2, random()) * warmFloor * Math.sqrt(soft(0.8, 1.1) / spillReach)), round4(spillReach)],
    edgeSoftness: round4(soft(HALF_SCALE_EDGE, 0.024)),
    edgeHaze: EDGE_HAZE,
    // The floor's mirror of a warm beam is dimmer still: its bright column under the pool
    // would square off the pool's outline.
    gloss: [round4(lerp(2.8, 3.4, random()) * warmFloor * (light.tail ? 0.5 : 1)), round4(soft(0.22, 0.32))],
    texture: [0.05, 0.006],
    // Boards about as wide whatever the beam's width, each even along its length, so the
    // floor's rays stay thin and smooth under any beam instead of breaking into spikes.
    lanes: [round4(lerp(1.4, 1.8, random())), round4(lerp(0.8, 1.2, random()) * Math.min(1, NARROW_WIDTH / width))],
    laneShape: [0, 0.025],
    pale: paleParam(light, lerp(0.5, 0.7, random())),
    paleWhite: light.light === light.haze ? 0.5 : 0.2,
    ...tailParams(light, TAIL_FROM),
    fall: fallParam(light, TAIL_BELOW, TAIL_FALL),
    ambient: [light.baseLevel, 0, light.baseLevel],
    vignette: round4(lerp(0.1, 0.18, random())),
    // A light over a dark of another hue (Meta Blue over Plum) keeps its full color: a pale
    // veil would blend with the dark into a third color, and dimming the dark where the beam's
    // faint glow reaches would outline the beam's shape in the dark.
    // The beam-pool example's haze has about the same chroma for its lightness everywhere
    // (about 0.1 times it, near the pool too), so Beam's veil has no band of extra color.
    veil: darkMatches(light) ? veilParam(light, BEAM_VEIL_CHROMA) : [1, 1, 1, 0],
    veilBand: 0,
    veilTint: veiled(light) && darkMatches(light) ? VEIL_TINT : 0,
  }
  // A hanging lamp's beam starts inside the frame, a fifth to nearly half of the way down; a
  // dragged line puts the start at the line's start instead.
  // The lamp's mouth is the frame's brightest point, a little brighter than a cool light's pool
  // (a warm light's pool is held down so it doesn't flatten into a saturated area, but the mouth
  // is a small core, which may go to white).
  const mouthLevel = (lerp(MOUTH_GLOW[0], MOUTH_GLOW[1], stage()) * (params.pool as number[])[0] * (luminanceOf(light.light) / Math.max(luminanceOf(light.haze), 1e-6))) / (light.tail ? 0.3 * WARM_FLOOR_LIGHT : 1)
  if (hanging) Object.assign(params, beamHanging(params, -halfH + 2 * halfH * lerp(0.2, 0.45, stage()), halfH, mouthLevel))
  if (controls.drag) {
    const line = lineInShorts(controls.drag, aspect)
    // Under a line the seed's layout choices that the line takes over (left or right, upright
    // or leaning) become where the haze is densest along the beam and how the stage's floor is
    // turned about the pool.
    const ownLean = leaning ? Math.sign((params.tilt as number[])[0]) * LEAN_OWN : 0
    const profile = light.tail ? (onRight ? WARM_SOURCE_HAZE : WARM_POOL_HAZE) : onRight ? SOURCE_HAZE : POOL_HAZE
    const onLine = beamOnLine(params, line, halfH, profile, ownLean, broad ? BROAD_RAMP[0] + BROAD_RAMP[1] * line.length : SOURCE_RAMP)
    // A line longer than the frame's short side spreads the beam's haze layers along its length,
    // and the light they take out on its way dims the whole beam, so the haze gives back more of
    // the beam's light: the beam still reaches its own color along its length (dimmer, warm light
    // reads dark red). A lifted light's haze (Tan) already gets that much more light.
    onLine.beamHaze = round4(Math.max(1, Math.max(1, line.length) ** BEAM_HAZE_GROWTH / light.lift))
    // A light outside the frame glows from where its haze is lit: the beam's first stretch, or
    // the haze the pool lights in front of the floor, along the floor's normal (the stage's up,
    // (sin, -cos) of its turn), so a turned floor sends that glow in at an angle. Dense haze at
    // the source keeps its glow close to the frame's edge, fading fast, where the low haze a pool
    // lights reaches farther into the frame. A broad beam glows wider.
    const [cos, sin] = onLine.turn as number[]
    const { halfW } = frameHalf(aspect)
    const poolOut = Math.hypot(Math.max(0, Math.abs(line.to[0]) - halfW), Math.max(0, Math.abs(line.to[1]) - halfH))
    const toward = POOL_GLOW * poolOut
    const litSeg = onRight
      ? [...line.from, line.from[0] + SOURCE_GLOW * (line.to[0] - line.from[0]), line.from[1] + SOURCE_GLOW * (line.to[1] - line.from[1])]
      : [line.to[0] + toward * sin, line.to[1] - toward * cos, line.to[0] + toward * sin, line.to[1] - toward * cos]
    // That haze lies in a layer (the stage's ceiling or floor haze), so its glow spreads along
    // the floor ((cos, sin)) by the seed's own share, from a spot to a long band, and the denser
    // the seed's haze, the more of the glow's light it takes out on the way into the frame, so
    // the faster the glow fades (its own stream).
    // The band grows in as the lit haze moves away from the frame, so it doesn't sweep in at
    // once when the light leaves the frame.
    const [layerShare, densityShare] = seedShares(seed, 0xbee, 2, seededRandom(seed, 0xbee))
    const lit = [(litSeg[0] + litSeg[2]) / 2, (litSeg[1] + litSeg[3]) / 2]
    const litOut = Math.hypot(Math.max(0, Math.abs(lit[0]) - halfW), Math.max(0, Math.abs(lit[1]) - halfH))
    const spread = GLOW_LAYER * layerShare * layerShare * smoothstep(0, GLOW_LAYER_FROM, litOut)
    const glowSeg = spreadOutside(lit, [cos, sin], spread, aspect)
    const reach = (onRight ? SOURCE_GLOW_REACH : 1) * (broad ? WIDE_GLOW : NARROW_GLOW)
    const fade = lerp(GLOW_DENSITY[0], GLOW_DENSITY[1], densityShare) + (onRight ? 0.5 : 0)
    const glow = airGlowParams(light, glowSeg, aspect, geo(intensity, 0.35, 0.75, 1.6) / 0.75, (params.fall as number[])[0], reach, fade, [...line.from, ...line.to])
    Object.assign(params, onLine, glow)
    // A pool-heavy seed's narrow beam crosses dense haze near its pool, which scatters its light
    // wider there, so it widens toward the pool where a source-heavy seed's stays a narrow ray.
    if (!onRight && !broad) params.spread = round4((params.spread as number) + POOL_HAZE_SPREAD)
  }

  return {
    colors: [light.light, light.haze, light.base],
    params,
    // Film halation spreads red farthest, which rings a white-hot core in red; only a warm
    // light keeps that, should halation be turned on.
    lens: { bloom: round4(soft(0.04, 0.07)), bloomLevels: [1, 0.6, 0.3, 0.15, 0.1, 0.05, 0, 0], halation: 0, ...(light.tail ? {} : { halationSpread: 0 }) },
    output: { grain: 0, toe: light.toe },
  }
}

/**
 * Most a dragged line leans the beam, in radians on screen (about as far as the seeds lean
 * it); the stage turns for the rest of the line's angle.
 */
const LEAN_MOST = 0.7

/**
 * A leaning seed's own lean under a dragged line (radians, before LEAN_MOST eases it): the
 * beam leans this much more on the stage and the stage turns back by as much, so the beam still
 * runs along the line and the floor lies at another angle about the pool.
 */
const LEAN_OWN = 0.5

/**
 * The haze layers of a seed whose haze sits at the beam's source, and of one whose haze sits at
 * its pool, as factors on the seed's [level, depth] of the ceiling haze and of the floor haze.
 */
interface HazeProfile {
  ceiling: number[]
  floor: number[]
}
const SOURCE_HAZE: HazeProfile = { ceiling: [1.6, 1.8], floor: [0.45, 0.6] }
const POOL_HAZE: HazeProfile = { ceiling: [0.45, 0.6], floor: [1.4, 1.8] }

/**
 * The same for a warm light, milder: its dim haze already falls off fast and turns toward its
 * tail colors, so a long dim stretch would read olive (Lime) or brown (Tan).
 */
const WARM_SOURCE_HAZE: HazeProfile = { ceiling: [1.3, 1.4], floor: [0.8, 0.85] }
const WARM_POOL_HAZE: HazeProfile = { ceiling: [0.8, 0.85], floor: [1.15, 1.4] }

/** Share of the beam, from its start, that a source-heavy seed's light past the frame glows from. */
const SOURCE_GLOW = 0.35

/**
 * How far along the floor's normal a pool-heavy seed's light past the frame glows from, as a
 * share of the pool's distance outside the frame (so it stays outside).
 */
const POOL_GLOW = 0.75

/**
 * How far a source-heavy seed's glow past the frame reaches, as a factor on the broad or narrow
 * beam's falloff; it also fades one power faster.
 */
const SOURCE_GLOW_REACH = 0.75

/**
 * The haze layer that glow comes from: how far (short-side units) either way along the floor it
 * spreads at most, and how much faster the glow fades (added to its power) in the thinnest and
 * the densest haze over the seeds.
 */
const GLOW_LAYER = 0.8
const GLOW_DENSITY = [-0.5, 1]

/** How much more a pool-heavy seed's narrow beam widens under a line (added to its spread). */
const POOL_HAZE_SPREAD = 0.15

/** How far (short-side units) the lit haze is outside the frame when that band has all its spread. */
const GLOW_LAYER_FROM = 0.3

/** Falloff (short-side units) of the glow past the frame for a broad and a narrow beam. */
const WIDE_GLOW = 0.27
const NARROW_GLOW = 0.15
/**
 * How far past its start (screen, short-side units) a dragged line's narrow beam has all its
 * light: a short way, as a lamp's does, so it reads as light along its whole length instead of
 * a stroke that brightens toward its pool. A broad beam takes longer the longer the line (its
 * pale core would otherwise start as a flat white end at the frame's edge).
 */
const SOURCE_RAMP = 0.25
const BROAD_RAMP = [0.03, 0.25]

/** Shares of the seeds whose lamp hangs in the frame, and whose stage edge is high (beamHanging). */
const HANGING_SHARE = 0.3
const HIGH_EDGE_SHARE = 0.3

/**
 * A hanging lamp: how far past its mouth its beam has all its light (screen, short-side units),
 * and how much light its mouth gives the haze around it (least and most, as a share of the beam's
 * light per unit of haze) within a core (screen, short-side units).
 */
const HANGING_RAMP = 0.1
const MOUTH_GLOW = [1.1, 1.4]
const MOUTH_CORE = 0.012

/** A hanging lamp's beam width at its mouth, as a share of its width at the pool. */
const MOUTH_WIDTH = 0.12

/**
 * The stage for a dragged line: the beam starts at the line's start and lands at its end, with
 * its pool there. A line near straight down leans the beam; for the rest of its angle the whole
 * stage turns about the pool, all the way round, so a line pointing up gives a beam rising to a
 * pool overhead. The lean eases back to upright as the line turns to point straight up, so
 * turning the line never flips the beam from one side to the other. The beam comes out of the
 * dark at the start, under the ceiling haze, which thins out above it, and has all its light
 * `ramp` past it. The seed keeps its own composition along the
 * line: its haze dense at the source or at the pool (`haze`), and its own lean (`ownLean`, see
 * LEAN_OWN).
 */
function beamOnLine(params: Record<string, ParamValue>, line: ShortLine, halfH: number, haze: HazeProfile, ownLean: number, ramp: number): Record<string, ParamValue> {
  const num = (key: string) => params[key] as number
  const horizon = num('horizon')
  const focal = num('focal')
  const edgeY = Math.max(num('floorY'), horizon + 0.01)
  const k = Math.min(0.9, (num('landing') * num('beamWidth')) / focal)
  const landingZ = focal / (edgeY - horizon) / (1 - k)
  const landingX = (num('beamAt') * landingZ) / focal
  const pool: [number, number] = [num('beamAt'), horizon + (edgeY - horizon) * (1 - k)]
  const tiltZ = (params.tilt as number[])[1]
  const heightAt = stageHeightAt(params)
  // The line's angle from straight down, positive toward -x, and the beam's direction on the
  // unturned stage (toward the pool) for the lean it takes of it.
  const fromDown = wrapAngle(line.angle - Math.PI / 2)
  const lean = LEAN_MOST * Math.tanh((Math.sin(fromDown) + ownLean) / LEAN_MOST)
  const down = Math.cos(lean)
  const tiltX = (-Math.tan(lean) * (landingZ - tiltZ) + landingX * tiltZ) / landingZ
  // Screen heights of the beam's start and of where it has all its light, and the world
  // height on the beam's axis at a screen height.
  const start = pool[1] - line.length * down
  const full = start + ramp * down
  const startHeight = round4(heightAt(start))
  // A beam longer than the frame's short side keeps the haze layers' share of its length, and
  // the room's haze thickens a little with it, so a beam crossing the whole frame still shows
  // along its length instead of only at its ends beyond the frame's corners.
  const grow = Math.max(1, line.length)
  const ceiling = params.ceiling as number[]
  const floorHaze = params.floorHaze as number[]
  const depth = round4(ceiling[1] * grow * haze.ceiling[1])
  return {
    tilt: [round4(Math.min(1, Math.max(-1, tiltX))), tiltZ],
    ceiling: [round4(ceiling[0] * haze.ceiling[0]), depth, round4(Math.min(4, Math.max(-2, start + halfH + ceiling[2])))],
    ceilingTop: depth,
    floorHaze: [round4(floorHaze[0] * haze.floor[0]), round4(floorHaze[1] * grow * haze.floor[1])],
    haze: round4(num('haze') * Math.sqrt(grow)),
    turn: turnParam(fromDown - lean, line.to, pool),
    source: [startHeight, round4(Math.max(heightAt(full), startHeight + 0.001))],
  }
}

/** The world height on the beam's axis that the unturned stage shows at screen height e. */
function stageHeightAt(params: Record<string, ParamValue>): (e: number) => number {
  const num = (key: string) => params[key] as number
  const horizon = num('horizon')
  const focal = num('focal')
  const edgeY = Math.max(num('floorY'), horizon + 0.01)
  const k = Math.min(0.9, (num('landing') * num('beamWidth')) / focal)
  const landingZ = focal / (edgeY - horizon) / (1 - k)
  const tiltZ = (params.tilt as number[])[1]
  return (e: number) => Math.min(2, Math.max(-50, ((e - horizon) * (landingZ - tiltZ)) / (focal - (e - horizon) * tiltZ)))
}

/**
 * A lamp hanging in the frame: its beam starts at screen height `start` and has all its light
 * SOURCE_RAMP past it, under the ceiling haze, which thins out above it.
 */
function beamHanging(params: Record<string, ParamValue>, start: number, halfH: number, mouth: number): Record<string, ParamValue> {
  const num = (key: string) => params[key] as number
  const heightAt = stageHeightAt(params)
  const startHeight = round4(heightAt(start))
  const ceiling = params.ceiling as number[]
  // Where the beam's axis meets the start's height on screen (beamWorld's stage, leaned by its tilt).
  const horizon = num('horizon')
  const focal = num('focal')
  const edgeY = Math.max(num('floorY'), horizon + 0.01)
  const landingZ = focal / (edgeY - horizon) / (1 - Math.min(0.9, (num('landing') * num('beamWidth')) / focal))
  const [tx, tz] = params.tilt as number[]
  const x = (focal * ((num('beamAt') * landingZ) / focal + tx * (startHeight - 1))) / Math.max(landingZ + tz * (startHeight - 1), 0.05)
  return {
    ceiling: [ceiling[0], ceiling[1], round4(Math.min(4, Math.max(-2, start + halfH + ceiling[2])))],
    ceilingTop: ceiling[1],
    source: [startHeight, round4(Math.max(heightAt(start + HANGING_RAMP), startHeight + 0.001))],
    // A cone from the lamp: MOUTH_WIDTH of its width at the mouth, widening down to the pool.
    spread: round4(Math.min(1, (1 - MOUTH_WIDTH) / Math.max(1 - startHeight, 0.1))),
    mouth: [round4(mouth), MOUTH_CORE, round4(x), round4(start)],
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
    { kind: 'vector', key: 'laneShape', label: 'Floor lane shape', min: 0, max: 1, step: 0.0005, default: [0.35, 0.08] },
    { kind: 'vector', key: 'veil', label: 'Haze veil', min: 0, max: 4, step: 0.0005, default: [1, 1, 1, 0] },
    { kind: 'vector', key: 'darkMeet', label: 'Meeting another dark', min: 0, max: 4, step: 0.0005, default: [0, 0, 0, 0] },
    { kind: 'number', key: 'veilTint', label: 'Trace of the haze hue', min: 0, max: 0.2, step: 0.0005, default: 0 },
    { kind: 'number', key: 'veilBand', label: 'More color in the band', min: 0, max: 2, step: 0.005, default: 1 },
    { kind: 'vector', key: 'airGlow', label: 'Glow past the frame', min: 0, max: 100, step: 0.0001, default: [0, 0.18, 2, 1] },
    { kind: 'vector', key: 'glowLine', label: 'Light past the frame', min: -8, max: 8, step: 0.0005, default: [0, 0, 0, 0] },
    { kind: 'number', key: 'beamHaze', label: 'Beam light in its haze', min: 0, max: 4, step: 0.005, default: 1 },
    { kind: 'vector', key: 'halo', label: 'Light around the beam', min: 0, max: 2, step: 0.0005, default: [0, 0] },
    { kind: 'number', key: 'glowCore', label: 'Least pool glow size', min: 0, max: 1, step: 0.0005, default: 0 },
    { kind: 'vector', key: 'mouth', label: 'Lamp mouth glow', min: -8, max: 32, step: 0.0005, default: [0, 0.04, 0, 0] },
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
      uLaneShape: ctx.vec('laneShape'),
      uVeil: ctx.vec('veil'),
      uDarkMeet: ctx.vec('darkMeet'),
      uVeilTint: ctx.num('veilTint'),
      uVeilBand: ctx.num('veilBand'),
      uAirGlow: ctx.vec('airGlow'),
      uGlowLine: ctx.vec('glowLine'),
      uBeamHaze: ctx.num('beamHaze'),
      uHalo: ctx.vec('halo'),
      uGlowCore: ctx.num('glowCore'),
      uMouth: ctx.vec('mouth'),
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
