import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import {
  BACKGROUND_AUTOSAVE_KEY,
  createDefaultBackgroundRecipe,
  dimensionsFor,
  type BackgroundRecipeV2,
  type FixedAspectId,
} from '../../src/features/background-generator/recipe'

const ASPECTS: FixedAspectId[] = ['16:9', '9:16', '1:1', '4:5']
const SEEDS = [42, 1913, 8675309] as const
const COMPLEXITIES = [
  { label: 'low', value: 0.15 },
  { label: 'mid', value: 0.5 },
  { label: 'high', value: 0.85 },
] as const
const ARTIFACT_ROOT = process.env.FRAME_LOOK_ARTIFACT_DIR ?? '/tmp/mbs-frame-look-audit'

type PreviewArtifact = {
  aspect: FixedAspectId
  seed: number
  complexity: string
  width: number
  height: number
  bytes: number
  path: string
  source: string
}

function slug(aspect: FixedAspectId): string {
  return aspect.replace(':', 'x')
}

function frameRecipe(
  aspect: FixedAspectId,
  seed: number,
  complexity: number,
): BackgroundRecipeV2 {
  const recipe = createDefaultBackgroundRecipe(seed)
  return {
    ...recipe,
    format: { aspect, ...dimensionsFor(aspect) },
    look: { id: 'frame', detail: complexity },
  }
}

async function openRecipe(browser: Browser, recipe: BackgroundRecipeV2): Promise<Page> {
  const page = await browser.newPage()
  await page.addInitScript(({ key, value }) => {
    localStorage.clear()
    localStorage.setItem(key, value)
  }, { key: BACKGROUND_AUTOSAVE_KEY, value: JSON.stringify(recipe) })
  await page.goto('/')
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible()
  await expect(page.locator('canvas[data-renderer="looks"]')).toBeVisible()
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
  return page
}

async function writeContactSheet(
  browser: Browser,
  aspect: FixedAspectId,
  artifacts: readonly PreviewArtifact[],
  testInfo: TestInfo,
): Promise<string> {
  const page = await browser.newPage()
  const source = await page.evaluate(async ({ aspect: requestedAspect, items }) => {
    const load = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = reject
      image.src = url
    })
    const images = await Promise.all(items.map((item) => load(item.source)))
    const portrait = requestedAspect === '9:16' || requestedAspect === '4:5'
    const tileWidth = portrait ? 280 : 360
    const tileHeight = portrait ? 410 : requestedAspect === '1:1' ? 350 : 250
    const labelHeight = 30
    const output = document.createElement('canvas')
    output.width = tileWidth * 3
    output.height = tileHeight * 3
    const context = output.getContext('2d')!
    context.fillStyle = '#101114'
    context.fillRect(0, 0, output.width, output.height)
    context.font = '600 14px system-ui, sans-serif'
    context.textBaseline = 'middle'

    items.forEach((item, index) => {
      const column = index % 3
      const row = Math.floor(index / 3)
      const x = column * tileWidth
      const y = row * tileHeight
      context.fillStyle = '#FFFFFF'
      context.fillText(
        `seed ${item.seed} · ${item.complexity}`,
        x + 10,
        y + labelHeight / 2,
      )
      const image = images[index]
      const availableHeight = tileHeight - labelHeight
      const scale = Math.min(tileWidth / image.width, availableHeight / image.height)
      const width = image.width * scale
      const height = image.height * scale
      context.drawImage(
        image,
        x + (tileWidth - width) / 2,
        y + labelHeight + (availableHeight - height) / 2,
        width,
        height,
      )
    })
    return output.toDataURL('image/png')
  }, { aspect, items: artifacts })
  await page.close()
  const path = `${ARTIFACT_ROOT}/frame-${slug(aspect)}-contact-sheet.png`
  const body = Buffer.from(source.split(',')[1], 'base64')
  await writeFile(path, body)
  await testInfo.attach(`frame-${slug(aspect)}-contact-sheet`, {
    body,
    contentType: 'image/png',
  })
  return path
}

