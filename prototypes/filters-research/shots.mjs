// node shots.mjs
// Screenshots of the tool's preview canvas (not 2x exports) for the filter
// tests, one browser session, one page at a time. Writes out/shots/<id>.png.
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

export const SHOTS = [
  { id: 'ramp-bold-s7-16x9', q: 'mood=sunset&look=ramp&pack=bold&seed=7&format=16x9&intensity=0.5&softness=0.5&horizon=0.5' },
  { id: 'bands-elemental-s3-16x9', q: 'mood=sunset&look=bands&pack=elemental&seed=3&format=16x9&intensity=0.5&softness=0.5&horizon=0.5' },
  { id: 'blooms-atmospheric-s2-16x9', q: 'mood=sunset&look=blooms&pack=atmospheric&seed=2&format=16x9&intensity=0.5&softness=0.5&horizon=0.5' },
  { id: 'halo-bold-s4-16x9', q: 'mood=contour&look=halo&pack=bold&seed=4&format=16x9&intensity=0.5&softness=0.5&light=0.5' },
  { id: 'rim-elemental-s5-16x9', q: 'mood=contour&look=rim&pack=elemental&seed=5&format=16x9&intensity=0.5&softness=0.5&light=0.5' },
  { id: 'ramp-atmospheric-s11-9x16', q: 'mood=sunset&look=ramp&pack=atmospheric&seed=11&format=9x16&intensity=0.5&softness=0.5&horizon=0.5' },
  { id: 'bands-bold-s5-9x16', q: 'mood=sunset&look=bands&pack=bold&seed=5&format=9x16&intensity=0.5&softness=0.5&horizon=0.5' },
  { id: 'blooms-elemental-s8-9x16', q: 'mood=sunset&look=blooms&pack=elemental&seed=8&format=9x16&intensity=0.5&softness=0.5&horizon=0.5' },
  { id: 'halo-atmospheric-s6-9x16', q: 'mood=contour&look=halo&pack=atmospheric&seed=6&format=9x16&intensity=0.5&softness=0.5&light=0.5' },
  { id: 'rim-bold-s9-9x16', q: 'mood=contour&look=rim&pack=bold&seed=9&format=9x16&intensity=0.5&softness=0.5&light=0.5' },
]

const dir = new URL('./out/shots/', import.meta.url).pathname
mkdirSync(dir, { recursive: true })

if (import.meta.url === `file://${process.argv[1]}`) {
  const scale = Number(process.argv[2] ?? 2)
  const browser = await chromium.launch({ channel: 'chrome' })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: scale })
  const page = await context.newPage()
  const logs = []
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message))
  for (const shot of SHOTS) {
    await page.goto('http://localhost:3000/?' + shot.q, { waitUntil: 'load', timeout: 180000 })
    await page.waitForTimeout(6000)
    const canvas = page.locator('canvas').first()
    const box = await canvas.boundingBox()
    const backing = await canvas.evaluate((c) => [c.width, c.height])
    await page.screenshot({ path: `${dir}${shot.id}.png`, clip: box })
    console.log(shot.id, 'css', Math.round(box.width), Math.round(box.height), 'backing', backing.join('x'))
  }
  console.log(logs.slice(0, 10).join('\n') || 'no page errors')
  await browser.close()
}
