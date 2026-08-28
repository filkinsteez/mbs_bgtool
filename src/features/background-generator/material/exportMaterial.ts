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
  const canvas = await captureMaterialFrame(width, height, {
    recipe,
    output: recipe.materialLookOverlay.enabled && recipe.look.version === 'v2'
      ? 'auto'
      : 'raw',
    // Exports are deterministic recipe artifacts. The 3D GPU overlay is a
    // still — motion never feeds it — and phase zero is its canonical frame.
    phase: 0,
  })
  return encodeMaterialCanvas(canvas, recipe, protos)
}

function encodeMaterialCanvas(
  canvas: HTMLCanvasElement,
  recipe: BackgroundRecipeV2,
  protos: ShapeProto[],
): Promise<Blob> {
  if (
    !recipe.materialLookOverlay.enabled
    || recipe.look.version === 'v2'
  ) {
    return canvasToPng(canvas)
  }
  // V1 retains its historical Canvas2D renderer. V2 has already been
  // composited by the same Three.js GPU pipeline used in preview.
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
