// A long soft transition over a much darker ground (a glow tail fading into a dark
// sky or ground) on the GPU through the engine, with the silhouette edge's crest term
// before (clamped at 0 and 2.5, commit 701d8fa) and now (smooth). Under each render,
// how sharply its lightness bends along x (Oklab L blurred by 1.5 px, second
// difference across x, the same gain for both): a kink in the width along the edge
// shows as a vertical line there, a soft vertical column in the picture. The plot is
// the softness multiplier along the edge. "columns" is the largest bend averaged
// over the transition's rows, in 1e-6 L per pixel squared: a column runs the whole
// height of the transition, other detail averages out.
// node crest-sheet.mjs [--update-results]  ->  out/crest/*.png and out/crest/crest-sheet.jpg
// (not committed); --update-results writes the sheet to results/crest-smooth.jpg instead.

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { startHarness } from '../../scripts/light/lib/harness.mjs'
import { PROTO, ROOT } from './lib/refs.mjs'
import { hexToLinear, luminance, linearToOklab } from './lib/color.mjs'
import { saveCanvas, row, column, makeCanvas, drawPolyline, drawText, resizeCanvas } from './lib/image.mjs'
import { canvasToLinear } from './lib/output.mjs'
import { blurPlane } from './lib/blur.mjs'
import { RAMP_GLSL, boundaryParams } from './lib/engine-scene.mjs'

const dir = path.join(PROTO, 'out/crest')
fs.mkdirSync(dir, { recursive: true })
const oldFile = path.join(PROTO, 'out/lib-701d8fa/boundary.ts')
if (!fs.existsSync(oldFile)) {
  fs.mkdirSync(path.dirname(oldFile), { recursive: true })
  fs.writeFileSync(oldFile, execFileSync('git', ['show', '701d8fa:src/light/recipes/sunset/boundary.ts'], { cwd: ROOT }))
}
const OLD = await import(oldFile)
const f = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '-')

// Two colors of one pack, the lighter one first, mixed over a wide transition.
const FRAMES = [
  { name: 'bold-16x9', label: 'Bold, Yellow over Meta Blue, 16:9', hexes: ['#FFD61E', '#0064E0'], w: 960, h: 540, seed: 3 },
  { name: 'atmospheric-9x16', label: 'Atmospheric, Ice over Slate, 9:16', hexes: ['#F2F4F7', '#384753'], w: 540, h: 960, seed: 5 },
]
const WIDTH = 0.55 // 10-90% width in short sides

function sceneFor(fr) {
  const aspect = fr.w / fr.h
  const tall = Math.max(1, 1 / aspect)
  const colors = fr.hexes.map(hexToLinear)
  const Y = colors.map((c) => luminance(c[0], c[1], c[2]))
  return {
    tall,
    colors,
    tilt: 0,
    bridge: [0, 0],
    transitions: [{ at: 0, width: WIDTH, contrast: (Y[0] - Y[1]) / Math.max(Y[0], Y[1]) }],
    wander: [
      [-0.3, 0.012],
      [0, 0.014],
      [0.3, 0.012],
    ],
  }
}

// how sharply the lightness bends along x, and the strongest column over the transition's rows
function bendAlongX(c, scene) {
  const lin = canvasToLinear(c)
  const L = new Float32Array(c.w * c.h)
  for (let i = 0; i < c.w * c.h; i++) L[i] = linearToOklab(lin.ch[0][i], lin.ch[1][i], lin.ch[2][i])[0]
  const s = blurPlane(L, c.w, c.h, 1.5)
  const d2 = new Float32Array(c.w * c.h)
  for (let y = 0; y < c.h; y++) for (let x = 1; x + 1 < c.w; x++) d2[y * c.w + x] = s[y * c.w + x + 1] - 2 * s[y * c.w + x] + s[y * c.w + x - 1]
  const t = scene.transitions[0]
  const toRow = (v) => Math.round(((v + 0.5 * scene.tall) / scene.tall) * c.h)
  const y0 = Math.max(0, toRow(t.at - 0.5 * t.width))
  const y1 = Math.min(c.h, toRow(t.at + 0.5 * t.width))
  let worst = 0
  let at = 0
  // away from the left and right edges, where the blur runs out of picture
  for (let x = 8; x < c.w - 8; x++) {
    let sum = 0
    for (let y = y0; y < y1; y++) sum += d2[y * c.w + x]
    if (Math.abs(sum / (y1 - y0)) > worst) {
      worst = Math.abs(sum / (y1 - y0))
      at = x
    }
  }
  return { d2, columns: worst * 1e6, at, rows: [y0, y1] }
}

