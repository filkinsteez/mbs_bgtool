// Measures the ridge frame (33:112) and the poster (33:113) for notes: where the light sits, where the
// sky-to-land edge runs and its angle. Measured only, never rendered from.
//   node prototypes/horizon-placement/measure-ridge-poster.mjs > prototypes/horizon-placement/out/ridge-poster.txt
import { describe, fmt, linearToOklch, loadLinear, luminance, meanRect } from './lib/color.mjs'

const frames = new URL('../../artifacts/moodboard-frames/', import.meta.url).pathname

// ---------------------------------------------------------------- ridge
{
  const img = await loadLinear(frames + 'ridge-glow-33-112.png')
  const { width: W, height: H } = img
  console.log(`ridge ${W}x${H}`)
  // brightest 40 x 40 px block
  let best = [0, 0, -1]
  for (let y = 0; y + 40 <= H; y += 8) {
    for (let x = 0; x + 40 <= W; x += 8) {
      const v = luminance(meanRect(img, x, x + 40, y, y + 40))
      if (v > best[2]) best = [x + 20, y + 20, v]
    }
  }
  console.log(`brightest 40 px block at x ${fmt(best[0] / W)} W, y ${fmt(best[1] / H)} H: ${describe(meanRect(img, best[0] - 20, best[0] + 20, best[1] - 20, best[1] + 20))}`)
  // per column group: the y where Oklab L falls fastest (light above, dark below), rows smoothed over 9 px
  console.log('sky-to-land edge per 5% of the width: y of the fastest fall in Oklab L (rows smoothed over 9 px), and the fall per 10 px')
  const edge = []
  for (let f = 0.025; f < 1; f += 0.05) {
    const x0 = Math.round(f * W) - 12
    const col = Array.from({ length: H }, (_, y) => linearToOklch(meanRect(img, x0, x0 + 24, y - 4, y + 5))[0])
    let by = 0
    let bd = 0
    for (let y = Math.round(0.1 * H); y < Math.round(0.9 * H); y++) {
      const d = col[y - 5] - col[y + 5]
      if (d > bd) {
        bd = d
        by = y
      }
    }
    edge.push([f, by / H])
    console.log(`  x ${fmt(f, 3)}  y ${fmt(by / H)} H  dL/10px ${fmt(bd)}  above ${describe(meanRect(img, x0, x0 + 24, by - 40, by - 30))}  below ${describe(meanRect(img, x0, x0 + 24, by + 30, by + 40))}`)
  }
  const n = edge.length
  const mx = edge.reduce((s, e) => s + e[0], 0) / n
  const my = edge.reduce((s, e) => s + e[1], 0) / n
  const slope = edge.reduce((s, e) => s + (e[0] - mx) * (e[1] - my), 0) / edge.reduce((s, e) => s + (e[0] - mx) ** 2, 0)
  console.log(`line fit: y = ${fmt(my)} + ${fmt(slope)} (x - ${fmt(mx)}) in frame fractions; angle ${fmt((Math.atan((slope * H) / W) * 180) / Math.PI, 1)} deg (positive descends to the right)`)
  // row profile at a few columns
  for (const f of [0.15, 0.5, 0.85]) {
    console.log(`column ${f}:`)
    for (let t = 0.04; t < 1; t += 0.08) {
      const y = Math.round(t * H)
      console.log(`  y ${fmt(t, 2)}  ${describe(meanRect(img, Math.round(f * W) - 10, Math.round(f * W) + 10, y - 4, y + 5))}`)
    }
  }
}

// ---------------------------------------------------------------- poster
{
  const img = await loadLinear(frames + 'poster-bands-33-113.png')
  const { width: W, height: H } = img
  console.log(`\nposter ${W}x${H}`)
  console.log('row profile, center 60% of the width, every 4% H (text from about 84% down)')
  for (let t = 0.02; t < 0.86; t += 0.04) {
    const y = Math.round(t * H)
    console.log(`  y ${fmt(t, 2)}  ${describe(meanRect(img, Math.round(0.2 * W), Math.round(0.8 * W), y - 3, y + 4))}`)
  }
  console.log('grey-to-red edge per 10% of the width: y of the fastest rise in Oklab a (red) between 50% and 80% down')
  const ys = []
  for (let f = 0.05; f < 1; f += 0.1) {
    const x0 = Math.round(f * W) - 15
    const col = Array.from({ length: H }, (_, y) => {
      const c = meanRect(img, x0, x0 + 30, y - 4, y + 5)
      const [L, C, h] = linearToOklch(c)
      return C * Math.cos((h * Math.PI) / 180)
    })
    let by = 0
    let bd = 0
    for (let y = Math.round(0.5 * H); y < Math.round(0.8 * H); y++) {
      const d = col[y + 8] - col[y - 8]
      if (d > bd) {
        bd = d
        by = y
      }
    }
    ys.push(by / H)
    console.log(`  x ${fmt(f, 2)}  y ${fmt(by / H)} H  da/16px ${fmt(bd)}`)
  }
  const m = ys.reduce((s, v) => s + v, 0) / ys.length
  console.log(`  mean ${fmt(m)} H, range ${fmt(Math.min(...ys))} to ${fmt(Math.max(...ys))}`)
}
