import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import {
  BACKGROUND_AUTOSAVE_KEY,
  createDefaultBackgroundRecipe,
  deserializeBackgroundRecipe,
} from '../../src/features/background-generator/recipe'
import { canonicalMetaPlacement } from '../../src/core/lab/metaInfluence'
import {
  analyzeImageMotionSequence,
  captureImageMotionFrame,
} from './helpers/image-motion'

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
]

type PixelBounds = {
  left: number
  right: number
  top: number
  bottom: number
}

type PixelDifference = {
  mean: number
  changedFraction: number
  edgeMean: number
  centerMean: number
}

async function pixelDifference(
  page: Page,
  first: Buffer,
  second: Buffer,
): Promise<PixelDifference> {
  return page.evaluate(async ([firstSource, secondSource]) => {
    const load = async (source: string) => {
      const image = new Image()
      image.src = source
      await image.decode()
      return image
    }
    const [firstImage, secondImage] = await Promise.all([
      load(firstSource),
      load(secondSource),
    ])
    if (
      firstImage.width !== secondImage.width
      || firstImage.height !== secondImage.height
    ) {
      throw new Error('Screenshots must have matching dimensions')
    }

    const readPixels = (image: HTMLImageElement) => {
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('2D image comparison unavailable')
      context.drawImage(image, 0, 0)
      return context.getImageData(0, 0, image.width, image.height).data
    }
    const firstPixels = readPixels(firstImage)
    const secondPixels = readPixels(secondImage)
    let difference = 0
    let changed = 0
    let edgeDifference = 0
    let edgePixels = 0
    let centerDifference = 0
    let centerPixels = 0
    const pixelCount = firstImage.width * firstImage.height

    for (let index = 0; index < pixelCount; index += 1) {
      const offset = index * 4
      const delta = (
        Math.abs(firstPixels[offset] - secondPixels[offset])
        + Math.abs(firstPixels[offset + 1] - secondPixels[offset + 1])
        + Math.abs(firstPixels[offset + 2] - secondPixels[offset + 2])
      ) / 3
      difference += delta
      if (delta >= 8) changed += 1

      const x = index % firstImage.width
      const y = Math.floor(index / firstImage.width)
      const edge = (
        x < firstImage.width * 0.15
        || x >= firstImage.width * 0.85
        || y < firstImage.height * 0.15
        || y >= firstImage.height * 0.85
      )
      if (edge) {
        edgeDifference += delta
        edgePixels += 1
      }
      const center = (
        x >= firstImage.width * 0.25
        && x < firstImage.width * 0.75
        && y >= firstImage.height * 0.2
        && y < firstImage.height * 0.8
      )
      if (center) {
        centerDifference += delta
        centerPixels += 1
      }
    }

    return {
      mean: difference / pixelCount,
      changedFraction: changed / pixelCount,
      edgeMean: edgeDifference / edgePixels,
      centerMean: centerDifference / centerPixels,
    }
  }, [
    `data:image/png;base64,${first.toString('base64')}`,
    `data:image/png;base64,${second.toString('base64')}`,
  ])
}

async function shiftedPixelDifference(
  page: Page,
  firstSource: string,
  secondSource: string,
  shiftX: number,
): Promise<{ mismatchedFraction: number; maxDelta: number }> {
  return page.evaluate(async ([firstUrl, secondUrl, requestedShift]) => {
    const load = async (source: string) => {
      const image = new Image()
      image.src = source
      await image.decode()
      return image
    }
    const [first, second] = await Promise.all([load(firstUrl), load(secondUrl)])
    if (first.width !== second.width || first.height !== second.height) {
      throw new Error('Shift comparison dimensions differ')
    }
    const pixels = (image: HTMLImageElement) => {
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Shift comparison context unavailable')
      context.drawImage(image, 0, 0)
      return context.getImageData(0, 0, image.width, image.height).data
    }
    const before = pixels(first)
    const after = pixels(second)
    const dx = Math.round(requestedShift)
    let mismatched = 0
    let maxDelta = 0
    let compared = 0
    for (let y = 0; y < first.height; y += 1) {
      for (let x = Math.max(0, dx); x < first.width; x += 1) {
        const beforeOffset = (y * first.width + x - dx) * 4
        const afterOffset = (y * first.width + x) * 4
        let pixelMismatch = false
        for (let channel = 0; channel < 4; channel += 1) {
          const delta = Math.abs(after[afterOffset + channel] - before[beforeOffset + channel])
          maxDelta = Math.max(maxDelta, delta)
          if (delta !== 0) pixelMismatch = true
        }
        if (pixelMismatch) mismatched += 1
        compared += 1
      }
    }
    return {
      mismatchedFraction: mismatched / Math.max(1, compared),
      maxDelta,
    }
  }, [firstSource, secondSource, shiftX] as const)
}

async function foregroundBounds(page: Page, screenshot: Buffer): Promise<PixelBounds> {
  return page.evaluate(async (source) => {
    const image = new Image()
    image.src = source
    await image.decode()

    const analysis = document.createElement('canvas')
    analysis.width = image.width
    analysis.height = image.height
    const context = analysis.getContext('2d')
    if (!context) throw new Error('2D image analysis unavailable')
    context.drawImage(image, 0, 0)

    const pixels = context.getImageData(0, 0, image.width, image.height).data
    let left = image.width
    let right = -1
    let top = image.height
    let bottom = -1

    for (let y = 8; y < image.height - 8; y += 1) {
      for (let x = 8; x < image.width - 8; x += 1) {
        const offset = (y * image.width + x) * 4
        const red = pixels[offset]
        const green = pixels[offset + 1]
        const blue = pixels[offset + 2]
        const minimum = Math.min(red, green, blue)
        const maximum = Math.max(red, green, blue)
        // Track the bright, low-chroma symbol rather than assuming a flat
        // corner color: 3D Looks now intentionally treat the full background.
        if (minimum < 175 || maximum - minimum > 70) continue
        left = Math.min(left, x)
        right = Math.max(right, x)
        top = Math.min(top, y)
        bottom = Math.max(bottom, y)
      }
    }

    if (right < 0) throw new Error('Rendered model was not found')
    return { left, right, top, bottom }
  }, `data:image/png;base64,${screenshot.toString('base64')}`)
}

async function waitForAnimationFrames(page: Page, count: number): Promise<void> {
  await page.evaluate((frameCount) => new Promise<void>((resolve) => {
    let elapsed = 0
    const advance = () => {
      elapsed += 1
      if (elapsed >= frameCount) resolve()
      else requestAnimationFrame(advance)
    }
    requestAnimationFrame(advance)
  }), count)
}

async function pressUndo(page: Page): Promise<void> {
  await page.keyboard.press('ControlOrMeta+z')
}

async function pressRedo(page: Page): Promise<void> {
  await page.keyboard.press('ControlOrMeta+Shift+z')
}

async function resetAll(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Reset all', exact: true }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Reset all?', exact: true })
  await dialog.getByRole('button', { name: 'Reset all', exact: true }).click()
}

async function enlargeArtworkFromCenter(page: Page, ratio = 1.5): Promise<void> {
  const artboard = await page.locator('.lab-canvas-stack').boundingBox()
  const frame = page.locator('.lab-subject-frame')
  const handle = await page.locator('.lab-transform-handle.corner-se').boundingBox()
  expect(artboard).not.toBeNull()
  expect(handle).not.toBeNull()
  await page.keyboard.down('Alt')
  await page.mouse.move(
    handle!.x + handle!.width / 2,
    handle!.y + handle!.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    artboard!.x + artboard!.width * (0.5 + ratio / 2),
    artboard!.y + artboard!.height * (0.5 + ratio / 2),
  )
  await page.mouse.up()
  await page.keyboard.up('Alt')
  const scaled = await frame.boundingBox()
  expect(scaled).not.toBeNull()
  expect(scaled!.width).toBeCloseTo(artboard!.width * ratio, 1)
  expect(scaled!.height).toBeCloseTo(artboard!.height * ratio, 1)
  const zoomOut = page.getByRole('button', { name: 'Zoom out', exact: true })
  await zoomOut.click()
  await zoomOut.click()
  await zoomOut.click()
  await waitForAnimationFrames(page, 2)
}

test('rewrites legacy format metadata before exposing the generator', async ({ page }) => {
  const legacy = createDefaultBackgroundRecipe(42) as ReturnType<
    typeof createDefaultBackgroundRecipe
  > & {
    format: ReturnType<typeof createDefaultBackgroundRecipe>['format'] & {
      resolution?: string
    }
  }
  legacy.format = {
    aspect: 'custom',
    resolution: '8k',
    width: 100,
    height: 200,
  }
  await page.addInitScript((raw) => {
    localStorage.setItem('mbs-bg-generator-autosave-v2', raw)
  }, JSON.stringify(legacy))

  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toHaveCount(1)
  expect(await page.evaluate(() => {
    const recipe = JSON.parse(localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '{}')
    return recipe.format
  })).toEqual({ aspect: '9:16', width: 2160, height: 3840 })
})

test('falls back to the v1 autosave when the current autosave is invalid', async ({ page }) => {
  const legacy = createDefaultBackgroundRecipe(31415)
  legacy.palette.packId = 'bold'
  await page.addInitScript((raw) => {
    localStorage.setItem('mbs-bg-generator-autosave-v2', '{invalid json')
    localStorage.setItem('mbs-bg-generator-autosave-v1', raw)
  }, JSON.stringify(legacy))

  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Bold', exact: true }))
    .toHaveAttribute('aria-checked', 'true')
  expect(await page.evaluate(() => {
    const recipe = JSON.parse(localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '{}')
    return { seed: recipe.seed, packId: recipe.palette?.packId }
  })).toEqual({ seed: 31415, packId: 'bold' })
})

test('renders every curated look and keeps autosave isolated', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => {
    localStorage.clear()
    localStorage.setItem('lbs-autosave', 'sentinel')
  })

  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  await expect(page.getByRole('heading', {
    level: 1,
    name: 'MBS Background Generator',
    exact: true,
  })).toBeVisible()
  await expect(page.getByText('MBS Background Generator', { exact: true })).toBeVisible()

  for (const look of LOOKS) {
    const button = page.getByRole('radio', { name: look, exact: true })
    await expect(button).toBeVisible()
    await button.click()
  }

  await expect.poll(async () =>
    page.locator('.lab-look-thumb').evaluateAll((canvases) =>
      canvases.every((canvas) => (canvas as HTMLCanvasElement).toDataURL().length > 100),
    ),
  ).toBe(true)

  await page.getByRole('radio', { name: 'Bold', exact: true }).click()
  await page.waitForTimeout(500)
  const keys = await page.evaluate(() => Object.keys(localStorage))
  expect(keys).toContain('mbs-bg-generator-autosave-v2')
  expect(await page.evaluate(() => localStorage.getItem('lbs-autosave'))).toBe('sentinel')
  expect(errors).toEqual([])
})

test('renders opaque visible pattern on every edge of every V1 and V2 Look', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.clear())
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  const canvas = page.locator('canvas[data-renderer="looks"]')

  for (const version of ['V1', 'V2'] as const) {
    await page.getByRole('tab', { name: version, exact: true }).click()
    for (const look of LOOKS) {
      await page.getByRole('radio', { name: look, exact: true }).click()
      await waitForAnimationFrames(page, 3)
      const result = await canvas.evaluate((element: HTMLCanvasElement) => {
        const context = element.getContext('2d')
        if (!context) throw new Error('Look canvas context unavailable')
        const { width, height } = element
        const pixels = context.getImageData(0, 0, width, height).data
        const totals = [0, 0, 0, 0]
        const counts = [0, 0, 0, 0]
        let minimumAlpha = 255
        const luma = (offset: number) =>
          pixels[offset] * 0.2126
          + pixels[offset + 1] * 0.7152
          + pixels[offset + 2] * 0.0722

        for (let y = 4; y < height - 4; y += 4) {
          for (let x = 4; x < width - 4; x += 4) {
            const offset = (y * width + x) * 4
            const horizontal = (y * width + x + 4) * 4
            const vertical = ((y + 4) * width + x) * 4
            const localVariation = (
              Math.abs(luma(offset) - luma(horizontal))
              + Math.abs(luma(offset) - luma(vertical))
            ) / 2
            const edges = [
              y < height * 0.15,
              x > width * 0.85,
              y > height * 0.85,
              x < width * 0.15,
            ]
            edges.forEach((onEdge, index) => {
              if (!onEdge) return
              minimumAlpha = Math.min(minimumAlpha, pixels[offset + 3])
              totals[index] += localVariation
              counts[index] += 1
            })
          }
        }
        return {
          edgeVariation: totals.map((total, index) => total / counts[index]),
          minimumAlpha,
        }
      })
      expect(
        result.minimumAlpha,
        `${version} ${look} must paint an opaque full-frame background`,
      ).toBe(255)
      expect(
        Math.min(...result.edgeVariation),
        `${version} ${look} must remain patterned on all four edges`,
      ).toBeGreaterThan(0.2)
    }
  }
})

