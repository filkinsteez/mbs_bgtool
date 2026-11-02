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

/** Rows of the tie glow sheet: a warm Bold color alone, then overlapping a cool one, which mixes through channel ties. */
export const TIE_GLOW_ROWS = [
  ['#FFD61E', null],
  ['#FFD61E', '#1FCDF0'],
  ['#FFD61E', '#0064E0'],
  ['#FF4F00', null],
  ['#FF4F00', '#1FCDF0'],
  ['#FF4F00', '#0064E0'],
] as const
export const TIE_GLOW_GRID = { columns: GLOW_GAINS.length, rows: TIE_GLOW_ROWS.length }

/**
 * Hot glows that cross channel ties: per row a warm glow on the left and, in
 * the mixed rows, a cool glow on the right overlapping it, so the light in the
 * overlap runs through every mix of the two. Columns are 1.5x, 3x and 8x
 * nominal at each glow's peak.
 */
export const toneTiesProgram: RecipeProgram = {
  id: 'test.toneties',
  colorSlots: [],
  defaultColors: [],
  params: [],
  fragment: /* glsl */ `
#define ROWS ${TIE_GLOW_ROWS.length}
uniform vec3 uWarm[ROWS];
uniform vec3 uCool[ROWS];
const float GAINS[3] = float[3](${GLOW_GAINS.map((g) => g.toFixed(1)).join(', ')});

vec3 radiance(vec2 uv, vec2 p) {
  vec2 grid = uv * vec2(${TIE_GLOW_GRID.columns.toFixed(1)}, float(ROWS));
  int column = clamp(int(floor(grid.x)), 0, ${TIE_GLOW_GRID.columns - 1});
  int row = clamp(int(floor(grid.y)), 0, ROWS - 1);
  vec2 q = fract(grid) - 0.5;
  vec2 a = q - vec2(-0.13, 0.0);
  vec2 b = q - vec2(0.13, 0.0);
  float s = 2.0 * 0.12 * 0.12;
  return GAINS[column] * (uWarm[row] * exp(-dot(a, a) / s) + uCool[row] * exp(-dot(b, b) / s));
}
`,
  uniforms: () => ({
    uWarm: TIE_GLOW_ROWS.flatMap(([warm]) => hexToLinear(warm)),
    uCool: TIE_GLOW_ROWS.flatMap(([, cool]) => (cool ? hexToLinear(cool) : [0, 0, 0])),
  }),
}

/** Rows of the dim-light sheet: a warm pack color as light over a base (a dark pack color, a dim Meta Blue, or black). */
export const DIM_ROWS = [
  { light: '#FFD61E', base: '#000000', baseLevel: 0 },
  { light: '#FFD61E', base: '#0064E0', baseLevel: 0.1 },
  { light: '#FF4F00', base: '#000000', baseLevel: 0 },
  { light: '#FF4F00', base: '#0064E0', baseLevel: 0.1 },
  { light: '#D6F26C', base: '#000000', baseLevel: 0 },
  { light: '#D6F26C', base: '#0F3D33', baseLevel: 1 },
  { light: '#D6F26C', base: '#4A0A3C', baseLevel: 1 },
  { light: '#B8996E', base: '#000000', baseLevel: 0 },
  { light: '#B8996E', base: '#0F3D33', baseLevel: 1 },
  { light: '#B8996E', base: '#4A0A3C', baseLevel: 1 },
] as const
/** The light runs from DIM_RAMP_LOW x nominal at the left edge to 1x at the right, evenly in stops. */
export const DIM_RAMP_LOW = 0.05

/**
 * One row per DIM_ROWS entry: the base plus the light at 0.05x to 1x nominal,
 * left to right in stops. The colors are slots, so the paper toe pre-inverts
 * them like a recipe's.
 */
