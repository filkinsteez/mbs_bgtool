import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const BACKGROUND = '#161616'
const GAP = 8
/** Faster to write than the default 6; files are somewhat larger. */
const PNG_LEVEL = 3

function rawInput(image) {
  return { input: image.data, raw: { width: image.width, height: image.height, channels: 4 } }
}

export function raw(image) {
  return sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } })
}

export async function savePng(file, image) {
  await mkdir(path.dirname(file), { recursive: true })
  await raw(image).png({ compressionLevel: PNG_LEVEL }).toFile(file)
}

/** Decodes any image file to { width, height, data } RGBA (sharp converts embedded profiles to sRGB). */
export async function loadRgba(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, data }
}

export async function resizeRgba(image, width, height, kernel = 'lanczos3') {
  const { data, info } = await raw(image).resize(width, height, { kernel, fit: 'fill' }).raw().toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, data }
}

export async function cropRgba(image, left, top, width, height) {
  const { data, info } = await raw(image).extract({ left, top, width, height }).raw().toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, data }
}

/**
 * Nearest-neighbour enlargement, optionally with contrast stretched around the
 * crop's mean; with `center`, the mean is moved to that level so steps in dark
 * crops become visible.
 */
export async function zoom(image, factor, stretch = 1, center = null) {
  let source = image
  if (stretch !== 1) {
    const data = Buffer.from(image.data)
    const mean = [0, 0, 0]
    const n = image.width * image.height
    for (let i = 0; i < data.length; i += 4) for (let k = 0; k < 3; k++) mean[k] += data[i + k] / n
    for (let i = 0; i < data.length; i += 4) {
      for (let k = 0; k < 3; k++) {
        const base = center ?? mean[k]
        data[i + k] = Math.max(0, Math.min(255, Math.round(base + (data[i + k] - mean[k]) * stretch)))
      }
    }
    source = { ...image, data }
  }
  return resizeRgba(source, image.width * factor, image.height * factor, 'nearest')
}

function escapeXml(text) {
  return String(text).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c])
}