test('keeps V2 structure outside the canonical symbol bounds', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear())
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  await page.getByRole('slider', { name: 'Complexity', exact: true }).fill('85')
  const canvas = page.locator('canvas[data-renderer="looks"]')
  const dimensions = await canvas.evaluate((element: HTMLCanvasElement) => ({
    width: element.width,
    height: element.height,
  }))
  const symbol = canonicalMetaPlacement(dimensions.width, dimensions.height)

  for (const palette of ['Bold', 'Atmospheric']) {
    await page.getByRole('radio', { name: palette, exact: true }).click()
    for (const look of LOOKS) {
      await page.getByRole('radio', { name: look, exact: true }).click()
      await waitForAnimationFrames(page, 3)
      const outsideRatio = await canvas.evaluate(
        (element: HTMLCanvasElement, bounds) => {
          const context = element.getContext('2d')
          if (!context) throw new Error('Look canvas context unavailable')
          const { width, height } = element
          const pixels = context.getImageData(0, 0, width, height).data
          const luma = (offset: number) =>
            pixels[offset] * 0.2126
            + pixels[offset + 1] * 0.7152
            + pixels[offset + 2] * 0.0722
          let outside = 0
          let total = 0
          for (let y = 4; y < height - 4; y += 4) {
            for (let x = 4; x < width - 4; x += 4) {
              const offset = (y * width + x) * 4
              const localEnergy = (
                Math.abs(luma(offset) - luma(offset + 16))
                + Math.abs(luma(offset) - luma(offset + width * 16))
              )
              total += localEnergy
              if (
                x < bounds.x
                || x > bounds.x + bounds.width
                || y < bounds.y
                || y > bounds.y + bounds.height
              ) {
                outside += localEnergy
              }
            }
          }
          return outside / Math.max(1, total)
        },
        symbol,
      )
      expect(
        outsideRatio,
        `${palette} ${look} must place at least 40% of local contrast outside the symbol bounds`,
      ).toBeGreaterThanOrEqual(0.4)
    }
  }
})

test('keeps inset legacy transforms full-bleed and the selection frame canvas-sized', async ({
  page,
}) => {
  const recipe = createDefaultBackgroundRecipe(42)
  recipe.look = { id: 'pixels', detail: 0.7, version: 'v2' }
  recipe.transforms.background = {
    preset: 'free',
    x: 0.25,
    y: -0.2,
    scale: 0.82,
    rotation: 0,
  }
  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [BACKGROUND_AUTOSAVE_KEY, JSON.stringify(recipe)] as const,
  )
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  await waitForAnimationFrames(page, 3)

  const artboard = page.locator('.lab-canvas-stack')
  const selection = page.locator('.lab-subject-frame')
  await expect(selection).toBeVisible()
  const [artboardBox, selectionBox] = await Promise.all([
    artboard.boundingBox(),
    selection.boundingBox(),
  ])
  expect(artboardBox).not.toBeNull()
  expect(selectionBox).not.toBeNull()
  expect(selectionBox!.x).toBeCloseTo(artboardBox!.x, 0)
  expect(selectionBox!.y).toBeCloseTo(artboardBox!.y, 0)
  expect(selectionBox!.width).toBeCloseTo(artboardBox!.width, 0)
  expect(selectionBox!.height).toBeCloseTo(artboardBox!.height, 0)

  const edgeColorCounts = await page.locator('canvas[data-renderer="looks"]').evaluate(
    (element: HTMLCanvasElement) => {
      const context = element.getContext('2d')
      if (!context) throw new Error('Look canvas context unavailable')
      const { width, height } = element
      const pixels = context.getImageData(0, 0, width, height).data
      const sample = (coordinates: Iterable<readonly [number, number]>) => {
        const colors = new Set<string>()
        for (const [x, y] of coordinates) {
          const offset = (y * width + x) * 4
          colors.add(
            `${pixels[offset] >> 3}:${pixels[offset + 1] >> 3}:${pixels[offset + 2] >> 3}`,
          )
        }
        return colors.size
      }
      const horizontal = (y: number) => (function* () {
        for (let x = 0; x < width; x += 2) yield [x, y] as const
      })()
      const vertical = (x: number) => (function* () {
        for (let y = 0; y < height; y += 2) yield [x, y] as const
      })()
      return [
        sample(horizontal(0)),
        sample(vertical(width - 1)),
        sample(horizontal(height - 1)),
        sample(vertical(0)),
      ]
    },
  )
  expect(
    Math.min(...edgeColorCounts),
    `each canvas edge must contain pattern; color counts were ${edgeColorCounts.join(', ')}`,
  ).toBeGreaterThan(2)
  await expect.poll(() => page.evaluate((key) => {
    const saved = JSON.parse(localStorage.getItem(key) ?? '{}')
    return saved.transforms?.background
  }, BACKGROUND_AUTOSAVE_KEY)).toMatchObject({
    x: 0,
    y: 0,
    scale: 1,
  })
})

test('selects, undoes, and persists 2D Looks through the route UI', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  const canvas = page.locator('.lab-canvas')
  await waitForAnimationFrames(page, 3)
  const before = await canvas.screenshot()

  const pixels = page.getByRole('radio', { name: 'Pixels', exact: true })
  const scanlines = page.getByRole('radio', { name: 'Scanlines', exact: true })
  await pixels.click()
  await expect(pixels).toHaveAttribute('aria-checked', 'true')
  await waitForAnimationFrames(page, 3)
  expect(await canvas.evaluate((element) =>
    (element as HTMLCanvasElement).toDataURL(),
  )).not.toBe(before)

  await pixels.focus()
  await page.keyboard.press('ArrowRight')
  await expect(scanlines).toBeFocused()
  await expect(scanlines).toHaveAttribute('aria-checked', 'true')
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '{}').look?.id,
  )).toBe('scanlines')

  await pressUndo(page)
  await expect(pixels).toHaveAttribute('aria-checked', 'true')
  await pressRedo(page)
  await expect(scanlines).toHaveAttribute('aria-checked', 'true')
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '{}').look?.id,
  )).toBe('scanlines')
  const saved = await page.evaluate(() =>
    localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '',
  )
  expect(deserializeBackgroundRecipe(saved)?.look.id).toBe('scanlines')
  await page.reload()
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Scanlines', exact: true }))
    .toHaveAttribute('aria-checked', 'true')
})

test('switches, undoes, and persists the V1 and V2 Look tabs', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  const tabs = page.getByRole('tablist', { name: 'Look version', exact: true })
  const v1 = tabs.getByRole('tab', { name: 'V1', exact: true })
  const v2 = tabs.getByRole('tab', { name: 'V2', exact: true })
  const canvas = page.locator('.lab-canvas')

  await expect(v2).toHaveAttribute('aria-selected', 'true')
  for (const label of ['Frame', 'Pixels', 'Brushwork', 'Quilt', 'Trails']) {
    await page.getByRole('radio', { name: label, exact: true }).click()
    await waitForAnimationFrames(page, 3)
    const current = await canvas.screenshot()
    await v1.click()
    await expect(v1).toHaveAttribute('aria-selected', 'true')
    await waitForAnimationFrames(page, 3)
    expect((await canvas.screenshot()).equals(current), `${label} should differ in V1`).toBe(false)
    await v2.click()
    await expect(v2).toHaveAttribute('aria-selected', 'true')
  }
  await v1.click()
  await expect(v1).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '{}').look?.version,
  )).toBe('v1')

  await pressUndo(page)
  await expect(v2).toHaveAttribute('aria-selected', 'true')
  await pressRedo(page)
  await expect(v1).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '{}').look?.version,
  )).toBe('v1')
  await page.reload()
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  const restoredV1 = page.getByRole('tab', { name: 'V1', exact: true })
  await expect(restoredV1).toHaveAttribute('aria-selected', 'true')
  await restoredV1.focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'V2', exact: true })).toBeFocused()
  await expect(page.getByRole('tab', { name: 'V2', exact: true }))
    .toHaveAttribute('aria-selected', 'true')

  await page.getByRole('radio', { name: '3D', exact: true }).click()
  const viewer = page.locator('[data-mbs-material-model="true"]')
  const processed = viewer.locator('.lab-material-look-canvas')
  await expect(viewer).toHaveAttribute('data-model-status', 'ready')
  await page.getByRole('button', { name: 'Frame', exact: true }).click()
  await expect(processed).toHaveAttribute('data-render-status', 'ready')
  await expect(processed).toHaveAttribute('data-look-version', 'v2')
  const revision = await processed.getAttribute('data-render-revision')
  await page.getByRole('tab', { name: 'V1', exact: true }).click()
  await expect(viewer).toHaveAttribute('data-look-version', 'v1')
  await expect.poll(() => processed.getAttribute('data-render-revision')).not.toBe(revision)
  await expect(processed).toHaveAttribute('data-render-status', 'ready')
  await expect(processed).toHaveAttribute('data-look-version', 'v1')
})

test('controls Look complexity with one shared undoable slider', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear())
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  const complexity = page.getByRole('slider', { name: 'Complexity', exact: true })
  await complexity.focus()
  await page.keyboard.press('End')
  await expect(complexity).toHaveValue('100')
  await complexity.evaluate((element) => (element as HTMLInputElement).blur())
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '{}').look?.detail,
  )).toBe(1)

  await pressUndo(page)
  await expect(complexity).toHaveValue('50')
  await page.getByRole('radio', { name: '3D', exact: true }).click()
  await expect(page.getByRole('slider', { name: 'Complexity', exact: true })).toHaveValue('50')
})

test('keeps V2 complexity tiers additive and visibly distinct', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear())
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  await page.getByRole('radio', { name: 'Bold', exact: true }).click()

  const canvas = page.locator('canvas[data-renderer="looks"]')
  const complexity = page.getByRole('slider', { name: 'Complexity', exact: true })
  for (const look of LOOKS) {
    await page.getByRole('radio', { name: look, exact: true }).click()
    const captures: Buffer[] = []
    for (const value of ['15', '50', '85']) {
      await complexity.fill(value)
      await waitForAnimationFrames(page, 3)
      captures.push(await canvas.screenshot())
    }

    for (const [label, difference] of [
      ['Low to Mid', await pixelDifference(page, captures[0], captures[1])],
      ['Mid to High', await pixelDifference(page, captures[1], captures[2])],
    ] as const) {
      expect(
        difference.mean,
        `${look} ${label} must add a visible tier`,
      ).toBeGreaterThan(0.15)
      expect(
        difference.changedFraction,
        `${look} ${label} must change meaningful pixels`,
      ).toBeGreaterThan(0.002)
      expect(
        difference.changedFraction,
        `${look} ${label} must preserve the existing composition`,
      ).toBeLessThan(0.2)
    }
  }
})

