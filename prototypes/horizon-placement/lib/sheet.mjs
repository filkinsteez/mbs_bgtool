// Sheet helpers: tiles from raw RGB or files, laid out in rows with small plain labels.
import sharp from 'sharp'

export const tileFromRaw = (buf, W, H) => sharp(buf, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer()

export async function tileFromFile(path, height, crop) {
  let img = sharp(path).removeAlpha()
  if (crop) img = img.extract(crop)
  return img.resize({ height }).png().toBuffer()
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

/**
 * rows: [{ label?, tiles: [{ buf, label? }] }]. Tiles in a row are placed at their own size.
 * Labels go under each tile in a 22 px strip. Returns a PNG buffer.
 */
export async function layout(rows, { gap = 12, title = null, background = '#ffffff' } = {}) {
  const LABEL = 22
  const TITLE = title ? 30 : 0
  const placed = []
  let y = gap + TITLE
  let width = 0
  const texts = []
  if (title) texts.push(`<text x="${gap}" y="${gap + 18}" font-family="Helvetica, Arial" font-size="17" fill="#222">${esc(title)}</text>`)
  for (const row of rows) {
    let x = gap
    let rowH = 0
    if (row.label) {
      texts.push(`<text x="${gap}" y="${y + 15}" font-family="Helvetica, Arial" font-size="14" fill="#444">${esc(row.label)}</text>`)
      y += 22
    }
    for (const t of row.tiles) {
      const meta = await sharp(t.buf).metadata()
      placed.push({ input: t.buf, left: x, top: y })
      if (t.label) texts.push(`<text x="${x}" y="${y + meta.height + 16}" font-family="Helvetica, Arial" font-size="13" fill="#333">${esc(t.label)}</text>`)
      x += meta.width + gap
      rowH = Math.max(rowH, meta.height)
    }
    width = Math.max(width, x)
    y += rowH + LABEL + gap
  }
  const height = y
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${texts.join('')}</svg>`)
  return sharp({ create: { width, height, channels: 3, background } })
    .composite([...placed, { input: svg, left: 0, top: 0 }])
    .png({ compressionLevel: 9 })
    .toBuffer()
}
