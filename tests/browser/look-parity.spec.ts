import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import type { ViteDevServer } from 'vite'

type LookId =
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