test('recomposes every structural Look across seeds and aspects', async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const structuralLooks = [
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
  const seeds = [42, 1913, 8675309] as const
  type Signature = {
    cells: number[][]
    activeMask: string
    quietCell: number
    centroid: readonly [number, number]
  }
  const signatures = new Map<string, Signature>()

  for (const seed of seeds) {
    const recipe = createDefaultBackgroundRecipe(seed)
    recipe.look = { id: 'pixels', detail: 0.5, version: 'v2' }
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.addInitScript(([key, value]) => {
      localStorage.clear()
      localStorage.setItem(key, value)
    }, [BACKGROUND_AUTOSAVE_KEY, JSON.stringify(recipe)] as const)
    await page.goto('/')
    await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
    const canvas = page.locator('canvas[data-renderer="looks"]')
    const format = page.getByRole('region', { name: 'Format', exact: true })
    const aspects = seed === 1913
      ? ['16:9', '9:16', '1:1', '4:5'] as const
      : ['16:9'] as const

    for (const aspect of aspects) {
      await format.getByRole('radio', { name: aspect, exact: true }).click()
      for (const look of structuralLooks) {
        await page.getByRole('radio', { name: look, exact: true }).click()
        await waitForAnimationFrames(page, 3)
        const signature = await canvas.evaluate((element: HTMLCanvasElement) => {
          const context2d = element.getContext('2d')
          if (!context2d) throw new Error('Look canvas context unavailable')
          const { width, height } = element
          const pixels = context2d.getImageData(0, 0, width, height).data
          const columns = 5
          const rows = 4
          const rawCells: {
            color: readonly [number, number, number]
            energy: number
          }[] = []
          for (let row = 0; row < rows; row += 1) {
            for (let column = 0; column < columns; column += 1) {
              const left = Math.floor(column * width / columns)
              const right = Math.floor((column + 1) * width / columns)
              const top = Math.floor(row * height / rows)
              const bottom = Math.floor((row + 1) * height / rows)
              let red = 0
              let green = 0
              let blue = 0
              let energy = 0
              let count = 0
              for (let y = top + 4; y < bottom - 4; y += 4) {
                for (let x = left + 4; x < right - 4; x += 4) {
                  const offset = (y * width + x) * 4
                  const rightOffset = offset + 16
                  const downOffset = offset + width * 16
                  red += pixels[offset]
                  green += pixels[offset + 1]
                  blue += pixels[offset + 2]
                  const luma = pixels[offset] * 0.2126
                    + pixels[offset + 1] * 0.7152
                    + pixels[offset + 2] * 0.0722
                  const rightLuma = pixels[rightOffset] * 0.2126
                    + pixels[rightOffset + 1] * 0.7152
                    + pixels[rightOffset + 2] * 0.0722
                  const downLuma = pixels[downOffset] * 0.2126
                    + pixels[downOffset + 1] * 0.7152
                    + pixels[downOffset + 2] * 0.0722
                  energy += Math.abs(luma - rightLuma) + Math.abs(luma - downLuma)
                  count += 1
                }
              }
              rawCells.push({
                color: [red / count, green / count, blue / count],
                energy: energy / count,
              })
            }
          }
          const global = rawCells.reduce(
            (sum, cell) => [
              sum[0] + cell.color[0] / rawCells.length,
              sum[1] + cell.color[1] / rawCells.length,
              sum[2] + cell.color[2] / rawCells.length,
            ],
            [0, 0, 0],
          )
          const scores = rawCells.map((cell) => {
            const colorDistance = (
              Math.abs(cell.color[0] - global[0])
              + Math.abs(cell.color[1] - global[1])
              + Math.abs(cell.color[2] - global[2])
            ) / 3
            return colorDistance + cell.energy * 1.8
          })
          const sorted = [...scores].sort((left, right) => left - right)
          const threshold = sorted[Math.floor(sorted.length * 0.58)]
          let totalWeight = 0
          let centroidX = 0
          let centroidY = 0
          scores.forEach((score, index) => {
            const column = index % columns
            const row = Math.floor(index / columns)
            totalWeight += score
            centroidX += (column + 0.5) / columns * score
            centroidY += (row + 0.5) / rows * score
          })
          return {
            cells: rawCells.map((cell) => [
              cell.color[0] / 255,
              cell.color[1] / 255,
              cell.color[2] / 255,
              Math.min(1, cell.energy / 48),
            ]),
            activeMask: scores.map((score) => score >= threshold ? '1' : '0').join(''),
            quietCell: scores.indexOf(Math.min(...scores)),
            centroid: [
              centroidX / Math.max(1, totalWeight),
              centroidY / Math.max(1, totalWeight),
            ] as const,
          }
        })
        signatures.set(`${look}:${seed}:${aspect}`, signature)
      }
    }
    await context.close()
  }

  const macroDistance = (left: Signature, right: Signature) => {
    let total = 0
    let count = 0
    left.cells.forEach((cell, cellIndex) => {
      cell.forEach((value, channel) => {
        total += Math.abs(value - right.cells[cellIndex][channel])
        count += 1
      })
    })
    return total / count
  }

  for (const look of structuralLooks) {
    const seeded = seeds.map((seed) => signatures.get(`${look}:${seed}:16:9`)! )
    const pairDistances = [
      macroDistance(seeded[0], seeded[1]),
      macroDistance(seeded[0], seeded[2]),
      macroDistance(seeded[1], seeded[2]),
    ]
    expect(
      Math.min(...pairDistances),
      `${look} seeds must produce different macro-cell compositions`,
    ).toBeGreaterThan(0.025)
    expect(
      new Set(seeded.map((signature) =>
        `${signature.activeMask}:${signature.quietCell}`)).size,
      `${look} seeds must move masses and quiet zones, not just recolor pixels`,
    ).toBe(3)

    const landscape = signatures.get(`${look}:1913:16:9`)!
    const portrait = signatures.get(`${look}:1913:9:16`)!
    const square = signatures.get(`${look}:1913:1:1`)!
    const fourByFive = signatures.get(`${look}:1913:4:5`)!
    expect(
      macroDistance(landscape, portrait),
      `${look} portrait must be recomposed rather than cropped from landscape`,
    ).toBeGreaterThan(0.02)
    expect(
      new Set([landscape, portrait, square, fourByFive].map((signature) =>
        `${signature.activeMask}:${signature.quietCell}`)).size,
      `${look} aspect presets must produce at least three macro arrangements`,
    ).toBeGreaterThanOrEqual(3)
  }
})

test('uses Energy as harmonic richness without changing V2 topology', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const recipe = createDefaultBackgroundRecipe(1913)
  recipe.look = { id: 'pixels', detail: 0.85, version: 'v2' }
  recipe.motion = {
    enabled: true,
    amount: 0.82,
    speed: 0.1,
    loopSeconds: 8,
  }
  await page.addInitScript(([key, value]) => {
    localStorage.clear()
    localStorage.setItem(key, value)
    let controlledTime = 0
    const nativeAnimationFrame = window.requestAnimationFrame.bind(window)
    Object.defineProperty(performance, 'now', {
      configurable: true,
      value: () => controlledTime,
    })
    window.requestAnimationFrame = (callback) =>
      nativeAnimationFrame(() => callback(controlledTime))
    ;(window as typeof window & { __setMotionGuardTime?: (value: number) => void })
      .__setMotionGuardTime = (value) => { controlledTime = value }
  }, [BACKGROUND_AUTOSAVE_KEY, JSON.stringify(recipe)] as const)
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  const canvas = page.locator('canvas[data-renderer="looks"]')
  const energy = page.getByRole('slider', { name: 'Energy', exact: true })
  const phases = [0, 0.25, 0.5, 0.75, 1] as const
  const setPhase = async (phase: number) => {
    await page.evaluate((value) => {
      ;(window as typeof window & { __setMotionGuardTime?: (time: number) => void })
        .__setMotionGuardTime?.(value * 8000)
    }, phase)
    await waitForAnimationFrames(page, 2)
  }
  const activeLooks = [
    'Frame',
    'Pixels',
    'Scanlines',
    'Streams',
    'Beads',
    'Quilt',
    'Weave',
    'Marks',
    'Trails',
  ] as const

  for (const look of activeLooks) {
    await page.getByRole('radio', { name: look, exact: true }).click()
    const samples = async (speed: string) => {
      await energy.fill(speed)
      const frames: Awaited<ReturnType<typeof captureImageMotionFrame>>[] = []
      for (const phase of phases) {
        await setPhase(phase)
        frames.push(await captureImageMotionFrame(canvas, phase))
      }
      return frames
    }
    const low = await samples('0.1')
    const high = await samples('2')
    const lowReport = analyzeImageMotionSequence(low)
    const highReport = analyzeImageMotionSequence(high)

    expect(lowReport.seamExact, `${look} low-Energy seam`).toBe(true)
    expect(highReport.seamExact, `${look} high-Energy seam`).toBe(true)
    expect(high[0].dataUrl, `${look} Energy cannot change phase-zero topology`).toBe(low[0].dataUrl)
    expect(high[1].dataUrl, `${look} Energy must affect an interior frame`).not.toBe(low[1].dataUrl)
    expect(
      highReport.meanCoarseEnergy,
      `${look} high Energy must increase coarse motion`,
    ).toBeGreaterThan(lowReport.meanCoarseEnergy * 1.03)
    expect(
      highReport.minimumTopologyRetention,
      `${look} high Energy cannot pop topology`,
    ).toBeGreaterThan(0.52)
  }
})

test('keeps Marks and Trails active across the macro field with a quiet zone', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.clear())
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  await page.getByRole('slider', { name: 'Complexity', exact: true }).fill('15')
  const canvas = page.locator('canvas[data-renderer="looks"]')

  for (const palette of ['Bold', 'Atmospheric']) {
    await page.getByRole('radio', { name: palette, exact: true }).click()
    for (const look of ['Marks', 'Trails']) {
      await page.getByRole('radio', { name: look, exact: true }).click()
      await waitForAnimationFrames(page, 3)
      const energies = await canvas.evaluate((element: HTMLCanvasElement) => {
        const context = element.getContext('2d')
        if (!context) throw new Error('Look canvas context unavailable')
        const { width, height } = element
        const pixels = context.getImageData(0, 0, width, height).data
        const luma = (offset: number) =>
          pixels[offset] * 0.2126
          + pixels[offset + 1] * 0.7152
          + pixels[offset + 2] * 0.0722
        const cells: number[] = []
        for (let row = 0; row < 3; row += 1) {
          for (let column = 0; column < 4; column += 1) {
            const left = Math.floor(column * width / 4)
            const right = Math.floor((column + 1) * width / 4)
            const top = Math.floor(row * height / 3)
            const bottom = Math.floor((row + 1) * height / 3)
            let total = 0
            let count = 0
            for (let y = top + 4; y < bottom - 4; y += 4) {
              for (let x = left + 4; x < right - 4; x += 4) {
                const offset = (y * width + x) * 4
                total += (
                  Math.abs(luma(offset) - luma(offset + 16))
                  + Math.abs(luma(offset) - luma(offset + width * 16))
                )
                count += 1
              }
            }
            cells.push(total / Math.max(1, count))
          }
        }
        return cells
      })
      const sorted = [...energies].sort((left, right) => left - right)
      expect(
        sorted[0],
        `${palette} ${look} Low must remain composed in every macro cell`,
      ).toBeGreaterThan(1.2)
      expect(
        sorted.at(-1)! / sorted[0],
        `${palette} ${look} Low must retain a meaningful quiet-to-active hierarchy`,
      ).toBeGreaterThan(2.4)
    }
  }
})

