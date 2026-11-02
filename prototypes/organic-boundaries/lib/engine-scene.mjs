// The prototype's production Sunset layouts (lib/production.mjs) for the engine
// module src/light/recipes/sunset/boundary.ts: the scene in short-side units, a
// small stop ramp in GLSL and the same ramp on the CPU, and the boundary curves
// measured the way the audit measures them.

import { hexToLinear, luminance, linearToSrgb } from './color.mjs'
import { makeImage, makeCanvas } from './image.mjs'
import { tone } from './output.mjs'
import { productionScene } from './production.mjs'
import { boundaryGeometry } from './isolines.mjs'

const LN81 = 2 * Math.log(9)

export const RAMP_GLSL = /* glsl */ `
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

// The production scene in short-side units, centered on the frame. Each
// transition carries the contrast of its two colors (positive: the color after
// it, lower in the frame, is darker).
export function sceneInShortSide(pack, seed, aspect) {
  const sc = productionScene(pack, seed)
  const tall = Math.max(1, 1 / aspect)
  const toS = (pos) => (pos - 0.5) * tall
  const colors = sc.colors.map((hex, i) => hexToLinear(hex).map((v) => v * sc.gains[i]))
  const Y = colors.map((c) => luminance(c[0], c[1], c[2]))
  const transitions = sc.stops.map((st, j) => ({
    at: toS(st.at),
    width: st.width * tall,
    contrast: (Y[j] - Y[j + 1]) / Math.max(Y[j], Y[j + 1], 1e-6),
  }))
  const wander = sc.boundary.wander.map(([s, a]) => [toS(s), a * tall])
  const tilt = (sc.base.tilt * Math.PI) / 180
  return { sc, tall, transitions, wander, colors, tilt, bridge: [sc.bridge.pull, sc.bridge.lift] }
}

export const boundaryParams = (scene, withContrast = true) => ({
  wander: scene.wander,
  transitions: scene.transitions.map(({ at, width, contrast }) => (withContrast ? { at, width, contrast } : { at, width })),
  range: [-0.5 * scene.tall, 0.5 * scene.tall],
})

// The engine's output with dither off: tone curve, exact sRGB, rounded to 8 bits.
export function encodePlain(img) {
  const c = makeCanvas(img.w, img.h)
  for (let i = 0; i < img.w * img.h; i++) {
    const rgb = tone(img.ch[0][i], img.ch[1][i], img.ch[2][i])
    for (let q = 0; q < 3; q++) c.data[i * 3 + q] = Math.round(Math.min(1, Math.max(0, linearToSrgb(rgb[q]))) * 255)
  }
  return c
}

// The same ramp as RAMP_GLSL, on the CPU field of a calibration.
export function cpuRender(cal, scene, w, h) {
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
      const s = s0 + cal.field.warp(e, s0)
      for (let j = 0; j < n; j++) {
        const t = scene.transitions[j]
        sig[j] = 1 / (1 + Math.exp(Math.min(60, Math.max(-60, (-LN81 * (s - t.at)) / (t.width * cal.field.soft(e, j))))))
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

// Height in pixels of one transition's isoline at fraction q of its width
// (-0.5: the 10% line, 0: 50%, 0.5: 90%) in every column, from the CPU field.
export function isolinePx(cal, scene, j, q, w, h) {
  const aspect = w / h
  const top = -0.5 * scene.tall
  const t = scene.transitions[j]
  const y = new Float64Array(w)
  for (let x = 0; x < w; x++) {
    const px = ((x + 0.5) / w - 0.5) * Math.max(aspect, 1)
    // walk down the column to the crossing (the base is tilted only a few degrees)
    let lo = top
    let hi = -top
    const level = (py) => {
      const yy = py - top
      const along = px * Math.sin(scene.tilt) + yy * Math.cos(scene.tilt)
      const e = px * Math.cos(scene.tilt) - yy * Math.sin(scene.tilt)
      const s0 = along + top
      const s = s0 + cal.field.warp(e, s0)
      return s - (t.at + q * t.width * cal.field.soft(e, j))
    }
    if (level(lo) > 0 || level(hi) < 0) {
      y[x] = NaN
      continue
    }
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2
      if (level(mid) < 0) lo = mid
      else hi = mid
    }
    y[x] = (((lo + hi) / 2 - top) / scene.tall) * h - 0.5
  }
  return y
}

// The audit's numbers for one boundary curve (pixels): wiggle, main wavelength and
// bump aspect with both of the audit's spectra (tilt removed, and tilt and bow
// removed), as README "Generic acceptance bands" uses them.
export function bumpNumbers(y, w, h) {
  const g = boundaryGeometry(y, w, h)
  if (!g) return null
  const n = 256
  const r = g.resid
  const v = Array.from({ length: n }, (_, i) => {
    const xq = ((i + 0.5) / n) * r.length - 0.5
    const a = Math.max(0, Math.min(r.length - 1, Math.floor(xq)))
    const b = Math.min(r.length - 1, a + 1)
    return r[a] + (r[b] - r[a]) * (xq - a)
  })
  let kBest = 1
  let best = 0
  for (let k = 1; k < 64; k++) {
    let s = 0
    for (let i = 0; i < n; i++) s += v[i] * Math.cos((Math.PI * k * (i + 0.5)) / n)
    if (Math.abs(s) > best) {
      best = Math.abs(s)
      kBest = k
    }
  }
  const lambdaRes = (2 * g.span) / kBest
  const wig = (g.wiggleRmsH / 100) * h
  const lin = g.dominant[0] ? (g.dominant[0].lambdaW * w) / (2 * Math.SQRT2 * wig) : Infinity
  const res = (lambdaRes * w) / (2 * Math.SQRT2 * wig)
  return { wiggleH: g.wiggleRmsH, lambdaLin: g.dominant[0]?.lambdaW, lambdaRes, aspectLin: lin, aspectRes: res, aspect: Math.min(lin, res), ...localBumps(y, w, h) }
}

// The steepest single bump: each rise or fall between turning points of the
// curve (smoothed over 1% of the width) at least `minRise` of the height tall
// has a local aspect 2 * run / rise (a sine's flank gives its bump aspect).
// Also pi / steepest slope (a sine's steepest point gives its bump aspect).
export function localBumps(y, w, h, minRise = 0.002) {
  const ok = []
  for (let x = 0; x < w; x++) if (Number.isFinite(y[x])) ok.push([x, y[x]])
  if (ok.length < w * 0.5) return { flank: NaN, steepest: NaN }
  const r = Math.max(1, Math.round(w * 0.005))
  const s = ok.map((_, i) => {
    let sum = 0
    let n = 0
    for (let k = Math.max(0, i - r); k <= Math.min(ok.length - 1, i + r); k++) {
      sum += ok[k][1]
      n++
    }
    return sum / n
  })
  let steep = 0
  for (let i = 1; i < s.length; i++) steep = Math.max(steep, Math.abs(s[i] - s[i - 1]) / (ok[i][0] - ok[i - 1][0]))
  // turning points with hysteresis of minRise
  const tol = minRise * h
  const turns = [0]
  let dir = 0
  let ext = 0
  for (let i = 1; i < s.length; i++) {
    if (dir >= 0 && s[i] > s[ext]) ext = i
    else if (dir <= 0 && s[i] < s[ext]) ext = i
    if (dir >= 0 && s[ext] - s[i] > tol) {
      if (dir > 0 || turns[turns.length - 1] !== ext) turns.push(ext)
      dir = -1
      ext = i
    } else if (dir <= 0 && s[i] - s[ext] > tol) {
      if (dir < 0 || turns[turns.length - 1] !== ext) turns.push(ext)
      dir = 1
      ext = i
    }
  }
  turns.push(s.length - 1)
  let flank = Infinity
  for (let k = 0; k + 1 < turns.length; k++) {
    const run = ok[turns[k + 1]][0] - ok[turns[k]][0]
    const rise = Math.abs(s[turns[k + 1]] - s[turns[k]])
    if (rise >= tol && run > 0) flank = Math.min(flank, (2 * run) / rise)
  }
  return { flank, steepest: steep > 0 ? Math.PI / steep : Infinity }
}
