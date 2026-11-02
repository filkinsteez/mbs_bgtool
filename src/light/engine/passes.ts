import type { PostPass, RecipeContext } from '../scene'
import type { Gpu, Target } from './gl'
import { CHUNK_LIBRARY, GLSL_HEADER } from './glsl'

/** Post passes run at this short side at most; their output is upsampled with a cubic filter. */
export const POST_MAX_SHORT_SIDE = 2048

const GAUSSIAN_SHADER =
  GLSL_HEADER +
  /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uDirection;
uniform float uSigma;
out vec4 fragColor;
// Separable gaussian; pairs of taps share one bilinear fetch.
void main() {
  vec2 size = vec2(textureSize(uSrc, 0));
  vec2 uv = gl_FragCoord.xy / size;
  vec2 texel = uDirection / size;
  int radius = int(ceil(3.0 * uSigma));
  vec4 sum = texture(uSrc, uv);
  float total = 1.0;
  for (int i = 1; i <= 96; i += 2) {
    if (i > radius) break;
    float a = exp(-0.5 * float(i * i) / (uSigma * uSigma));
    float b = exp(-0.5 * float((i + 1) * (i + 1)) / (uSigma * uSigma));
    float w = a + b;
    float offset = (float(i) * a + float(i + 1) * b) / w;
    sum += w * (texture(uSrc, uv + texel * offset) + texture(uSrc, uv - texel * offset));
    total += 2.0 * w;
  }
  fragColor = sum / total;
}
`

const DIRECTIONAL_SHADER =
  GLSL_HEADER +
  /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uStep;
out vec4 fragColor;
// 16 taps centered on the pixel, uStep apart (uv units). Two passes with steps L/256 and L/16 give 256 even taps.
void main() {
  vec2 uv = gl_FragCoord.xy / vec2(textureSize(uSrc, 0));
  vec4 sum = vec4(0.0);
  for (int k = 0; k < 16; k++) sum += texture(uSrc, uv + uStep * (float(k) - 7.5));
  fragColor = sum / 16.0;
}
`

const RADIAL_SHADER =
  GLSL_HEADER +
  /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uCenter;
uniform float uLogStep;
out vec4 fragColor;
// 16 taps toward uCenter at scales exp(-k * uLogStep). Two passes give 256 taps evenly spaced in log scale.
void main() {
  vec2 uv = gl_FragCoord.xy / vec2(textureSize(uSrc, 0));
  vec4 sum = vec4(0.0);
  for (int k = 0; k < 16; k++) sum += texture(uSrc, uCenter + (uv - uCenter) * exp(-float(k) * uLogStep));
  fragColor = sum / 16.0;
}
`

const HALVE_SHADER =
  GLSL_HEADER +
  /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uDstSize;
out vec4 fragColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uDstSize;
  vec2 t = 0.5 / vec2(textureSize(uSrc, 0));
  vec4 sum = texture(uSrc, uv + vec2(-t.x, -t.y)) + texture(uSrc, uv + vec2(t.x, -t.y))
           + texture(uSrc, uv + vec2(-t.x, t.y)) + texture(uSrc, uv + vec2(t.x, t.y));
  fragColor = sum * 0.25;
}
`

/** Downsamples uSrc to the target size by averaging uTaps x uTaps bilinear samples per pixel. */
export const AREA_RESAMPLE_SHADER =
  GLSL_HEADER +
  /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uDstSize;
uniform int uTaps;
out vec4 fragColor;
void main() {
  vec2 corner = gl_FragCoord.xy - 0.5;
  float inv = 1.0 / float(uTaps);
  vec4 sum = vec4(0.0);
  for (int j = 0; j < 8; j++) {
    if (j >= uTaps) break;
    for (int i = 0; i < 8; i++) {
      if (i >= uTaps) break;
      sum += texture(uSrc, (corner + (vec2(float(i), float(j)) + 0.5) * inv) / uDstSize);
    }
  }
  fragColor = sum * inv * inv;
}
`

/** Resamples uSrc to the target size with a cubic B-spline (smooth upsampling). */
export const RESAMPLE_SMOOTH_SHADER =
  GLSL_HEADER +
  CHUNK_LIBRARY +
  /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uDstSize;
out vec4 fragColor;
void main() {
  fragColor = sampleSmooth4(uSrc, gl_FragCoord.xy / uDstSize);
}
`

