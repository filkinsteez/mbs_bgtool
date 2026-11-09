import '@/styles/type-preview.css'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/** The sample text: a headline and one smaller line under it. */
const HEADLINE = 'Your headline goes here'
const SUBLINE = 'A line of supporting text'
const LIGHT_TEXT = '#FFFFFF'
/** Text on a light background: Atmospheric's Near-black. */
const DARK_TEXT = '#1C2B33'
/**
 * Mean light behind the text (relative luminance, 0..1) above which near-black reads more clearly than white: where the
 * two have the same contrast ratio against the background.
 */
const LIGHT_BACKGROUND = 0.23
/** Width in pixels of the small copy of the image that the light behind the text is measured on. */
const SAMPLE_WIDTH = 64

const toLinear = (value: number) => {
  const c = value / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** Mean relative luminance of RGBA pixels, or null when none is opaque (a canvas that could not be read). */
export function meanLuminance(data: Uint8ClampedArray): number | null {
  let sum = 0
  let count = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue
    sum += 0.2126 * toLinear(data[i]) + 0.7152 * toLinear(data[i + 1]) + 0.0722 * toLinear(data[i + 2])
    count++
  }
  return count > 0 ? sum / count : null
}

/** White on dark backgrounds and when the light can't be measured, near-black on light ones. */
export const typeColor = (luminance: number | null) => (luminance !== null && luminance > LIGHT_BACKGROUND ? DARK_TEXT : LIGHT_TEXT)

const clampTo = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

/** The mean light of the preview image under the text block, or null when the image can't be read. */
function lightBehind(frame: HTMLElement, canvas: HTMLCanvasElement, block: HTMLElement, sample: HTMLCanvasElement): number | null {
  const frameBox = frame.getBoundingClientRect()
  const box = block.getBoundingClientRect()
  if (frameBox.width < 1 || frameBox.height < 1) return null
  const width = SAMPLE_WIDTH
  const height = Math.max(1, Math.round((SAMPLE_WIDTH * frameBox.height) / frameBox.width))
  sample.width = width
  sample.height = height
  const context = sample.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  const x0 = clampTo(Math.floor(((box.left - frameBox.left) / frameBox.width) * width), 0, width - 1)
  const y0 = clampTo(Math.floor(((box.top - frameBox.top) / frameBox.height) * height), 0, height - 1)
  const x1 = clampTo(Math.ceil(((box.right - frameBox.left) / frameBox.width) * width), x0 + 1, width)
  const y1 = clampTo(Math.ceil(((box.bottom - frameBox.top) / frameBox.height) * height), y0 + 1, height)
  try {
    context.drawImage(canvas, 0, 0, width, height)
    return meanLuminance(context.getImageData(x0, y0, x1 - x0, y1 - y0).data)
  } catch {
    return null
  }
}

/**
 * A sample headline over the preview, to check where type would sit. It is page text placed in the preview's frame and
 * never drawn into the canvas, so exports and anything taken from the canvas leave it out. Pointer events pass through
 * it to the image, it sits under the drag hint, and it stays put when the light moves. Its color follows the light
 * behind it, measured each time the preview settles.
 */
export function TypePreview({ shown }: { shown: boolean }) {
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [color, setColor] = useState(LIGHT_TEXT)
  const blockRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!shown) return
    const frame = document.querySelector<HTMLElement>('.tool-frame')
    if (!frame) return
    const container = document.createElement('div')
    container.className = 'tool-type'
    container.setAttribute('aria-hidden', 'true')
    // First in the frame, so the drag hint after it draws over the text.
    frame.prepend(container)
    setHost(container)
    return () => {
      container.remove()
      setHost(null)
    }
  }, [shown])

  useEffect(() => {
    const frame = host?.parentElement
    if (!frame) return
    const sample = document.createElement('canvas')
    const measure = () => {
      const canvas = frame.querySelector<HTMLCanvasElement>('canvas')
      const block = blockRef.current
      if (!canvas || !block || canvas.dataset.settled !== 'true') return
      setColor(typeColor(lightBehind(frame, canvas, block, sample)))
    }
    const observer = new MutationObserver(measure)
    observer.observe(frame, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-settled'] })
    const resize = new ResizeObserver(measure)
    resize.observe(frame)
    measure()
    return () => {
      observer.disconnect()
      resize.disconnect()
    }
  }, [host])

  if (!shown || !host) return null
  return createPortal(
    <div ref={blockRef} className="tool-type-block" style={{ color }}>
      <p className="tool-type-headline">{HEADLINE}</p>
      <p className="tool-type-subline">{SUBLINE}</p>
    </div>,
    host,
  )
}
