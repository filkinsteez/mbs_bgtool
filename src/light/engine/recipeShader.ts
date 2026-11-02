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
uniform int uSubsamples;    // per axis, radiance mode only
`

// Radiance mode: averages uSubsamples^2 samples per pixel. Used for the lens base and post-pass input.
const RADIANCE_MAIN = /* glsl */ `
out vec4 fragColor;
void main() {
  vec2 corner = gl_FragCoord.xy - 0.5 + uTileOrigin;
  float inv = 1.0 / float(uSubsamples);
  vec3 sum = vec3(0.0);
  for (int j = 0; j < 4; j++) {
    if (j >= uSubsamples) break;
    for (int i = 0; i < 4; i++) {
      if (i >= uSubsamples) break;
      vec2 uv = (corner + (vec2(float(i), float(j)) + 0.5) * inv) / uRenderSize;
      vec3 c = radiance(uv, (uv - 0.5) * uFrameAspect);
      if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
      sum += max(c, vec3(0.0));
    }
  }
  fragColor = vec4(sum * inv * inv, 1.0);
}
`

// Composite mode: one sample per pixel at render resolution, then lens, exposure and tone curve.
const COMPOSITE_MAIN = /* glsl */ `
out vec4 fragColor;
void main() {
  vec2 uv = (gl_FragCoord.xy + uTileOrigin) / uRenderSize;
  fragColor = vec4(lensAndTone(radiance(uv, (uv - 0.5) * uFrameAspect), uv), 1.0);
}
`

export type RecipeShaderMode = 'radiance' | 'composite'

export function buildRecipeShader(program: Pick<RecipeProgram, 'fragment'>, mode: RecipeShaderMode): string {
  const head = GLSL_HEADER + ENGINE_UNIFORMS + CHUNK_LIBRARY
  switch (mode) {
    case 'radiance':
      return head + program.fragment + RADIANCE_MAIN
    case 'composite':
      return head + LENS_COMPOSITE_GLSL + program.fragment + COMPOSITE_MAIN
    default: {
      const unknown: never = mode
      throw new Error(`Unknown shader mode: ${String(unknown)}`)
    }
  }
}
