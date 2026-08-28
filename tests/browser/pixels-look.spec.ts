import { expect, test, type Page } from '@playwright/test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import {
  BACKGROUND_AUTOSAVE_KEY,
  createDefaultBackgroundRecipe,
  dimensionsFor,
  type BackgroundRecipeV2,
  type FixedAspectId,
} from '../../src/features/background-generator/recipe'

const ARTIFACT_DIR = '/tmp/mbs-pixels-audit'
const COMPLEXITIES = [
  { label: 'low', value: 0.15 },
  { label: 'mid', value: 0.5 },
  { label: 'high', value: 0.85 },
] as const

function pixelRecipe(
  seed: number,
  detail = 0.5,
  aspect: FixedAspectId = '16:9',
): BackgroundRecipeV2 {
  const recipe = createDefaultBackgroundRecipe(seed)
  recipe.look = { id: 'pixels', detail, version: 'v2' }
  recipe.format = { aspect, ...dimensionsFor(aspect) }
  return recipe
}

async function waitForPixelCanvas(page: Page) {
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Pixels', exact: true }))
    .toHaveAttribute('aria-checked', 'true')
  const canvas = page.locator('canvas[data-renderer="looks"]')
  await expect(canvas).toBeVisible()
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
  return canvas
}

test('Pixels motion varies while closing its loop exactly', async ({ page }) => {
  const recipe = pixelRecipe(1913)
  recipe.motion = {
    enabled: true,
    amount: 0.8,
    speed: 1.37,
    loopSeconds: 8,
  }
  await page.addInitScript(({ savedRecipe, autosaveKey }) => {
    localStorage.clear()
    localStorage.setItem(autosaveKey, JSON.stringify(savedRecipe))
    let controlledTime = 0
    const nativeAnimationFrame = window.requestAnimationFrame.bind(window)
    Object.defineProperty(performance, 'now', {
      configurable: true,
      value: () => controlledTime,
    })
    window.requestAnimationFrame = (callback) =>
      nativeAnimationFrame(() => callback(controlledTime))
    ;(window as typeof window & { __setPixelTime?: (value: number) => void })
      .__setPixelTime = (value) => {
        controlledTime = value
      }
  }, { savedRecipe: recipe, autosaveKey: BACKGROUND_AUTOSAVE_KEY })
  await page.goto('/')
  const canvas = await waitForPixelCanvas(page)
  const frameAt = async (timeMs: number) => {
    await page.evaluate((value) => {
      const controls = window as typeof window & {
        __setPixelTime?: (next: number) => void
      }
      controls.__setPixelTime?.(value)
    }, timeMs)
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    }))
    return canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL('image/png'))
  }

  const start = await frameAt(0)
  const quarter = await frameAt(2000)
  const end = await frameAt(8000)
  expect(quarter).not.toBe(start)
  expect(end).toBe(start)
})

