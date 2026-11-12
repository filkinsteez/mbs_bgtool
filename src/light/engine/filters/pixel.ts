import { linearToOklab, oklabToLinear } from '../../color/oklab'
import type { Rgb } from '../../color/srgb'
import type { UniformMap } from '../../scene'
import { frameAspect } from '../frame'
import type { FilterFrame, OutputFilter } from './types'

/**
 * The Pixel filter: the frame quantized to square blocks of a few sizes on one grid, with thin light lines between
 * them, like the deck's Pixel picture (44:280). It is fully on at every slider value.
 *
 * - The slider (Density in the tool) sets the size: 8 cells on the short side at 0 (the biggest) and 144 at 1 (the
 *   smallest), the count rising by the same ratio per step (16 at 0.25, 34 at 0.5, 70 at 0.75). Cells are whole across
 *   and down, so the grid depends on the frame's aspect and the density only, and a preview shows the same blocks as
 *   the export. Between whole cell counts nothing changes.
 * - Blocks of several sizes, all on one grid (owner, 2026-11-12 7:25 AM: "and can we add some variation to the size of
 *   the pixels? but all still following a pixel grid?"). The base grid has PIXEL_BASE_PER_CELL base cells a cell along
 *   each side, and a block is 1, 2 or 4 base cells wide, starting at a multiple of its width, like a quadtree, so a
 *   2 x 2 block is a cell of the slider's size. A group of 4 x 4 base cells is one block where its base cells' Oklab
 *   lightness spans less than a limit (PIXEL_MERGE[1], growing with the base cell's size); otherwise each 2 x 2 group
 *   is one block where it spans less than PIXEL_MERGE[0]; otherwise each base cell is its own block (pixelLayout). So blocks are big where the design is flat
 *   and small where the light or the bands change, and few big blocks straddle two colors. Each group's limit is
 *   scaled by a seeded factor, so the layout follows the seed and a row of groups never splits or merges at once. A
 *   group splits gradually around its limit (PIXEL_SPLIT_SOFT): its parts' colors and inner lines fade in, so a small
 *   drag never switches a block between whole and split. Only lightness counts, so a pack or a color slider, which
 *   change only colors, leaves the layout as it is.
 * - Each block shows one color, flat; the color changes to the next block's under the line between them.
 * - The lines are PIXEL_LINE_SHARE of a cell wide, as in the deck's picture, up to PIXEL_LINE_MAX of the frame's short
 *   side, so big cells keep thin lines (crisp at every size, so a preview shows the grid an export shows), and they lie
 *   on block edges only. They are lighter than their block by PIXEL_LINE_CONTRAST of its light; the inside is darker
 *   by the same amount of light, so every block keeps its color. A channel near 1 has little room to brighten,
 *   so its share of the pattern shrinks with its room, and white has no lines. Dark blocks get faint lines, so a dark
 *   room keeps its dark. The deck's lines are about white at 60 % opacity; these are lighter than the block by less,
 *   since the brief asks for low contrast ("so it reads as light, not pattern").
 * - Big blocks keep their colors (owner, 2026-11-12 7:22 AM: "for the larger pixel blocks can we increase vibrancy?
 *   feels like it's pretty washed out, would be nice if it was more representative of the palette than a
 *   faded/blurry feeling color"). A block's plain mean mixes the light of every hue in it, so a block across the warm
 *   band and the blue comes out tan, olive or grey-purple. Instead its colored texels vote on hue in VIVID_BINS soft
 *   bins, and the hue that covers most of the block wins by a soft maximum (pixelCellColor): near a tie the winning
 *   hues blend the short way round the hue circle, which for neighbours in a pack's hue order is the hue between them.
 *   The block keeps the winning texels' saturation (chroma over lightness), and its lightness moves from its mean's
 *   toward theirs by the square of the share of the block that has any color, so a block of yellow and blue shows its
 *   yellow about as light as the picture does, not olive, and a black block with a thin rim stays about as dark. A
 *   near tie of far-apart hues stays near the block's mean color and meets lighter instead of grey, as such meetings
 *   in the picture do. Grey, black and white texels have no vote. pixelBlockVivid sets how much of this a block gets
 *   from its size: all of it for the biggest blocks, none from VIVID_CELLS[1] blocks on the short side, so small
 *   blocks change little. Every step is smooth in the texels' colors, so a slider step or a small drag never flips a
 *   block's color.
 * - A reduce pass after the frame source works out each base cell's block, its size and color, once per frame (one
 *   texel a base cell); the output pass reads it.
 */

