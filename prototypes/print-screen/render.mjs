// Renders our own frames through the engine harness without grain or dither, as input for the screen, and the
// poster-sized frames once more with the tool's Grain at 1 and dither, for the sheet.
// Usage: node prototypes/print-screen/render.mjs
import { mkdirSync } from 'node:fs'
import sharp from 'sharp'
import { startHarness } from '../../scripts/light/lib/harness.mjs'

const out = new URL('./out/renders/', import.meta.url).pathname
mkdirSync(out, { recursive: true })
// At the poster's size, the frames with the even area nearest to each poster color (red, near-black, blue, grey),
// found over Ramp, Bands and Blooms, three packs, seeds 1 to 8 and Intensity 0, 0.25 and 0.5.
const FRAMES = [
  { name: 'bands-bold-s2', look: 'sunset.bands', pack: 'bold', seed: 2, width: 960, height: 1345 },
  { name: 'bands-atmospheric-s8-i0', look: 'sunset.bands', pack: 'atmospheric', seed: 8, width: 960, height: 1345, intensity: 0 },
  { name: 'bands-atmospheric-s7', look: 'sunset.bands', pack: 'atmospheric', seed: 7, width: 960, height: 1345 },
  { name: 'bands-atmospheric-s7-i25', look: 'sunset.bands', pack: 'atmospheric', seed: 7, width: 960, height: 1345, intensity: 0.25 },
  { name: 'ramp-bold-s1-1080p', look: 'sunset.ramp', pack: 'bold', seed: 1, width: 1920, height: 1080 },
  { name: 'bands-bold-s1-1080p', look: 'sunset.bands', pack: 'bold', seed: 1, width: 1920, height: 1080 },
  { name: 'blooms-bold-s1-1080p', look: 'sunset.blooms', pack: 'bold', seed: 1, width: 1920, height: 1080 },
]
const harness = await startHarness()
try {
  for (const f of FRAMES) {
    const scene = await harness.call('compose', f.look, f.pack, { intensity: f.intensity ?? 0.5, softness: 0.5, mood: 0.5 }, f.seed, f.width / f.height)
    const image = await harness.render({ scene: { ...scene, output: { ...scene.output, grain: 0 } }, width: f.width, height: f.height, dither: false })
    await sharp(image.data, { raw: { width: f.width, height: f.height, channels: 4 } }).png({ compressionLevel: 3 }).toFile(`${out}${f.name}.png`)
    console.log(`wrote ${f.name}.png (${f.width}x${f.height})`)
    if (f.height !== 1345) continue
    const grain = await harness.render({ scene: { ...scene, output: { ...scene.output, grain: 1 } }, width: f.width, height: f.height, dither: true })
    await sharp(grain.data, { raw: { width: f.width, height: f.height, channels: 4 } }).png({ compressionLevel: 3 }).toFile(`${out}${f.name}-grain1.png`)
    console.log(`wrote ${f.name}-grain1.png`)
  }
} finally {
  await harness.close()
}