// The same crop of each picture at 1:1: every row's Oklab L minus its straight-line
// fit across the crop, at a gain shared by the crops. A kink in the width is a sharp V
// down the column, which the eye picks out as a soft column; a smooth width is a smooth curve.
function rowResidualCrops(canvases, x0, y0, w, h) {
  const xm = (w - 1) / 2
  const sxx = Array.from({ length: w }, (_, x) => (x - xm) ** 2).reduce((s, v) => s + v, 0)
  const residuals = canvases.map((c) => {
    const lin = canvasToLinear(c)
    const r = new Float32Array(w * h)
    for (let y = 0; y < h; y++) {
      const L = Array.from({ length: w }, (_, x) => {
        const i = (y0 + y) * c.w + x0 + x
        return linearToOklab(lin.ch[0][i], lin.ch[1][i], lin.ch[2][i])[0]
      })
      const mean = L.reduce((s, v) => s + v, 0) / w
      const slope = L.reduce((s, v, x) => s + (x - xm) * (v - mean), 0) / sxx
      for (let x = 0; x < w; x++) r[y * w + x] = L[x] - mean - slope * (x - xm)
    }
    return r
  })
  const sorted = Float32Array.from(residuals[0], Math.abs).sort()
  const gain = 127 / Math.max(1e-9, sorted[Math.floor(0.995 * (sorted.length - 1))])
  return residuals.map((r) => bendImage(r, w, h, gain))
}

// the bend as a gray picture, at a gain shared by both versions
function bendImage(d2, w, h, gain) {
  const out = makeCanvas(w, h)
  for (let i = 0; i < w * h; i++) {
    const v = Math.max(0, Math.min(255, 128 + d2[i] * gain))
    out.data[i * 3] = out.data[i * 3 + 1] = out.data[i * 3 + 2] = v
  }
  return out
}

// the softness multiplier along the edge, and its largest bend (second difference)
function softCurve(cal, halfW) {
  const n = 2000
  const h = (2 * halfW) / n
  const v = Array.from({ length: n + 1 }, (_, k) => cal.field.soft(-halfW + k * h, 0))
  let bend = 0
  for (let k = 1; k < n; k++) bend = Math.max(bend, Math.abs(v[k + 1] - 2 * v[k] + v[k - 1]) / (h * h))
  return { v, bend }
}

