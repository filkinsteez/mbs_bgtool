import { expect, test, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'

// Every Look catalog (internal v1/v1b/v2 — the V1/V2/V3 UI tabs) drives the
// material-mode overlay the same way: the live Three.js viewport frame is
// captured and processed by the canonical Canvas2D Look renderer, and the
// processed canvas is layered over the viewport. There is no separate
// procedural 3D pipeline.
const V3_LOOKS = [
  { id: 'pattern', label: 'Pattern' },
  { id: 'mandala', label: 'Mandala' },
  { id: 'stitch', label: 'Stitch' },
  { id: 'dither', label: 'Dither' },
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
const ARTIFACT_DIR = 'test-results/material-look-overlay'

type ImageStats = {
  mean: number
  changedFraction: number
  centroidX: number
  centroidY: number
}

type DebugApi = {
  loseAndRestoreContext: () => boolean
}

// Software-GL environments render and process many looks in these serial
// tests, so they get a generous budget.
test.describe.configure({ mode: 'serial', timeout: 300_000 })

async function waitFrames(page: Page, count = 3): Promise<void> {
  await page.evaluate(async (frames) => {
    for (let index = 0; index < frames; index += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    }
  }, count)
}

async function openMaterialViewer(page: Page): Promise<{
  artboard: ReturnType<Page['locator']>
  viewer: ReturnType<Page['locator']>
  canvas: ReturnType<Page['locator']>
  overlay: ReturnType<Page['locator']>
}> {
  await page.route('**/api/material-model', (route) => route.fulfill({
    status: 200,
    contentType: 'text/plain',
    body: ASYMMETRIC_CURVED_OBJ,
  }))
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('material-look-test-initialized')) {
      localStorage.clear()
      sessionStorage.setItem('material-look-test-initialized', 'true')
    }
    const override = sessionStorage.getItem('material-look-recipe-override')
    if (override) {
      localStorage.setItem('mbs-bg-generator-autosave-v2', override)
    }
  })
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  await page.getByRole('radio', { name: '3D', exact: true }).click()
  const viewer = page.locator('[data-mbs-material-model="true"]')
  const canvas = viewer.locator('.lab-material-model-canvas')
  const overlay = viewer.locator('.lab-material-look-canvas')
  const artboard = page.locator('#lab-generator-artboard')
  await expect(viewer).toHaveAttribute('data-model-status', 'ready')
  return { artboard, viewer, canvas, overlay }
}