/** Cells on the short side at density 0 (the biggest cells) and at 1 (the smallest); between them the count rises by the same ratio per step. */
export const PIXEL_MIN_CELLS = 8
export const PIXEL_MAX_CELLS = 144
/** Base cells a cell along each side: blocks are 1, 2 or 4 base cells wide, so a 2 x 2 block is a cell. */
export const PIXEL_BASE_PER_CELL = 2
/**
 * The Oklab lightness span under which a 2 x 2 group of base cells is one block, and under which a 4 x 4 group is, at
 * PIXEL_MERGE_BASE base cells on the short side (each scaled by the group's seeded factor in PIXEL_MERGE_JITTER). The
 * limits grow in proportion to the base cell's size, as a smooth gradient's span over a group does, so every density
 * gets about the same mix of block sizes.
 */
export const PIXEL_MERGE = [0.025, 0.024] as const
const PIXEL_MERGE_BASE = 68
/** The range of a group's seeded factor on its limit. */
const PIXEL_MERGE_JITTER = [0.7, 1.3] as const
/**
 * A group splits gradually as its span passes its limit: from (1 - PIXEL_SPLIT_SOFT) of the limit, where it is whole,
 * to (1 + PIXEL_SPLIT_SOFT), where it is split. In between its parts' colors and inner lines fade in, so a small drag
 * never switches a block between whole and split.
 */
const PIXEL_SPLIT_SOFT = 0.35
/**
 * The frame source follows the density: an even number of texels a base cell each way, so the short side keeps at
 * least 36 texels, or one texel a base cell from ONE_TEXEL_FROM base cells on the short side, so a 16:9 source at
 * Density 1 is 512 x 288, the chain's largest. Each texel is the mean of enough samples (at most 8 a side) that the
 * frame is drawn at least 288 px on the short side (3.75 px apart at 1080p, close enough for a Contour line), and at
 * least 2 x 2.
 */
const SOURCE_TEXELS_ON_SHORT_SIDE = 36
const SOURCE_SAMPLES_ON_SHORT_SIDE = 288
const ONE_TEXEL_FROM = 128
/** Line width as a share of a cell, as in the deck's picture (2 px every 24 px), up to PIXEL_LINE_MAX. */
export const PIXEL_LINE_SHARE = 2 / 24
/**
 * The widest a line gets, as a share of the frame's short side: 2 px at 1080 px, as in the deck's picture at 1x. It
 * takes over from 45 cells down (density 0.6 and down): 4 px in a 4K export, about 1 px in a 606 px tall preview.
 */
export const PIXEL_LINE_MAX = 2 / 1080
/** How much lighter a line is than its block, as a share of the block's light. */
export const PIXEL_LINE_CONTRAST = 0.7
/** Block size in output pixels over which the lines fade in, so small previews show blocks without moiré. */
const LINE_FADE_PX = [3, 6] as const
/** Hue bins a block's colored texels vote in. */
const VIVID_BINS = 12
/** How sharply the hue covering most of a block wins: a bin with a share 1/VIVID_SHARPNESS below the top counts e^-1 as much. */
const VIVID_SHARPNESS = 2
/** Oklab chroma over which a texel goes from grey (no vote) to colored (a full vote). */
const VIVID_CHROMA = [0.02, 0.06] as const
/** Blocks on the short side at and under which a block keeps its colors fully, and from which it shows its plain mean. */
const VIVID_CELLS = [12, 90] as const
/**
 * How aligned the winning hues are (the length of their mean direction) over which a block goes from its plain mean's
 * color to the winning color: a near tie of far-apart hues stays near its mean, as such meetings in the picture do.
 */
const VIVID_ALIGNED = [0.25, 0.6] as const
/** How much lighter than its lighter side a near tie of far-apart hues meets, in Oklab lightness. */
const VIVID_MEET_LIFT = 0.06

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/** How much a block keeps its colors (see pixelCellColor) by its size, as blocks on the short side: 1 for the biggest, 0 from VIVID_CELLS[1]. */
export function pixelBlockVivid(blocksOnShort: number): number {
  const [full, none] = VIVID_CELLS.map(Math.log)
  return smoothstep(0, 1, (none - Math.log(blocksOnShort)) / (none - full))
}

