import type { UniformMap } from '../../scene'
import { frameAspect } from '../frame'
import type { FilterFrame, OutputFilter } from './types'

/**
 * The Pixel filter (prototypes/pixel, docs/light/research/pixel.md): the frame quantized to a grid of square cells,
 * seen as an LED wall up close. It is fully on at every slider value.
 *
 * - The slider sets density: cells on the short side, from 18 at 0 to 72 at 1 on a log scale, 36 at 0.5. Cells are
 *   whole across and down, so the grid depends on the frame's aspect and the density only, and a preview shows the
 *   same cells as the export. Between whole cell counts nothing changes.
 * - Each cell shows its mean color, flat, and blends into its neighbours over about a quarter of a cell.
 * - A rounded-square LED brightens the middle of each cell and darkens the gaps by the same amount of light, so every
 *   cell keeps its mean color. A channel near 1 has little room to brighten, so its share of the pattern shrinks with
 *   its room: bright LEDs turn paler in the middle with their color in the gaps, and white has no pattern.
 * - The soft edges hand a brighter cell's light to its darker neighbours; that light goes back into the brighter
 *   cell's LED, so a light cell is never dimmed (a thin bright line keeps its brightness). A darker cell keeps the
 *   little it gets, as there is no light in it to take back.
 */

/** Cells on the short side at density 0.5. 36 fills 16:9, 9:16, 1:1 and 4:5 frames with whole square cells. */
export const PIXEL_CELLS = 36
/** Cells on the short side at density 0 and 1; between them the count grows by the same ratio per step. */
export const PIXEL_MIN_CELLS = 18
export const PIXEL_MAX_CELLS = 72
/**
 * The frame source has two texels a cell of the densest grid each way, each the mean of 2 x 2 samples (3.75 px apart
 * at 1080p, close enough for a Contour line), at every density. Its size depends on the frame's aspect only, as the
 * chain asks; a cell's mean is read from the texels it covers.
 */
export const PIXEL_SOURCE_TEXELS_PER_CELL = 2
const SOURCE_SAMPLES = 2
/** How sharply a cell blends into the next: weight t^4 / (t^4 + (1 - t)^4), over about a quarter of a cell. */
const BLEND_POWER = 4
/** The LED: a rounded square of half-size 0.42 cell, its edge 0.16 cell wide, superellipse corners of exponent 4. */
const LED_HALF = 0.42
const LED_EDGE = 0.16
const LED_CORNER = 4
/** The gaps are this much darker than the cell; the middle is brighter by the same amount of light. */
export const PIXEL_CONTRAST = 0.15
/** Cell size in output pixels over which the LED fades in, so small previews show cells without moiré. */
const LED_FADE_PX = [3, 6] as const

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** The LED's brightness at offset (x, y) from its cell's center, in cells. */
export function ledShape(x: number, y: number): number {
  const d = (Math.abs(x) ** LED_CORNER + Math.abs(y) ** LED_CORNER) ** (1 / LED_CORNER)
  return 1 - smoothstep(LED_HALF - LED_EDGE / 2, LED_HALF + LED_EDGE / 2, d)
}

/** The LED's mean over its cell, so that ledShape / PIXEL_LED_AREA averages 1 over a cell. */
export const PIXEL_LED_AREA = (() => {
  const n = 256
  let sum = 0
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) sum += ledShape((i + 0.5) / n - 0.5, (j + 0.5) / n - 0.5)
  return sum / (n * n)
})()

/**
 * How much of a cell's width its soft edge hands to one neighbour, per unit of color difference: the blend weight
 * t^p / (t^p + (1 - t)^p) integrated over the cell's half, t from 0 to 0.5.
 */
export function blendShare(power: number): number {
  const n = 4096
  let sum = 0
  for (let i = 0; i < n; i++) {
    const t = ((i + 0.5) / n) * 0.5
    sum += t ** power / (t ** power + (1 - t) ** power)
  }
  return (sum / n) * 0.5
}

