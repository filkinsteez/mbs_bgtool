import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { createDefaultBackgroundRecipe } from '../../src/features/background-generator/recipe'

const LOOKS = [
  'Frame',
  'Pixels',
  'Scanlines',
  'Streams',
  'Brushwork',
  'Beads',
  'Quilt',
  'Weave',
  'Marks',
  'Trails',
] as const

const COMPLEXITIES = [
  { label: 'Low', value: 0.15 },
  { label: 'Mid', value: 0.5 },
  { label: 'High', value: 0.85 },
] as const

test('builds a labeled contact sheet for every Look', async ({ page }, testInfo) => {
  test.skip(
    process.env.LOOK_CONTACT_SHEET !== '1',
    'Run explicitly with LOOK_CONTACT_SHEET=1 for visual review artifacts.',
  )
  await page.addInitScript(() => localStorage.clear())
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  const canvas = page.locator('canvas[data-renderer="looks"]')
  const complexity = page.getByRole('slider', { name: 'Complexity', exact: true })
  await expect(canvas).toBeVisible()

  const samples: { label: string; src: string }[] = []
  for (const label of LOOKS) {
    const control = page.getByRole('radio', { name: label, exact: true })
    await control.click()
    await expect(control).toHaveAttribute('aria-checked', 'true')
    for (const level of COMPLEXITIES) {
      const sliderValue = String(Math.round(level.value * 100))
      await complexity.fill(sliderValue)
      await expect(complexity).toHaveValue(sliderValue)
      await page.evaluate(() => new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }))
      samples.push({
        label: `${label} · ${level.label}`,
        src: await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL('image/png')),
      })
    }
  }
  await Promise.all(samples.map((sample) => {
    const fileName = sample.label.toLowerCase().replaceAll(' · ', '-').replaceAll(' ', '-')
    return writeFile(
      `/tmp/mbs-look-${fileName}.png`,
      Buffer.from(sample.src.split(',')[1], 'base64'),
    )
  }))

  const sheet = await page.evaluate(async (items) => {
    const load = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = reject
      image.src = src
    })
    const images = await Promise.all(items.map((item) => load(item.src)))
    const columns = 3
    const tileWidth = 400
    const titleHeight = 30
    const tileHeight = 300
    const output = document.createElement('canvas')
    output.width = columns * tileWidth
    output.height = Math.ceil(items.length / columns) * tileHeight
    const context = output.getContext('2d')!
    context.fillStyle = '#101114'
    context.fillRect(0, 0, output.width, output.height)
    context.font = '600 15px system-ui, sans-serif'
    context.textBaseline = 'middle'

    items.forEach((item, index) => {
      const column = index % columns
      const row = Math.floor(index / columns)
      const x = column * tileWidth
      const y = row * tileHeight
      context.fillStyle = '#101114'
      context.fillRect(x, y, tileWidth, titleHeight)
      context.fillStyle = '#FFFFFF'
      context.fillText(item.label, x + 12, y + titleHeight / 2)
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

  const image = Buffer.from(sheet.split(',')[1], 'base64')
  await writeFile('/tmp/mbs-look-complexity-contact-sheet.png', image)
  await testInfo.attach('look-contact-sheet', {
    body: image,
    contentType: 'image/png',
  })
})

test('exports every Look at high complexity as 4K', async ({ page }, testInfo) => {
  test.skip(
    process.env.LOOK_EXPORT_MATRIX !== '1',
    'Run explicitly with LOOK_EXPORT_MATRIX=1 for the full 4K render audit.',
  )
  await page.addInitScript(() => localStorage.clear())
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  const complexity = page.getByRole('slider', { name: 'Complexity', exact: true })
  await complexity.fill('85')

  const timings: { look: string; milliseconds: number }[] = []
  for (const look of LOOKS) {
    await page.getByRole('radio', { name: look, exact: true }).click()
    const result = await page.evaluate(async () => {
      const exportPng = (window as unknown as {
        __lbsLabExportPng?: () => Promise<string>
      }).__lbsLabExportPng
      if (!exportPng) throw new Error('Dev export hook unavailable')
      const startedAt = performance.now()
      const image = new Image()
      image.src = await exportPng()
      await image.decode()
      return {
        width: image.width,
        height: image.height,
        milliseconds: performance.now() - startedAt,
      }
    })
    expect(result).toMatchObject({ width: 3840, height: 2160 })
    timings.push({ look, milliseconds: Math.round(result.milliseconds) })
  }

  const report = Buffer.from(JSON.stringify(timings, null, 2))
  await writeFile('/tmp/mbs-look-export-timings.json', report)
  await testInfo.attach('look-export-timings', {
    body: report,
    contentType: 'application/json',
  })
})

