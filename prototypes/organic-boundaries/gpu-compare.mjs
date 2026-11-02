// The boundary model in the engine (src/light/recipes/sunset/boundary.ts) on the
// GPU, next to the same scene on the CPU, and next to the prototype's own render.
// node gpu-compare.mjs  ->  out/gpu/<pack>-<aspect>-s<seed>.png, out/gpu/sheet-*.jpg
//
// The scene is the prototype's production Sunset layout (lib/production.mjs) in
// short-side units: a stop ramp mixed in linear light along a slightly tilted
// axis, each transition's softness and position from the boundary model, and
// the bridge light per transition. The same small ramp is written twice below,
// once in GLSL for the engine and once in JS for the CPU.

import path from 'node:path'
import { startHarness } from '../../scripts/light/lib/harness.mjs'
import { PROTO } from './lib/refs.mjs'
import { hexToLinear, linearToOklab, linearToSrgb, luminance } from './lib/color.mjs'
import { makeImage, makeCanvas, saveCanvas, row, column, resizeCanvas, drawText } from './lib/image.mjs'
import { encode, tone } from './lib/output.mjs'
import { renderScene } from './lib/scene.mjs'
import { productionScene } from './lib/production.mjs'

const dir = path.join(PROTO, 'out/gpu')
const LN81 = 2 * Math.log(9)

const RAMP_GLSL = /* glsl */ `
#define OB_COLORS 8
uniform vec3 uObColor[OB_COLORS];
uniform vec2 uObTilt;      // sin and cos of the tilt
uniform vec2 uObBridge;    // pull, lift
uniform float uObTop;      // base coordinate at the top of the frame

vec3 radiance(vec2 uv, vec2 p) {
  float y = p.y - uObTop;
  float along = p.x * uObTilt.x + y * uObTilt.y;
  float e = p.x * uObTilt.y - y * uObTilt.x;
  float s0 = along + uObTop;
  float s = s0 + boundaryWarp(e, s0);
  int n = uBndTransCount;
  float sig[OB_COLORS];
  for (int j = 0; j < OB_COLORS - 1; j++) {
    sig[j] = 0.0;
    if (j >= n) continue;
    vec4 t = uBndTrans[j];
    sig[j] = boundaryRise((s - t.x) / (t.y * boundarySoft(e, j)));
  }
  vec3 c = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i < OB_COLORS; i++) {
    if (i > n) break;
    float hi = i == 0 ? 1.0 : sig[i - 1];
    float lo = i == n ? 0.0 : sig[i];
    float w = max(0.0, hi - lo);
    c += w * uObColor[i];
    wsum += w;
  }
  c /= max(wsum, 1e-6);
  float t = 0.0;
  for (int j = 0; j < OB_COLORS - 1; j++) {
    if (j >= n) break;
    vec3 a = uObColor[j] / (uObColor[j].r + uObColor[j].g + uObColor[j].b + 1e-6);
    vec3 b = uObColor[j + 1] / (uObColor[j + 1].r + uObColor[j + 1].g + uObColor[j + 1].b + 1e-6);
    float v = dot(a - b, a - b) / 4.0;
    t += uObBridge.x * min(1.0, v / 0.25) * 4.0 * sig[j] * (1.0 - sig[j]);
  }
  t = min(1.0, t);
  float y0 = min(1.0, luminance(c));
  float lifted = y0 + uObBridge.y * (1.0 - y0) * min(1.0, y0 / 0.18);
  return c + t * (vec3(lifted) - c);
}
`

// The prototype's production scene in short-side units, centered on the frame.
function sceneInShortSide(pack, seed, aspect) {
  const sc = productionScene(pack, seed)
  const tall = Math.max(1, 1 / aspect)
  const toS = (pos) => (pos - 0.5) * tall
  const transitions = sc.stops.map((st) => ({ at: toS(st.at), width: st.width * tall }))
  const wander = sc.boundary.wander.map(([s, a]) => [toS(s), a * tall])
  const colors = sc.colors.map((hex, i) => hexToLinear(hex).map((v) => v * sc.gains[i]))
  const tilt = (sc.base.tilt * Math.PI) / 180
  return { sc, tall, transitions, wander, colors, tilt, bridge: [sc.bridge.pull, sc.bridge.lift] }
}

