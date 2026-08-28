import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import type { ViteDevServer } from 'vite'

type LookId =
  | 'pattern'
  | 'mandala'
  | 'stitch'
  | 'dither'
  | 'frame'
  | 'pixels'
  | 'scanlines'
  | 'streams'
  | 'brushwork'
  | 'beads'
  | 'quilt'
  | 'weave'
  | 'marks'
  | 'trails'

type LookParityResult = {
  input: {
    width: number
    height: number
    seed: number
    palette: string[]
    lookId: LookId
    detail: number
  }
  sourceHash: string
  twoDimensionalHash: string
  threeDimensionalHash: string
  diff: {
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
  processor: 'canvas2d-canonical'
}

type PixelBounds = {
  x: number
  y: number
  width: number
  height: number
  centerX: number
  centerY: number
  pixelCount: number
}

type TranslatedTrailsResult = {
  width: number
  height: number
  sourceHash: string
  twoDimensionalHash: string
  materialHash: string
  diff: LookParityResult['diff']
  carrierMethod: 'source-contour' | 'source-field-loop'
  carrierBounds: Omit<PixelBounds, 'pixelCount'>
  trailBounds: PixelBounds
  canonicalTrailBounds: PixelBounds
  subjectBounds: PixelBounds
  renderMilliseconds: number
}

type Trails4kResult = {
  width: 3840
  height: 2160
  sourceWidth: number
  sourceHeight: number
  renderMilliseconds: number
  pngMilliseconds: number
  pngBytes: number
}

type TranslatedPixelsFixtureResult = {
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

type TranslatedLookMatrixResult = {
  screenshot: string
  width: number
  height: number
  sourceHash: string
  rows: {
    lookId: LookId
    outputHash: string
  }[]
}

const LOOKS: LookId[] = [
  'frame',
  'pixels',
  'scanlines',
  'streams',
  'brushwork',
  'beads',
  'quilt',
  'weave',
  'marks',
  'trails',
]

const VARIANT_INPUT = {
  seed: 0x31ced00d,
  palette: ['#111111', '#FF5001', '#FDE047', '#22D3EE', '#4F43FF', '#FAFAFA'],
  detail: 0.82,
}

let harnessServer: ViteDevServer
let harnessUrl: string

test.beforeAll(async () => {
  const { createServer } = await import('vite')
  harnessServer = await createServer({
    configFile: false,
    logLevel: 'error',
    root: process.cwd(),
    resolve: {
      alias: {
        '@': path.resolve(process.cwd(), 'src'),
      },
    },
    server: {
      host: '127.0.0.1',
      port: 0,
      strictPort: false,
    },
  })
  await harnessServer.listen()
  const address = harnessServer.httpServer?.address()
  if (!address || typeof address === 'string') {
    throw new Error('Look parity harness did not bind a TCP port')
  }
  harnessUrl = `http://127.0.0.1:${address.port}/tests/browser/fixtures/look-parity.html`
})

test.afterAll(async () => {
  await harnessServer?.close()
})

async function openHarness(page: Page): Promise<void> {
  await page.goto(harnessUrl)
  await expect(page.locator('html')).toHaveAttribute('data-parity-harness', 'ready')
}

async function runLook(
  page: Page,
  input: Partial<LookParityResult['input']> & Pick<LookParityResult['input'], 'lookId'>,
): Promise<LookParityResult> {
  return page.evaluate(async (requestedInput) => {
    const harness = (window as typeof window & {
      __mbsLookParity?: {
        run: (
          input: Partial<LookParityResult['input']>
            & Pick<LookParityResult['input'], 'lookId'>
        ) => Promise<LookParityResult>
      }
    }).__mbsLookParity
    if (!harness) throw new Error('Look parity harness unavailable')
    return harness.run(requestedInput)
  }, input)
}

async function runTranslatedTrails(page: Page): Promise<TranslatedTrailsResult> {
  return page.evaluate(async () => {
    const harness = (window as typeof window & {
      __mbsLookParity?: {
        runTranslatedTrails: () => Promise<TranslatedTrailsResult>
      }
    }).__mbsLookParity
    if (!harness) throw new Error('Look parity harness unavailable')
    return harness.runTranslatedTrails()
  })
}

async function runTranslatedTrails4k(page: Page): Promise<Trails4kResult> {
  return page.evaluate(async () => {
    const harness = (window as typeof window & {
      __mbsLookParity?: {
        renderTranslatedTrails4k: () => Promise<Trails4kResult>
      }
    }).__mbsLookParity
    if (!harness) throw new Error('Look parity harness unavailable')
    return harness.renderTranslatedTrails4k()
  })
}

async function runTranslatedLookMatrix(page: Page): Promise<TranslatedLookMatrixResult> {
  return page.evaluate(() => {
    const harness = (window as typeof window & {
      __mbsLookParity?: {
        translatedLookMatrix: () => TranslatedLookMatrixResult
      }
    }).__mbsLookParity
    if (!harness) throw new Error('Look parity harness unavailable')
    return harness.translatedLookMatrix()
  })
}

test('the raw-byte harness is deterministic', async ({ page }) => {
  await openHarness(page)
  const first = await runLook(page, { lookId: 'marks' })
  const second = await runLook(page, { lookId: 'marks' })
  expect(second).toEqual(first)
  expect(first.sourceHash).toMatch(/^[0-9a-f]{8}$/)
  expect(first.diff.pixelCount).toBe(320 * 180)
})

for (const lookId of LOOKS) {
  test(`${lookId}: 3D processing matches the 2D raster contract`, async ({
    page,
  }, testInfo) => {
    await openHarness(page)
    const result = await runLook(page, { lookId })
    const variant = await runLook(page, { lookId, ...VARIANT_INPUT })
    await testInfo.attach(`${lookId}-parity.json`, {
      body: Buffer.from(`${JSON.stringify({ result, variant }, null, 2)}\n`),
      contentType: 'application/json',
    })
    console.info('LOOK_PARITY', JSON.stringify({
      lookId,
      twoDimensionalHash: result.twoDimensionalHash,
      threeDimensionalHash: result.threeDimensionalHash,
      ...result.diff,
      processor: result.processor,
      variantTwoDimensionalHash: variant.twoDimensionalHash,
      variantThreeDimensionalHash: variant.threeDimensionalHash,
    }))

    // Canonical parity is intentionally byte-exact. Both paths receive the
    // same in-memory RGBA source in one browser process, so PNG decoding,
    // screenshots, ICC profiles, and display compositing cannot justify drift.
    for (const output of [result, variant]) {
      expect.soft(output.diff.alphaMismatchCount).toBe(0)
      expect.soft(output.diff.mismatchedPixelFraction).toBe(0)
      expect.soft(output.diff.maxAbsoluteError).toBe(0)
      expect.soft(output.twoDimensionalHash).toBe(output.threeDimensionalHash)
    }
    expect.soft(variant.sourceHash).toBe(result.sourceHash)
    expect.soft(variant.twoDimensionalHash).not.toBe(result.twoDimensionalHash)
    expect.soft(variant.threeDimensionalHash).not.toBe(result.threeDimensionalHash)
  })
}

test('keeps the broad source-aware matrix byte-exact', async ({ page }, testInfo) => {
  test.skip(
    process.env.LOOK_SOURCE_MATRIX !== '1',
    'Run explicitly with LOOK_SOURCE_MATRIX=1 for broad source-aware parity.',
  )
  test.setTimeout(120_000)
  await openHarness(page)
  const bold = ['#0064E0', '#0288F9', '#2DC9E5', '#7C3AED', '#FF5001', '#FFFFFF']
  const atmospheric = ['#09111F', '#18324A', '#5D7890', '#A9C4D6', '#F8FAFC']
  const cases = [
    { label: '16x9-low-bold', width: 320, height: 180, seed: 42, detail: 0.15, palette: bold },
    {
      label: '9x16-mid-atmospheric',
      width: 180,
      height: 320,
      seed: 1913,
      detail: 0.5,
      palette: atmospheric,
    },
    {
      label: '1x1-high-bold',
      width: 240,
      height: 240,
      seed: 8675309,
      detail: 0.85,
      palette: bold,
    },
    {
      label: '4x5-high-atmospheric',
      width: 240,
      height: 300,
      seed: 42,
      detail: 0.85,
      palette: atmospheric,
    },
  ] as const
  const results: (LookParityResult & { caseLabel: string })[] = []

  for (const lookId of LOOKS) {
    for (const matrixCase of cases) {
      const {
        label,
        width,
        height,
        seed,
        detail,
        palette,
      } = matrixCase
      const result = await runLook(page, {
        lookId,
        width,
        height,
        seed,
        detail,
        palette: [...palette],
      })
      results.push({ ...result, caseLabel: label })
      expect.soft(result.diff.alphaMismatchCount).toBe(0)
      expect.soft(result.diff.mismatchedPixelFraction).toBe(0)
      expect.soft(result.diff.maxAbsoluteError).toBe(0)
      expect.soft(result.twoDimensionalHash).toBe(result.threeDimensionalHash)
    }
  }
  for (const lookId of LOOKS) {
    const hashes = results
      .filter((result) => result.input.lookId === lookId)
      .map((result) => result.threeDimensionalHash)
    expect(new Set(hashes).size).toBe(cases.length)
  }

  const body = Buffer.from(`${JSON.stringify(results, null, 2)}\n`)
  await writeFile('/tmp/mbs-look-source-aware-parity-matrix.json', body)
  await testInfo.attach('look-source-aware-parity-matrix.json', {
    body,
    contentType: 'application/json',
  })
})

test('renders every Look against a translated non-Meta source', async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.LOOK_SOURCE_MATRIX !== '1',
    'Run explicitly with LOOK_SOURCE_MATRIX=1 for translated source evidence.',
  )
  await openHarness(page)
  const result = await runTranslatedLookMatrix(page)
  const screenshot = Buffer.from(result.screenshot.split(',')[1], 'base64')
  const imagePath = '/tmp/mbs-look-translated-source-aware-matrix.png'
  const reportPath = '/tmp/mbs-look-translated-source-aware-matrix.json'
  const report = Buffer.from(`${JSON.stringify({
    width: result.width,
    height: result.height,
    sourceHash: result.sourceHash,
    rows: result.rows,
  }, null, 2)}\n`)
  await writeFile(imagePath, screenshot)
  await writeFile(reportPath, report)
  await testInfo.attach('look-translated-source-aware-matrix.png', {
    body: screenshot,
    contentType: 'image/png',
  })
  await testInfo.attach('look-translated-source-aware-matrix.json', {
    body: report,
    contentType: 'application/json',
  })

  expect(result.rows).toHaveLength(LOOKS.length)
  expect(new Set(result.rows.map((row) => row.lookId))).toEqual(new Set(LOOKS))
  expect(new Set(result.rows.map((row) => row.outputHash)).size).toBe(LOOKS.length)
  expect(result.rows.every((row) => row.outputHash !== result.sourceHash)).toBe(true)
})

