import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import {
  BACKGROUND_AUTOSAVE_KEY,
  createDefaultBackgroundRecipe,
  dimensionsFor,
  type BackgroundRecipeV2,
  type FixedAspectId,
} from '../../src/features/background-generator/recipe'

const COMPLEXITIES = [
  { label: 'low', value: 0.15 },
  { label: 'mid', value: 0.5 },
  { label: 'high', value: 0.85 },
] as const
const SEEDS = [42, 1913, 8675309] as const
const ASPECTS = ['16:9', '9:16', '1:1', '4:5'] as const

function quiltRecipe(
  seed: number,
  detail = 0.5,
  aspect: FixedAspectId = '16:9',
): BackgroundRecipeV2 {
  const recipe = createDefaultBackgroundRecipe(seed)
  return {
    ...recipe,
    look: { id: 'quilt', detail, version: 'v2' },
    format: { aspect, ...dimensionsFor(aspect) },
  }
}

async function waitForDraw(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
}

test('Quilt motion changes continuously and closes its exact loop', async ({ page }) => {
  const recipe = quiltRecipe(1913, 0.72)
  recipe.motion = {
    enabled: true,
    amount: 0.78,
    speed: 1.25,
    loopSeconds: 8,
  }
  await page.addInitScript(({ key, savedRecipe }) => {
    localStorage.clear()
    localStorage.setItem(key, JSON.stringify(savedRecipe))
    let controlledTime = 0
    const nativeAnimationFrame = window.requestAnimationFrame.bind(window)
    Object.defineProperty(performance, 'now', {
      configurable: true,
      value: () => controlledTime,
    })
    window.requestAnimationFrame = (callback) =>
      nativeAnimationFrame(() => callback(controlledTime))
    const controls = window as unknown as { __setQuiltTime: (value: number) => void }
    controls.__setQuiltTime = (value) => { controlledTime = value }
  }, { key: BACKGROUND_AUTOSAVE_KEY, savedRecipe: recipe })
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  const canvas = page.locator('canvas[data-renderer="looks"]')

  const frameAt = async (milliseconds: number) => {
    await page.evaluate((value) => {
      (window as unknown as { __setQuiltTime: (time: number) => void }).__setQuiltTime(value)
    }, milliseconds)
    await waitForDraw(page)
    return canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL('image/png'))
  }

  const start = await frameAt(0)
  const quarter = await frameAt(2000)
  const end = await frameAt(8000)
  expect(quarter).not.toBe(start)
  expect(end).toBe(start)
})