/** How much a block of the slider's cell size keeps its colors at a density. */
export function pixelVivid(density: number): number {
  return pixelBlockVivid(pixelCells(density))
}

const inGamut = (c: readonly number[]) => c.every((v) => v >= -1e-4 && v <= 1 + 1e-4)

/** The color at Oklab lightness L, chroma C and hue h (radians), with less chroma where sRGB can't show it. */
function fitGamut(L: number, C: number, h: number): Rgb {
  const at = (c: number) => oklabToLinear([L, c * Math.cos(h), c * Math.sin(h)])
  if (inGamut(at(C))) return at(C).map((v) => Math.min(1, Math.max(0, v))) as Rgb
  let [lo, hi] = [0, C]
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2
    if (inGamut(at(mid))) lo = mid
    else hi = mid
  }
  return at(lo).map((v) => Math.min(1, Math.max(0, v))) as Rgb
}

/**
 * A block's color from its texels (display-linear; CPU twin of the shader's pixelBlockColor): the plain mean moved by
 * `vivid` (pixelBlockVivid) toward the color of the hue that covers most of the block, at that hue's saturation and a
 * lightness between the mean's and the hue's own.
 */
export function pixelCellColor(texels: readonly (readonly number[])[], vivid: number): Rgb {
  const n = texels.length
  const mean = [0, 1, 2].map((q) => texels.reduce((s, t) => s + t[q], 0) / n) as Rgb
  if (!(vivid > 0) || n === 0) return mean
  const labs = texels.map((t) => linearToOklab(t.map((v) => Math.max(v, 0))))
  const votes = labs.map(([, a, b]) => smoothstep(VIVID_CHROMA[0], VIVID_CHROMA[1], Math.hypot(a, b)))
  const places = labs.map(([, a, b]) => (((Math.atan2(b, a) / (2 * Math.PI)) * VIVID_BINS) % VIVID_BINS + VIVID_BINS) % VIVID_BINS)
  const bins = new Array<number>(VIVID_BINS).fill(0)
  places.forEach((p, i) => {
    const k = Math.floor(p)
    bins[k % VIVID_BINS] += votes[i] * (1 - (p - k))
    bins[(k + 1) % VIVID_BINS] += votes[i] * (p - k)
  })
  const smooth = bins.map((v, k) => 0.25 * bins[(k + VIVID_BINS - 1) % VIVID_BINS] + 0.5 * v + 0.25 * bins[(k + 1) % VIVID_BINS])
  const top = Math.max(...smooth)
  if (top <= 1e-6) return mean
  const wins = smooth.map((v) => Math.exp((VIVID_SHARPNESS * (v - top)) / top))
  let [weight, dirA, dirB, chroma, light] = [0, 0, 0, 0, 0]
  labs.forEach(([L, a, b], i) => {
    const C = Math.hypot(a, b)
    const k = Math.floor(places[i])
    const w = votes[i] * (wins[k % VIVID_BINS] * (1 - (places[i] - k)) + wins[(k + 1) % VIVID_BINS] * (places[i] - k))
    if (!(w > 0) || C <= 0) return
    weight += w
    dirA += (w * a) / C
    dirB += (w * b) / C
    chroma += w * C
    light += w * L
  })
  if (weight <= 1e-9) return mean
  const [Lm, am, bm] = linearToOklab(mean)
  const length = Math.hypot(dirA, dirB)
  const aligned = smoothstep(VIVID_ALIGNED[0], VIVID_ALIGNED[1], length / weight)
  const colorful = votes.reduce((s, v) => s + v, 0) / n
  const Lg = light / weight
  const shown = Lm + (Lg - Lm) * colorful * colorful
  const L = shown + Math.max(0, Math.max(Lm, Lg) + VIVID_MEET_LIFT - shown) * (1 - aligned) * colorful
  const C = (chroma / Math.max(light, 1e-6)) * L
  const a = am + ((length > 0 ? (C * dirA) / length : 0) - am) * aligned
  const b = bm + ((length > 0 ? (C * dirB) / length : 0) - bm) * aligned
  const kept = fitGamut(L, Math.hypot(a, b), Math.atan2(b, a))
  return mean.map((v, q) => v + (kept[q] - v) * vivid) as Rgb
}

