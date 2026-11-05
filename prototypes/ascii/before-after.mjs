// Before/after sheets from fidelity.mjs output, next to the deck's ASCII tile (Figma 44:275):
//   out/fidelity/before-after-crops.jpg   per density: tile, then each look before and after, 1:1 at 1080p
//   out/fidelity/before-after-full.jpg    each look at density 0.5, before and after, full frame
//   node prototypes/ascii/before-after.mjs   (after `fidelity.mjs --name before --committed` and `--name after`)
import path from 'node:path'
import sharp from 'sharp'
import { column, DENSITIES, LOOKS, row, rowsAt, tileCrop } from './fidelity.mjs'
import { OUT } from './lib/server.mjs'

const dir = path.join(OUT, 'fidelity')
const CW = 420

async function caption(input, width, text) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="22"><rect width="100%" height="100%" fill="#111"/><text x="6" y="16" font-family="Menlo" font-size="12" fill="#ddd">${text}</text></svg>`
  const meta = await sharp(input).metadata()
  return sharp({ create: { width, height: meta.height + 22, channels: 3, background: '#111' } })
    .composite([
      { input: Buffer.from(svg), left: 0, top: 0 },
      { input: await sharp(input).png().toBuffer(), left: 0, top: 22 },
    ])
    .png()
    .toBuffer()
}

const rows = []
for (const d of DENSITIES) {
  const cells = [await caption(await tileCrop(rowsAt(d)), CW, `Figma 44:275, ${rowsAt(d)} rows`)]
  for (const look of LOOKS) {
    for (const when of ['before', 'after']) {
      cells.push(await caption(path.join(dir, when, `${look.name}-d${d}.png`), CW, `${look.name} ${d} ${when}`))
    }
  }
  rows.push(await row(cells, CW))
}
await sharp(await column(rows)).jpeg({ quality: 88 }).toFile(path.join(dir, 'before-after-crops.jpg'))

const full = []
for (const look of LOOKS) {
  const cells = []
  for (const when of ['before', 'after']) {
    cells.push(await caption(await sharp(path.join(dir, when, `${look.name}-d0.5-full.jpg`)).png().toBuffer(), 960, `${look.name} 0.5 ${when}`))
  }
  full.push(await row(cells, 960))
}
await sharp(await column(full)).jpeg({ quality: 86 }).toFile(path.join(dir, 'before-after-full.jpg'))
console.log('wrote', path.join(dir, 'before-after-crops.jpg'), path.join(dir, 'before-after-full.jpg'))
