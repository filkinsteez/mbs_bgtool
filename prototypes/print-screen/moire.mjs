// Does the screen make moire when a viewer shrinks the image? Shrinks a screened 1080p frame and a 4K-sized one
// to common display scales with three filters (nearest, linear, lanczos) and puts them side by side.
// Usage: node prototypes/print-screen/moire.mjs (after render.mjs)
import sharp from 'sharp'
import { applyScreen } from './lib/screen.mjs'

const out = new URL('./out/', import.meta.url).pathname
const { data, info } = await sharp(`${out}renders/bands-bold-s1-1080p.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const frame = applyScreen({ width: info.width, height: info.height, data: new Uint8Array(data) }, 1, 1)
const raw = () => sharp(frame.data, { raw: { width: frame.width, height: frame.height, channels: 4 } })
const tiles = []
for (const scale of [0.5, 0.4, 0.33]) {
  for (const kernel of ['nearest', 'linear', 'lanczos3']) {
    const w = Math.round(frame.width * scale)
    const h = Math.round(frame.height * scale)
    // A 360 x 240 window of the shrunk frame, so the scales sit side by side at 1:1.
    const shrunk = await raw().resize(w, h, { kernel, fit: 'fill' }).png().toBuffer()
    const crop = await sharp(shrunk).extract({ left: Math.round(w * 0.45), top: Math.round(h * 0.15), width: 300, height: 200 }).png().toBuffer()
    tiles.push({ crop, label: `${Math.round(scale * 100)} %, ${kernel}` })
  }
}
const cols = 3
const composites = []
tiles.forEach((t, i) => {
  const left = (i % cols) * 310
  const top = Math.floor(i / cols) * 230
  composites.push({ input: t.crop, left, top: top + 24 })
  composites.push({
    input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="20"><text x="2" y="15" fill="#d0d0d0" font-family="Helvetica" font-size="13">${t.label}</text></svg>`),
    left,
    top,
  })
})
await sharp({ create: { width: cols * 310, height: Math.ceil(tiles.length / cols) * 230, channels: 3, background: '#161616' } })
  .composite(composites)
  .jpeg({ quality: 90 })
  .toFile(`${out}sheets/moire.jpg`)
console.log('wrote out/sheets/moire.jpg: Bands Bold seed 1 at 1080p, screen 1, shrunk to 50, 40 and 33 %')