test('renders the Frame audit matrix', async ({ browser }, testInfo) => {
  test.skip(
    process.env.FRAME_LOOK_AUDIT !== '1',
    'Run explicitly with FRAME_LOOK_AUDIT=1 for Frame visual artifacts.',
  )
  test.setTimeout(180_000)
  await mkdir(ARTIFACT_ROOT, { recursive: true })
  const artifacts: PreviewArtifact[] = []

  for (const aspect of ASPECTS) {
    for (const seed of SEEDS) {
      for (const complexity of COMPLEXITIES) {
        const page = await openRecipe(
          browser,
          frameRecipe(aspect, seed, complexity.value),
        )
        const canvas = page.locator('canvas[data-renderer="looks"]')
        const result = await canvas.evaluate((element: HTMLCanvasElement) => ({
          width: element.width,
          height: element.height,
          source: element.toDataURL('image/png'),
        }))
        await page.close()
        const path = `${ARTIFACT_ROOT}/frame-${slug(aspect)}-seed-${seed}-${complexity.label}.png`
        const body = Buffer.from(result.source.split(',')[1], 'base64')
        await writeFile(path, body)
        artifacts.push({
          aspect,
          seed,
          complexity: complexity.label,
          width: result.width,
          height: result.height,
          bytes: body.byteLength,
          path,
          source: result.source,
        })
      }
    }
  }

  const sheets: string[] = []
  for (const aspect of ASPECTS) {
    sheets.push(await writeContactSheet(
      browser,
      aspect,
      artifacts.filter((artifact) => artifact.aspect === aspect),
      testInfo,
    ))
  }
  const manifest = {
    generatedAt: new Date().toISOString(),
    sheets,
    images: artifacts.map((artifact) => ({
      aspect: artifact.aspect,
      seed: artifact.seed,
      complexity: artifact.complexity,
      width: artifact.width,
      height: artifact.height,
      bytes: artifact.bytes,
      path: artifact.path,
    })),
  }
  await writeFile(
    `${ARTIFACT_ROOT}/frame-preview-manifest.json`,
    `${JSON.stringify(manifest, null, 2)}\n`,
  )
})

test('measures cached and uncached Frame exports at 4K', async ({ browser }, testInfo) => {
  test.skip(
    process.env.FRAME_LOOK_AUDIT !== '1',
    'Run explicitly with FRAME_LOOK_AUDIT=1 for Frame 4K measurements.',
  )
  test.setTimeout(180_000)
  await mkdir(ARTIFACT_ROOT, { recursive: true })
  const timings: {
    aspect: FixedAspectId
    width: number
    height: number
    bytes: number
    coldMilliseconds: number
    warmMilliseconds: number
    path: string
  }[] = []

  for (const aspect of ASPECTS) {
    const page = await openRecipe(browser, frameRecipe(aspect, 1913, 0.85))
    const render = () => page.evaluate(async () => {
      const exportPng = (window as typeof window & {
        __lbsLabExportPng?: () => Promise<string>
      }).__lbsLabExportPng
      if (!exportPng) throw new Error('Dev export hook unavailable')
      const startedAt = performance.now()
      const source = await exportPng()
      const image = new Image()
      image.src = source
      await image.decode()
      return {
        source,
        width: image.width,
        height: image.height,
        milliseconds: performance.now() - startedAt,
      }
    })
    const cold = await render()
    const warm = await render()
    await page.close()
    const body = Buffer.from(warm.source.split(',')[1], 'base64')
    const path = `${ARTIFACT_ROOT}/frame-${slug(aspect)}-4k.png`
    await writeFile(path, body)
    expect(Math.max(warm.width, warm.height)).toBe(3840)
    timings.push({
      aspect,
      width: warm.width,
      height: warm.height,
      bytes: body.byteLength,
      coldMilliseconds: Math.round(cold.milliseconds * 10) / 10,
      warmMilliseconds: Math.round(warm.milliseconds * 10) / 10,
      path,
    })
  }

  const report = Buffer.from(`${JSON.stringify(timings, null, 2)}\n`)
  await writeFile(`${ARTIFACT_ROOT}/frame-4k-timings.json`, report)
  await testInfo.attach('frame-4k-timings', {
    body: report,
    contentType: 'application/json',
  })
})
