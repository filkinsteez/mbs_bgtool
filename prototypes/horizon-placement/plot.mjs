// Plots where the current looks put the horizon and the light, and a sheet of typical shots.
//   node prototypes/horizon-placement/plot.mjs
// Reads out/code-placement.json (code-placement.mjs) and out/shot-measures.json (measure-shots.mjs).
// Writes results/current-distribution.png and results/current-typical.png.
import { readFileSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'

const here = new URL('.', import.meta.url).pathname
const code = JSON.parse(readFileSync(here + 'out/code-placement.json', 'utf8'))
const shots = JSON.parse(readFileSync(here + 'out/shot-measures.json', 'utf8'))

// ---------------------------------------------------------------- distribution
{
  const looks = ['ramp', 'bands', 'blooms']
  const titles = { ramp: 'Ramp', bands: 'Bands', blooms: 'Blooms' }
  const PW = 420
  const PH = 520
  const M = { l: 58, r: 16, t: 54, b: 56 }
  const yMin = -0.02
  const yMax = 1.22
  const Y = (f) => M.t + ((f - yMin) / (yMax - yMin)) * (PH - M.t - M.b)
  const hs = [0, 0.25, 0.5, 0.75, 1]
  const X = (h) => M.l + 20 + h * (PW - M.l - M.r - 40)
  const parts = []
  const jitter = (i) => (((i * 7919) % 97) / 97 - 0.5) * 34
  looks.forEach((look, p) => {
    const ox = p * PW
    parts.push(`<g transform="translate(${ox},0)">`)
    parts.push(`<text x="${M.l}" y="30" font-family="Helvetica, Arial" font-size="18" fill="#111">${titles[look]}</text>`)
    // frame and below-the-frame shading
    parts.push(`<rect x="${M.l}" y="${Y(0)}" width="${PW - M.l - M.r}" height="${Y(1) - Y(0)}" fill="#f4f4f4" stroke="#999"/>`)
    parts.push(`<rect x="${M.l}" y="${Y(1)}" width="${PW - M.l - M.r}" height="${Y(yMax) - Y(1)}" fill="#e6e1d8"/>`)
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      parts.push(`<line x1="${M.l - 4}" x2="${PW - M.r}" y1="${Y(f)}" y2="${Y(f)}" stroke="#ccc" stroke-dasharray="${f === 0 || f === 1 ? '' : '3 3'}"/>`)
      parts.push(`<text x="${M.l - 8}" y="${Y(f) + 4}" text-anchor="end" font-family="Helvetica, Arial" font-size="12" fill="#555">${f === 0 ? 'top' : f === 1 ? 'bottom' : `${Math.round(f * 100)}%`}</text>`)
    }
    parts.push(`<text x="${M.l - 8}" y="${Y(1.15) + 4}" text-anchor="end" font-family="Helvetica, Arial" font-size="11" fill="#777">below</text>`)
    for (const h of hs) parts.push(`<text x="${X(h)}" y="${PH - M.b + 22}" text-anchor="middle" font-family="Helvetica, Arial" font-size="12" fill="#555">${h}</text>`)
    parts.push(`<text x="${(M.l + PW - M.r) / 2}" y="${PH - 12}" text-anchor="middle" font-family="Helvetica, Arial" font-size="12" fill="#333">Horizon control</text>`)
    const clampY = (v) => Math.min(yMax - 0.01, v)
    hs.forEach((h) => {
      const rows = code.filter((r) => r.look === look && r.h === h)
      rows.forEach((r, i) => {
        const x = X(h) + jitter(i)
        if (r.horizon !== null && r.horizon !== undefined) parts.push(`<circle cx="${x - 5}" cy="${Y(clampY(r.horizon))}" r="1.6" fill="#d9480f" fill-opacity="0.45"/>`)
        if (r.glowLine !== null && r.glowLine !== undefined) parts.push(`<circle cx="${x + 5}" cy="${Y(clampY(r.glowLine))}" r="1.6" fill="#1971c2" fill-opacity="0.35"/>`)
      })
    })
    // measured from the shots: brightest band (black ticks)
    for (const h of [0, 0.5, 1]) {
      const rows = shots.filter((r) => r.look === look && r.h === h)
      rows.forEach((r, i) => {
        const x = X(h) + jitter(i + 3) * 0.6 + 22
        parts.push(`<line x1="${x - 3}" x2="${x + 3}" y1="${Y(r.bright)}" y2="${Y(r.bright)}" stroke="#111" stroke-opacity="0.6" stroke-width="1.4"/>`)
      })
    }
    parts.push('</g>')
  })
  // legend under the plots, the targets to the right
  const LW = 330
  const lx = looks.length * PW + 10
  const legendY = PH + 8
  const legend = [
    ['dot', '#d9480f', 'horizon, read from the compose code: every pack, both formats, seeds 1-64'],
    ['dot', '#1971c2', 'light: glow line (Ramp), glow band top (Bands), lead light center (Blooms), from the code'],
    ['tick', '#111', 'brightest row measured on the shots (seeds 1-8, Horizon 0, 0.5, 1)'],
  ]
  legend.forEach(([kind, c, t], i) => {
    const x0 = M.l
    const y0 = legendY + 10 + i * 18
    if (kind === 'dot') parts.push(`<circle cx="${x0 + 6}" cy="${y0}" r="4" fill="${c}"/>`)
    else parts.push(`<line x1="${x0}" x2="${x0 + 12}" y1="${y0}" y2="${y0}" stroke="${c}" stroke-width="1.8"/>`)
    parts.push(`<text x="${x0 + 18}" y="${y0 + 4}" font-family="Helvetica, Arial" font-size="12" fill="#333">${t}</text>`)
  })
  // target horizons on a frame-height scale
  const tx = lx + 10
  parts.push(`<text x="${lx}" y="${Y(0) - 14}" font-family="Helvetica, Arial" font-size="15" fill="#111">Targets</text>`)
  parts.push(`<rect x="${tx}" y="${Y(0)}" width="40" height="${Y(1) - Y(0)}" fill="#f4f4f4" stroke="#999"/>`)
  const targets = [
    [0.728, 'sea: horizon line 73%'],
    [0.682, 'poster: grey-to-red edge 68%'],
    [0.255, 'ridge: light center 26%'],
    [0.37, 'ridge: top at the right edge 37%'],
    [0.6, 'ridge: lowest dips 55-61%'],
    [0.41, 'sea: brightest band 41%'],
    [0.45, 'blue riso, turned: hard edge 45%'],
    [0.62, 'pink riso, turned: hard edge 62%'],
  ]
  const sorted = [...targets].sort((a, b) => a[0] - b[0])
  let lastY = -Infinity
  sorted.forEach(([f, t]) => {
    const yy = Math.max(Y(f), lastY + 15)
    lastY = yy
    parts.push(`<line x1="${tx}" x2="${tx + 40}" y1="${Y(f)}" y2="${Y(f)}" stroke="#d9480f" stroke-width="1.5"/>`)
    parts.push(`<line x1="${tx + 40}" x2="${tx + 52}" y1="${Y(f)}" y2="${yy}" stroke="#bbb"/>`)
    parts.push(`<text x="${tx + 56}" y="${yy + 4}" font-family="Helvetica, Arial" font-size="12" fill="#333">${t}</text>`)
  })
  const width = looks.length * PW + LW
  const height = PH + 66
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#fff"/>${parts.join('')}</svg>`
  await sharp(Buffer.from(svg)).png({ palette: true, colors: 64 }).toFile(here + 'results/current-distribution.png')
  console.log('results/current-distribution.png')
}

