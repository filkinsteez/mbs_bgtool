import type { UniformMap } from '../../scene'
import type { FilterFrame, OutputFilter } from './types'

/**
 * Paper: the picture as if printed on uncoated paper, kept subtle (owner, 2026-11-12: "could we add in a paper shader?"
 * and "should be pretty subtle so no like major folds or anything like that"). It moves Oklab lightness, and a little
 * chroma, by zero-mean textures sized as fractions of the frame's short side, so a preview and an export show the same
 * paper and a blurred picture keeps its colors. No folds, creases, stains, vignettes or wear.
 *
 * Two kinds of texture, as in a print:
 * - The paper's surface, everywhere, in proportion to the lightness (light reflected off the sheet): a faint cloud, the
 *   sheet's formation (flocs), the tooth, and sparse short fibres, lighter and darker. White areas show them as faint
 *   shade, the way paper white looks.
 * - The ink's density, strongest in the middle and dark tones and gone at black and at white: the formation and the
 *   tooth make the ink lie thicker and thinner, and fibres show through it as lighter hairs. Thinner ink is lighter and
 *   a little less saturated. A change of ink density by a share e moves lightness by about e L ln(1 / L), which is 0 at
 *   black and at white and largest at L = 1 / e.
 *
 * A layer whose cells are under three output pixels wide is averaged over the pixel from four samples and fades out
 * below a pixel, and the fibres are drawn at least a pixel wide with their contrast cut to match, so a small preview
 * shows what the export shows once shrunk to that size. The textures come from hashes of the place in short-side units
 * and the scene's seed: the same frame always gets the same paper.
 */

/** Lattice cells per short side of each layer. */
const CLOUD = [12, 24] as const
const FLOC = [150, 300] as const
const TOOTH = [480, 960] as const
/** Fibres: cells per short side, the share of cells with one, half their length (at most a cell), width and bend in cells. */
const FIBRE_CELLS = 140
const FIBRE_SHARE = 0.1
const FIBRE_HALF_LENGTH = 1
const FIBRE_WIDTH = 0.1
const FIBRE_BEND = 0.35
/** The share of fibres darker than the paper; the rest are lighter. */
const FIBRE_DARK = 0.55
/** The mean of the all-lighter fibres per unit area (share x width x length x the hair's profile), taken off in ink. */
const FIBRE_MEAN = FIBRE_SHARE * FIBRE_WIDTH * FIBRE_HALF_LENGTH * (Math.sqrt(Math.PI) / 2)
/** Lightness change at Strength 1 per unit of each texture, as a share of L: the paper's surface. */
const SURFACE = { cloud: 0.012, floc: 0.01, tooth: 0.022, fibre: 0.02 } as const
/** Lightness change at Strength 1 per unit of each texture where the ink's effect is largest (L = 1 / e). */
const INK = { floc: 0.03, tooth: 0.045, fibre: 0.045 } as const
/**
 * Chroma change per unit of the ink texture: thinner ink is less saturated. The texture is a share e of the ink's
 * density (see paperInkShare), and chroma follows about 0.7 of a density change.
 */
const INK_CHROMA = 0.7 * Math.E
/** A layer's cells in output pixels: gone under the first number, full from the second. */
const FADE_PX = [0.5, 1] as const
/** Under this many output pixels a layer's cells are averaged over the pixel from four samples. */
const SAMPLE_BELOW_PX = 3

const glslFloat = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v))

/** How much an ink density change shows at Oklab lightness L, 0..1: e L ln(1 / L), 1 at L = 1 / e, 0 at black and white. */
export function paperInkShare(L: number): number {
  const l = Math.min(1, Math.max(0, L))
  return l <= 0 ? 0 : Math.max(0, Math.E * l * Math.log(1 / l))
}

/** Uniforms for PAPER_GLSL at an output size. */
export function paperUniforms(strength: number, frame: FilterFrame): UniformMap {
  return {
    uPaperAmp: Math.min(1, Math.max(0, Number.isFinite(strength) ? strength : 0)),
    uPaperShort: Math.max(1, Math.min(frame.width, frame.height)),
  }
}

