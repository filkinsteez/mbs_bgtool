import { packHexes, PACKS } from '../../../src/light/color/packs'
import { hexToLinear } from '../../../src/light/color/srgb'
import type { RecipeProgram } from '../../../src/light/scene'

/** A flat field of one color at a given gain. */
export const flatProgram: RecipeProgram = {
  id: 'test.flat',
  colorSlots: [{ key: 'color', label: 'Color' }],
  defaultColors: ['#808080'],
  params: [{ kind: 'number', key: 'gain', label: 'Gain', min: 0, max: 64, step: 0.01, default: 1 }],
  fragment: /* glsl */ `
uniform vec3 uColor;
uniform float uGain;
vec3 radiance(vec2 uv, vec2 p) { return uColor * uGain; }
`,
  uniforms: (ctx) => ({ uColor: ctx.color('color'), uGain: ctx.num('gain') }),
}

/** Left-to-right ramp between two colors, mixed in linear light. */
export const rampProgram: RecipeProgram = {
  id: 'test.ramp',
  colorSlots: [
    { key: 'from', label: 'From' },
    { key: 'to', label: 'To' },
  ],
  defaultColors: ['#0B0F14', '#1C2B33'],
  params: [],
  fragment: /* glsl */ `
uniform vec3 uFrom;
uniform vec3 uTo;
vec3 radiance(vec2 uv, vec2 p) { return mix(uFrom, uTo, saturate(uv.x)); }
`,
  uniforms: (ctx) => ({ uFrom: ctx.color('from'), uTo: ctx.color('to') }),
}

const TONE_COLORS = [...new Set(PACKS.flatMap((pack) => packHexes(pack.id)))].concat(['#FF0000', '#00FF00', '#0000FF', '#FF00FF', '#00FFFF', '#FFFF00'])

/** Exported for the check report: intensity at frame position x in the ramps. */
export const TONE_RAMP_MAX = 16

/**
 * Tone-curve test image: one horizontal ramp per color with intensity
 * 16 * x^2 (x = 0..1, so intensity 1 sits at x = 0.25), then a row of glowing
 * dots and a row of glowing vertical lines at intensities 0.5 .. 32.
 */
export const toneProgram: RecipeProgram = {
  id: 'test.tone',
  colorSlots: [],
  defaultColors: [],
  params: [],
  fragment: /* glsl */ `
#define RAMP_COLORS ${TONE_COLORS.length}
uniform vec3 uRampColors[RAMP_COLORS];
uniform vec3 uDotColor;
uniform vec3 uLineColor;

vec3 radiance(vec2 uv, vec2 p) {
  float rampsEnd = 0.72;
  if (uv.y < rampsEnd) {
    float row = uv.y / rampsEnd * float(RAMP_COLORS);
    int index = int(floor(row));
    float inRow = fract(row);
    if (inRow > 0.88) return vec3(0.0);
    float x = saturate(uv.x);
    return uRampColors[index] * ${TONE_RAMP_MAX.toFixed(1)} * x * x;
  }
  float level = floor(uv.x * 7.0);
  float intensity = 0.5 * exp2(level);
  vec2 cell = vec2((level + 0.5) / 7.0, 0.0);
  if (uv.y < 0.86) {
    vec2 center = (vec2(cell.x, 0.79) - 0.5) * uFrameAspect;
    float d = length(p - center);
    return uDotColor * intensity * gaussianSum(d, vec3(0.004, 0.016, 0.05), vec3(1.0, 0.25, 0.05));
  }
  float lineX = (cell.x - 0.5) * uFrameAspect.x;
  float d = abs(p.x - lineX);
  float fade = smoothstep(0.87, 0.89, uv.y) * (1.0 - smoothstep(0.97, 0.99, uv.y));
  return uLineColor * intensity * fade * gaussianSum(d, vec3(0.002, 0.01, 0.04), vec3(1.0, 0.2, 0.04));
}
`,
  uniforms: () => ({
    uRampColors: TONE_COLORS.flatMap(hexToLinear),
    uDotColor: hexToLinear('#0064E0'),
    uLineColor: hexToLinear('#FF4F00'),
  }),
}

export const TONE_COLOR_LIST = TONE_COLORS

const PACK_COLORS = [...new Set(PACKS.flatMap((pack) => packHexes(pack.id)))]
export const GLOW_GAINS = [1.5, 3, 8]
/** Frame for the glow grid: 6 square cells across, one row per pack color. */
export const GLOW_GRID = { columns: 6, rows: PACK_COLORS.length }

/**
 * Soft glows crossing 1 inside the frame: one row per pack color, gaussian dots
 * then vertical gaussian lines, each at 1.5x, 3x and 8x nominal at the peak.
 */
