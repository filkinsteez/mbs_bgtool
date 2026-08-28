import { expect, test, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'

const LOOKS = [
  { id: 'frame', label: 'Frame' },
  { id: 'pixels', label: 'Pixels' },
  { id: 'scanlines', label: 'Scanlines' },
  { id: 'streams', label: 'Streams' },
  { id: 'brushwork', label: 'Brushwork' },
  { id: 'beads', label: 'Beads' },
  { id: 'quilt', label: 'Quilt' },
  { id: 'weave', label: 'Weave' },
  { id: 'marks', label: 'Marks' },
  { id: 'trails', label: 'Trails' },
] as const

const ASYMMETRIC_CURVED_OBJ = `
o asymmetric_curved_fixture
v -1.70 -0.72 0.00
v -0.38 -0.94 0.34
v 1.46 -0.58 0.12
v -1.43 0.04 0.28
v -0.12 -0.02 0.92
v 1.73 0.31 0.42
v -0.96 0.88 0.08
v 0.31 1.22 0.61
v 1.18 0.76 0.18
vt 0.00 0.00
vt 0.43 0.00
vt 1.00 0.00
vt 0.00 0.48
vt 0.43 0.48
vt 1.00 0.48
vt 0.00 1.00
vt 0.43 1.00
vt 1.00 1.00
vn -0.18 -0.10 0.98
vn -0.12 -0.22 0.97
vn 0.16 -0.12 0.98
vn -0.28 0.02 0.96
vn -0.08 0.06 0.99
vn 0.25 0.04 0.97
vn -0.20 0.16 0.97
vn 0.02 0.24 0.97
vn 0.22 0.18 0.96
f 1/1/1 2/2/2 5/5/5
f 1/1/1 5/5/5 4/4/4
f 2/2/2 3/3/3 6/6/6
f 2/2/2 6/6/6 5/5/5
f 4/4/4 5/5/5 8/8/8
f 4/4/4 8/8/8 7/7/7
f 5/5/5 6/6/6 9/9/9
f 5/5/5 9/9/9 8/8/8
`

const ARTBOARD_SCREENSHOT_STYLE = `
  .lab-material-model-actions,
  .lab-material-model-status,
  .lab-material-look-error {
    visibility: hidden !important;
  }
`
const ARTIFACT_DIR = 'test-results/material-gpu-looks'

type ImageStats = {
  mean: number
  changedFraction: number
  centroidX: number
  centroidY: number
}

type GpuMetrics = {
  geometries: number
  textures: number
  programs: number
  calls: number
  triangles: number
  width: number
  height: number
  phase: number
}

type DebugApi = {
  setRawOutput: (enabled: boolean) => void
  setPhase: (phase: number | null) => void
  getMetrics: () => GpuMetrics
  loseAndRestoreContext: () => boolean
}

test.describe.configure({ mode: 'serial', timeout: 180_000 })

async function waitFrames(page: Page, count = 3): Promise<void> {
  await page.evaluate(async (frames) => {
    for (let index = 0; index < frames; index += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    }
  }, count)
}

async function openMaterialGpu(page: Page): Promise<{
  artboard: ReturnType<Page['locator']>
  viewer: ReturnType<Page['locator']>
  canvas: ReturnType<Page['locator']>
}> {
  await page.route('**/api/material-model', (route) => route.fulfill({
    status: 200,
    contentType: 'text/plain',
    body: ASYMMETRIC_CURVED_OBJ,
  }))
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('material-gpu-test-initialized')) {
      localStorage.clear()
      sessionStorage.setItem('material-gpu-test-initialized', 'true')
    }
    const override = sessionStorage.getItem('material-gpu-recipe-override')
    if (override) {
      localStorage.setItem('mbs-bg-generator-autosave-v2', override)
    }
  })
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  await page.getByRole('radio', { name: '3D', exact: true }).click()
  const viewer = page.locator('[data-mbs-material-model="true"]')
  const canvas = viewer.locator('.lab-material-model-canvas')
  const artboard = page.locator('#lab-generator-artboard')
  await expect(viewer).toHaveAttribute('data-model-status', 'ready')
  await expect.poll(() => page.evaluate(() => (
    typeof (window as unknown as { __mbsMaterialGpu?: DebugApi }).__mbsMaterialGpu
  ))).toBe('object')
  return { artboard, viewer, canvas }
}

