// Renders the ASCII ramp in the deck's fonts at 400 px and measures each glyph in em units:
// ink box, ink area, and stroke runs through the glyph's middle. Writes out/glyphs/<font>.png and prints a table.
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { OUT, startPrototype } from './lib/server.mjs'

const RAMP = ' .:-=+*#%@'
const SIZE = 400
const FONTS = [
  { name: 'optimistic', family: 'OptimisticProto', url: '/src/fonts/OptimisticVF.ttf' },
  { name: 'menlo', family: 'Menlo' },
  { name: 'sfmono', family: 'SF Mono' },
]

const outDir = path.join(OUT, 'glyphs')
fs.mkdirSync(outDir, { recursive: true })
const proto = await startPrototype()
const report = {}
try {
  for (const font of FONTS) {
    const key = proto.nextKey('glyphs')
    const cellW = SIZE * 1.1
    const cellH = SIZE * 1.6
    const baseline = SIZE * 1.15
    const info = await proto.call('glyphSheet', { family: font.family, url: font.url, chars: RAMP, size: SIZE, cellW, cellH, baseline, key })
    const data = proto.take(key)
    await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(path.join(outDir, `${font.name}.png`))
    const ink = (x, y) => 1 - data[(y * info.width + x) * 4] / 255
    const glyphs = info.metrics.map((m, i) => {
      const x0 = Math.floor(i * cellW)
      const x1 = Math.floor((i + 1) * cellW)
      let area = 0
      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      let cx = 0
      let cy = 0
      for (let y = 0; y < info.height; y++) {
        for (let x = x0; x < x1; x++) {
          const v = ink(x, y)
          if (v <= 0.02) continue
          area += v
          cx += v * x
          cy += v * y
          if (v > 0.5) {
            minX = Math.min(minX, x)
            maxX = Math.max(maxX, x)
            minY = Math.min(minY, y)
            maxY = Math.max(maxY, y)
          }
        }
      }
      const centre = (i + 0.5) * cellW
      const em = (v) => +(v / SIZE).toFixed(4)
      // Runs of ink along the vertical line through the ink centroid and the horizontal line through it.
      const runs = (fixed, vertical) => {
        const out = []
        let start = -1
        let sum = 0
        const n = vertical ? info.height : x1 - x0
        for (let t = 0; t <= n; t++) {
          const v = t < n ? (vertical ? ink(Math.round(fixed), t) : ink(x0 + t, Math.round(fixed))) : 0
          if (v > 0.02 && start < 0) {
            start = t
            sum = 0
          }
          if (v > 0.02) sum += v
          if (v <= 0.02 && start >= 0) {
            const mid = (start + t - 1) / 2
            out.push({ width: em(sum), at: vertical ? em(baseline - mid) : em(x0 + mid - centre) })
            start = -1
          }
        }
        return out
      }
      const gx = area > 0 ? cx / area : centre
      const gy = area > 0 ? cy / area : baseline
      return {
        ch: m.ch,
        advance: em(m.advance),
        box: area > 0 ? { left: em(minX - centre), right: em(maxX + 1 - centre), bottom: em(baseline - maxY - 1), top: em(baseline - minY) } : null,
        area: em(em(area) * SIZE),
        centroid: area > 0 ? { x: em(gx - centre), y: em(baseline - gy) } : null,
        vertical: area > 0 ? runs(gx, true) : [],
        horizontal: area > 0 ? runs(gy, false) : [],
      }
    })
    report[font.name] = { resolved: info.resolved, ascent: +(info.fontAscent / SIZE).toFixed(4), descent: +(info.fontDescent / SIZE).toFixed(4), glyphs }
    console.log(`\n${font.name} (${info.resolved}) ascent ${report[font.name].ascent} descent ${report[font.name].descent}`)
    for (const g of glyphs) {
      const box = g.box ? `x ${g.box.left}..${g.box.right} y ${g.box.bottom}..${g.box.top}` : 'empty'
      console.log(
        `'${g.ch}' adv ${g.advance} area ${g.area} ${box}` +
          (g.vertical.length ? ` | v-runs ${g.vertical.map((r) => `${r.width}@${r.at}`).join(' ')}` : '') +
          (g.horizontal.length ? ` | h-runs ${g.horizontal.map((r) => `${r.width}@${r.at}`).join(' ')}` : ''),
      )
    }
  }
  fs.writeFileSync(path.join(outDir, 'metrics.json'), JSON.stringify(report, null, 2))
} finally {
  await proto.close()
}
