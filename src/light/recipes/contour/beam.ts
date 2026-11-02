import { packHexesByLightness, type ColorPack } from '../../color/packs'
import type { RecipeDefinition } from '../../scene'

/**
 * A cone of light through haze from a source above (or on) the frame down to
 * a floor line, a bright pool where it lands, and light streaks spreading
 * from the pool across the floor (and optionally the sky).
 */
export const contourBeam: RecipeDefinition = {
  id: 'contour.beam',
  mood: 'contour',
  label: 'Beam',
  colorSlots: [
    { key: 'background', label: 'Background' },
    { key: 'beam', label: 'Beam' },
    { key: 'pool', label: 'Pool' },
    { key: 'floor', label: 'Floor' },
  ],
  defaultColors: ['#02070C', '#2E5F7E', '#D8EEFF', '#3D6F92'],
  params: [
    { kind: 'vector', key: 'source', label: 'Source', min: -1, max: 2, step: 0.005, default: [0.5, -0.15] },
    { kind: 'number', key: 'floorY', label: 'Floor', min: 0, max: 1.2, step: 0.005, default: 0.72 },
    { kind: 'number', key: 'spread', label: 'Spread', min: 0, max: 80, step: 0.5, default: 9 },
    { kind: 'number', key: 'beamWidth', label: 'Beam width', min: 0.005, max: 0.6, step: 0.005, default: 0.12 },
    { kind: 'number', key: 'beamGain', label: 'Beam gain', min: 0, max: 4, step: 0.01, default: 0.45 },
    { kind: 'number', key: 'haze', label: 'Haze', min: 0, max: 4, step: 0.01, default: 1.2 },
    { kind: 'number', key: 'poolGain', label: 'Pool gain', min: 0, max: 8, step: 0.05, default: 2 },
    { kind: 'number', key: 'poolWidth', label: 'Pool width', min: 0.01, max: 1.5, step: 0.005, default: 0.22 },
    { kind: 'number', key: 'poolHeight', label: 'Pool height', min: 0.002, max: 0.4, step: 0.001, default: 0.02 },
    { kind: 'number', key: 'floorGain', label: 'Floor gain', min: 0, max: 4, step: 0.01, default: 0.8 },
    { kind: 'number', key: 'floorReach', label: 'Floor reach', min: 0.02, max: 2, step: 0.01, default: 0.35 },
    { kind: 'number', key: 'streaks', label: 'Streaks', min: 0, max: 1, step: 0.01, default: 0.6 },
    { kind: 'number', key: 'streakCount', label: 'Streak count', min: 1, max: 60, step: 0.5, default: 9 },
    { kind: 'number', key: 'skyStreaks', label: 'Sky streaks', min: 0, max: 1, step: 0.01, default: 0 },
    { kind: 'number', key: 'intensity', label: 'Intensity', min: 0, max: 4, step: 0.01, default: 1 },
  ],
  fragment: /* glsl */ `
uniform vec3 uBackground;
uniform vec3 uBeam;
uniform vec3 uPool;
uniform vec3 uFloor;
uniform vec2 uSource;
uniform float uFloorY;
uniform float uSpread;
uniform float uBeamWidth;
uniform float uBeamGain;
uniform float uHaze;
uniform float uPoolGain;
uniform float uPoolWidth;
uniform float uPoolHeight;
uniform float uFloorGain;
uniform float uFloorReach;
uniform float uStreaks;
uniform float uStreakCount;
uniform float uSkyStreaks;
uniform float uIntensity;

float streakPattern(vec2 d, int seed) {
  float angle = atan(d.y, d.x);
  float n = fbm(vec2(angle * uStreakCount / PI, 0.5), 3, seed);
  return max(0.0, 1.0 + 1.4 * n);
}

vec3 radiance(vec2 uv, vec2 p) {
  vec2 src = (uSource - 0.5) * uFrameAspect;
  float floorY = (uFloorY - 0.5) * uFrameAspect.y;
  vec2 land = vec2(src.x, floorY);
  vec3 color = uBackground;

  // Beam above the floor: gaussian across the cone, brighter toward the floor where the haze is lit by the pool.
  vec2 axis = normalize(land - src + vec2(0.0, 1e-5));
  vec2 d = p - src;
  float along = dot(d, axis);
  float across = abs(d.x * axis.y - d.y * axis.x);
  float reach = max(length(land - src), 1e-3);
  float halfWidth = uBeamWidth + max(along, 0.0) * tan(radians(uSpread));
  float aboveFloor = 1.0 - softStep(p.y - floorY, 0.004);
  float hazeLight = mix(1.0, uHaze, saturate(along / reach));
  color += uBeam * uBeamGain * hazeLight * gaussian(across, halfWidth * 0.5) * aboveFloor * step(0.0, along);

  // Pool where the beam lands: sharp core plus a wide haze.
  vec2 q = p - land;
  float pool = gaussian(length(q / vec2(uPoolWidth, uPoolHeight)), 1.0) + 0.25 * gaussian(length(q / vec2(uPoolWidth * 2.5, uPoolHeight * 6.0)), 1.0);
  color += uPool * uPoolGain * pool;

  // Light spreading over the floor (and the sky) from the pool, broken into streaks.
  float r = length(q / vec2(1.0, 0.45));
  float spreadLight = expHaze(r, uFloorReach);
  float streak = mix(1.0, streakPattern(q, uSeed), uStreaks);
  float belowFloor = 1.0 - aboveFloor;
  color += uFloor * uFloorGain * spreadLight * streak * belowFloor;
  float skyStreak = mix(1.0, streakPattern(q, uSeed + 3), uSkyStreaks);
  color += uFloor * uFloorGain * 0.5 * uSkyStreaks * spreadLight * skyStreak * aboveFloor;
  return uIntensity * color;
}
`,
  uniforms: (ctx) => ({
    uBackground: ctx.color('background'),
    uBeam: ctx.color('beam'),
    uPool: ctx.color('pool'),
    uFloor: ctx.color('floor'),
    uSource: ctx.vec('source'),
    uFloorY: ctx.num('floorY'),
    uSpread: ctx.num('spread'),
    uBeamWidth: ctx.num('beamWidth'),
    uBeamGain: ctx.num('beamGain'),
    uHaze: ctx.num('haze'),
    uPoolGain: ctx.num('poolGain'),
    uPoolWidth: ctx.num('poolWidth'),
    uPoolHeight: ctx.num('poolHeight'),
    uFloorGain: ctx.num('floorGain'),
    uFloorReach: ctx.num('floorReach'),
    uStreaks: ctx.num('streaks'),
    uStreakCount: ctx.num('streakCount'),
    uSkyStreaks: ctx.num('skyStreaks'),
    uIntensity: ctx.num('intensity'),
  }),
  lens: { bloom: 0.1, bloomRadius: 0.5, bloomWidth: 1.5, halation: 0.1, halationThreshold: 0.9, halationRadius: 0.05 },
  fromPack: (pack: ColorPack) => {
    const blue = pack.colors[0].hex
    return ['#000000', blue, packHexesByLightness(pack).at(-1) ?? blue, blue]
  },
}