test('pins the accessible mode switch to the stage and keeps mode-specific controls', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()

  const modeSwitch = page.getByRole('radiogroup', { name: 'Canvas mode', exact: true })
  const backgroundTab = page.getByRole('radio', { name: '2D', exact: true })
  const materialTab = page.getByRole('radio', { name: '3D', exact: true })
  const stage = page.locator('.lab-canvas-wrap')
  const artboard = page.locator('.lab-canvas-stack')
  const toolbar = page.getByRole('group', { name: 'Canvas tools', exact: true })
  await expect(modeSwitch).toBeVisible()
  await expect(toolbar).toBeVisible()
  await expect(toolbar.getByRole('button', { name: 'Select', exact: true })).toBeEnabled()
  await expect(toolbar.getByRole('button', { name: 'Hand', exact: true })).toBeEnabled()
  await expect(toolbar.getByRole('button', { name: 'Fit view', exact: true })).toBeEnabled()
  await expect(page.locator('.lab-topbar').getByRole('radiogroup')).toHaveCount(0)
  await expect(page.locator('.lab-canvas-wrap').getByRole('radiogroup')).toHaveCount(1)
  await expect(backgroundTab.locator('svg.lucide-image')).toBeVisible()
  await expect(materialTab.locator('svg.lucide-box')).toBeVisible()
  await expect(backgroundTab).toHaveAttribute('aria-checked', 'true')
  await expect(backgroundTab).toHaveAttribute('tabindex', '0')
  await expect(materialTab).toHaveAttribute('tabindex', '-1')
  await backgroundTab.hover()
  await expect(backgroundTab.getByRole('tooltip')).toHaveCSS('opacity', '1')

  const [switchBox, stageBox, artboardBox] = await Promise.all([
    modeSwitch.boundingBox(),
    stage.boundingBox(),
    artboard.boundingBox(),
  ])
  expect(switchBox).not.toBeNull()
  expect(stageBox).not.toBeNull()
  expect(artboardBox).not.toBeNull()
  expect(
    Math.abs(
      switchBox!.x + switchBox!.width / 2
      - (stageBox!.x + stageBox!.width / 2),
    ),
  ).toBeLessThanOrEqual(1)
  expect(
    stageBox!.y + stageBox!.height - switchBox!.y - switchBox!.height,
  ).toBeCloseTo(16, 0)

  await stage.press('+')
  await expect.poll(async () => (await artboard.boundingBox())?.width ?? 0).toBeGreaterThan(
    artboardBox!.width,
  )
  const keyboardZoomWidth = (await artboard.boundingBox())!.width
  const zoomedSwitchBox = await modeSwitch.boundingBox()
  expect(zoomedSwitchBox).not.toBeNull()
  expect(zoomedSwitchBox!.x).toBeCloseTo(switchBox!.x, 0)
  expect(zoomedSwitchBox!.y).toBeCloseTo(switchBox!.y, 0)
  expect(zoomedSwitchBox!.width).toBeCloseTo(switchBox!.width, 0)
  expect(zoomedSwitchBox!.height).toBeCloseTo(switchBox!.height, 0)
  await toolbar.getByRole('button', { name: 'Fit view', exact: true }).click()
  await expect.poll(async () => (await artboard.boundingBox())?.width ?? 0).toBeCloseTo(
    artboardBox!.width,
    0,
  )
  await toolbar.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect.poll(async () => (await artboard.boundingBox())?.width ?? 0).toBeCloseTo(
    keyboardZoomWidth,
    0,
  )
  const actualScale = Math.round(keyboardZoomWidth / 3840 * 100)
  await expect(toolbar.getByLabel('Canvas zoom')).toHaveText(`${actualScale}%`)
  await toolbar.getByRole('button', { name: 'Fit view', exact: true }).click()
  const formatRegion = page.getByRole('region', { name: 'Format', exact: true })
  const aspectPresets = formatRegion.getByRole('radiogroup', { name: 'Aspect' })
  await expect(aspectPresets).toBeVisible()
  await expect(aspectPresets.getByRole('radio')).toHaveCount(4)
  await expect(formatRegion.getByText('3840 × 2160', { exact: true })).toHaveCount(0)
  await expect(formatRegion.getByRole('button', { name: 'Edit aspect' })).toHaveCount(0)
  await expect(formatRegion.getByRole('button', { name: 'Reset framing' })).toHaveCount(0)

  await expect(page.getByRole('region', {
    name: '2D design canvas',
    exact: true,
  })).toBeVisible()
  await expect(page.locator('[data-renderer="looks"]')).toBeVisible()
  await expect(page.locator('.panel-heading', { hasText: /^Looks$/ })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'Looks', exact: true })).toBeVisible()
  await expect(page.locator('.panel-heading', { hasText: /^Materials$/ })).toHaveCount(0)
  await expect(page.locator('[data-mbs-shader="true"]')).toHaveCount(0)
  await expect(page.getByText('Compose from Looks, color, and materials')).toHaveCount(0)

  await backgroundTab.focus()
  await page.keyboard.press('ArrowRight')
  await expect(materialTab).toBeFocused()
  await expect(materialTab).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('region', {
    name: '3D design canvas',
    exact: true,
  })).toBeVisible()
  await expect(page.locator('[data-renderer="material"]')).toBeVisible()
  await expect(toolbar.getByRole('button', { name: 'Select', exact: true })).toBeDisabled()
  await expect(toolbar.getByRole('button', { name: 'Aspect', exact: true })).toHaveCount(0)
  await expect(page.locator('.panel-heading', { hasText: /^Colors$/ })).toBeVisible()
  await expect(page.locator('.panel-heading', { hasText: /^Materials$/ })).toBeVisible()
  await expect(page.locator('.panel-heading', { hasText: /^Looks$/ })).toBeVisible()
  await expect(page.locator('.lab-side-right .panel-heading')).toHaveText([
    'Format',
    'Colors',
    'Materials',
    'Looks',
    'Look palette',
  ])
  await expect(page.locator('[data-mbs-look-scope="3d-full-frame"]')).toHaveText(
    'Generic previews',
  )
  const backgroundRole = page.getByRole('button', { name: 'Background', exact: true })
  const highlightRole = page.getByRole('button', { name: 'Highlight', exact: true })
  await expect(backgroundRole).toBeVisible()
  await expect(highlightRole).toBeVisible()
  await backgroundRole.click()
  await expect(backgroundRole).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('dialog', { name: 'Material background color' })).toBeVisible()
  await page.getByRole('button', { name: 'Close color picker' }).click()
  await highlightRole.click()
  await expect(highlightRole).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Close color picker' }).click()
  const cleanSurface = page.getByRole('radio', { name: 'Clean', exact: true })
  await cleanSurface.focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('radio', { name: 'Liquid', exact: true }))
    .toHaveAttribute('aria-checked', 'true')
  await expect(page.getByText('Ratios normalize to 100% across enabled colors.')).toHaveCount(0)
  await expect(page.getByRole('spinbutton', { name: /percentage/ })).toHaveCount(0)
  await expect(page.getByText('Opaque untreated Meta symbol.')).toHaveCount(0)
  await expect(page.getByText('Intensity', { exact: true })).toBeVisible()
  const modelHelpers = page.locator('.lab-material-model-actions')
  await expect(modelHelpers).toBeVisible()
  const [materialSwitchBox, modelHelpersBox] = await Promise.all([
    modeSwitch.boundingBox(),
    modelHelpers.boundingBox(),
  ])
  expect(materialSwitchBox).not.toBeNull()
  expect(modelHelpersBox).not.toBeNull()
  expect(materialSwitchBox!.x).toBeCloseTo(switchBox!.x, 0)
  expect(materialSwitchBox!.y).toBeCloseTo(switchBox!.y, 0)
  expect(materialSwitchBox!.y).toBeGreaterThanOrEqual(
    modelHelpersBox!.y + modelHelpersBox!.height,
  )
  const stainlessSteel = page.getByRole('radio', {
    name: 'Stainless Steel',
    exact: true,
  })
  await expect(stainlessSteel).toBeVisible()
  await expect(page.getByRole('button', { name: 'Metal', exact: true })).toHaveCount(0)
  await expect(page.locator('.lab-material-quick-colors').getByRole('radio')).toHaveCount(14)
  await page.getByRole('radio', {
    name: 'Use #FF5001 for material highlight',
    exact: true,
  }).click()
  await expect.poll(async () =>
    page.evaluate(() => {
      const recipe = JSON.parse(localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '{}')
      return { mode: recipe.mode, highlight: recipe.material?.highlightColor }
    }),
  ).toEqual({ mode: 'background', highlight: '#FF5001' })
  await resetAll(page)
  await expect(materialTab).toHaveAttribute('aria-checked', 'true')
  const viewer = page.locator('[data-mbs-material-model="true"]')
  const modelCanvas = viewer.locator('.lab-material-model-canvas')
  await expect(viewer).toHaveAttribute('data-model-status', 'ready')
  await expect(viewer).toHaveAttribute('data-material', 'clean')
  await expect(viewer).toHaveAttribute('data-look', 'off')
  await expect(page.locator('[data-mbs-material-look-overlay="true"]')).toHaveCount(0)
  await waitForAnimationFrames(page, 3)
  const cleanMaterial = await modelCanvas.screenshot()
  const exportCurrent = () => page.evaluate(async () => {
    const exportPng = (window as typeof window & {
      __lbsLabExportPng?: () => Promise<string>
    }).__lbsLabExportPng
    if (!exportPng) throw new Error('Dev export hook unavailable')
    return exportPng()
  })
  const cleanExport = await exportCurrent()
  await stainlessSteel.click()
  await expect(viewer).toHaveAttribute('data-material', 'metal')
  await expect(page.getByText(/Licensed Shaders\.com preset/)).toHaveCount(0)
  await expect.poll(async () =>
    page.evaluate(() =>
      JSON.parse(localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '{}').material?.id,
    ),
  ).toBe('metal')
  await waitForAnimationFrames(page, 3)
  const materialDifference = await pixelDifference(
    page,
    cleanMaterial,
    await modelCanvas.screenshot(),
  )
  expect(materialDifference.changedFraction).toBeGreaterThan(0.02)
  expect(materialDifference.centerMean).toBeGreaterThan(1)
  expect(await exportCurrent()).not.toBe(cleanExport)

  await backgroundTab.click()
  await expect(page.locator('[data-renderer="looks"]')).toBeVisible()
  await expect(page.locator('[data-mbs-shader="true"]')).toHaveCount(0)
})

test('keeps the canvas toolbar clear of the mode switch', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear())
  for (const width of [1024, 1041, 1080, 1105, 1106, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
    const toolbar = await page.getByRole('group', {
      name: 'Canvas tools',
      exact: true,
    }).boundingBox()
    const modeSwitch = await page.getByRole('radiogroup', {
      name: 'Canvas mode',
      exact: true,
    }).boundingBox()
    expect(toolbar).not.toBeNull()
    expect(modeSwitch).not.toBeNull()
    const separated = toolbar!.x + toolbar!.width <= modeSwitch!.x
      || modeSwitch!.x + modeSwitch!.width <= toolbar!.x
      || toolbar!.y + toolbar!.height <= modeSwitch!.y
      || modeSwitch!.y + modeSwitch!.height <= toolbar!.y
    expect(separated).toBe(true)
    for (const name of ['Select', 'Hand', 'Fit view']) {
      await expect(page.getByRole('button', { name, exact: true }).locator('svg')).toHaveCount(1)
    }
  }
})

test('keeps 3D Look thumbnails generic when the live material changes', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear())
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  await page.getByRole('radio', { name: '3D', exact: true }).click()

  const thumbnails = page.locator('.lab-look-thumb[data-preview-mode="generic"]')
  await expect(thumbnails).toHaveCount(LOOKS.length)
  await expect.poll(async () =>
    thumbnails.evaluateAll((items) =>
      items.every((item) => (item as HTMLCanvasElement).toDataURL().length > 100),
    ),
  ).toBe(true)
  const before = await thumbnails.evaluateAll((items) =>
    items.map((item) => (item as HTMLCanvasElement).toDataURL()),
  )
  expect(new Set(before).size).toBeGreaterThan(4)

  await page.getByRole('radio', { name: 'Glass', exact: true }).click()
  await waitForAnimationFrames(page, 3)
  expect(await thumbnails.evaluateAll((items) =>
    items.map((item) => (item as HTMLCanvasElement).toDataURL()),
  )).toEqual(before)
})

test('redraws the deterministic 2D artwork after editing 3D', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear())
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  const canvas = page.locator('.lab-canvas')
  await waitForAnimationFrames(page, 3)
  const before = await canvas.screenshot()

  await page.getByRole('radio', { name: '3D', exact: true }).click()
  await page.getByRole('radio', { name: 'Glass', exact: true }).click()
  await page.getByRole('radio', { name: '2D', exact: true }).click()
  await waitForAnimationFrames(page, 3)

  const after = await canvas.screenshot()
  const difference = await pixelDifference(page, before, after)
  expect(difference.mean).toBeLessThan(0.01)
  expect(difference.changedFraction).toBe(0)
})

test('preserves independent 2D and 3D inspector scroll positions', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 640 })
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  const inspector = page.locator('.lab-inspector-body')

  await inspector.evaluate((element) => {
    element.scrollTop = 260
  })
  await page.getByRole('radio', { name: '3D', exact: true }).click()
  await expect.poll(() => inspector.evaluate((element) => element.scrollTop)).toBe(0)

  await inspector.evaluate((element) => {
    element.scrollTop = 180
  })
  await page.getByRole('radio', { name: '2D', exact: true }).click()
  await expect.poll(() => inspector.evaluate((element) => element.scrollTop)).toBe(260)
  await page.getByRole('radio', { name: '3D', exact: true }).click()
  await expect.poll(() => inspector.evaluate((element) => element.scrollTop)).toBe(180)
})

test('uses color weights as off state and adds swatches without replacing the mix', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()

  const colorSection = page.locator('.panel-section').filter({
    has: page.locator('.panel-heading', { hasText: /^Colors$/ }),
  }).first()
  await expect(colorSection.getByRole('button', { name: /^(On|Off)$/ })).toHaveCount(0)
  const primaryPack = colorSection.getByRole('radio', { name: 'Primary', exact: true })
  await expect(colorSection.getByRole('radio', { name: 'Custom', exact: true })).toHaveCount(0)
  await primaryPack.focus()
  await page.keyboard.press('ArrowRight')
  await expect(colorSection.getByRole('radio', { name: 'Neutrals', exact: true }))
    .toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Home')
  await expect(primaryPack).toHaveAttribute('aria-checked', 'true')
  const ratioInputs = colorSection.getByRole('spinbutton', { name: /weight/ })
  await ratioInputs.first().fill('0')
  await expect.poll(async () =>
    page.evaluate(() => {
      const recipe = JSON.parse(localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '{}')
      return recipe.palette?.mix?.[0]
    }),
  ).toMatchObject({ enabled: false, ratio: 0 })
  await expect(colorSection.getByText('Custom mix', { exact: true })).toBeVisible()
  await expect(ratioInputs).toHaveCount(3)
  await expect(ratioInputs.first()).toHaveValue('0')
  await ratioInputs.first().fill('10')
  await expect.poll(async () =>
    page.evaluate(() => {
      const recipe = JSON.parse(localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '{}')
      return recipe.palette?.mix?.[0]
    }),
  ).toMatchObject({ enabled: true, ratio: 10 })
  await ratioInputs.first().fill('0')
  await expect(ratioInputs).toHaveCount(3)

  const before = await page.evaluate(() => {
    const recipe = JSON.parse(localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '{}')
    return recipe.palette.mix as { color: string }[]
  })
  await colorSection.locator('summary', { hasText: 'Add color' }).click()
  await expect(colorSection.locator('.lab-approved-swatch')).toHaveCount(49)
  await expect(colorSection.locator('.lab-approved-results h3')).toHaveText([
    'Blues',
    'Cyans & teals',
    'Greens',
    'Yellows & oranges',
    'Reds & pinks',
    'Purples',
    'Neutrals',
  ])
  await expect(colorSection.getByRole('combobox')).toHaveCount(0)
  await expect(colorSection.getByRole('button', { name: 'Show more' })).toHaveCount(0)
  const swatch = colorSection.locator('.lab-approved-swatch:not(:disabled)').first()
  const addedColor = await swatch.getAttribute('title')
  await swatch.click()
  await expect(colorSection.getByRole('button', {
    name: `Approved color ${addedColor} added`,
    exact: true,
  })).toBeDisabled()

  await expect.poll(async () =>
    page.evaluate(() => {
      const recipe = JSON.parse(localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '{}')
      return {
        packId: recipe.palette?.packId,
        colors: recipe.palette?.mix?.map((item: { color: string }) => item.color),
      }
    }),
  ).toEqual({
    packId: 'custom',
    colors: [...before.map((item) => item.color), addedColor],
  })

  await page.reload()
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  await expect.poll(async () =>
    page.evaluate(() => {
      const recipe = JSON.parse(localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '{}')
      return {
        packId: recipe.palette?.packId,
        colors: recipe.palette?.mix?.map((item: { color: string }) => item.color),
      }
    }),
  ).toEqual({
    packId: 'custom',
    colors: [...before.map((item) => item.color), addedColor],
  })
  await expect(colorSection.getByText('Custom mix', { exact: true })).toBeVisible()
})

