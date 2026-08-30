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

// Depth/normal planes captured alongside a 3D material frame. Bounded to
// their own small resolution (the capture decides — at most the analysis
// budget), same top-down row order as the analysis maps, and sampled
// bilinearly like lum. Value conventions:
//   depth    0..1 view depth normalized over the MODEL's own span —
//            0 = nearest model point, 1 = farthest; background = exactly 1.
//   normalX  view-space normal X packed 0..1 (value*2-1 recovers the
//            component; +X = screen right). Background = exactly 0.5.
//   normalY  view-space normal Y packed 0..1 (+Y = screen UP, WebGL view
//            space). Background = exactly 0.5.
export type LabAuxPlanes = {
  w: number
  h: number
  depth: Float32Array
  normalX: Float32Array
  normalY: Float32Array
}

export type LabSource = {
  image: CanvasImageSource
  url?: string // object URL, revoked on replace
  fullW: number
  fullH: number
  maps: AnalysisMaps
  hash: string
  filename: string
  // present only when the capture rendered the aux passes (3D material
  // mode); 2D imports and generated fixtures never carry them
  aux?: LabAuxPlanes
}

export type LabSourceOptions = {
  filename?: string
  url?: string
  aux?: LabAuxPlanes | null
}

// FNV-1a over quantized strided samples of the aux planes. Joined to the
// content hash as a suffix so a pose change that only moves depth/normals
// still re-treats, while the color+silhouette component stays identical.
function auxPlanesHash(aux: LabAuxPlanes): string {
  let hsh = 0x811c9dc5
  const mix = (value: number) => {
    hsh ^= value & 0xff
    hsh = Math.imul(hsh, 0x01000193) >>> 0
  }
  const plane = (data: Float32Array) => {
    const stride = Math.max(1, Math.floor(data.length / 4096))
    for (let i = 0; i < data.length; i += stride) mix(Math.round(data[i] * 255))
  }
  mix(aux.w)
  mix(aux.w >> 8)
  mix(aux.h)
  mix(aux.h >> 8)
  plane(aux.depth)
  plane(aux.normalX)
  plane(aux.normalY)
  return hsh.toString(16).padStart(8, '0')
}

function withAux(hash: string, aux: LabAuxPlanes | null | undefined): string {
  return aux ? `${hash}-${auxPlanesHash(aux)}` : hash
}

// Aux planes for a frozen capture canvas travel OUT OF BAND: the export
// path hands the raw frame canvas across module boundaries as a plain
// HTMLCanvasElement, so the capture attaches its planes here and
// createLabSourceFromCanvas picks them up. WeakMap-keyed — no lifetime
// management, the planes die with the canvas.
const auxByImage = new WeakMap<object, LabAuxPlanes>()

export function attachLabAuxPlanes(
  image: CanvasImageSource,
  aux: LabAuxPlanes,
): void {
  auxByImage.set(image as object, aux)
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
    hash: withAux(labContentHash(data.data, aw, ah), options.aux),
    filename: options.filename ?? 'rgba-source',
    ...(options.aux ? { aux: options.aux } : {}),
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
    hash: withAux(labContentHash(color, aw, ah), options.aux),
    filename: options.filename ?? 'rgba-source',
    ...(options.aux ? { aux: options.aux } : {}),
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
    {
      aux: auxByImage.get(canvas) ?? null,
      ...options,
      filename: options.filename ?? 'canvas-frame.rgba',
    },
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
