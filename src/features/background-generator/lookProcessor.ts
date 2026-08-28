import type { ShapeProto } from '@/core/canvas/shapeProtos'
import { scaleLabForPreview } from '@/core/lab/preview'
import { renderLab } from '@/core/lab/render'
import type { LabSource } from '@/core/lab/sourceCache'
import type { LabFit, LabState } from '@/core/lab/types'
import { resolveLookColorPlan } from '@/core/lab/colorDirection'
import { buildWeightedPalette } from './palette/registry'
import {
  backgroundRecipeToLab,
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
  const isV1 = recipe.look.version === 'v1'
  const colorPlan = isV1
    ? null
    : resolveLookColorPlan({
        mix: recipe.palette.mix,
        ground: recipe.palette.ground,
        ink: recipe.palette.ink,
        lookId: recipe.look.id,
        complexity: recipe.look.detail,
      })
  const palette = isV1
    ? buildWeightedPalette(recipe.palette.mix, 100)
    : colorPlan!.swatches.map((swatch) => swatch.hex)
  const tone = lab.territory.sources.find((item) => item.kind === 'tone')
  return {
    ...lab,
    sourceMask: 'border-distance',
    // A material Look replaces the captured frame with its canonical
    // treatment. Keeping the raw frame underneath makes sparse treatments
    // look like background overlays while the model remains untouched.
    sourceVisibility: 0,
    paint: null,
    motion: {
      ...lab.motion,
      enabled: false,
      amount: 0,
      frame: undefined,
    },
    colors: {
      paper: recipe.palette.ground,
      ink: recipe.palette.ink,
      palette,
      ...(colorPlan ? { plan: colorPlan } : {}),
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
  const canvas = document.createElement('canvas')
  renderRecipeLookToCanvas(canvas, recipe, source, protos, { fit })
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('toBlob failed')),
      'image/png',
    )
  })
}
