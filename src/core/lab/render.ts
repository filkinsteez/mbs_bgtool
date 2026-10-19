import { constrainArtworkCover } from './artworkTransform'
import { renderGradient } from './gradients/render'
import type { LabSource } from './sourceCache'
import type { LabState, LabView } from './types'

export type ArtworkTransform = {
  x: number
  y: number
  scale: number
  rotation: number
}

let artworkScratch: HTMLCanvasElement | null = null

function artworkCanvas(width: number, height: number): CanvasRenderingContext2D {
  artworkScratch ??= document.createElement('canvas')
  artworkScratch.width = width
  artworkScratch.height = height
  const context = artworkScratch.getContext('2d')
  if (!context) throw new Error('2D artwork context unavailable')
  return context
}

export function renderLab(
  context: CanvasRenderingContext2D,
  lab: LabState,
  source: LabSource | null,
  view: LabView = 'composite',
): void {
  if (!renderGradient(context, lab, source, view)) {
    throw new Error('Only gradient rendering is available')
  }
}

// Preview and export both transform the same completed raster layer.
export function renderLabArtwork(
  context: CanvasRenderingContext2D,
  lab: LabState,
  source: LabSource | null,
  view: LabView,
  transform: ArtworkTransform,
): void {
  const { width, height } = lab.output
  const identity = transform.x === 0
    && transform.y === 0
    && transform.rotation === 0
    && transform.scale === 1
  const renderTransform = constrainArtworkCover(
    transform,
    width,
    height,
    identity ? 0 : Math.max(width, height) / 3840,
  )
  const artwork = artworkCanvas(width, height)
  artwork.setTransform(1, 0, 0, 1, 0, 0)
  artwork.globalAlpha = 1
  artwork.globalCompositeOperation = 'source-over'
  renderLab(artwork, lab, source, view)

  context.setTransform(1, 0, 0, 1, 0, 0)
  context.globalAlpha = 1
  context.globalCompositeOperation = 'source-over'
  context.clearRect(0, 0, width, height)
  context.fillStyle = lab.colors.paper
  context.fillRect(0, 0, width, height)
  context.save()
  context.beginPath()
  context.rect(0, 0, width, height)
  context.clip()
  context.translate(
    width * (0.5 + renderTransform.x * 0.5),
    height * (0.5 + renderTransform.y * 0.5),
  )
  context.rotate((renderTransform.rotation * Math.PI) / 180)
  context.scale(renderTransform.scale, renderTransform.scale)
  context.translate(-width / 2, -height / 2)
  context.imageSmoothingEnabled = true
  context.drawImage(artwork.canvas, 0, 0)
  context.restore()
}

export async function exportLabPng(
  lab: LabState,
  source: LabSource | null,
  transform: ArtworkTransform = { x: 0, y: 0, scale: 1, rotation: 0 },
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = lab.output.width
  canvas.height = lab.output.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D export context unavailable')
  renderLabArtwork(
    context,
    lab,
    source,
    'composite',
    transform,
  )
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('PNG encoding failed')),
      'image/png',
    )
  })
}