// ---------------------------------------------------------------- Fresnel against the sea's reflection
{
  // Sea 33:106, measure-sea.mjs section 6: reflection luminance over the sky row of the same hue,
  // against depth below the line as a share of the frame height.
  const measured = [
    [0.004, 0.957], [0.012, 0.95], [0.018, 0.966], [0.025, 0.957], [0.037, 0.911], [0.055, 0.829],
    [0.074, 0.741], [0.099, 0.608], [0.123, 0.514], [0.16, 0.451], [0.197, 0.39], [0.234, 0.349], [0.265, 0.336],
  ]
  const fresnel = (deg) => {
    const n = 1.333
    const i = (Math.min(89.999, Math.max(0, 90 - deg)) * Math.PI) / 180
    const ci = Math.cos(i)
    const st = Math.sin(i) / n
    const ct = Math.sqrt(1 - st * st)
    return (((ci - n * ct) / (ci + n * ct)) ** 2 + ((ct - n * ci) / (ct + n * ci)) ** 2) / 2
  }
  const W = 640
  const H = 340
  const M = { l: 56, r: 230, t: 30, b: 46 }
  const X = (f) => M.l + (f / 0.28) * (W - M.l - M.r)
  const Y = (v) => M.t + (1 - v / 1.1) * (H - M.t - M.b)
  const p = [`<rect width="100%" height="100%" fill="#fff"/>`]
  p.push(`<text x="${M.l}" y="20" font-family="Helvetica, Arial" font-size="14" fill="#111">Sea 33:106: reflection brightness against water's Fresnel reflectance</text>`)
  p.push(`<rect x="${M.l}" y="${M.t}" width="${W - M.l - M.r}" height="${H - M.t - M.b}" fill="none" stroke="#999"/>`)
  for (const v of [0, 0.25, 0.5, 0.75, 1]) {
    p.push(`<line x1="${M.l}" x2="${W - M.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="#eee"/>`)
    p.push(`<text x="${M.l - 6}" y="${Y(v) + 4}" text-anchor="end" font-family="Helvetica, Arial" font-size="11" fill="#555">${v}</text>`)
  }
  for (const f of [0, 0.05, 0.1, 0.15, 0.2, 0.25]) p.push(`<text x="${X(f)}" y="${H - M.b + 16}" text-anchor="middle" font-family="Helvetica, Arial" font-size="11" fill="#555">${Math.round(f * 100)}%</text>`)
  p.push(`<text x="${(M.l + W - M.r) / 2}" y="${H - 10}" text-anchor="middle" font-family="Helvetica, Arial" font-size="12" fill="#333">depth below the horizon, share of the frame height (frame is 1.5 short sides tall)</text>`)
  const curves = [[25, '#74c0fc'], [30, '#1971c2'], [40, '#0b3d75']]
  curves.forEach(([fov, c], k) => {
    const pts = Array.from({ length: 57 }, (_, i) => {
      const f = (i / 56) * 0.28
      return `${X(f).toFixed(1)},${Y(fresnel(f * 1.5 * fov)).toFixed(1)}`
    })
    p.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="${c}" stroke-width="2"/>`)
    p.push(`<line x1="${W - M.r + 12}" x2="${W - M.r + 30}" y1="${M.t + 20 + k * 20}" y2="${M.t + 20 + k * 20}" stroke="${c}" stroke-width="2"/>`)
    p.push(`<text x="${W - M.r + 36}" y="${M.t + 24 + k * 20}" font-family="Helvetica, Arial" font-size="11" fill="#333">Fresnel, ${fov} deg per short side</text>`)
  })
  measured.forEach(([f, v]) => p.push(`<circle cx="${X(f)}" cy="${Y(v)}" r="3.5" fill="#d9480f"/>`))
  p.push(`<circle cx="${W - M.r + 21}" cy="${M.t + 84}" r="3.5" fill="#d9480f"/>`)
  p.push(`<text x="${W - M.r + 36}" y="${M.t + 88}" font-family="Helvetica, Arial" font-size="11" fill="#333">measured, same-hue sky row</text>`)
  await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${p.join('')}</svg>`)).png({ palette: true, colors: 64 }).toFile(here + 'results/fresnel-vs-sea.png')
  console.log('results/fresnel-vs-sea.png')
}