test('hides explicit palette role controls in 2D', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear())
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  const colorSection = page.locator('.panel-section').filter({
    has: page.locator('.panel-heading', { hasText: /^Colors$/ }),
  }).first()
  await expect(colorSection.getByText('Roles', { exact: true })).toHaveCount(0)
  await expect(colorSection.getByRole('button', {
    name: /^Change background color/,
  })).toHaveCount(0)
  await expect(colorSection.getByRole('button', {
    name: /^Change marks color/,
  })).toHaveCount(0)
})

test('opens a picker from a mix swatch and preserves its weight', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear())
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  const mixSwatch = page.getByRole('button', { name: /^Change mix color/ }).first()
  await mixSwatch.click()
  const picker = page.getByRole('dialog', { name: 'Mix color', exact: true })
  await expect(picker).toBeVisible()
  await picker.getByRole('radio', {
    name: 'Use approved color #FF5001',
    exact: true,
  }).click()

  await expect(picker).toHaveCount(0)
  await expect(mixSwatch).toBeFocused()
  await expect.poll(() => page.evaluate(() => {
    const palette = JSON.parse(
      localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '{}',
    ).palette
    return {
      packId: palette?.packId,
      color: palette?.mix?.[0]?.color,
      ratio: palette?.mix?.[0]?.ratio,
    }
  })).toEqual({ packId: 'custom', color: '#FF5001', ratio: 60 })

  await pressUndo(page)
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '{}')
      .palette?.mix?.[0]?.color,
  )).toBe('#0064E0')
})

test('supports keyboard slider control, reset, and immediate pagehide saves', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear())
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()

  const amount = page.getByRole('slider', { name: 'Amount', exact: true })
  await amount.focus()
  await page.keyboard.press('End')
  await expect(amount).toHaveValue('100')
  await amount.dblclick()
  await expect(amount).toHaveValue('0')
  await page.waitForTimeout(300)
  await amount.evaluate((element) => (element as HTMLInputElement).blur())
  await pressUndo(page)
  await expect(amount).toHaveValue('100')
  await amount.focus()
  await page.keyboard.press('r')
  await expect(amount).toHaveValue('0')
  await amount.evaluate((element) => (element as HTMLInputElement).blur())
  await pressUndo(page)
  await expect(amount).toHaveValue('100')

  await amount.evaluate((element) => {
    const input = element as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set
    setter?.call(input, '42')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    window.dispatchEvent(new PageTransitionEvent('pagehide'))
  })
  expect(await page.evaluate(() =>
    JSON.parse(localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '{}').motion?.amount,
  )).toBe(0.42)
})

test('settles slider history on pointer cancellation and window blur', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear())
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  const amount = page.getByRole('slider', { name: 'Amount', exact: true })
  const setAmount = (value: string) => amount.evaluate((element, nextValue) => {
    const input = element as HTMLInputElement
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
      ?.set?.call(input, nextValue)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)

  await setAmount('42')
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel')))
  await setAmount('70')
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))

  await pressUndo(page)
  await expect(amount).toHaveValue('42')
  await pressUndo(page)
  await expect(amount).toHaveValue('0')
})

test('respects reduced motion without discarding the saved motion settings', async ({ page }) => {
  const recipe = createDefaultBackgroundRecipe(2026)
  recipe.motion = {
    ...recipe.motion,
    enabled: true,
    amount: 0.8,
    speed: 1.2,
    loopSeconds: 6,
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript((savedRecipe) => {
    localStorage.setItem('mbs-bg-generator-autosave-v2', JSON.stringify(savedRecipe))
  }, recipe)
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()

  await expect(page.getByText('Reduce Motion is on', { exact: true })).toBeVisible()
  const amount = page.getByRole('slider', { name: 'Amount', exact: true })
  const energy = page.getByRole('slider', { name: 'Energy', exact: true })
  const loop = page.getByRole('slider', { name: 'Loop', exact: true })
  await expect(amount).toBeDisabled()
  await expect(energy).toBeDisabled()
  await expect(loop).toBeDisabled()

  const canvas = page.locator('.lab-canvas')
  const pausedFrame = await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL())
  await page.waitForTimeout(250)
  expect(await canvas.evaluate((element) =>
    (element as HTMLCanvasElement).toDataURL(),
  )).toBe(pausedFrame)

  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect(page.getByText('Reduce Motion is on', { exact: true })).toHaveCount(0)
  await expect(amount).toBeEnabled()
  await expect(energy).toBeEnabled()
  await expect(loop).toBeEnabled()
  await expect.poll(async () =>
    canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL()),
  ).not.toBe(pausedFrame)

  expect(await page.evaluate(() =>
    JSON.parse(localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '{}').motion,
  )).toMatchObject({ enabled: true, amount: 0.8, speed: 1.2, loopSeconds: 6 })
})

test('announces persistent storage failures', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Storage.prototype, 'setItem', {
      configurable: true,
      value: () => {
        throw new DOMException('Storage disabled', 'QuotaExceededError')
      },
    })
  })
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  await page.getByRole('radio', { name: 'Bold', exact: true }).click()
  await expect(page.locator('.lab-save-status.error')).toHaveText('Save failed')
})

test('announces failures while reading saved work', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Storage.prototype, 'getItem', {
      configurable: true,
      value: () => {
        throw new DOMException('Storage disabled', 'SecurityError')
      },
    })
  })
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  await expect(page.locator('.lab-save-status[role="alert"]')).toHaveText('Save failed')
})

test('keeps Reset all cancelled when Enter is pressed on Cancel', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear())
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  const bold = page.getByRole('radio', { name: 'Bold', exact: true })
  await bold.click()
  await page.getByRole('button', { name: 'Reset all', exact: true }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Reset all?', exact: true })
  await expect(dialog).toHaveAccessibleDescription(
    'Resets format, colors, Looks, motion, 2D framing, and 3D view.',
  )
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0)
  await expect(bold).toHaveAttribute('aria-checked', 'true')
})

test('offers a compact 3D palette and grouped approved colors', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear())
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  await page.getByRole('radio', { name: '3D', exact: true }).click()

  const quickColors = page.locator('.lab-material-quick-colors')
  await expect(quickColors.getByRole('radio')).toHaveCount(14)
  await expect(
    quickColors.getByRole('radio').first(),
  ).toHaveAttribute('title', '#0064E0')

  await page.getByRole('button', { name: 'Highlight', exact: true }).click()
  const approvedPicker = page.getByRole('dialog', {
    name: 'Material highlight color',
    exact: true,
  })
  await expect(approvedPicker).toBeVisible()
  await expect(approvedPicker.locator('.lab-approved-results h3')).toHaveText([
    'Blues',
    'Cyans & teals',
    'Greens',
    'Yellows & oranges',
    'Reds & pinks',
    'Purples',
    'Neutrals',
  ])
  await approvedPicker.getByRole('searchbox', { name: 'Search approved colors' }).fill('#FFFFFF')
  await expect(
    approvedPicker.getByRole('radio', { name: 'Use approved color #FFFFFF' }),
  ).toBeVisible()
})

test('processes the live 3D frame through canonical Canvas2D Looks and supports bypass', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    const url = message.location().url
    const blockedRemoteFont = url.startsWith('https://fonts.googleapis.com/')
    const emptyDevtoolsError = message.text() === 'undefined'
    if (message.type() === 'error' && !blockedRemoteFont && !emptyDevtoolsError) {
      errors.push(message.text())
    }
  })

  await page.setViewportSize({ width: 1440, height: 1400 })
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  const materialTab = page.getByRole('radio', { name: '3D', exact: true })
  await materialTab.click()

  const viewer = page.locator('[data-mbs-material-model="true"]')
  const modelCanvas = viewer.locator('.lab-material-model-canvas')
  const processedCanvas = viewer.locator('.lab-material-look-canvas')
  const screenshotView = async () => (
    await viewer.getAttribute('data-postprocess') === 'legacy-canvas2d-look'
      ? processedCanvas.screenshot()
      : modelCanvas.screenshot()
  )
  await expect(viewer).toHaveAttribute('data-model-status', 'ready')
  await expect(viewer).toHaveAttribute('data-look', 'off')
  await expect(viewer).toHaveAttribute('data-postprocess', 'raw')
  await expect(page.locator('[data-mbs-look-scope="3d-full-frame"]')).toBeVisible()
  await expect(page.locator('[data-mbs-material-look-overlay="true"]')).toHaveCount(0)
  await expect(viewer.locator('canvas')).toHaveCount(2)
  await expect(page.locator('.lab-look[aria-pressed="true"]')).toHaveCount(0)
  for (const look of LOOKS) {
    await expect(page.getByRole('button', { name: look, exact: true })).toBeVisible()
  }
  await waitForAnimationFrames(page, 3)
  const rawFrame = await screenshotView()

  const scanlinesButton = page.getByRole('button', { name: 'Scanlines', exact: true })
  await scanlinesButton.click()
  await expect(scanlinesButton).toHaveAttribute('aria-pressed', 'true')
  await expect(viewer).toHaveAttribute('data-look', 'scanlines')
  await expect(viewer).toHaveAttribute('data-postprocess', 'gpu-look')
  await page.getByRole('radio', { name: 'Clean', exact: true }).click()
  await expect(viewer).toHaveAttribute('data-material', 'clean')
  await expect(processedCanvas).toHaveAttribute('data-look', 'scanlines')
  await expect(processedCanvas).toHaveAttribute('data-render-status', 'ready')
  const scanlineFrame = await screenshotView()
  const compositeDifference = await pixelDifference(page, rawFrame, scanlineFrame)
  expect(compositeDifference.mean).toBeGreaterThan(5)
  expect(compositeDifference.edgeMean).toBeGreaterThan(3)
  expect(compositeDifference.centerMean).toBeGreaterThan(5)

  await scanlinesButton.click()
  await expect(scanlinesButton).toHaveAttribute('aria-pressed', 'false')
  await expect(viewer).toHaveAttribute('data-look', 'off')
  await expect(viewer).toHaveAttribute('data-postprocess', 'raw')
  await waitForAnimationFrames(page, 3)
  const bypassDifference = await pixelDifference(page, rawFrame, await screenshotView())
  expect(bypassDifference.mean).toBeLessThan(0.5)
  await expect.poll(async () =>
    page.evaluate(() =>
      JSON.parse(localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '{}')
        .materialLookOverlay?.enabled,
    ),
  ).toBe(false)

  const pixelsButton = page.getByRole('button', { name: 'Pixels', exact: true })
  await pixelsButton.click()
  await expect(viewer).toHaveAttribute('data-look', 'pixels')
  await expect(processedCanvas).toHaveAttribute('data-look', 'pixels')
  const cleanMaterialPixels = await screenshotView()
  const cleanMaterialHash = await processedCanvas.getAttribute('data-source-hash')
  await page.getByRole('radio', { name: 'Stainless Steel', exact: true }).click()
  await expect(viewer).toHaveAttribute('data-material', 'metal')
  await expect.poll(() => processedCanvas.getAttribute('data-source-hash')).not.toBe(cleanMaterialHash)
  const metalMaterialPixels = await screenshotView()
  const materialSourceDifference = await pixelDifference(
    page,
    cleanMaterialPixels,
    metalMaterialPixels,
  )
  // The alpha capture confines material-driven changes to the model instead
  // of counting background segmentation noise.
  expect(materialSourceDifference.changedFraction).toBeGreaterThan(0.01)
  expect(materialSourceDifference.centerMean).toBeGreaterThan(0.4)

  const beforeOrbit = await screenshotView()
  const beforeOrbitHash = await processedCanvas.getAttribute('data-source-hash')
  const viewerBox = await viewer.boundingBox()
  expect(viewerBox).not.toBeNull()
  await page.mouse.move(
    viewerBox!.x + viewerBox!.width / 2,
    viewerBox!.y + viewerBox!.height / 2,
  )
  await page.mouse.down({ button: 'left' })
  await page.mouse.move(
    viewerBox!.x + viewerBox!.width / 2 + 100,
    viewerBox!.y + viewerBox!.height / 2 + 24,
    { steps: 6 },
  )
  await page.mouse.up({ button: 'left' })
  await expect.poll(() => processedCanvas.getAttribute('data-source-hash')).not.toBe(beforeOrbitHash)
  const afterOrbit = await screenshotView()
  const orbitDifference = await pixelDifference(page, beforeOrbit, afterOrbit)
  expect(orbitDifference.changedFraction).toBeGreaterThan(0.05)
  expect(orbitDifference.centerMean).toBeGreaterThan(2)
  await expect(viewer).toHaveAttribute('data-postprocess', 'gpu-look')

  const trailsButton = page.getByRole('button', { name: 'Trails', exact: true })
  await trailsButton.click()
  await expect(trailsButton).toHaveAttribute('aria-pressed', 'true')
  await expect(viewer).toHaveAttribute('data-look', 'trails')
  await expect(processedCanvas).toHaveAttribute('data-look', 'trails')
  const trailsFrame = await screenshotView()
  const modesDifference = await pixelDifference(page, afterOrbit, trailsFrame)
  expect(modesDifference.changedFraction).toBeGreaterThan(0.1)
  await expect.poll(async () =>
    page.evaluate(() => {
      const recipe = JSON.parse(localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '{}')
      return {
        enabled: recipe.materialLookOverlay?.enabled,
        look: recipe.look?.id,
      }
    }),
  ).toEqual({ enabled: true, look: 'trails' })
  const weaveButton = page.getByRole('button', { name: 'Weave', exact: true })
  await weaveButton.click()
  await expect(viewer).toHaveAttribute('data-look', 'weave')
  await expect(processedCanvas).toHaveAttribute('data-look', 'weave')
  await expect(processedCanvas).toHaveAttribute('data-render-status', 'ready')
  const weaveDifference = await pixelDifference(page, rawFrame, await screenshotView())
  expect(weaveDifference.mean).toBeGreaterThan(1)
  expect(weaveDifference.changedFraction).toBeGreaterThan(0.02)
  await resetAll(page)
  await expect(viewer).toHaveAttribute('data-material', 'clean')
  await expect(viewer).toHaveAttribute('data-look', 'off')
  await expect(viewer).toHaveAttribute('data-postprocess', 'raw')
  await scanlinesButton.click()
  await expect(trailsButton).toHaveAttribute('aria-pressed', 'false')
  await expect(scanlinesButton).toHaveAttribute('aria-pressed', 'true')
  await expect(viewer).toHaveAttribute('data-look', 'scanlines')
  await expect(viewer).toHaveAttribute('data-postprocess', 'gpu-look')
  await page.getByRole('radio', { name: 'Stainless Steel', exact: true }).click()
  await expect(viewer).toHaveAttribute('data-material', 'metal')
  await page.mouse.move(
    viewerBox!.x + viewerBox!.width / 2,
    viewerBox!.y + viewerBox!.height / 2,
  )
  await page.mouse.down({ button: 'left' })
  await page.mouse.move(
    viewerBox!.x + viewerBox!.width / 2 + 52,
    viewerBox!.y + viewerBox!.height / 2 - 18,
    { steps: 4 },
  )
  await page.mouse.up({ button: 'left' })
  await waitForAnimationFrames(page, 40)
  await page.locator('.lab-side-right').evaluate((sidebar) => {
    sidebar.scrollTop = 0
  })
  await page.screenshot({
    path: 'test-results/3d-gpu-look-scanlines.png',
    fullPage: true,
  })

  expect(errors).toEqual([])
})

