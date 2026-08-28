import { fieldFromMap, fitRect, invertField } from '@/core/lab/field'
import { resolveBank } from '@/core/lab/markBank'
import { LOOKS, type LookId } from '@/core/lab/looks'
import { renderLab } from '@/core/lab/render'
import { renderTrails } from '@/core/lab/renderTrails'
import {
  createLabSourceFromImage,
  type LabSource,
} from '@/core/lab/sourceCache'
import {
  buildSourceTrailCarrier,
  type TrailCarrierBounds,
} from '@/core/lab/trailSourceCarrier'
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

export type PixelBounds = {
  x: number
  y: number
  width: number
  height: number
  centerX: number
  centerY: number
  pixelCount: number
}

export type TranslatedTrailsResult = {
  width: number
  height: number
  sourceHash: string
  twoDimensionalHash: string
  materialHash: string
  diff: PixelDiff
  carrierMethod: 'source-contour' | 'source-field-loop'
  carrierBounds: TrailCarrierBounds
  trailBounds: PixelBounds
  canonicalTrailBounds: PixelBounds
  subjectBounds: PixelBounds
  renderMilliseconds: number
}

export type Trails4kResult = {
  width: 3840
  height: 2160
  sourceWidth: number
  sourceHeight: number
  renderMilliseconds: number
  pngMilliseconds: number
  pngBytes: number
}

export type TranslatedPixelsFixtureResult = {
  screenshot: string
  sourceHash: string
  outputHash: string
  changedPixelCount: number
  ghostPixelCount: number
  changedBounds: {
    left: number
    top: number
    right: number
    bottom: number
  } | null
}

export type TranslatedLookMatrixResult = {
  screenshot: string
  width: number
  height: number
  sourceHash: string
  rows: {
    lookId: LookId
    outputHash: string
  }[]
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
  const border = Math.max(4, Math.round(Math.min(input.width, input.height) * 0.06))
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
      if (
        x < border
        || x >= input.width - border
        || y < border
        || y >= input.height - border
      ) {
        image.data[offset] = 9
        image.data[offset + 1] = 17
        image.data[offset + 2] = 31
        image.data[offset + 3] = 255
        continue
      }
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

function translatedTrailsRaster(width: number, height: number): {
  raster: ImageData
  subjectBounds: PixelBounds
} {
  const raster = new ImageData(width, height)
  const left = Math.round(width * 0.63)
  const elbow = Math.round(width * 0.73)
  const right = Math.round(width * 0.92)
  const top = Math.round(height * 0.14)
  const footTop = Math.round(height * 0.68)
  const bottom = Math.round(height * 0.86)
  let pixelCount = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      const chamfer = top + Math.max(0, elbow - x) * 0.32
      const vertical = x >= left && x <= elbow && y >= chamfer && y <= bottom
      const foot = x >= left && x <= right && y >= footTop && y <= bottom
      const subject = vertical || foot
      if (subject) pixelCount += 1
      const amount = Math.max(0, Math.min(1, (x - left) / Math.max(1, right - left)))
      raster.data[offset] = subject ? Math.round(246 - amount * 36) : 13
      raster.data[offset + 1] = subject ? Math.round(118 + amount * 58) : 21
      raster.data[offset + 2] = subject ? Math.round(35 + amount * 22) : 37
      raster.data[offset + 3] = 255
    }
  }
  return {
    raster,
    subjectBounds: {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
      centerX: (left + right) * 0.5,
      centerY: (top + bottom) * 0.5,
      pixelCount,
    },
  }
}

