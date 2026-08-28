import type { BackgroundRecipeV2 } from '../recipe'

export type MaterialFrameCaptureRequest = {
  recipe?: BackgroundRecipeV2
  output?: 'auto' | 'raw'
  phase?: number
}

export type MaterialFrameCapture = (
  width: number,
  height: number,
  request?: MaterialFrameCaptureRequest,
) => Promise<HTMLCanvasElement>

let currentCapture: MaterialFrameCapture | null = null

export function registerMaterialFrameCapture(
  capture: MaterialFrameCapture,
): () => void {
  currentCapture = capture
  return () => {
    if (currentCapture === capture) currentCapture = null
  }
}

export function captureMaterialFrame(
  width: number,
  height: number,
  request?: MaterialFrameCaptureRequest,
): Promise<HTMLCanvasElement> {
  if (!currentCapture) {
    return Promise.reject(new Error('3D view is not ready'))
  }
  return request
    ? currentCapture(width, height, request)
    : currentCapture(width, height)
}
