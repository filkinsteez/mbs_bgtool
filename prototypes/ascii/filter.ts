// ASCII filter, prototype version. Shaped like the engine's OutputFilter (src/light/engine/filters/types.ts):
// GLSL with `vec3 filterAscii(vec3 display, ivec2 px, float weight)`, uniforms per strength and frame, and a
// per-cell frame source (each texel the mean of 4 x 4 samples over one cell, row 0 at the top).

export interface Frame {
  width: number
  height: number
  seed: number
}

/** Rows of characters on the short side, measured in the Figma filter tile (26 rows in 440 px). */
export const ROWS_ON_SHORT_SIDE = 26
/** Line height and advance of the tile's Roboto Mono, in em. */
export const LINE_EM = 1.3
export const ADVANCE_EM = 0.6

export interface Grid {
  cols: number
  rows: number
  cellW: number
  cellH: number
}

/** Whole cells across and down: they depend on the frame's aspect only, so every export size gets the same grid. */
export function asciiGrid(frame: { width: number; height: number }, rowsOnShort = ROWS_ON_SHORT_SIDE): Grid {
  const short = Math.min(frame.width, frame.height)
  const cellH = short / rowsOnShort
  const cellW = (cellH * ADVANCE_EM) / LINE_EM
  const cols = Math.max(1, Math.round(frame.width / cellW))
  const rows = Math.max(1, Math.round(frame.height / cellH))
  return { cols, rows, cellW: frame.width / cols, cellH: frame.height / rows }
}

export interface Knobs {
  rowsOnShort: number
  /** Width of the uniform glyph dither in ramp levels (the tile: 5). */
  window: number
  /** Highest level a cell aims for; with the window it keeps a mix of glyphs (the tile's densest rows: level 7). */
  topLevel: number
  /** Lowest level wherever there is text (the tile's sparsest rows: level 2). */
  minLevel: number
  /** Share of the background light kept around light glyphs at strength 1. */
  litFloor: number
  /** Brightest channel where light glyphs start, are fully in, and hand over to dark glyphs. */
  litStart: number
  litFull: number
  pivot: number
  /** How fast dark glyphs thin out as a bright cell's headroom (1 - brightest channel) shrinks. */
  darkScale: number
  /** Dark ink: Oklab lightness as a share of the pixel's, and its largest chroma. */
  inkLightness: number
  inkChroma: number
}

export const DEFAULT_KNOBS: Knobs = {
  rowsOnShort: ROWS_ON_SHORT_SIDE,
  window: 5,
  topLevel: 7,
  minLevel: 2,
  litFloor: 0.45,
  litStart: 0.004,
  litFull: 0.03,
  pivot: 0.3,
  darkScale: 0.18,
  inkLightness: 0.32,
  inkChroma: 0.035,
}

/** Glyph ids in the tile's ramp order, sparse to dense: ' .:-=+*#%@'. */
export const RAMP = ' .:-=+*#%@'

export interface Ramp {
  /** Glyph id per level, sorted by ink. */
  order: number[]
  /** Ink share of the cell per level (ascending). */
  coverage: number[]
}

export function asciiUniforms(strength: number, frame: Frame, knobs: Knobs, ramp: Ramp) {
  const grid = asciiGrid(frame, knobs.rowsOnShort)
  return {
    uAsciiGrid: [grid.cols, grid.rows],
    uAsciiCellPx: [grid.cellW, grid.cellH],
    uAsciiFramePx: [frame.width, frame.height],
    uAsciiEmPx: grid.cellH / LINE_EM,
    uAsciiStrength: Math.min(1, Math.max(0, strength)),
    uAsciiWindow: knobs.window,
    uAsciiTopLevel: knobs.topLevel,
    uAsciiMinLevel: knobs.minLevel,
    uAsciiLitFloor: knobs.litFloor,
    uAsciiLit: [knobs.litStart, knobs.litFull, knobs.pivot],
    uAsciiDarkScale: knobs.darkScale,
    uAsciiInk: [knobs.inkLightness, knobs.inkChroma],
    uAsciiOrder: ramp.order,
    uAsciiCoverage: ramp.coverage,
  }
}

