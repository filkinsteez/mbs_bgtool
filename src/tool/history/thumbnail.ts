/** Long side of a history thumbnail in pixels: twice its largest size on screen. */
const THUMB_LONG_SIDE = 176
const THUMB_QUALITY = 0.8
/** Each downscale step shrinks by at most this much, so thin light and grain average out instead of breaking up. */
const STEP_SCALE = 4

/** Whether every pixel is black: what a canvas reads as once the browser has cleared it. */
function isBlank(context: CanvasRenderingContext2D, width: number, height: number): boolean {
  const data = context.getImageData(0, 0, width, height).data
  for (let i = 0; i < data.length; i += 4) if (data[i] || data[i + 1] || data[i + 2]) return false
  return true
}

/**
 * A small JPEG of what the canvas shows, as a data URL, or '' when the browser can't make one. A WebGL canvas without
 * preserveDrawingBuffer may read as blank once its frame has been shown (Chrome still reads the shown frame), so call
 * this in the task that drew the frame where possible.
 */
export function thumbnailOf(canvas: HTMLCanvasElement): string {
  const scale = THUMB_LONG_SIDE / Math.max(canvas.width, canvas.height, 1)
  const width = Math.max(1, Math.round(canvas.width * scale))
  const height = Math.max(1, Math.round(canvas.height * scale))
  try {
    let source: CanvasImageSource = canvas
    let sourceWidth = canvas.width
    let sourceHeight = canvas.height
    while (sourceWidth > width * STEP_SCALE) {
      const step = document.createElement('canvas')
      step.width = Math.max(width, Math.round(sourceWidth / STEP_SCALE))
      step.height = Math.max(height, Math.round(sourceHeight / STEP_SCALE))
      const context = step.getContext('2d', { alpha: false })
      if (!context) return ''
      context.imageSmoothingQuality = 'high'
      context.drawImage(source, 0, 0, step.width, step.height)
      source = step
      sourceWidth = step.width
      sourceHeight = step.height
    }
    const thumb = document.createElement('canvas')
    thumb.width = width
    thumb.height = height
    const context = thumb.getContext('2d', { alpha: false, willReadFrequently: true })
    if (!context) return ''
    context.imageSmoothingQuality = 'high'
    context.drawImage(source, 0, 0, width, height)
    return isBlank(context, width, height) ? '' : thumb.toDataURL('image/jpeg', THUMB_QUALITY)
  } catch (error) {
    console.warn('History thumbnail failed', error)
    return ''
  }
}