/** The engine's hashKey (glsl/hash.ts) on the CPU: a value 0..1 for three whole numbers. */
function hashUnit(a: number, b: number, c: number): number {
  let x = (Math.imul(a + 1048576, 1664525) + 1013904223) >>> 0
  let y = (Math.imul(b + 1048576, 1664525) + 1013904223) >>> 0
  let z = (Math.imul(c + 1048576, 1664525) + 1013904223) >>> 0
  x = (x + Math.imul(y, z)) >>> 0
  y = (y + Math.imul(z, x)) >>> 0
  z = (z + Math.imul(x, y)) >>> 0
  x = (x ^ (x >>> 16)) >>> 0
  y = (y ^ (y >>> 16)) >>> 0
  z = (z ^ (z >>> 16)) >>> 0
  x = (x + Math.imul(y, z)) >>> 0
  return (x >>> 8) / 16777216
}

/** A group's seeded factor on its merge limit (GLSL pixelJitter). */
function mergeFactor(gx: number, gy: number, seed: number, level: number): number {
  return PIXEL_MERGE_JITTER[0] + (PIXEL_MERGE_JITTER[1] - PIXEL_MERGE_JITTER[0]) * hashUnit(gx, gy, seed * 7 + level)
}

/**
 * The block layout (CPU twin of the reduce pass's): for each base cell (row by row, `lightness` its Oklab lightness),
 * how far its 4 x 4 group and its 2 x 2 group are split, 0 (one block) to 1 (split). A group past the grid's edge is
 * split. pixelLevelWeights turns them into the shares of the 4 x 4, 2 x 2 and 1 x 1 blocks a cell shows.
 */
export function pixelLayout(lightness: readonly number[], across: number, down: number, seed: number): { split4: number[]; split2: number[] } {
  const span = (x0: number, y0: number, size: number) => {
    if (x0 + size > across || y0 + size > down) return Infinity
    let [lo, hi] = [Infinity, -Infinity]
    for (let y = y0; y < y0 + size; y++)
      for (let x = x0; x < x0 + size; x++) {
        lo = Math.min(lo, lightness[y * across + x])
        hi = Math.max(hi, lightness[y * across + x])
      }
    return hi - lo
  }
  const split = (value: number, limit: number) => (Number.isFinite(value) ? smoothstep(limit * (1 - PIXEL_SPLIT_SOFT), limit * (1 + PIXEL_SPLIT_SOFT), value) : 1)
  const scale = PIXEL_MERGE_BASE / Math.min(across, down)
  const cells = lightness.map((_, i) => [i % across, Math.floor(i / across)])
  return {
    split4: cells.map(([x, y]) => split(span(x - (x % 4), y - (y % 4), 4), PIXEL_MERGE[1] * scale * mergeFactor(x >> 2, y >> 2, seed, 2))),
    split2: cells.map(([x, y]) => split(span(x - (x % 2), y - (y % 2), 2), PIXEL_MERGE[0] * scale * mergeFactor(x >> 1, y >> 1, seed, 1))),
  }
}

/** The shares of its 4 x 4, 2 x 2 and 1 x 1 blocks a base cell shows, from its groups' splits. */
export function pixelLevelWeights(split4: number, split2: number): [number, number, number] {
  return [1 - split4, split4 * (1 - split2), split4 * split2]
}

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

/** The share of a block the lines cover, for lines `width` blocks wide. */
export function pixelLineArea(width: number): number {
  const w = Math.min(1, Math.max(0, width))
  return 1 - (1 - w) * (1 - w)
}

/** Cells on the short side for a density 0..1, more and so smaller as it rises (a missing value gives the count at 0.5). */
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

/** Base cells on the short side at a density: PIXEL_BASE_PER_CELL a cell. */
export function pixelBaseCells(density = 0.5): number {
  return PIXEL_BASE_PER_CELL * pixelCells(density)
}

/** Base cells across and down at a density: pixelBaseCells on the short side, a whole number on the long side. */
export function pixelBaseGrid(frame: Pick<FilterFrame, 'width' | 'height'>, density = 0.5): { across: number; down: number } {
  return gridOf(frame, pixelBaseCells(density))
}

/** Source texels a base cell along each axis at a density: the even number that gives the short side 36 or more, or 1 from ONE_TEXEL_FROM base cells. */
export function pixelSourceTexelsPerCell(density = 0.5): number {
  const base = pixelBaseCells(density)
  return base >= ONE_TEXEL_FROM ? 1 : 2 * Math.ceil(SOURCE_TEXELS_ON_SHORT_SIDE / (2 * base))
}

