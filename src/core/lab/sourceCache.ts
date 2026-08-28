import type { AnalysisMaps } from './analysis'
import { analyzeRGBA } from './analysis'
import { labContentHash } from './recipe'

// The source bitmap and its analysis live HERE, outside the store —
// history snapshots and autosave are JSON of LabState, and raster data
// in state would make every commit O(image bytes). The store keeps only
// metadata plus a nonce that bumps when this cache changes.
//
// Full resolution is kept for compositing (unlike the editor's
// importImageFile, which downscales to lossy 1600px JPEG — fine for
// layout blocks, wrong for a study source). Analysis runs once per
// load at a capped ~1MP and is sampled bilinearly from there.

const ANALYSIS_MAX = 1024

export type LabSource = {
  image: CanvasImageSource
  url?: string // object URL, revoked on replace
  fullW: number
  fullH: number
  maps: AnalysisMaps
  hash: string
  filename: string
}

export type LabSourceOptions = {
  filename?: string
  url?: string
}

let current: LabSource | null = null

export function getLabSource(): LabSource | null {
  return current
}

export function clearLabSource(): void {
  if (current?.url) URL.revokeObjectURL(current.url)
  current = null
}

// One RGBA8 analysis contract for decoded images, frozen WebGL frames,
// generated fixtures, and material export. The analysis raster always uses
// the same Canvas2D drawImage conversion and the same capped dimensions.
export function createLabSourceFromImage(
  image: CanvasImageSource,
  fullW: number,
  fullH: number,
  options: LabSourceOptions = {},
): LabSource {
  if (!fullW || !fullH) throw new Error('Source decoded to zero size.')
  const k = Math.min(1, ANALYSIS_MAX / Math.max(fullW, fullH))
  const aw = Math.max(8, Math.round(fullW * k))
  const ah = Math.max(8, Math.round(fullH * k))
  const scratch = document.createElement('canvas')
  scratch.width = aw
  scratch.height = ah
  const ctx = scratch.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2D context unavailable.')
  ctx.drawImage(image, 0, 0, aw, ah)
  const data = ctx.getImageData(0, 0, aw, ah)
  return {
    image,
    url: options.url,
    fullW,
    fullH,
    maps: analyzeRGBA(data.data, aw, ah),
    hash: labContentHash(data.data, aw, ah),
    filename: options.filename ?? 'rgba-source',
  }
}

// Material-mode capture: color arrives as an OPAQUE composited frame and
// the subject silhouette as a separate transparent render. The two merge on
// straight-alpha typed arrays AFTER the canonical downscale — writing the
// silhouette into a canvas alpha channel first would let premultiplication
// zero every background RGB (black grounds, black luminance). Analysis runs
// while the frame is still opaque, so lum/edge/detail read the real
// composited scene at every pixel instead of paper-white background;
// maps.alpha and the kept rgba alpha then carry the subject silhouette.
export function createLabSourceFromOpaqueWithSilhouette(
  opaqueFrame: CanvasImageSource,
  silhouetteFrame: CanvasImageSource,
  fullW: number,
  fullH: number,
  options: LabSourceOptions = {},
): LabSource {
  if (!fullW || !fullH) throw new Error('Source decoded to zero size.')
  const k = Math.min(1, ANALYSIS_MAX / Math.max(fullW, fullH))
  const aw = Math.max(8, Math.round(fullW * k))
  const ah = Math.max(8, Math.round(fullH * k))
  const read = (image: CanvasImageSource): Uint8ClampedArray => {
    const scratch = document.createElement('canvas')
    scratch.width = aw
    scratch.height = ah
    const ctx = scratch.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('2D context unavailable.')
    ctx.drawImage(image, 0, 0, aw, ah)
    return ctx.getImageData(0, 0, aw, ah).data
  }
  const color = read(opaqueFrame)
  const silhouette = read(silhouetteFrame)
  const maps = analyzeRGBA(color, aw, ah)
  for (let index = 0; index < aw * ah; index += 1) {
    const alpha = silhouette[index * 4 + 3]
    color[index * 4 + 3] = alpha
    maps.alpha[index] = alpha / 255
  }
  return {
    image: silhouetteFrame,
    url: options.url,
    fullW,
    fullH,
    maps,
    hash: labContentHash(color, aw, ah),
    filename: options.filename ?? 'rgba-source',
  }
}

// Freeze a canvas before analysis and compositing. WebGL's drawing buffer can
// change or be discarded after the current task; the 2D snapshot guarantees
// photo cells and every analysis map observe the exact same frame.
export function createLabSourceFromCanvas(
  canvas: HTMLCanvasElement,
  options: LabSourceOptions = {},
): LabSource {
  const snapshot = document.createElement('canvas')
  snapshot.width = canvas.width
  snapshot.height = canvas.height
  const ctx = snapshot.getContext('2d')
  if (!ctx) throw new Error('2D snapshot context unavailable.')
  ctx.drawImage(canvas, 0, 0)
  return createLabSourceFromImage(
    snapshot,
    snapshot.width,
    snapshot.height,
    { ...options, filename: options.filename ?? 'canvas-frame.rgba' },
  )
}

// decode WITHOUT committing — the caller decides whether this decode
// still wins (a slow large file must not overwrite a later small one)
export async function decodeLabSourceFile(file: File): Promise<LabSource> {
  const url = URL.createObjectURL(file)
  const image = new Image()
  image.src = url
  try {
    await image.decode()
  } catch {
    URL.revokeObjectURL(url)
    throw new Error(`Could not decode "${file.name}" — PNG, JPEG, or WebP only.`)
  }
  const fullW = image.naturalWidth
  const fullH = image.naturalHeight
  if (!fullW || !fullH) {
    URL.revokeObjectURL(url)
    throw new Error(`"${file.name}" decoded to zero size.`)
  }

  try {
    return createLabSourceFromImage(image, fullW, fullH, {
      url,
      filename: file.name,
    })
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
}

export function commitLabSource(src: LabSource): void {
  if (current && current !== src && current.url) URL.revokeObjectURL(current.url)
  current = src
}

export function discardLabSource(src: LabSource): void {
  if (src !== current && src.url) URL.revokeObjectURL(src.url)
}
