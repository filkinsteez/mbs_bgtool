import type { ShapeProto } from '@/core/canvas/shapeProtos'
import { createLabSourceFromCanvas } from '@/core/lab/sourceCache'
import { exportRecipeLookPng } from '../lookProcessor'
import type { BackgroundRecipeV2 } from '../recipe'
import { captureMaterialFrame } from './materialFrameCapture'

export async function exportMaterialAtTarget(
  recipe: BackgroundRecipeV2,
  protos: ShapeProto[],
): Promise<Blob> {
  const { width, height } = recipe.format
  const canvas = await captureMaterialFrame(width, height)
  return encodeMaterialCanvas(canvas, recipe, protos)
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
