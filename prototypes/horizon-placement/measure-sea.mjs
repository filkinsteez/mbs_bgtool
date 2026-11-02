// Measures the sea sunset (33:106) for notes: horizon height, tilt, the bright line, and how the
// reflection relates to the sky above it. Reference pixels are only measured here; nothing renders from them.
//   node prototypes/horizon-placement/measure-sea.mjs > prototypes/horizon-placement/out/sea.txt
import { describe, fmt, linearToOklch, loadLinear, luminance, meanRect } from './lib/color.mjs'

const img = await loadLinear(new URL('../../artifacts/moodboard-frames/sea-horizon-33-106.png', import.meta.url).pathname)
const { width: W, height: H } = img
console.log(`sea ${W}x${H}`)

const x0 = Math.round(W * 0.15)
const x1 = Math.round(W * 0.85)
const rows = Array.from({ length: H }, (_, y) => meanRect(img, x0, x1, y, y + 1))
const Y = rows.map(luminance)

// 1. The bright line: the row that stands out most above its neighbours, 60-85% down.
let best = -1
let bestLift = -Infinity
for (let y = Math.round(0.6 * H); y < Math.round(0.85 * H); y++) {
  const around = (Y[y - 6] + Y[y - 5] + Y[y + 5] + Y[y + 6]) / 4
  const lift = Y[y] / around
  if (lift > bestLift) {
    bestLift = lift
    best = y
  }
}
console.log(`\nbright line row ${best} (${fmt(best / H)} H), ${fmt(bestLift)}x the rows 5-6 px away`)
for (let y = best - 8; y <= best + 8; y++) console.log(`  y ${y} ${fmt(y / H)}  ${describe(rows[y])}  Y ${fmt(Y[y], 4)}`)

// 2. Tilt: the line's peak row per 20 px column group, with a parabola through the peak.
const groups = []
for (let gx = 0; gx + 20 <= W; gx += 20) {
  const col = Array.from({ length: 25 }, (_, k) => luminance(meanRect(img, gx, gx + 20, best - 12 + k, best - 11 + k)))
  let k = 1
  for (let i = 1; i < col.length - 1; i++) if (col[i] > col[k]) k = i
  const [a, b, c] = [col[k - 1], col[k], col[k + 1]]
  const off = (a - c) / (2 * (a - 2 * b + c))
  groups.push([gx + 10, best - 12 + k + (Number.isFinite(off) ? off : 0)])
}
const n = groups.length
const mx = groups.reduce((s, g) => s + g[0], 0) / n
const my = groups.reduce((s, g) => s + g[1], 0) / n
const slope = groups.reduce((s, g) => s + (g[0] - mx) * (g[1] - my), 0) / groups.reduce((s, g) => s + (g[0] - mx) ** 2, 0)
const resid = Math.sqrt(groups.reduce((s, g) => s + (g[1] - my - slope * (g[0] - mx)) ** 2, 0) / n)
console.log(`\nline per 20 px group: mean y ${fmt(my, 2)}, slope ${fmt(slope, 5)} px/px (${fmt((Math.atan(slope) * 180) / Math.PI, 3)} deg), drop across the width ${fmt(slope * W, 2)} px, residual RMS ${fmt(resid, 2)} px`)
console.log('  ' + groups.map((g) => g[1].toFixed(1)).join(' '))

// 3. Profiles every 2% of the height.
console.log('\nrow profile (center 70% of the width), every 2% H')
for (let t = 0; t <= 1.0001; t += 0.02) {
  const y = Math.min(H - 1, Math.round(t * (H - 1)))
  const c = meanRect(img, x0, x1, y - 2, y + 3)
  console.log(`  ${fmt(t, 2)}  y ${String(y).padStart(3)}  ${describe(c)}  Y ${fmt(luminance(c), 4)}`)
}

// 4. Left / right brightness across the sky and the water.
console.log('\nleft / right fifths (luminance ratio right / left)')
for (const t of [0.1, 0.3, 0.5, 0.6, 0.66, 0.7, 0.75, 0.8, 0.9, 0.98]) {
  const y = Math.round(t * H)
  const l = meanRect(img, 0, Math.round(W / 5), y - 3, y + 4)
  const r = meanRect(img, Math.round((4 * W) / 5), W, y - 3, y + 4)
  console.log(`  ${fmt(t, 2)}  left ${describe(l)}  right ${describe(r)}  ratio ${fmt(luminance(r) / luminance(l))}`)
}

