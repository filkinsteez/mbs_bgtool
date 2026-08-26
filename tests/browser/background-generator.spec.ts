import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

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

async function shrinkArtworkFromCenter(page: Page, ratio = 0.6): Promise<void> {
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
}

test('renders every curated look and keeps autosave isolated', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  await expect(page.getByText('MBS Background Generator', { exact: true })).toBeVisible()

  for (const look of LOOKS) {
    const button = page.getByRole('button', { name: look, exact: true })
    await expect(button).toBeVisible()
    await button.click()
  }

  await expect.poll(async () =>
    page.locator('.lab-look-thumb').evaluateAll((canvases) =>
      canvases.every((canvas) => (canvas as HTMLCanvasElement).toDataURL().length > 100),
    ),
  ).toBe(true)

  await page.getByRole('button', { name: 'Bold', exact: true }).click()
  await page.waitForTimeout(500)
  const keys = await page.evaluate(() => Object.keys(localStorage))
  expect(keys).toContain('mbs-bg-generator-autosave-v2')
  expect(keys).not.toContain('lbs-lab-autosave')
  expect(errors).toEqual([])
})

test('pins the accessible mode switch to the stage and keeps mode-specific controls', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()

  const modeSwitch = page.getByRole('tablist', { name: 'Canvas mode', exact: true })
  const backgroundTab = page.getByRole('tab', { name: '2D', exact: true })
  const materialTab = page.getByRole('tab', { name: '3D', exact: true })
  const stage = page.locator('.lab-canvas-wrap')
  const artboard = page.locator('.lab-canvas-stack')
  await expect(modeSwitch).toBeVisible()
  await expect(page.locator('.lab-topbar').getByRole('tablist')).toHaveCount(0)
  await expect(page.locator('.lab-canvas-wrap').getByRole('tablist')).toHaveCount(1)
  await expect(backgroundTab.locator('svg.lucide-image')).toBeVisible()
  await expect(materialTab.locator('svg.lucide-box')).toBeVisible()
  await expect(backgroundTab).toHaveAttribute('aria-selected', 'true')
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
  const zoomedSwitchBox = await modeSwitch.boundingBox()
  expect(zoomedSwitchBox).not.toBeNull()
  expect(zoomedSwitchBox!.x).toBeCloseTo(switchBox!.x, 0)
  expect(zoomedSwitchBox!.y).toBeCloseTo(switchBox!.y, 0)
  expect(zoomedSwitchBox!.width).toBeCloseTo(switchBox!.width, 0)
  expect(zoomedSwitchBox!.height).toBeCloseTo(switchBox!.height, 0)
  await stage.press('-')

  await expect(page.getByRole('application', {
    name: '2D design canvas',
    exact: true,
  })).toBeVisible()
  await expect(page.locator('[data-renderer="looks"]')).toBeVisible()
  await expect(page.locator('.panel-heading', { hasText: /^Looks$/ })).toBeVisible()
  await expect(page.locator('.panel-heading', { hasText: /^Materials$/ })).toHaveCount(0)
  await expect(page.locator('[data-mbs-shader="true"]')).toHaveCount(0)
  await expect(page.getByText('Compose from Looks, color, and materials')).toHaveCount(0)

  await backgroundTab.focus()
  await page.keyboard.press('ArrowRight')
  await expect(materialTab).toBeFocused()
  await expect(materialTab).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('application', {
    name: '3D design canvas',
    exact: true,
  })).toBeVisible()
  await expect(page.locator('[data-renderer="material"]')).toBeVisible()
  await expect(page.locator('.panel-heading', { hasText: /^Color$/ })).toBeVisible()
  await expect(page.locator('.panel-heading', { hasText: /^Materials$/ })).toBeVisible()
  await expect(page.locator('.panel-heading', { hasText: /^Looks$/ })).toBeVisible()
  await expect(page.locator('.lab-side-right .panel-heading')).toHaveText([
    'Format',
    'Color',
    'Materials',
    'Looks',
  ])
  await expect(page.locator('[data-mbs-look-scope="3d-full-frame"]')).toHaveText(
    'Processes the live 3D frame. Click the active Look to turn it off.',
  )
  await expect(page.getByRole('tab', { name: /Background #0064E0/ })).toBeVisible()
  await expect(page.getByRole('tab', { name: /Highlight #FFFFFF/ })).toBeVisible()
  await expect(page.getByText('Ratios normalize to 100% across enabled colors.')).toHaveCount(0)
  await expect(page.getByRole('spinbutton', { name: /percentage/ })).toHaveCount(0)
  await expect(page.getByText('Opaque untreated Meta symbol.')).toBeVisible()
  await expect(page.getByText('Intensity', { exact: true })).toHaveCount(0)
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
  const stainlessSteel = page.getByRole('button', {
    name: 'Stainless Steel 1',
    exact: true,
  })
  await expect(stainlessSteel).toBeVisible()
  await expect(page.getByRole('button', { name: 'Metal', exact: true })).toHaveCount(0)
  await expect(
    page.locator('.lab-material-hue-groups').first().locator('.lab-material-hue-label'),
  ).toHaveText(['Blues', 'Cyans', 'Purples', 'Oranges', 'Yellows', 'Neutrals'])
  await page.getByRole('button', {
    name: 'Use #FF5001 for material highlight',
    exact: true,
  }).click()
  await expect.poll(async () =>
    page.evaluate(() => {
      const recipe = JSON.parse(localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '{}')
      return { mode: recipe.mode, highlight: recipe.material?.highlightColor }
    }),
  ).toEqual({ mode: 'material', highlight: '#FF5001' })
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await expect(materialTab).toHaveAttribute('aria-selected', 'true')
  const viewer = page.locator('[data-mbs-material-model="true"]')
  const modelCanvas = viewer.locator('.lab-material-model-canvas')
  await expect(viewer).toHaveAttribute('data-model-status', 'ready')
  await expect(viewer).toHaveAttribute('data-material', 'clean')
  await expect(viewer).toHaveAttribute('data-look', 'off')
  await expect(page.locator('[data-mbs-material-look-overlay="true"]')).toHaveCount(0)
  await waitForAnimationFrames(page, 3)
  const cleanMaterial = await modelCanvas.screenshot()
  await stainlessSteel.click()
  await expect(viewer).toHaveAttribute('data-material', 'metal')
  await expect(page.getByText(
    /Licensed Shaders\.com preset Stainless Steel 1 · a92be03a-7df7-4f54-91f3-a87ba40bd320/,
  )).toBeVisible()
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

  await backgroundTab.click()
  await expect(page.locator('[data-renderer="looks"]')).toBeVisible()
  await expect(page.locator('[data-mbs-shader="true"]')).toHaveCount(0)
})

test('uses color percentages as off state and adds swatches without replacing the mix', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()

  const colorSection = page.locator('.panel-section').filter({
    has: page.locator('.panel-heading', { hasText: /^Color$/ }),
  }).first()
  await expect(colorSection.getByRole('button', { name: /^(On|Off)$/ })).toHaveCount(0)

  const ratioInputs = colorSection.getByRole('spinbutton', { name: /percentage/ })
  await ratioInputs.first().fill('0')
  await expect.poll(async () =>
    page.evaluate(() => {
      const recipe = JSON.parse(localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '{}')
      return recipe.palette?.mix?.[0]
    }),
  ).toMatchObject({ enabled: false, ratio: 0 })

  await ratioInputs.first().fill('30')
  await expect.poll(async () =>
    page.evaluate(() => {
      const recipe = JSON.parse(localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '{}')
      return recipe.palette?.mix?.[0]?.enabled
    }),
  ).toBe(true)

  const before = await page.evaluate(() => {
    const recipe = JSON.parse(localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '{}')
    return recipe.palette.mix as { color: string }[]
  })
  await colorSection.locator('summary', { hasText: 'More approved colors' }).click()
  const swatch = colorSection.locator('.lab-approved-swatch[aria-pressed="false"]').first()
  const addedColor = await swatch.getAttribute('title')
  await swatch.click()

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
  await expect(colorSection.getByText('Custom', { exact: true })).toBeVisible()
})

test('orders Material swatches from low to high saturation', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear())
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  await page.getByRole('tab', { name: '3D', exact: true }).click()

  const materialHueGroups = page.locator('.lab-material-hue-groups')
  await expect(
    materialHueGroups.first().locator('.lab-material-hue-label'),
  ).toHaveText(['Blues', 'Cyans', 'Purples', 'Oranges', 'Yellows', 'Neutrals'])
  await expect.poll(async () =>
    materialHueGroups
      .first()
      .locator('.lab-material-hue-group')
      .first()
      .locator('button')
      .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('title'))),
  ).toEqual([
    '#27353E',
    '#DAE3EA',
    '#1C2B32',
    '#1C2A33',
    '#7CA0B8',
    '#D6E7EE',
    '#132682',
    '#093AC7',
    '#034AE0',
    '#0288F9',
    '#4F43FF',
    '#006CE1',
  ])

  await page.locator('summary', { hasText: 'More approved colors' }).click()
  await expect.poll(async () =>
    materialHueGroups
      .nth(1)
      .locator('.lab-material-hue-group')
      .first()
      .locator('button')
      .evaluateAll((buttons) =>
        buttons.slice(0, 6).map((button) => button.getAttribute('title')),
      ),
  ).toEqual(['#0E1215', '#C8D5DE', '#F3F4F8', '#DAE3EA', '#E6EBF1', '#1F1D35'])
  await expect.poll(async () =>
    materialHueGroups
      .nth(1)
      .locator('.lab-material-hue-group')
      .last()
      .locator('button')
      .evaluateAll((buttons) =>
        buttons.slice(0, 4).map((button) => button.getAttribute('title')),
      ),
  ).toEqual(['#FAFAFA', '#1F1F1F', '#181818', '#111111'])
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
  const materialTab = page.getByRole('tab', { name: '3D', exact: true })
  await materialTab.click()

  const viewer = page.locator('[data-mbs-material-model="true"]')
  const modelCanvas = viewer.locator('.lab-material-model-canvas')
  const processedCanvas = viewer.locator('.lab-material-look-canvas')
  const screenshotView = async () => (
    await viewer.getAttribute('data-postprocess') === 'canvas2d-look'
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
  await expect(viewer).toHaveAttribute('data-postprocess', 'canvas2d-look')
  await page.getByRole('button', { name: 'Clean', exact: true }).click()
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
  await page.getByRole('button', { name: 'Stainless Steel 1', exact: true }).click()
  await expect(viewer).toHaveAttribute('data-material', 'metal')
  await expect.poll(() => processedCanvas.getAttribute('data-source-hash')).not.toBe(cleanMaterialHash)
  const metalMaterialPixels = await screenshotView()
  const materialSourceDifference = await pixelDifference(
    page,
    cleanMaterialPixels,
    metalMaterialPixels,
  )
  expect(materialSourceDifference.changedFraction).toBeGreaterThan(0.02)
  expect(materialSourceDifference.centerMean).toBeGreaterThan(1)

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
  await expect(viewer).toHaveAttribute('data-postprocess', 'canvas2d-look')

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
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await expect(viewer).toHaveAttribute('data-material', 'clean')
  await expect(viewer).toHaveAttribute('data-look', 'off')
  await expect(viewer).toHaveAttribute('data-postprocess', 'raw')
  await scanlinesButton.click()
  await expect(trailsButton).toHaveAttribute('aria-pressed', 'false')
  await expect(scanlinesButton).toHaveAttribute('aria-pressed', 'true')
  await expect(viewer).toHaveAttribute('data-look', 'scanlines')
  await expect(viewer).toHaveAttribute('data-postprocess', 'canvas2d-look')
  await page.getByRole('button', { name: 'Stainless Steel 1', exact: true }).click()
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
    path: 'test-results/3d-canvas2d-look-scanlines.png',
    fullPage: true,
  })

  expect(errors).toEqual([])
})

