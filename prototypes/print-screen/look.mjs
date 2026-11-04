// High-passed, contrast-stretched 8x crops of each poster band, to see whether the screen is dots or lines.
import sharp from 'sharp'

const root = new URL('../../', import.meta.url).pathname
const out = new URL('./out/', import.meta.url).pathname
const file = process.argv[2] ?? `${root}public/references/awe/sunset/sunset-film-poster-bands-full.png`
const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true })
const w = info.width
const spots = [
  ['top red', 440, 10],
  ['near black', 440, 150],
  ['plum', 440, 300],
  ['blue', 440, 500],
  ['grey', 440, 700],
  ['warm grey', 440, 860],
  ['red', 440, 990],
]
const size = 48
const zoom = 8
const tiles = []
for (const [, x0, y0] of spots) {
  const crop = Buffer.alloc(size * size * 3)
  const view = Buffer.alloc(size * size * 3)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      for (let k = 0; k < 3; k++) {
        const v = data[((y0 + y) * w + x0 + x) * 3 + k]
        let s = 0
        let c = 0
        for (let dy = -3; dy <= 3; dy++) {
          for (let dx = -3; dx <= 3; dx++) {
            const yy = y0 + y + dy
            const xx = x0 + x + dx
            s += data[(yy * w + xx) * 3 + k]
            c++
          }
        }
        crop[(y * size + x) * 3 + k] = v
        view[(y * size + x) * 3 + k] = Math.max(0, Math.min(255, Math.round(128 + 10 * (v - s / c))))
      }
    }
  }
  tiles.push(await sharp(crop, { raw: { width: size, height: size, channels: 3 } }).resize(size * zoom, size * zoom, { kernel: 'nearest' }).png().toBuffer())
  tiles.push(await sharp(view, { raw: { width: size, height: size, channels: 3 } }).resize(size * zoom, size * zoom, { kernel: 'nearest' }).png().toBuffer())
}
const cell = size * zoom
await sharp({ create: { width: 2 * cell + 24, height: spots.length * (cell + 8), channels: 3, background: '#161616' } })
  .composite(tiles.map((input, i) => ({ input, left: (i % 2) * (cell + 8), top: Math.floor(i / 2) * (cell + 8) })))
  .jpeg({ quality: 90 })
  .toFile(`${out}poster-highpass-8x.jpg`)
console.log(`wrote ${out}poster-highpass-8x.jpg: ${spots.map((s) => s[0]).join(', ')} (left: 8x, right: minus a 7x7 mean, x10)`)
