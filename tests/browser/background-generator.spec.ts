import { readFile } from 'node:fs/promises'
import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test'
import {
  BACKGROUND_AUTOSAVE_KEY,
  createDefaultBackgroundRecipe,
  type GeneratorMode,
} from '../../src/features/background-generator/recipe'

const PRESETS = [
  'Soft Diffusion',
  'Focused Diffusion',
  'Folded Diffusion',
  'Wide Smear',
  'Fine Smear',
  'Folded Smear',
] as const

const COLOR_PACKS = [
  'Blues',
  'Primary',
  'Bold',
  'Atmospheric',
  'Elemental',
] as const

async function prepare(
  page: Page,
  mode?: GeneratorMode,
): Promise<void> {
  const recipe = createDefaultBackgroundRecipe(1913)
  if (mode) recipe.mode = mode
  await page.addInitScript(
    ({ key, value }) => {
      localStorage.clear()
      if (value) localStorage.setItem(key, value)
    },
    {
      key: BACKGROUND_AUTOSAVE_KEY,
      value: mode ? JSON.stringify(recipe) : '',
    },
  )
}

async function openGenerator(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
}

async function waitForFrames(page: Page, count = 2): Promise<void> {
  await page.evaluate(async (frameCount) => {
    await new Promise<void>((resolve) => {
      let remaining = frameCount
      const next = () => {
        remaining -= 1
        if (remaining <= 0) resolve()
        else requestAnimationFrame(next)
      }
      requestAnimationFrame(next)
    })
  }, count)
}

async function canvasFingerprint(canvas: Locator): Promise<string> {
  return canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())
}

async function waitFor3D(page: Page): Promise<{
  viewer: Locator
  raw: Locator
  processed: Locator
}> {
  const viewer = page.locator('[data-mbs-material-model="true"]')
  const raw = viewer.locator('.lab-material-model-canvas')
  const processed = viewer.locator('.lab-material-look-canvas')
  await expect(viewer).toHaveAttribute('data-model-status', 'ready')
  await expect(viewer).toHaveAttribute(
    'data-postprocess',
    'legacy-canvas2d-look',
  )
  await expect(raw).toHaveAttribute('data-render-pipeline', 'three-raw')
  await expect(processed).toHaveAttribute('data-render-status', 'ready')
  return { viewer, raw, processed }
}

async function clickAndWaitForProcessedRevision(
  control: Locator,
  processed: Locator,
): Promise<void> {
  const before = Number(
    await processed.getAttribute('data-render-revision') ?? 0,
  )
  await control.click()
  await expect.poll(async () =>
    Number(await processed.getAttribute('data-render-revision') ?? 0),
  ).toBeGreaterThan(before)
}

async function pressUndo(page: Page): Promise<void> {
  await page.keyboard.press('Meta+z')
}

async function dragRadially(
  page: Page,
  target: Locator,
  center: { x: number; y: number },
  factor: number,
  shift = false,
): Promise<void> {
  const box = await target.boundingBox()
  expect(box).not.toBeNull()
  const start = {
    x: box!.x + box!.width / 2,
    y: box!.y + box!.height / 2,
  }
  const end = {
    x: center.x + (start.x - center.x) * factor,
    y: center.y + (start.y - center.y) * factor,
  }
  if (shift) await page.keyboard.down('Shift')
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 5 })
  await page.mouse.up()
  if (shift) await page.keyboard.up('Shift')
}

async function rotateFromZone(
  page: Page,
  zone: Locator,
  frame: Locator,
  degrees: number,
  shift = false,
): Promise<void> {
  const [zoneBox, frameBox] = await Promise.all([
    zone.boundingBox(),
    frame.boundingBox(),
  ])
  expect(zoneBox).not.toBeNull()
  expect(frameBox).not.toBeNull()
  const center = {
    x: frameBox!.x + frameBox!.width / 2,
    y: frameBox!.y + frameBox!.height / 2,
  }
  const start = {
    x: zoneBox!.x + zoneBox!.width / 2,
    y: zoneBox!.y + zoneBox!.height / 2,
  }
  const radius = Math.hypot(start.x - center.x, start.y - center.y)
  const angle = Math.atan2(start.y - center.y, start.x - center.x)
    + degrees * Math.PI / 180
  const end = {
    x: center.x + Math.cos(angle) * radius,
    y: center.y + Math.sin(angle) * radius,
  }
  if (shift) await page.keyboard.down('Shift')
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 6 })
  await page.mouse.up()
  if (shift) await page.keyboard.up('Shift')
}