test('middle-drags pan the 3D viewer without taking over outer canvas panning', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  await page.getByRole('tab', { name: '3D', exact: true }).click()

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

test('orbit and wheel release 3D framing without spamming history', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  await page.getByRole('tab', { name: '3D', exact: true }).click()

  const viewer = page.locator('[data-mbs-material-model="true"]')
  const canvas = viewer.locator('.lab-material-model-canvas')
  const resetView = viewer.getByRole('button', { name: 'Reset view', exact: true })
  const materialPreset = () => page.evaluate(() => {
    const recipe = JSON.parse(localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '{}')
    return recipe.transforms?.material?.preset
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
})

test('keeps dragged 2D artwork moved after capture release and render cycles', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear())
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()

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

  // Clicking blank canvas only changes ephemeral selection: it does not pan,
  // enter crop, push history, or write a deterministic recipe.
  await page.mouse.click(artboardBox!.x - 12, artboardBox!.y + 20)
  await expect(frame).toHaveCount(0)
  await expect(page.locator('.lab-crop-frame')).toHaveCount(0)
  const afterBlankBox = await artboard.boundingBox()
  expect(afterBlankBox?.x).toBeCloseTo(artboardBox!.x, 1)
  expect(afterBlankBox?.y).toBeCloseTo(artboardBox!.y, 1)

  await wrap.press('ArrowRight')
  await page.waitForTimeout(450)
  expect(await page.evaluate(() =>
    localStorage.getItem('mbs-bg-generator-autosave-v2'),
  )).toBeNull()

  await page.mouse.click(artworkCenter.x, artworkCenter.y)
  await expect(frame).toBeVisible()
  await wrap.press('Shift+ArrowRight')
  await expect.poll(async () =>
    page.evaluate(() => {
      const recipe = JSON.parse(localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '{}')
      return recipe.transforms?.background?.x ?? 0
    }),
  ).toBeGreaterThan(0)
  await pressUndo(page)
  await expect.poll(async () =>
    page.evaluate(() => {
      const recipe = JSON.parse(localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '{}')
      return recipe.transforms?.background?.x ?? 0
    }),
  ).toBe(0)
})