/** Glyph shapes only (for measuring ink and for glyph sheets). Needs the chunk library (SDFs). */
export const ASCII_GLYPHS_GLSL = /* glsl */ `
// Baseline above the bottom of a 1.3 em line: half the leading plus Optimistic's descent.
const float ASCII_BASELINE = 0.42;
const float ASCII_HALF_STROKE = 0.04;

// Signed distance to an ellipse outline (Quilez's first-order estimate), good within a few pixels of it.
float asciiEllipse(vec2 q, vec2 r) {
  float k0 = length(q / r);
  float k1 = length(q / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 1e-6);
}

// Ring along an ellipse of mid radii r from angle a0 to a1 (radians on the circle the ellipse maps to), round ends.
float asciiEllipseArc(vec2 q, vec2 r, float a0, float a1, float halfWidth) {
  float a = atan(q.y / r.y, q.x / r.x);
  float mid = 0.5 * (a0 + a1);
  float rel = mod(a - mid + PI, TAU) - PI;
  if (abs(rel) <= 0.5 * (a1 - a0)) return abs(asciiEllipse(q, r)) - halfWidth;
  vec2 e0 = r * vec2(cos(a0), sin(a0));
  vec2 e1 = r * vec2(cos(a1), sin(a1));
  return min(length(q - e0), length(q - e1)) - halfWidth;
}

// A bar from the origin along dir, length len, flat ends.
float asciiArm(vec2 q, vec2 dir, float len, float halfWidth) {
  vec2 r = vec2(dot(q, vec2(dir.y, -dir.x)), dot(q, dir));
  return sdBox(r, vec2(0.0, 0.5 * len), vec2(halfWidth, 0.5 * len));
}

// A slanted stroke from y0 to y1 whose centre line is x = x0 + slope * (y - yc), cut level at both ends.
float asciiSlant(vec2 q, float x0, float slope, float yc, float y0, float y1, float halfRun) {
  float across = (abs(q.x - (x0 + slope * (q.y - yc))) - halfRun) / sqrt(1.0 + slope * slope);
  float along = abs(q.y - 0.5 * (y0 + y1)) - 0.5 * (y1 - y0);
  return length(max(vec2(across, along), 0.0)) + min(max(across, along), 0.0);
}

// The ramp's glyphs (1 '.', 2 ':', 3 '-', 4 '=', 5 '+', 6 '*', 7 '#', 8 '%', 9 '@') in em, x from the cell centre,
// y up from the baseline. Proportions follow Optimistic VF Regular, the deck's font; '#', '%' and '@' are narrowed
// to the 0.6 em cell the way a monospace font narrows them, with the stroke kept.
float asciiGlyph(int g, vec2 q) {
  float h = ASCII_HALF_STROKE;
  if (g == 1) return sdCircle(q, vec2(0.0, 0.0575), 0.065);
  if (g == 2) return min(sdCircle(q, vec2(0.0, 0.0575), 0.064), sdCircle(q, vec2(0.0, 0.455), 0.064));
  if (g == 3) return sdBox(q, vec2(0.0, 0.2725), vec2(0.1675, h));
  if (g == 4) return min(sdBox(q, vec2(0.0, 0.2512), vec2(0.21, 0.0397)), sdBox(q, vec2(0.0, 0.4512), vec2(0.21, 0.0397)));
  if (g == 5) return min(sdBox(q, vec2(0.0, 0.35), vec2(0.2155, h)), sdBox(q, vec2(0.0, 0.35), vec2(h, 0.21)));
  if (g == 6) {
    vec2 c = q - vec2(0.0, 0.531);
    float d = 1e9;
    for (int k = 0; k < 5; k++) {
      float a = radians(72.0 * float(k));
      d = min(d, asciiArm(c, vec2(sin(a), cos(a)), 0.199, 0.039));
    }
    return d;
  }
  if (g == 7) {
    float d = min(asciiSlant(q, -0.12, 0.195, 0.35, 0.0, 0.7, h), asciiSlant(q, 0.12, 0.195, 0.35, 0.0, 0.7, h));
    d = min(d, sdBox(q, vec2(-0.027, 0.215), vec2(0.241, 0.0356)));
    return min(d, sdBox(q, vec2(0.027, 0.4875), vec2(0.241, 0.0356)));
  }
  if (g == 8) {
    float d = abs(asciiEllipse(q - vec2(-0.15, 0.515), vec2(0.105, 0.14))) - 0.0385;
    d = min(d, abs(asciiEllipse(q - vec2(0.15, 0.187), vec2(0.105, 0.14))) - 0.0385);
    return min(d, asciiSlant(q, 0.0, 0.55, 0.35, -0.005, 0.705, 0.05));
  }
  if (g == 9) {
    float d = asciiEllipseArc(q - vec2(0.0, 0.254), vec2(0.268, 0.4), radians(-16.0), radians(290.0), h);
    d = min(d, abs(asciiEllipse(q - vec2(-0.009, 0.253), vec2(0.112, 0.185))) - 0.0385);
    d = min(d, sdBox(q, vec2(0.111, 0.3225), vec2(0.042, 0.1525)));
    return min(d, asciiEllipseArc(q - vec2(0.188, 0.17), vec2(0.077, 0.115), radians(180.0), radians(346.0), h));
  }
  return 1e9;
}

// Ink of glyph g at q (em), box-filtered over one pixel of pxEm em.
float asciiInk(int g, vec2 q, float pxEm) {
  if (g <= 0) return 0.0;
  return saturate(0.5 - asciiGlyph(g, q) / pxEm);
}
`

