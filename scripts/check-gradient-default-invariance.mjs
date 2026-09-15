import path from 'node:path'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.resolve(root, '../../outputs/gradient-recovery/203-default-invariance')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const captures = []
try {
  for (const variant of ['baseline', 'old-diffusion', 'old-flow-source', 'current']) {
    const baseline = variant !== 'current'
    const oldNames = variant === 'baseline' ? ['diffusion.ts', 'flowSource.ts'] : variant === 'old-diffusion' ? ['diffusion.ts'] : ['flowSource.ts']
    const server = await createServer({ configFile: false, root, logLevel: 'error', resolve: { alias: { '@': path.join(root, 'src') } }, server: { host: '127.0.0.1', port: 0 },
      plugins: baseline ? [{ name: 'baseline-gradient-source', enforce: 'pre', async transform(code, id) {
        const name = path.basename(id)
        if (id.replaceAll('\\', '/').includes('/src/core/lab/gradients/') && oldNames.includes(name)) {
          return { code: await readFile(path.resolve(root, '../../outputs/gradient-recovery/199-source', name), 'utf8'), map: null }
        }
      } }] : [],
    })
    let page
    try {
      await server.listen()
      page = await browser.newPage()
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/scripts/look-thumbnails.html`)
      await page.waitForFunction(() => document.documentElement.dataset.thumbnails === 'ready')
      const frames = await page.evaluate(async () => {
        const image = new Image(); image.src = '/scripts/fixtures/rendered-loop.png'; await image.decode()
        const { createLabSourceFromImage } = await import('/src/core/lab/sourceCache.ts')
        const source = createLabSourceFromImage(image, image.width, image.height)
        const pack = window.PALETTE_PACKS.find(p => p.id === 'bold')
        const recipe = window.createDefaultBackgroundRecipe(1913)
        recipe.palette = { packId: pack.id, mix: window.colorMixForPack(pack), ground: pack.colors.at(-1), ink: pack.colors[0] }
        recipe.look = { version: 'gradients', id: 'flow', detail: .5, gradient: { softness: .65, distortion: .45, grain: 0, depth: .45, reflow: .5 } }
        return [null, source].map(input => {
          const canvas = window.renderExample(recipe, input, 480)
          return { pixels: Array.from(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data), image: canvas.toDataURL() }
        })
      })
      for (const [i, frame] of frames.entries()) await writeFile(path.join(output, `${variant}-${i === 0 ? '2d' : '3d'}-flow.png`), Buffer.from(frame.image.split(',')[1], 'base64'))
      captures.push({ variant, frames })
    } finally { await page?.close(); await server.close() }
  }
  const results = captures.slice(1).flatMap(capture => captures[0].frames.map((frame, mode) => ({ variant: capture.variant, mode: mode === 0 ? '2d' : '3d', mean: frame.pixels.reduce((sum, v, i) => sum + Math.abs(v - capture.frames[mode].pixels[i]), 0) / frame.pixels.length })))
  await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2))
  console.log(results)
  if (results.some(row => row.mean > .1)) throw Error('Default Flow changed beyond roundoff')
} finally { await browser.close() }
