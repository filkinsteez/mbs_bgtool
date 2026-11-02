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
uniform float uHalationStart; // max channel (x nominal) where light starts to feed halation, >= 1
`

// Averages uSubsamples^2 samples of SAMPLE(uv, p) per pixel. Used for the lens base, the post-pass input and scatter
// sources. Alpha is the average of the light above nominal that feeds halation, taken per sample so thin bright
// lines count before they are averaged away.
function subsampledMain(sample: string, clampNegative: boolean): string {
  return /* glsl */ `
out vec4 fragColor;
void main() {
  vec2 corner = gl_FragCoord.xy - 0.5 + uTileOrigin;
  float inv = 1.0 / float(uSubsamples);
  vec3 sum = vec3(0.0);
  float hot = 0.0;
  for (int j = 0; j < 4; j++) {
    if (j >= uSubsamples) break;
    for (int i = 0; i < 4; i++) {
      if (i >= uSubsamples) break;
      vec2 uv = (corner + (vec2(float(i), float(j)) + 0.5) * inv) / uRenderSize;
      vec3 c = ${sample}(uv, (uv - 0.5) * uFrameAspect);
      if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
      ${clampNegative ? 'c = max(c, vec3(0.0));' : ''}
      sum += c;
      hot += luminance(max(c, vec3(0.0))) * smoothstep(uHalationStart, 2.0 * uHalationStart, maxComponent(c));
    }
  }
  fragColor = vec4(sum * inv * inv, hot * inv * inv);
}
`
}

// Composite mode: one sample per pixel at render resolution, then lens, exposure and tone curve.
const COMPOSITE_MAIN = /* glsl */ `
out vec4 fragColor;
void main() {
  vec2 uv = (gl_FragCoord.xy + uTileOrigin) / uRenderSize;
  fragColor = vec4(lensAndTone(sceneRadiance(uv, (uv - 0.5) * uFrameAspect), uv), 1.0);
}
`

/** The radiance the pipeline sees: the recipe's own, or what its `combine` makes of it and the blurred light. */
function sceneRadianceGlsl(program: Pick<RecipeProgram, 'scatter'>): string {
  const blurs = program.scatter ?? []
  if (blurs.length === 0) return `vec3 sceneRadiance(vec2 uv, vec2 p) { return radiance(uv, p); }\n`
  const samplers = blurs.map((_, i) => `uniform sampler2D uScatter${i};`).join('\n')
  const args = blurs.map((_, i) => `sampleSmooth(uScatter${i}, uv)`).join(', ')
  return `${samplers}\nvec3 sceneRadiance(vec2 uv, vec2 p) { return combine(uv, p, radiance(uv, p), ${args}); }\n`
}

/**
 * - radiance: the scene radiance (after `combine`), subsampled; for the lens base and post passes.
 * - composite: scene radiance at render resolution, then lens and tone curve.
 * - source / aux: the recipe's raw `radiance` / `auxRadiance`, subsampled; the inputs of scatter blurs.
 */
export type RecipeShaderMode = 'radiance' | 'composite' | 'source' | 'aux'

export function buildRecipeShader(program: Pick<RecipeProgram, 'fragment' | 'scatter'>, mode: RecipeShaderMode): string {
  const head = GLSL_HEADER + ENGINE_UNIFORMS + CHUNK_LIBRARY
  switch (mode) {
    case 'radiance':
      return head + program.fragment + sceneRadianceGlsl(program) + subsampledMain('sceneRadiance', true)
    case 'composite':
      return head + LENS_COMPOSITE_GLSL + program.fragment + sceneRadianceGlsl(program) + COMPOSITE_MAIN
    case 'source':
      return head + program.fragment + subsampledMain('radiance', true)
    case 'aux':
      return head + program.fragment + subsampledMain('auxRadiance', false)
    default: {
      const unknown: never = mode
      throw new Error(`Unknown shader mode: ${String(unknown)}`)
    }
  }
}
