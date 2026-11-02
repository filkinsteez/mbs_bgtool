import type { Gpu, Target } from './gl'

/** Adds up GPU time per stage of a render. Each mark waits for the GPU with a 1-pixel read of the stage's output. */
export interface Profiler {
  mark(stage: string, target: Target): void
}

export const NO_PROFILE: Profiler = { mark: () => {} }

export function createProfiler(gpu: Gpu): Profiler & { times: Record<string, number> } {
  const gl = gpu.gl
  const bytes = new Uint8Array(4)
  const floats = new Float32Array(4)
  const times: Record<string, number> = {}
  let last = performance.now()
  return {
    times,
    mark(stage, target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer)
      if (target.format === 'rgba8') gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes)
      else gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, floats)
      const now = performance.now()
      times[stage] = (times[stage] ?? 0) + (now - last)
      last = now
    },
  }
}