test('trails keeps exact parity across complexity and aspect', async ({ page }, testInfo) => {
  await openHarness(page)
  const matrix = [
    { width: 320, height: 180, seed: 42, detail: 0.15 },
    { width: 240, height: 240, seed: 1913, detail: 0.5 },
    { width: 180, height: 320, seed: 8675309, detail: 0.85 },
  ] as const
  const results: LookParityResult[] = []
  for (const input of matrix) {
    const result = await runLook(page, { lookId: 'trails', ...input })
    results.push(result)
    expect.soft(result.diff.alphaMismatchCount).toBe(0)
    expect.soft(result.diff.mismatchedPixelFraction).toBe(0)
    expect.soft(result.diff.maxAbsoluteError).toBe(0)
    expect.soft(result.twoDimensionalHash).toBe(result.threeDimensionalHash)
  }
  expect(new Set(results.map((result) => result.twoDimensionalHash)).size).toBe(matrix.length)
  await testInfo.attach('trails-parity-matrix.json', {
    body: Buffer.from(`${JSON.stringify(results, null, 2)}\n`),
    contentType: 'application/json',
  })
})

test('pixels remains byte-exact across complexity, seeds, and audited aspects', async ({
  page,
}, testInfo) => {
  await openHarness(page)
  const cases = [
    { width: 320, height: 180, seed: 42, detail: 0.15 },
    { width: 180, height: 320, seed: 1913, detail: 0.5 },
    { width: 240, height: 240, seed: 8675309, detail: 0.85 },
    { width: 240, height: 300, seed: 42, detail: 0.85 },
  ] as const
  const results: LookParityResult[] = []
  for (const input of cases) {
    const result = await runLook(page, { lookId: 'pixels', ...input })
    results.push(result)
    expect.soft(result.diff.alphaMismatchCount).toBe(0)
    expect.soft(result.diff.mismatchedPixelFraction).toBe(0)
    expect.soft(result.diff.maxAbsoluteError).toBe(0)
    expect.soft(result.twoDimensionalHash).toBe(result.threeDimensionalHash)
  }
  expect(new Set(results.map((result) => result.twoDimensionalHash)).size).toBe(cases.length)
  await testInfo.attach('pixels-parity-matrix.json', {
    body: Buffer.from(`${JSON.stringify(results, null, 2)}\n`),
    contentType: 'application/json',
  })
})

