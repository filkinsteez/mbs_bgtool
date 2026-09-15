import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const stage = process.argv[2] || 'current'
const server = await createServer({ configFile: false, root, logLevel: 'error', resolve: { alias: { '@': path.join(root, 'src') } }, server: { host: '127.0.0.1', port: 0 } })
let browser
try {
  await server.listen()
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/scripts/look-thumbnails.html`)
  await page.waitForFunction(() => document.documentElement.dataset.thumbnails === 'ready')
  const results = await page.evaluate(async () => {
    const image = new Image(); image.src = '/scripts/fixtures/rendered-loop.png'; await image.decode()
    const { createLabSourceFromImage } = await import('/src/core/lab/sourceCache.ts')
    const source = createLabSourceFromImage(image, image.width, image.height)
    const { createDefaultBackgroundRecipe, renderExample, PALETTE_PACKS, colorMixForPack } = window
    const pack = PALETTE_PACKS.find(p => p.id === 'bold')
    const results = []
    for (const mode of ['2d', '3d']) for (const id of ['diffusion', 'halo', 'flow', 'smear']) {
      for (const control of ['complexity', 'softness', 'distortion', 'scale', 'folds', 'bleed', 'depth', 'reflow', 'grain']) {
        const recipe = createDefaultBackgroundRecipe(1913)
        recipe.palette = { packId: pack.id, mix: colorMixForPack(pack), ground: pack.colors.at(-1), ink: pack.colors[0] }
        recipe.look = { version: 'gradients', id, detail: .5, gradient: { softness: .65, distortion: .45, grain: 0, depth: .45, reflow: .5 } }
        const frames = []
        for (const value of [0, 1]) {
          if (control === 'complexity') recipe.look.detail = value
          else recipe.look.gradient[control] = value
          const canvas = renderExample(recipe, mode === '3d' ? source : null, 480)
          frames.push(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data)
        }
        let difference = 0
        for (let i = 0; i < frames[0].length; i++) if (i % 4 !== 3) difference += Math.abs(frames[0][i] - frames[1][i])
        difference /= frames[0].length * .75
        results.push({ mode, id, control, difference, pass: difference > .25 })
      }
    }
    return results
  })
  const directory = path.join(root, '.devshots/gradient-look-controls', stage)
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'results.json'), JSON.stringify(results, null, 2))
  const failures = results.filter(result => !result.pass)
  console.log(`${results.length - failures.length}/${results.length} visible controls change the artwork by more than 0.25/255.`)
  for (const result of failures) console.error(`${result.mode} ${result.id} ${result.control}: ${result.difference.toFixed(4)}/255`)
  if (failures.length) throw new Error('Inactive gradient controls; see saved results.')
  console.log(`Evidence: ${directory}`)
} finally {
  await browser?.close()
  await server.close()
}
