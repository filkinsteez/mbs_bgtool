import { scaleLabForPreview } from '@/core/lab/preview'
import {
  renderLabArtwork,
  type ArtworkTransform,
} from '@/core/lab/render'
import type { LabSource } from '@/core/lab/sourceCache'
import type { LabState, LabView } from '@/core/lab/types'
import type { LookId } from '@/core/lab/looks'
import { sourceSoftnessHeadroom } from './gradientControls'
import {
  backgroundRecipeToLab,
  canonicalizeFormat,
  constrainBackgroundTransform,
  type BackgroundRecipeV2,
} from './recipe'
import {
  createMetaSymbolSource,
} from './metaSymbolSource'

export type Background2DPhase = 'preview' | 'thumbnail' | 'export'

export type Background2DInputs = {
  lab: LabState
  source: LabSource | null
  view: LabView
  transform: ArtworkTransform
}

export function resolveBackground2DInputs(
  recipe: BackgroundRecipeV2,
  options: {
    phase: Background2DPhase
    maxLongEdge?: number
    lookId?: LookId
    grain?: number
  },
  source: LabSource | null = null,
): Background2DInputs {
  const format = canonicalizeFormat(recipe.format)
  const renderRecipe = {
    ...recipe,
    format,
    look: options.lookId
      ? { ...recipe.look, id: options.lookId }
      : recipe.look,
  }
  let lab = backgroundRecipeToLab(
    renderRecipe,
    source
      ? {
          hasSource: true,
          source: {
            filename: source.filename,
            width: source.fullW,
            height: source.fullH,
            contentHash: source.hash,
            fit: 'cover',
          },
        }
      : {},
  )
  if (source) {
    const gradient = lab.look.gradient
    const headroom = sourceSoftnessHeadroom(
      renderRecipe.gradientState.controls.blend,
    ) * (renderRecipe.mode === 'background' ? 0.52 : 0.45)
    const expand = (limited: number, full: number) =>
      limited + (full - limited) * headroom
    lab = {
      ...lab,
      look: {
        ...lab.look,
        gradient: {
          ...gradient,
          softness: expand(
            Math.min(gradient.softness, 0.68),
            gradient.softness,
          ),
          bleed: expand(
            Math.min(gradient.bleed ?? 0.5, 0.7),
            gradient.bleed ?? 0.5,
          ),
          depth: expand(
            Math.max(gradient.depth ?? 0.5, 0.45),
            gradient.depth ?? 0.5,
          ),
        },
      },
    }
  }
  if (options.grain !== undefined) {
    lab = {
      ...lab,
      look: {
        ...lab.look,
        gradient: {
          ...lab.look.gradient!,
          grain: options.grain,
        },
      },
    }
  }
  if (options.maxLongEdge) {
    lab = scaleLabForPreview(lab, options.maxLongEdge)
  }
  return {
    lab,
    source,
    view: 'composite',
    transform: constrainBackgroundTransform(
      recipe.transforms.background,
      format.width,
      format.height,
    ),
  }
}

export function renderBackground2DCanvas(
  canvas: HTMLCanvasElement,
  recipe: BackgroundRecipeV2,
  options: {
    phase: 'preview' | 'thumbnail'
    maxLongEdge: number
    lookId?: LookId
    grain?: number
  },
): Background2DInputs {
  const source = recipe.backgroundSymbol.enabled
    ? createMetaSymbolSource(recipe.format.width, recipe.format.height)
    : null
  const inputs = resolveBackground2DInputs(recipe, options, source)
  renderBackground2DInputs(canvas, inputs)
  return inputs
}

function renderBackground2DInputs(
  canvas: HTMLCanvasElement,
  inputs: Background2DInputs,
): void {
  if (canvas.width !== inputs.lab.output.width) canvas.width = inputs.lab.output.width
  if (canvas.height !== inputs.lab.output.height) canvas.height = inputs.lab.output.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D render context unavailable')
  context.setTransform(1, 0, 0, 1, 0, 0)
  renderLabArtwork(
    context,
    inputs.lab,
    inputs.source,
    inputs.view,
    inputs.transform,
  )
}

export function exportBackground2DPng(
  recipe: BackgroundRecipeV2,
): Promise<Blob> {
  const source = recipe.backgroundSymbol.enabled
    ? createMetaSymbolSource(recipe.format.width, recipe.format.height)
    : null
  const inputs = resolveBackground2DInputs(
    recipe,
    { phase: 'export' },
    source,
  )
  const canvas = document.createElement('canvas')
  renderBackground2DInputs(canvas, inputs)
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob
        ? resolve(blob)
        : reject(new Error('PNG encoding failed')),
      'image/png',
    )
  })
}
