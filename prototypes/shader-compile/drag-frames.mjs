// Every frame the preview puts on the canvas during a drag and after it ends: its scale and its mean brightness,
// copied from the canvas in the same task it is drawn. A frame much darker or brighter than its neighbours, or a
// blank one, is a flash. Usage: node drag-frames.mjs [--look rim] [--url http://localhost:3000]
import { chromium } from '@playwright/test'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []),
)
const url = args.url ?? 'http://localhost:3000'
const look = args.look ?? 'rim'
const mood = ['ramp', 'bands', 'blooms'].includes(look) ? 'sunset' : 'contour'
const dial = mood === 'sunset' ? 'horizon' : 'light'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
  await page.goto(`${url}/?mood=${mood}&look=${look}&pack=bold&intensity=0.5&softness=0.5&${dial}=0.5&seed=3&format=16x9`, { waitUntil: 'load' })
  await page.waitForFunction(() => document.querySelector('canvas.tool-canvas')?.dataset.settled === 'true', null, { timeout: 120_000 })
  await page.waitForTimeout(1500)
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas.tool-canvas')
    const copy = document.createElement('canvas')
    copy.width = 64
    copy.height = 36
    const context = copy.getContext('2d', { willReadFrequently: true })
    window.__frames = []
    new MutationObserver(() => {
      context.drawImage(canvas, 0, 0, 64, 36)
      const { data } = context.getImageData(0, 0, 64, 36)
      let sum = 0
      for (let i = 0; i < data.length; i += 4) sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
      window.__frames.push({ t: performance.now(), scale: canvas.dataset.scale, ss: canvas.dataset.supersample, size: `${canvas.width}x${canvas.height}`, mean: sum / (data.length / 4) })
    }).observe(canvas, { attributes: true, attributeFilter: ['data-frame'] })
  })
  const box = await page.locator('canvas.tool-canvas').boundingBox()
  const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy]
  await page.mouse.move(...at(0.45, 0.6))
  await page.mouse.down()
  for (let i = 1; i <= 60; i++) {
    const a = (i / 60) * Math.PI * 1.5
    await page.mouse.move(...at(0.45 + 0.2 * Math.cos(a), 0.6 - 0.15 * Math.sin(a)))
    await page.waitForTimeout(8)
  }
  await page.waitForTimeout(150)
  await page.mouse.up()
  await page.waitForFunction(() => document.querySelector('canvas.tool-canvas')?.dataset.settled === 'true', null, { timeout: 60_000 })
  await page.waitForTimeout(300)
  const frames = await page.evaluate(() => window.__frames)
  const t0 = frames[0]?.t ?? 0
  let worst = 0
  for (let i = 1; i < frames.length - 1; i++) {
    const around = (frames[i - 1].mean + frames[i + 1].mean) / 2
    worst = Math.max(worst, Math.abs(frames[i].mean - around))
  }
  console.log(`${look}: ${frames.length} frames; largest jump of one frame against its neighbours ${worst.toFixed(2)} (mean brightness 0-255)`)
  for (const f of frames.slice(-8)) console.log(`  ${(f.t - t0).toFixed(0).padStart(5)} ms  scale ${f.scale}  ${f.ss}x  canvas ${f.size}  mean ${f.mean.toFixed(2)}`)
  const scales = [...new Set(frames.map((f) => f.scale))]
  console.log(`  scales seen: ${scales.join(', ')}; frames at the minimum brightness ${Math.min(...frames.map((f) => f.mean)).toFixed(2)}, maximum ${Math.max(...frames.map((f) => f.mean)).toFixed(2)}`)
} finally {
  await browser.close()
}
