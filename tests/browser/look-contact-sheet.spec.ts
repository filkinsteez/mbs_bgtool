import { expect, test } from '@playwright/test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import {
  BACKGROUND_AUTOSAVE_KEY,
  createDefaultBackgroundRecipe,
  type FixedAspectId,
} from '../../src/features/background-generator/recipe'
import {
  analyzeImageMotionSequence,
  captureImageMotionFrame,
  NINE_FRAME_PHASES,
  renderBlurredMotionDifference,
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
] as const

const COMPLEXITIES = [
  { label: 'Low', value: 0.15 },
  { label: 'Mid', value: 0.5 },
  { label: 'High', value: 0.85 },
] as const
const STRUCTURAL_LOOKS = ['Pixels', 'Streams', 'Beads', 'Quilt', 'Weave'] as const
const FINAL_REDESIGN_LOOKS = ['Frame', 'Scanlines', 'Brushwork', 'Marks', 'Trails'] as const
const STRUCTURAL_SEEDS = [42, 1913, 8675309] as const
const STRUCTURAL_ASPECTS = ['16:9', '9:16', '1:1', '4:5'] as const
const FINAL_STRUCTURAL_AUDIT = process.env.FINAL_FIVE_STRUCTURAL_AUDIT === '1'
const FINAL_MOTION_AUDIT = process.env.FINAL_FIVE_MOTION_AUDIT === '1'
const FINAL_REDESIGN_AUDIT = FINAL_STRUCTURAL_AUDIT || FINAL_MOTION_AUDIT
const AUDIT_LOOKS = FINAL_REDESIGN_AUDIT ? FINAL_REDESIGN_LOOKS : STRUCTURAL_LOOKS
const STRUCTURAL_ARTIFACT_DIR = FINAL_REDESIGN_AUDIT
  ? '/tmp/mbs-final-five-structural-audit'
  : '/tmp/mbs-five-look-structural-audit'
const SELECTED_PALETTE = process.env.LOOK_PALETTE
const PALETTE_SUFFIX = SELECTED_PALETTE
  ? `-${SELECTED_PALETTE.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`
  : ''
const ARTIFACT_LABEL = process.env.LOOK_ARTIFACT_LABEL
const ARTIFACT_SUFFIX = ARTIFACT_LABEL
  ? `${PALETTE_SUFFIX}-${ARTIFACT_LABEL.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`
  : PALETTE_SUFFIX

test('builds a labeled contact sheet for every Look', async ({ page }, testInfo) => {
  test.skip(
    process.env.LOOK_CONTACT_SHEET !== '1',
    'Run explicitly with LOOK_CONTACT_SHEET=1 for visual review artifacts.',
  )
  await page.addInitScript(() => localStorage.clear())
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  if (SELECTED_PALETTE) {
    await page.getByRole('radio', { name: SELECTED_PALETTE, exact: true }).click()
  }
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
      `/tmp/mbs-look-${fileName}${ARTIFACT_SUFFIX}.png`,
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
  await writeFile(`/tmp/mbs-look-complexity-contact-sheet${ARTIFACT_SUFFIX}.png`, image)
  await testInfo.attach('look-contact-sheet', {
    body: image,
    contentType: 'image/png',
  })
})

