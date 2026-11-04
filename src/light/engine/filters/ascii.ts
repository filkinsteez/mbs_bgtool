import type { UniformMap } from '../../scene'
import { frameAspect } from '../frame'
import { ASCII_GLYPHS_GLSL } from '../glsl/ascii'
import type { FilterFrame, OutputFilter } from './types'

/**
 * The ASCII filter: the frame redrawn as a grid of characters, sized and
 * picked like the deck's filter tile (Figma 44:275; measurements in
 * docs/light/research/ascii.md, prototype in prototypes/ascii/).
 *
 * - 26 rows on the short side, 0.6 x 1.3 em cells, whole cells across and down,
 *   so the grid depends on the frame's aspect only and a 4K export has the same
 *   characters in the same places as the preview.
 * - Each cell aims for a level of the ramp from its mean light (the frame
 *   source) and picks its glyph uniformly from a 5-level window around it,
 *   seeded per cell, as the tile does. Levels stay within 2..7, the tile's
 *   sparsest and densest rows, so text is always a mix of glyphs.
 * - Each pixel keeps its own light; glyph and background split it so a cell
 *   keeps its mean light. Dark cells get light glyphs in the light's own color
 *   on a dimmed background ("pack-colored text on the dark base"); bright cells
 *   get dark ink, a deep nearly grey shade of the pixel's hue, on a background
 *   that brightens by the light the ink takes. Strength sets the contrast only.
 */

export const ASCII_ROWS_ON_SHORT_SIDE = 26
export const ASCII_LINE_EM = 1.3
export const ASCII_ADVANCE_EM = 0.6

/** Glyph ids (see asciiGlyph) from sparse to dense, sorted by ink: ' .:-+=*#%@'. */
export const ASCII_RAMP = [0, 1, 2, 3, 5, 4, 6, 7, 8, 9] as const
/** Ink share of a 0.6 x 1.3 em cell per ramp level, measured from the shapes at 512 px per em. */
export const ASCII_INK = [0, 0.017, 0.033, 0.0343, 0.079, 0.0855, 0.086, 0.2023, 0.2436, 0.3149] as const

/** Width of the uniform glyph pick in ramp levels, and the lowest and highest level a cell aims for. */
const WINDOW = 5
const LOWEST_LEVEL = 2
const TOP_LEVEL = 7
/** Share of the background light kept around light glyphs at strength 1. */
const LIGHT_BACKGROUND = 0.45
/** Brightest channel where light glyphs start and are fully in, above the frame's darkest light. */
const LIGHT_START = 0.004
const LIGHT_FULL = 0.03
/** Brightest channel where light glyphs hand over to dark ink. */
const PIVOT = 0.3
/** How fast dark ink thins out as a bright cell's room above its brightest channel shrinks. */
const DARK_SCALE = 0.18
/** Dark ink: Oklab lightness as a share of the pixel's, and its largest chroma. */
const INK_LIGHTNESS = 0.32
const INK_CHROMA = 0.035

export interface AsciiGrid {
  cols: number
  rows: number
  /** Cell size in output pixels. */
  cellW: number
  cellH: number
}

export function asciiGrid(frame: Pick<FilterFrame, 'width' | 'height'>): AsciiGrid {
  const aspect = frameAspect(frame.width, frame.height)
  const across = Math.max(aspect, 1)
  const down = Math.max(1 / aspect, 1)
  const cols = Math.max(1, Math.round((across * ASCII_ROWS_ON_SHORT_SIDE * ASCII_LINE_EM) / ASCII_ADVANCE_EM))
  const rows = Math.max(1, Math.round(down * ASCII_ROWS_ON_SHORT_SIDE))
  return { cols, rows, cellW: frame.width / cols, cellH: frame.height / rows }
}

