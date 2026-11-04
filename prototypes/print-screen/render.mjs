// Renders our own frames through the engine harness without grain or dither, as input for the screen.
// Usage: node prototypes/print-screen/render.mjs
import { mkdirSync } from 'node:fs'
import sharp from 'sharp'
import { startHarness } from '../../scripts/light/lib/harness.mjs'

const out = new URL('./out/renders/', import.meta.url).pathname
mkdirSync(out, { recursive: true })
const FRAMES = [
  { name: 'bands-bold-s6-poster', look: 'sunset.bands', pack: 'bold', seed: 6, width: 960, height: 1345 },
  { name: 'bands-atmospheric-s6-poster', look: 'sunset.bands', pack: 'atmospheric', seed: 6, width: 960, height: 1345 },
  { name: 'ramp-bold-s1-1080p', look: 'sunset.ramp', pack: 'bold', seed: 1, width: 1920, height: 1080 },
  { name: 'bands-bold-s1-1080p', look: 'sunset.bands', pack: 'bold', seed: 1, width: 1920, height: 1080 },
  { name: 'blooms-bold-s1-1080p', look: 'sunset.blooms', pack: 'bold', seed: 1, width: 1920, height: 1080 },
]
const harness = await startHarness()
try {
  for (const f of FRAMES) {
    const scene = await harness.call('compose', f.look, f.pack, { intensity: 0.5, softness: 0.5, mood: 0.5 }, f.seed, f.width / f.height)
    const image = await harness.render({ scene: { ...scene, output: { ...scene.output, grain: 0 } }, width: f.width, height: f.height, dither: false })
    await sharp(image.data, { raw: { width: f.width, height: f.height, channels: 4 } }).png({ compressionLevel: 3 }).toFile(`${out}${f.name}.png`)
    console.log(`wrote ${f.name}.png (${f.width}x${f.height})`)
  }
} finally {
  await harness.close()
}