export const glowsProgram: RecipeProgram = {
  id: 'test.glows',
  colorSlots: [],
  defaultColors: [],
  params: [],
  fragment: /* glsl */ `
#define GLOW_COLORS ${PACK_COLORS.length}
uniform vec3 uGlowColors[GLOW_COLORS];
const float GLOW_GAINS[3] = float[3](${GLOW_GAINS.map((g) => g.toFixed(1)).join(', ')});

vec3 radiance(vec2 uv, vec2 p) {
  vec2 grid = uv * vec2(${GLOW_GRID.columns.toFixed(1)}, float(GLOW_COLORS));
  int column = clamp(int(floor(grid.x)), 0, ${GLOW_GRID.columns - 1});
  int row = clamp(int(floor(grid.y)), 0, GLOW_COLORS - 1);
  vec2 q = fract(grid) - 0.5;
  float glow;
  if (column < 3) {
    glow = exp(-dot(q, q) / (2.0 * 0.125 * 0.125));
  } else {
    float along = abs(q.y) / 0.4375;
    float ends = along < 0.6 ? 1.0 : exp(-pow((along - 0.6) / 0.18, 2.0));
    glow = ends * exp(-q.x * q.x / (2.0 * 0.078 * 0.078));
  }
  return uGlowColors[row] * GLOW_GAINS[column % 3] * glow;
}
`,
  uniforms: () => ({ uGlowColors: PACK_COLORS.flatMap(hexToLinear) }),
}

/** Small bright spots spread by a radial blur: exercises the post-pass path. */
export const postProgram: RecipeProgram = {
  id: 'test.post',
  colorSlots: [
    { key: 'base', label: 'Base' },
    { key: 'light', label: 'Light' },
  ],
  defaultColors: ['#05080C', '#6FA8FF'],
  params: [{ kind: 'number', key: 'amount', label: 'Amount', min: 0, max: 0.95, step: 0.01, default: 0.5 }],
  fragment: /* glsl */ `
uniform vec3 uBase;
uniform vec3 uLight;
vec3 radiance(vec2 uv, vec2 p) {
  float spots = 0.0;
  for (int i = 0; i < 12; i++) {
    vec2 c = (vec2(hashIndex(i, uSeed), hashIndex(i + 40, uSeed)) - 0.5) * uFrameAspect * 0.9;
    spots += gaussian(length(p - c), 0.006 + 0.01 * hashIndex(i + 80, uSeed));
  }
  return uBase + uLight * 3.0 * spots;
}
`,
  uniforms: (ctx) => ({ uBase: ctx.color('base'), uLight: ctx.color('light') }),
  post: [{ kind: 'radialBlur', settings: (ctx) => ({ center: [0.5, 0.55], amount: ctx.num('amount') }) }],
  lens: { bloom: 0.1, halation: 0.3, halationThreshold: 0.5 },
}

/** Dots of rising intensity, a thin warm line and a blue disk on a near-black base, for lens checks. */
export const lensProgram: RecipeProgram = {
  id: 'test.lens',
  colorSlots: [],
  defaultColors: [],
  params: [{ kind: 'number', key: 'gain', label: 'Gain', min: 0, max: 16, step: 0.01, default: 1 }],
  fragment: /* glsl */ `
uniform float uGain;
vec3 radiance(vec2 uv, vec2 p) {
  vec3 c = vec3(0.004, 0.006, 0.01);
  for (int i = 0; i < 5; i++) {
    vec2 center = vec2((float(i) - 2.0) * 0.32 * uFrameAspect.x / 1.6, -0.28);
    c += vec3(0.9, 0.95, 1.0) * uGain * 0.25 * exp2(float(i)) * gaussian(length(p - center), 0.006);
  }
  float lineMask = smoothstep(-0.62, -0.6, p.x) * (1.0 - smoothstep(0.6, 0.62, p.x));
  c += vec3(1.0, 0.85, 0.6) * uGain * 4.0 * gaussian(abs(p.y - 0.02), 0.0015) * lineMask;
  c += vec3(0.3, 0.6, 1.0) * uGain * 2.0 * (1.0 - smoothstep(0.08, 0.085, length(p - vec2(0.0, 0.28))));
  return c;
}
`,
  uniforms: (ctx) => ({ uGain: ctx.num('gain') }),
}

/** One small gaussian point at the frame center (sigma 0.001 of the short side), for measuring blur widths. */
export const pointProgram: RecipeProgram = {
  id: 'test.point',
  colorSlots: [],
  defaultColors: [],
  params: [],
  fragment: /* glsl */ `
vec3 radiance(vec2 uv, vec2 p) { return vec3(0.5) * gaussian(length(p), 0.001); }
`,
  uniforms: () => ({}),
}

/** A flat disk of radius 0.03 of the short side on a flat base, for measuring blur widths. */
export const diskProgram: RecipeProgram = {
  id: 'test.disk',
  colorSlots: [],
  defaultColors: [],
  params: [
    { kind: 'number', key: 'base', label: 'Base', min: 0, max: 1, step: 0.01, default: 0 },
    { kind: 'number', key: 'disk', label: 'Disk', min: 0, max: 1, step: 0.01, default: 0.95 },
  ],
  fragment: /* glsl */ `
uniform float uBase;
uniform float uDisk;
vec3 radiance(vec2 uv, vec2 p) { return vec3(uBase + uDisk * step(length(p), 0.03)); }
`,
  uniforms: (ctx) => ({ uBase: ctx.num('base'), uDisk: ctx.num('disk') }),
}

export const TEST_PROGRAMS: Record<string, RecipeProgram> = {
  [pointProgram.id]: pointProgram,
  [diskProgram.id]: diskProgram,
  [flatProgram.id]: flatProgram,
  [rampProgram.id]: rampProgram,
  [toneProgram.id]: toneProgram,
  [glowsProgram.id]: glowsProgram,
  [postProgram.id]: postProgram,
  [lensProgram.id]: lensProgram,
}