export function asciiUniforms(strength: number, frame: FilterFrame): UniformMap {
  const grid = asciiGrid(frame)
  return {
    uAsciiGrid: [grid.cols, grid.rows],
    uAsciiCellPx: [grid.cellW, grid.cellH],
    uAsciiFramePx: [frame.width, frame.height],
    uAsciiEmPx: grid.cellH / ASCII_LINE_EM,
    uAsciiStrength: Math.min(1, Math.max(0, Number.isFinite(strength) ? strength : 0)),
  }
}

const f = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v))

const ASCII_GLSL =
  ASCII_GLYPHS_GLSL +
  /* glsl */ `
uniform sampler2D uAsciiCells;
uniform ivec2 uAsciiGrid;
uniform vec2 uAsciiCellPx;
uniform vec2 uAsciiFramePx;
uniform float uAsciiEmPx;
uniform float uAsciiStrength;

const int ASCII_RAMP[10] = int[10](${ASCII_RAMP.join(', ')});
const float ASCII_INK[10] = float[10](${ASCII_INK.map(f).join(', ')});

// Dither width at a level: the full window in the middle of the ramp, narrowing to one level at both ends so the
// pick never piles up at an end.
float asciiWindowAt(float level) {
  return clamp(min(1.0 + 2.0 * level, 1.0 + 2.0 * (9.0 - level)), 1.0, ${f(WINDOW)});
}

// Level picked with a uniform u in 0..1: uniform over the window around the level, rounded.
int asciiPickLevel(float level, float u) {
  float w = asciiWindowAt(level);
  return int(clamp(floor(level + w * (u - 0.5) + 0.5), 0.0, 9.0));
}

// Mean ink of the picked glyph over all u: each level weighted by the share of the window that rounds to it.
float asciiExpectedInk(float level) {
  float w = asciiWindowAt(level);
  float lo = level - 0.5 * w;
  float hi = level + 0.5 * w;
  float sum = 0.0;
  for (int i = 0; i < 10; i++) sum += max(min(hi, float(i) + 0.5) - max(lo, float(i) - 0.5), 0.0) * ASCII_INK[i];
  return sum / w;
}

// For a cell's light m and the frame's darkest light: x the level aimed for, y 1 for dark ink, z how much of the
// strength applies. Light glyphs carry a dark cell's light, so they need ink in proportion to it and stop where the
// densest mix can no longer hold it (the pivot); dark ink takes light from a bright cell, so it thins out as the
// brightest channel runs out of room above it. Both sides fade toward the pivot, so the handover is a clean band,
// and wherever there is text it is at least the tile's sparsest mix: faint text fades by contrast, not into lone dots.
vec3 asciiPlan(vec3 m, float base) {
  float P = maxComponent(m);
  if (P >= ${f(PIVOT)}) {
    float handover = smoothstep(${f(PIVOT)}, ${f(1.5 * PIVOT)}, P);
    float level = max(${f(LOWEST_LEVEL)}, ${f(TOP_LEVEL)} * (1.0 - exp(-(1.0 - P) / ${f(DARK_SCALE)})) * handover);
    return vec3(level, 1.0, handover);
  }
  // Light glyphs start a little above the frame's darkest light, so a dark base stays clean whatever its color.
  float start = base * 1.25 + ${f(LIGHT_START)};
  float full = base * 1.6 + ${f(LIGHT_FULL)};
  float away = 1.0 - smoothstep(${f(0.55 * PIVOT)}, ${f(PIVOT)}, P);
  float fade = smoothstep(start, full, P) * away;
  float level = fade > 0.0 ? max(${f(LOWEST_LEVEL)}, ${f(TOP_LEVEL)} * smoothstep(start, mix(full, ${f(PIVOT)}, 0.5), P) * away) : 0.0;
  return vec3(level, 0.0, fade);
}

// The frame's darkest light: the dimmest brightest channel among 8 x 5 cell lights spread over the frame.
float asciiBase() {
  float base = 1.0;
  for (int j = 0; j < 5; j++) {
    for (int i = 0; i < 8; i++) base = min(base, maxComponent(texture(uAsciiCells, (vec2(float(i), float(j)) + 0.5) / vec2(8.0, 5.0)).rgb));
  }
  return base;
}

// A deep, nearly grey shade of a light for dark ink: its Oklab hue, little chroma, a share of its lightness.
vec3 asciiDarkInk(vec3 c) {
  vec3 lab = linearToOklab(c);
  float chroma = length(lab.yz);
  vec2 ab = chroma > 1e-5 ? lab.yz * (min(0.3 * chroma, ${f(INK_CHROMA)}) / chroma) : vec2(0.0);
  return max(oklabToLinear(vec3(lab.x * ${f(INK_LIGHTNESS)}, ab)), 0.0);
}

vec3 filterAscii(vec3 display, ivec2 px, float weight) {
  vec2 pc = vec2(px) + 0.5;
  ivec2 cell = clamp(ivec2(floor(pc / uAsciiCellPx)), ivec2(0), uAsciiGrid - 1);
  vec2 local = pc - vec2(cell) * uAsciiCellPx;
  vec2 q = vec2(local.x - 0.5 * uAsciiCellPx.x, uAsciiCellPx.y - local.y) / uAsciiEmPx - vec2(0.0, ASCII_BASELINE);
  float base = asciiBase();
  int level = asciiPickLevel(asciiPlan(texelFetch(uAsciiCells, cell, 0).rgb, base).x, hash1(ivec3(cell, uSeed * 7 + 40503)));
  float ink = asciiInk(ASCII_RAMP[level], q, 1.0 / uAsciiEmPx);

  // Gains follow the cell light smoothed between cell centres, so backgrounds show no cell edges. They keep the
  // light of a cell whose glyph has the expected ink of its pick: ink * glyph + (1 - ink) * background = light.
  vec3 m = max(sampleSmooth(uAsciiCells, pc / uAsciiFramePx), 0.0);
  vec3 plan = asciiPlan(m, base);
  float c = asciiExpectedInk(plan.x);
  float s = uAsciiStrength * plan.z;
  if (c <= 1e-4 || s <= 0.0) return display;
  if (plan.y > 0.5) {
    // Dark ink; the background brightens by the light the ink takes, as far as every channel has room.
    vec3 deep = asciiDarkInk(display);
    vec3 lift = c * (display - deep) / (1.0 - c);
    vec3 room = (1.0 - display) / max(lift, 1e-6);
    float t = min(s, min(lift.r > 1e-6 ? room.r : 1e9, min(lift.g > 1e-6 ? room.g : 1e9, lift.b > 1e-6 ? room.b : 1e9)));
    return mix(display + t * lift, mix(display, deep, t), ink);
  }
  // Light glyphs: the glyph carries the cell's light and the background dims, within the brightest channel's room.
  float Pm = max(maxComponent(m), 1e-5);
  float back = 1.0 - s * ${f(1 - LIGHT_BACKGROUND)};
  float glyph = (1.0 - (1.0 - c) * back) / c;
  if (glyph * Pm > 1.0) {
    glyph = 1.0 / Pm;
    back = (1.0 - c * glyph) / (1.0 - c);
  }
  // A thin core much brighter than its cell (a rim's hottest line) keeps its own light.
  float keep = smoothstep(1.5, 4.0, maxComponent(display) / Pm);
  return display * mix(mix(back, glyph, ink), 1.0, keep);
}
`

/** The ASCII stage of the output filter chain. */
export const ASCII_FILTER: OutputFilter = {
  key: 'ascii',
  glsl: ASCII_GLSL,
  apply: 'filterAscii',
  uniforms: asciiUniforms,
  source: {
    uniform: 'uAsciiCells',
    size: (frame) => {
      const grid = asciiGrid(frame)
      return { width: grid.cols, height: grid.rows }
    },
  },
}