const BLEND_SHARE = blendShare(BLEND_POWER)

/** Cells on the short side for a density 0..1 (a missing value gives 36). */
export function pixelCells(density: number): number {
  const d = Number.isFinite(density) ? Math.min(1, Math.max(0, density)) : 0.5
  return Math.round(PIXEL_MIN_CELLS * (PIXEL_MAX_CELLS / PIXEL_MIN_CELLS) ** d)
}

function gridOf(frame: Pick<FilterFrame, 'width' | 'height'>, cellsOnShort: number): { across: number; down: number } {
  const aspect = frameAspect(frame.width, frame.height)
  const long = Math.max(1, Math.round(cellsOnShort * Math.max(aspect, 1 / aspect)))
  return aspect >= 1 ? { across: long, down: cellsOnShort } : { across: cellsOnShort, down: long }
}

/** Cells across and down at a density (0.5 by default): pixelCells on the short side, a whole number on the long side. */
export function pixelGrid(frame: Pick<FilterFrame, 'width' | 'height'>, density = 0.5): { across: number; down: number } {
  return gridOf(frame, pixelCells(density))
}

/** The frame source's texels, the same at every density. */
export function pixelSourceSize(frame: Pick<FilterFrame, 'width' | 'height'>): { width: number; height: number } {
  const { across, down } = gridOf(frame, PIXEL_MAX_CELLS)
  return { width: across * PIXEL_SOURCE_TEXELS_PER_CELL, height: down * PIXEL_SOURCE_TEXELS_PER_CELL }
}

/** The slider's value is the density. */
export function pixelUniforms(density: number, frame: FilterFrame): UniformMap {
  const { across, down } = pixelGrid(frame, density)
  return { uPixelCells: [across, down], uPixelFrame: [frame.width, frame.height] }
}

const glslFloat = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v))