/** The frame source's texels at a density: pixelSourceTexelsPerCell a base cell each way. */
export function pixelSourceSize(frame: Pick<FilterFrame, 'width' | 'height'>, density = 0.5): { width: number; height: number } {
  const { across, down } = pixelBaseGrid(frame, density)
  const texels = pixelSourceTexelsPerCell(density)
  return { width: across * texels, height: down * texels }
}

/** Samples per source texel along each axis at a density, 2 to 8. */
export function pixelSourceSamples(frame: Pick<FilterFrame, 'width' | 'height'>, density = 0.5): number {
  const texelsOnShort = pixelBaseCells(density) * pixelSourceTexelsPerCell(density)
  return Math.min(8, Math.max(2, Math.ceil(SOURCE_SAMPLES_ON_SHORT_SIDE / texelsOnShort)))
}

/** Line width in cells at a density: PIXEL_LINE_SHARE of a cell, or less where that would pass PIXEL_LINE_MAX. */
export function pixelLineWidth(density: number): number {
  return Math.min(PIXEL_LINE_SHARE, PIXEL_LINE_MAX * pixelCells(density))
}

/** The slider's value is the density. The grid and the line width are in base cells. */
export function pixelUniforms(density: number, frame: FilterFrame): UniformMap {
  const { across, down } = pixelBaseGrid(frame, density)
  return {
    uPixelCells: [across, down],
    uPixelFrame: [frame.width, frame.height],
    uPixelLine: PIXEL_BASE_PER_CELL * pixelLineWidth(density),
    uPixelShort: pixelBaseCells(density),
    uPixelSeed: frame.seed,
  }
}

const glslFloat = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v))
/** Texels a base cell along each axis at most, and a block's at most: at the biggest cells. */
const MAX_TEXELS_PER_CELL = pixelSourceTexelsPerCell(0)
const MAX_BLOCK_TEXELS = 4 * MAX_TEXELS_PER_CELL

/**
 * The reduce pass over the frame source (FilterSource.reduce), one texel a base cell: the color of the base cell's
 * block (pixelBlockColor) and, in alpha, the block's level (pixelLevel).
 */