/**
 * Runs a recipe's post passes on its radiance image. Returns the input itself
 * when every pass is a no-op; otherwise a new target the caller releases.
 */
export function runPostPasses(gpu: Gpu, input: Target, passes: readonly PostPass[], ctx: RecipeContext): Target {
  let current = input
  const short = Math.min(input.width, input.height)
  const aspect = [input.width / short, input.height / short]
  const swap = (next: Target) => {
    if (current !== input) gpu.release(current)
    current = next
  }
  for (const pass of passes) {
    switch (pass.kind) {
      case 'gaussianBlur': {
        const { radius } = pass.settings(ctx)
        if (radius > 0) swap(gaussianBlur(gpu, current, radius * short))
        break
      }
      case 'directionalBlur': {
        const { angle, length } = pass.settings(ctx)
        if (length > 0) {
          const a = (angle * Math.PI) / 180
          const dir = [Math.cos(a) / aspect[0], Math.sin(a) / aspect[1]]
          for (const step of [length / 256, length / 16]) {
            const out = gpu.acquire(current.width, current.height)
            gpu.draw(gpu.program(DIRECTIONAL_SHADER), out, {
              textures: { uSrc: current },
              uniforms: { uStep: [dir[0] * step, dir[1] * step] },
            })
            swap(out)
          }
        }
        break
      }
      case 'radialBlur': {
        const { center, amount } = pass.settings(ctx)
        if (amount > 0) {
          const logRange = -Math.log(Math.max(1e-3, 1 - Math.min(amount, 0.999)))
          for (const logStep of [logRange / 256, logRange / 16]) {
            const out = gpu.acquire(current.width, current.height)
            gpu.draw(gpu.program(RADIAL_SHADER), out, {
              textures: { uSrc: current },
              uniforms: { uCenter: [center[0], center[1]], uLogStep: logStep },
            })
            swap(out)
          }
        }
        break
      }
      default: {
        const unknown: never = pass
        throw new Error(`Unknown post pass: ${JSON.stringify(unknown)}`)
      }
    }
  }
  return current
}

/** Gaussian blur with sigma in pixels of the input. Large sigmas blur a downsampled copy. Caller releases the result. */
export function gaussianBlur(gpu: Gpu, input: Target, sigma: number): Target {
  const maxSigma = 24
  let level = input
  let scale = 1
  const owned: Target[] = []
  while (sigma / scale > maxSigma && Math.min(level.width, level.height) > 8) {
    const next = gpu.acquire(Math.max(1, Math.round(level.width / 2)), Math.max(1, Math.round(level.height / 2)))
    gpu.draw(gpu.program(HALVE_SHADER), next, {
      textures: { uSrc: level },
      uniforms: { uDstSize: [next.width, next.height] },
    })
    owned.push(next)
    level = next
    scale *= 2
  }
  // Each halving adds roughly half a texel of blur at its level.
  const reduced = Math.sqrt(Math.max(0, sigma * sigma - (scale > 1 ? 0.25 * scale * scale : 0))) / scale
  const program = gpu.program(GAUSSIAN_SHADER)
  const sigmaUniform = Math.max(reduced, 0.01)
  const horizontal = gpu.acquire(level.width, level.height)
  gpu.draw(program, horizontal, { textures: { uSrc: level }, uniforms: { uDirection: [1, 0], uSigma: sigmaUniform } })
  const both = gpu.acquire(level.width, level.height)
  gpu.draw(program, both, { textures: { uSrc: horizontal }, uniforms: { uDirection: [0, 1], uSigma: sigmaUniform } })
  gpu.release(horizontal)
  for (const t of owned) gpu.release(t)
  if (scale === 1) return both
  const out = gpu.acquire(input.width, input.height)
  gpu.draw(gpu.program(RESAMPLE_SMOOTH_SHADER), out, {
    textures: { uSrc: both },
    uniforms: { uDstSize: [out.width, out.height] },
  })
  gpu.release(both)
  return out
}