export const PIXEL_GLSL = /* glsl */ `
uniform sampler2D uPixelSource;
uniform vec2 uPixelCells;
uniform vec2 uPixelFrame;

// Bilinear reads along one axis that weigh each texel of [lo, hi) (texel units) by how much of it the cell covers;
// each read takes two neighbouring texels in that proportion. 5 reads cover up to 10 texels.
int pixelAxisReads(float lo, float hi, out float pos[5], out float wt[5]) {
  int first = int(floor(lo));
  int last = int(ceil(hi)) - 1;
  int n = 0;
  for (int i = first; i <= last; i += 2) {
    if (n == 5) break;
    float a = min(hi, float(i + 1)) - max(lo, float(i));
    float b = i + 1 <= last ? min(hi, float(i + 2)) - max(lo, float(i + 1)) : 0.0;
    pos[n] = float(i) + 0.5 + b / (a + b);
    wt[n] = a + b;
    n++;
  }
  return n;
}

// Mean color of a cell (row 0 at the top); cells past the frame edge repeat the edge cell.
vec3 pixelCellMean(ivec2 cell) {
  vec2 size = vec2(textureSize(uPixelSource, 0));
  vec2 perCell = size / uPixelCells;
  vec2 lo = clamp(vec2(cell), vec2(0.0), uPixelCells - 1.0) * perCell;
  vec2 hi = lo + perCell;
  float px[5];
  float wx[5];
  float py[5];
  float wy[5];
  int nx = pixelAxisReads(lo.x, hi.x, px, wx);
  int ny = pixelAxisReads(lo.y, hi.y, py, wy);
  vec3 sum = vec3(0.0);
  for (int j = 0; j < ny; j++) {
    vec3 row = vec3(0.0);
    for (int i = 0; i < nx; i++) row += wx[i] * textureLod(uPixelSource, vec2(px[i], py[j]) / size, 0.0).rgb;
    sum += wy[j] * row;
  }
  return sum / (perCell.x * perCell.y);
}

// Weight of the next cell at t (0..1) between two cell centers.
float pixelBlend(float t) {
  float a = pow(t, ${glslFloat(BLEND_POWER)});
  float b = pow(1.0 - t, ${glslFloat(BLEND_POWER)});
  return a / (a + b);
}

float pixelLed(vec2 offset) {
  vec2 a = abs(offset);
  float d = pow(pow(a.x, ${glslFloat(LED_CORNER)}) + pow(a.y, ${glslFloat(LED_CORNER)}), ${glslFloat(1 / LED_CORNER)});
  return 1.0 - smoothstep(${glslFloat(LED_HALF - LED_EDGE / 2)}, ${glslFloat(LED_HALF + LED_EDGE / 2)}, d);
}

// LED contrast per channel: the full contrast, or less where the LED's middle would push the channel past 1.
vec3 pixelContrast(vec3 c) {
  vec3 room = (1.0 / max(c, vec3(1e-6)) - 1.0) * ${glslFloat(PIXEL_LED_AREA / (1 - PIXEL_LED_AREA))};
  return min(vec3(${glslFloat(PIXEL_CONTRAST)}), room);
}

vec3 filterPixel(vec3 display, ivec2 px, float weight) {
  vec2 f = (vec2(px) + 0.5) * uPixelCells / uPixelFrame - 0.5;
  vec2 nearest = floor(f + 0.5);
  ivec2 n = ivec2(nearest);
  vec2 t = f - nearest;
  vec2 corner = floor(f);
  ivec2 lo = ivec2(corner) - n + 1;

  // Means of the 3 x 3 cells around the nearest one (index j * 3 + i), all but the diagonal cells outside the pixel's
  // 2 x 2 block: nothing below reads those.
  vec3 m[9];
  for (int j = 0; j < 3; j++) {
    for (int i = 0; i < 3; i++) {
      if (i == 1 || j == 1 || (i == 2 * lo.x && j == 2 * lo.y)) m[j * 3 + i] = pixelCellMean(n + ivec2(i - 1, j - 1));
    }
  }

  // Flat cells: the 2 x 2 cells around the pixel, blended near their shared edges, and their contrasts with them.
  int k = lo.y * 3 + lo.x;
  vec2 u = f - corner;
  float bx = pixelBlend(u.x);
  float by = pixelBlend(u.y);
  vec3 cells = mix(mix(m[k], m[k + 1], bx), mix(m[k + 3], m[k + 4], bx), by);
  vec3 contrast = mix(mix(pixelContrast(m[k]), pixelContrast(m[k + 1]), bx), mix(pixelContrast(m[k + 3]), pixelContrast(m[k + 4]), bx), by);
  float cellPx = min(uPixelFrame.x / uPixelCells.x, uPixelFrame.y / uPixelCells.y);
  contrast *= smoothstep(${glslFloat(LED_FADE_PX[0])}, ${glslFloat(LED_FADE_PX[1])}, cellPx);
  float s = pixelLed(t) / ${glslFloat(PIXEL_LED_AREA)};
  vec3 led = cells * (1.0 + contrast * (s - 1.0));

  // The light the nearest cell holds over its area: per axis its own color weighs 1 - 2H and each neighbour H, the
  // share a soft edge hands over (diagonal cells, at H^2, are left out and the rest scaled to sum to 1). What it lost
  // to darker neighbours goes back into its LED.
  vec3 held = (${glslFloat(1 - 2 * BLEND_SHARE)} * m[4] + ${glslFloat(BLEND_SHARE)} * (m[1] + m[3] + m[5] + m[7])) / ${glslFloat(1 + 2 * BLEND_SHARE)};
  return led + max(m[4] - held, 0.0) * s;
}
`

/** The Pixel stage of the output filter chain. */
export const PIXEL_FILTER: OutputFilter = {
  key: 'pixel',
  glsl: PIXEL_GLSL,
  apply: 'filterPixel',
  uniforms: pixelUniforms,
  source: { uniform: 'uPixelSource', size: pixelSourceSize, samples: SOURCE_SAMPLES },
}