/** Needs CHUNK_LIBRARY (hashes, Oklab) and uSeed. */
export const PAPER_GLSL = /* glsl */ `
uniform float uPaperAmp;    // strength, 0..1; 0 is off
uniform float uPaperShort;  // the output's short side in pixels

float paperLattice(ivec2 q, int seed) {
  return unitFromUint(hashKey(ivec3(q, seed))).x * 2.0 - 1.0;
}

// Smooth value noise, -1..1.
float paperNoise(vec2 p, int seed) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  ivec2 q = ivec2(i);
  float top = mix(paperLattice(q, seed), paperLattice(q + ivec2(1, 0), seed), u.x);
  float bottom = mix(paperLattice(q + ivec2(0, 1), seed), paperLattice(q + ivec2(1, 1), seed), u.x);
  return mix(top, bottom, u.y);
}

// One octave of noise with this many cells per short side, averaged over the output pixel: four samples inside the
// pixel where the cells are under ${SAMPLE_BELOW_PX} pixels wide, fading out below a pixel, none below half a pixel.
float paperOctave(vec2 p, float cells, int seed) {
  float cellPx = uPaperShort / cells;
  if (cellPx < ${glslFloat(FADE_PX[0])}) return 0.0;
  vec2 q = p * cells;
  if (cellPx >= ${glslFloat(SAMPLE_BELOW_PX)}) return paperNoise(q, seed);
  float o = 0.25 / cellPx;
  float sum = paperNoise(q + vec2(-o, -o), seed) + paperNoise(q + vec2(o, -o), seed) + paperNoise(q + vec2(-o, o), seed) + paperNoise(q + vec2(o, o), seed);
  return 0.25 * sum * smoothstep(${glslFloat(FADE_PX[0])}, ${glslFloat(FADE_PX[1])}, cellPx);
}

// Two octaves of noise.
float paperOctaves(vec2 p, float coarse, float fine, int seed) {
  return 0.6 * paperOctave(p, coarse, seed) + 0.4 * paperOctave(p + 17.0 / fine, fine, seed + 1);
}

// Sparse short fibres: some cells of a lattice hold one hair at a random angle, a little bent, with tapered ends,
// drawn at least a pixel wide with its contrast cut to match. x: the hairs, lighter (+) or darker (-); y: all lighter.
vec2 paperFibres(vec2 p, int s) {
  vec2 g = p * ${glslFloat(FIBRE_CELLS)};
  ivec2 base = ivec2(floor(g));
  float width = max(${glslFloat(FIBRE_WIDTH)}, ${glslFloat(FIBRE_CELLS)} / uPaperShort);
  float cover = ${glslFloat(FIBRE_WIDTH)} / width;
  vec2 sum = vec2(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      ivec2 c = base + ivec2(i, j);
      vec3 u = unitFromUint(hashKey(ivec3(c, s + 11)));
      if (u.x >= ${glslFloat(FIBRE_SHARE)}) continue;
      vec3 v = unitFromUint(hashKey(ivec3(c, s + 12)));
      float a = 6.2831853 * u.y;
      vec2 d = vec2(cos(a), sin(a));
      vec2 rel = g - (vec2(c) + v.xy);
      float reach = ${glslFloat(FIBRE_HALF_LENGTH)} * (0.5 + 0.5 * v.z);
      float t = dot(rel, d) / reach;
      if (abs(t) >= 1.0) continue;
      float across = dot(rel, vec2(-d.y, d.x)) - (u.z - 0.5) * ${glslFloat(FIBRE_BEND)} * reach * (1.0 - t * t);
      float hair = cover * exp(-4.0 * across * across / (width * width)) * (1.0 - t * t);
      float tone = u.x < ${glslFloat(FIBRE_SHARE * FIBRE_DARK)} ? -1.0 : 1.0;
      sum += vec2(tone, 1.0) * hair;
    }
  }
  return sum;
}

// Display-linear in, display-linear out.
vec3 applyPaper(vec3 display, ivec2 px) {
  vec3 lab = linearToOklab(display);
  float L = clamp(lab.x, 0.0, 1.0);
  vec2 p = (vec2(px) + 0.5) / uPaperShort;
  int s = uSeed * 197 + 4099;
  float cloud = paperOctaves(p, ${glslFloat(CLOUD[0])}, ${glslFloat(CLOUD[1])}, s);
  float floc = paperOctaves(p, ${glslFloat(FLOC[0])}, ${glslFloat(FLOC[1])}, s + 2);
  float tooth = paperOctaves(p, ${glslFloat(TOOTH[0])}, ${glslFloat(TOOTH[1])}, s + 4);
  vec2 fibre = paperFibres(p, s);
  float surface = ${glslFloat(SURFACE.cloud)} * cloud + ${glslFloat(SURFACE.floc)} * floc + ${glslFloat(SURFACE.tooth)} * tooth + ${glslFloat(SURFACE.fibre)} * fibre.x;
  float ink = ${glslFloat(INK.floc)} * floc + ${glslFloat(INK.tooth)} * tooth + ${glslFloat(INK.fibre)} * (fibre.y - ${glslFloat(FIBRE_MEAN)});
  float inkShare = L > 0.0 ? max(0.0, ${glslFloat(Math.E)} * L * log(1.0 / L)) : 0.0;
  lab.x += uPaperAmp * (L * surface + inkShare * ink);
  lab.yz *= 1.0 - uPaperAmp * ${glslFloat(INK_CHROMA)} * ink;
  return saturate(oklabToLinear(lab));
}
`

/** Paper as a stage of the output filter chain. */
export const PAPER_FILTER: OutputFilter = {
  key: 'paper',
  glsl:
    PAPER_GLSL +
    /* glsl */ `
// The paper lies under the whole picture, so the recipe's grain weight doesn't apply to it.
vec3 filterPaper(vec3 display, ivec2 px, float weight) {
  if (uPaperAmp <= 0.0) return display;
  return applyPaper(display, px);
}
`,
  apply: 'filterPaper',
  uniforms: (strength, frame) => paperUniforms(strength, frame),
}
