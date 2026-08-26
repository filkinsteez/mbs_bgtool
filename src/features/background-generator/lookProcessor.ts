import type { ShapeProto } from '@/core/canvas/shapeProtos'
import { scaleLabForPreview } from '@/core/lab/preview'
import { exportLabPng, renderLab } from '@/core/lab/render'
import type { LabSource } from '@/core/lab/sourceCache'
import type { LabFit, LabState } from '@/core/lab/types'
import { resolveLookColorPlan } from '@/core/lab/colorDirection'
import {
  backgroundRecipeToLab,
  materialBaseColor,
  materialHighlightColor,
  type BackgroundRecipeV2,
} from './recipe'

export type RecipeLookRenderOptions = {
  fit?: LabFit
  maxLongEdge?: number
}

export function sourceAwareLabForRecipe(
  recipe: BackgroundRecipeV2,
  source: LabSource,
  fit: LabFit = 'contain',
): LabState {
  const lab = backgroundRecipeToLab(recipe, {
    hasSource: true,
    source: {
      filename: source.filename,
      width: source.fullW,
      height: source.fullH,
      contentHash: source.hash,
      fit,
    },
  })
  const baseColor = materialBaseColor(recipe)
  const highlightColor = materialHighlightColor(recipe)
  const colorPlan = resolveLookColorPlan({
    mix: [
      { color: baseColor, weight: 72, enabled: true },
      { color: highlightColor, weight: 28, enabled: true },
    ],
    ground: baseColor,
    ink: highlightColor,
    lookId: recipe.look.id,
    complexity: recipe.look.detail,
  })
  const tone = lab.territory.sources.find((item) => item.kind === 'tone')
  return {
    ...lab,
    sourceVisibility: 1,
    paint: null,
    motion: {
      ...lab.motion,
      enabled: false,
      amount: 0,
      frame: undefined,
    },
    colors: {
      paper: baseColor,
      ink: highlightColor,
      palette: colorPlan.swatches.map((swatch) => swatch.hex),
      plan: colorPlan,
    },
    territory: {
      ...lab.territory,
      gain: 1,
      sources: tone
        ? [{ ...tone, enabled: true, invert: false, weight: 1, combine: 'add' }]
        : [],
    },
  }
}

// Canonical Look processor shared by material preview, material export, and
// parity tests. There is intentionally no second material-specific renderer.
export function renderRecipeLookToCanvas(
  canvas: HTMLCanvasElement,
  recipe: BackgroundRecipeV2,
  source: LabSource,
  protos: ShapeProto[],
  options: RecipeLookRenderOptions = {},
): LabState {
  const fullLab = sourceAwareLabForRecipe(recipe, source, options.fit)
  const lab = options.maxLongEdge
    ? scaleLabForPreview(fullLab, options.maxLongEdge)
    : fullLab
  if (canvas.width !== lab.output.width) canvas.width = lab.output.width
  if (canvas.height !== lab.output.height) canvas.height = lab.output.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('2D Look context unavailable')
  context.setTransform(1, 0, 0, 1, 0, 0)
  renderLab(context, lab, source, protos, 'composite', null)
  return lab
}

export function exportRecipeLookPng(
  recipe: BackgroundRecipeV2,
  source: LabSource,
  protos: ShapeProto[],
  fit: LabFit = 'contain',
): Promise<Blob> {
  return exportLabPng(
    sourceAwareLabForRecipe(recipe, source, fit),
    source,
    protos,
    undefined,
    null,
  )
}