async function exportParity(
  page: Page,
  previewSelector: string,
): Promise<{
  width: number
  height: number
  meanError: number
  correlation: number
}> {
  return page.evaluate(async (selector) => {
    const preview = document.querySelector<HTMLCanvasElement>(selector)
    const exportPng = (window as typeof window & {
      __lbsLabExportPng?: () => Promise<string>
    }).__lbsLabExportPng
    if (!preview || !exportPng) throw new Error('Export preview is unavailable')

    const image = new Image()
    image.src = await exportPng()
    await image.decode()
    const width = 64
    const height = 36
    const pixels = (source: CanvasImageSource) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Parity context unavailable')
      context.drawImage(source, 0, 0, width, height)
      return context.getImageData(0, 0, width, height).data
    }
    const before = pixels(preview)
    const after = pixels(image)
    const beforeLuma: number[] = []
    const afterLuma: number[] = []
    let difference = 0
    for (let offset = 0; offset < before.length; offset += 4) {
      difference += (
        Math.abs(before[offset] - after[offset])
        + Math.abs(before[offset + 1] - after[offset + 1])
        + Math.abs(before[offset + 2] - after[offset + 2])
      ) / 3
      beforeLuma.push(
        before[offset] * 0.2126
        + before[offset + 1] * 0.7152
        + before[offset + 2] * 0.0722,
      )
      afterLuma.push(
        after[offset] * 0.2126
        + after[offset + 1] * 0.7152
        + after[offset + 2] * 0.0722,
      )
    }
    const mean = (values: number[]) =>
      values.reduce((sum, value) => sum + value, 0) / values.length
    const beforeMean = mean(beforeLuma)
    const afterMean = mean(afterLuma)
    let covariance = 0
    let beforeVariance = 0
    let afterVariance = 0
    for (let index = 0; index < beforeLuma.length; index += 1) {
      const left = beforeLuma[index] - beforeMean
      const right = afterLuma[index] - afterMean
      covariance += left * right
      beforeVariance += left * left
      afterVariance += right * right
    }
    return {
      width: image.width,
      height: image.height,
      meanError: difference / beforeLuma.length,
      correlation: covariance
        / Math.max(0.0001, Math.sqrt(beforeVariance * afterVariance)),
    }
  }, previewSelector)
}

async function captureResponsiveView(
  page: Page,
  testInfo: TestInfo,
  width: number,
  height: number,
): Promise<void> {
  await page.setViewportSize({ width, height })
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  await waitFor3D(page)
  await expect.poll(() =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true)

  await expect(page.getByRole('group', {
    name: 'Canvas tools',
    exact: true,
  })).toHaveCount(0)
  const modeSwitch = page.getByRole('radiogroup', {
    name: 'Canvas mode',
    exact: true,
  })
  const modeBox = await modeSwitch.boundingBox()
  expect(modeBox).not.toBeNull()
  await expect(page.getByRole('button', {
    name: 'Export image',
    exact: true,
  })).toBeVisible()
  await page.screenshot({
    path: testInfo.outputPath(`generator-${width}x${height}.png`),
  })
}

