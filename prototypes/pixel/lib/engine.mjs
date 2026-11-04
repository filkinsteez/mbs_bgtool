// Opens the Pixel harness page (prototypes/pixel/harness) in the engine harness's headless browser and wraps its
// calls: compose a look the way the tool does, then render it and run the output pass with Pixel at some strengths.
import { startHarness } from '../../../scripts/light/lib/harness.mjs'

export const LOOKS = {
  ramp: 'sunset.ramp',
  bands: 'sunset.bands',
  blooms: 'sunset.blooms',
  rim: 'contour.rim',
  halo: 'contour.halo',
  beam: 'contour.beam',
  streaks: 'contour.streaks',
}

export const CONTROLS = { intensity: 0.5, softness: 0.5, mood: 0.5 }

export async function openPixelPage() {
  const harness = await startHarness()
  const pageErrors = []
  harness.page.on('pageerror', (error) => pageErrors.push(error.message))
  try {
    await harness.page.goto(`http://127.0.0.1:${harness.port}/prototypes/pixel/harness/index.html`)
    const deadline = Date.now() + 60_000
    while (!(await harness.page.evaluate(() => document.documentElement.dataset.pixel === 'ready'))) {
      if (pageErrors.length > 0) throw new Error(pageErrors.join('\n'))
      if (Date.now() > deadline) throw new Error('pixel harness page timed out')
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  } catch (error) {
    await harness.close()
    throw error
  }

  return {
    /** The tool's scene, or a reason it could not be made (the look's files may be mid-edit). */
    async compose(look, pack, seed, width, height) {
      const recipe = LOOKS[look]
      if (!recipe) throw new Error(`Unknown look ${look}`)
      try {
        const scene = await harness.page.evaluate(
          ([id, packId, s, controls, aspect]) => window.pixelHarness.compose(id, packId, controls, s, aspect),
          [recipe, pack, seed, CONTROLS, width / height],
        )
        return scene ? { scene } : { failure: 'the look did not load' }
      } catch (error) {
        return { failure: `compose failed: ${error.message.split('\n')[0]}` }
      }
    },

    /**
     * RGBA bytes of the frame without filters and with Pixel at each strength, top row first. `source` is 'frame' or
     * 'small' (the renderer's way: a small copy of the frame drawn for the filter).
     */
    async render(scene, width, height, strengths, key, source = 'frame') {
      const { ms } = await harness.page.evaluate((request) => window.pixelHarness.render(request), { scene, width, height, strengths, upload: key, source })
      return {
        ms,
        input: harness.takeUpload(`${key}-input`),
        outputs: new Map(strengths.map((s) => [s, harness.takeUpload(`${key}-${s}`)])),
      }
    },

    close: () => harness.close(),
  }
}
