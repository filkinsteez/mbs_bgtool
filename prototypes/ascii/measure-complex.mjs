// Geometry of the complex glyphs in out/glyphs/optimistic.png (400 px font, cells 440 px, baseline 460 px).
import sharp from 'sharp'
const { data, info } = await sharp('prototypes/ascii/out/glyphs/optimistic.png').raw().toBuffer({ resolveWithObject: true })
const S = 400, cellW = 440, base = 460, W = info.width, C = info.channels
const ink = (x, y) => (x < 0 || y < 0 || x >= W || y >= info.height ? 0 : 1 - data[(y * W + x) * C] / 255)
const em = (v) => +(v / S).toFixed(4)
function runsRow(i, yEm, halfW = 0.6) {
  const cx = (i + 0.5) * cellW, y = Math.round(base - yEm * S), out = []
  let start = -1, sum = 0, wsum = 0
  for (let x = Math.round(cx - halfW * S); x <= Math.round(cx + halfW * S) + 1; x++) {
    const v = ink(x, y)
    if (v > 0.5 && start < 0) { start = x; sum = 0; wsum = 0 }
    if (start >= 0) { sum += v; wsum += v * x }
    if (v <= 0.5 && start >= 0) { out.push({ c: em(wsum / sum - cx), w: em(sum) }); start = -1 }
  }
  return out
}
function runsCol(i, xEm) {
  const cx = (i + 0.5) * cellW, x = Math.round(cx + xEm * S), out = []
  let start = -1, sum = 0, wsum = 0
  for (let y = 0; y < info.height; y++) {
    const v = ink(x, y)
    if (v > 0.5 && start < 0) { start = y; sum = 0; wsum = 0 }
    if (start >= 0) { sum += v; wsum += v * y }
    if (v <= 0.5 && start >= 0) { out.push({ c: em(base - wsum / sum), w: em(sum) }); start = -1 }
  }
  return out
}
const show = (label, rows) => console.log(label, JSON.stringify(rows))
console.log("'#' rows (x centres and widths of stroke runs)")
for (const y of [0.03, 0.1, 0.3, 0.35, 0.4, 0.6, 0.67]) show(`  y=${y}`, runsRow(7, y))
console.log("'#' cols"); for (const x of [-0.27, 0, 0.27]) show(`  x=${x}`, runsCol(7, x))
console.log("'%' rows"); for (const y of [0.0, 0.08, 0.155, 0.25, 0.35, 0.45, 0.53, 0.6, 0.7]) show(`  y=${y}`, runsRow(8, y))
console.log("'%' cols"); for (const x of [-0.3, -0.21, -0.12, 0, 0.12, 0.21, 0.3]) show(`  x=${x}`, runsCol(8, x))
console.log("'@' rows"); for (const y of [-0.15, -0.05, 0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65]) show(`  y=${y}`, runsRow(9, y))
console.log("'@' cols"); for (const x of [-0.4, -0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.4]) show(`  x=${x}`, runsCol(9, x))
console.log("'*' rows"); for (const y of [0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7]) show(`  y=${y}`, runsRow(6, y, 0.3))
console.log("'+' rows"); for (const y of [0.2, 0.35]) show(`  y=${y}`, runsRow(5, y, 0.3))