test('starts in the simple 3D preset-first shell', async ({ page }) => {
  await prepare(page)
  await openGenerator(page)

  const mode = page.getByRole('radiogroup', {
    name: 'Canvas mode',
    exact: true,
  })
  await expect(mode.getByRole('radio', {
    name: '3D Logo',
    exact: true,
  })).toHaveAttribute('aria-checked', 'true')
  await expect(mode.getByRole('radio', {
    name: '2D Texture',
    exact: true,
  })).toHaveAttribute('aria-checked', 'false')

  const presets = page.getByRole('radiogroup', {
    name: 'Gradient presets',
    exact: true,
  })
  await expect(presets.getByRole('radio')).toHaveCount(PRESETS.length)
  for (const name of PRESETS) {
    await expect(presets.getByRole('radio', { name, exact: true })).toBeVisible()
  }
  const presetControls = await presets.getByRole('radio').all()
  await presetControls[0].focus()
  await page.keyboard.press('ArrowRight')
  await expect(presetControls[1]).toBeFocused()
  await expect(presetControls[1]).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Home')
  await expect(presetControls[0]).toBeFocused()
  await expect(presetControls[0]).toHaveAttribute('aria-checked', 'true')

  const packs = page.getByRole('radiogroup', {
    name: 'Color Packs',
    exact: true,
  })
  await expect(packs.getByRole('radio')).toHaveCount(COLOR_PACKS.length)
  for (const name of COLOR_PACKS) {
    await expect(packs.getByRole('radio', { name, exact: true })).toBeVisible()
  }

  for (const name of ['Blend', 'Distortion', 'Position', 'Meta blue balance']) {
    await expect(page.getByRole('slider', { name, exact: true })).toHaveCount(0)
  }
  for (const name of ['Detail', 'Softness']) {
    await expect(page.getByRole('slider', { name, exact: true })).toHaveCount(1)
  }
  await expect(page.getByRole('button', {
    name: 'New variation',
    exact: true,
  })).toBeVisible()
  const detailControl = page.getByRole('slider', {
    name: 'Detail',
    exact: true,
  })
  const softnessControl = page.getByRole('slider', {
    name: 'Softness',
    exact: true,
  })
  await detailControl.fill('100')
  await detailControl.blur()
  await softnessControl.fill('65')
  await softnessControl.blur()
  const colorBalance = page.getByRole('group', {
    name: 'Color balance',
    exact: true,
  })
  await expect(colorBalance.getByRole('slider')).toHaveCount(2)
  await expect(colorBalance.getByRole('slider', {
    name: 'Boundary between Meta blue and Pale blue',
    exact: true,
  })).toHaveAttribute('aria-valuenow', '70')
  await expect(colorBalance.getByRole('slider', {
    name: 'Boundary between Pale blue and Ink',
    exact: true,
  })).toHaveAttribute('aria-valuenow', '85')
  await expect(page.getByText(/^V[1-4]$/)).toHaveCount(0)
  await expect(page.getByText('Motion', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Materials', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Distortion brush', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Custom palette', { exact: true })).toHaveCount(0)

  const { processed } = await waitFor3D(page)
  const fingerprints = new Set<string>([await canvasFingerprint(processed)])
  for (const name of PRESETS.slice(1)) {
    await clickAndWaitForProcessedRevision(
      presets.getByRole('radio', { name, exact: true }),
      processed,
    )
    await expect(detailControl).toHaveValue('100')
    await expect(softnessControl).toHaveValue('65')
    fingerprints.add(await canvasFingerprint(processed))
  }
  expect(fingerprints.size).toBe(PRESETS.length)
})

test('renders every Color Pack and orientation through the 2D painter', async ({
  page,
}) => {
  await prepare(page, 'background')
  await openGenerator(page)
  const canvas = page.locator('canvas[data-renderer="looks"]')
  await waitForFrames(page, 3)

  const symbolToggle = page.getByRole('radiogroup', {
    name: 'Meta symbol',
    exact: true,
  })
  const symbolOn = symbolToggle.getByRole('radio', {
    name: 'On',
    exact: true,
  })
  const symbolOff = symbolToggle.getByRole('radio', {
    name: 'Off',
    exact: true,
  })
  await expect(symbolOn).toHaveAttribute('aria-checked', 'true')
  const withSymbol = await canvasFingerprint(canvas)
  await symbolOff.click()
  await waitForFrames(page, 2)
  expect(await canvasFingerprint(canvas)).not.toBe(withSymbol)
  await symbolOn.click()
  await waitForFrames(page, 2)
  expect(await canvasFingerprint(canvas)).toBe(withSymbol)

  const gradientPosition = page.getByRole('button', {
    name: 'Move color source 1',
    exact: true,
  })
  await expect(gradientPosition).toHaveCSS('opacity', '0')
  const initialGradientX = await gradientPosition.getAttribute('data-gradient-x')
  const initialGradientY = await gradientPosition.getAttribute('data-gradient-y')
  const beforeGradientMove = await canvasFingerprint(canvas)
  const gradientPositionBox = await gradientPosition.boundingBox()
  expect(gradientPositionBox).not.toBeNull()
  await page.mouse.move(
    gradientPositionBox!.x + gradientPositionBox!.width / 2,
    gradientPositionBox!.y + gradientPositionBox!.height / 2,
  )
  await expect(gradientPosition).toHaveCSS('opacity', '1')
  await page.mouse.down()
  await page.mouse.move(
    gradientPositionBox!.x + gradientPositionBox!.width / 2 + 70,
    gradientPositionBox!.y + gradientPositionBox!.height / 2 + 35,
    { steps: 5 },
  )
  await page.mouse.up()
  await expect(gradientPosition).not.toHaveAttribute('data-gradient-x', initialGradientX!)
  await waitForFrames(page, 2)
  expect(await canvasFingerprint(canvas)).not.toBe(beforeGradientMove)
  await pressUndo(page)
  await expect(gradientPosition).toHaveAttribute('data-gradient-x', initialGradientX!)
  await expect(gradientPosition).toHaveAttribute('data-gradient-y', initialGradientY!)
  await page.mouse.move(1200, 100)
  await expect(gradientPosition).toHaveCSS('opacity', '0')
  const canvasBox = await canvas.boundingBox()
  expect(canvasBox).not.toBeNull()
  await page.mouse.move(canvasBox!.x + 30, canvasBox!.y + 30)
  await expect(gradientPosition).toHaveCSS('opacity', '0')
  await gradientPosition.focus()
  await page.keyboard.press('ArrowRight')
  await expect(gradientPosition).not.toHaveAttribute('data-gradient-x', initialGradientX!)
  await pressUndo(page)
  await expect(gradientPosition).toHaveAttribute('data-gradient-x', initialGradientX!)

  const beforeDetail = await canvasFingerprint(canvas)
  await page.getByRole('slider', {
    name: 'Detail',
    exact: true,
  }).fill('70')
  await page.getByRole('slider', {
    name: 'Detail',
    exact: true,
  }).blur()
  await waitForFrames(page, 2)
  expect(await canvasFingerprint(canvas)).not.toBe(beforeDetail)

  const beforeSoftness = await canvasFingerprint(canvas)
  await page.getByRole('slider', {
    name: 'Softness',
    exact: true,
  }).fill('20')
  await page.getByRole('slider', {
    name: 'Softness',
    exact: true,
  }).blur()
  await waitForFrames(page, 2)
  expect(await canvasFingerprint(canvas)).not.toBe(beforeSoftness)

  const beforeVariation = await canvasFingerprint(canvas)
  await page.getByRole('button', {
    name: 'New variation',
    exact: true,
  }).click()
  await waitForFrames(page, 2)
  expect(await canvasFingerprint(canvas)).not.toBe(beforeVariation)

  const packs = page.getByRole('radiogroup', {
    name: 'Color Packs',
    exact: true,
  })
  const packFrames = new Set<string>()
  for (const name of COLOR_PACKS) {
    await packs.getByRole('radio', { name, exact: true }).click()
    await waitForFrames(page, 2)
    packFrames.add(await canvasFingerprint(canvas))
  }
  expect(packFrames.size).toBe(COLOR_PACKS.length)

  const orientations = page.getByRole('radiogroup', {
    name: 'Gradient orientation',
    exact: true,
  })
  const orientationFrames = new Set<string>()
  for (const control of await orientations.getByRole('radio').all()) {
    await control.click()
    await waitForFrames(page, 2)
    orientationFrames.add(await canvasFingerprint(canvas))
  }
  expect(orientationFrames.size).toBe(4)
  const orientationControls = await orientations.getByRole('radio').all()
  await orientationControls[3].focus()
  await page.keyboard.press('ArrowRight')
  await expect(orientationControls[0]).toBeFocused()
  await expect(orientationControls[0]).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('ArrowLeft')
  await expect(orientationControls[3]).toBeFocused()
  await expect(orientationControls[3]).toHaveAttribute('aria-checked', 'true')

  const colorBalance = page.getByRole('group', {
    name: 'Color balance',
    exact: true,
  })
  const boundary = colorBalance.getByRole('slider', {
    name: 'Boundary between Meta blue and Lime',
    exact: true,
  })
  await expect(colorBalance.getByRole('slider')).toHaveCount(1)
  const before = await canvasFingerprint(canvas)
  await boundary.focus()
  await page.keyboard.press('Home')
  await expect(boundary).toHaveAttribute('aria-valuenow', '0')
  await page.keyboard.press('ArrowRight')
  await expect(boundary).toHaveAttribute('aria-valuenow', '1')
  await page.keyboard.press('End')
  await expect(boundary).toHaveAttribute('aria-valuenow', '100')
  const boundaryValue = colorBalance.getByRole('spinbutton', {
    name: 'Boundary between Meta blue and Lime',
    exact: true,
  })
  await boundaryValue.fill('62')
  await boundaryValue.blur()
  await expect(boundary).toHaveAttribute('aria-valuenow', '62')
  const boundaryBox = await boundary.boundingBox()
  expect(boundaryBox).not.toBeNull()
  await page.mouse.move(
    boundaryBox!.x + boundaryBox!.width / 2,
    boundaryBox!.y + boundaryBox!.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    boundaryBox!.x + boundaryBox!.width / 2 + 24,
    boundaryBox!.y + boundaryBox!.height / 2,
    { steps: 4 },
  )
  await page.mouse.up()
  await expect.poll(async () =>
    Number(await boundary.getAttribute('aria-valuenow')),
  ).toBeGreaterThan(62)
  await pressUndo(page)
  await expect(boundary).toHaveAttribute('aria-valuenow', '62')
  await waitForFrames(page, 2)
  expect(await canvasFingerprint(canvas)).not.toBe(before)
})

test('keeps 3D orientation in the screen-space Look layer', async ({ page }) => {
  await prepare(page)
  await openGenerator(page)
  const { raw, processed } = await waitFor3D(page)
  await expect(page.getByRole('button', {
    name: 'Move gradient',
    exact: true,
  })).toHaveCount(0)

  const orientations = page.getByRole('radiogroup', {
    name: 'Gradient orientation',
    exact: true,
  })
  const rawFrames = new Set<string>()
  const processedFrames = new Set<string>()
  rawFrames.add(await canvasFingerprint(raw))
  processedFrames.add(await canvasFingerprint(processed))

  const controls = await orientations.getByRole('radio').all()
  for (const control of controls.slice(1)) {
    await clickAndWaitForProcessedRevision(control, processed)
    rawFrames.add(await canvasFingerprint(raw))
    processedFrames.add(await canvasFingerprint(processed))
  }

  expect(rawFrames.size).toBe(1)
  expect(processedFrames.size).toBe(4)
})

test('uses Figma-style corner scaling and outside-corner rotation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await prepare(page, 'background')
  await openGenerator(page)

  const frame = page.locator('.lab-subject-frame')
  const scaleControl = page.getByRole('slider', {
    name: 'Scale artwork from top left',
    exact: true,
  })
  const rotationControl = page.getByRole('slider', {
    name: 'Rotate artwork',
    exact: true,
  })
  const corners = [
    ['nw', 'top left'],
    ['ne', 'top right'],
    ['sw', 'bottom left'],
    ['se', 'bottom right'],
  ] as const

  await expect(frame).toBeVisible()
  await expect(page.locator('.lab-transform-handle')).toHaveCount(4)
  await expect(page.locator('.lab-rotation-zone')).toHaveCount(4)
  await expect(page.locator('.lab-rotation-handle')).toHaveCount(0)

  for (const [corner, label] of corners) {
    const frameBox = await frame.boundingBox()
    expect(frameBox).not.toBeNull()
    await dragRadially(
      page,
      page.getByRole('slider', {
        name: `Scale artwork from ${label}`,
        exact: true,
      }),
      {
        x: frameBox!.x + frameBox!.width / 2,
        y: frameBox!.y + frameBox!.height / 2,
      },
      1.08,
    )
    await expect.poll(async () =>
      Number(await scaleControl.getAttribute('aria-valuenow')),
    ).toBeGreaterThan(103)
    await pressUndo(page)
    await expect(scaleControl).toHaveAttribute('aria-valuenow', '100')

    await rotateFromZone(
      page,
      page.locator(`.lab-rotation-zone.corner-${corner}`),
      frame,
      30,
    )
    await expect.poll(async () =>
      Number(await rotationControl.getAttribute('aria-valuenow')),
    ).toBeGreaterThanOrEqual(29)
    await expect.poll(async () =>
      Number(await rotationControl.getAttribute('aria-valuenow')),
    ).toBeLessThanOrEqual(31)
    await pressUndo(page)
    await expect(rotationControl).toHaveAttribute('aria-valuenow', '0')
  }

  await rotateFromZone(
    page,
    page.locator('.lab-rotation-zone.corner-nw'),
    frame,
    23,
    true,
  )
  await expect(rotationControl).toHaveAttribute('aria-valuenow', '30')

  const scaleBeforeKeyboard = Number(
    await scaleControl.getAttribute('aria-valuenow'),
  )
  await scaleControl.focus()
  for (let index = 0; index < 4; index += 1) {
    await page.keyboard.press('Shift+ArrowUp')
  }
  await scaleControl.blur()
  await expect.poll(async () =>
    Number(await scaleControl.getAttribute('aria-valuenow')),
  ).toBe(scaleBeforeKeyboard + 40)
})

test('keeps a fixed artboard while preserving 3D orbit', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await prepare(page, 'background')
  await openGenerator(page)

  await expect(page.getByRole('button', {
    name: 'Pan canvas',
    exact: true,
  })).toHaveCount(0)
  await expect(page.getByRole('button', {
    name: 'Zoom out',
    exact: true,
  })).toHaveCount(0)
  await expect(page.getByRole('button', {
    name: 'Zoom in',
    exact: true,
  })).toHaveCount(0)
  await expect(page.getByRole('button', {
    name: 'Fit view',
    exact: true,
  })).toHaveCount(0)
  await expect(page.getByLabel('Canvas zoom')).toHaveCount(0)
  await expect(page.getByRole('group', {
    name: 'Canvas tools',
    exact: true,
  })).toHaveCount(0)

  const wrap = page.locator('.lab-canvas-wrap')
  const artboard = page.locator('.lab-canvas-stack')
  const before = await artboard.boundingBox()
  const wrapBox = await wrap.boundingBox()
  expect(before).not.toBeNull()
  expect(wrapBox).not.toBeNull()

  await page.mouse.move(wrapBox!.x + 12, wrapBox!.y + 12)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(wrapBox!.x + 132, wrapBox!.y + 72, { steps: 5 })
  await page.mouse.up({ button: 'middle' })
  await page.mouse.wheel(120, 240)
  await wrap.focus()
  for (const key of ['h', '+', '-', '0']) await page.keyboard.press(key)
  const fixed = await artboard.boundingBox()
  expect(fixed!.x).toBeCloseTo(before!.x, 0)
  expect(fixed!.y).toBeCloseTo(before!.y, 0)
  expect(fixed!.width).toBeCloseTo(before!.width, 0)
  expect(fixed!.height).toBeCloseTo(before!.height, 0)

  await expect(page.getByRole('complementary', {
    name: 'Background controls',
    exact: true,
  })).toBeVisible()
  const detail = page.getByRole('slider', { name: 'Detail', exact: true })
  const softness = page.getByRole('slider', { name: 'Softness', exact: true })
  await detail.fill('73')
  await detail.blur()
  await softness.fill('64')
  await softness.blur()
  const inspector = page.locator('.lab-inspector-body')
  await inspector.evaluate((element) => {
    element.scrollTop = 40
  })
  await expect.poll(() => inspector.evaluate((element) => element.scrollTop))
    .toBe(40)

  await page.getByRole('radio', {
    name: '3D Logo',
    exact: true,
  }).click()
  await expect(detail).toHaveValue('73')
  await expect(softness).toHaveValue('64')
  await expect.poll(() => inspector.evaluate((element) => element.scrollTop))
    .toBe(40)
  const { viewer } = await waitFor3D(page)
  const exportButton = page.getByRole('button', {
    name: 'Export image',
    exact: true,
  })
  await expect(exportButton).toBeEnabled()
  const beforeOrbit = await artboard.boundingBox()
  const viewerBox = await viewer.boundingBox()
  expect(viewerBox).not.toBeNull()
  await page.mouse.move(
    viewerBox!.x + viewerBox!.width / 2,
    viewerBox!.y + viewerBox!.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    viewerBox!.x + viewerBox!.width / 2 + 80,
    viewerBox!.y + viewerBox!.height / 2 + 20,
    { steps: 5 },
  )
  await expect(exportButton).toBeDisabled()
  await page.mouse.up()
  await expect(exportButton).toBeEnabled()
  await expect.poll(() =>
    page.evaluate((key) => {
      const recipe = JSON.parse(localStorage.getItem(key) ?? '{}')
      return recipe.material?.camera !== null
    }, BACKGROUND_AUTOSAVE_KEY),
  ).toBe(true)
  const afterOrbit = await artboard.boundingBox()
  expect(afterOrbit!.x).toBeCloseTo(beforeOrbit!.x, 0)
  expect(afterOrbit!.y).toBeCloseTo(beforeOrbit!.y, 0)
})

