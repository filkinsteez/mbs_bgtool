export type PixelSize = {
  width: number
  height: number
}

export function materialPreviewCssSize(
  width: number,
  height: number,
  displayScale: number,
): PixelSize {
  return {
    width: Math.max(1, width * displayScale),
    height: Math.max(1, height * displayScale),
  }
}

/**
 * Mirrors the Shaders WebGPU runtime's backing-store policy: round the visible
 * CSS box, then render at device pixel ratio (capped by the runtime).
 */
export function expectedPreviewBackingSize(
  cssSize: PixelSize,
  devicePixelRatio: number,
  maxPixelRatio = 2,
): PixelSize {
  const ratio = Math.min(
    Math.max(0.01, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1),
    maxPixelRatio,
  )
  return {
    width: Math.max(1, Math.round(Math.round(cssSize.width) * ratio)),
    height: Math.max(1, Math.round(Math.round(cssSize.height) * ratio)),
  }
}

export function isNativeTargetSize(
  actual: PixelSize,
  target: PixelSize,
): boolean {
  return actual.width === target.width && actual.height === target.height
}