test('keeps every V1 and V2 3D Look opaque and patterned across the full frame', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.clear())
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  await page.getByRole('radio', { name: '3D', exact: true }).click()
  const canvas = page.locator('.lab-material-look-canvas')

  for (const version of ['V1', 'V2'] as const) {
    await page.getByRole('tab', { name: version, exact: true }).click()
    for (const look of LOOKS) {
      await page.getByRole('button', { name: look, exact: true }).click()
      await expect(canvas).toHaveAttribute('data-render-status', 'ready')
      await waitForAnimationFrames(page, 3)
      const result = await canvas.evaluate((element: HTMLCanvasElement) => {
        const context = element.getContext('2d')
        if (!context) throw new Error('Material Look context unavailable')
        const { width, height } = element
        const pixels = context.getImageData(0, 0, width, height).data
        let transparent = 0
        let edgeVariation = 0
        let edgeSamples = 0
        const luma = (offset: number) =>
          pixels[offset] * 0.2126
          + pixels[offset + 1] * 0.7152
          + pixels[offset + 2] * 0.0722
        for (let y = 4; y < height - 4; y += 4) {
          for (let x = 4; x < width - 4; x += 4) {
            const offset = (y * width + x) * 4
            if (pixels[offset + 3] < 255) transparent += 1
            if (
              x < width * 0.15
              || x > width * 0.85
              || y < height * 0.15
              || y > height * 0.85
            ) {
              edgeVariation += Math.abs(
                luma(offset) - luma((y * width + x + 4) * 4),
              )
              edgeSamples += 1
            }
          }
        }
        return {
          transparent,
          edgeVariation: edgeVariation / edgeSamples,
        }
      })
      expect(
        result.transparent,
        `${version} ${look} must cover the full material frame`,
      ).toBe(0)
      expect(
        result.edgeVariation,
        `${version} ${look} must pattern the material-frame edges`,
      ).toBeGreaterThan(0.2)
    }
  }
})

test('recovers from a failed 3D model load and preserves focus', async ({ page }) => {
  let failModel = true
  await page.route('**/api/material-model', async (route) => {
    if (failModel) await route.abort()
    else await route.continue()
  })
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  await page.getByRole('radio', { name: '3D', exact: true }).click()
  const viewer = page.locator('[data-mbs-material-model="true"]')
  await expect(viewer).toHaveAttribute('data-model-status', 'error')

  failModel = false
  await viewer.getByRole('button', { name: 'Retry 3D', exact: true }).click()
  await expect(viewer).toBeFocused()
  await expect(viewer).toHaveAttribute('data-model-status', 'ready')
})

test('middle-drags pan the 3D viewer without taking over outer canvas panning', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  await page.getByRole('radio', { name: '3D', exact: true }).click()

  const viewer = page.locator('[data-mbs-material-model="true"]')
  const canvas = viewer.locator('.lab-material-model-canvas')
  const stack = page.locator('.lab-canvas-stack')
  const screenshotView = () => canvas.screenshot({
    style: '.lab-material-model-actions { visibility: hidden !important; }',
  })
  await expect(viewer).toHaveAttribute('data-model-status', 'ready')
  await waitForAnimationFrames(page, 2)

  const initialView = await screenshotView()
  const initialBounds = await foregroundBounds(page, initialView)
  const initialStackBox = await stack.boundingBox()
  const viewerBox = await viewer.boundingBox()
  const resetView = viewer.getByRole('button', { name: 'Reset view', exact: true })
  expect(initialStackBox).not.toBeNull()
  expect(viewerBox).not.toBeNull()

  await page.mouse.move(
    viewerBox!.x + viewerBox!.width / 2,
    viewerBox!.y + viewerBox!.height / 2,
  )
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(
    viewerBox!.x + viewerBox!.width / 2 + 60,
    viewerBox!.y + viewerBox!.height / 2,
    { steps: 4 },
  )
  await page.mouse.up({ button: 'middle' })

  await waitForAnimationFrames(page, 40)
  const pannedView = await screenshotView()
  expect(pannedView.equals(initialView)).toBe(false)
  const pannedBounds = await foregroundBounds(page, pannedView)
  const leftShift = pannedBounds.left - initialBounds.left
  const rightShift = pannedBounds.right - initialBounds.right
  expect(Math.abs(leftShift)).toBeGreaterThan(20)
  expect(Math.abs(leftShift - rightShift)).toBeLessThanOrEqual(2)
  const stackBoxAfterViewerPan = await stack.boundingBox()
  expect(stackBoxAfterViewerPan).not.toBeNull()
  expect(stackBoxAfterViewerPan!.x).toBeCloseTo(initialStackBox!.x, 0)
  expect(stackBoxAfterViewerPan!.y).toBeCloseTo(initialStackBox!.y, 0)

  await resetView.click()
  await waitForAnimationFrames(page, 2)
  const resetBounds = await foregroundBounds(page, await screenshotView())
  expect(Math.max(
    Math.abs(resetBounds.left - initialBounds.left),
    Math.abs(resetBounds.right - initialBounds.right),
    Math.abs(resetBounds.top - initialBounds.top),
    Math.abs(resetBounds.bottom - initialBounds.bottom),
  )).toBeLessThanOrEqual(2)

  const wrap = page.locator('.lab-canvas-wrap')
  const wrapBox = await wrap.boundingBox()
  expect(wrapBox).not.toBeNull()
  await page.mouse.move(wrapBox!.x + 12, wrapBox!.y + 12)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(wrapBox!.x + 40, wrapBox!.y + 30, { steps: 3 })
  await page.mouse.up({ button: 'middle' })

  await waitForAnimationFrames(page, 2)
  const stackBoxAfterOuterPan = await stack.boundingBox()
  expect(stackBoxAfterOuterPan).not.toBeNull()
  expect(stackBoxAfterOuterPan!.x).toBeCloseTo(initialStackBox!.x + 28, 0)
  expect(stackBoxAfterOuterPan!.y).toBeCloseTo(initialStackBox!.y + 18, 0)
})

test('pointer, wheel, and keyboard 3D framing each create one history entry', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  await page.getByRole('radio', { name: '3D', exact: true }).click()

  const viewer = page.locator('[data-mbs-material-model="true"]')
  const canvas = viewer.locator('.lab-material-model-canvas')
  const resetView = viewer.getByRole('button', { name: 'Reset view', exact: true })
  const materialPreset = () => page.evaluate(() => {
    const recipe = JSON.parse(localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '{}')
      return recipe.transforms?.material?.preset ?? 'full'
  })
  const screenshotView = () => canvas.screenshot({
    style: '.lab-material-model-actions { visibility: hidden !important; }',
  })
  await expect(viewer).toHaveAttribute('data-model-status', 'ready')
  await expect.poll(materialPreset).toBe('full')
  await waitForAnimationFrames(page, 2)

  const initialView = await screenshotView()
  const initialBounds = await foregroundBounds(page, initialView)
  const viewerBox = await viewer.boundingBox()
  expect(viewerBox).not.toBeNull()
  const centerX = viewerBox!.x + viewerBox!.width / 2
  const centerY = viewerBox!.y + viewerBox!.height / 2

  await page.mouse.move(centerX, centerY)
  await page.mouse.down()
  await page.mouse.move(centerX + 80, centerY, { steps: 4 })
  await page.mouse.up()
  await waitForAnimationFrames(page, 40)
  await expect.poll(materialPreset).toBe('free')
  expect((await screenshotView()).equals(initialView)).toBe(false)

  await pressUndo(page)
  await expect.poll(materialPreset).toBe('full')
  await resetView.click()
  await waitForAnimationFrames(page, 2)
  const orbitResetBounds = await foregroundBounds(page, await screenshotView())
  expect(Math.max(
    Math.abs(orbitResetBounds.left - initialBounds.left),
    Math.abs(orbitResetBounds.right - initialBounds.right),
    Math.abs(orbitResetBounds.top - initialBounds.top),
    Math.abs(orbitResetBounds.bottom - initialBounds.bottom),
  )).toBeLessThanOrEqual(2)

  await page.mouse.move(centerX, centerY)
  for (let index = 0; index < 4; index += 1) await page.mouse.wheel(0, -120)
  await expect.poll(materialPreset).toBe('free')
  expect((await screenshotView()).equals(initialView)).toBe(false)

  await pressUndo(page)
  await expect.poll(materialPreset).toBe('full')
  await resetView.click()
  await waitForAnimationFrames(page, 2)
  const zoomResetBounds = await foregroundBounds(page, await screenshotView())
  expect(Math.max(
    Math.abs(zoomResetBounds.left - initialBounds.left),
    Math.abs(zoomResetBounds.right - initialBounds.right),
    Math.abs(zoomResetBounds.top - initialBounds.top),
    Math.abs(zoomResetBounds.bottom - initialBounds.bottom),
  )).toBeLessThanOrEqual(2)

  await viewer.focus()
  await page.keyboard.press('ArrowRight')
  await waitForAnimationFrames(page, 40)
  await expect.poll(materialPreset).toBe('free')
  expect((await screenshotView()).equals(initialView)).toBe(false)

  await pressUndo(page)
  await expect.poll(materialPreset).toBe('full')
})