test('resets incompatible saves to the curated default and preserves format', async ({
  page,
}) => {
  const legacy = {
    version: 2,
    renderRevision: 1,
    mode: 'background',
    seed: 88,
    format: { aspect: '9:16', width: 2160, height: 3840 },
    look: { version: 'v4', id: 'marks' },
    palette: { packId: 'custom' },
  }
  await page.addInitScript(
    ({ key, value }) => {
      localStorage.clear()
      localStorage.setItem(key, value)
    },
    { key: BACKGROUND_AUTOSAVE_KEY, value: JSON.stringify(legacy) },
  )
  await openGenerator(page)

  await expect(page.getByRole('radio', {
    name: '3D Logo',
    exact: true,
  })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('radio', {
    name: '9:16',
    exact: true,
  })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('radio', {
    name: 'Soft Diffusion',
    exact: true,
  })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('radio', {
    name: 'Atmospheric',
    exact: true,
  })).toHaveAttribute('aria-checked', 'true')
  await expect.poll(() =>
    page.evaluate((key) => {
      const recipe = JSON.parse(localStorage.getItem(key) ?? '{}')
      return {
        version: recipe.version,
        renderRevision: recipe.renderRevision,
        aspect: recipe.format?.aspect,
        presetId: recipe.gradientState?.presetId,
        packId: recipe.paletteState?.packId,
      }
    }, BACKGROUND_AUTOSAVE_KEY),
  ).toEqual({
    version: 3,
    renderRevision: 2,
    aspect: '9:16',
    presetId: 'soft-diffusion',
    packId: 'atmospheric',
  })

  await page.getByRole('radio', {
    name: 'Fine Smear',
    exact: true,
  }).click()
  await page.getByRole('radio', {
    name: 'Bold',
    exact: true,
  }).click()
  await page.getByRole('radio', {
    name: '1:1',
    exact: true,
  }).click()
  await page.getByRole('button', {
    name: 'Reset all',
    exact: true,
  }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Reset all?' })
  await dialog.getByRole('button', {
    name: 'Reset all',
    exact: true,
  }).click()
  await expect(page.getByRole('radio', {
    name: '16:9',
    exact: true,
  })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('radio', {
    name: 'Soft Diffusion',
    exact: true,
  })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('radio', {
    name: 'Atmospheric',
    exact: true,
  })).toHaveAttribute('aria-checked', 'true')
})

test('exports 4K PNGs that match the 2D and 3D previews', async ({ page }) => {
  await prepare(page, 'background')
  await openGenerator(page)
  await waitForFrames(page, 3)

  const backgroundParity = await exportParity(
    page,
    'canvas[data-renderer="looks"]',
  )
  expect(backgroundParity).toMatchObject({ width: 3840, height: 2160 })
  expect(backgroundParity.meanError).toBeLessThan(20)
  expect(backgroundParity.correlation).toBeGreaterThan(0.9)

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', {
    name: 'Export image',
    exact: true,
  }).click()
  const download = await downloadPromise
  const path = await download.path()
  expect(path).not.toBeNull()
  const png = await readFile(path!)
  expect(png.subarray(1, 4).toString()).toBe('PNG')
  expect(png.readUInt32BE(16)).toBe(3840)
  expect(png.readUInt32BE(20)).toBe(2160)

  await page.getByRole('radio', {
    name: '3D Logo',
    exact: true,
  }).click()
  await waitFor3D(page)
  const materialParity = await exportParity(
    page,
    '.lab-material-look-canvas',
  )
  expect(materialParity).toMatchObject({ width: 3840, height: 2160 })
  expect(materialParity.meanError).toBeLessThan(45)
  expect(materialParity.correlation).toBeGreaterThan(0.65)
})

test('keeps controls usable at desktop, laptop, and mobile sizes', async ({
  page,
}, testInfo) => {
  await prepare(page)
  await captureResponsiveView(page, testInfo, 1440, 1000)
  await captureResponsiveView(page, testInfo, 1280, 720)
  await captureResponsiveView(page, testInfo, 390, 844)
})
