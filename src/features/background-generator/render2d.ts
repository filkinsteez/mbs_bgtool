import type { ShapeProto } from '@/core/canvas/shapeProtos'
import { applyMotionAt } from '@/core/lab/motion'
import { resolveBank } from '@/core/lab/markBank'
import { scaleLabForPreview } from '@/core/lab/preview'
import {
  exportLabPng,
  renderLabArtwork,
  type ArtworkTransform,
} from '@/core/lab/render'
import type { LabState, LabView } from '@/core/lab/types'
import type { LookId } from '@/core/lab/looks'
import {
  backgroundRecipeToLab,
  canonicalizeFormat,
  constrainBackgroundTransform,
  type BackgroundRecipeV2,
} from './recipe'

export type Background2DPhase = 'preview' | 'thumbnail' | 'export'

export type Background2DInputs = {
  lab: LabState
  source: null
  protos: ShapeProto[]
  view: LabView
  transform: ArtworkTransform
  paintRaster: null
}

export function resolveBackground2DInputs(
  recipe: BackgroundRecipeV2,
  options: {
    phase: Background2DPhase
    maxLongEdge?: number
    timeMs?: number
    lookId?: LookId
    grain?: number
  },
): Background2DInputs {
  const format = canonicalizeFormat(recipe.format)
  const renderRecipe = {
    ...recipe,
    format,
    look: options.lookId
      ? { ...recipe.look, id: options.lookId }
      : recipe.look,
  }
  let lab = backgroundRecipeToLab(renderRecipe)
  if (options.phase === 'preview' && options.timeMs !== undefined) {
    lab = applyMotionAt(lab, options.timeMs)
  }
  if (options.grain !== undefined) {
    lab = { ...lab, finish: { ...lab.finish, grain: options.grain } }
  }
  if (options.maxLongEdge) {
    lab = scaleLabForPreview(lab, options.maxLongEdge)
  }
  return {
    lab,
    source: null,
    protos: resolveBank(lab.mark.bank),
    view: 'composite',
    transform: constrainBackgroundTransform(
      recipe.transforms.background,
      format.width,
      format.height,
    ),
    paintRaster: null,
  }
}

export function renderBackground2DCanvas(
  canvas: HTMLCanvasElement,
  recipe: BackgroundRecipeV2,
  options: {
    phase: 'preview' | 'thumbnail'
    maxLongEdge: number
    timeMs?: number
    lookId?: LookId
    grain?: number
  },
): Background2DInputs {
  const inputs = resolveBackground2DInputs(recipe, options)
  if (canvas.width !== inputs.lab.output.width) canvas.width = inputs.lab.output.width
  if (canvas.height !== inputs.lab.output.height) canvas.height = inputs.lab.output.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D render context unavailable')
  context.setTransform(1, 0, 0, 1, 0, 0)
  renderLabArtwork(
    context,
    inputs.lab,
    inputs.source,
    inputs.protos,
    inputs.view,
    inputs.transform,
    null,
    inputs.paintRaster,
  )
  return inputs
}

export function exportBackground2DPng(
  recipe: BackgroundRecipeV2,
): Promise<Blob> {
  const inputs = resolveBackground2DInputs(recipe, { phase: 'export' })
  return exportLabPng(
    inputs.lab,
    inputs.source,
    inputs.protos,
    inputs.transform,
    inputs.paintRaster,
  )
}