const harness = await startHarness()
const NOW = await harness.ssr('/src/light/recipes/sunset/boundary.ts')
const sheets = []
const lines = []
for (const fr of FRAMES) {
  const scene = sceneFor(fr)
  const aspect = fr.w / fr.h
  const halfW = 0.5 * Math.max(aspect, 1)
  const renders = []
  for (const [tag, B] of [
    ['before', OLD],
    ['now', NOW],
  ]) {
    const cal = B.calibrateBoundary(boundaryParams(scene), aspect, fr.seed)
    const colorUniform = Array.from({ length: 8 }, (_, i) => scene.colors[Math.min(i, scene.colors.length - 1)]).flat()
    const uniforms = { ...cal.uniforms, uObColor: colorUniform, uObTilt: [0, 1], uObBridge: scene.bridge, uObTop: -0.5 * scene.tall }
    const key = `crest-${fr.name}-${tag}`
    // Sent as a string: this code runs in the page.
    await harness.page.evaluate(`(async ({ fragment, uniforms, width, height, seed, key }) => {
      const { ProgramRenderer } = await import('/src/light/engine/programRenderer.ts')
      const program = { id: 'test.boundary-crest', colorSlots: [], defaultColors: [], params: [], fragment, uniforms: () => uniforms }
      const renderer = new ProgramRenderer(document.createElement('canvas'))
      renderer.renderProgram(program, { seed, lens: { bloom: 0, halation: 0 }, output: { grain: 0, exposure: 0 } }, { width, height, supersample: 1, dither: false })
      const data = renderer.readPixels()
      renderer.dispose()
      await fetch('/__light/upload/' + key, { method: 'POST', body: new Blob([data]) })
    })(${JSON.stringify({ fragment: B.BOUNDARY_GLSL + RAMP_GLSL, uniforms, width: fr.w, height: fr.h, seed: fr.seed, key })})`)
    const bytes = harness.takeUpload(key)
    const c = { w: fr.w, h: fr.h, data: new Uint8ClampedArray(fr.w * fr.h * 3) }
    for (let i = 0; i < fr.w * fr.h; i++) for (let q = 0; q < 3; q++) c.data[i * 3 + q] = bytes[i * 4 + q]
    await saveCanvas(c, path.join(dir, `${fr.name}-${tag}.png`))
    renders.push({ tag, c, bend: bendAlongX(c, scene), curve: softCurve(cal, halfW), k: cal.uniforms.uBndDark[0] })
  }
  const [before, now] = renders
  // the gain that puts the before picture's strongest bends (99.9th percentile) at full scale
  const sorted = Float32Array.from(before.bend.d2, Math.abs).sort()
  const gain = 127 / Math.max(1e-9, sorted[Math.floor(0.999 * (sorted.length - 1))])
  for (const r of renders) {
    r.bendImage = bendImage(r.bend.d2, fr.w, fr.h, gain)
    await saveCanvas(r.bendImage, path.join(dir, `${fr.name}-${r.tag}-bend.png`))
  }
  const line = `${fr.name}: silhouette strength ${f(now.k)}; columns ${f(before.bend.columns)} before, ${f(now.bend.columns)} now (1e-6 L per px^2); largest bend of the softness multiplier along the edge ${f(before.curve.bend, 1)} before, ${f(now.curve.bend, 1)} now`
  console.log(line)
  lines.push(line)

  // the softness multiplier along the edge, both versions on one plot
  const tw = fr.w > fr.h ? 480 : 300
  const th = Math.round((tw * fr.h) / fr.w)
  const plot = makeCanvas(2 * tw + 6, 150, [16, 16, 16])
  const all = [...before.curve.v, ...now.curve.v]
  const lo = Math.min(...all)
  const hi = Math.max(...all)
  const pts = (v) => v.map((y, k) => [(k / (v.length - 1)) * (plot.w - 20) + 10, plot.h - 12 - ((y - lo) / Math.max(1e-9, hi - lo)) * (plot.h - 40)])
  drawPolyline(plot, pts(before.curve.v), [255, 140, 60], 1.2)
  drawPolyline(plot, pts(now.curve.v), [90, 210, 255], 1.2)
  await drawText(plot, `softness multiplier along the edge (${f(lo)} to ${f(hi)}): before (orange), now (blue)`, 8, 6, { size: 12, color: [220, 220, 220] })
  const tiles = async (list) => Promise.all(list.map((c) => resizeCanvas(c, tw, th)))
  const title = makeCanvas(2 * tw + 6, 24, [24, 24, 24])
  await drawText(title, `${fr.label}, one transition 0.55 short sides wide`, 4, 4, { size: 14, color: [240, 240, 240] })
  const top = await row(await tiles([before.c, now.c]), { labels: ['before: crest clamped at 0', 'now: smooth crest'], labelSize: 13, gap: 6 })
  const mid = await row(await tiles([before.bendImage, now.bendImage]), {
    labels: [`bend of lightness along x: columns ${f(before.bend.columns)}`, `columns ${f(now.bend.columns)}`],
    labelSize: 13,
    gap: 6,
  })
  // 1:1 around the before picture's strongest column, over the transition's rows
  const cw = Math.min(tw, 300)
  const [r0, r1] = before.bend.rows
  const cx = Math.max(0, Math.min(fr.w - cw, before.bend.at - cw / 2))
  const crops = await row(rowResidualCrops([before.c, now.c], cx, r0, cw, r1 - r0), {
    labels: [`before, x ${before.bend.at}: row L less its line`, 'now, the same'],
    labelSize: 13,
    gap: 6,
  })
  await saveCanvas(crops, path.join(dir, `${fr.name}-crops.png`))
  sheets.push(await column([title, top, mid, plot, crops], { gap: 6 }))
}
const sheet = await row(sheets, { gap: 16 })
const sheetFile = process.argv.includes('--update-results') ? path.join(PROTO, 'results/crest-smooth.jpg') : path.join(dir, 'crest-sheet.jpg')
await saveCanvas(sheet, sheetFile, { quality: 86 })
fs.writeFileSync(path.join(dir, 'numbers.txt'), `${lines.join('\n')}\n`)
console.log(`sheet: ${path.relative(ROOT, sheetFile)}`)
await harness.close()
