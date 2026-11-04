// The settled frame after a drag against the same scene loaded fresh from the URL the drag left: they should be the
// same pixels, so moving frames drawn smaller leave no trace. Usage: node settled-after-drag.mjs [--look rim]
import { chromium } from '@playwright/test'
import sharp from 'sharp'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []),
)
const url = args.url ?? 'http://localhost:3000'
const look = args.look ?? 'rim'
const mood = ['ramp', 'bands', 'blooms'].includes(look) ? 'sunset' : 'contour'
const dial = mood === 'sunset' ? 'horizon' : 'light'
const settled = (page) => page.waitForFunction(() => document.querySelector('canvas.tool-canvas')?.dataset.settled === 'true', null, { timeout: 120_000 })
const shot = async (page) => sharp(await page.locator('canvas.tool-canvas').screenshot()).removeAlpha().raw().toBuffer({ resolveWithObject: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
  await page.goto(`${url}/?mood=${mood}&look=${look}&pack=bold&intensity=0.5&softness=0.5&${dial}=0.5&seed=3&format=16x9`, { waitUntil: 'load' })
  await settled(page)
  await page.waitForTimeout(1000)
  // A slider moved in quick steps (exact values, unlike a dragged line, which the URL rounds), so frames are drawn
  // smaller while it moves.
  const scales = []
  await page.evaluate(() => {
    window.__scales = []
    const canvas = document.querySelector('canvas.tool-canvas')
    new MutationObserver(() => window.__scales.push(canvas.dataset.scale)).observe(canvas, { attributes: true, attributeFilter: ['data-frame'] })
  })
  await page.locator('.tool-panel [data-dial-path="intensity"]').focus()
  const pause = Number(args.pause ?? 20)
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(pause)
  }
  scales.push(...(await page.evaluate(() => window.__scales)))
  await page.waitForTimeout(400)
  await settled(page)
  await page.waitForTimeout(300)
  const afterDrag = await shot(page)
  const dragged = page.url()
  const fresh = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
  await fresh.goto(dragged, { waitUntil: 'load' })
  await settled(fresh)
  await fresh.waitForTimeout(300)
  const loaded = await shot(fresh)
  let differing = 0
  let max = 0
  for (let i = 0; i < afterDrag.data.length; i++) {
    const d = Math.abs(afterDrag.data[i] - loaded.data[i])
    if (d) differing++
    max = Math.max(max, d)
  }
  const sizeAfter = `${afterDrag.info.width}x${afterDrag.info.height}`
  console.log(`${look}: ${dragged.replace(url, '')}\n  frame scales while the slider moved: ${[...new Set(scales)].join(', ')}\n  settled after it vs loaded fresh (${sizeAfter}): ${differing} differing values, max ${max}`)
} finally {
  await browser.close()
}