test('trails material follows a translated non-Meta source frame', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1280, height: 720 })
  await openHarness(page)
  const result = await runTranslatedTrails(page)
  const screenshotPath = '/tmp/mbs-trails-material-translated-source.png'
  await page.locator('#translated-trails-material').screenshot({ path: screenshotPath })
  await testInfo.attach('trails-translated-material.png', {
    path: screenshotPath,
    contentType: 'image/png',
  })
  await testInfo.attach('trails-translated-material.json', {
    body: Buffer.from(`${JSON.stringify(result, null, 2)}\n`),
    contentType: 'application/json',
  })

  expect(result.carrierMethod).toBe('source-contour')
  expect(result.diff.alphaMismatchCount).toBe(0)
  expect(result.diff.mismatchedPixelFraction).toBe(0)
  expect(result.twoDimensionalHash).toBe(result.materialHash)
  expect(result.carrierBounds.centerX).toBeGreaterThan(result.width * 0.72)
  expect(result.trailBounds.centerX).toBeGreaterThan(result.width * 0.67)
  expect(result.canonicalTrailBounds.centerX).toBeLessThan(result.width * 0.58)
  expect(result.trailBounds.centerX - result.canonicalTrailBounds.centerX)
    .toBeGreaterThan(result.width * 0.13)
  expect(Math.abs(result.trailBounds.centerX - result.subjectBounds.centerX))
    .toBeLessThan(result.width * 0.1)
  console.info('TRAILS_TRANSLATED_MATERIAL', JSON.stringify(result))
})

