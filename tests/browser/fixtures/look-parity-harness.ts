import { resolveBank } from '@/core/lab/markBank'
import { LOOKS, type LookId } from '@/core/lab/looks'
import { renderLab } from '@/core/lab/render'
import {
  createLabSourceFromImage,
  type LabSource,
} from '@/core/lab/sourceCache'
import {
  renderRecipeLookToCanvas,
  sourceAwareLabForRecipe,
} from '@/features/background-generator/lookProcessor'
import {
  createDefaultBackgroundRecipe,
  type BackgroundRecipeV2,
} from '@/features/background-generator/recipe'

export type LookParityInput = {
  width: number
  height: number
  seed: number
  palette: string[]
  lookId: LookId
  detail: number
}

export type PixelDiff = {
  pixelCount: number
  channelCount: number
  exactPixelFraction: number
  mismatchedPixelFraction: number
  channelsOverOneFraction: number
  meanAbsoluteError: number
  p99AbsoluteError: number
  maxAbsoluteError: number
  alphaMismatchCount: number
}

export type LookParityResult = {
  input: LookParityInput
  sourceHash: string
  twoDimensionalHash: string
  threeDimensionalHash: string
  diff: PixelDiff
  processor: 'canvas2d-canonical'
}

const DEFAULT_INPUT = {
  width: 320,
  height: 180,
  seed: 0x05eed123,
  palette: ['#0064E0', '#0288F9', '#2DC9E5', '#7C3AED', '#FF5001', '#FFFFFF'],
  detail: 0.5,
} as const

const FIXTURE_SOURCE_SEED = 0x7a11ce55
const FIXTURE_SOURCE_COLORS = [
  '#09111F',
  '#0064E0',
  '#2DC9E5',
  '#7C3AED',
  '#FF5001',
  '#FFFFFF',
] as const

function parseHex(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ]
}

/**
 * A synthetic source intentionally carries flat colors, one-pixel edges,
 * gradients, and seeded high-frequency detail. It is built as ImageData, not
 * decoded from a PNG, so both paths receive identical RGBA bytes without an
 * image-decoder or ICC transform in between.
 */
function fixtureRaster(input: LookParityInput): ImageData {
  const image = new ImageData(input.width, input.height)
  const colors = FIXTURE_SOURCE_COLORS.map(parseHex)
  let random = FIXTURE_SOURCE_SEED
  const nextByte = () => {
    random ^= random << 13
    random ^= random >>> 17
    random ^= random << 5
    return random >>> 24
  }

  for (let y = 0; y < input.height; y += 1) {
    for (let x = 0; x < input.width; x += 1) {
      const offset = (y * input.width + x) * 4
      const paletteColor = colors[
        (Math.floor(x / 29) + Math.floor(y / 23)) % colors.length
      ]
      const rampX = Math.round((x / Math.max(1, input.width - 1)) * 255)
      const rampY = Math.round((y / Math.max(1, input.height - 1)) * 255)
      const checker = ((x >> 3) ^ (y >> 3)) & 1
      const ring = Math.sin(Math.hypot(x - input.width * 0.63, y - input.height * 0.42) * 0.23)
      const noise = nextByte()
      image.data[offset] = (paletteColor[0] * 3 + rampX + checker * 31 + noise) >> 2
      image.data[offset + 1] = (paletteColor[1] * 3 + rampY + (ring > 0 ? 37 : 0) + noise) >> 2
      image.data[offset + 2] = (
        paletteColor[2] * 3
        + ((rampX + rampY) >> 1)
        + checker * 19
        + noise
      ) >> 2
      image.data[offset + 3] = 255
    }
  }

  return image
}

function sourceFromRaster(raster: ImageData): LabSource {
  const canvas = document.createElement('canvas')
  canvas.width = raster.width
  canvas.height = raster.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('2D fixture context unavailable')
  context.putImageData(raster, 0, 0)
  return createLabSourceFromImage(canvas, raster.width, raster.height, {
    filename: 'look-parity-raster.rgba',
  })
}