// The engine's output with dither off: tone curve, exact sRGB, rounded to 8 bits.
function encodePlain(img) {
  const c = makeCanvas(img.w, img.h)
  for (let i = 0; i < img.w * img.h; i++) {
    const rgb = tone(img.ch[0][i], img.ch[1][i], img.ch[2][i])
    for (let q = 0; q < 3; q++) c.data[i * 3 + q] = Math.round(Math.min(1, Math.max(0, linearToSrgb(rgb[q]))) * 255)
  }
  return c
}

function cpuRender(B, scene, w, h) {
  const img = makeImage(w, h)
  const aspect = w / h
  const top = -0.5 * scene.tall
  const { colors } = scene
  const n = scene.transitions.length
  const sig = new Float64Array(8)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = ((x + 0.5) / w - 0.5) * Math.max(aspect, 1)
      const py = ((y + 0.5) / h - 0.5) * Math.max(1 / aspect, 1)
      const yy = py - top
      const along = px * Math.sin(scene.tilt) + yy * Math.cos(scene.tilt)
      const e = px * Math.cos(scene.tilt) - yy * Math.sin(scene.tilt)
      const s0 = along + top
      const s = s0 + B.field.warp(e, s0)
      for (let j = 0; j < n; j++) {
        const t = scene.transitions[j]
        sig[j] = 1 / (1 + Math.exp(Math.min(60, Math.max(-60, (-LN81 * (s - t.at)) / (t.width * B.field.soft(e, j))))))
      }
      let c = [0, 0, 0]
      let wsum = 0
      for (let i = 0; i <= n; i++) {
        const wi = Math.max(0, (i === 0 ? 1 : sig[i - 1]) - (i === n ? 0 : sig[i]))
        for (let q = 0; q < 3; q++) c[q] += wi * colors[i][q]
        wsum += wi
      }
      c = c.map((v) => v / Math.max(wsum, 1e-6))
      let t = 0
      for (let j = 0; j < n; j++) {
        const sa = colors[j][0] + colors[j][1] + colors[j][2] + 1e-6
        const sb = colors[j + 1][0] + colors[j + 1][1] + colors[j + 1][2] + 1e-6
        let v = 0
        for (let q = 0; q < 3; q++) v += (colors[j][q] / sa - colors[j + 1][q] / sb) ** 2 / 4
        t += scene.bridge[0] * Math.min(1, v / 0.25) * 4 * sig[j] * (1 - sig[j])
      }
      t = Math.min(1, t)
      const y0 = Math.min(1, luminance(c[0], c[1], c[2]))
      const lifted = y0 + scene.bridge[1] * (1 - y0) * Math.min(1, y0 / 0.18)
      const i = y * w + x
      for (let q = 0; q < 3; q++) img.ch[q][i] = c[q] + t * (lifted - c[q])
    }
  }
  return img
}