async function setRawOutput(page: Page, enabled: boolean): Promise<void> {
  await page.evaluate((raw) => {
    const api = (window as unknown as { __mbsMaterialGpu?: DebugApi }).__mbsMaterialGpu
    if (!api) throw new Error('Material GPU debug API unavailable')
    api.setRawOutput(raw)
  }, enabled)
  await waitFrames(page)
}

async function setPhase(page: Page, phase: number | null): Promise<void> {
  await page.evaluate((value) => {
    const api = (window as unknown as { __mbsMaterialGpu?: DebugApi }).__mbsMaterialGpu
    if (!api) throw new Error('Material GPU debug API unavailable')
    api.setPhase(value)
  }, phase)
  await waitFrames(page)
}

async function screenshotArtboard(
  artboard: ReturnType<Page['locator']>,
): Promise<Buffer> {
  return artboard.screenshot({
    animations: 'disabled',
    caret: 'hide',
    style: ARTBOARD_SCREENSHOT_STYLE,
  })
}

async function imageStats(
  page: Page,
  first: Buffer,
  second: Buffer | string,
): Promise<ImageStats> {
  const firstSource = `data:image/png;base64,${first.toString('base64')}`
  const secondSource = typeof second === 'string'
    ? second
    : `data:image/png;base64,${second.toString('base64')}`
  return page.evaluate(async ({ a, b }) => {
    const load = async (source: string) => {
      const image = new Image()
      image.src = source
      await image.decode()
      return image
    }
    const [imageA, imageB] = await Promise.all([load(a), load(b)])
    const width = 256
    const height = Math.max(1, Math.round(width * imageA.height / imageA.width))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Comparison canvas unavailable')
    context.drawImage(imageA, 0, 0, width, height)
    const pixelsA = context.getImageData(0, 0, width, height).data
    context.clearRect(0, 0, width, height)
    context.drawImage(imageB, 0, 0, width, height)
    const pixelsB = context.getImageData(0, 0, width, height).data
    let total = 0
    let changed = 0
    let centroidWeight = 0
    let centroidX = 0
    let centroidY = 0
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4
        const difference = (
          Math.abs(pixelsA[offset] - pixelsB[offset])
          + Math.abs(pixelsA[offset + 1] - pixelsB[offset + 1])
          + Math.abs(pixelsA[offset + 2] - pixelsB[offset + 2])
        ) / 3
        total += difference
        if (difference > 8) changed += 1
        centroidWeight += difference
        centroidX += x * difference
        centroidY += y * difference
      }
    }
    return {
      mean: total / (width * height),
      changedFraction: changed / (width * height),
      centroidX: centroidWeight > 0 ? centroidX / centroidWeight / width : 0.5,
      centroidY: centroidWeight > 0 ? centroidY / centroidWeight / height : 0.5,
    }
  }, { a: firstSource, b: secondSource })
}

async function writeContactSheet(
  page: Page,
  outputPath: string,
  items: { label: string; image: Buffer }[],
  columns: number,
): Promise<void> {
  const dataUrl = await page.evaluate(async ({ sources, columnCount }) => {
    const images = await Promise.all(sources.map(async ({ label, source }) => {
      const image = new Image()
      image.src = source
      await image.decode()
      return { label, image }
    }))
    const tileWidth = 360
    const tileHeight = 228
    const labelHeight = 24
    const rows = Math.ceil(images.length / columnCount)
    const sheet = document.createElement('canvas')
    sheet.width = tileWidth * columnCount
    sheet.height = (tileHeight + labelHeight) * rows
    const context = sheet.getContext('2d')
    if (!context) throw new Error('Contact sheet canvas unavailable')
    context.fillStyle = '#101318'
    context.fillRect(0, 0, sheet.width, sheet.height)
    context.font = '600 13px sans-serif'
    context.textBaseline = 'middle'
    images.forEach(({ label, image }, index) => {
      const x = (index % columnCount) * tileWidth
      const y = Math.floor(index / columnCount) * (tileHeight + labelHeight)
      context.drawImage(image, x, y, tileWidth, tileHeight)
      context.fillStyle = '#F4F7FA'
      context.fillText(label, x + 9, y + tileHeight + labelHeight / 2)
    })
    return sheet.toDataURL('image/png')
  }, {
    columnCount: columns,
    sources: items.map(({ label, image }) => ({
      label,
      source: `data:image/png;base64,${image.toString('base64')}`,
    })),
  })
  await writeFile(outputPath, Buffer.from(dataUrl.split(',')[1], 'base64'))
}

