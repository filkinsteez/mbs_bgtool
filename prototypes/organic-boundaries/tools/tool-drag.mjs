// Drags Softness, Horizon and Intensity in the tool (the dev server on :3000) for
// Ramp, Bands and Blooms at 16:9 and 9:16, and records the page's frame times and
// the preview's render times (the canvas's fastMs: the look's uniforms plus the GPU
// render) during each drag. Headless Chrome at device pixel ratio 2.
// node tools/tool-drag.mjs [--out file.json] [--url http://localhost:3000]

import fs from 'node:fs'
import { chromium } from '@playwright/test'

const arg = (name) => {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : null
}
const base = arg('--url') ?? 'http://localhost:3000'
const out = arg('--out')
const LOOKS = ['ramp', 'bands', 'blooms']
const FORMATS = ['16x9', '9x16']
const CONTROLS = [
  ['Softness', /^softness/i],
  ['Horizon', /^horizon/i],
  ['Intensity', /^intensity/i],
]
// one pointer move per 16 ms for about a second, from 20% to 80% of the track
const MOVES = 60
const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '-')
const quantile = (v, p) => {
  const s = v.slice().sort((a, b) => a - b)
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const page = await context.newPage()
const results = {}
for (const look of LOOKS) {
  for (const format of FORMATS) {
    await page.goto(`${base}/?mood=sunset&look=${look}&pack=bold&intensity=0.5&softness=0.5&horizon=0.5&seed=1&format=${format}`)
    await page.waitForFunction(() => document.querySelector('canvas.tool-canvas')?.dataset.settled === 'true', null, { timeout: 120_000 })
    const size = await page.evaluate(() => document.querySelector('canvas.tool-canvas').width + 'x' + document.querySelector('canvas.tool-canvas').height)
    console.log(`${look} ${format}: preview canvas ${size}`)
    for (const [name, label] of CONTROLS) {
      const track = page.locator('.dialkit-slider', { has: page.locator('.dialkit-slider-label', { hasText: label }) }).first()
      const box = await track.boundingBox()
      if (!box) throw new Error(`no ${name} slider`)
      const y = box.y + box.height / 2
      const x0 = box.x + 0.2 * box.width
      const x1 = box.x + 0.8 * box.width
      await page.mouse.move(x0, y)
      await page.mouse.down()
      // the recorder: every animation frame's interval, and each 1x preview render's time
      await page.evaluate(() => {
        const canvas = document.querySelector('canvas.tool-canvas')
        const rec = { frames: [], renders: [], on: true }
        window.__drag = rec
        rec.observer = new MutationObserver(() => {
          if (canvas.dataset.supersample === '1') rec.renders.push(Number(canvas.dataset.fastMs))
        })
        rec.observer.observe(canvas, { attributes: true, attributeFilter: ['data-frame'] })
        let last = performance.now()
        const tick = (t) => {
          rec.frames.push(t - last)
          last = t
          if (rec.on) requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })
      for (let k = 1; k <= MOVES; k++) {
        await page.mouse.move(x0 + ((x1 - x0) * k) / MOVES, y)
        await page.waitForTimeout(16)
      }
      await page.mouse.up()
      const rec = await page.evaluate(() => {
        const r = window.__drag
        r.on = false
        r.observer.disconnect()
        return { frames: r.frames.slice(1), renders: r.renders }
      })
      const entry = {
        frames: rec.frames.length,
        frameMedian: quantile(rec.frames, 0.5),
        frameP95: quantile(rec.frames, 0.95),
        frameMax: Math.max(...rec.frames),
        over25: rec.frames.filter((t) => t > 25).length,
        renders: rec.renders.length,
        renderMedian: quantile(rec.renders, 0.5),
        renderMax: Math.max(...rec.renders),
      }
      results[`${look} ${format} ${name}`] = entry
      console.log(
        `${look.padEnd(6)} ${format} ${name.padEnd(9)} frames ${entry.frames}: median ${f(entry.frameMedian)} ms, 95% ${f(entry.frameP95)} ms, worst ${f(entry.frameMax)} ms, ${entry.over25} over 25 ms; ` +
          `${entry.renders} preview renders: median ${f(entry.renderMedian)} ms, worst ${f(entry.renderMax)} ms`,
      )
      // let the 2x settle render finish before the next drag
      await page.waitForFunction(() => document.querySelector('canvas.tool-canvas')?.dataset.settled === 'true', null, { timeout: 60_000 })
    }
  }
}
if (out) fs.writeFileSync(out, JSON.stringify(results, null, 1))
await browser.close()
