export type MaterialFrameCapture = (
  width: number,
  height: number,
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
): Promise<HTMLCanvasElement> {
  if (!currentCapture) {
    return Promise.reject(new Error('3D view is not ready'))
  }
  return currentCapture(width, height)
}
