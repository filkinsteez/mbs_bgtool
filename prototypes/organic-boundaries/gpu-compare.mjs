// The boundary model in the engine (src/light/recipes/sunset/boundary.ts) on the
// GPU, next to the same scene on the CPU and next to the previous version of the
// module (commit 899c06d, before the bump rule and the silhouette rule).
// node gpu-compare.mjs [--update-results]  ->  out/gpu/<pack>-<aspect>-s<seed>-*.png and
// out/gpu/gpu-vs-cpu.jpg (not committed); --update-results writes the sheet to
// results/gpu-vs-cpu.jpg instead, for the README.
//
// The scene is the prototype's production Sunset layout (lib/production.mjs) in
// short-side units (lib/engine-scene.mjs): a stop ramp mixed in linear light,
// each transition's softness and position from the boundary model, and the
// bridge light per transition. Each frame is also measured as the audit
// measures a render: the boundaries' wiggle and bump aspect from its pixels.

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { startHarness } from '../../scripts/light/lib/harness.mjs'
import { PROTO, ROOT } from './lib/refs.mjs'
import { linearToOklab } from './lib/color.mjs'
import { saveCanvas, row, column, resizeCanvas, drawText, cropCanvas } from './lib/image.mjs'
import { canvasToLinear } from './lib/output.mjs'
import { rampCoordinate, measureBoundaries } from './lib/audit.mjs'
import { productionScene, auditStops } from './lib/production.mjs'
import { RAMP_GLSL, sceneInShortSide, boundaryParams, encodePlain, cpuRender, localBumps } from './lib/engine-scene.mjs'

const dir = path.join(PROTO, 'out/gpu')
const oldFile = path.join(PROTO, 'out/lib-899c06d/boundary.ts')
if (!fs.existsSync(oldFile)) {
  fs.mkdirSync(path.dirname(oldFile), { recursive: true })
  fs.writeFileSync(oldFile, execFileSync('git', ['show', '899c06d:src/light/recipes/sunset/boundary.ts'], { cwd: ROOT }))
}
const OLD = await import(oldFile)
const f = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '-')

const deltaE = (a, b) => {
  let sum = 0
  let max = 0
  const lin = (c, i, q) => {
    const v = c.data[i * 3 + q] / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  for (let i = 0; i < a.w * a.h; i++) {
    const p = linearToOklab(lin(a, i, 0), lin(a, i, 1), lin(a, i, 2))
    const q = linearToOklab(lin(b, i, 0), lin(b, i, 1), lin(b, i, 2))
    const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) * 100
    sum += d
    max = Math.max(max, d)
  }
  return { mean: sum / (a.w * a.h), max }
}

// The audit on a rendered frame: per main boundary, wiggle (% H), bump aspect
// (the audit's definition) and pi / steepest slope.
function auditFrame(c, pack, seed) {
  const cfg = { angle: 90, band: 0.4, window: 0.15, stops: auditStops(productionScene(pack, seed)) }
  const R = rampCoordinate(canvasToLinear(c), null, cfg, null, 3)
  const res = measureBoundaries(R.T, R.path, cfg)
  return res.main.map((m) => {
    if (!m.geom) return null
    const wig = m.geom.wiggleRmsH
    const aspect = wig > 0.3 && m.geom.dominant[0] ? (m.geom.dominant[0].lambdaW * c.w) / (2 * Math.SQRT2 * (wig / 100) * c.h) : Infinity
    return { wiggle: wig, aspect, steep: localBumps(m.y50, c.w, c.h).steepest }
  })
}

