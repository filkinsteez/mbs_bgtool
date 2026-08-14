import type { ShapeProto } from '@/core/canvas/shapeProtos'
import { createLabSourceFromCanvas } from '@/core/lab/sourceCache'
import { exportRecipeLookPng } from '../lookProcessor'
import {
  materialBaseColor,
  materialHighlightColor,
  subjectTransformFor,
  type BackgroundRecipeV2,
} from '../recipe'
import { materialPresetFor, META_PATH } from './renderModel'

export async function exportMaterialAtTarget(
  recipe: BackgroundRecipeV2,
  protos: ShapeProto[],
): Promise<Blob> {
  const { width, height } = recipe.format
  const preset = materialPresetFor(recipe)
  if (!preset) {
    const canvas = renderCleanMaterial(recipe)
    return encodeMaterialCanvas(canvas, recipe, protos)
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.setAttribute('aria-hidden', 'true')
  Object.assign(canvas.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: `${width}px`,
    height: `${height}px`,
    opacity: '0',
    pointerEvents: 'none',
  })
  document.body.append(canvas)

  let render: Awaited<
    ReturnType<typeof import('./nativeMaterialRenderer')['renderMaterialPresetNative']>
  > | null = null

  try {
    const { renderMaterialPresetNative } = await import('./nativeMaterialRenderer')
    render = await renderMaterialPresetNative(canvas, preset, width, height)
    const blob = await encodeMaterialCanvas(canvas, recipe, protos)
    return blob
  } finally {
    render?.destroy()
    canvas.remove()
  }
}

function renderCleanMaterial(recipe: BackgroundRecipeV2): HTMLCanvasElement {
  const { width, height } = recipe.format
  const transform = subjectTransformFor(recipe, 'material')
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D export context unavailable')
  context.fillStyle = materialBaseColor(recipe)
  context.fillRect(0, 0, width, height)

  const boxWidth = width * transform.scale
  const boxHeight = height * transform.scale
  const pathScale = Math.min(boxWidth / 20, boxHeight / 14)
  context.save()
  context.translate(
    width * (0.5 + transform.x * 0.5),
    height * (0.5 + transform.y * 0.5),
  )
  context.rotate((transform.rotation * Math.PI) / 180)
  context.scale(pathScale, pathScale)
  context.translate(-10, -7)
  context.fillStyle = materialHighlightColor(recipe)
  context.fill(new Path2D(META_PATH))
  context.restore()
  return canvas
}

function encodeMaterialCanvas(
  canvas: HTMLCanvasElement,
  recipe: BackgroundRecipeV2,
  protos: ShapeProto[],
): Promise<Blob> {
  if (!recipe.materialLookOverlay.enabled) return canvasToPng(canvas)
  const source = createLabSourceFromCanvas(canvas, {
    filename: 'material-export-frame.rgba',
  })
  return exportRecipeLookPng(recipe, source, protos, 'contain')
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed'))),
      'image/png',
    )
  })
}
