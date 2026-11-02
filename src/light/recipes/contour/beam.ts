import type { ColorPack } from '../../color/packs'
import type { ComposeInput, Composition, RecipeContext, RecipeDefinition } from '../../scene'
import { contourLights, frameHalf, geo, lerp, luminanceOf, paleTarget, pickContourLight, round4, seededRandom } from './beam-compose'

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
uniform vec3 uAmbient;    // room level, haze share, floor level
uniform float uVignette;

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
    float ah = a * max(0.05, 1.0 + uBeamShape.z * (y - 1.0));
    float aw = sqrt(ah * ah + widen * widen);
    vec2 axis = vec2(xb + tx * (y - 1.0), zb + tz * (y - 1.0));
    float r = length(vec2(x, z) - axis) / aw;
    sum += beamAperture(r) * (a * a) / (aw * aw) * hazeDensity(beamScreenHeight(y));
  }
  float e = beamScreenHeight(1.0 + mirror * (ys * zc - 1.0));
  vec3 dir = vec3(s.x, s.y - uCamera.x, F);
  float cosTheta = -dot(vec3(tx, mirror, tz), dir) / (length(vec3(tx, 1.0, tz)) * length(dir));
  float loss = exp(-uBeamLight.w * hazeAbove(e));
  return sum * dz * (length(dir) / F) * hgPhase(cosTheta, uHazeB.z) * loss * max(1.0 + densityNoise, 0.0) / a;
}

// Pool light scattered by the haze at screen offset d (x from the pool's center, y above
// the floor line). It falls off as 1/distance from the pool (the view ray's integral of
// 1/distance^2), with a Lambert cosine for the floor's emission; the stage's rim shadows
// the haze at grazing angles.
float poolGlow(vec2 d, float halfWidth, float core, float density) {
  float across = max(d.x - 0.8 * halfWidth, 0.0) / max(uBounce.z, 0.1);
  float h = sqrt(across * across + d.y * d.y + core * core);
  float lambert = (d.y + 0.25 * core) / (h + 0.25 * core);
  float rim = smoothstep(0.25 * uBounce.w, uBounce.w, d.y / max(d.x, 1e-4));
  float side = exp(-across / max(uBounce.y, 1e-3));
  return uBounce.x * density * (core / h) * exp(-d.y / max(uBounce.y, 1e-3)) * side * lambert * rim;
}