test('restores the same orthographic camera framing after reload', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  await page.getByRole('radio', { name: '3D', exact: true }).click()
  let viewer = page.locator('[data-mbs-material-model="true"]')
  await expect(viewer).toHaveAttribute('data-model-status', 'ready')
  const viewerBox = await viewer.boundingBox()
  expect(viewerBox).not.toBeNull()
  await page.mouse.move(
    viewerBox!.x + viewerBox!.width / 2,
    viewerBox!.y + viewerBox!.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    viewerBox!.x + viewerBox!.width / 2 + 84,
    viewerBox!.y + viewerBox!.height / 2 + 20,
    { steps: 5 },
  )
  await page.mouse.up()
  await expect.poll(async () =>
    page.evaluate(() =>
      JSON.parse(localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '{}')
        .material?.camera,
    ),
  ).not.toBeNull()
  await page.waitForTimeout(300)
  const before = await viewer.locator('.lab-material-model-canvas').screenshot()
  const beforeBounds = await foregroundBounds(page, before)

  await page.reload()
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  await expect(page.getByRole('radio', { name: '2D', exact: true }))
    .toHaveAttribute('aria-checked', 'true')
  await page.getByRole('radio', { name: '3D', exact: true }).click()
  viewer = page.locator('[data-mbs-material-model="true"]')
  await expect(viewer).toHaveAttribute('data-model-status', 'ready')
  await waitForAnimationFrames(page, 3)
  await page.waitForTimeout(300)
  const afterBounds = await foregroundBounds(
    page,
    await viewer.locator('.lab-material-model-canvas').screenshot(),
  )
  expect(Math.max(
    Math.abs(afterBounds.left - beforeBounds.left),
    Math.abs(afterBounds.right - beforeBounds.right),
    Math.abs(afterBounds.top - beforeBounds.top),
    Math.abs(afterBounds.bottom - beforeBounds.bottom),
  )).toBeLessThanOrEqual(2)
})

test('keeps dragged 2D artwork moved after capture release and render cycles', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear())
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  await enlargeArtworkFromCenter(page)

  const frame = page.locator('.lab-subject-frame')
  const captureTarget = page.locator('.lab-canvas-wrap')
  await captureTarget.evaluate((element) => {
    element.addEventListener('pointerdown', (event) => {
      ;(window as typeof window & { __mbsSubjectPointerId?: number }).__mbsSubjectPointerId =
        (event as PointerEvent).pointerId
    }, { capture: true, once: true })
  })
  const initialBox = await frame.boundingBox()
  expect(initialBox).not.toBeNull()
  const dragStart = {
    x: initialBox!.x + initialBox!.width / 2,
    y: initialBox!.y + initialBox!.height / 2,
  }

  await page.mouse.move(dragStart.x, dragStart.y)
  await page.mouse.down()
  await page.mouse.move(dragStart.x + 72, dragStart.y + 24, { steps: 4 })
  const movedBox = await frame.boundingBox()
  expect(movedBox).not.toBeNull()
  expect(movedBox!.x - initialBox!.x).toBeGreaterThan(60)

  const hadCapture = await captureTarget.evaluate((element) => {
    const pointerId =
      (window as typeof window & { __mbsSubjectPointerId?: number }).__mbsSubjectPointerId
    if (pointerId === undefined) return false
    const captured = element.hasPointerCapture(pointerId)
    element.releasePointerCapture(pointerId)
    return captured
  })
  expect(hadCapture).toBe(true)
  await page.mouse.up()

  await expect.poll(async () =>
    page.evaluate(() => {
      const recipe = JSON.parse(localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '{}')
      return recipe.transforms?.background?.x ?? 0
    }),
  ).toBeGreaterThan(0.1)
  await waitForAnimationFrames(page, 4)
  await page.waitForTimeout(450)

  const settledBox = await frame.boundingBox()
  expect(settledBox).not.toBeNull()
  expect(settledBox!.x).toBeCloseTo(movedBox!.x, 0)
  expect(settledBox!.y).toBeCloseTo(movedBox!.y, 0)
  await expect.poll(async () =>
    page.evaluate(() => {
      const recipe = JSON.parse(localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '{}')
      return {
        backgroundPreset: recipe.transforms?.background?.preset,
        backgroundX: recipe.transforms?.background?.x,
        materialX: recipe.transforms?.material?.x,
      }
    }),
  ).toMatchObject({
    backgroundPreset: 'free',
    materialX: 0,
  })
})

test('cancels an active 2D gesture before switching to 3D', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear())
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  await enlargeArtworkFromCenter(page)
  await expect.poll(async () =>
    page.evaluate(() =>
      JSON.parse(localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '{}')
        .transforms?.background?.scale,
    ),
  ).toBeCloseTo(1.5)
  const before = await page.evaluate(() => {
    const recipe = JSON.parse(localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '{}')
    return recipe.transforms.background
  })
  const frame = page.locator('.lab-subject-frame')
  const box = await frame.boundingBox()
  expect(box).not.toBeNull()

  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.down()
  await page.mouse.move(box!.x + box!.width / 2 + 50, box!.y + box!.height / 2)
  await page.locator('[data-mode="material"]').evaluate((element) =>
    (element as HTMLButtonElement).click(),
  )
  await page.mouse.up()
  await expect(page.getByRole('radio', { name: '3D', exact: true }))
    .toHaveAttribute('aria-checked', 'true')
  await expect.poll(async () =>
    page.evaluate(() =>
      JSON.parse(localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '{}').mode,
    ),
  ).toBe('background')
  expect(await page.evaluate(() => {
    const recipe = JSON.parse(localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '{}')
    return {
      background: recipe.transforms.background,
      material: recipe.transforms.material,
    }
  })).toEqual({
    background: before,
    material: {
      preset: 'full',
      x: 0,
      y: 0,
      scale: 0.95,
      rotation: 0,
    },
  })
})

test('deselects and reselects the 2D artwork without recipe edits', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear())
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()

  const wrap = page.locator('.lab-canvas-wrap')
  const artboard = page.locator('.lab-canvas-stack')
  const frame = page.locator('.lab-subject-frame')
  const frameBox = await frame.boundingBox()
  const artboardBox = await artboard.boundingBox()
  expect(frameBox).not.toBeNull()
  expect(artboardBox).not.toBeNull()

  // The artwork is one transformed canvas layer. Workspace outside the
  // artboard is blank selection space, while its center reselects the artwork.
  await page.mouse.click(artboardBox!.x - 12, artboardBox!.y + 20)
  await expect(frame).toHaveCount(0)
  await pressUndo(page)
  await expect(frame).toHaveCount(0)

  const artworkCenter = {
    x: frameBox!.x + frameBox!.width / 2,
    y: frameBox!.y + frameBox!.height / 2,
  }
  await page.mouse.click(artworkCenter.x, artworkCenter.y)
  await expect(frame).toBeVisible()
  const selectTool = page.getByRole('button', { name: 'Select', exact: true })
  await selectTool.focus()
  await page.keyboard.press('Escape')
  await expect(frame).toHaveCount(0)
  await wrap.press('v')
  await expect(frame).toBeVisible()
  await page.getByRole('button', { name: 'Hand', exact: true }).click()
  await wrap.press('ArrowRight')
  await selectTool.click()

  // Clicking blank canvas only changes ephemeral selection: it does not pan,
  // push history, or write a deterministic recipe.
  await page.mouse.click(artboardBox!.x - 12, artboardBox!.y + 20)
  await expect(frame).toHaveCount(0)
  const afterBlankBox = await artboard.boundingBox()
  expect(afterBlankBox?.x).toBeCloseTo(artboardBox!.x, 1)
  expect(afterBlankBox?.y).toBeCloseTo(artboardBox!.y, 1)

  await wrap.press('ArrowRight')
  await page.waitForTimeout(450)
  expect(await page.evaluate(() =>
    localStorage.getItem('mbs-bg-generator-autosave-v2'),
  )).toBeNull()

})

test('translates the complete 2D artwork identically in preview and PNG export', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear())
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  await expect(page.getByText('Transform', { exact: true })).toHaveCount(0)
  await waitForAnimationFrames(page, 3)
  await enlargeArtworkFromCenter(page)

  const canvas = page.locator('.lab-canvas')
  const frame = page.locator('.lab-subject-frame')
  const initialFrame = await frame.boundingBox()
  expect(initialFrame).not.toBeNull()
  const previewBefore = await canvas.evaluate((element) =>
    (element as HTMLCanvasElement).toDataURL(),
  )
  const exportPng = () => page.evaluate(async () => {
    const hook = (window as typeof window & {
      __lbsLabExportPng?: () => Promise<string>
    }).__lbsLabExportPng
    if (!hook) throw new Error('Dev export hook unavailable')
    return hook()
  })
  const exportBefore = await exportPng()

  const dragStart = {
    x: initialFrame!.x + initialFrame!.width / 2,
    y: initialFrame!.y + initialFrame!.height / 2,
  }
  const initialArtboard = await page.locator('.lab-canvas-stack').boundingBox()
  expect(initialArtboard).not.toBeNull()
  const screenShift = initialArtboard!.width * 0.1
  await page.mouse.move(dragStart.x, dragStart.y)
  await page.mouse.down()
  await page.mouse.move(dragStart.x + screenShift, dragStart.y)
  await page.mouse.up()
  await expect.poll(async () =>
    page.evaluate(() => {
      const recipe = JSON.parse(localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '{}')
      return recipe.transforms?.background?.x
    }),
  ).toBeCloseTo(0.2, 5)
  await waitForAnimationFrames(page, 3)

  const movedFrame = await frame.boundingBox()
  expect(movedFrame).not.toBeNull()
  const artboard = await page.locator('.lab-canvas-stack').boundingBox()
  expect(artboard).not.toBeNull()
  expect(movedFrame!.x - initialFrame!.x).toBeCloseTo(artboard!.width * 0.1, 1)

  const previewAfter = await canvas.evaluate((element) =>
    (element as HTMLCanvasElement).toDataURL(),
  )
  const previewWidth = await canvas.evaluate((element) => (element as HTMLCanvasElement).width)
  const previewShift = await shiftedPixelDifference(
    page,
    previewBefore,
    previewAfter,
    previewWidth * 0.1,
  )
  expect(previewShift).toEqual({ mismatchedFraction: 0, maxDelta: 0 })

  const exportAfter = await exportPng()
  const exportShift = await shiftedPixelDifference(page, exportBefore, exportAfter, 384)
  // Dense line textures can round one channel by one value at transformed
  // clip boundaries; the separate max-delta assertion keeps that harmless.
  expect(exportShift.mismatchedFraction).toBeLessThan(0.012)
  expect(exportShift.maxDelta).toBeLessThanOrEqual(1)
  expect(exportAfter).not.toBe(exportBefore)

  await pressUndo(page)
  await waitForAnimationFrames(page, 2)
  expect(await exportPng()).toBe(exportBefore)
  await pressRedo(page)
  await waitForAnimationFrames(page, 2)
  expect(await exportPng()).toBe(exportAfter)
})

test('snaps moved artwork to all canvas edges at multiple zoom levels', async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 1100 })
  await page.addInitScript(() => localStorage.clear())
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  await waitForAnimationFrames(page, 2)
  await enlargeArtworkFromCenter(page)

  const frame = page.locator('.lab-subject-frame')
  const cases = [
    { edge: 'left' as const, axis: 'x' as const, side: -1 },
    { edge: 'right' as const, axis: 'x' as const, side: 1 },
    { edge: 'top' as const, axis: 'y' as const, side: -1 },
    { edge: 'bottom' as const, axis: 'y' as const, side: 1 },
  ]

  for (let zoomLevel = 0; zoomLevel < 2; zoomLevel += 1) {
    if (zoomLevel > 0) {
      await page.locator('.lab-canvas-wrap').press('+')
      await waitForAnimationFrames(page, 2)
    }
    for (const item of cases) {
      const artboard = await page.locator('.lab-canvas-stack').boundingBox()
      const before = await frame.boundingBox()
      expect(artboard).not.toBeNull()
      expect(before).not.toBeNull()
      const start = {
        x: before!.x + before!.width / 2,
        y: before!.y + before!.height / 2,
      }
      let dx = item.axis === 'x' ? item.side * 20 : 20
      let dy = item.axis === 'y' ? item.side * 20 : 20
      if (item.edge === 'left') dx = artboard!.x + 4 - before!.x
      if (item.edge === 'right') {
        dx = artboard!.x + artboard!.width - 4 - (before!.x + before!.width)
      }
      if (item.edge === 'top') dy = artboard!.y + 4 - before!.y
      if (item.edge === 'bottom') {
        dy = artboard!.y + artboard!.height - 4 - (before!.y + before!.height)
      }

      await page.mouse.move(start.x, start.y)
      await page.mouse.down()
      await page.mouse.move(start.x + dx, start.y + dy)
      const snapped = await frame.boundingBox()
      expect(snapped).not.toBeNull()
      const actualEdge = item.edge === 'left' || item.edge === 'top'
        ? snapped![item.axis === 'x' ? 'x' : 'y']
        : snapped![item.axis === 'x' ? 'x' : 'y']
          + snapped![item.axis === 'x' ? 'width' : 'height']
      const targetEdge = item.edge === 'left' || item.edge === 'top'
        ? artboard![item.axis === 'x' ? 'x' : 'y']
        : artboard![item.axis === 'x' ? 'x' : 'y']
          + artboard![item.axis === 'x' ? 'width' : 'height']
      expect(actualEdge).toBeCloseTo(targetEdge, 1)
      await expect(page.locator(`.lab-snap-guide.${item.axis === 'x' ? 'vertical' : 'horizontal'}`))
        .toHaveCount(1)
      await expect(page.locator(`.lab-snap-guide.${item.axis === 'x' ? 'horizontal' : 'vertical'}`))
        .toHaveCount(0)
      await page.mouse.up()
      await pressUndo(page)
      await waitForAnimationFrames(page, 1)
    }
  }
})