test('renders the Quilt visual audit matrix', async ({ browser }, testInfo) => {
  test.skip(
    process.env.QUILT_VISUAL_AUDIT !== '1',
    'Run explicitly with QUILT_VISUAL_AUDIT=1 for Quilt review artifacts.',
  )
  const samples: {
    label: string
    seed: number
    aspect: FixedAspectId
    complexity: string
    src: string
  }[] = []

  for (const seed of SEEDS) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const page = await context.newPage()
    await page.addInitScript(({ key, savedRecipe }) => {
      localStorage.clear()
      localStorage.setItem(key, JSON.stringify(savedRecipe))
    }, {
      key: BACKGROUND_AUTOSAVE_KEY,
      savedRecipe: quiltRecipe(seed, COMPLEXITIES[0].value),
    })
    await page.goto('/')
    await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
    const canvas = page.locator('canvas[data-renderer="looks"]')
    const complexity = page.getByRole('slider', { name: 'Complexity', exact: true })
    const format = page.getByRole('region', { name: 'Aspect ratio', exact: true })

    for (const aspect of ASPECTS) {
      await format.getByRole('radio', { name: aspect, exact: true }).click()
      for (const level of COMPLEXITIES) {
        await complexity.fill(String(Math.round(level.value * 100)))
        await waitForDraw(page)
        const src = await canvas.evaluate(
          (element: HTMLCanvasElement) => element.toDataURL('image/png'),
        )
        const fileName = `/tmp/mbs-quilt-seed-${seed}-${aspect.replace(':', 'x')}-${level.label}.png`
        await writeFile(fileName, Buffer.from(src.split(',')[1], 'base64'))
        samples.push({
          label: `Seed ${seed} · ${aspect} · ${level.label}`,
          seed,
          aspect,
          complexity: level.label,
          src,
        })
      }
    }
    await context.close()
  }

  const context = await browser.newContext()
  const page = await context.newPage()
  const sheet = await page.evaluate(async (items) => {
    const load = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = reject
      image.src = src
    })
    const images = await Promise.all(items.map((item) => load(item.src)))
    const columns = 3
    const tileWidth = 360
    const titleHeight = 30
    const tileHeight = 245
    const output = document.createElement('canvas')
    output.width = columns * tileWidth
    output.height = Math.ceil(items.length / columns) * tileHeight
    const context2d = output.getContext('2d')!
    context2d.fillStyle = '#101114'
    context2d.fillRect(0, 0, output.width, output.height)
    context2d.font = '600 14px system-ui, sans-serif'
    context2d.textBaseline = 'middle'

    items.forEach((item, index) => {
      const column = index % columns
      const row = Math.floor(index / columns)
      const x = column * tileWidth
      const y = row * tileHeight
      context2d.fillStyle = '#FFFFFF'
      context2d.fillText(item.label, x + 10, y + titleHeight / 2)
      const image = images[index]
      const availableHeight = tileHeight - titleHeight
      const scale = Math.min(tileWidth / image.width, availableHeight / image.height)
      const drawWidth = image.width * scale
      const drawHeight = image.height * scale
      context2d.drawImage(
        image,
        x + (tileWidth - drawWidth) / 2,
        y + titleHeight + (availableHeight - drawHeight) / 2,
        drawWidth,
        drawHeight,
      )
    })
    return output.toDataURL('image/png')
  }, samples)
  await context.close()

  const artifact = Buffer.from(sheet.split(',')[1], 'base64')
  await writeFile('/tmp/mbs-quilt-seeds-aspects-complexity.png', artifact)
  await writeFile(
    '/tmp/mbs-quilt-seeds-aspects-complexity.json',
    Buffer.from(`${JSON.stringify(samples.map((sample) => ({
      label: sample.label,
      seed: sample.seed,
      aspect: sample.aspect,
      complexity: sample.complexity,
    })), null, 2)}\n`),
  )
  await testInfo.attach('quilt-seeds-aspects-complexity', {
    body: artifact,
    contentType: 'image/png',
  })
})

test('records practical high-complexity 4K Quilt export timing', async ({ page }, testInfo) => {
  test.skip(
    process.env.QUILT_PERF_AUDIT !== '1',
    'Run explicitly with QUILT_PERF_AUDIT=1 for the 4K timing artifact.',
  )
  await page.addInitScript(({ key, savedRecipe }) => {
    localStorage.clear()
    localStorage.setItem(key, JSON.stringify(savedRecipe))
  }, {
    key: BACKGROUND_AUTOSAVE_KEY,
    savedRecipe: quiltRecipe(8675309, 0.85),
  })
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()

  const measurements = await page.evaluate(async () => {
    const exportPng = (window as unknown as {
      __lbsLabExportPng?: () => Promise<string>
    }).__lbsLabExportPng
    if (!exportPng) throw new Error('Dev export hook unavailable')
    const samples: number[] = []
    let dimensions = { width: 0, height: 0 }
    for (let index = 0; index < 4; index += 1) {
      const startedAt = performance.now()
      const image = new Image()
      image.src = await exportPng()
      await image.decode()
      const elapsed = performance.now() - startedAt
      dimensions = { width: image.width, height: image.height }
      if (index > 0) samples.push(elapsed)
    }
    return { samples, dimensions }
  })
  const sorted = [...measurements.samples].sort((a, b) => a - b)
  const report = {
    look: 'quilt',
    complexity: 0.85,
    seed: 8675309,
    dimensions: measurements.dimensions,
    samplesMs: measurements.samples.map((value) => Math.round(value * 10) / 10),
    medianMs: Math.round(sorted[Math.floor(sorted.length / 2)] * 10) / 10,
    maxMs: Math.round(sorted.at(-1)! * 10) / 10,
  }

  expect(report.dimensions).toEqual({ width: 3840, height: 2160 })
  expect(report.medianMs).toBeLessThan(5000)
  const artifact = Buffer.from(`${JSON.stringify(report, null, 2)}\n`)
  await writeFile('/tmp/mbs-quilt-4k-performance.json', artifact)
  await testInfo.attach('quilt-4k-performance', {
    body: artifact,
    contentType: 'application/json',
  })
})
