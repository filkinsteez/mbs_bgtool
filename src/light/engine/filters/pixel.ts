import type { UniformMap } from '../../scene'
import { frameAspect } from '../frame'
import type { FilterFrame, OutputFilter } from './types'

/**
 * The Pixel filter: the frame quantized to a grid of square cells with thin light lines between them, like the deck's
 * Pixel picture (44:280). It is fully on at every slider value.
 *
 * - The slider sets density: cells on the short side, from 18 at 0 to 144 at 1 on a log scale (51 at 0.5, 86 at
 *   0.75). Cells are whole across and down, so the grid depends on the frame's aspect and the density only, and a
 *   preview shows the same cells as the export. Between whole cell counts nothing changes.
 * - Each cell shows its mean color, flat; the color changes to the next cell's under the line between them.
 * - The lines are PIXEL_LINE_SHARE of a cell wide, as in the deck's picture (crisp at every size, so a preview shows
 *   the grid an export shows), and lighter than their cell by PIXEL_LINE_CONTRAST of its light; the inside is darker
 *   by the same amount of light, so every cell keeps its mean color. A channel near 1 has little room to brighten,
 *   so its share of the pattern shrinks with its room, and white has no lines. Dark cells get faint lines, so a dark
 *   room keeps its dark. The deck's lines are about white at 60 % opacity; these are lighter than the cell by less,
 *   since the brief asks for low contrast ("so it reads as light, not pattern").
 */

/** Cells on the short side at density 0 and 1; between them the count grows by the same ratio per step. */
export const PIXEL_MIN_CELLS = 18
export const PIXEL_MAX_CELLS = 144
/**
 * The frame source follows the density: two texels a cell each way, so a cell's mean is one read of its own 2 x 2
 * texels at every density. At 144 cells a 16:9 source is 512 x 288, the chain's largest. Each texel is the mean of
 * enough samples that the frame is drawn at least 288 px on the short side (3.75 px apart at 1080p, close enough for
 * a Contour line), and at least 2 x 2.
 */
export const PIXEL_SOURCE_TEXELS_PER_CELL = 2
const SOURCE_SAMPLES_ON_SHORT_SIDE = 288
/** Line width as a share of a cell, as in the deck's picture (2 px every 24 px): 3.5 px at 51 cells in 4K, 10 at 18. */
export const PIXEL_LINE_SHARE = 2 / 24
/** How much lighter a line is than its cell, as a share of the cell's light. */
export const PIXEL_LINE_CONTRAST = 0.7
/** Cell size in output pixels over which the lines fade in, so small previews show cells without moiré. */
const LINE_FADE_PX = [3, 6] as const

/**
 * How much of one output pixel the grid's lines cover (CPU twin of the shader's): the pixel `dx`, `dy` cells from the
 * nearest borders across and down, a pixel `pixel` cells wide, lines `width` cells wide. Horizontal and vertical lines
 * overlap at the crossings.
 */
export function pixelLineCoverage(dx: number, dy: number, width: number, pixel: number): number {
  const axis = (d: number) => {
    const lo = Math.max(Math.abs(d) - pixel / 2, -width / 2)
    const hi = Math.min(Math.abs(d) + pixel / 2, width / 2)
    return Math.min(1, Math.max(0, (hi - lo) / pixel))
  }
  const x = axis(dx)
  const y = axis(dy)
  return x + y - x * y
}

/** The share of a cell the lines cover, for lines `width` cells wide. */
export function pixelLineArea(width: number): number {
  const w = Math.min(1, Math.max(0, width))
  return 1 - (1 - w) * (1 - w)
}

/** Cells on the short side for a density 0..1 (a missing value gives the count at 0.5). */
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

/** The frame source's texels at a density: two a cell each way. */
export function pixelSourceSize(frame: Pick<FilterFrame, 'width' | 'height'>, density = 0.5): { width: number; height: number } {
  const { across, down } = pixelGrid(frame, density)
  return { width: across * PIXEL_SOURCE_TEXELS_PER_CELL, height: down * PIXEL_SOURCE_TEXELS_PER_CELL }
}

/** Samples per source texel along each axis at a density, 2 to 8. */
export function pixelSourceSamples(frame: Pick<FilterFrame, 'width' | 'height'>, density = 0.5): number {
  const texelsOnShort = pixelCells(density) * PIXEL_SOURCE_TEXELS_PER_CELL
  return Math.min(8, Math.max(2, Math.ceil(SOURCE_SAMPLES_ON_SHORT_SIDE / texelsOnShort)))
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
// each read takes two neighbouring texels in that proportion. With two texels a cell that is one read; 5 reads cover
// up to 10 texels, should the chain ever cap the source below two texels a cell.
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

// Line contrast per channel: the full contrast, or less where a line would push the channel past 1.
vec3 pixelContrast(vec3 c) {
  return min(vec3(${glslFloat(PIXEL_LINE_CONTRAST)}), 1.0 / max(c, vec3(1e-6)) - 1.0);
}

// How much of a pixel the lines cover along one axis: the pixel d cells from the nearest border, p cells wide, the
// line w cells wide (pixelLineCoverage in pixel.ts).
float pixelLineAxis(float d, float w, float p) {
  float lo = max(abs(d) - 0.5 * p, -0.5 * w);
  float hi = min(abs(d) + 0.5 * p, 0.5 * w);
  return clamp((hi - lo) / p, 0.0, 1.0);
}

vec3 filterPixel(vec3 display, ivec2 px, float weight) {
  // Cell centers at whole numbers; u runs from the lower-left cell's center (0) to the next (1), the border at 0.5.
  vec2 f = (vec2(px) + 0.5) * uPixelCells / uPixelFrame - 0.5;
  vec2 corner = floor(f);
  vec2 u = f - corner;
  ivec2 c0 = ivec2(corner);
  vec3 m00 = pixelCellMean(c0);
  vec3 m10 = pixelCellMean(c0 + ivec2(1, 0));
  vec3 m01 = pixelCellMean(c0 + ivec2(0, 1));
  vec3 m11 = pixelCellMean(c0 + ivec2(1, 1));
  float cellPx = min(uPixelFrame.x / uPixelCells.x, uPixelFrame.y / uPixelCells.y);
  float p = 1.0 / cellPx;
  float w = ${glslFloat(PIXEL_LINE_SHARE)};
  // Flat cells: the color changes to the next cell's over the line's width (a pixel at least), under the line.
  vec2 b = clamp((u - 0.5) / max(w, p) + 0.5, 0.0, 1.0);
  vec3 cells = mix(mix(m00, m10, b.x), mix(m01, m11, b.x), b.y);
  vec3 contrast = pixelContrast(cells) * smoothstep(${glslFloat(LINE_FADE_PX[0])}, ${glslFloat(LINE_FADE_PX[1])}, cellPx);
  float cx = pixelLineAxis(u.x - 0.5, w, p);
  float cy = pixelLineAxis(u.y - 0.5, w, p);
  float cover = cx + cy - cx * cy;
  float area = 1.0 - (1.0 - w) * (1.0 - w);
  // Lines lighter by the contrast, the inside darker by the same light, so the cell's mean stays.
  return cells * (1.0 + contrast * (cover - area) / (1.0 - area));
}
`

/** The Pixel stage of the output filter chain. */
export const PIXEL_FILTER: OutputFilter = {
  key: 'pixel',
  glsl: PIXEL_GLSL,
  apply: 'filterPixel',
  uniforms: pixelUniforms,
  source: { uniform: 'uPixelSource', size: pixelSourceSize, samples: pixelSourceSamples },
}