// Faint columns: how much Oklab L wanders along each row inside the widest
// transition (its middle 60%, away from the next edge), averaged over those rows.
function columnStrength(c, scene) {
  const wide = scene.transitions.reduce((a, b) => (b.width > a.width ? b : a))
  const top = -0.5 * scene.tall
  const y0 = Math.max(0, Math.round(((wide.at - 0.3 * wide.width - top) / scene.tall) * c.h))
  const y1 = Math.min(c.h - 1, Math.round(((wide.at + 0.15 * wide.width - top) / scene.tall) * c.h))
  let total = 0
  for (let y = y0; y <= y1; y++) {
    const L = []
    for (let x = 0; x < c.w; x++) {
      const lin = [0, 1, 2].map((q) => { const v = c.data[(y * c.w + x) * 3 + q] / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
      L.push(linearToOklab(...lin)[0])
    }
    const mean = L.reduce((s, v) => s + v, 0) / L.length
    total += Math.sqrt(L.reduce((s, v) => s + (v - mean) ** 2, 0) / L.length)
  }
  return (100 * total) / (y1 - y0 + 1)
}

const harness = await startHarness()
const B = await harness.ssr('/src/light/recipes/sunset/boundary.ts')
const f = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '-')
const sheets = []
const cases = [
  ['bold', 1, 16 / 9],
  ['bold', 2, 16 / 9],
  ['bold', 3, 16 / 9],
  ['elemental', 1, 9 / 16],
  ['atmospheric', 1, 9 / 16],
]
for (const [pack, seed, aspect] of cases) {
  const [w, h] = aspect > 1 ? [960, 540] : [540, 960]
  const scene = sceneInShortSide(pack, seed, aspect)
  const cal = B.calibrateBoundary({ wander: scene.wander, transitions: scene.transitions, range: [-0.5 * scene.tall, 0.5 * scene.tall] }, aspect, seed)
  const colorUniform = Array.from({ length: 8 }, (_, i) => scene.colors[Math.min(i, scene.colors.length - 1)]).flat()
  const uniforms = { ...cal.uniforms, uObColor: colorUniform, uObTilt: [Math.sin(scene.tilt), Math.cos(scene.tilt)], uObBridge: scene.bridge, uObTop: -0.5 * scene.tall }
  const key = `gpu-${pack}-${seed}`
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
  // the prototype's render of the same layout (frame-height units, old guard, no wide-transition rule)
  const old = encode(renderScene(productionScene(pack, seed), w, h).img, {}, seed)
  let sum = 0
  let max = 0
  let n = 0
  for (let i = 0; i < w * h; i++) {
    const lab = (c) => linearToOklab(...[0, 1, 2].map((q) => { const v = c.data[i * 3 + q] / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }))
    const a = lab(gpu)
    const b = lab(cpu)
    const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * 100
    sum += d
    max = Math.max(max, d)
    n++
  }
  const name = `${pack}-${aspect > 1 ? '16x9' : '9x16'}-s${seed}`
  console.log(`${name}: GPU vs CPU Oklab dE x100 mean ${f(sum / n, 3)} max ${f(max, 2)}; guard min ${f(cal.report.guardMin)} over ${f(cal.report.guardShare * 100, 0)}% of the width; wander requested ${cal.report.requested.map((v) => f(v * 100)).join('/')} realized ${cal.report.realized.map((v) => f(v * 100)).join('/')} %S`)
  if (pack === 'bold') console.log(`  columns in the wide transition (row lightness spread, Oklab L x100): engine ${f(columnStrength(gpu, scene), 3)}, prototype ${f(columnStrength(old, scene), 3)}`)
  await saveCanvas(gpu, path.join(dir, `${name}-gpu.png`))
  await saveCanvas(cpu, path.join(dir, `${name}-cpu.png`))
  await saveCanvas(old, path.join(dir, `${name}-prototype.png`))
  const th = aspect > 1 ? 300 : 420
  const tiles = await Promise.all([gpu, cpu, old].map((c) => resizeCanvas(c, Math.round((w / h) * th), th)))
  const sheet = await row(tiles, { labels: [`GPU (engine): ${pack} seed ${seed}`, 'CPU, same model', 'prototype before the fixes'], labelSize: 14, gap: 6 })
  await drawText(sheet, `dE mean ${f(sum / n, 3)} max ${f(max, 2)}`, 8, sheet.h - 22, { size: 13, color: [255, 255, 255], background: [0, 0, 0] })
  sheets.push(sheet)
  await saveCanvas(sheet, path.join(dir, `sheet-${name}.jpg`))
}
const bold = await column(sheets.slice(0, 3), { gap: 8 })
const portrait = await row(sheets.slice(3), { gap: 8 })
await saveCanvas(bold, path.join(dir, 'sheet-bold.jpg'))
await saveCanvas(portrait, path.join(dir, 'sheet-portrait.jpg'))
const fit = await resizeCanvas(portrait, bold.w, Math.round((portrait.h * bold.w) / portrait.w))
await saveCanvas(await column([bold, fit], { gap: 8 }), path.join(PROTO, 'results/gpu-vs-cpu.jpg'), { width: 1400, quality: 84 })
await harness.close()