/** One small SVG per label (rendering a full-size transparent SVG costs a few hundred ms). */
function labels(items) {
  return items.map(({ x, y, text, size = 13, color = '#9a9a9a' }) => {
    const width = Math.max(40, Math.ceil(String(text).length * size * 0.62) + 8)
    const height = size + 8
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><text x="0" y="${size}" fill="${color}" font-family="Helvetica, Arial, sans-serif" font-size="${size}">${escapeXml(text)}</text></svg>`
    return { input: Buffer.from(svg), left: Math.max(0, Math.round(x)), top: Math.max(0, Math.round(y - size)) }
  })
}

/** A width x 1 strip of colors stretched to width x height. */
async function stripImage(colors, width, height) {
  const data = Buffer.alloc(colors.length * 4)
  colors.forEach((c, i) => {
    data[i * 4] = c[0]
    data[i * 4 + 1] = c[1]
    data[i * 4 + 2] = c[2]
    data[i * 4 + 3] = 255
  })
  return sharp(data, { raw: { width: colors.length, height: 1, channels: 4 } })
    .resize(width, height, { kernel: 'nearest', fit: 'fill' })
    .png()
    .toBuffer()
}

function polyline(values, width, height, top, lo, hi) {
  const segments = []
  let current = []
  values.forEach((v, i) => {
    if (!Number.isFinite(v)) {
      if (current.length) segments.push(current)
      current = []
      return
    }
    const x = (i / Math.max(1, values.length - 1)) * width
    const y = top + height - ((v - lo) / (hi - lo)) * height
    current.push(`${x.toFixed(1)},${Math.max(top, Math.min(top + height, y)).toFixed(1)}`)
  })
  if (current.length) segments.push(current)
  return segments
}

/** L and chroma per row: target white, render orange; L solid, chroma dashed. */
function curvesSvg(rows, width, height) {
  const plotTop = 18
  const plotHeight = height - 26
  const lines = []
  const add = (values, lo, hi, color, dash) => {
    for (const segment of polyline(values, width, plotHeight, plotTop, lo, hi)) {
      lines.push(`<polyline points="${segment.join(' ')}" fill="none" stroke="${color}" stroke-width="2" ${dash ? 'stroke-dasharray="6 4"' : ''}/>`)
    }
  }
  add(rows.targetL, 0, 1, '#ffffff', false)
  add(rows.renderL, 0, 1, '#ff8a3d', false)
  add(rows.targetC, 0, 0.35, '#ffffff', true)
  add(rows.renderC, 0, 0.35, '#ff8a3d', true)
  const grid = [0.25, 0.5, 0.75]
    .map((g) => `<line x1="0" x2="${width}" y1="${plotTop + plotHeight * (1 - g)}" y2="${plotTop + plotHeight * (1 - g)}" stroke="#2a2a2a"/>`)
    .join('')
  const labels =
    `<text x="6" y="13" fill="#9a9a9a" font-family="Helvetica, Arial, sans-serif" font-size="12">L 0..1 solid, chroma 0..0.35 dashed; white target, orange render; x = row, top to bottom</text>`
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${BACKGROUND}"/>${grid}${lines.join('')}${labels}</svg>`,
  )
}

/**
 * target | render | heatmap, then optional note lines (e.g. the falloff
 * ratios), row-mean color strips of target and render (x = row index), the
 * row-mean Oklab L and chroma curves, and optionally target and render with
 * isolines drawn over them.
 */
export async function composeCompare(file, { target, render, heatmap, rows, heatmapMax, notes = [], isolines = null }) {
  const { width, height } = target
  const panelsWidth = width * 3 + GAP * 2
  const labelHeight = 20
  const noteHeight = 20
  const stripHeight = 34
  const curvesHeight = 240
  const notesBlock = notes.length * noteHeight
  const isolineBlock = isolines ? GAP + labelHeight + height : 0
  const totalHeight = labelHeight + height + GAP + notesBlock + labelHeight + stripHeight * 2 + 4 + GAP + curvesHeight + isolineBlock
  const y0 = labelHeight
  const yNotes = y0 + height + GAP
  const yStrips = yNotes + notesBlock + labelHeight
  const yIsolines = yStrips + stripHeight * 2 + 4 + GAP + curvesHeight + GAP + labelHeight
  const isolineInputs = isolines
    ? [
        { ...rawInput(isolines.target), left: 0, top: yIsolines },
        { ...rawInput(isolines.render), left: width + GAP, top: yIsolines },
        ...labels([
          { x: 4, y: yIsolines - 6, text: `target, Oklab lightness isolines ${isolines.caption}` },
          { x: width + GAP + 4, y: yIsolines - 6, text: 'render, the same levels' },
        ]),
      ]
    : []
  const composites = [
    ...isolineInputs,
    { ...rawInput(target), left: 0, top: y0 },
    { ...rawInput(render), left: width + GAP, top: y0 },
    { ...rawInput(heatmap), left: (width + GAP) * 2, top: y0 },
    { input: await stripImage(rows.target, panelsWidth, stripHeight), left: 0, top: yStrips },
    { input: await stripImage(rows.render, panelsWidth, stripHeight), left: 0, top: yStrips + stripHeight + 4 },
    { input: curvesSvg(rows, panelsWidth, curvesHeight), left: 0, top: yStrips + stripHeight * 2 + 4 + GAP },
    ...labels([
      { x: 4, y: 14, text: 'target' },
      { x: width + GAP + 4, y: 14, text: 'render' },
      { x: (width + GAP) * 2 + 4, y: 14, text: `Oklab deltaE, black 0 .. white ${heatmapMax}` },
      ...notes.map((text, i) => ({ x: 4, y: yNotes + 15 + i * noteHeight, text, size: 14, color: '#d8d8d8' })),
      { x: 4, y: yStrips - 6, text: 'row means: target (top), render (bottom)' },
    ]),
  ]
  await mkdir(path.dirname(file), { recursive: true })
  await sharp({ create: { width: panelsWidth, height: totalHeight, channels: 3, background: BACKGROUND } })
    .composite(composites)
    .png({ compressionLevel: PNG_LEVEL })
    .toFile(file)
}

/** Pairs of images (target, render), each fit into a box of imageWidth x height, in a grid with a caption under each pair. */
export async function composeSheet(file, entries, { height = 360, imageWidth = 280, columns = 4 } = {}) {
  const tiles = []
  for (const entry of entries) {
    const scaled = await Promise.all(
      entry.images.map(async (image) => {
        const meta = await sharp(image).metadata()
        const scale = Math.min(imageWidth / meta.width, height / meta.height)
        const w = Math.round(meta.width * scale)
        const h = Math.round(meta.height * scale)
        return { buffer: await sharp(image).resize(w, h).png().toBuffer(), width: w, height: h }
      }),
    )
    tiles.push({ scaled, caption: entry.caption })
  }
  const captionHeight = 26
  const cellWidth = imageWidth * 2 + GAP
  const cellHeight = height + captionHeight
  const rowsCount = Math.ceil(tiles.length / columns)
  const sheetWidth = columns * cellWidth + (columns + 1) * GAP * 2
  const sheetHeight = rowsCount * cellHeight + (rowsCount + 1) * GAP * 2
  const composites = []
  const captions = []
  tiles.forEach((tile, index) => {
    const left = GAP * 2 + (index % columns) * (cellWidth + GAP * 2)
    const top = GAP * 2 + Math.floor(index / columns) * (cellHeight + GAP * 2)
    tile.scaled.forEach((s, i) => {
      composites.push({ input: s.buffer, left: left + i * (imageWidth + GAP) + Math.round((imageWidth - s.width) / 2), top: top + (height - s.height) })
    })
    captions.push({ x: left, y: top + height + 18, text: tile.caption, size: 15 })
  })
  composites.push(...labels(captions))
  await mkdir(path.dirname(file), { recursive: true })
  await sharp({ create: { width: sheetWidth, height: sheetHeight, channels: 3, background: BACKGROUND } })
    .composite(composites)
    .png({ compressionLevel: PNG_LEVEL })
    .toFile(file)
}

/** Side-by-side panels with captions above, all at native size. */
export async function composeRow(file, panels) {
  const labelHeight = 20
  const width = panels.reduce((sum, p) => sum + p.image.width, 0) + GAP * (panels.length - 1)
  const height = labelHeight + Math.max(...panels.map((p) => p.image.height))
  const composites = []
  const captions = []
  let x = 0
  for (const panel of panels) {
    composites.push({ ...rawInput(panel.image), left: x, top: labelHeight })
    captions.push({ x: x + 4, y: 14, text: panel.caption ?? '' })
    x += panel.image.width + GAP
  }
  composites.push(...labels(captions))
  await mkdir(path.dirname(file), { recursive: true })
  await sharp({ create: { width, height, channels: 3, background: BACKGROUND } }).composite(composites).png({ compressionLevel: PNG_LEVEL }).toFile(file)
}