async function gpuMetrics(page: Page): Promise<GpuMetrics> {
  return page.evaluate(() => {
    const api = (window as unknown as { __mbsMaterialGpu?: DebugApi }).__mbsMaterialGpu
    if (!api) throw new Error('Material GPU debug API unavailable')
    return api.getMetrics()
  })
}

test('renders every V2 Look through the live Three.js GPU frame', async ({ page }, testInfo) => {
  await mkdir(ARTIFACT_DIR, { recursive: true })
  const { artboard, viewer, canvas } = await openMaterialGpu(page)
  const legacyCanvas = viewer.locator('.lab-material-look-canvas')
  const complexity = page.getByRole('slider', { name: 'Complexity', exact: true })
  const comparisons: { label: string; image: Buffer }[] = []
  const alternatePose: { label: string; image: Buffer }[] = []
  const timings: Record<string, number> = {}

  await expect(legacyCanvas).toHaveCSS('opacity', '0')
  await setPhase(page, 0.125)

  let warmMetrics: GpuMetrics | null = null
  for (const [index, look] of LOOKS.entries()) {
    if (index === 5) {
      await page.getByRole('radio', { name: 'Bold', exact: true }).click()
    }
    const detail = index % 3 === 0 ? 25 : index % 3 === 1 ? 55 : 85
    await complexity.fill(String(detail))
    const previousRevision = await canvas.getAttribute('data-render-revision')
    const startedAt = await page.evaluate(() => performance.now())
    await page.getByRole('button', { name: look.label, exact: true }).click()
    await expect(viewer).toHaveAttribute('data-look', look.id)
    await expect(viewer).toHaveAttribute('data-look-version', 'v2')
    await expect(viewer).toHaveAttribute('data-postprocess', 'gpu-look')
    await expect(canvas).toHaveAttribute('data-render-pipeline', 'three-gpu-look')
    await expect(canvas).toHaveAttribute('data-render-status', 'ready')
    await expect.poll(() => canvas.getAttribute('data-render-revision')).not.toBe(previousRevision)
    timings[look.id] = await page.evaluate((started) => performance.now() - started, startedAt)

    await setRawOutput(page, true)
    const raw = await screenshotArtboard(artboard)
    await setRawOutput(page, false)
    const final = await screenshotArtboard(artboard)
    const difference = await imageStats(page, raw, final)
    expect(difference.mean, `${look.id} must alter the lit frame`).toBeGreaterThan(2)
    expect(
      difference.changedFraction,
      `${look.id} must compose the full frame`,
    ).toBeGreaterThan(0.08)
    comparisons.push(
      { label: `${look.label} · raw`, image: raw },
      { label: `${look.label} · GPU`, image: final },
    )
    await writeFile(`${ARTIFACT_DIR}/${look.id}-raw.png`, raw)
    await writeFile(`${ARTIFACT_DIR}/${look.id}-gpu.png`, final)
    if (index === 0) warmMetrics = await gpuMetrics(page)
  }

  await page.getByRole('radio', { name: 'Stainless Steel', exact: true }).click()
  await page.getByRole('radio', { name: 'Harmonious', exact: true }).click()
  const viewerBox = await viewer.boundingBox()
  expect(viewerBox).not.toBeNull()
  await page.mouse.move(
    viewerBox!.x + viewerBox!.width * 0.48,
    viewerBox!.y + viewerBox!.height * 0.52,
  )
  await page.mouse.down({ button: 'left' })
  await page.mouse.move(
    viewerBox!.x + viewerBox!.width * 0.63,
    viewerBox!.y + viewerBox!.height * 0.44,
    { steps: 6 },
  )
  await page.mouse.up({ button: 'left' })
  await waitFrames(page, 20)

  for (const look of LOOKS) {
    await page.getByRole('button', { name: look.label, exact: true }).click()
    await expect(viewer).toHaveAttribute('data-look', look.id)
    await expect(viewer).toHaveAttribute('data-postprocess', 'gpu-look')
    alternatePose.push({
      label: `${look.label} · metal · orbited`,
      image: await screenshotArtboard(artboard),
    })
  }

  const stableMetrics = await gpuMetrics(page)
  expect(warmMetrics).not.toBeNull()
  expect(stableMetrics.programs).toBeLessThanOrEqual(warmMetrics!.programs + 1)
  expect(stableMetrics.textures).toBeLessThanOrEqual(warmMetrics!.textures + 1)
  expect(stableMetrics.geometries).toBeLessThanOrEqual(warmMetrics!.geometries + 1)

  const comparisonsPath = `${ARTIFACT_DIR}/all-looks-raw-vs-gpu.png`
  const alternatePath = `${ARTIFACT_DIR}/all-looks-metal-orbited.png`
  const metricsPath = `${ARTIFACT_DIR}/timings-and-resources.json`
  await writeContactSheet(page, comparisonsPath, comparisons, 4)
  await writeContactSheet(page, alternatePath, alternatePose, 5)
  await writeFile(
    metricsPath,
    JSON.stringify({ timings, warmMetrics, stableMetrics }, null, 2),
  )
  await testInfo.attach('all V2 Looks: raw vs GPU', {
    path: comparisonsPath,
    contentType: 'image/png',
  })
  await testInfo.attach('all V2 Looks: alternate pose/material/palette', {
    path: alternatePath,
    contentType: 'image/png',
  })
  await testInfo.attach('GPU timings and resource counts', {
    body: Buffer.from(JSON.stringify({ timings, warmMetrics, stableMetrics }, null, 2)),
    contentType: 'application/json',
  })
})

