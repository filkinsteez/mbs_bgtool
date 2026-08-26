import { expect, test } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { createDefaultBackgroundRecipe } from '../../src/features/background-generator/recipe'

const SEEDS = [42, 1913, 8675309] as const
const ASPECTS = ['16:9', '1:1', '9:16'] as const
const COMPLEXITIES = [
  { label: 'low', value: 15 },
  { label: 'mid', value: 50 },
  { label: 'high', value: 85 },
] as const
const ARTIFACT_DIRECTORY = '/tmp/mbs-trails-audit'

test('keeps Trails motion varied and byte-exact at the loop seam', async ({ page }) => {
  const recipe = createDefaultBackgroundRecipe(1913)
  recipe.look = { id: 'trails', detail: 0.85 }
  recipe.motion = {
    enabled: true,
    amount: 0.75,
    speed: 1.37,
    loopSeconds: 8,
  }
  await page.addInitScript((savedRecipe) => {
    localStorage.clear()
    localStorage.setItem('mbs-bg-generator-autosave-v2', JSON.stringify(savedRecipe))
    let controlledTime = 0
    const nativeAnimationFrame = window.requestAnimationFrame.bind(window)
    Object.defineProperty(performance, 'now', {
      configurable: true,
      value: () => controlledTime,
    })
    window.requestAnimationFrame = (callback) =>
      nativeAnimationFrame(() => callback(controlledTime))
    ;(window as unknown as { __setTrailsTime: (value: number) => void }).__setTrailsTime =
      (value) => { controlledTime = value }
  }, recipe)
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  const canvas = page.locator('canvas[data-renderer="looks"]')
  const frameAt = async (milliseconds: number) => {
    await page.evaluate((value) => {
      (window as unknown as { __setTrailsTime: (time: number) => void }).__setTrailsTime(value)
    }, milliseconds)
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

test('renders the Trails seed, aspect, and complexity audit', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  test.skip(
    process.env.TRAILS_VISUAL_AUDIT !== '1',
    'Run explicitly with TRAILS_VISUAL_AUDIT=1 for visual artifacts.',
  )
  await mkdir(ARTIFACT_DIRECTORY, { recursive: true })
  const samples: { label: string; src: string }[] = []

  for (const seed of SEEDS) {
    const recipe = createDefaultBackgroundRecipe(seed)
    await page.goto('/')
    await page.evaluate((savedRecipe) => {
      localStorage.clear()
      localStorage.setItem('mbs-bg-generator-autosave-v2', JSON.stringify(savedRecipe))
    }, recipe)
    await page.reload()
    await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
    await page.getByRole('radio', { name: 'Trails', exact: true }).click()
    const canvas = page.locator('canvas[data-renderer="looks"]')
    const complexity = page.getByRole('slider', { name: 'Complexity', exact: true })
    const format = page.getByRole('region', { name: 'Format', exact: true })

    for (const aspect of ASPECTS) {
      await format.getByRole('radio', { name: aspect, exact: true }).click()
      for (const level of COMPLEXITIES) {
        await complexity.fill(String(level.value))
        await page.evaluate(() => new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        }))
        const src = await canvas.evaluate(
          (element: HTMLCanvasElement) => element.toDataURL('image/png'),
        )
        const label = `seed ${seed} · ${aspect} · ${level.label}`
        samples.push({ label, src })
        await writeFile(
          `${ARTIFACT_DIRECTORY}/trails-seed-${seed}-${aspect.replace(':', 'x')}-${level.label}.png`,
          Buffer.from(src.split(',')[1], 'base64'),
        )
      }
    }
  }

  const contactSheet = await page.evaluate(async (items) => {
    const load = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = reject
      image.src = src
    })
    const images = await Promise.all(items.map((item) => load(item.src)))
    const columns = 3
    const tileWidth = 360
    const titleHeight = 28
    const tileHeight = 260
    const output = document.createElement('canvas')
    output.width = columns * tileWidth
    output.height = Math.ceil(items.length / columns) * tileHeight
    const context = output.getContext('2d')!
    context.fillStyle = '#101114'
    context.fillRect(0, 0, output.width, output.height)
    context.font = '600 14px system-ui, sans-serif'
    context.textBaseline = 'middle'

    items.forEach((item, index) => {
      const column = index % columns
      const row = Math.floor(index / columns)
      const x = column * tileWidth
      const y = row * tileHeight
      context.fillStyle = '#101114'
      context.fillRect(x, y, tileWidth, titleHeight)
      context.fillStyle = '#FFFFFF'
      context.fillText(item.label, x + 10, y + titleHeight / 2)
      const image = images[index]
      const availableHeight = tileHeight - titleHeight
      const scale = Math.min(tileWidth / image.width, availableHeight / image.height)
      const drawWidth = image.width * scale
      const drawHeight = image.height * scale
      context.drawImage(
        image,
        x + (tileWidth - drawWidth) / 2,
        y + titleHeight + (availableHeight - drawHeight) / 2,
        drawWidth,
        drawHeight,
      )
    })
    return output.toDataURL('image/png')
  }, samples)
  const sheet = Buffer.from(contactSheet.split(',')[1], 'base64')
  await writeFile('/tmp/mbs-trails-audit-contact-sheet.png', sheet)
  await testInfo.attach('trails-visual-audit', {
    body: sheet,
    contentType: 'image/png',
  })

  await page.getByRole('region', { name: 'Format', exact: true })
    .getByRole('radio', { name: '16:9', exact: true })
    .click()
  await page.getByRole('slider', { name: 'Complexity', exact: true }).fill('85')
  const performance = await page.evaluate(async () => {
    const exportPng = (window as unknown as {
      __lbsLabExportPng?: () => Promise<string>
    }).__lbsLabExportPng
    if (!exportPng) throw new Error('Dev export hook unavailable')
    const startedAt = window.performance.now()
    const dataUrl = await exportPng()
    const completedAt = window.performance.now()
    const image = new Image()
    image.src = dataUrl
    await image.decode()
    return {
      width: image.width,
      height: image.height,
      renderAndEncodeMilliseconds: completedAt - startedAt,
      totalMilliseconds: window.performance.now() - startedAt,
      pngBytes: Math.floor(dataUrl.length * 0.75),
    }
  })
  expect(performance).toMatchObject({ width: 3840, height: 2160 })
  const report = Buffer.from(`${JSON.stringify(performance, null, 2)}\n`)
  await writeFile('/tmp/mbs-trails-audit-performance.json', report)
  await testInfo.attach('trails-4k-performance', {
    body: report,
    contentType: 'application/json',
  })
})
