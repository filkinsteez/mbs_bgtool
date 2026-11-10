import type { RecipeProgram } from '../scene'
import { CHUNK_LIBRARY, GLSL_HEADER } from './glsl'
import { LENS_COMPOSITE_GLSL } from './lens'

/** Uniforms the engine sets for every recipe shader. */
const ENGINE_UNIFORMS = /* glsl */ `
uniform vec2 uRenderSize;   // full frame at this pass's resolution, px
uniform vec2 uTileOrigin;   // this target's pixel (0, 0) in the full frame, px
uniform vec2 uFrameAspect;  // uRenderSize / short side
uniform float uPixel;       // one sample spacing in short-side units (for antialiasing)
uniform int uSeed;
uniform int uSubsamples;    // per axis, radiance modes only
uniform float uHalationStart; // channel value (x nominal, after exposure) where light starts to feed halation, >= 1
uniform float uExposureScale; // 2^exposure
`

// Averages uSubsamples^2 samples of SAMPLE(uv, p) per pixel. Used for the lens base, the post-pass input and scatter
// sources. Alpha is the mean grain weight in radiance mode. Output 1 (drawn only into the lens base) is each
// channel's own exposed light above nominal, which feeds halation; it is taken per sample so thin bright lines count
// before they are averaged away.
function subsampledMain(sample: string, clampNegative: boolean, weighted: boolean): string {
  return /* glsl */ `
layout(location = 0) out vec4 fragColor;
layout(location = 1) out vec4 hotColor;
void main() {
  vec2 corner = gl_FragCoord.xy - 0.5 + uTileOrigin;
  float inv = 1.0 / float(uSubsamples);
  vec3 sum = vec3(0.0);
  vec3 hot = vec3(0.0);
  float weight = 0.0;
  for (int j = 0; j < 4; j++) {
    if (j >= uSubsamples) break;
    for (int i = 0; i < 4; i++) {
      if (i >= uSubsamples) break;
      vec2 uv = (corner + (vec2(float(i), float(j)) + 0.5) * inv) / uRenderSize;
      vec2 p = (uv - 0.5) * uFrameAspect;
      vec3 c = ${sample}(uv, p);
      if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
      ${clampNegative ? 'c = max(c, vec3(0.0));' : ''}
      sum += c;
      vec3 exposed = max(c, vec3(0.0)) * uExposureScale;
      hot += exposed * smoothstep(vec3(uHalationStart), vec3(2.0 * uHalationStart), exposed);
      weight += ${weighted ? 'sceneGrainWeight(uv, p)' : '1.0'};
    }
  }
  fragColor = vec4(sum * inv * inv, weight * inv * inv);
  hotColor = vec4(hot * inv * inv, 1.0);
}
`
}

// Composite mode: one sample per pixel at render resolution, then lens, exposure and tone curve. Alpha is the grain weight.
const COMPOSITE_MAIN = /* glsl */ `
out vec4 fragColor;
void main() {
  vec2 uv = (gl_FragCoord.xy + uTileOrigin) / uRenderSize;
  vec2 p = (uv - 0.5) * uFrameAspect;
  fragColor = vec4(lensAndTone(sceneRadiance(uv, p), uv), sceneGrainWeight(uv, p));
}
`

/**
 * The radiance the pipeline sees. With the color stage's GLSL (`colorStage`), it is the stage's recoloring of the
 * recipe's radiance; without it, the recipe's radiance itself.
 */
function sceneRadianceGlsl(program: Pick<RecipeProgram, 'scatter'>, stage?: string): string {
  const own = ownRadianceGlsl(program)
  if (!stage) return own
  return `${own.replace('vec3 sceneRadiance(vec2 uv, vec2 p)', 'vec3 designRadiance(vec2 uv, vec2 p)')}${stage}
vec3 sceneRadiance(vec2 uv, vec2 p) { return colorStage(uv, designRadiance(uv, p)); }\n`
}

/** The recipe's own radiance: `radiance`, or what its `combine` makes of it and the blurred light. */
function ownRadianceGlsl(program: Pick<RecipeProgram, 'scatter'>): string {
  const blurs = program.scatter ?? []
  if (blurs.length === 0) return `vec3 sceneRadiance(vec2 uv, vec2 p) { return radiance(uv, p); }\n`
  // uScatterB<i> is the same blur with the edges of the edge level before, mixed in just past a switch (runScatter).
  const reads = blurs
    .map(
      (_, i) => `uniform sampler2D uScatter${i};
uniform vec4 uScatterMap${i};
uniform sampler2D uScatterB${i};
uniform vec4 uScatterMapB${i};
uniform float uScatterMix${i};
vec3 engineScatter${i}(vec2 uv) {
  vec3 blurred = sampleSmooth(uScatter${i}, uv * uScatterMap${i}.xy + uScatterMap${i}.zw);
  if (uScatterMix${i} <= 0.0) return blurred;
  return mix(blurred, sampleSmooth(uScatterB${i}, uv * uScatterMapB${i}.xy + uScatterMapB${i}.zw), uScatterMix${i});
}`,
    )
    .join('\n')
  const args = blurs.map((_, i) => `engineScatter${i}(uv)`).join(', ')
  return `${reads}\nvec3 sceneRadiance(vec2 uv, vec2 p) { return combine(uv, p, radiance(uv, p), ${args}); }\n`
}

function grainWeightGlsl(program: Pick<RecipeProgram, 'grainWeight'>): string {
  return program.grainWeight
    ? `float sceneGrainWeight(vec2 uv, vec2 p) { return saturate(grainWeight(uv, p)); }\n`
    : `float sceneGrainWeight(vec2 uv, vec2 p) { return 1.0; }\n`
}

/**
 * - radiance: the scene radiance (after `combine`), subsampled, grain weight in alpha; for the lens base and post passes.
 * - composite: scene radiance at render resolution, then lens and tone curve; grain weight in alpha.
 * - source / aux: the recipe's raw `radiance` / `auxRadiance`, subsampled; the inputs of scatter blurs.
 */
export type RecipeShaderMode = 'radiance' | 'composite' | 'source' | 'aux'

/** `stage`: the color stage's GLSL, for the modes that draw the scene radiance (radiance, composite). */
export function buildRecipeShader(program: Pick<RecipeProgram, 'fragment' | 'scatter' | 'grainWeight'>, mode: RecipeShaderMode, stage?: string): string {
  const head = GLSL_HEADER + ENGINE_UNIFORMS + CHUNK_LIBRARY
  switch (mode) {
    case 'radiance':
      return head + program.fragment + sceneRadianceGlsl(program, stage) + grainWeightGlsl(program) + subsampledMain('sceneRadiance', true, true)
    case 'composite':
      return head + LENS_COMPOSITE_GLSL + program.fragment + sceneRadianceGlsl(program, stage) + grainWeightGlsl(program) + COMPOSITE_MAIN
    case 'source':
      return head + program.fragment + subsampledMain('radiance', true, false)
    case 'aux':
      return head + program.fragment + subsampledMain('auxRadiance', false, false)
    default: {
      const unknown: never = mode
      throw new Error(`Unknown shader mode: ${String(unknown)}`)
    }
  }
}
