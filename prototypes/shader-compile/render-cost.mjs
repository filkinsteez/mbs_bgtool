// Per-look cost of a 1x preview frame at the owner's canvas size (1440x900 at 2x: 2152x1210): the harness profile
// (wall time with a 1-pixel read, back-to-back bursts, per-stage GPU times), then the tool's own GPU timer
// (data-fast-gpu-ms) for 1x frames drawn while an Intensity key is held. Usage: node render-cost.mjs [base url]
import { chromium } from '@playwright/test'
import { startHarness } from '../../scripts/light/lib/harness.mjs'

const base = process.argv[2] ?? 'http://localhost:3000'
const LOOKS = [
  ['sunset', 'ramp', 'horizon'],
  ['sunset', 'bands', 'horizon'],
  ['sunset', 'blooms', 'horizon'],
  ['contour', 'rim', 'light'],
  ['contour', 'halo', 'light'],
  ['contour', 'beam', 'light'],
  ['contour', 'streaks', 'light'],
]
const SIZE = { width: 2152, height: 1210 }
const fixed = (n) => (typeof n === 'number' ? n.toFixed(1) : '-')
const median = (values) => (values.length ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] : null)
const p95 = (values) => (values.length ? [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * 0.95))] : null)

const harness = await startHarness()
const profiles = {}
try {
  const { buildScene } = await harness.ssr('/src/tool/controls.ts')
  const { getPack } = await harness.ssr('/src/light/color/packs.ts')
  for (const [, look] of LOOKS) {
    const recipe = LOOKS.find(([, l]) => l === look)[0] + '.' + look
    const scene = { ...buildScene(recipe, getPack('bold'), 1, { intensity: 0.5, softness: 0.5, mood: 0.5 }, SIZE.width / SIZE.height), recipe }
    const p = await harness.call('profile', { scene, ...SIZE, supersample: 1, runs: 5 })
    profiles[recipe] = p
    const stages = Object.entries(p.stages)
      .filter(([, ms]) => ms >= 0.5)
      .map(([stage, ms]) => `${stage} ${ms.toFixed(1)}`)
      .join(', ')
    console.log(`harness ${recipe.padEnd(16)} total ${fixed(p.total)} ms, burst ${fixed(p.burst)} ms; stages: ${stages}`)
  }
} finally {
  await harness.close()
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
  for (const [mood, look, dial] of LOOKS) {
    await page.goto(`${base}/?mood=${mood}&look=${look}&pack=bold&intensity=0.5&softness=0.5&${dial}=0.5&seed=1&format=16x9`, { waitUntil: 'load', timeout: 120_000 })
    await page.waitForFunction(() => document.querySelector('canvas.tool-canvas')?.dataset.settled === 'true', null, { timeout: 120_000 })
    await page.waitForTimeout(1500)
    await page.evaluate(() => {
      window.__gpu = []
      window.__onCanvas = []
      new MutationObserver((records) => {
        for (const record of records) {
          const value = Number(record.target.getAttribute(record.attributeName))
          if (record.attributeName === 'data-fast-gpu-ms') window.__gpu.push(value)
          if (record.attributeName === 'data-fast-ms') window.__onCanvas.push(value)
        }
      }).observe(document.querySelector('canvas.tool-canvas'), { attributes: true, attributeFilter: ['data-fast-gpu-ms', 'data-fast-ms'] })
    })
    const slider = page.locator('.tool-panel [data-dial-path="intensity"]')
    await slider.focus()
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press(i < 20 ? 'ArrowRight' : 'ArrowLeft')
      await page.waitForTimeout(25)
    }
    await page.waitForTimeout(500)
    const { gpu, onCanvas, size } = await page.evaluate(() => ({ gpu: window.__gpu, onCanvas: window.__onCanvas, size: document.querySelector('canvas.tool-canvas').dataset.renderSize }))
    const recipe = `${mood}.${look}`
    console.log(
      `tool    ${recipe.padEnd(16)} ${size}: ${gpu.length} timed 1x frames, GPU median ${fixed(median(gpu))} p95 ${fixed(p95(gpu))} ms; on canvas median ${fixed(median(onCanvas))} p95 ${fixed(p95(onCanvas))} ms`,
    )
  }
} finally {
  await browser.close()
}
