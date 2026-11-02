// Measures the riso scan (33:109) in its original orientation: where each print's hard edge or
// stripe sits across the sheet and how the gradient runs to paper white. Measured only, never rendered from.
//   node prototypes/horizon-placement/measure-riso.mjs > prototypes/horizon-placement/out/riso.txt
import { describe, fmt, linearToOklch, loadLinear, luminance, meanRect } from './lib/color.mjs'

const img = await loadLinear(new URL('../../artifacts/moodboard-frames/riso-scan-33-109.png', import.meta.url).pathname)
const { width: W, height: H } = img
console.log(`riso scan ${W}x${H}`)

// Prints: rows whose middle stretch has real chroma or is darker than the white margin.
const rowInk = Array.from({ length: H }, (_, y) => {
  const c = meanRect(img, Math.round(W * 0.1), Math.round(W * 0.6), y, y + 1)
  const [L, C] = linearToOklch(c)
  return C > 0.03 || L < 0.85
})
const prints = []
let start = -1
for (let y = 0; y <= H; y++) {
  const on = y < H && rowInk[y]
  if (on && start < 0) start = y
  if (!on && start >= 0) {
    if (y - start > 60) prints.push([start, y])
    start = -1
  }
}
// Left and right edge of each print: columns that differ from the scanner white beside the sheet.
const colsOf = ([y0, y1]) => {
  const ym = Math.round((y0 + y1) / 2)
  const band = [Math.round(y0 + 0.2 * (y1 - y0)), Math.round(y1 - 0.2 * (y1 - y0))]
  const col = (x) => meanRect(img, x, x + 1, band[0], band[1])
  let left = 0
  while (left < W / 2 && luminance(col(left)) > 0.93 && linearToOklch(col(left))[1] < 0.02) left++
  let right = W - 1
  while (right > W / 2 && luminance(col(right)) > 0.93 && linearToOklch(col(right))[1] < 0.02) right--
  return [left, right + 1, ym]
}

const names = ['green', 'blue', 'pink']
prints.forEach(([y0, y1], p) => {
  const [xl, xr] = colsOf([y0, y1])
  const pw = xr - xl
  const band = [Math.round(y0 + 0.15 * (y1 - y0)), Math.round(y1 - 0.15 * (y1 - y0))]
  console.log(`\n${names[p] ?? p}: rows ${y0}-${y1} (${y1 - y0} px tall), columns ${xl}-${xr} (${pw} px wide)`)
  const cols = Array.from({ length: pw }, (_, i) => meanRect(img, xl + i, xl + i + 1, band[0], band[1]))
  const L = cols.map((c) => linearToOklch(c)[0])
  // profile every 4% of the width
  for (let t = 0; t <= 1.0001; t += 0.04) {
    const i = Math.min(pw - 1, Math.round(t * (pw - 1)))
    const c = meanRect(img, xl + i - 2, xl + i + 3, band[0], band[1])
    console.log(`  x ${fmt(t, 2)}  ${describe(c)}`)
  }
  // sharpest steps: Oklab L change over 3 px, skipping the fold near the middle (a 1-3 px line)
  // (the sheet's own edges, the outer 3%, and the fold, 47.5-51.5% across, are skipped)
  const steps = []
  for (let i = Math.round(0.03 * pw); i < Math.round(0.97 * pw); i++) {
    if (i > 0.475 * pw && i < 0.515 * pw) continue
    const d = L[i + 3] - L[i - 3]
    steps.push([i, d])
  }
  steps.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
  const picked = []
  for (const s of steps) {
    if (picked.length >= 4) break
    if (picked.some((q) => Math.abs(q[0] - s[0]) < 15)) continue
    picked.push(s)
  }
  console.log('  steepest lightness steps over 6 px (position across the sheet, from the left):')
  for (const [i, d] of picked.sort((a, b) => a[0] - b[0])) {
    // 10-90 width of the step around i, on L
    const a = L[Math.max(0, i - 12)]
    const b = L[Math.min(pw - 1, i + 12)]
    const lo = Math.min(a, b) + 0.1 * Math.abs(b - a)
    const hi = Math.max(a, b) - 0.1 * Math.abs(b - a)
    let i10 = i
    let i90 = i
    const rising = b > a
    while (i10 > 0 && (rising ? L[i10] > lo : L[i10] < hi)) i10--
    while (i90 < pw - 1 && (rising ? L[i90] < hi : L[i90] > lo)) i90++
    console.log(`    x ${fmt(i / pw)} (${i} px)  dL ${fmt(d)}  10-90 about ${i90 - i10} px (${fmt((i90 - i10) / pw)} of the width)  ${describe(cols[Math.max(0, i - 8)])} -> ${describe(cols[Math.min(pw - 1, i + 8)])}`)
  }
  // paper: where L reaches 98% of the paper level from the right
  const paper = L.slice(pw - 8).reduce((s, v) => s + v, 0) / 8
  let k = pw - 1
  while (k > 0 && L[k] > paper - 0.02) k--
  let k2 = pw - 1
  while (k2 > 0 && L[k2] > paper - 0.15) k2--
  console.log(`  paper L ${fmt(paper)}; within 0.02 L of paper from x ${fmt(k / pw)}; within 0.15 L from x ${fmt(k2 / pw)}`)
  // edge straightness: x of the steepest step per 10% of the print's height
  const [iMain] = picked.reduce((m, s) => (Math.abs(s[1]) > Math.abs(m[1]) ? s : m), picked[0])
  const xs = []
  for (let f = 0.1; f < 0.95; f += 0.1) {
    const yA = Math.round(y0 + f * (y1 - y0)) - 4
    const row = Array.from({ length: 61 }, (_, j) => linearToOklch(meanRect(img, xl + iMain - 30 + j, xl + iMain - 29 + j, yA, yA + 8))[0])
    let bestJ = 3
    let bestD = 0
    for (let j = 3; j < 58; j++) {
      const d = Math.abs(row[j + 3] - row[j - 3])
      if (d > bestD) {
        bestD = d
        bestJ = j
      }
    }
    xs.push(iMain - 30 + bestJ)
  }
  console.log(`  steepest edge x per 10% of the height (px from the print's left): ${xs.join(' ')}`)
})