vec3 radiance(vec2 uv, vec2 p) {
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

  float hazeHere = hazeDensity(p.y);

  // Haze density noise, in beam-relative coordinates at the beam's depth.
  float u = (p.x * zb / F - xb) / a;
  float noise = 0.0;
  if (uHazeB.w > 0.0 && abs(u) < 4.0 + 2.0 * abs(uBeamShape.x) * (1.0 + abs(p.y))) {
    noise = uHazeB.w * fbm(vec2(u * uHazeNoise.x + 11.3, p.y * uHazeNoise.y + 3.7), 2, uSeed);
  }

  // Beam: in front of the floor where the floor is, and over the edge into the pit behind it.
  float beamSeen = beamInScatter(p, 0.01, mix(1e6, zFloor, onFloor), 1.0, 0.0, noise, 10);
  float scatter = uBeamLight.x * beamSeen;

  // The pool's light scattered by the haze above it. The pool is a flat emitter as wide as
  // the beam, so the glow is flat across it and falls off above and to the sides.
  float beamX = uWorld.y * F / zb;
  float core = 0.35 * aScreen;
  scatter += (1.0 - onFloor) * uBeamLight.x * poolGlow(vec2(abs(p.x - beamX), max(contactY - p.y, 0.0)), aScreen, core, hazeHere);

  float direct = 0.0;
  float floorLight = 0.0;
  if (onFloor > 0.0) {
    vec2 floorAt = vec2(p.x * zFloor / F, zFloor);
    vec2 q = (floorAt - vec2(xb, zb)) / a;
    float d = length(q);
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
      vec2 m = vec2(p.x, 2.0 * contactY - p.y);
      float mBounce = uBeamLight.x * poolGlow(vec2(abs(m.x - beamX), max(contactY - m.y, 0.0)), aScreen, core + widen * F / zb, hazeDensity(m.y));
      vec3 view = normalize(vec3(p.x, p.y - horizon, F));
      float fresnel = 0.04 + 0.96 * pow(1.0 - view.y, 5.0);
      float lanes = 1.0;
      if (uLanes.x > 0.0) {
        // Gloss varies across the floor much faster than along it, and the lanes drift.
        vec2 l = floorAt / (uLanes.y * a);
        l.x += 0.35 * valueNoise(vec2(l.y * 0.08, 7.3), uSeed + 127);
        l.y *= 0.08;
        float n = 0.65 * valueNoise(l, uSeed + 131) + 0.35 * valueNoise(vec2(2.1 * l.x, 2.1 * l.y + 3.5), uSeed + 137);
        lanes = max(0.0, 1.0 + uLanes.x * n);
      }
      reflection = uFloorLook.x * fresnel * lanes * (uBeamLight.x * mirrored + mBounce);
    }

    float spill = uPool.y * exp(-0.5 * d * d / max(uPool.z * uPool.z, 1e-4));
    direct = onFloor * uPool.x * uBeamLight.x * lit * tex;
    floorLight = onFloor * (spill * uBeamLight.x + reflection) * tex;
  }
  scatter += floorLight;

  float lum = scatter * lumHaze;
  float pale = saturate(uPale.x * smoothstep(uPale.y, uPale.z, lum + direct * lumLight));
  vec3 paleColor = mix(uLightColor / lumLight, uPaleTarget, uPaleWhite) * lumHaze;
  vec3 scattered = scatter * mix(uHazeColor, paleColor, pale);
  vec3 directColor = mix(uLightColor, uPaleTarget * lumLight, uPaleWhite * pale);
  vec3 ambient = uBaseColor * mix(uAmbient.x * (1.0 - uAmbient.y + uAmbient.y * hazeHere), uAmbient.z, onFloor);
  vec3 color = ambient + scattered + directColor * direct;

  vec2 half_ = 0.5 * uFrameAspect;
  float vig = 1.0 - uVignette * dot(p, p) / dot(half_, half_);
  return color * max(vig, 0.0);
}
`

/** Luminance one unit of scattered light should have, whatever the pack's haze color. */
const HAZE_LUMINANCE = 0.12

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
 * The seed picks the light, the beam's width, slight lean and hollow, the camera
 * height, the haze layers and the floor's gloss and lanes. Light (the mood control)
 * moves the beam across the frame; Intensity is the source's power; Softness softens
 * the beam's edge, the haze and the floor.
 */
function composeBeam({ pack, controls, seed, aspect }: ComposeInput): Composition {
  const random = seededRandom(seed, 0xbea)
  const { intensity, softness, mood } = controls
  const { halfW, halfH } = frameHalf(aspect)
  const wide = aspect >= 1
  const light = pickContourLight(pack, random)
  const hazeGain = HAZE_LUMINANCE / Math.max(luminanceOf(light.haze), 0.01)
  const soft = (lo: number, hi: number) => lerp(lo, hi, softness)

  const edgeAt = wide ? lerp(0.62, 0.72, random()) : lerp(0.64, 0.74, random())
  const floorY = -halfH + 2 * halfH * edgeAt
  const drop = lerp(0.2, 0.3, random())
  const focal = lerp(1.2, 1.6, random())
  const width = lerp(0.15, 0.185, random())
  const offset = lerp(-0.1, 0.1, random())
  const side = Math.min(0.85, Math.max(0.15, 0.5 + (mood - 0.5) * (wide ? 0.62 : 0.4) + offset))
  const beamAt = (side - 0.5) * 2 * halfW
  const lean = random() < 0.5 ? -1 : 1
  const tilt = [lean * lerp(0, 0.05, random()), lerp(-0.04, 0.04, random())]

  const power = geo(intensity, 0.35, 0.75, 1.6) * hazeGain * lerp(0.9, 1.1, random())
  const pool = lerp(6, 8.5, random()) * (luminanceOf(light.haze) / Math.max(luminanceOf(light.light), 0.01))

  return {
    colors: [light.light, light.haze, light.base],
    params: {
      horizon: round4(floorY - drop),
      focal: round4(focal),
      floorY: round4(floorY),
      stageRound: round4(lerp(0.4, 0.9, random())),
      beamAt: round4(beamAt),
      beamWidth: round4(width * soft(0.95, 1.05)),
      landing: round4(lerp(-0.15, 0.1, random())),
      tilt: tilt.map(round4),
      spread: round4(lerp(0, 0.04, random())),
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
      gloss: [round4(lerp(2.8, 3.4, random())), round4(soft(0.22, 0.32))],
      texture: [0.05, 0.006],
      lanes: [round4(lerp(1.5, 1.9, random())), round4(lerp(0.4, 0.6, random()))],
      pale: [round4(lerp(0.5, 0.7, random())), 0.075, 0.25],
      paleWhite: light.light === light.haze ? 0.5 : 0.2,
      ambient: [light.baseLevel, 0, light.baseLevel],
      vignette: round4(lerp(0.1, 0.18, random())),
    },
    lens: { bloom: round4(soft(0.04, 0.07)), bloomLevels: [1, 0.6, 0.3, 0.15, 0.1, 0.05, 0, 0], halation: 0 },
    output: { grain: 0 },
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
    { kind: 'number', key: 'landing', label: 'Landing', min: -4, max: 4, step: 0.01, default: 0 },
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
    { kind: 'vector', key: 'lanes', label: 'Floor lanes', min: 0, max: 4, step: 0.005, default: [0.6, 0.3] },
    { kind: 'vector', key: 'gloss', label: 'Gloss', min: 0, max: 4, step: 0.005, default: [1, 0.1] },
    { kind: 'vector', key: 'texture', label: 'Floor texture', min: 0, max: 0.3, step: 0.0005, default: [0.04, 0.004] },
    { kind: 'vector', key: 'pale', label: 'Pale', min: 0, max: 2, step: 0.005, default: [0, 0.1, 0.6] },
    { kind: 'number', key: 'paleWhite', label: 'Pale toward white', min: 0, max: 1, step: 0.005, default: 0 },
    { kind: 'vector', key: 'ambient', label: 'Ambient', min: 0, max: 4, step: 0.005, default: [1, 0.3, 1] },
    { kind: 'number', key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.005, default: 0.1 },
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
      uAmbient: ctx.vec('ambient'),
      uVignette: ctx.num('vignette'),
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