test('builds a 3D full-frame Look contact sheet', async ({ page }, testInfo) => {
  test.skip(
    process.env.LOOK_3D_MATRIX !== '1',
    'Run explicitly with LOOK_3D_MATRIX=1 for material Look visual artifacts.',
  )
  await page.addInitScript(() => localStorage.clear())
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  if (SELECTED_PALETTE) {
    await page.getByRole('radio', { name: SELECTED_PALETTE, exact: true }).click()
  }
  await page.getByRole('radio', { name: '3D', exact: true }).click()

  const viewer = page.locator('[data-mbs-material-model="true"]')
  const modelCanvas = viewer.locator('.lab-material-model-canvas')
  const artboard = page.locator('#lab-generator-artboard')
  const complexity = page.getByRole('slider', { name: 'Complexity', exact: true })
  await expect(viewer).toHaveAttribute('data-model-status', 'ready')

  const samples: { label: string; src: string }[] = []
  for (const label of LOOKS) {
    const control = page.getByRole('button', { name: label, exact: true })
    await control.click()
    await expect(control).toHaveAttribute('aria-pressed', 'true')
    await expect(viewer).toHaveAttribute('data-look', label.toLowerCase())
    await expect(modelCanvas).toHaveAttribute('data-look', label.toLowerCase())
    await expect(modelCanvas).toHaveAttribute('data-render-status', 'ready')

    for (const level of COMPLEXITIES) {
      const previousRevision = await modelCanvas.getAttribute('data-render-revision')
      const sliderValue = String(Math.round(level.value * 100))
      await complexity.fill(sliderValue)
      await expect(complexity).toHaveValue(sliderValue)
      await expect.poll(
        () => modelCanvas.getAttribute('data-render-revision'),
      ).not.toBe(previousRevision)
      await expect(modelCanvas).toHaveAttribute('data-render-status', 'ready')
      samples.push({
        label: `${label} · ${level.label}`,
        src: `data:image/png;base64,${(await artboard.screenshot()).toString('base64')}`,
      })
    }
  }
  await Promise.all(samples.map((sample) => {
    const fileName = sample.label.toLowerCase().replaceAll(' · ', '-').replaceAll(' ', '-')
    return writeFile(
      `/tmp/mbs-look-3d-${fileName}${ARTIFACT_SUFFIX}.png`,
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
  await writeFile(`/tmp/mbs-look-3d-complexity-contact-sheet${ARTIFACT_SUFFIX}.png`, image)
  await testInfo.attach('look-3d-contact-sheet', {
    body: image,
    contentType: 'image/png',
  })
})

test('builds seed by aspect sheets for the selected structural Looks', async ({
  browser,
}, testInfo) => {
  test.setTimeout(180_000)
  test.skip(
    process.env.FIVE_LOOK_STRUCTURAL_AUDIT !== '1' && !FINAL_STRUCTURAL_AUDIT,
    'Run explicitly with a five-Look structural audit flag for visual evidence.',
  )
  await rm(STRUCTURAL_ARTIFACT_DIR, { recursive: true, force: true })
  await mkdir(STRUCTURAL_ARTIFACT_DIR, { recursive: true })
  const samples: {
    look: typeof AUDIT_LOOKS[number]
    seed: number
    aspect: FixedAspectId
    src: string
  }[] = []

  for (const seed of STRUCTURAL_SEEDS) {
    const recipe = createDefaultBackgroundRecipe(seed)
    recipe.look = { id: 'pixels', detail: 0.5, version: 'v2' }
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.addInitScript(({ key, savedRecipe }) => {
      localStorage.clear()
      localStorage.setItem(key, JSON.stringify(savedRecipe))
    }, { key: BACKGROUND_AUTOSAVE_KEY, savedRecipe: recipe })
    await page.goto('/')
    await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
    const canvas = page.locator('canvas[data-renderer="looks"]')
    const format = page.getByRole('region', { name: 'Aspect ratio', exact: true })
    await page.getByRole('slider', { name: 'Complexity', exact: true }).fill('50')

    for (const aspect of STRUCTURAL_ASPECTS) {
      await format.getByRole('radio', { name: aspect, exact: true }).click()
      for (const look of AUDIT_LOOKS) {
        await page.getByRole('radio', { name: look, exact: true }).click()
        await page.evaluate(() => new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        }))
        const src = await canvas.evaluate(
          (element: HTMLCanvasElement) => element.toDataURL('image/png'),
        )
        const fileName = `${look.toLowerCase()}-seed-${seed}-${aspect.replace(':', 'x')}.png`
        await writeFile(
          `${STRUCTURAL_ARTIFACT_DIR}/${fileName}`,
          Buffer.from(src.split(',')[1], 'base64'),
        )
        samples.push({ look, seed, aspect, src })
      }
    }
    await context.close()
  }

  const sheetContext = await browser.newContext()
  const sheetPage = await sheetContext.newPage()
  for (const look of AUDIT_LOOKS) {
    const lookSamples = samples.filter((sample) => sample.look === look)
    const sheetUrl = await sheetPage.evaluate(async (items) => {
      const load = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = reject
        image.src = src
      })
      const images = await Promise.all(items.map((item) => load(item.src)))
      const columns = 4
      const tileWidth = 300
      const titleHeight = 28
      const imageHeight = 235
      const tileHeight = titleHeight + imageHeight
      const output = document.createElement('canvas')
      output.width = columns * tileWidth
      output.height = 3 * tileHeight
      const context = output.getContext('2d')!
      context.fillStyle = '#101114'
      context.fillRect(0, 0, output.width, output.height)
      context.fillStyle = '#FFFFFF'
      context.font = '600 13px system-ui, sans-serif'
      context.textBaseline = 'middle'
      items.forEach((item, index) => {
        const column = index % columns
        const row = Math.floor(index / columns)
        const x = column * tileWidth
        const y = row * tileHeight
        context.fillText(
          `seed ${item.seed} · ${item.aspect}`,
          x + 9,
          y + titleHeight / 2,
        )
        const image = images[index]
        const scale = Math.min(tileWidth / image.width, imageHeight / image.height)
        const drawWidth = image.width * scale
        const drawHeight = image.height * scale
        context.drawImage(
          image,
          x + (tileWidth - drawWidth) / 2,
          y + titleHeight + (imageHeight - drawHeight) / 2,
          drawWidth,
          drawHeight,
        )
      })
      return output.toDataURL('image/png')
    }, lookSamples)
    const sheet = Buffer.from(sheetUrl.split(',')[1], 'base64')
    const sheetPath = `${STRUCTURAL_ARTIFACT_DIR}/${look.toLowerCase()}-seed-aspect-sheet.png`
    await writeFile(sheetPath, sheet)
    await testInfo.attach(`${look.toLowerCase()}-seed-aspect-sheet`, {
      body: sheet,
      contentType: 'image/png',
    })
  }
  await sheetContext.close()
  await writeFile(
    `${STRUCTURAL_ARTIFACT_DIR}/manifest.json`,
    Buffer.from(`${JSON.stringify(samples.map(({ look, seed, aspect }) => ({
      look,
      seed,
      aspect,
    })), null, 2)}\n`),
  )
})