function recipeForInput(input: LookParityInput): BackgroundRecipeV2 {
  const recipe = createDefaultBackgroundRecipe(input.seed)
  return {
    ...recipe,
    mode: 'material',
    format: {
      aspect: 'custom',
      resolution: '4k',
      width: input.width,
      height: input.height,
    },
    look: {
      id: input.lookId,
      detail: input.detail,
    },
    palette: {
      packId: recipe.palette.packId,
      mix: input.palette.map((color) => ({
        color,
        enabled: true,
        ratio: 1,
      })),
      ink: input.palette[0],
      ground: input.palette.at(-1) ?? input.palette[0],
    },
  }
}

function renderCurrent2D(
  input: LookParityInput,
  recipe: BackgroundRecipeV2,
  source: LabSource,
): Uint8ClampedArray {
  const lab = sourceAwareLabForRecipe(recipe, source)
  const canvas = document.createElement('canvas')
  canvas.width = input.width
  canvas.height = input.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('2D output context unavailable')
  renderLab(context, lab, source, resolveBank(lab.mark.bank), 'composite')
  return context.getImageData(0, 0, input.width, input.height).data
}

function renderCurrent3DLook(
  input: LookParityInput,
  recipe: BackgroundRecipeV2,
  source: LabSource,
): Uint8ClampedArray {
  const lab = sourceAwareLabForRecipe(recipe, source)
  const canvas = document.createElement('canvas')
  renderRecipeLookToCanvas(
    canvas,
    recipe,
    source,
    resolveBank(lab.mark.bank),
  )
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Material Look output context unavailable')
  return context.getImageData(0, 0, input.width, input.height).data
}

function hashPixels(pixels: Uint8ClampedArray): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < pixels.length; index += 1) {
    hash ^= pixels[index]
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

function comparePixels(
  expected: Uint8ClampedArray,
  actual: Uint8ClampedArray,
): PixelDiff {
  if (expected.length !== actual.length || expected.length % 4 !== 0) {
    throw new Error('Parity outputs must contain matching RGBA pixels')
  }

  const channelErrors: number[] = []
  let exactPixels = 0
  let channelsOverOne = 0
  let sum = 0
  let max = 0
  let alphaMismatchCount = 0
  for (let offset = 0; offset < expected.length; offset += 4) {
    let exact = true
    for (let channel = 0; channel < 3; channel += 1) {
      const error = Math.abs(expected[offset + channel] - actual[offset + channel])
      channelErrors.push(error)
      sum += error
      max = Math.max(max, error)
      if (error !== 0) exact = false
      if (error > 1) channelsOverOne += 1
    }
    if (expected[offset + 3] !== actual[offset + 3]) {
      exact = false
      alphaMismatchCount += 1
    }
    if (exact) exactPixels += 1
  }
  channelErrors.sort((a, b) => a - b)
  const pixelCount = expected.length / 4
  const channelCount = channelErrors.length
  return {
    pixelCount,
    channelCount,
    exactPixelFraction: exactPixels / pixelCount,
    mismatchedPixelFraction: 1 - exactPixels / pixelCount,
    channelsOverOneFraction: channelsOverOne / channelCount,
    meanAbsoluteError: sum / channelCount,
    p99AbsoluteError: channelErrors[Math.floor((channelCount - 1) * 0.99)],
    maxAbsoluteError: max,
    alphaMismatchCount,
  }
}

async function runLookParity(
  partial: Partial<LookParityInput> & Pick<LookParityInput, 'lookId'>,
): Promise<LookParityResult> {
  const input: LookParityInput = {
    ...DEFAULT_INPUT,
    ...partial,
    palette: partial.palette ? [...partial.palette] : [...DEFAULT_INPUT.palette],
  }
  const raster = fixtureRaster(input)
  const source = sourceFromRaster(raster)
  const recipe = recipeForInput(input)
  const twoDimensional = renderCurrent2D(input, recipe, source)
  const threeDimensional = renderCurrent3DLook(input, recipe, source)

  return {
    input,
    sourceHash: hashPixels(raster.data),
    twoDimensionalHash: hashPixels(twoDimensional),
    threeDimensionalHash: hashPixels(threeDimensional),
    diff: comparePixels(twoDimensional, threeDimensional),
    processor: 'canvas2d-canonical',
  }
}

declare global {
  interface Window {
    __mbsLookParity?: {
      lookIds: LookId[]
      run: typeof runLookParity
    }
  }
}

window.__mbsLookParity = {
  lookIds: LOOKS.map((look) => look.id),
  run: runLookParity,
}
document.documentElement.dataset.parityHarness = 'ready'