test('snaps scaled artwork corners to all canvas edges at multiple zoom levels', async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 1100 })
  await page.addInitScript(() => localStorage.clear())
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  await waitForAnimationFrames(page, 2)
  await enlargeArtworkFromCenter(page)

  const frame = page.locator('.lab-subject-frame')
  const corners = [
    { corner: 'nw', xEdge: 'left' as const, yEdge: 'top' as const },
    { corner: 'ne', xEdge: 'right' as const, yEdge: 'top' as const },
    { corner: 'sw', xEdge: 'left' as const, yEdge: 'bottom' as const },
    { corner: 'se', xEdge: 'right' as const, yEdge: 'bottom' as const },
  ]

  for (let zoomLevel = 0; zoomLevel < 2; zoomLevel += 1) {
    if (zoomLevel > 0) {
      await page.locator('.lab-canvas-wrap').press('+')
      await waitForAnimationFrames(page, 2)
    }
    for (const item of corners) {
      const artboard = await page.locator('.lab-canvas-stack').boundingBox()
      const beforeScale = await frame.boundingBox()
      const handle = await page
        .locator(`.lab-transform-handle.corner-${item.corner}`)
        .boundingBox()
      expect(artboard).not.toBeNull()
      expect(handle).not.toBeNull()
      const target = {
        x: item.xEdge === 'left'
          ? artboard!.x + 4
          : artboard!.x + artboard!.width - 4,
        y: item.yEdge === 'top'
          ? artboard!.y + 4
          : artboard!.y + artboard!.height - 4,
      }
      if (zoomLevel > 0) await page.keyboard.down('Shift')
      await page.mouse.move(
        handle!.x + handle!.width / 2,
        handle!.y + handle!.height / 2,
      )
      await page.mouse.down()
      await page.mouse.move(target.x, target.y)
      const snapped = await frame.boundingBox()
      expect(snapped).not.toBeNull()
      const actualX = item.xEdge === 'left' ? snapped!.x : snapped!.x + snapped!.width
      const actualY = item.yEdge === 'top' ? snapped!.y : snapped!.y + snapped!.height
      const expectedX = item.xEdge === 'left'
        ? artboard!.x
        : artboard!.x + artboard!.width
      const expectedY = item.yEdge === 'top'
        ? artboard!.y
        : artboard!.y + artboard!.height
      expect(actualX).toBeCloseTo(expectedX, 1)
      expect(actualY).toBeCloseTo(expectedY, 1)
      await expect(page.locator('.lab-snap-guide.vertical')).toHaveCount(1)
      await expect(page.locator('.lab-snap-guide.horizontal')).toHaveCount(1)
      await page.mouse.up()
      if (zoomLevel > 0) await page.keyboard.up('Shift')
      await pressUndo(page)
      await waitForAnimationFrames(page, 1)
      const restored = await frame.boundingBox()
      expect(restored?.x).toBeCloseTo(beforeScale!.x, 1)
      expect(restored?.y).toBeCloseTo(beforeScale!.y, 1)
      expect(restored?.width).toBeCloseTo(beforeScale!.width, 1)
      expect(restored?.height).toBeCloseTo(beforeScale!.height, 1)
    }
  }
})

test('directly moves artwork while keeping mode transforms independent', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  await enlargeArtworkFromCenter(page)

  const frame = page.locator('.lab-subject-frame')
  const frameBox = await frame.boundingBox()
  expect(frameBox).not.toBeNull()
  const dragStart = {
    x: frameBox!.x + frameBox!.width / 2,
    y: frameBox!.y + frameBox!.height / 2,
  }
  await page.mouse.move(dragStart.x, dragStart.y)
  await page.mouse.down()
  await page.mouse.move(
    dragStart.x + 60,
    dragStart.y + 20,
    { steps: 4 },
  )
  await page.mouse.up()

  await expect.poll(async () =>
    page.evaluate(() => {
      const recipe = JSON.parse(localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '{}')
      return recipe.transforms?.background?.x
    }),
  ).not.toBe(0)

  await expect(page.locator('.lab-rotation-handle')).toHaveCount(0)
  await expect(page.locator('.lab-rotation-zone')).toHaveCount(4)
  const movedFrameBox = await frame.boundingBox()
  const rotateZoneBox = await page.locator('.lab-rotation-zone.corner-nw').boundingBox()
  expect(movedFrameBox).not.toBeNull()
  expect(rotateZoneBox).not.toBeNull()
  await page.mouse.move(
    rotateZoneBox!.x + rotateZoneBox!.width / 2,
    rotateZoneBox!.y + rotateZoneBox!.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    movedFrameBox!.x + 30,
    movedFrameBox!.y + movedFrameBox!.height / 2,
    { steps: 4 },
  )
  await page.mouse.up()
  await expect.poll(async () =>
    page.evaluate(() => {
      const recipe = JSON.parse(localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '{}')
      return Math.abs(recipe.transforms?.background?.rotation ?? 0)
    }),
  ).toBeGreaterThan(1)

  await page.getByRole('radio', { name: '3D', exact: true }).click()
  await page.getByRole('radio', { name: 'Glass', exact: true }).click()
  await expect.poll(async () =>
    page.evaluate(() => {
      const recipe = JSON.parse(localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '{}')
      return {
        background: recipe.transforms?.background?.x,
        material: recipe.transforms?.material?.x,
      }
    }),
  ).toMatchObject({ material: 0 })

  await page.getByRole('radio', { name: '2D', exact: true }).click()
  await expect.poll(async () =>
    page.evaluate(() => {
      const recipe = JSON.parse(localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '{}')
      return recipe.transforms?.background?.x
    }),
  ).not.toBe(0)
})

test('supports undoable keyboard scale and rotation', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear())
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()

  const scale = page.getByRole('slider', { name: 'Artwork scale', exact: true })
  const originalScale = await scale.getAttribute('aria-valuenow')
  await scale.focus()
  await page.keyboard.down('ArrowUp')
  await page.waitForTimeout(50)
  await scale.dispatchEvent('keydown', { key: 'ArrowUp', repeat: true })
  await page.keyboard.up('ArrowUp')
  await expect(scale).not.toHaveAttribute('aria-valuenow', originalScale ?? '')
  await pressUndo(page)
  await expect(scale).toHaveAttribute('aria-valuenow', originalScale ?? '')

  const rotate = page.getByRole('slider', { name: 'Artwork rotation', exact: true })
  await rotate.focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () =>
    page.evaluate(() =>
      JSON.parse(localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '{}')
        .transforms?.background?.rotation,
    ),
  ).toBe(1)
  await rotate.evaluate((element) => (element as HTMLButtonElement).blur())
  await pressUndo(page)
})

test('exports both modes as exact 4K PNGs', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()

  const formatSection = page.getByRole('region', { name: 'Format', exact: true })
  const exportSection = page.getByRole('region', { name: 'Export', exact: true })
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toHaveCount(1)
  await expect(formatSection.getByRole('radiogroup', { name: 'Aspect', exact: true })).toBeVisible()
  await expect(
    formatSection.getByRole('group', { name: 'Export resolution', exact: true }),
  ).toHaveCount(0)
  await expect(formatSection.getByText(/^Current output:/)).toHaveCount(0)
  await expect(
    exportSection.getByRole('group', { name: 'Export resolution', exact: true }),
  ).toHaveCount(0)
  await expect(exportSection.locator('input')).toHaveCount(0)
  await expect(exportSection.getByRole('spinbutton')).toHaveCount(0)

  const backgroundDownloadPromise = page.waitForEvent('download')
  await exportSection.getByRole('button', { name: 'Export', exact: true }).click()
  const backgroundDownload = await backgroundDownloadPromise
  const backgroundPath = await backgroundDownload.path()
  expect(backgroundPath).not.toBeNull()
  expect(backgroundDownload.suggestedFilename()).toContain('mbs-background-')
  const backgroundPng = await readFile(backgroundPath!)

  await page.getByRole('radio', { name: '3D', exact: true }).click()
  await expect(page.locator('[data-mbs-material-model="true"]'))
    .toHaveAttribute('data-model-status', 'ready')
  const materialDownloadPromise = page.waitForEvent('download')
  await exportSection.getByRole('button', { name: 'Export', exact: true }).click()
  const materialDownload = await materialDownloadPromise
  const materialPath = await materialDownload.path()
  expect(materialPath).not.toBeNull()
  expect(materialDownload.suggestedFilename()).toContain('mbs-material-')
  const materialPng = await readFile(materialPath!)

  for (const png of [backgroundPng, materialPng]) {
    expect(png.subarray(1, 4).toString()).toBe('PNG')
    expect(png.readUInt32BE(16)).toBe(3840)
    expect(png.readUInt32BE(20)).toBe(2160)
  }
  expect(materialPng.equals(backgroundPng)).toBe(false)

  const viewer = page.locator('[data-mbs-material-model="true"]')
  const viewerBox = await viewer.boundingBox()
  expect(viewerBox).not.toBeNull()
  await page.mouse.move(
    viewerBox!.x + viewerBox!.width / 2,
    viewerBox!.y + viewerBox!.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    viewerBox!.x + viewerBox!.width / 2 + 90,
    viewerBox!.y + viewerBox!.height / 2 + 18,
    { steps: 5 },
  )
  await page.mouse.up()
  const orbitExportUrl = await page.evaluate(async () => {
    const exportPng = (window as unknown as {
      __lbsLabExportPng?: () => Promise<string>
    }).__lbsLabExportPng
    if (!exportPng) throw new Error('Dev export hook unavailable')
    return exportPng()
  })
  const orbitPng = Buffer.from(orbitExportUrl.split(',')[1], 'base64')
  expect(orbitPng.equals(materialPng)).toBe(false)
  expect(orbitPng.readUInt32BE(16)).toBe(3840)
  expect(orbitPng.readUInt32BE(20)).toBe(2160)

  const cleanPixels = await page.evaluate(async () => {
    const exportPng = (window as unknown as {
      __lbsLabExportPng?: () => Promise<string>
    }).__lbsLabExportPng
    if (!exportPng) throw new Error('Dev export hook unavailable')
    const image = new Image()
    image.src = await exportPng()
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('2D context unavailable')
    context.drawImage(image, 0, 0)
    const corner = Array.from(context.getImageData(4, 4, 1, 1).data)
    let hasSymbol = false
    for (let y = 0; y < image.height && !hasSymbol; y += 8) {
      for (let x = 0; x < image.width; x += 8) {
        const pixel = Array.from(context.getImageData(x, y, 1, 1).data)
        if (pixel.some((value, index) => value !== corner[index])) {
          hasSymbol = true
          break
        }
      }
    }
    return {
      corner,
      hasSymbol,
    }
  })
  expect(cleanPixels.hasSymbol).toBe(true)

  await formatSection.getByRole('radio', { name: '9:16', exact: true }).click()
  await waitForAnimationFrames(page, 3)
  const portraitExportUrl = await page.evaluate(async () => {
    const exportPng = (window as unknown as {
      __lbsLabExportPng?: () => Promise<string>
    }).__lbsLabExportPng
    if (!exportPng) throw new Error('Dev export hook unavailable')
    return exportPng()
  })
  const portraitPng = Buffer.from(portraitExportUrl.split(',')[1], 'base64')
  expect(portraitPng.readUInt32BE(16)).toBe(2160)
  expect(portraitPng.readUInt32BE(20)).toBe(3840)
})

test('exports the shared WebGL 3D scene without WebGPU', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  await page.getByRole('radio', { name: '3D', exact: true }).click()
  await page.getByRole('radio', { name: 'Stainless Steel', exact: true }).click()
  const viewer = page.locator('[data-mbs-material-model="true"]')
  await expect(viewer).toHaveAttribute('data-model-status', 'ready')
  await expect(viewer).toHaveAttribute('data-postprocess', 'raw')
  await expect(viewer.locator('.lab-material-model-canvas')).toBeVisible()
  await expect(page.getByText('GPU effect unavailable · choose Clean')).toHaveCount(0)
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  expect(await download.path()).not.toBeNull()
  await expect(page.getByText(/Export failed:/)).toHaveCount(0)
  expect(errors).toEqual([])
})