// The overlay is ready once the shared Canvas2D processor has treated a
// settled (hq) capture of the current viewport frame.
async function waitForOverlay(
  viewer: ReturnType<Page['locator']>,
  overlay: ReturnType<Page['locator']>,
  lookId: string,
  lookVersion: string,
): Promise<void> {
  await expect(viewer).toHaveAttribute('data-look', lookId)
  await expect(viewer).toHaveAttribute('data-look-version', lookVersion)
  await expect(viewer).toHaveAttribute('data-postprocess', 'legacy-canvas2d-look')
  await expect(overlay).toHaveAttribute('data-render-status', 'ready')
  await expect(overlay).toHaveAttribute('data-look', lookId)
  await expect(overlay).toHaveAttribute('data-look-version', lookVersion)
  await expect(overlay).toHaveAttribute('data-quality', 'hq', { timeout: 30_000 })
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

async function orbitViewer(
  page: Page,
  viewer: ReturnType<Page['locator']>,
): Promise<void> {
  const viewerBox = await viewer.boundingBox()
  expect(viewerBox).not.toBeNull()
  await page.mouse.move(
    viewerBox!.x + viewerBox!.width * 0.36,
    viewerBox!.y + viewerBox!.height * 0.58,
  )
  await page.mouse.down({ button: 'left' })
  await page.mouse.move(
    viewerBox!.x + viewerBox!.width * 0.72,
    viewerBox!.y + viewerBox!.height * 0.34,
    { steps: 8 },
  )
  await page.mouse.up({ button: 'left' })
  await waitFrames(page, 20)
}

test('every Look catalog treats the live viewport through the Canvas2D overlay', async ({ page }, testInfo) => {
  await mkdir(ARTIFACT_DIR, { recursive: true })
  const { artboard, viewer, canvas, overlay } = await openMaterialViewer(page)
  const comparisons: { label: string; image: Buffer }[] = []

  await expect(overlay).toHaveCSS('opacity', '0')
  await expect(viewer).toHaveAttribute('data-postprocess', 'raw')
  await expect(canvas).toHaveAttribute('data-render-pipeline', 'three-raw')

  // ---- the V3 tab (internal v2): all four systems -------------------------
  for (const look of V3_LOOKS) {
    const raw = await screenshotArtboard(artboard)
    await page.getByRole('button', { name: look.label, exact: true }).click()
    await waitForOverlay(viewer, overlay, look.id, 'v2')
    // The model canvas keeps rendering the raw lit frame underneath — the
    // Look is a layer over it, not a replacement pipeline.
    await expect(canvas).toHaveAttribute('data-render-pipeline', 'three-raw')
    const treated = await screenshotArtboard(artboard)
    const difference = await imageStats(page, raw, treated)
    expect(difference.mean, `${look.id} must alter the lit frame`).toBeGreaterThan(2)
    expect(
      difference.changedFraction,
      `${look.id} must compose the full frame`,
    ).toBeGreaterThan(0.08)
    comparisons.push(
      { label: `${look.label} (v2) · raw`, image: raw },
      { label: `${look.label} (v2) · overlay`, image: treated },
    )
    await writeFile(`${ARTIFACT_DIR}/${look.id}-v2-raw.png`, raw)
    await writeFile(`${ARTIFACT_DIR}/${look.id}-v2-overlay.png`, treated)
    // Toggle the active look off: the raw viewport must come back.
    await page.getByRole('button', { name: look.label, exact: true }).click()
    await expect(viewer).toHaveAttribute('data-postprocess', 'raw')
  }

  // ---- the V2 tab (internal v1b) and V1 tab (internal v1) -----------------
  const otherCatalogs = [
    { tab: 'V2', version: 'v1b', looks: [{ id: 'pixels', label: 'Pixels' }, { id: 'marks', label: 'Marks' }] },
    { tab: 'V1', version: 'v1', looks: [{ id: 'frame', label: 'Frame' }] },
  ] as const
  for (const catalog of otherCatalogs) {
    await page.getByRole('tab', { name: catalog.tab, exact: true }).click()
    for (const look of catalog.looks) {
      const raw = await screenshotArtboard(artboard)
      await page.getByRole('button', { name: look.label, exact: true }).click()
      await waitForOverlay(viewer, overlay, look.id, catalog.version)
      await expect(canvas).toHaveAttribute('data-render-pipeline', 'three-raw')
      const treated = await screenshotArtboard(artboard)
      const difference = await imageStats(page, raw, treated)
      expect(difference.mean, `${look.id} (${catalog.version}) must alter the lit frame`).toBeGreaterThan(2)
      expect(
        difference.changedFraction,
        `${look.id} (${catalog.version}) must compose the full frame`,
      ).toBeGreaterThan(0.08)
      comparisons.push(
        { label: `${look.label} (${catalog.version}) · raw`, image: raw },
        { label: `${look.label} (${catalog.version}) · overlay`, image: treated },
      )
      await writeFile(`${ARTIFACT_DIR}/${look.id}-${catalog.version}-raw.png`, raw)
      await writeFile(`${ARTIFACT_DIR}/${look.id}-${catalog.version}-overlay.png`, treated)
      await page.getByRole('button', { name: look.label, exact: true }).click()
      await expect(viewer).toHaveAttribute('data-postprocess', 'raw')
    }
  }

  const comparisonsPath = `${ARTIFACT_DIR}/all-looks-raw-vs-overlay.png`
  await writeContactSheet(page, comparisonsPath, comparisons, 4)
  await testInfo.attach('all catalogs: raw vs Canvas2D overlay', {
    path: comparisonsPath,
    contentType: 'image/png',
  })
})

test('the overlay re-treats the viewport when the camera orbits', async ({ page }, testInfo) => {
  await mkdir(ARTIFACT_DIR, { recursive: true })
  const { artboard, viewer, overlay } = await openMaterialViewer(page)
  const orbited: { label: string; image: Buffer }[] = []

  // One look per catalog: the treated image must follow the camera — that
  // is the entire point of the overlay being a layer over the viewport.
  const perVersion = [
    { tab: 'V3', version: 'v2', look: { id: 'dither', label: 'Dither' } },
    { tab: 'V2', version: 'v1b', look: { id: 'pixels', label: 'Pixels' } },
    { tab: 'V1', version: 'v1', look: { id: 'frame', label: 'Frame' } },
  ] as const
  for (const entry of perVersion) {
    await page.getByRole('tab', { name: entry.tab, exact: true }).click()
    await page.getByRole('button', { name: entry.look.label, exact: true }).click()
    await waitForOverlay(viewer, overlay, entry.look.id, entry.version)
    const before = await screenshotArtboard(artboard)
    const hashBefore = await overlay.getAttribute('data-source-hash')

    await orbitViewer(page, viewer)
    await expect.poll(
      () => overlay.getAttribute('data-source-hash'),
      { timeout: 30_000 },
    ).not.toBe(hashBefore)
    await expect(overlay).toHaveAttribute('data-quality', 'hq', { timeout: 30_000 })
    const after = await screenshotArtboard(artboard)

    const response = await imageStats(page, before, after)
    // The mock fixture is a small slab, so a treatment that concentrates its
    // response on the subject (dither) legitimately changes ~1-2% of the
    // frame; the re-captured source hash above proves the overlay was
    // re-treated, and this asserts the treated IMAGE moved with the camera.
    expect(
      response.changedFraction,
      `${entry.look.id} (${entry.version}) overlay must change with the viewport`,
    ).toBeGreaterThan(0.006)
    orbited.push(
      { label: `${entry.look.label} (${entry.version}) · before orbit`, image: before },
      { label: `${entry.look.label} (${entry.version}) · after orbit`, image: after },
    )

    // Reset for the next catalog: look off, camera back to the front pose.
    await page.getByRole('button', { name: entry.look.label, exact: true }).click()
    await expect(viewer).toHaveAttribute('data-postprocess', 'raw')
    await viewer.dblclick()
    await waitFrames(page, 10)
  }

  const orbitPath = `${ARTIFACT_DIR}/overlay-orbit-response.png`
  await writeContactSheet(page, orbitPath, orbited, 2)
  await testInfo.attach('overlay before/after orbit per catalog', {
    path: orbitPath,
    contentType: 'image/png',
  })
})

test('keeps transformed source geometry, replay determinism, and 4K export on the overlay path', async ({
  page,
}, testInfo) => {
  await mkdir(ARTIFACT_DIR, { recursive: true })
  const first = await openMaterialViewer(page)
  await page.getByRole('button', { name: 'Stitch', exact: true }).click()
  await waitForOverlay(first.viewer, first.overlay, 'stitch', 'v2')
  const finalDefault = await screenshotArtboard(first.artboard)
  await page.getByRole('button', { name: 'Stitch', exact: true }).click()
  await expect(first.viewer).toHaveAttribute('data-postprocess', 'raw')
  const rawDefault = await screenshotArtboard(first.artboard)

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
    recipe.look = { ...recipe.look, id: 'stitch', version: 'v2' }
    recipe.materialLookOverlay = { enabled: true }
    sessionStorage.setItem('material-look-recipe-override', JSON.stringify(recipe))
  })
  await page.reload()
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  await page.getByRole('radio', { name: '3D', exact: true }).click()
  const viewer = page.locator('[data-mbs-material-model="true"]')
  const overlay = viewer.locator('.lab-material-look-canvas')
  const artboard = page.locator('#lab-generator-artboard')
  await expect(viewer).toHaveAttribute('data-model-status', 'ready')
  await waitForOverlay(viewer, overlay, 'stitch', 'v2')
  const finalTransformed = await screenshotArtboard(artboard)
  await page.getByRole('button', { name: 'Stitch', exact: true }).click()
  await expect(viewer).toHaveAttribute('data-postprocess', 'raw')
  const rawTransformed = await screenshotArtboard(artboard)
  await page.getByRole('button', { name: 'Stitch', exact: true }).click()
  await waitForOverlay(viewer, overlay, 'stitch', 'v2')

  // The treatment must move with the model: the raw frame's transform
  // response and the treated frame's response land in the same region.
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

  // Material mode has no Motion panel: the overlay is a still.
  await expect(page.getByRole('slider', { name: 'Amount', exact: true })).toHaveCount(0)
  await expect(page.getByRole('slider', { name: 'Energy', exact: true })).toHaveCount(0)
  const liveA = await screenshotArtboard(artboard)
  await waitFrames(page, 30)
  const liveB = await screenshotArtboard(artboard)
  expect(liveB.equals(liveA), 'the live overlay must be static over time').toBe(true)

  const previewBeforeExport = await screenshotArtboard(artboard)
  const exportResult = await page.evaluate(async () => {
    const exportPng = (window as unknown as {
      __lbsLabExportPng?: () => Promise<string>
    }).__lbsLabExportPng
    if (!exportPng) throw new Error('Dev export hook unavailable')
    const startedAt = performance.now()
    const dataUrl = await exportPng()
    const repeat = await exportPng()
    const image = new Image()
    image.src = dataUrl
    await image.decode()
    return {
      dataUrl,
      identicalRepeat: repeat === dataUrl,
      elapsedMs: performance.now() - startedAt,
      width: image.width,
      height: image.height,
    }
  })
  expect(exportResult.width).toBe(3840)
  expect(exportResult.height).toBe(2160)
  expect(
    exportResult.identicalRepeat,
    'two exports of identical state must be byte-identical',
  ).toBe(true)
  const parity = await imageStats(page, previewBeforeExport, exportResult.dataUrl)
  expect(parity.mean).toBeLessThan(24)
  expect(parity.changedFraction).toBeLessThan(0.72)

  const exportPath = `${ARTIFACT_DIR}/stitch-overlay-export-3840x2160.png`
  const measurementsPath = `${ARTIFACT_DIR}/transform-replay-export.json`
  await writeFile(
    exportPath,
    Buffer.from(exportResult.dataUrl.split(',')[1], 'base64'),
  )
  await writeFile(measurementsPath, JSON.stringify({
    rawTransformResponse,
    finalTransformResponse,
    parity,
    exportMs: exportResult.elapsedMs,
  }, null, 2))
  await testInfo.attach('4K overlay export', {
    path: exportPath,
    contentType: 'image/png',
  })
  await testInfo.attach('transform, replay, and export measurements', {
    body: Buffer.from(JSON.stringify({
      rawTransformResponse,
      finalTransformResponse,
      parity,
      exportMs: exportResult.elapsedMs,
    }, null, 2)),
    contentType: 'application/json',
  })
})

test('recovers the Canvas2D overlay after WebGL context loss', async ({ page }) => {
  const { viewer, canvas, overlay } = await openMaterialViewer(page)
  await page.getByRole('button', { name: 'Mandala', exact: true }).click()
  await waitForOverlay(viewer, overlay, 'mandala', 'v2')

  const extensionAvailable = await page.evaluate(() => {
    const api = (window as unknown as { __mbsMaterialDebug?: DebugApi }).__mbsMaterialDebug
    return api?.loseAndRestoreContext() ?? false
  })
  test.skip(!extensionAvailable, 'WEBGL_lose_context is unavailable')
  await expect(viewer).toHaveAttribute('data-model-status', 'loading')
  await expect(viewer).toHaveAttribute('data-model-status', 'ready', { timeout: 30_000 })
  await waitForOverlay(viewer, overlay, 'mandala', 'v2')
  await expect(canvas).toHaveAttribute('data-render-pipeline', 'three-raw')
  await expect(canvas).toHaveAttribute('data-render-status', 'ready')
})