test('renders the Pixels visual and 4K performance audit', async ({
  browser,
}, testInfo) => {
  test.setTimeout(180_000)
  test.skip(
    process.env.PIXELS_LOOK_AUDIT !== '1',
    'Run explicitly with PIXELS_LOOK_AUDIT=1 for visual and performance artifacts.',
  )
  await rm(ARTIFACT_DIR, { recursive: true, force: true })
  await mkdir(ARTIFACT_DIR, { recursive: true })
  const aspects = ['16:9', '9:16', '1:1', '4:5'] as const
  const seeds = [42, 1913, 8675309] as const
  const samples: { aspect: FixedAspectId; label: string; src: string }[] = []

  for (const aspect of aspects) {
    for (const seed of seeds) {
      for (const complexity of COMPLEXITIES) {
        const recipe = pixelRecipe(seed, complexity.value, aspect)
        const context = await browser.newContext()
        const page = await context.newPage()
        await page.addInitScript(({ savedRecipe, autosaveKey }) => {
          localStorage.clear()
          localStorage.setItem(autosaveKey, JSON.stringify(savedRecipe))
        }, { savedRecipe: recipe, autosaveKey: BACKGROUND_AUTOSAVE_KEY })
        await page.goto('/')
        const canvas = await waitForPixelCanvas(page)
        const src = await canvas.evaluate(
          (element: HTMLCanvasElement) => element.toDataURL('image/png'),
        )
        const fileLabel = `seed-${seed}-${aspect.replace(':', 'x')}-${complexity.label}`
        await writeFile(
          `${ARTIFACT_DIR}/pixels-${fileLabel}.png`,
          Buffer.from(src.split(',')[1], 'base64'),
        )
        samples.push({
          aspect,
          label: `seed ${seed} · ${complexity.label} · ${aspect}`,
          src,
        })
        await context.close()
      }
    }
  }

  const sheetContext = await browser.newContext()
  const sheetPage = await sheetContext.newPage()
  const renderSheet = async (
    items: { label: string; src: string }[],
    adaptiveHeight: boolean,
  ) => sheetPage.evaluate(async ({ entries, adaptive }) => {
    const load = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = reject
      image.src = src
    })
    const images = await Promise.all(entries.map((item) => load(item.src)))
    const columns = 3
    const tileWidth = adaptive ? 400 : 360
    const imageHeight = adaptive
      ? Math.round(tileWidth * images[0].height / images[0].width)
      : 270
    const titleHeight = 30
    const tileHeight = imageHeight + titleHeight
    const output = document.createElement('canvas')
    output.width = columns * tileWidth
    output.height = Math.ceil(entries.length / columns) * tileHeight
    const context = output.getContext('2d')!
    context.fillStyle = '#101114'
    context.fillRect(0, 0, output.width, output.height)
    context.font = '600 15px system-ui, sans-serif'
    context.textBaseline = 'middle'
    entries.forEach((item, index) => {
      const column = index % columns
      const row = Math.floor(index / columns)
      const x = column * tileWidth
      const y = row * tileHeight
      context.fillStyle = '#FFFFFF'
      context.fillText(item.label, x + 12, y + titleHeight / 2)
      const image = images[index]
      const scale = Math.min(tileWidth / image.width, imageHeight / image.height)
      const width = image.width * scale
      const height = image.height * scale
      context.drawImage(
        image,
        x + (tileWidth - width) / 2,
        y + titleHeight + (imageHeight - height) / 2,
        width,
        height,
      )
    })
    return output.toDataURL('image/png')
  }, { entries: items, adaptive: adaptiveHeight })

  for (const aspect of aspects) {
    const aspectItems = samples.filter((sample) => sample.aspect === aspect)
    const sheetUrl = await renderSheet(aspectItems, true)
    const sheet = Buffer.from(sheetUrl.split(',')[1], 'base64')
    const aspectLabel = aspect.replace(':', 'x')
    await writeFile(
      `${ARTIFACT_DIR}/pixels-contact-sheet-${aspectLabel}.png`,
      sheet,
    )
    await testInfo.attach(`pixels-contact-sheet-${aspectLabel}`, {
      body: sheet,
      contentType: 'image/png',
    })
  }
  const overviewUrl = await renderSheet(samples, false)
  const overview = Buffer.from(overviewUrl.split(',')[1], 'base64')
  await writeFile(`${ARTIFACT_DIR}/pixels-contact-sheet.png`, overview)
  await testInfo.attach('pixels-contact-sheet', {
    body: overview,
    contentType: 'image/png',
  })
  await sheetContext.close()

  const performanceRecipe = pixelRecipe(1913, 0.85)
  const performanceContext = await browser.newContext()
  const performancePage = await performanceContext.newPage()
  await performancePage.addInitScript(({ savedRecipe, autosaveKey }) => {
    localStorage.clear()
    localStorage.setItem(autosaveKey, JSON.stringify(savedRecipe))
  }, {
    savedRecipe: performanceRecipe,
    autosaveKey: BACKGROUND_AUTOSAVE_KEY,
  })
  await performancePage.goto('/')
  await waitForPixelCanvas(performancePage)
  const exportResult = await performancePage.evaluate(async () => {
    const exportPng = (window as typeof window & {
      __lbsLabExportPng?: () => Promise<string>
    }).__lbsLabExportPng
    if (!exportPng) throw new Error('Dev export hook unavailable')
    const timings: number[] = []
    let src = ''
    for (let run = 0; run < 3; run += 1) {
      const startedAt = performance.now()
      src = await exportPng()
      timings.push(performance.now() - startedAt)
    }
    return { src, timings }
  })
  const png = Buffer.from(exportResult.src.split(',')[1], 'base64')
  const timings = exportResult.timings.map((value) => Math.round(value * 10) / 10)
  const sortedTimings = [...timings].sort((a, b) => a - b)
  const report = {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
    timingsMs: timings,
    medianMs: sortedTimings[1],
    maxMs: sortedTimings.at(-1),
    bytes: png.byteLength,
  }
  expect(report).toMatchObject({ width: 3840, height: 2160 })
  expect(report.maxMs).toBeLessThan(2500)
  await writeFile(`${ARTIFACT_DIR}/pixels-4k.png`, png)
  await writeFile(
    `${ARTIFACT_DIR}/pixels-4k-performance.json`,
    `${JSON.stringify(report, null, 2)}\n`,
  )
  await testInfo.attach('pixels-4k-performance.json', {
    body: Buffer.from(`${JSON.stringify(report, null, 2)}\n`),
    contentType: 'application/json',
  })
  await performanceContext.close()
})
