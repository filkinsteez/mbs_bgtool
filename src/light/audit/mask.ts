import type { IgnoreRect } from '../references'

/**
 * 1 for pixels that count in metrics, 0 for ignored rects and the rounded
 * tile corners (a quarter circle of the given radius in each corner).
 * Rects are given for a target of size `source`; they are scaled to width x height.
 */
export function buildMask(
  width: number,
  height: number,
  ignore: readonly IgnoreRect[],
  cornerRadius: number,
  source: { width: number; height: number } = { width, height },
): Uint8Array {
  const mask = new Uint8Array(width * height).fill(1)
  const sx = width / source.width
  const sy = height / source.height
  for (const { rect } of ignore) {
    const x0 = Math.max(0, Math.floor(rect[0] * sx))
    const y0 = Math.max(0, Math.floor(rect[1] * sy))
    const x1 = Math.min(width, Math.ceil((rect[0] + rect[2]) * sx))
    const y1 = Math.min(height, Math.ceil((rect[1] + rect[3]) * sy))
    for (let y = y0; y < y1; y++) mask.fill(0, y * width + x0, y * width + x1)
  }
  const r = cornerRadius * sx
  if (r > 0) {
    const reach = Math.ceil(r)
    for (let y = 0; y < Math.min(height, reach); y++) {
      for (let x = 0; x < Math.min(width, reach); x++) {
        const dx = r - (x + 0.5)
        const dy = r - (y + 0.5)
        if (dx > 0 && dy > 0 && dx * dx + dy * dy > (r - 1) * (r - 1)) {
          mask[y * width + x] = 0
          mask[y * width + (width - 1 - x)] = 0
          mask[(height - 1 - y) * width + x] = 0
          mask[(height - 1 - y) * width + (width - 1 - x)] = 0
        }
      }
    }
  }
  return mask
}

export function maskedShare(mask: Uint8Array): number {
  let masked = 0
  for (let i = 0; i < mask.length; i++) if (!mask[i]) masked++
  return masked / mask.length
}