export const PIXEL_COLORS_GLSL = /* glsl */ `
uniform vec2 uPixelCells;  // base cells across and down
uniform float uPixelShort; // base cells on the short side
uniform int uPixelSeed;

// A base cell's Oklab lightness: that of the mean of its texels.
float pixelLight(ivec2 cell, int per) {
  vec3 sum = vec3(0.0);
  for (int j = 0; j < ${MAX_TEXELS_PER_CELL}; j++) {
    if (j >= per) break;
    for (int i = 0; i < ${MAX_TEXELS_PER_CELL}; i++) {
      if (i >= per) break;
      sum += texelFetch(uSrc, cell * per + ivec2(i, j), 0).rgb;
    }
  }
  return linearToOklab(max(sum / float(per * per), vec3(0.0))).x;
}

// How far apart in lightness the base cells of a size x size group are; a group past the grid's edge stays split.
float pixelSpan(ivec2 origin, int size, int per) {
  if (origin.x + size > int(uPixelCells.x + 0.5) || origin.y + size > int(uPixelCells.y + 0.5)) return 1e9;
  float lo = 1e9;
  float hi = -1e9;
  for (int j = 0; j < 4; j++) {
    if (j >= size) break;
    for (int i = 0; i < 4; i++) {
      if (i >= size) break;
      float L = pixelLight(origin + ivec2(i, j), per);
      lo = min(lo, L);
      hi = max(hi, L);
    }
  }
  return hi - lo;
}

// A group's seeded factor on its merge limit (mergeFactor in pixel.ts).
float pixelJitter(ivec2 group, int level) {
  return mix(${glslFloat(PIXEL_MERGE_JITTER[0])}, ${glslFloat(PIXEL_MERGE_JITTER[1])}, unitFromUint(hashKey(ivec3(group, uPixelSeed * 7 + level))).x);
}

// How far a group is split, 0 (one block) to 1, from its span and its limit (pixelLayout in pixel.ts).
float pixelSplit(float span, float limit) {
  return smoothstep(limit * ${glslFloat(1 - PIXEL_SPLIT_SOFT)}, limit * ${glslFloat(1 + PIXEL_SPLIT_SOFT)}, span);
}

// How much a block keeps its colors by its size (pixelBlockVivid in pixel.ts).
float pixelBlockVivid(float blocksOnShort) {
  float full = ${Math.log(VIVID_CELLS[0]).toFixed(8)};
  float none = ${Math.log(VIVID_CELLS[1]).toFixed(8)};
  return smoothstep(0.0, 1.0, (none - log(blocksOnShort)) / (none - full));
}

bool pixelInGamut(vec3 c) {
  return all(greaterThanEqual(c, vec3(-1e-4))) && all(lessThanEqual(c, vec3(1.0 + 1e-4)));
}

// The color at Oklab lightness L, chroma C and hue h, with less chroma where sRGB can't show it.
vec3 pixelFitGamut(float L, float C, float h) {
  vec2 dir = vec2(cos(h), sin(h));
  if (pixelInGamut(oklabToLinear(vec3(L, C * dir)))) return saturate(oklabToLinear(vec3(L, C * dir)));
  float lo = 0.0;
  float hi = C;
  for (int i = 0; i < 12; i++) {
    float mid = 0.5 * (lo + hi);
    if (pixelInGamut(oklabToLinear(vec3(L, mid * dir)))) lo = mid;
    else hi = mid;
  }
  return saturate(oklabToLinear(vec3(L, lo * dir)));
}

// A texel's Oklab color, its vote (how colored it is) and its place among the hue bins.
vec3 pixelTexelLab(ivec2 texel, out float vote, out float place) {
  vec3 lab = linearToOklab(max(texelFetch(uSrc, texel, 0).rgb, vec3(0.0)));
  vote = smoothstep(${glslFloat(VIVID_CHROMA[0])}, ${glslFloat(VIVID_CHROMA[1])}, length(lab.yz));
  place = mod(atan(lab.z, lab.y) / ${(2 * Math.PI).toFixed(8)} * ${glslFloat(VIVID_BINS)}, ${glslFloat(VIVID_BINS)});
  return lab;
}

// A block's color (pixelCellColor in pixel.ts) over its side x side texels from \`origin\`: the plain mean moved by
// \`vivid\` toward the color of the hue that covers most of the block, at that hue's saturation and a lightness between
// the mean's and the hue's own.
vec3 pixelBlockColor(ivec2 origin, int side, float vivid) {
  float bins[${VIVID_BINS}];
  for (int k = 0; k < ${VIVID_BINS}; k++) bins[k] = 0.0;
  vec3 sum = vec3(0.0);
  float voted = 0.0;
  for (int j = 0; j < ${MAX_BLOCK_TEXELS}; j++) {
    if (j >= side) break;
    for (int i = 0; i < ${MAX_BLOCK_TEXELS}; i++) {
      if (i >= side) break;
      sum += texelFetch(uSrc, origin + ivec2(i, j), 0).rgb;
      if (vivid <= 0.0) continue;
      float vote;
      float place;
      pixelTexelLab(origin + ivec2(i, j), vote, place);
      voted += vote;
      int k = int(floor(place));
      bins[k % ${VIVID_BINS}] += vote * (1.0 - (place - float(k)));
      bins[(k + 1) % ${VIVID_BINS}] += vote * (place - float(k));
    }
  }
  float n = float(side * side);
  vec3 mean = sum / n;
  if (vivid <= 0.0) return mean;
  float wins[${VIVID_BINS}];
  float top = 0.0;
  for (int k = 0; k < ${VIVID_BINS}; k++) {
    wins[k] = 0.25 * bins[(k + ${VIVID_BINS - 1}) % ${VIVID_BINS}] + 0.5 * bins[k] + 0.25 * bins[(k + 1) % ${VIVID_BINS}];
    top = max(top, wins[k]);
  }
  if (top <= 1e-6) return mean;
  for (int k = 0; k < ${VIVID_BINS}; k++) wins[k] = exp(${glslFloat(VIVID_SHARPNESS)} * (wins[k] - top) / top);
  float weight = 0.0;
  vec2 dir = vec2(0.0);
  float chroma = 0.0;
  float light = 0.0;
  for (int j = 0; j < ${MAX_BLOCK_TEXELS}; j++) {
    if (j >= side) break;
    for (int i = 0; i < ${MAX_BLOCK_TEXELS}; i++) {
      if (i >= side) break;
      float vote;
      float place;
      vec3 lab = pixelTexelLab(origin + ivec2(i, j), vote, place);
      float C = length(lab.yz);
      int k = int(floor(place));
      float f = place - float(k);
      float w = vote * (wins[k % ${VIVID_BINS}] * (1.0 - f) + wins[(k + 1) % ${VIVID_BINS}] * f);
      if (w <= 0.0 || C <= 0.0) continue;
      weight += w;
      dir += w * lab.yz / C;
      chroma += w * C;
      light += w * lab.x;
    }
  }
  if (weight <= 1e-9) return mean;
  vec3 m = linearToOklab(max(mean, vec3(0.0)));
  float aligned = smoothstep(${glslFloat(VIVID_ALIGNED[0])}, ${glslFloat(VIVID_ALIGNED[1])}, length(dir) / weight);
  float colorful = voted / n;
  float lg = light / weight;
  float shown = m.x + (lg - m.x) * colorful * colorful;
  float L = shown + max(0.0, max(m.x, lg) + ${glslFloat(VIVID_MEET_LIFT)} - shown) * (1.0 - aligned) * colorful;
  vec2 toward = length(dir) > 0.0 ? chroma / max(light, 1e-6) * L * dir / length(dir) : vec2(0.0);
  vec2 ab = m.yz + (toward - m.yz) * aligned;
  return mix(mean, pixelFitGamut(L, length(ab), atan(ab.y, ab.x)), vivid);
}

// Two texels a base cell: the first holds the color the cell shows (its 4 x 4, 2 x 2 and 1 x 1 blocks' colors by the
// shares pixelLevelWeights gives) and its 4 x 4 group's split, the second its 2 x 2 group's split.
vec4 pixelColorOf(ivec2 texel) {
  ivec2 cell = ivec2(texel.x / 2, texel.y);
  int per = textureSize(uSrc, 0).x / int(uPixelCells.x + 0.5);
  float scale = ${glslFloat(PIXEL_MERGE_BASE)} / uPixelShort;
  float split2 = pixelSplit(pixelSpan((cell / 2) * 2, 2, per), ${glslFloat(PIXEL_MERGE[0])} * scale * pixelJitter(cell / 2, 1));
  if (texel.x % 2 == 1) return vec4(split2, 0.0, 0.0, 1.0);
  float split4 = pixelSplit(pixelSpan((cell / 4) * 4, 4, per), ${glslFloat(PIXEL_MERGE[1])} * scale * pixelJitter(cell / 4, 2));
  float w4 = 1.0 - split4;
  float w2 = split4 * (1.0 - split2);
  float w1 = split4 * split2;
  vec3 color = vec3(0.0);
  if (w4 > 0.0) color += w4 * pixelBlockColor((cell / 4) * 4 * per, 4 * per, pixelBlockVivid(uPixelShort / 4.0));
  if (w2 > 0.0) color += w2 * pixelBlockColor((cell / 2) * 2 * per, 2 * per, pixelBlockVivid(uPixelShort / 2.0));
  if (w1 > 0.0) color += w1 * pixelBlockColor(cell * per, per, pixelBlockVivid(uPixelShort));
  return vec4(color, split4);
}
`

