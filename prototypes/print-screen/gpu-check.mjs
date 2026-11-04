// Runs the print screen stage in the engine's output pass on the GPU (harness/) and compares it with the CPU
// reference (lib/screen.mjs) on the same input bytes. Usage: node prototypes/print-screen/gpu-check.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'
import { startHarness } from '../../scripts/light/lib/harness.mjs'
import { applyScreen, SCREEN } from './lib/screen.mjs'

const out = new URL('./out/', import.meta.url).pathname
mkdirSync(`${out}sheets`, { recursive: true })
const CONTROLS = { intensity: 0.5, softness: 0.5, mood: 0.5 }
const FRAMES = [
  { look: 'sunset.bands', pack: 'bold', seed: 1, width: 1920, height: 1080 },
  { look: 'sunset.bands', pack: 'bold', seed: 6, width: 960, height: 1345 },
]
const STRENGTHS = [0.5, 1]

const harness = await startHarness()
const lines = []
try {
  const errors = []
  harness.page.on('pageerror', (error) => errors.push(error.message))
  await harness.page.goto(`http://127.0.0.1:${harness.port}/prototypes/print-screen/harness/index.html`)
  const deadline = Date.now() + 60_000
  while (!(await harness.page.evaluate(() => document.documentElement.dataset.screen === 'ready'))) {
    if (errors.length) throw new Error(errors.join('\n'))
    if (Date.now() > deadline) throw new Error('print screen harness page timed out')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  for (const f of FRAMES) {
    const scene = await harness.page.evaluate(
      ([id, pack, controls, seed, aspect]) => window.screenHarness.compose(id, pack, controls, seed, aspect),
      [f.look, f.pack, CONTROLS, f.seed, f.width / f.height],
    )
    if (!scene) {
      lines.push(`${f.look} ${f.pack} did not load`)
      continue
    }
    const key = `${f.look}-${f.pack}-${f.seed}-${f.width}`
    for (const dither of [false, true]) {
      const { ms } = await harness.page.evaluate((request) => window.screenHarness.render(request), { scene, width: f.width, height: f.height, strengths: STRENGTHS, dither, upload: `${key}-${dither}` })
      const input = { width: f.width, height: f.height, data: new Uint8Array(harness.takeUpload(`${key}-${dither}-input`)) }
      for (const s of STRENGTHS) {
        const gpu = new Uint8Array(harness.takeUpload(`${key}-${dither}-${s}`))
        if (dither) {
          if (s === 1) await sharp(gpu, { raw: { width: f.width, height: f.height, channels: 4 } }).jpeg({ quality: 92 }).toFile(`${out}sheets/gpu-${key}-screen1.jpg`)
          continue
        }
        const cpu = applyScreen(input, s, f.seed, SCREEN, { dither: false }).data
        let max = 0
        let sum = 0
        let over1 = 0
        const n = f.width * f.height
        for (let i = 0; i < n; i++) {
          for (let k = 0; k < 3; k++) {
            const d = Math.abs(gpu[i * 4 + k] - cpu[i * 4 + k])
            max = Math.max(max, d)
            sum += d
            if (d > 1) over1++
          }
        }
        lines.push(`${key} strength ${s}: GPU vs CPU, mean |diff| ${(sum / (3 * n)).toFixed(3)} code values, max ${max}, ${((over1 / (3 * n)) * 100).toFixed(3)} % of channels over 1 (GPU pass ${ms.toFixed(0)} ms for ${STRENGTHS.length} strengths)`)
      }
    }
  }
} finally {
  await harness.close()
}
console.log(lines.join('\n'))
writeFileSync(`${out}gpu-check.txt`, lines.join('\n') + '\n')
