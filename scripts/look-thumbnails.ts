import { looksForVersion } from '@/core/lab/looks'
import type { LookVersion } from '@/core/lab/types'
import { createLabSourceFromCanvas, type LabSource } from '@/core/lab/sourceCache'
import { resolveBank } from '@/core/lab/markBank'
import { createDefaultBackgroundRecipe, type BackgroundRecipeV2 } from '@/features/background-generator/recipe'
import { renderBackground2DCanvas } from '@/features/background-generator/render2d'
import { renderRecipeLookToCanvas, sourceAwareLabForRecipe } from '@/features/background-generator/lookProcessor'
import { colorMixForPack, PALETTE_PACKS } from '@/features/background-generator/palette/registry'

const versions: LookVersion[] = ['v1', 'v1b', 'v2', 'v4', 'gradients']

// A fixed shaded sphere for material-effect samples. This is a generic source,
// not a replacement for the canonical symbol or for a user's imported model.
export function materialExample(offset = 0): LabSource {
  const w = 384, h = 216
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')!
  const image = ctx.createImageData(w, h)
  const depth = new Float32Array(w * h).fill(1)
  const normalX = new Float32Array(w * h).fill(0.5)
  const normalY = new Float32Array(w * h).fill(0.5)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x
    const nx = (x - w * (0.5 + offset)) / 90, ny = (h * 0.5 - y) / 90
    const r = nx * nx + ny * ny
    const inside = r < 1
    const nz = Math.sqrt(Math.max(0, 1 - r))
    const light = Math.max(0, -nx * 0.4 + ny * 0.3 + nz * 0.8)
    image.data.set(inside ? [35 + light * 185, 55 + light * 183, 70 + light * 180, 255] : [28, 43, 51, 0], i * 4)
    if (inside) { depth[i] = (1 - nz) * 0.98; normalX[i] = nx * 0.5 + 0.5; normalY[i] = ny * 0.5 + 0.5 }
  }
  ctx.putImageData(image, 0, 0)
  return createLabSourceFromCanvas(canvas, { filename: 'fixed-material-sphere.rgba', aux: { w, h, depth, normalX, normalY } })
}

export function renderExample(recipe: BackgroundRecipeV2, source: LabSource | null = null, edge = 512) {
  const canvas = document.createElement('canvas')
  if (source) {
    const lab = sourceAwareLabForRecipe(recipe, source, 'cover')
    renderRecipeLookToCanvas(canvas, recipe, source, resolveBank(lab.mark.bank, lab.look.version), { fit: 'cover', maxLongEdge: edge })
  } else renderBackground2DCanvas(canvas, recipe, { phase: 'thumbnail', maxLongEdge: edge })
  return canvas
}

async function thumbnailSet() {
  const items: { name: string; dataUrl: string }[] = []
  const source = materialExample()
  // Frozen capture of the actual canonical 3D loop, not a substitute mesh.
  // These fixed samples use the same source-image processing as the live view.
  const loopImage = new Image()
  loopImage.src = '/scripts/fixtures/rendered-loop.png'
  await loopImage.decode()
  const loopCanvas = document.createElement('canvas')
  loopCanvas.width = loopImage.naturalWidth; loopCanvas.height = loopImage.naturalHeight
  loopCanvas.getContext('2d')!.drawImage(loopImage, 0, 0)
  const loop = createLabSourceFromCanvas(loopCanvas, { filename: 'canonical-loop-render.rgba' })
  for (const mode of ['background', 'material'] as const) for (const version of versions) for (const look of looksForVersion(version)) {
    const recipe = createDefaultBackgroundRecipe(1913)
    const pack = PALETTE_PACKS.find(p => p.id === (version === 'gradients' ? 'bold' : 'atmospheric'))!
    recipe.palette = { packId: pack.id, mix: colorMixForPack(pack), ground: pack.colors.at(-1)!, ink: pack.colors[0] }
    recipe.look = { version, id: look.id, detail: 0.5, ...(version === 'gradients' ? { gradient: { softness: 0.65, distortion: 0.45, grain: 0.12 } } : {}) }
    const canvas = renderExample(recipe, mode === 'material' ? (version === 'gradients' ? loop : source) : null, 256)
    items.push({ name: `${mode}-${version}-${look.id}`, dataUrl: canvas.toDataURL('image/webp', 0.88) })
  }
  return items
}

Object.assign(window, { thumbnailSet, materialExample, renderExample, createDefaultBackgroundRecipe, PALETTE_PACKS, colorMixForPack })
document.documentElement.dataset.thumbnails = 'ready'
