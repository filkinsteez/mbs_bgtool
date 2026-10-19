import { createLabSourceFromCanvas, type LabSource } from '@/core/lab/sourceCache'
import { createDefaultBackgroundRecipe, type BackgroundRecipeV2 } from '@/features/background-generator/recipe'
import { renderBackground2DCanvas } from '@/features/background-generator/render2d'
import { renderRecipeLookToCanvas } from '@/features/background-generator/lookProcessor'
import { CURATED_PRESETS } from '@/features/background-generator/curatedPresets'
import { resolvePresetGradientState } from '@/features/background-generator/gradientControls'
import { colorMixForPack, PALETTE_PACKS } from '@/features/background-generator/palette/registry'

// A fixed shaded sphere for material-effect samples. This is a generic source,
// not a replacement for the canonical symbol or for a user's imported model.
export function materialExample(offset = 0): LabSource {
  const w = 384, h = 216
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')!
  const image = ctx.createImageData(w, h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x
    const nx = (x - w * (0.5 + offset)) / 90, ny = (h * 0.5 - y) / 90
    const r = nx * nx + ny * ny
    const inside = r < 1
    const nz = Math.sqrt(Math.max(0, 1 - r))
    const light = Math.max(0, -nx * 0.4 + ny * 0.3 + nz * 0.8)
    image.data.set(inside ? [35 + light * 185, 55 + light * 183, 70 + light * 180, 255] : [28, 43, 51, 0], i * 4)
  }
  ctx.putImageData(image, 0, 0)
  return createLabSourceFromCanvas(canvas, {
    filename: 'fixed-material-sphere.rgba',
  })
}

export function renderExample(recipe: BackgroundRecipeV2, source: LabSource | null = null, edge = 512) {
  const canvas = document.createElement('canvas')
  if (source) {
    renderRecipeLookToCanvas(canvas, recipe, source, { fit: 'cover', maxLongEdge: edge })
  } else renderBackground2DCanvas(canvas, recipe, { phase: 'thumbnail', maxLongEdge: edge })
  return canvas
}

async function thumbnailSet() {
  const items: { name: string; dataUrl: string }[] = []
  for (const preset of CURATED_PRESETS) {
    const resolved = resolvePresetGradientState(preset.id)
    const recipe = createDefaultBackgroundRecipe(resolved.seed)
    recipe.presetId = preset.id
    recipe.gradientState = {
      presetId: preset.id,
      controls: resolved.controls,
      orientation: resolved.orientation,
      center: { x: 0.5, y: 0.5 },
      field: resolved.field,
      deformation: undefined,
    }
    recipe.look = {
      id: resolved.family,
      version: 'gradients',
      detail: resolved.controls.detail,
      gradient: resolved.settings,
    }
    const canvas = renderExample(recipe, null, 256)
    items.push({
      name: `preset-${preset.id}`,
      dataUrl: canvas.toDataURL('image/webp', 0.88),
    })
  }
  return items
}

Object.assign(window, { thumbnailSet, materialExample, renderExample, createDefaultBackgroundRecipe, PALETTE_PACKS, colorMixForPack })
document.documentElement.dataset.thumbnails = 'ready'