test('trails source-aware material renders and encodes at 4K', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await openHarness(page)
  const result = await runTranslatedTrails4k(page)
  await testInfo.attach('trails-material-4k.json', {
    body: Buffer.from(`${JSON.stringify(result, null, 2)}\n`),
    contentType: 'application/json',
  })
  expect(result.width).toBe(3840)
  expect(result.height).toBe(2160)
  expect(result.pngBytes).toBeGreaterThan(100_000)
  expect(result.renderMilliseconds).toBeLessThan(6_000)
  expect(result.pngMilliseconds).toBeLessThan(20_000)
  console.info('TRAILS_MATERIAL_4K', JSON.stringify(result))
})

test('source-aware Pixels follows a translated non-Meta material fixture', async ({
  page,
}, testInfo) => {
  await openHarness(page)
  const result = await page.evaluate(() => {
    const harness = (window as typeof window & {
      __mbsLookParity?: {
        translatedPixels: () => TranslatedPixelsFixtureResult
      }
    }).__mbsLookParity
    if (!harness) throw new Error('Look parity harness unavailable')
    return harness.translatedPixels()
  })
  const screenshot = Buffer.from(result.screenshot.split(',')[1], 'base64')
  console.info('PIXELS_TRANSLATED_MATERIAL', JSON.stringify({
    changedPixelCount: result.changedPixelCount,
    ghostPixelCount: result.ghostPixelCount,
    changedBounds: result.changedBounds,
  }))

  expect(result.outputHash).not.toBe(result.sourceHash)
  expect(result.changedPixelCount).toBeGreaterThan(500)
  expect(result.ghostPixelCount).toBeLessThan(result.changedPixelCount * 0.75)
  expect(result.changedBounds).not.toBeNull()
  expect(result.changedBounds!.left).toBeGreaterThan(80)
  await testInfo.attach('pixels-material-translated-fixture', {
    body: screenshot,
    contentType: 'image/png',
  })
  if (process.env.PIXELS_LOOK_AUDIT === '1') {
    await mkdir('/tmp/mbs-pixels-audit', { recursive: true })
    await writeFile(
      '/tmp/mbs-pixels-audit/pixels-material-translated-fixture.png',
      screenshot,
    )
  }
})

test('3D export includes the selected Look', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear())
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  await page.getByRole('radio', { name: '3D', exact: true }).click()
  await expect(page.locator('[data-mbs-material-model="true"]')).toHaveAttribute(
    'data-model-status',
    'ready',
  )

  const exportPng = () => page.evaluate(async () => {
    const hook = (window as typeof window & {
      __lbsLabExportPng?: () => Promise<string>
    }).__lbsLabExportPng
    if (!hook) throw new Error('Dev export hook unavailable')
    return hook()
  })
  const raw = await exportPng()
  await page.getByRole('button', { name: 'Pixels', exact: true }).click()
  await expect(page.locator('[data-mbs-material-model="true"]')).toHaveAttribute(
    'data-look',
    'pixels',
  )
  const looked = await exportPng()

  expect(looked).not.toBe(raw)
  for (const pngUrl of [raw, looked]) {
    const png = Buffer.from(pngUrl.split(',')[1], 'base64')
    expect(png.readUInt32BE(16)).toBe(3840)
    expect(png.readUInt32BE(20)).toBe(2160)
  }
})
