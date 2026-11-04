// Labelled image grids with sharp (adapted from prototypes/filters-research/lib/sheet.mjs).
import sharp from 'sharp'

const GAP = 8
const HEAD = 26
const SIDE = 26

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')

export function label(text, width, height, { rotate = false, size = 15 } = {}) {
  const svg = rotate
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><text x="${-height / 2}" y="${width / 2 + 5}" transform="rotate(-90)" font-family="Helvetica, Arial" font-size="${size}" text-anchor="middle" fill="#333">${esc(text)}</text></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><text x="${width / 2}" y="${height / 2 + 5}" font-family="Helvetica, Arial" font-size="${size}" text-anchor="middle" fill="#333">${esc(text)}</text></svg>`
  return Buffer.from(svg)
}

export const CAPTION = 22

/** An encoded image with a caption strip above it; returns a PNG buffer of width x (height + CAPTION). */
export async function captioned(input, text, width, height) {
  return sharp({ create: { width, height: height + CAPTION, channels: 3, background: '#ffffff' } })
    .composite([
      { input: label(text, width, CAPTION, { size: 13 }), left: 0, top: 0 },
      { input, left: 0, top: CAPTION },
    ])
    .png()
    .toBuffer()
}

/**
 * rows: array of rows of encoded image buffers (PNG or JPEG), each `size` (or { input, width, height } per tile).
 * Writes JPEG (q 90, 4:4:4) or PNG by extension.
 */
export async function grid(rows, size, { header, rowLabels, file, title }) {
  const cols = Math.max(...rows.map((r) => r.length))
  const titleH = title ? HEAD : 0
  const top = titleH + (header ? HEAD : 0)
  const left = rowLabels ? SIDE : 0
  const W = left + cols * size.width + (cols - 1) * GAP
  const H = top + rows.length * size.height + (rows.length - 1) * GAP
  const parts = []
  if (title) parts.push({ input: label(title, W, HEAD, { size: 16 }), left: 0, top: 0 })
  if (header) header.forEach((t, c) => parts.push({ input: label(t, size.width, HEAD), left: left + c * (size.width + GAP), top: titleH }))
  rows.forEach((row, r) => {
    const y = top + r * (size.height + GAP)
    if (rowLabels) parts.push({ input: label(rowLabels[r], SIDE, size.height, { rotate: true, size: 12 }), left: 0, top: y })
    row.forEach((buf, c) => parts.push({ input: buf, left: left + c * (size.width + GAP), top: y }))
  })
  let img = sharp({ create: { width: W, height: H, channels: 3, background: '#ffffff' } }).composite(parts)
  img = file.endsWith('.png') ? img.png({ compressionLevel: 9 }) : img.jpeg({ quality: 90, chromaSubsampling: '4:4:4' })
  await img.toFile(file)
}