function translatedNonMetaRaster(
  width: number,
  height: number,
  foregroundColor: readonly [number, number, number] = [242, 96, 38],
): ImageData {
  const image = new ImageData(width, height)
  const centerX = width * 0.76
  const centerY = height * 0.36
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      const circle = Math.hypot(
        (x - centerX) / (width * 0.105),
        (y - centerY) / (height * 0.16),
      ) <= 1
      const stem = (
        x >= width * 0.72
        && x <= width * 0.83
        && y >= height * 0.35
        && y <= height * 0.78
      )
      const notch = x > width * 0.76 && y > height * 0.47 && y < height * 0.58
      const foreground = (circle || stem) && !notch
      image.data[offset] = foreground ? foregroundColor[0] : 9
      image.data[offset + 1] = foreground ? foregroundColor[1] : 17
      image.data[offset + 2] = foreground ? foregroundColor[2] : 31
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
      width: input.width,
      height: input.height,
    },
    look: {
      id: input.lookId,
      detail: input.detail,
      version: 'v2',
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

function alphaBounds(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): PixelBounds {
  let minimumX = width
  let minimumY = height
  let maximumX = -1
  let maximumY = -1
  let pixelCount = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] <= 8) continue
      minimumX = Math.min(minimumX, x)
      minimumY = Math.min(minimumY, y)
      maximumX = Math.max(maximumX, x)
      maximumY = Math.max(maximumY, y)
      pixelCount += 1
    }
  }
  if (maximumX < minimumX || maximumY < minimumY) {
    return { x: 0, y: 0, width: 0, height: 0, centerX: 0, centerY: 0, pixelCount: 0 }
  }
  return {
    x: minimumX,
    y: minimumY,
    width: maximumX - minimumX + 1,
    height: maximumY - minimumY + 1,
    centerX: (minimumX + maximumX) * 0.5,
    centerY: (minimumY + maximumY) * 0.5,
    pixelCount,
  }
}

function translatedRecipe(input: LookParityInput): BackgroundRecipeV2 {
  const recipe = recipeForInput(input)
  return {
    ...recipe,
    material: {
      ...recipe.material,
      backgroundColor: '#0D1525',
      highlightColor: '#F8FAFC',
    },
  }
}

function renderTrailAlpha(
  input: LookParityInput,
  recipe: BackgroundRecipeV2,
  source: LabSource,
  sourceAware: boolean,
): PixelBounds {
  const lab = sourceAwareLabForRecipe(recipe, source)
  const canvas = document.createElement('canvas')
  canvas.width = input.width
  canvas.height = input.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Trail fixture context unavailable')
  const rect = fitRect(
    source.fullW,
    source.fullH,
    input.width,
    input.height,
    lab.source?.fit ?? 'contain',
  )
  const tone = invertField(fieldFromMap(source.maps.lum, source.maps.w, source.maps.h, rect))
  renderTrails(
    context,
    lab,
    sourceAware ? { source, rect, territory: tone } : null,
  )
  return alphaBounds(
    context.getImageData(0, 0, input.width, input.height).data,
    input.width,
    input.height,
  )
}

async function runTranslatedTrailsFixture(): Promise<TranslatedTrailsResult> {
  const input: LookParityInput = {
    ...DEFAULT_INPUT,
    width: 960,
    height: 540,
    seed: 0x1f11a7e,
    lookId: 'trails',
    detail: 0.72,
    palette: ['#F8FAFC', '#FDBA74', '#FB923C', '#0D1525'],
  }
  const fixture = translatedTrailsRaster(input.width, input.height)
  const source = sourceFromRaster(fixture.raster)
  const recipe = translatedRecipe(input)
  const lab = sourceAwareLabForRecipe(recipe, source)
  const rect = fitRect(source.fullW, source.fullH, input.width, input.height, 'contain')
  const territory = invertField(
    fieldFromMap(source.maps.lum, source.maps.w, source.maps.h, rect),
  )
  const carrier = buildSourceTrailCarrier({
    maps: source.maps,
    rect,
    width: input.width,
    height: input.height,
    territory,
  })
  const trailBounds = renderTrailAlpha(input, recipe, source, true)
  const canonicalTrailBounds = renderTrailAlpha(input, recipe, source, false)
  const twoDimensional = renderCurrent2D(input, recipe, source)
  const materialCanvas = document.createElement('canvas')
  const startedAt = performance.now()
  renderRecipeLookToCanvas(
    materialCanvas,
    recipe,
    source,
    resolveBank(lab.mark.bank),
  )
  const renderMilliseconds = performance.now() - startedAt
  const context = materialCanvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Translated material fixture context unavailable')
  const material = context.getImageData(0, 0, input.width, input.height).data

  materialCanvas.id = 'translated-trails-material'
  materialCanvas.setAttribute('aria-label', 'Translated non-Meta material Trails fixture')
  materialCanvas.style.display = 'block'
  materialCanvas.style.width = '100vw'
  materialCanvas.style.height = 'auto'
  document.body.style.margin = '0'
  document.body.style.background = '#0D1525'
  document.body.replaceChildren(materialCanvas)

  return {
    width: input.width,
    height: input.height,
    sourceHash: source.hash,
    twoDimensionalHash: hashPixels(twoDimensional),
    materialHash: hashPixels(material),
    diff: comparePixels(twoDimensional, material),
    carrierMethod: carrier.method,
    carrierBounds: carrier.bounds,
    trailBounds,
    canonicalTrailBounds,
    subjectBounds: fixture.subjectBounds,
    renderMilliseconds,
  }
}