test('builds exact-loop motion strips for the selected structural Looks', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  test.skip(
    process.env.FIVE_LOOK_MOTION_AUDIT !== '1' && !FINAL_MOTION_AUDIT,
    'Run explicitly with a five-Look motion audit flag for motion evidence.',
  )
  const motionDirectory = `${STRUCTURAL_ARTIFACT_DIR}/native-motion`
  await rm(motionDirectory, { recursive: true, force: true })
  await mkdir(motionDirectory, { recursive: true })
  const recipe = createDefaultBackgroundRecipe(1913)
  recipe.look = { id: 'pixels', detail: 0.85, version: 'v2' }
  recipe.motion = {
    enabled: true,
    amount: 0.78,
    speed: 1.72,
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
    ;(window as typeof window & { __setFiveLookTime?: (value: number) => void })
      .__setFiveLookTime = (value) => { controlledTime = value }
  }, { key: BACKGROUND_AUTOSAVE_KEY, savedRecipe: recipe })
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  const canvas = page.locator('canvas[data-renderer="looks"]')
  const setPhase = async (phase: number) => {
    await page.evaluate((value) => {
      ;(window as typeof window & { __setFiveLookTime?: (time: number) => void })
        .__setFiveLookTime?.(value * 8000)
    }, phase)
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    }))
  }
  const evidence: {
    look: string
    frames: string[]
    differences: string[]
  }[] = []
  const reports: Record<string, ReturnType<typeof analyzeImageMotionSequence>> = {}

  for (const look of AUDIT_LOOKS) {
    await page.getByRole('radio', { name: look, exact: true }).click()
    const frames: Awaited<ReturnType<typeof captureImageMotionFrame>>[] = []
    for (const phase of NINE_FRAME_PHASES) {
      await setPhase(phase)
      const frame = await captureImageMotionFrame(canvas, phase)
      frames.push(frame)
      const phaseLabel = phase === 1
        ? '1'
        : phase.toFixed(3).replace(/^0\./, '0p')
      await writeFile(
        `${motionDirectory}/${look.toLowerCase()}-phase-${phaseLabel}.png`,
        Buffer.from(frame.dataUrl.split(',')[1], 'base64'),
      )
    }

    await setPhase(1 / 4)
    const duplicate = await captureImageMotionFrame(canvas, 1 / 4)
    expect(
      duplicate.dataUrl,
      `${look} must deterministically replay an identical phase`,
    ).toBe(frames[2].dataUrl)

    const report = analyzeImageMotionSequence(frames)
    expect(report.seamExact, `${look} must close byte-exactly`).toBe(true)
    expect(report.meanCoarseEnergy, `${look} needs meso-scale movement`).toBeGreaterThan(0.0007)
    expect(report.minimumCoarseEnergy, `${look} cannot park between sampled phases`).toBeGreaterThan(0.00005)
    expect(report.meanChangedCoverage, `${look} motion must cover the composition`).toBeGreaterThan(0.04)
    expect(
      report.meanDisplacedBlockCoverage,
      `${look} must show coherent block displacement`,
    ).toBeGreaterThan(0.08)
    expect(report.maximumShimmerRatio, `${look} cannot rely on fine shimmer`).toBeLessThan(0.94)
    expect(report.minimumTopologyRetention, `${look} topology cannot pop`).toBeGreaterThan(0.56)
    expect(report.topologyEnergyDrift, `${look} topology energy must stay stable`).toBeLessThan(0.42)
    reports[look] = report
    await writeFile(
      `${motionDirectory}/${look.toLowerCase()}-motion-report.json`,
      Buffer.from(`${JSON.stringify(report, null, 2)}\n`),
    )

    const differences = await Promise.all(frames.map((frame, index) =>
      renderBlurredMotionDifference(
        page,
        index === 0 ? frame.dataUrl : frames[index - 1].dataUrl,
        frame.dataUrl,
        index === 0 ? [] : report.pairs[index - 1].flows,
      )))
    evidence.push({
      look,
      frames: frames.map((frame) => frame.dataUrl),
      differences,
    })
  }
  await writeFile(
    `${motionDirectory}/motion-report.json`,
    Buffer.from(`${JSON.stringify(reports, null, 2)}\n`),
  )

  const sheet = await page.evaluate(async ({ rows, phases }) => {
    const load = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = reject
      image.src = src
    })
    const columns = phases.length
    const tileWidth = 240
    const titleHeight = 25
    const imageHeight = 135
    const rowHeight = titleHeight + imageHeight * 2 + 20
    const output = document.createElement('canvas')
    output.width = columns * tileWidth
    output.height = rows.length * rowHeight
    const context = output.getContext('2d')!
    context.fillStyle = '#101114'
    context.fillRect(0, 0, output.width, output.height)
    context.fillStyle = '#FFFFFF'
    context.font = '600 12px system-ui, sans-serif'
    context.textBaseline = 'middle'
    for (let row = 0; row < rows.length; row += 1) {
      const item = rows[row]
      const frameImages = await Promise.all(item.frames.map(load))
      const differenceImages = await Promise.all(item.differences.map(load))
      const y = row * rowHeight
      frameImages.forEach((image, column) => {
        const x = column * tileWidth
        context.fillStyle = '#101114'
        context.fillRect(x, y, tileWidth, titleHeight)
        context.fillStyle = '#FFFFFF'
        context.fillText(
          `${item.look} · ${phases[column].toFixed(3)}`,
          x + 8,
          y + titleHeight / 2,
        )
        context.drawImage(image, x, y + titleHeight, tileWidth, imageHeight)
        context.drawImage(
          differenceImages[column],
          x,
          y + titleHeight + imageHeight,
          tileWidth,
          imageHeight,
        )
      })
    }
    return output.toDataURL('image/png')
  }, { rows: evidence, phases: [...NINE_FRAME_PHASES] })
  const artifact = Buffer.from(sheet.split(',')[1], 'base64')
  const motionName = FINAL_REDESIGN_AUDIT
    ? 'final-five-nine-frame-motion-strips.png'
    : 'five-look-nine-frame-motion-strips.png'
  await writeFile(`${STRUCTURAL_ARTIFACT_DIR}/${motionName}`, artifact)
  await testInfo.attach(motionName, {
    body: artifact,
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
    const saveArtifact = [
      'Frame',
      'Pixels',
      'Streams',
      'Brushwork',
      'Beads',
      'Quilt',
      'Weave',
      'Scanlines',
      'Marks',
      'Trails',
    ].includes(look)
    const result = await page.evaluate(async (includeSource) => {
      const exportPng = (window as unknown as {
        __lbsLabExportPng?: () => Promise<string>
      }).__lbsLabExportPng
      if (!exportPng) throw new Error('Dev export hook unavailable')
      const startedAt = performance.now()
      const image = new Image()
      const source = await exportPng()
      image.src = source
      await image.decode()
      return {
        width: image.width,
        height: image.height,
        milliseconds: performance.now() - startedAt,
        source: includeSource ? source : null,
      }
    }, saveArtifact)
    expect(result).toMatchObject({ width: 3840, height: 2160 })
    if (result.source) {
      await writeFile(
        `/tmp/mbs-look-${look.toLowerCase()}-4k.png`,
        Buffer.from(result.source.split(',')[1], 'base64'),
      )
    }
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
  const format = page.getByRole('region', { name: 'Aspect ratio', exact: true })

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

test('measures Look interaction timing and brush resource reuse', async ({ page }, testInfo) => {
  test.skip(
    process.env.LOOK_RUNTIME_AUDIT !== '1',
    'Run explicitly with LOOK_RUNTIME_AUDIT=1 for runtime measurements.',
  )
  test.setTimeout(120_000)
  await page.addInitScript(() => {
    const state = {
      webglContextCalls: 0,
      canvases: [] as HTMLCanvasElement[],
    }
    ;(window as typeof window & {
      __mbsBrushResourceAudit?: typeof state
    }).__mbsBrushResourceAudit = state
    const nativeGetContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      contextId: string,
      ...args: unknown[]
    ) {
      if (
        (contextId === 'webgl' || contextId === 'webgl2')
        && !this.isConnected
      ) {
        state.webglContextCalls += 1
        if (!state.canvases.includes(this)) state.canvases.push(this)
      }
      return Reflect.apply(nativeGetContext, this, [contextId, ...args])
    } as typeof HTMLCanvasElement.prototype.getContext
  })
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  const waitForFrames = () => page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
  const runtimeSnapshot = () => page.evaluate(() => {
    const state = (window as typeof window & {
      __mbsBrushResourceAudit?: {
        webglContextCalls: number
        canvases: HTMLCanvasElement[]
      }
    }).__mbsBrushResourceAudit
    return {
      resourceCount: performance.getEntriesByType('resource').length,
      domCanvasCount: document.querySelectorAll('canvas').length,
      webglContextCalls: state?.webglContextCalls ?? 0,
      offscreenWebglCanvasCount: state?.canvases.length ?? 0,
    }
  })

  const twoDimensional: { look: string; milliseconds: number }[] = []
  for (const look of LOOKS) {
    const startedAt = await page.evaluate(() => performance.now())
    await page.getByRole('radio', { name: look, exact: true }).click()
    await waitForFrames()
    const completedAt = await page.evaluate(() => performance.now())
    twoDimensional.push({
      look,
      milliseconds: Math.round((completedAt - startedAt) * 10) / 10,
    })
  }

  await page.getByRole('radio', { name: 'Brushwork', exact: true }).click()
  await waitForFrames()
  const brushFirst = await runtimeSnapshot()
  const complexity = page.getByRole('slider', { name: 'Complexity', exact: true })
  for (let iteration = 0; iteration < 8; iteration += 1) {
    await page.getByRole('radio', { name: 'Frame', exact: true }).click()
    await page.getByRole('radio', { name: 'Brushwork', exact: true }).click()
    await complexity.fill(iteration % 2 === 0 ? '15' : '85')
    await waitForFrames()
  }
  const brushRepeated = await runtimeSnapshot()

  await page.getByRole('radio', { name: '3D', exact: true }).click()
  const viewer = page.locator('[data-mbs-material-model="true"]')
  const modelCanvas = viewer.locator('.lab-material-model-canvas')
  await expect(viewer).toHaveAttribute('data-model-status', 'ready')
  const threeDimensional: { look: string; milliseconds: number }[] = []
  for (const look of LOOKS) {
    const previousRevision = await modelCanvas.getAttribute('data-render-revision')
    const startedAt = await page.evaluate(() => performance.now())
    await page.getByRole('button', { name: look, exact: true }).click()
    await expect.poll(
      () => modelCanvas.getAttribute('data-render-revision'),
    ).not.toBe(previousRevision)
    await expect(modelCanvas).toHaveAttribute('data-render-status', 'ready')
    const completedAt = await page.evaluate(() => performance.now())
    threeDimensional.push({
      look,
      milliseconds: Math.round((completedAt - startedAt) * 10) / 10,
    })
  }

  const report = {
    twoDimensional,
    threeDimensional,
    brushResources: {
      first: brushFirst,
      afterRepeatedSelection: brushRepeated,
    },
  }
  const body = Buffer.from(`${JSON.stringify(report, null, 2)}\n`)
  await writeFile('/tmp/mbs-look-runtime-audit.json', body)
  await testInfo.attach('look-runtime-audit.json', {
    body,
    contentType: 'application/json',
  })

  expect(Math.max(...twoDimensional.map((entry) => entry.milliseconds))).toBeLessThan(2_500)
  expect(Math.max(...threeDimensional.map((entry) => entry.milliseconds))).toBeLessThan(5_000)
  expect(brushRepeated.offscreenWebglCanvasCount)
    .toBe(brushFirst.offscreenWebglCanvasCount)
  expect(brushRepeated.domCanvasCount).toBe(brushFirst.domCanvasCount)
  expect(brushRepeated.resourceCount).toBeLessThanOrEqual(brushFirst.resourceCount + 1)
})
