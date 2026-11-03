// Labelled image grids with sharp.
import sharp from 'sharp'

export const STRENGTHS_ALL = [0, 0.25, 0.5, 1]
const GAP = 8
const HEAD = 26
const SIDE = 24

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')

/** A text label as a PNG buffer. */
export function label(text, width, height, { rotate = false, size = 15 } = {}) {
  const svg = rotate
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><text x="${-height / 2}" y="${width / 2 + 5}" transform="rotate(-90)" font-family="Helvetica, Arial" font-size="${size}" text-anchor="middle" fill="#333">${esc(text)}</text></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><text x="${width / 2}" y="${height / 2 + 5}" font-family="Helvetica, Arial" font-size="${size}" text-anchor="middle" fill="#333">${esc(text)}</text></svg>`
  return Buffer.from(svg)
}

/** rows: array of rows of PNG buffers, all `size`. Writes JPEG (q 90, 4:4:4) or PNG by extension. */
export async function grid(rows, size, { header, rowLabels, file }) {
  const cols = rows[0].length
  const top = header ? HEAD : 0
  const left = rowLabels ? SIDE : 0
  const W = left + cols * size.width + (cols - 1) * GAP
  const H = top + rows.length * size.height + (rows.length - 1) * GAP
  const parts = []
  if (header) header.forEach((t, c) => parts.push({ input: label(t, size.width, HEAD), left: left + c * (size.width + GAP), top: 0 }))
  rows.forEach((row, r) => {
    const y = top + r * (size.height + GAP)
    if (rowLabels) parts.push({ input: label(rowLabels[r], SIDE, size.height, { rotate: true, size: 12 }), left: 0, top: y })
    row.forEach((buf, c) => parts.push({ input: buf, left: left + c * (size.width + GAP), top: y }))
  })
  let img = sharp({ create: { width: W, height: H, channels: 3, background: '#ffffff' } }).composite(parts)
  img = file.endsWith('.png') ? img.png({ compressionLevel: 9 }) : img.jpeg({ quality: 90, chromaSubsampling: '4:4:4' })
  await img.toFile(file)
}