async function renderTranslatedTrails4k(): Promise<Trails4kResult> {
  const sourceWidth = 960
  const sourceHeight = 540
  const fixture = translatedTrailsRaster(sourceWidth, sourceHeight)
  const source = sourceFromRaster(fixture.raster)
  const input: LookParityInput = {
    ...DEFAULT_INPUT,
    width: 3840,
    height: 2160,
    seed: 0x1f11a7e,
    lookId: 'trails',
    detail: 0.72,
    palette: ['#F8FAFC', '#FDBA74', '#FB923C', '#0D1525'],
  }
  const recipe = translatedRecipe(input)
  const lab = sourceAwareLabForRecipe(recipe, source)
  const canvas = document.createElement('canvas')
  const renderStartedAt = performance.now()
  renderRecipeLookToCanvas(canvas, recipe, source, resolveBank(lab.mark.bank))
  const renderMilliseconds = performance.now() - renderStartedAt
  const pngStartedAt = performance.now()
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) resolve(value)
      else reject(new Error('4K material fixture PNG encoding failed'))
    }, 'image/png')
  })
  return {
    width: 3840,
    height: 2160,
    sourceWidth,
    sourceHeight,
    renderMilliseconds,
    pngMilliseconds: performance.now() - pngStartedAt,
    pngBytes: blob.size,
  }
}

function renderTranslatedPixelsFixture(): TranslatedPixelsFixtureResult {
  const width = 320
  const height = 240
  const raster = translatedNonMetaRaster(width, height)
  const source = sourceFromRaster(raster)
  const alternateSource = sourceFromRaster(
    translatedNonMetaRaster(width, height, [38, 204, 238]),
  )
  const recipe = recipeForInput({
    ...DEFAULT_INPUT,
    width,
    height,
    seed: 1913,
    lookId: 'pixels',
    detail: 0.5,
    palette: [...DEFAULT_INPUT.palette],
  })
  const lab = {
    ...sourceAwareLabForRecipe(recipe, source),
    finish: { grain: 0 },
  }
  const output = document.createElement('canvas')
  output.width = width
  output.height = height
  const outputContext = output.getContext('2d', { willReadFrequently: true })
  if (!outputContext) throw new Error('Translated fixture output unavailable')
  renderLab(outputContext, lab, source, resolveBank(lab.mark.bank), 'composite', null)
  const pixels = outputContext.getImageData(0, 0, width, height).data
  const alternate = document.createElement('canvas')
  alternate.width = width
  alternate.height = height
  const alternateContext = alternate.getContext('2d', { willReadFrequently: true })
  if (!alternateContext) throw new Error('Translated alternate output unavailable')
  const alternateLab = {
    ...sourceAwareLabForRecipe(recipe, alternateSource),
    finish: { grain: 0 },
  }
  renderLab(
    alternateContext,
    alternateLab,
    alternateSource,
    resolveBank(alternateLab.mark.bank),
    'composite',
    null,
  )
  const alternatePixels = alternateContext.getImageData(0, 0, width, height).data
  let changedPixelCount = 0
  let ghostPixelCount = 0
  let left = width
  let top = height
  let right = -1
  let bottom = -1
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const delta = (
      Math.abs(pixels[offset] - alternatePixels[offset])
      + Math.abs(pixels[offset + 1] - alternatePixels[offset + 1])
      + Math.abs(pixels[offset + 2] - alternatePixels[offset + 2])
    ) / 3
    if (delta < 8) continue
    const pixel = offset / 4
    const x = pixel % width
    const y = Math.floor(pixel / width)
    changedPixelCount += 1
    left = Math.min(left, x)
    top = Math.min(top, y)
    right = Math.max(right, x)
    bottom = Math.max(bottom, y)
    if (x < width * 0.56) ghostPixelCount += 1
  }

  const sourceCanvas = document.createElement('canvas')
  sourceCanvas.width = width
  sourceCanvas.height = height
  sourceCanvas.getContext('2d')!.putImageData(raster, 0, 0)
  const sheet = document.createElement('canvas')
  const titleHeight = 28
  sheet.width = width * 2
  sheet.height = height + titleHeight
  const sheetContext = sheet.getContext('2d')!
  sheetContext.fillStyle = '#101114'
  sheetContext.fillRect(0, 0, sheet.width, sheet.height)
  sheetContext.fillStyle = '#FFFFFF'
  sheetContext.font = '600 14px system-ui, sans-serif'
  sheetContext.textBaseline = 'middle'
  sheetContext.fillText('Translated non-Meta source', 10, titleHeight / 2)
  sheetContext.fillText('Source-aware Pixels material', width + 10, titleHeight / 2)
  sheetContext.drawImage(sourceCanvas, 0, titleHeight)
  sheetContext.drawImage(output, width, titleHeight)

  return {
    screenshot: sheet.toDataURL('image/png'),
    sourceHash: hashPixels(raster.data),
    outputHash: hashPixels(pixels),
    changedPixelCount,
    ghostPixelCount,
    changedBounds: changedPixelCount
      ? { left, top, right, bottom }
      : null,
  }
}