export const dimRampsProgram: RecipeProgram = {
  id: 'test.dimramps',
  colorSlots: DIM_ROWS.flatMap((_, i) => [
    { key: `light${i}`, label: `Light ${i + 1}` },
    { key: `base${i}`, label: `Base ${i + 1}` },
  ]),
  defaultColors: DIM_ROWS.flatMap((row) => [row.light, row.base]),
  params: [],
  fragment: /* glsl */ `
#define ROWS ${DIM_ROWS.length}
uniform vec3 uLight[ROWS];
uniform vec3 uBase[ROWS];

vec3 radiance(vec2 uv, vec2 p) {
  int row = clamp(int(floor(uv.y * float(ROWS))), 0, ROWS - 1);
  float level = ${DIM_RAMP_LOW.toFixed(2)} * pow(${(1 / DIM_RAMP_LOW).toFixed(1)}, uv.x);
  return uBase[row] + uLight[row] * level;
}
`,
  uniforms: (ctx) => ({
    uLight: DIM_ROWS.flatMap((_, i) => ctx.color(`light${i}`)),
    uBase: DIM_ROWS.flatMap((row, i) => ctx.color(`base${i}`).map((v) => v * row.baseLevel)),
  }),
}

/**
 * Two overlapping rings on black. auxRadiance carries each ring's light in its
 * own channel (r: ring A, g: ring B); combine puts the blurred light of the
 * other ring inside each disc, plus a faint haze of all light (a second blur of
 * radiance) inside both. `amount` 0 turns the scattered light off.
 */
export const scatterProgram: RecipeProgram = {
  id: 'test.scatter',
  colorSlots: [
    { key: 'ringA', label: 'Ring A' },
    { key: 'ringB', label: 'Ring B' },
  ],
  defaultColors: ['#5AB4FF', '#FF7A4A'],
  params: [
    { kind: 'number', key: 'amount', label: 'Amount', min: 0, max: 8, step: 0.01, default: 3 },
    { kind: 'number', key: 'radius', label: 'Radius', min: 0, max: 0.3, step: 0.005, default: 0.06 },
  ],
  fragment: /* glsl */ `
uniform vec3 uRingA;
uniform vec3 uRingB;
uniform float uAmount;
const vec2 CENTER_A = vec2(-0.12, -0.16);
const vec2 CENTER_B = vec2(0.1, 0.2);
const float RADIUS_A = 0.34;
const float RADIUS_B = 0.3;

float rim(vec2 p, vec2 center, float radius) {
  float d = length(p - center) - radius;
  return gaussianSum(abs(d), vec3(0.003, 0.012, 0.04), vec3(1.2, 0.3, 0.05)) * mix(1.0, 0.6, smoothstep(-0.006, 0.006, d));
}
float inside(vec2 p, vec2 center, float radius) { return 1.0 - smoothstep(-0.01, 0.01, length(p - center) - radius); }

vec3 radiance(vec2 uv, vec2 p) {
  return uRingA * rim(p, CENTER_A, RADIUS_A) + uRingB * rim(p, CENTER_B, RADIUS_B);
}
vec3 auxRadiance(vec2 uv, vec2 p) {
  return vec3(rim(p, CENTER_A, RADIUS_A), rim(p, CENTER_B, RADIUS_B), 0.0);
}
vec3 combine(vec2 uv, vec2 p, vec3 light, vec3 others, vec3 haze) {
  vec3 intoB = uRingA * others.r * inside(p, CENTER_B, RADIUS_B);
  vec3 intoA = uRingB * others.g * inside(p, CENTER_A, RADIUS_A);
  float discs = max(inside(p, CENTER_A, RADIUS_A), inside(p, CENTER_B, RADIUS_B));
  return light + uAmount * (intoA + intoB + 0.15 * haze * discs);
}
`,
  uniforms: (ctx) => ({ uRingA: ctx.color('ringA'), uRingB: ctx.color('ringB'), uAmount: ctx.num('amount') }),
  scatter: [
    { source: 'aux', radius: (ctx) => ctx.num('radius') },
    { source: 'radiance', radius: (ctx) => ctx.num('radius') * 2.5 },
  ],
}

