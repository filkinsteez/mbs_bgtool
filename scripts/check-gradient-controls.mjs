import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const server = await createServer({ configFile: false, root, logLevel: 'error', resolve: { alias: { '@': path.join(root, 'src') } }, server: { host: '127.0.0.1', port: 0 } })
let browser
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }) })
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/scripts/look-thumbnails.html`)
  await page.waitForFunction(() => document.documentElement.dataset.thumbnails === 'ready')
  const result = await page.evaluate(async () => {
    const { createDefaultBackgroundRecipe, renderExample, materialExample } = window
    const artifacts = [], results = [], failures = new Set()
    const pixels = c => c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    const difference = (a, b) => a.reduce((sum, value, i) => sum + (i % 4 === 3 ? 0 : Math.abs(value - b[i])), 0) / (a.length * 0.75)
    const assert = (ok, message) => { if (!ok) failures.add(message) }
    const source = materialExample(), moved = materialExample(0.23)
    const image = new Image(); image.src = '/scripts/fixtures/rendered-loop.png'; await image.decode()
    const { createLabSourceFromImage } = await import('/src/core/lab/sourceCache.ts')
    const canonical = createLabSourceFromImage(image, image.width, image.height)
    const opaqueRgba = new Uint8ClampedArray(source.maps.rgba)
    for (let i = 3; i < opaqueRgba.length; i += 4) opaqueRgba[i] = 255
    const frameOnly = { ...source, hash: `${source.hash}-frame-only`, aux: undefined, maps: { ...source.maps, rgba: opaqueRgba } }
    const uniformRgba = new Uint8ClampedArray(opaqueRgba.length)
    for (let i = 0; i < uniformRgba.length; i += 4) uniformRgba.set([51, 104, 192, 255], i)
    const uniform = { ...frameOnly, hash: 'uniform-rendered-frame', maps: { ...source.maps, rgba: uniformRgba } }
    const warmRgba = new Uint8ClampedArray(opaqueRgba)
    for (let i = 0; i < warmRgba.length; i += 4) if (source.maps.rgba[i + 3] > 0) {
      warmRgba[i] = opaqueRgba[i + 2]
      warmRgba[i + 1] = opaqueRgba[i] * 0.45
      warmRgba[i + 2] = opaqueRgba[i] * 0.2
    }
    const warm = { ...frameOnly, hash: 'warm-rendered-frame', maps: { ...source.maps, rgba: warmRgba } }
    const outsideDifference = (a, b) => {
      let sum = 0, count = 0
      for (let y = 0; y < 270; y++) for (let x = 0; x < 480; x++) {
        const si = (Math.min(215, Math.floor(y * 216 / 270)) * 384 + Math.min(383, Math.floor(x * 384 / 480))) * 4
        if (source.maps.rgba[si + 3] || moved.maps.rgba[si + 3]) continue
        const i = (y * 480 + x) * 4
        for (let c = 0; c < 3; c++) sum += Math.abs(a[i + c] - b[i + c])
        count++
      }
      return sum / (count * 3)
    }
    for (const id of ['diffusion', 'halo', 'flow', 'smear']) {
      const failureCount=failures.size
      let maxGreen = 0, maxExportError = 0, minMovement = Infinity, maxStep = 0
      for (const seed of [1913, 9027, 14023]) {
        const recipe = createDefaultBackgroundRecipe(seed)
        recipe.palette = { packId: 'custom', ink: '#FFD61E', ground: '#25C8EE', mix: [
          { color: '#10345E', enabled: true, ratio: 0 },
          { color: '#FFD61E', enabled: true, ratio: 54 },
          { color: '#FF4F00', enabled: true, ratio: 20 },
          { color: '#25C8EE', enabled: true, ratio: 20 },
        ] }
        recipe.look = { version: 'gradients', id, detail: 0.5, gradient: { softness: 0.65, distortion: 0.45, grain: 0, reflow: 0.5 } }
        const frames = []
        for (const reflow of [0.1, 0.101, 0.5, 0.9]) {
          recipe.look.gradient.reflow = reflow
          const c = renderExample(recipe, null, 480), p = pixels(c)
          frames.push(p)
          const actual3d = renderExample(recipe, canonical, 480)
          for (const sample of [p, pixels(actual3d)]) {
            let greens = 0
            for (let i = 0; i < sample.length; i += 4) {
            const [r, g, b] = sample.slice(i, i + 3), v = Math.max(r, g, b), d = v - Math.min(r, g, b)
            const hue = d ? (v === r ? ((g - b) / d + 6) % 6 : v === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 : 0
            if (hue > 75 && hue < 165 && d / Math.max(v, 1) > 0.5) greens++
            }
            maxGreen = Math.max(maxGreen, greens / (sample.length / 4))
          }
          if (seed === 1913 && reflow === 0.5) {
            artifacts.push({ name: `yellow-cyan-${id}`, dataUrl: c.toDataURL() })
            artifacts.push({ name: `yellow-cyan-3d-${id}`, dataUrl: actual3d.toDataURL() })
          }
        }
        minMovement = Math.min(minMovement, difference(frames[0], frames[3]))
        maxStep = Math.max(maxStep, difference(frames[0], frames[1]))
        recipe.look.gradient.reflow = 0.72
        if (seed === 1913) for (const input of [null, source]) {
          const c = renderExample(recipe, input, 480), expected = pixels(c)
          const exported = renderExample(recipe, input, 3840)
          assert(exported.width === 3840, `${id}: export resolution`)
          c.getContext('2d').drawImage(exported, 0, 0, c.width, c.height)
          maxExportError = Math.max(maxExportError, difference(expected, pixels(c)))
        }
        if (seed === 1913) {
          // The extended controls create narrower deposits and source filters.
          // Check those ends of the range at native export resolution as well.
          const extreme = structuredClone(recipe)
          if (id === 'diffusion') extreme.look.detail = 1
          else if (id === 'halo') extreme.look.detail = 1
          else if (id === 'flow') extreme.look.gradient.depth = 1
          else extreme.look.gradient.softness = 1
          const input = id === 'flow' || id === 'halo' ? source : null
          const c = renderExample(extreme, input, 480), expected = pixels(c)
          const exported = renderExample(extreme, input, 3840)
          c.getContext('2d').drawImage(exported, 0, 0, c.width, c.height)
          const error = difference(expected, pixels(c))
          assert(error < 3, `${id}: extended control range differs from 4K by ${error}/255`)
          maxExportError = Math.max(maxExportError, error)
        }
        const model = renderExample(recipe, source, 480), modelPixels = pixels(model)
        const changed = renderExample(recipe, moved, 480)
        const placementDifference=difference(modelPixels,pixels(changed))
        assert(placementDifference > 5, `${id}, seed ${seed}: model placement changes only ${placementDifference.toFixed(3)}/255`)
        assert(outsideDifference(modelPixels, pixels(changed)) > 2, `${id}: moving the loop does not drive the surrounding background`)
        const warmChange = outsideDifference(modelPixels, pixels(renderExample(recipe, warm, 480)))
        assert(warmChange > 2, `${id}, seed ${seed}: loop color outer-frame change is ${warmChange.toFixed(3)}/255`)
        const uniformPixels = pixels(renderExample(recipe, uniform, 480))
        for (let i = 0; i < uniformPixels.length; i += 4) for (let c = 0; c < 3; c++) {
          assert(Math.abs(uniformPixels[i + c] - uniformPixels[c]) <= 1, `${id}: generates independent shapes over an empty source`)
        }
        const otherPalette = structuredClone(recipe)
        otherPalette.palette = { packId: 'custom', ink: '#FF4F00', ground: '#FF4F00', mix: [{ color: '#FF4F00', enabled: true, ratio: 100 }] }
        const recolored = pixels(renderExample(otherPalette, source, 480))
        assert(difference(modelPixels, recolored) > 10, `${id}: Look palette has no effect on the loop-derived image`)
        for (let i = 0; i < recolored.length; i += 4) for (let c = 0; c < 3; c++) {
          assert(Math.abs(recolored[i + c] - [255, 79, 0][c]) <= 2, `${id}: single selected color is contaminated by source colors`)
        }
        const reweighted = structuredClone(recipe)
        reweighted.palette.mix = reweighted.palette.mix.map(item => ({ ...item, ratio: item.ratio > 0 ? (item.color === '#FF4F00' ? 90 : 5) : 0 }))
        assert(difference(modelPixels, pixels(renderExample(reweighted, source, 480))) > 3, `${id}: palette weight changes have no effect`)
        const swappedRoles = structuredClone(recipe)
        ;[swappedRoles.palette.ink, swappedRoles.palette.ground] = [recipe.palette.ground, recipe.palette.ink]
        assert(difference(modelPixels, pixels(renderExample(swappedRoles, source, 480))) > 3, `${id}: background/marks role swap has no effect`)
        const zeroRemoved = structuredClone(recipe)
        zeroRemoved.palette.mix = zeroRemoved.palette.mix.filter(item => item.ratio > 0)
        assert(difference(modelPixels, pixels(renderExample(zeroRemoved, source, 480))) === 0, `${id}: zero-weight colors remain in the source palette`)
        assert(difference(modelPixels, pixels(renderExample(recipe, null, 480))) > 5, `${id}: captured rendered scene is missing beneath the layer`)
        assert(difference(modelPixels, pixels(renderExample(recipe, frameOnly, 480))) === 0, `${id}: layer depends on model normals, depth or silhouette alpha`)
        recipe.look.gradient.reflow = 0.73
        const reflowStep = difference(modelPixels, pixels(renderExample(recipe, source, 480)))
        assert(reflowStep > 0.1, `${id}, seed ${seed}: 3D Reflow step is ${reflowStep}`)
        recipe.look.gradient.reflow = 0.1
        const a = pixels(renderExample(recipe, source, 480))
        recipe.look.gradient.reflow = 0.9
        const b = pixels(renderExample(recipe, source, 480))
        let backgroundChange = 0, backgroundPixels = 0
        for (let y = 0; y < 270; y++) for (let x = 0; x < 480; x++) if (x < 70 || x > 410) {
          const i = (y * 480 + x) * 4
          for (let c = 0; c < 3; c++) backgroundChange += Math.abs(a[i + c] - b[i + c])
          backgroundPixels++
        }
        const outerChange = backgroundChange / (backgroundPixels * 3)
        assert(outerChange > 2, `${id}, seed ${seed}: Reflow outer-edge change is only ${outerChange.toFixed(3)}/255`)
        recipe.palette.mix = [{ color: '#24D366', enabled: true, ratio: 100 }]
        const selectedGreen = pixels(renderExample(recipe, null, 120))
        assert(Math.abs(selectedGreen[0] - 36) < 2 && Math.abs(selectedGreen[1] - 211) < 2 && Math.abs(selectedGreen[2] - 102) < 2, `${id}: selected green was altered`)
        recipe.palette = createDefaultBackgroundRecipe(seed).palette
        recipe.look.gradient.depth = 0
        recipe.look.gradient.reflow = 0.5
        const flatBlue = pixels(renderExample(recipe, null, 480))
        for (let i = 0; i < flatBlue.length; i += 4) {
          assert(Math.max(flatBlue[i], flatBlue[i + 1], flatBlue[i + 2]) >= 125, `${id}: invalid/dark pixels in the zero-Depth primary palette`)
        }
        const lowDepth = createDefaultBackgroundRecipe(seed)
        const bold = window.PALETTE_PACKS.find(pack => pack.id === 'bold')
        lowDepth.palette = { packId: bold.id, mix: window.colorMixForPack(bold), ground: bold.colors.at(-1), ink: bold.colors[0] }
        lowDepth.look = { version: 'gradients', id, detail: 0.55, gradient: { softness: 0.7, distortion: 0.06, folds: 0, bleed: 0.67, grain: 0, reflow: 0.58, depth: 0.09 } }
        const lowPixels = pixels(renderExample(lowDepth, null, 480))
        let bluePixels = 0
        for (let i = 0; i < lowPixels.length; i += 4) {
          const [r, g, b] = lowPixels.slice(i, i + 3)
          if (b > r * 1.12 && b > g * 1.06 && b - Math.min(r, g) > 45) bluePixels++
        }
        assert(bluePixels / (lowPixels.length / 4) > 0.02, `${id}: low Depth averages away the dominant brand blue`)
      }
      assert(maxGreen < 0.005, `${id}: unintended saturated green covers ${maxGreen * 100}%`)
      assert(minMovement > 5 && maxStep < 3, `${id}: Reflow discontinuity or insufficient movement`)
      assert(maxExportError < 3, `${id}: 4K differs by ${maxExportError}/255`)
      results.push(`${id}: ${failures.size===failureCount?'PASS':'FAIL'}; 3 seeds; saturated green ${(maxGreen * 100).toFixed(3)}%; Reflow full-range difference ${minMovement.toFixed(2)}, small step ${maxStep.toFixed(2)}; source, blank, palette, weights, roles and independence checks ${failures.size===failureCount?'passed':'have failures (see failures.txt)'}; 2D/3D 4K error ${maxExportError.toFixed(2)}/255`)
    }
    return { results, artifacts, failures: [...failures] }
  })
  const directory = path.resolve(root, '.devshots/gradient-controls')
  await mkdir(directory, { recursive: true })
  for (const item of result.artifacts) await writeFile(path.join(directory, `${item.name}.png`), Buffer.from(item.dataUrl.split(',')[1], 'base64'))
  await writeFile(path.join(directory, 'checks.txt'), result.results.join('\n'))
  await writeFile(path.join(directory, 'failures.txt'), result.failures.join('\n'))
  if (result.failures.length) throw Error(result.failures.join('\n'))
  console.log(result.results.join('\n'))
} finally {
  await browser?.close()
  await server.close()
}