function renderTranslatedLookMatrix(): TranslatedLookMatrixResult {
  const width = 320
  const height = 240
  const raster = translatedNonMetaRaster(width, height)
  const source = sourceFromRaster(raster)
  const sourceCanvas = document.createElement('canvas')
  sourceCanvas.width = width
  sourceCanvas.height = height
  sourceCanvas.getContext('2d')!.putImageData(raster, 0, 0)
  const artifacts: {
    label: string
    canvas: HTMLCanvasElement
    lookId?: LookId
    outputHash?: string
  }[] = [{ label: 'Translated non-Meta source', canvas: sourceCanvas }]
  const rows: TranslatedLookMatrixResult['rows'] = []

  for (const look of LOOKS) {
    const input: LookParityInput = {
      ...DEFAULT_INPUT,
      width,
      height,
      seed: 1913,
      lookId: look.id,
      detail: 0.85,
      palette: [...DEFAULT_INPUT.palette],
    }
    const recipe = recipeForInput(input)
    const lab = sourceAwareLabForRecipe(recipe, source)
    const canvas = document.createElement('canvas')
    renderRecipeLookToCanvas(
      canvas,
      recipe,
      source,
      resolveBank(lab.mark.bank),
    )
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error(`Translated ${look.id} output context unavailable`)
    const outputHash = hashPixels(context.getImageData(0, 0, width, height).data)
    rows.push({ lookId: look.id, outputHash })
    artifacts.push({
      label: look.label,
      canvas,
      lookId: look.id,
      outputHash,
    })
  }

  const columns = 4
  const titleHeight = 28
  const tileWidth = width
  const tileHeight = height + titleHeight
  const sheet = document.createElement('canvas')
  sheet.width = columns * tileWidth
  sheet.height = Math.ceil(artifacts.length / columns) * tileHeight
  const sheetContext = sheet.getContext('2d')!
  sheetContext.fillStyle = '#101114'
  sheetContext.fillRect(0, 0, sheet.width, sheet.height)
  sheetContext.fillStyle = '#FFFFFF'
  sheetContext.font = '600 14px system-ui, sans-serif'
  sheetContext.textBaseline = 'middle'
  artifacts.forEach((artifact, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    const x = column * tileWidth
    const y = row * tileHeight
    sheetContext.fillStyle = '#101114'
    sheetContext.fillRect(x, y, tileWidth, titleHeight)
    sheetContext.fillStyle = '#FFFFFF'
    sheetContext.fillText(artifact.label, x + 10, y + titleHeight / 2)
    sheetContext.drawImage(artifact.canvas, x, y + titleHeight)
  })

  return {
    screenshot: sheet.toDataURL('image/png'),
    width,
    height,
    sourceHash: hashPixels(raster.data),
    rows,
  }
}

declare global {
  interface Window {
    __mbsLookParity?: {
      lookIds: LookId[]
      run: typeof runLookParity
      runTranslatedTrails: typeof runTranslatedTrailsFixture
      renderTranslatedTrails4k: typeof renderTranslatedTrails4k
      translatedPixels: typeof renderTranslatedPixelsFixture
      translatedLookMatrix: typeof renderTranslatedLookMatrix
    }
  }
}

window.__mbsLookParity = {
  lookIds: LOOKS.map((look) => look.id),
  run: runLookParity,
  runTranslatedTrails: runTranslatedTrailsFixture,
  renderTranslatedTrails4k,
  translatedPixels: renderTranslatedPixelsFixture,
  translatedLookMatrix: renderTranslatedLookMatrix,
}
document.documentElement.dataset.parityHarness = 'ready'