test('renders every Look across the preset aspect ratios', async ({ page }) => {
  test.skip(
    process.env.LOOK_ASPECT_MATRIX !== '1',
    'Run explicitly with LOOK_ASPECT_MATRIX=1 for aspect-ratio visual artifacts.',
  )
  await page.addInitScript(() => localStorage.clear())
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  const canvas = page.locator('canvas[data-renderer="looks"]')
  const format = page.getByRole('region', { name: 'Format', exact: true })

  for (const aspect of ['16:9', '9:16', '1:1', '4:5'] as const) {
    await format.getByRole('radio', { name: aspect, exact: true }).click()
    for (const look of LOOKS) {
      await page.getByRole('radio', { name: look, exact: true }).click()
      await page.evaluate(() => new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }))
      const pixels = await canvas.evaluate((element: HTMLCanvasElement) => ({
        width: element.width,
        height: element.height,
        bytes: element.toDataURL('image/png').length,
      }))
      expect(pixels.bytes).toBeGreaterThan(100)
      const image = await canvas.screenshot()
      await writeFile(
        `/tmp/mbs-look-${look.toLowerCase()}-${aspect.replace(':', 'x')}.png`,
        image,
      )
    }
  }
})

test('keeps every animated Look varied and exactly looped', async ({ page }) => {
  test.skip(
    process.env.LOOK_MOTION_MATRIX !== '1',
    'Run explicitly with LOOK_MOTION_MATRIX=1 for deterministic motion review.',
  )
  const recipe = createDefaultBackgroundRecipe(1913)
  recipe.motion = {
    enabled: true,
    amount: 0.7,
    speed: 1,
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
    const controls = window as unknown as { __setLookTime: (value: number) => void }
    controls.__setLookTime = (value) => { controlledTime = value }
  }, recipe)
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  const canvas = page.locator('canvas[data-renderer="looks"]')
  const setTime = async (milliseconds: number) => {
    await page.evaluate((value) => {
      (window as unknown as { __setLookTime: (time: number) => void }).__setLookTime(value)
    }, milliseconds)
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    }))
    return canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL('image/png'))
  }

  for (const look of LOOKS) {
    await page.getByRole('radio', { name: look, exact: true }).click()
    const start = await setTime(0)
    const quarter = await setTime(2000)
    const end = await setTime(8000)
    expect(quarter).not.toBe(start)
    expect(end).toBe(start)
    await writeFile(
      `/tmp/mbs-look-motion-${look.toLowerCase()}.png`,
      Buffer.from(quarter.split(',')[1], 'base64'),
    )
  }
})

test('renders every Look across representative seeds', async ({ browser }) => {
  test.skip(
    process.env.LOOK_SEED_MATRIX !== '1',
    'Run explicitly with LOOK_SEED_MATRIX=1 for seeded visual artifacts.',
  )
  const signatures = new Map<string, string[]>()
  for (const seed of [42, 1913, 8675309]) {
    const recipe = createDefaultBackgroundRecipe(seed)
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.addInitScript((savedRecipe) => {
      localStorage.setItem('mbs-bg-generator-autosave-v2', JSON.stringify(savedRecipe))
    }, recipe)
    await page.goto('/')
    await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
    const canvas = page.locator('canvas[data-renderer="looks"]')
    for (const look of LOOKS) {
      await page.getByRole('radio', { name: look, exact: true }).click()
      await page.evaluate(() => new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }))
      const image = await canvas.screenshot()
      expect(image.byteLength).toBeGreaterThan(100)
      signatures.set(look, [...(signatures.get(look) ?? []), image.toString('base64')])
      await writeFile(`/tmp/mbs-look-${look.toLowerCase()}-seed-${seed}.png`, image)
    }
    await context.close()
  }
  for (const look of LOOKS) {
    expect(new Set(signatures.get(look)).size).toBeGreaterThan(1)
  }
})