// ---------------------------------------------------------------- typical shots
{
  const looks = ['ramp', 'bands', 'blooms']
  const hs = [0, 0.5, 1]
  const seeds = [1, 2, 3, 4]
  const TW = 180
  const TH = 101
  const TALL = 101
  const gap = 10
  const mark = 10
  const cols = []
  const composites = []
  const texts = []
  let y = 50
  texts.push(`<text x="10" y="20" font-family="Helvetica, Arial" font-size="14" fill="#111">Current looks: Bold 16:9 seeds 1-4 and Elemental 9:16 seed 3. Rows: Horizon 0, 0.5, 1.</text>`)
  texts.push(`<text x="10" y="38" font-family="Helvetica, Arial" font-size="13" fill="#333">Orange tick: horizon read from the code. Black tick: brightest row measured on the shot.</text>`)
  for (const look of looks) {
    texts.push(`<text x="10" y="${y + 14}" font-family="Helvetica, Arial" font-size="15" fill="#111">${look[0].toUpperCase() + look.slice(1)}</text>`)
    y += 22
    for (const h of hs) {
      let x = 10
      texts.push(`<text x="${x}" y="${y + TH / 2 + 4}" font-family="Helvetica, Arial" font-size="12" fill="#444">H ${h}</text>`)
      x += 40
      const tiles = [...seeds.map((s) => ['bold', '16x9', s]), ['elemental', '9x16', 3]]
      for (const [pack, format, s] of tiles) {
        const file = `${here}out/shots/${look}-${pack}-${format}-s${s}-h${h}.png`
        const tall = format === '9x16'
        const w = tall ? Math.round((TALL * 9) / 16) : TW
        const hh = tall ? TALL : TH
        let buf
        try {
          buf = await sharp(file).resize(w, hh).png().toBuffer()
        } catch {
          continue
        }
        composites.push({ input: buf, left: x + mark, top: y })
        const c = code.find((r) => r.look === look && r.pack === pack && r.format === format && r.seed === s && r.h === h)
        const m = shots.find((r) => r.look === look && r.pack === pack && r.format === format && r.seed === s && r.h === h)
        const tick = (f, color) => {
          if (f === null || f === undefined) return
          const ty = y + Math.min(hh + 6, f * hh)
          texts.push(`<path d="M ${x} ${ty - 4} L ${x + mark - 1} ${ty} L ${x} ${ty + 4} Z" fill="${color}"/>`)
        }
        tick(c?.horizon, '#d9480f')
        tick(m?.bright, '#111')
        texts.push(`<text x="${x + mark}" y="${y + hh + 12}" font-family="Helvetica, Arial" font-size="10" fill="#666">${pack} ${format} s${s}</text>`)
        x += mark + w + gap
      }
      cols.push(x)
      y += TH + 22
    }
    y += 6
  }
  const width = Math.max(...cols) + 10
  const height = y + 4
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${texts.join('')}</svg>`)
  const out = await sharp({ create: { width, height, channels: 3, background: '#ffffff' } })
    .composite([...composites, { input: svg, left: 0, top: 0 }])
    .png({ compressionLevel: 9 })
    .toBuffer()
  writeFileSync(here + 'results/current-typical.png', out)
  console.log('results/current-typical.png', (out.length / 1024).toFixed(0), 'KB')
}