test('keeps transformed source geometry, loop motion, and 4K export on the GPU path', async ({
  page,
}, testInfo) => {
  await mkdir(ARTIFACT_DIR, { recursive: true })
  const first = await openMaterialGpu(page)
  await page.getByRole('button', { name: 'Trails', exact: true }).click()
  await expect(first.viewer).toHaveAttribute('data-postprocess', 'gpu-look')
  await setPhase(page, 0)
  await setRawOutput(page, true)
  const rawDefault = await screenshotArtboard(first.artboard)
  await setRawOutput(page, false)
  const finalDefault = await screenshotArtboard(first.artboard)

  await page.evaluate(() => {
    const key = 'mbs-bg-generator-autosave-v2'
    const recipe = JSON.parse(localStorage.getItem(key) ?? '{}')
    recipe.transforms.material = {
      preset: 'free',
      x: 0.34,
      y: -0.12,
      scale: 1.18,
      rotation: 17,
    }
    recipe.look = { ...recipe.look, id: 'trails', version: 'v2' }
    recipe.materialLookOverlay = { enabled: true }
    sessionStorage.setItem('material-gpu-recipe-override', JSON.stringify(recipe))
  })
  await page.reload()
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  await page.getByRole('radio', { name: '3D', exact: true }).click()
  const viewer = page.locator('[data-mbs-material-model="true"]')
  const artboard = page.locator('#lab-generator-artboard')
  await expect(viewer).toHaveAttribute('data-model-status', 'ready')
  await expect(viewer).toHaveAttribute('data-postprocess', 'gpu-look')
  await setPhase(page, 0)
  await setRawOutput(page, true)
  const rawTransformed = await screenshotArtboard(artboard)
  await setRawOutput(page, false)
  const finalTransformed = await screenshotArtboard(artboard)

  const rawTransformResponse = await imageStats(page, rawDefault, rawTransformed)
  const finalTransformResponse = await imageStats(page, finalDefault, finalTransformed)
  expect(rawTransformResponse.changedFraction).toBeGreaterThan(0.03)
  expect(finalTransformResponse.changedFraction).toBeGreaterThan(0.04)
  expect(Math.abs(
    rawTransformResponse.centroidX - finalTransformResponse.centroidX,
  )).toBeLessThan(0.18)
  expect(Math.abs(
    rawTransformResponse.centroidY - finalTransformResponse.centroidY,
  )).toBeLessThan(0.18)

  const amount = page.getByRole('slider', { name: 'Amount', exact: true })
  const energy = page.getByRole('slider', { name: 'Energy', exact: true })
  await amount.fill('80')
  await expect(energy).toBeEnabled()
  await energy.fill('0.1')
  await setPhase(page, 0)
  const seamStart = await screenshotArtboard(artboard)
  await setPhase(page, 1)
  const seamEnd = await screenshotArtboard(artboard)
  expect(seamEnd.equals(seamStart), 'phase 0 and 1 must be the same GPU frame').toBe(true)

  await setPhase(page, 0.375)
  const replayA = await screenshotArtboard(artboard)
  await waitFrames(page, 5)
  const replayB = await screenshotArtboard(artboard)
  expect(replayB.equals(replayA), 'same-state GPU replay must be deterministic').toBe(true)

  await setPhase(page, 0.25)
  const lowEnergy = await screenshotArtboard(artboard)
  await energy.fill('2')
  await waitFrames(page)
  const highEnergy = await screenshotArtboard(artboard)
  const energyResponse = await imageStats(page, lowEnergy, highEnergy)
  expect(energyResponse.mean).toBeGreaterThan(0.15)

  await setPhase(page, 0)
  const previewAtExportPhase = await screenshotArtboard(artboard)
  const exportResult = await page.evaluate(async () => {
    const exportPng = (window as unknown as {
      __lbsLabExportPng?: () => Promise<string>
    }).__lbsLabExportPng
    if (!exportPng) throw new Error('Dev export hook unavailable')
    const startedAt = performance.now()
    const dataUrl = await exportPng()
    const image = new Image()
    image.src = dataUrl
    await image.decode()
    return {
      dataUrl,
      elapsedMs: performance.now() - startedAt,
      width: image.width,
      height: image.height,
    }
  })
  expect(exportResult.width).toBe(3840)
  expect(exportResult.height).toBe(2160)
  const parity = await imageStats(page, previewAtExportPhase, exportResult.dataUrl)
  expect(parity.mean).toBeLessThan(24)
  expect(parity.changedFraction).toBeLessThan(0.72)

  const exportPath = `${ARTIFACT_DIR}/trails-gpu-export-3840x2160.png`
  const measurementsPath = `${ARTIFACT_DIR}/transform-motion-export.json`
  await writeFile(
    exportPath,
    Buffer.from(exportResult.dataUrl.split(',')[1], 'base64'),
  )
  await writeFile(measurementsPath, JSON.stringify({
    rawTransformResponse,
    finalTransformResponse,
    energyResponse,
    parity,
    exportMs: exportResult.elapsedMs,
  }, null, 2))
  await testInfo.attach('4K GPU export', {
    path: exportPath,
    contentType: 'image/png',
  })
  await testInfo.attach('transform, motion, and export measurements', {
    body: Buffer.from(JSON.stringify({
      rawTransformResponse,
      finalTransformResponse,
      energyResponse,
      parity,
      exportMs: exportResult.elapsedMs,
    }, null, 2)),
    contentType: 'application/json',
  })
})