// 5. Mirror: the reflection row d below the line against the sky row d above it.
const hy = best
const smooth = (y) => meanRect(img, x0, x1, y - 2, y + 3)
console.log('\nmirror check: reflection at line + d against sky at line - d')
console.log('  d/H    reflection                                sky (mirrored)                            Y ratio  C ratio  dh')
for (const d of [2, 4, 6, 10, 15, 20, 30, 40, 60, 80, 100, 130, 160, 200, 225]) {
  if (hy + d >= H) break
  const r = smooth(hy + d)
  const s = smooth(hy - d)
  const [, Cr, hr] = linearToOklch(r)
  const [, Cs, hs] = linearToOklch(s)
  console.log(`  ${fmt(d / H)}  ${describe(r).padEnd(40)}  ${describe(s).padEnd(40)}  ${fmt(luminance(r) / luminance(s))}   ${fmt(Cr / Cs)}   ${fmt(hr - hs, 0)}`)
}

// 6. Best match: for each reflection row, the sky row with the closest hue among rows with real chroma,
// then the luminance and chroma ratio at that match. Shows whether the order is mirrored and squeezed.
console.log('\nhue match: reflection row -> sky row with the nearest hue (sky rows 0.30-1.0 of the way to the line)')
const sky = []
for (let y = Math.round(0.3 * hy); y < hy - 2; y++) sky.push([y, smooth(y)])
for (const d of [3, 6, 10, 15, 20, 30, 45, 60, 80, 100, 130, 160, 190, 215]) {
  if (hy + d >= H - 2) break
  const r = smooth(hy + d)
  const [Lr, Cr, hr] = linearToOklch(r)
  let bestRow = null
  let bestErr = Infinity
  for (const [y, c] of sky) {
    const [, C, h] = linearToOklch(c)
    const dh = Math.min(Math.abs(h - hr), 360 - Math.abs(h - hr))
    const err = dh + 40 * Math.abs(Math.log((C + 0.01) / (Cr + 0.01)))
    if (err < bestErr) {
      bestErr = err
      bestRow = [y, c]
    }
  }
  const [y, c] = bestRow
  const [Ls, Cs, hs] = linearToOklch(c)
  console.log(`  d ${String(d).padStart(3)} (${fmt(d / H)} H)  h ${hr.toFixed(0)} C ${Cr.toFixed(3)} L ${Lr.toFixed(3)}  ->  sky ${hy - y} px above (${fmt((hy - y) / H)} H)  h ${hs.toFixed(0)} C ${Cs.toFixed(3)} L ${Ls.toFixed(3)}  Y ratio ${fmt(luminance(r) / luminance(c))}  above/below ${fmt((hy - y) / d, 2)}`)
}

// 7. Sharpness: largest Oklab change per pixel just above and just below the line.
const dE = (a, b) => {
  const [La, Ca, ha] = linearToOklch(a)
  const [Lb, Cb, hb] = linearToOklch(b)
  const aa = [La, Ca * Math.cos((ha * Math.PI) / 180), Ca * Math.sin((ha * Math.PI) / 180)]
  const bb = [Lb, Cb * Math.cos((hb * Math.PI) / 180), Cb * Math.sin((hb * Math.PI) / 180)]
  return Math.hypot(aa[0] - bb[0], aa[1] - bb[1], aa[2] - bb[2])
}
console.log('\nOklab change per pixel, mean over windows (rows smoothed over 5 px)')
for (const [a, b] of [[-120, -60], [-60, -30], [-30, -10], [-10, -4], [4, 10], [10, 30], [30, 60], [60, 120], [120, 200]]) {
  let s = 0
  let k = 0
  for (let d = a; d < b; d++) {
    if (hy + d + 1 >= H - 2 || hy + d < 2) continue
    s += dE(smooth(hy + d), smooth(hy + d + 1))
    k++
  }
  console.log(`  ${String(a).padStart(4)} to ${String(b).padStart(4)} px  ${fmt(k ? s / k : 0, 5)}`)
}

// 8. Fine texture: high-pass RMS of luminance in the sky and in the water (ripple streaks show as horizontal texture).
const hp = (yA, yB) => {
  let sx = 0
  let sy = 0
  let k = 0
  for (let y = yA; y < yB; y++) {
    for (let x = x0 + 1; x < x1 - 1; x++) {
      const i = (y * W + x) * 3
      const v = luminance([img.px[i], img.px[i + 1], img.px[i + 2]])
      const left = luminance([img.px[i - 3], img.px[i - 2], img.px[i - 1]])
      const up = luminance([img.px[i - W * 3], img.px[i - W * 3 + 1], img.px[i - W * 3 + 2]])
      sx += (v - left) ** 2
      sy += (v - up) ** 2
      k++
    }
  }
  return [Math.sqrt(sx / k), Math.sqrt(sy / k)]
}
for (const [name, a, b] of [['sky 40-60%', Math.round(0.4 * H), Math.round(0.6 * H)], ['sky just above line', hy - 40, hy - 4], ['water just below', hy + 4, hy + 40], ['water 80-95%', Math.round(0.8 * H), Math.round(0.95 * H)]]) {
  const [gx, gy] = hp(a, b)
  console.log(`  ${name.padEnd(20)} pixel step RMS: across ${fmt(gx, 5)}, down ${fmt(gy, 5)}, across/down ${fmt(gx / gy, 2)}`)
}