export const PIXEL_GLSL = /* glsl */ `
uniform sampler2D uPixelColors; // two texels a base cell: its color and 4 x 4 split, then its 2 x 2 split (PIXEL_COLORS_GLSL)
uniform vec2 uPixelCells;       // base cells across and down
uniform vec2 uPixelFrame;
uniform float uPixelLine;       // line width in base cells

// A base cell's color and, in alpha, its 4 x 4 group's split.
vec4 pixelBlockAt(ivec2 cell) {
  ivec2 c = clamp(cell, ivec2(0), ivec2(uPixelCells) - 1);
  return texelFetch(uPixelColors, ivec2(2 * c.x, c.y), 0);
}

// A base cell's 2 x 2 group's split.
float pixelSplit2At(ivec2 cell) {
  ivec2 c = clamp(cell, ivec2(0), ivec2(uPixelCells) - 1);
  return texelFetch(uPixelColors, ivec2(2 * c.x + 1, c.y), 0).r;
}

// Line contrast per channel: the full contrast, or less where a line would push the channel past 1.
vec3 pixelContrast(vec3 c) {
  return min(vec3(${glslFloat(PIXEL_LINE_CONTRAST)}), 1.0 / max(c, vec3(1e-6)) - 1.0);
}

// How much of a pixel the lines cover along one axis: the pixel d base cells from the nearest block edge, p base
// cells wide, the line w base cells wide (pixelLineCoverage in pixel.ts).
float pixelLineAxis(float d, float w, float p) {
  float lo = max(abs(d) - 0.5 * p, -0.5 * w);
  float hi = min(abs(d) + 0.5 * p, 0.5 * w);
  return clamp((hi - lo) / p, 0.0, 1.0);
}

// The lines of blocks s base cells wide at f (base cells), lighter by up to 1 and the inside darker so that they
// average 0 over each block; the frame's own edges have no line. They fade in with the block's size in pixels.
float pixelLevelLines(vec2 f, float s, vec2 cells, float w, float p, float basePx) {
  vec2 r = mod(f, s);
  vec2 edge = f - r + step(0.5 * s, r) * s;
  vec2 d = min(r, s - r);
  d.x = edge.x <= 0.0 || edge.x >= cells.x ? s : d.x;
  d.y = edge.y <= 0.0 || edge.y >= cells.y ? s : d.y;
  float cx = pixelLineAxis(d.x, w, p);
  float cy = pixelLineAxis(d.y, w, p);
  float ws = min(w / s, 1.0);
  float area = 1.0 - (1.0 - ws) * (1.0 - ws);
  return smoothstep(${glslFloat(LINE_FADE_PX[0])}, ${glslFloat(LINE_FADE_PX[1])}, s * basePx) * (cx + cy - cx * cy - area) / (1.0 - area);
}

vec3 filterPixel(vec3 display, ivec2 px, float weight) {
  ivec2 cells = ivec2(uPixelCells + 0.5);
  vec2 f = (vec2(px) + 0.5) * uPixelCells / uPixelFrame;
  ivec2 cell = clamp(ivec2(floor(f)), ivec2(0), cells - 1);
  vec2 q = f - vec2(cell);
  float basePx = min(uPixelFrame.x / uPixelCells.x, uPixelFrame.y / uPixelCells.y);
  float p = 1.0 / basePx;
  float w = uPixelLine;
  // Flat blocks: the color changes to the next base cell's over the line's width (a pixel at least); inside a whole
  // block the next base cell shows the same color. The frame's own edge has nothing across.
  ivec2 across = cell + ivec2(q.x < 0.5 ? -1 : 1, 0);
  ivec2 down = cell + ivec2(0, q.y < 0.5 ? -1 : 1);
  float bx = across.x < 0 || across.x >= cells.x ? 0.0 : clamp(0.5 - min(q.x, 1.0 - q.x) / max(w, p), 0.0, 0.5);
  float by = down.y < 0 || down.y >= cells.y ? 0.0 : clamp(0.5 - min(q.y, 1.0 - q.y) / max(w, p), 0.0, 0.5);
  vec4 own = pixelBlockAt(cell);
  vec3 color = mix(mix(own.rgb, pixelBlockAt(across).rgb, bx), mix(pixelBlockAt(down).rgb, pixelBlockAt(ivec2(across.x, down.y)).rgb, bx), by);
  // The lines of the 4 x 4, 2 x 2 and 1 x 1 blocks by the shares the cell shows of each (pixelLevelWeights), so a
  // group's inner lines fade in as it splits. Lines lighter by the contrast, the inside darker by the same light, so
  // every block keeps its color.
  float split4 = own.a;
  float split2 = pixelSplit2At(cell);
  float lines = (1.0 - split4) * pixelLevelLines(f, 4.0, uPixelCells, w, p, basePx)
    + split4 * (1.0 - split2) * pixelLevelLines(f, 2.0, uPixelCells, w, p, basePx)
    + split4 * split2 * pixelLevelLines(f, 1.0, uPixelCells, w, p, basePx);
  return color * (1.0 + pixelContrast(color) * lines);
}
`

/** The Pixel stage of the output filter chain. */
export const PIXEL_FILTER: OutputFilter = {
  key: 'pixel',
  glsl: PIXEL_GLSL,
  apply: 'filterPixel',
  uniforms: pixelUniforms,
  source: {
    uniform: 'uPixelSource',
    size: pixelSourceSize,
    samples: pixelSourceSamples,
    reduce: {
      uniform: 'uPixelColors',
      size: (frame, density) => {
        const { across, down } = pixelBaseGrid(frame, density)
        return { width: 2 * across, height: down }
      },
      glsl: PIXEL_COLORS_GLSL,
      apply: 'pixelColorOf',
    },
  },
}