const harness = await startHarness()
const B = await harness.ssr('/src/light/recipes/sunset/boundary.ts')
const rows = []
const lines = []
for (const pack of ['bold', 'elemental', 'atmospheric']) {
  for (const [label, aspect, w, h] of [['16:9', 16 / 9, 960, 540], ['9:16', 9 / 16, 540, 960]]) {
    const seed = 1
    const scene = sceneInShortSide(pack, seed, aspect)
    const cal = B.calibrateBoundary(boundaryParams(scene), aspect, seed)
    const colorUniform = Array.from({ length: 8 }, (_, i) => scene.colors[Math.min(i, scene.colors.length - 1)]).flat()
    const uniforms = { ...cal.uniforms, uObColor: colorUniform, uObTilt: [Math.sin(scene.tilt), Math.cos(scene.tilt)], uObBridge: scene.bridge, uObTop: -0.5 * scene.tall }
    const key = `gpu-${pack}-${label}`
    await harness.page.evaluate(`(async ({ fragment, uniforms, width, height, seed, key }) => {
      const { ProgramRenderer } = await import('/src/light/engine/programRenderer.ts')
      const program = { id: 'test.boundary-ramp', colorSlots: [], defaultColors: [], params: [], fragment, uniforms: () => uniforms }
      const renderer = new ProgramRenderer(document.createElement('canvas'))
      renderer.renderProgram(program, { seed, lens: { bloom: 0, halation: 0 }, output: { grain: 0, exposure: 0 } }, { width, height, supersample: 1, dither: false })
      const data = renderer.readPixels()
      renderer.dispose()
      await fetch('/__light/upload/' + key, { method: 'POST', body: new Blob([data]) })
    })(${JSON.stringify({ fragment: B.BOUNDARY_GLSL + RAMP_GLSL, uniforms, width: w, height: h, seed, key })})`)
    const bytes = harness.takeUpload(key)
    const gpu = { w, h, data: new Uint8ClampedArray(w * h * 3) }
    for (let i = 0; i < w * h; i++) for (let q = 0; q < 3; q++) gpu.data[i * 3 + q] = bytes[i * 4 + q]
    const cpu = encodePlain(cpuRender(cal, scene, w, h))
    const old = encodePlain(cpuRender(OLD.calibrateBoundary(boundaryParams(scene, false), aspect, seed), scene, w, h))
    const d = deltaE(gpu, cpu)
    const now = auditFrame(gpu, pack, seed)
    const before = auditFrame(old, pack, seed)
    const name = `${pack}-${label.replace(':', 'x')}-s${seed}`
    const cell = (b) => (b ? `${f(b.wiggle)}%H a${f(b.aspect, 0)} st${f(b.steep, 1)}` : '-')
    const line = `${name}: GPU vs CPU dE x100 mean ${f(d.mean, 3)} max ${f(d.max)}; scale ${cal.report.scale.map((v) => f(v)).join('/')}; boundaries now ${now.map(cell).join(' | ')}; before ${before.map(cell).join(' | ')}`
    console.log(line)
    lines.push(line)
    await saveCanvas(gpu, path.join(dir, `${name}-gpu.png`))
    await saveCanvas(cpu, path.join(dir, `${name}-cpu.png`))
    await saveCanvas(old, path.join(dir, `${name}-before.png`))
    const th = aspect > 1 ? 225 : 400
    const tiles = await Promise.all([gpu, cpu, old].map((c) => resizeCanvas(c, Math.round((w / h) * th), th)))
    const sheet = await row(tiles, { labels: [`GPU: ${pack} ${label}`, 'CPU, same model', 'before (899c06d)'], labelSize: 13, gap: 6 })
    await drawText(sheet, `dE mean ${f(d.mean, 3)} max ${f(d.max)}`, 6, sheet.h - 20, { size: 12, color: [255, 255, 255], background: [0, 0, 0] })
    // the portrait's ground edge at twice the size: now and before
    let zoom = null
    if (aspect < 1) {
      // centered on the edge over the darkest ground (the transition with the highest contrast)
      const darkest = scene.transitions.reduce((best, t, j) => (t.contrast > scene.transitions[best].contrast ? j : best), 0)
      const edge = productionScene(pack, seed).stops[darkest].at
      // in linear light the 50% point still looks light; the dark side starts lower
      const zh = Math.round(0.14 * h)
      const y0 = Math.max(0, Math.min(h - zh, Math.round((edge - 0.045) * h)))
      const crops = [gpu, old].map((c) => cropCanvas(c, 0, y0, w, zh))
      zoom = await row(await Promise.all(crops.map((c) => resizeCanvas(c, 594, Math.round((zh * 594) / w)))), { labels: [`${pack} 9:16 ground edge, 1.1x: now`, 'before'], labelSize: 13, gap: 6 })
    }
    rows.push({ aspect, sheet, zoom })
  }
}
// one pack per row: the landscape triplet over the portrait's ground edge, then the portrait triplet
const packRows = []
for (let p = 0; p < 3; p++) {
  const left = await column([rows[2 * p].sheet, rows[2 * p + 1].zoom], { gap: 8 })
  packRows.push(await row([left, rows[2 * p + 1].sheet], { gap: 14 }))
}
const sheetFile = process.argv.includes('--update-results') ? path.join(PROTO, 'results/gpu-vs-cpu.jpg') : path.join(dir, 'gpu-vs-cpu.jpg')
await saveCanvas(await column(packRows, { gap: 12 }), sheetFile, { width: 1600, quality: 84 })
console.log(`sheet: ${path.relative(ROOT, sheetFile)}`)
fs.writeFileSync(path.join(dir, 'numbers.txt'), `${lines.join('\n')}\n`)
await harness.close()