/** The whole stage. Needs the chunk library (hashes, SDFs, Oklab) and `uniform int uSeed;`. */
export const ASCII_GLSL =
  ASCII_GLYPHS_GLSL +
  /* glsl */ `
uniform sampler2D uAsciiCells;
uniform ivec2 uAsciiGrid;
uniform vec2 uAsciiCellPx;
uniform vec2 uAsciiFramePx;
uniform float uAsciiEmPx;
uniform float uAsciiStrength;
uniform float uAsciiWindow;
uniform float uAsciiTopLevel;
uniform float uAsciiMinLevel;
uniform float uAsciiLitFloor;
uniform vec3 uAsciiLit;       // start, full, pivot (brightest channel)
uniform float uAsciiDarkScale;
uniform vec2 uAsciiInk;       // dark ink lightness share, largest chroma
uniform int uAsciiOrder[10];
uniform float uAsciiCoverage[10];

float asciiCoverageAt(float level) {
  float l = clamp(level, 0.0, 9.0);
  int i = min(int(floor(l)), 8);
  return mix(uAsciiCoverage[i], uAsciiCoverage[i + 1], l - float(i));
}

float asciiLevelFor(float coverage) {
  if (coverage <= 0.0) return 0.0;
  for (int i = 0; i < 9; i++) {
    float a = uAsciiCoverage[i];
    float b = uAsciiCoverage[i + 1];
    if (coverage <= b) return float(i) + (b > a ? (coverage - a) / (b - a) : 1.0);
  }
  return 9.0;
}

// Dither width at a level: the full window in the middle of the ramp, narrowing to one level at both ends so the
// pick never piles up at an end (a near-black base gets no dots, the densest glyph is not overused).
float asciiWindowAt(float level) {
  return clamp(min(1.0 + 2.0 * level, 1.0 + 2.0 * (9.0 - level)), 1.0, max(uAsciiWindow, 1.0));
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
  for (int i = 0; i < 10; i++) {
    float a = max(lo, float(i) - 0.5);
    float b = min(hi, float(i) + 0.5);
    sum += max(b - a, 0.0) * uAsciiCoverage[i];
  }
  return sum / w;
}

// For a cell's light m: x the level aimed for, y 1 when its glyphs are dark ink (the cell is bright), z how much of
// the strength applies. Light glyphs carry the light of dark cells, so they need ink in proportion to the light and
// stop where the densest mix can no longer hold it (the pivot); dark glyphs take light from bright cells, so they thin
// out as the brightest channel runs out of room above it. The strength fades to 0 at the pivot from both sides, and
// on dark bases.
vec3 asciiPlan(vec3 m, float base) {
  float P = maxComponent(m);
  float pivot = uAsciiLit.z;
  // Wherever there is text it is at least the tile's sparsest mix; faint text fades by contrast, not by thinning out
  // to lone dots. Both sides thin out and fade toward the pivot, so the change from light to dark glyphs is a clean
  // band.
  float lowest = uAsciiMinLevel;
  if (P >= pivot) {
    float handover = smoothstep(pivot, 1.5 * pivot, P);
    float level = max(lowest, uAsciiTopLevel * (1.0 - exp(-(1.0 - P) / uAsciiDarkScale)) * handover);
    return vec3(level, 1.0, handover);
  }
  // Light glyphs start a little above the frame's darkest light, so a dark base stays clean whatever its color.
  float start = base * 1.25 + uAsciiLit.x;
  float full = base * 1.6 + uAsciiLit.y;
  float away = 1.0 - smoothstep(0.55 * pivot, pivot, P);
  float fade = smoothstep(start, full, P) * away;
  float level = fade > 0.0 ? max(lowest, uAsciiTopLevel * smoothstep(start, mix(full, pivot, 0.5), P) * away) : 0.0;
  return vec3(level, 0.0, fade);
}

// The frame's darkest light: the dimmest brightest-channel among 8 x 5 cell lights spread over the frame.
float asciiBase() {
  float base = 1.0;
  for (int j = 0; j < 5; j++) {
    for (int i = 0; i < 8; i++) base = min(base, maxComponent(texture(uAsciiCells, (vec2(float(i), float(j)) + 0.5) / vec2(8.0, 5.0)).rgb));
  }
  return base;
}

// A deep, nearly grey shade of a light for dark glyphs: its Oklab hue, little chroma, a share of its lightness.
vec3 asciiDarkInk(vec3 c) {
  vec3 lab = linearToOklab(c);
  float chroma = length(lab.yz);
  vec2 ab = chroma > 1e-5 ? lab.yz * (min(0.3 * chroma, uAsciiInk.y) / chroma) : vec2(0.0);
  return max(oklabToLinear(vec3(lab.x * uAsciiInk.x, ab)), 0.0);
}

vec3 filterAscii(vec3 display, ivec2 px, float weight) {
  vec2 pc = vec2(px) + 0.5;
  ivec2 cell = clamp(ivec2(floor(pc / uAsciiCellPx)), ivec2(0), uAsciiGrid - 1);
  vec2 local = pc - vec2(cell) * uAsciiCellPx;
  vec2 q = vec2(local.x - 0.5 * uAsciiCellPx.x, uAsciiCellPx.y - local.y) / uAsciiEmPx - vec2(0.0, ASCII_BASELINE);
  float base = asciiBase();
  int level = asciiPickLevel(asciiPlan(texelFetch(uAsciiCells, cell, 0).rgb, base).x, hash1(ivec3(cell, uSeed * 7 + 40503)));
  float ink = asciiInk(uAsciiOrder[level], q, 1.0 / uAsciiEmPx);

  // Gains follow the cell light smoothed between cell centres, so backgrounds show no cell edges. They keep the
  // light of a cell whose glyph has the expected ink of its dither: ink * glyph + (1 - ink) * background = light.
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
  // Light ink: the glyph carries the cell's light and the background dims, within the brightest channel's room.
  float Pm = max(maxComponent(m), 1e-5);
  float back = 1.0 - s * (1.0 - uAsciiLitFloor);
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