test('recovers the Three.js GPU Look after context loss', async ({ page }) => {
  const { viewer, canvas } = await openMaterialGpu(page)
  await page.getByRole('button', { name: 'Streams', exact: true }).click()
  await expect(viewer).toHaveAttribute('data-postprocess', 'gpu-look')
  await setPhase(page, 0.2)
  const before = await gpuMetrics(page)

  const extensionAvailable = await page.evaluate(() => {
    const api = (window as unknown as { __mbsMaterialGpu?: DebugApi }).__mbsMaterialGpu
    return api?.loseAndRestoreContext() ?? false
  })
  test.skip(!extensionAvailable, 'WEBGL_lose_context is unavailable')
  await expect(viewer).toHaveAttribute('data-model-status', 'loading')
  await expect(viewer).toHaveAttribute('data-model-status', 'ready', { timeout: 30_000 })
  await expect(viewer).toHaveAttribute('data-postprocess', 'gpu-look')
  await expect(canvas).toHaveAttribute('data-render-pipeline', 'three-gpu-look')
  await expect(canvas).toHaveAttribute('data-render-status', 'ready')
  const after = await gpuMetrics(page)
  expect(after.textures).toBeLessThanOrEqual(before.textures + 1)
  expect(after.programs).toBeLessThanOrEqual(before.programs + 1)
})
