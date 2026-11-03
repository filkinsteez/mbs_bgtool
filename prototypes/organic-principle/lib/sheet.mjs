// Contact sheets: rows of images at one tile height, with plain labels.
import sharp from 'sharp'

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')

/**
 * rows: [{ label?, tiles: [{ file | buffer, label? }] }]
 * Each tile is resized to `height`; a label strip goes under each tile.
 */
export async function sheet(rows, out, { height = 240, gap = 12, labelH = 22, rowLabelW = 0, background = '#ffffff', quality = 88 } = {}) {
  const built = []
  let W = 0
  for (const row of rows) {
    const tiles = []
    let x = rowLabelW
    for (const t of row.tiles) {
      const src = t.buffer ?? t.file
      const buf = await sharp(src).removeAlpha().resize({ height }).png().toBuffer()
      const { width } = await sharp(buf).metadata()
      tiles.push({ buf, width, x, label: t.label })
      x += width + gap
    }
    W = Math.max(W, x - gap)
    built.push({ tiles, label: row.label })
  }
  const rowH = height + labelH
  const H = built.length * rowH + (built.length - 1) * gap
  const composite = []
  built.forEach((row, r) => {
    const top = r * (rowH + gap)
    for (const t of row.tiles) {
      composite.push({ input: t.buf, left: t.x, top })
      if (t.label) {
        const svg = `<svg width="${t.width}" height="${labelH}"><text x="2" y="${labelH - 7}" font-family="Helvetica, Arial" font-size="13" fill="#222">${esc(t.label)}</text></svg>`
        composite.push({ input: Buffer.from(svg), left: t.x, top: top + height })
      }
    }
    if (row.label && rowLabelW > 0) {
      const lines = String(row.label).split('\n')
      const svg = `<svg width="${rowLabelW - 6}" height="${height}">${lines
        .map((l, i) => `<text x="0" y="${18 + i * 17}" font-family="Helvetica, Arial" font-size="14" fill="#222">${esc(l)}</text>`)
        .join('')}</svg>`
      composite.push({ input: Buffer.from(svg), left: 0, top })
    }
  })
  let s = sharp({ create: { width: W, height: H, channels: 3, background } }).composite(composite)
  s = out.endsWith('.jpg') ? s.jpeg({ quality, chromaSubsampling: '4:4:4' }) : s.png({ compressionLevel: 9 })
  await s.toFile(out)
  return { W, H }
}