/** Flat fields: radiance (0.2, 0.3, 0.4), aux (0.8, 0.4, 0); combine returns 0.5 radiance + 0.5 blurred0 + 0.25 blurred1. */
export const scatterFlatProgram: RecipeProgram = {
  id: 'test.scatter.flat',
  colorSlots: [],
  defaultColors: [],
  params: [],
  fragment: /* glsl */ `
vec3 radiance(vec2 uv, vec2 p) { return vec3(0.2, 0.3, 0.4); }
vec3 auxRadiance(vec2 uv, vec2 p) { return vec3(0.8, 0.4, 0.0); }
vec3 combine(vec2 uv, vec2 p, vec3 light, vec3 blurred0, vec3 blurred1) { return 0.5 * light + 0.5 * blurred0 + 0.25 * blurred1; }
`,
  uniforms: () => ({}),
  scatter: [
    { source: 'radiance', radius: () => 0.05 },
    { source: 'aux', radius: () => 0.1 },
  ],
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

/**
 * A Meta Blue disk, a thin warm-white line and an orange-red dot, each at its own gain x nominal (gain 1: every
 * channel at most 1), on a neutral background of linear level `background`, for halation checks.
 */
export const halationProgram: RecipeProgram = {
  id: 'test.halation',
  colorSlots: [],
  defaultColors: [],
  params: [
    { kind: 'number', key: 'blue', label: 'Blue disk', min: 0, max: 16, step: 0.01, default: 4 },
    { kind: 'number', key: 'white', label: 'White line', min: 0, max: 16, step: 0.01, default: 4 },
    { kind: 'number', key: 'orange', label: 'Orange dot', min: 0, max: 16, step: 0.01, default: 4 },
    { kind: 'number', key: 'background', label: 'Background', min: 0, max: 1, step: 0.01, default: 0 },
    { kind: 'number', key: 'glow', label: 'Scene glow around the line', min: 0, max: 2, step: 0.01, default: 0 },
  ],
  fragment: /* glsl */ `
uniform vec3 uGains;
uniform float uBackground;
uniform float uGlow;
vec3 radiance(vec2 uv, vec2 p) {
  vec3 light = uGains.x * vec3(0.0, 0.127, 0.745) * (1.0 - smoothstep(0.1, 0.106, length(p - vec2(-0.45, 0.0))));
  float across = p.x / 0.0025;
  float along = 1.0 - smoothstep(0.3, 0.32, abs(p.y));
  light += uGains.y * vec3(1.0, 0.92, 0.8) * exp(-0.5 * across * across) * along;
  light += uGlow * vec3(1.0, 0.45, 0.15) * exp(-abs(p.x) / 0.02) * along;
  light += uGains.z * vec3(1.0, 0.078, 0.0) * exp(-0.5 * dot(p - vec2(0.45, 0.0), p - vec2(0.45, 0.0)) / (0.012 * 0.012));
  return uBackground * vec3(0.8, 0.82, 0.85) + light;
}
`,
  uniforms: (ctx) => ({ uGains: [ctx.num('blue'), ctx.num('white'), ctx.num('orange')], uBackground: ctx.num('background'), uGlow: ctx.num('glow') }),
}

/** A flat field whose grain weight is `left` on the left half of the frame and `right` on the right half. */
export const grainWeightProgram: RecipeProgram = {
  id: 'test.grainweight',
  colorSlots: [{ key: 'color', label: 'Color' }],
  defaultColors: ['#555555'],
  params: [
    { kind: 'number', key: 'left', label: 'Left weight', min: 0, max: 1, step: 0.01, default: 1 },
    { kind: 'number', key: 'right', label: 'Right weight', min: 0, max: 1, step: 0.01, default: 0.25 },
  ],
  fragment: /* glsl */ `
uniform vec3 uColor;
uniform vec2 uWeights;
vec3 radiance(vec2 uv, vec2 p) { return uColor; }
float grainWeight(vec2 uv, vec2 p) { return uv.x < 0.5 ? uWeights.x : uWeights.y; }
`,
  uniforms: (ctx) => ({ uColor: ctx.color('color'), uWeights: [ctx.num('left'), ctx.num('right')] }),
  grainWeight: true,
}

/** The same through a post pass, so the weight has to survive the post-pass textures. */
export const grainWeightPostProgram: RecipeProgram = {
  ...grainWeightProgram,
  id: 'test.grainweight.post',
  post: [{ kind: 'gaussianBlur', settings: () => ({ radius: 0.002 }) }],
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
  [toneTiesProgram.id]: toneTiesProgram,
  [dimRampsProgram.id]: dimRampsProgram,
  [scatterProgram.id]: scatterProgram,
  [scatterFlatProgram.id]: scatterFlatProgram,
  [postProgram.id]: postProgram,
  [lensProgram.id]: lensProgram,
  [halationProgram.id]: halationProgram,
  [grainWeightProgram.id]: grainWeightProgram,
  [grainWeightPostProgram.id]: grainWeightPostProgram,
}