test('translates the complete 2D artwork identically in preview and PNG export', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear())
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  await page.getByRole('button', { name: '1080', exact: true }).click()
  await expect(page.getByText('Transform', { exact: true })).toHaveCount(0)
  await waitForAnimationFrames(page, 3)

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
  const screenShift = 108 * initialArtboard!.width / 1080
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
  const exportShift = await shiftedPixelDifference(page, exportBefore, exportAfter, 108)
  expect(exportShift).toEqual({ mismatchedFraction: 0, maxDelta: 0 })
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
  await page.getByRole('button', { name: '1080', exact: true }).click()
  await waitForAnimationFrames(page, 2)
  await shrinkArtworkFromCenter(page)

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
  await page.getByRole('button', { name: '1080', exact: true }).click()
  await waitForAnimationFrames(page, 2)
  await shrinkArtworkFromCenter(page)

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
    }
  }
})

test('directly moves and crops while keeping mode transforms independent', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()

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

  await page.getByRole('tab', { name: '3D', exact: true }).click()
  await page.getByRole('button', { name: 'Glass', exact: true }).click()
  await expect.poll(async () =>
    page.evaluate(() => {
      const recipe = JSON.parse(localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '{}')
      return {
        background: recipe.transforms?.background?.x,
        material: recipe.transforms?.material?.x,
      }
    }),
  ).toMatchObject({ material: 0 })

  await page.getByRole('tab', { name: '2D', exact: true }).click()
  await page.locator('.lab-canvas-wrap').press('c')
  const cropHandle = page.locator('.lab-crop-handle.handle-e')
  const handleBox = await cropHandle.boundingBox()
  expect(handleBox).not.toBeNull()
  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(handleBox!.x - 80, handleBox!.y + handleBox!.height / 2, { steps: 3 })
  await page.mouse.up()

  await expect.poll(async () =>
    page.evaluate(() =>
      JSON.parse(localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '{}').format?.aspect,
    ),
  ).toBe('custom')

  await pressUndo(page)
  await expect.poll(async () =>
    page.evaluate(() =>
      JSON.parse(localStorage.getItem('mbs-bg-generator-autosave-v2') ?? '{}').format?.aspect,
    ),
  ).toBe('16:9')
})

test('exports both modes as exact 4K PNGs', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()

  const formatSection = page.getByRole('region', { name: 'Format', exact: true })
  const exportSection = page.getByRole('region', { name: 'Export', exact: true })
  await expect(formatSection.getByRole('button', { name: /^Aspect / })).toBeVisible()
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

  await page.getByRole('tab', { name: '3D', exact: true }).click()
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
})

test('keeps the canvas usable when WebGPU is unavailable', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  await page.getByRole('tab', { name: '3D', exact: true }).click()
  await page.getByRole('button', { name: 'Stainless Steel 1', exact: true }).click()
  const viewer = page.locator('[data-mbs-material-model="true"]')
  await expect(viewer).toHaveAttribute('data-model-status', 'ready')
  await expect(viewer).toHaveAttribute('data-postprocess', 'raw')
  await expect(viewer.locator('.lab-material-model-canvas')).toBeVisible()
  await expect(page.getByText('GPU effect unavailable · choose Clean')).toHaveCount(0)
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await expect(page.getByText(/Export failed: .*choose Clean to export/)).toBeVisible()
  expect(errors).toEqual([])
})
