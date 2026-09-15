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
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/scripts/look-thumbnails.html`)
  await page.waitForFunction(() => document.documentElement.dataset.thumbnails === 'ready')
  const results = await page.evaluate(async () => {
    const contexts = []
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      const value = original.call(this, type, ...args)
      if (type === 'webgl2' && value && !contexts.includes(value)) contexts.push(value)
      return value
    }
    const image = new Image(); image.src = '/scripts/fixtures/rendered-loop.png'; await image.decode()
    const { createLabSourceFromImage } = await import('/src/core/lab/sourceCache.ts')
    const source = createLabSourceFromImage(image, image.width, image.height)
    const recipe = window.createDefaultBackgroundRecipe(1913)
    const pack = window.PALETTE_PACKS.find(p => p.id === 'bold')
    recipe.palette = { packId: pack.id, mix: window.colorMixForPack(pack), ground: pack.colors.at(-1), ink: pack.colors[0] }
    recipe.look = { version: 'gradients', id: 'flow', detail: .5, gradient: { grain: 0 } }
    const pixels = canvas => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    const difference = (a, b) => a.reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0) / a.length
    const baseline = pixels(window.renderExample(recipe, source, 480))
    recipe.look.id='smear'
    const smearBaseline=pixels(window.renderExample(recipe,source,480))
    for (const id of ['halo', 'smear', 'diffusion', 'flow']) {
      recipe.look.id = id
      window.renderExample(recipe, source, 480)
    }
    const switched = pixels(window.renderExample(recipe, source, 480))
    const switching = difference(baseline, switched)
    if (contexts.length !== 1 || switching > .1) throw Error(`Program switch changed output: ${switching}; ${contexts.length} contexts`)
    recipe.look.id='smear'
    const smearSwitching=difference(smearBaseline,pixels(window.renderExample(recipe,source,480)))
    if(smearSwitching>.1)throw Error(`Smear program switch changed output: ${smearSwitching}`)
    const gl = contexts[0], extension = gl.getExtension('WEBGL_lose_context')
    if (!extension) throw Error('Context-loss verification unavailable')
    const contextEvent = name => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${name}`)), 15000)
      gl.canvas.addEventListener(name, () => { clearTimeout(timer); resolve() }, { once: true })
    })
    const lost = contextEvent('webglcontextlost')
    extension.loseContext(); await lost
    const restored = contextEvent('webglcontextrestored')
    setTimeout(() => extension.restoreContext(), 0)
    await restored
    const smearRecovery=difference(smearBaseline,pixels(window.renderExample(recipe,source,480)))
    if(smearRecovery>.1)throw Error(`Smear context restore changed output: ${smearRecovery}`)
    recipe.look.id='flow'
    const recovery = difference(baseline, pixels(window.renderExample(recipe, source, 480)))
    if (recovery > .1) throw Error(`Context restore changed output: ${recovery}`)
    const timings = {}
    for(const id of ['flow','smear']) {
      recipe.look.id=id
      timings[id]=[]
      window.renderExample(recipe, source, 1200)
      for (const reflow of [.3, .4, .5, .6, .7]) {
        recipe.look.gradient.reflow = reflow
        const start = performance.now()
        pixels(window.renderExample(recipe, source, 1200))
        timings[id].push(performance.now() - start)
      }
    }
    HTMLCanvasElement.prototype.getContext = original
    return { switching, recovery, smearSwitching, smearRecovery, contexts: contexts.length, warmRenderWithReadbackMilliseconds: timings }
  })
  const directory = path.join(root, '.devshots/gradient-programs')
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'checks.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results))
} finally { await browser?.close(); await server.close() }
