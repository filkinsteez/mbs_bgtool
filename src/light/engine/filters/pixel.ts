import type { UniformMap } from '../../scene'
import type { FilterFrame, OutputFilter } from './types'

/**
 * The Pixel filter (prototypes/pixel, docs/light/research/pixel.md): the frame quantized to a grid of square cells,
 * seen as an LED wall up close.
 *
 * - Each cell shows its mean color, flat, and blends into its neighbours over about a fifth of a cell.
 * - A rounded-square LED brightens the middle of each cell and darkens the gaps by the same amount of light, so a
 *   cell keeps its mean. Where the brighter middle would push a channel past 1, the rest of its light is added as
 *   white (bright LEDs whiten, as on camera). The LED fades out as the cell's luminance nears white, where light
 *   blooms over the gaps.
 * - A share of the light spreads over the neighbouring cells as a smooth glow (a cubic B-spline through the cell
 *   means), as a lens blooms an LED wall.
 *
 * Strength 0 to 0.5 fades the filter in; 0.5 to 1 raises the LED contrast. The cells are a fixed fraction of the
 * short side and the cell means come from the engine's frame source, so a preview and an export show the same cells.
 */

/** Cells on the short side. 36 fills 16:9, 9:16, 1:1 and 4:5 frames with whole square cells. */
export const PIXEL_CELLS = 36
/** Frame source texels per cell along each axis: a cell's mean is one bilinear read at its center. */
export const PIXEL_TEXELS_PER_CELL = 2
/** How sharply a cell blends into the next: the blend runs over about a fifth of a cell. */
const BLEND_POWER = 8
/** The LED: a rounded square of half-size 0.4 cell, its edge 0.12 cell wide, superellipse corners of exponent 4. */
const LED_HALF = 0.4
const LED_EDGE = 0.12
const LED_CORNER = 4
/** Share of the light spread over the neighbouring cells. */
const GLOW = 0.3
/** LED contrast at strength 0.5 and at 1. Above about 0.2 the gaps read as a mesh when the frame is seen whole. */
const CONTRAST_HALF = 0.1
const CONTRAST_FULL = 0.2
/** Cell luminance where the LED starts to fade; it is gone at 1. */
const FADE_FROM = 0.7

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

/** Cells across and down: PIXEL_CELLS on the short side and a whole number on the long side, filling the frame. */
export function pixelGrid(width: number, height: number): { across: number; down: number } {
  const long = Math.max(1, Math.round((PIXEL_CELLS * Math.max(width, height)) / Math.min(width, height)))
  return width >= height ? { across: long, down: PIXEL_CELLS } : { across: PIXEL_CELLS, down: long }
}

/** How much of the filtered image shows, and the LED contrast, at a strength 0..1. */
export function pixelParams(strength: number): { amount: number; contrast: number } {
  const s = Math.min(1, Math.max(0, strength))
  return {
    amount: Math.min(1, s / 0.5),
    contrast: CONTRAST_HALF + (CONTRAST_FULL - CONTRAST_HALF) * Math.max(0, (s - 0.5) / 0.5),
  }
}

export function pixelUniforms(strength: number, frame: FilterFrame): UniformMap {
  const { across, down } = pixelGrid(frame.width, frame.height)
  const { amount, contrast } = pixelParams(strength)
  return {
    uPixelCells: [across, down],
    uPixelFrame: [frame.width, frame.height],
    uPixelAmount: amount,
    uPixelContrast: contrast,
  }
}

const glslFloat = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v))

/** Needs CHUNK_LIBRARY (luminance, maxComponent). */
export const PIXEL_GLSL = /* glsl */ `
uniform sampler2D uPixelSource;
uniform vec2 uPixelCells;
uniform vec2 uPixelFrame;
uniform float uPixelAmount;
uniform float uPixelContrast;

// Mean color of a cell (row 0 at the top); cells past the frame edge repeat the edge cell.
vec3 pixelCell(ivec2 cell) {
  vec2 c = clamp(vec2(cell), vec2(0.0), uPixelCells - 1.0);
  return textureLod(uPixelSource, (c + 0.5) / uPixelCells, 0.0).rgb;
}

// Weight of the next cell at t (0..1) between two cell centers.
float pixelBlend(float t) {
  float a = pow(t, ${glslFloat(BLEND_POWER)});
  float b = pow(1.0 - t, ${glslFloat(BLEND_POWER)});
  return a / (a + b);
}

vec4 pixelSpline(float t) {
  float s = 1.0 - t;
  float t2 = t * t;
  float t3 = t2 * t;
  return vec4(s * s * s, 3.0 * t3 - 6.0 * t2 + 4.0, -3.0 * t3 + 3.0 * t2 + 3.0 * t + 1.0, t3) / 6.0;
}

float pixelLed(vec2 offset) {
  vec2 a = abs(offset);
  float d = pow(pow(a.x, ${glslFloat(LED_CORNER)}) + pow(a.y, ${glslFloat(LED_CORNER)}), ${glslFloat(1 / LED_CORNER)});
  return 1.0 - smoothstep(${glslFloat(LED_HALF - LED_EDGE / 2)}, ${glslFloat(LED_HALF + LED_EDGE / 2)}, d);
}

vec3 filterPixel(vec3 display, ivec2 px, float weight) {
  vec2 f = (vec2(px) + 0.5) * uPixelCells / uPixelFrame - 0.5;
  vec2 corner = floor(f);
  vec2 t = f - corner;
  ivec2 c = ivec2(corner);
  float wx = pixelBlend(t.x);
  vec3 cells = mix(
    mix(pixelCell(c), pixelCell(c + ivec2(1, 0)), wx),
    mix(pixelCell(c + ivec2(0, 1)), pixelCell(c + ivec2(1, 1)), wx),
    pixelBlend(t.y));

  vec4 bx = pixelSpline(t.x);
  vec4 by = pixelSpline(t.y);
  vec3 glow = vec3(0.0);
  for (int j = 0; j < 4; j++) {
    vec3 row = vec3(0.0);
    for (int i = 0; i < 4; i++) row += bx[i] * pixelCell(c + ivec2(i - 1, j - 1));
    glow += by[j] * row;
  }

  float y = luminance(cells);
  float contrast = uPixelContrast * (1.0 - smoothstep(${glslFloat(FADE_FROM)}, 1.0, y));
  float gain = 1.0 + contrast * (pixelLed(f - floor(f + 0.5)) / ${glslFloat(PIXEL_LED_AREA)} - 1.0);
  float white = 0.0;
  float top = maxComponent(cells);
  if (top * gain > 1.0) {
    float fit = 1.0 / top;
    white = min(1.0, (gain - fit) * y / max(1.0 - fit * y, 1e-6));
    gain = fit;
  }
  vec3 lit = cells * gain;
  vec3 led = lit + white * (1.0 - lit);
  return mix(display, mix(led, glow, ${glslFloat(GLOW)}), uPixelAmount);
}
`

export const PIXEL_FILTER: OutputFilter = {
  key: 'pixel',
  glsl: PIXEL_GLSL,
  apply: 'filterPixel',
  uniforms: pixelUniforms,
  source: {
    uniform: 'uPixelSource',
    size: (frame) => {
      const { across, down } = pixelGrid(frame.width, frame.height)
      return { width: across * PIXEL_TEXELS_PER_CELL, height: down * PIXEL_TEXELS_PER_CELL }
    },
  },
}
