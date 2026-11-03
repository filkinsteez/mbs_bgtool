// Palette check: does every frame read as its pack? For one look (or all seven) it renders or reads the three packs
// at seeds 1-8 (16:9) and 1-4 (9:16), measures how much of each frame every pack color covers and which colors
// outside the pack show up, and writes one sheet per look with a share bar under each tile and the failing frames
// marked. See scripts/light/README.md, "Palette check", for usage and the rules behind the thresholds.
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium } from '@playwright/test'
import sharp from 'sharp'
import { list, parseArgs } from './lib/args.mjs'
import { ROOT, startHarness } from './lib/harness.mjs'
import { savePng } from './lib/images.mjs'

const LOOKS = ['sunset.ramp', 'sunset.bands', 'sunset.blooms', 'contour.rim', 'contour.halo', 'contour.beam', 'contour.streaks']
const PACK_ORDER = ['bold', 'elemental', 'atmospheric']

// Thresholds, set by eye on the coordinator's shots (artifacts/coordinator/bands-bug, palette-now, palette-now-contour).
const T = {
  dark: 0.1, // Oklab L below this is the dark base: no color is judged there
  white: 0.97, // L at or above this is white, the pale end of every light
  hueTolerance: 20, // degrees of Oklab hue a pixel may differ from a pack color's light path and still be that color
  greyer: 0.65, // below nominal a pixel may lose this much of the path's chroma (blur, a little mixing) and stay the color
  pale: { L: 0.78, C: 0.05 }, // a pixel this light and this grey is a pale bridge, never mud
  warmDimStops: { yellowish: 1, red: 1.5 }, // how far under nominal a warm color still reads as itself, not olive or brown
  darkOverStops: 1, // how far over nominal a dark pack color (L under 0.5) still reads as itself
  present: 0.05, // a pack color is present, as an area of light, when it covers at least this share of the frame
  wideRadius: 0.03, // outside areas thinner than twice this share of the short side are bridges or tails, not areas
  largestPatch: 0.08, // fail: one wide outside area covers this share of the frame
  wideShare: 0.15, // fail: wide outside areas together cover this share of the frame
  darkLine: 0.015, // note: thin dark outside lines (a seam) cover this share of the frame
  baseOutside: 0.3, // Contour: fail when this share of the dark base (L 0.1 to 0.35) is outside the pack
  litOutside: 0.2, // Contour: fail when this share of the lit area (L 0.35 and up) is outside the pack
  drift: 0.25, // Contour, own renders: fail when this share of the lit area is a pack color the scene does not light with
  lightL: 0.5, // Contour: pack colors at least this light (Oklab L) are the light colors a pack offers
  lensEdge: 0.165, // new rule: a lens-blurred edge between two pack colors may be this share of the short side wide
  // (the full blur of the disc lens, 2 x R with R = 0.0825 at Softness 0.5; R runs 0.045 to 0.12 with Softness)
  mixTolerance: 0.03, // new rule: Oklab distance from the linear-light mix of two pack colors that still counts as it
  // Warm tails (SHARED.md, decided 2026-11-03 9:40 AM): below nominal, a warm light that drifts toward deep red or
  // amber (Lime: toward Forest's deep green) as it dims, and stays at least this pure (chroma / lightness), is still
  // that light. Olive, brown and grey tails are not. `--tails strict` turns this off.
  tails: {
    'Orange-red': { hue: [15, 45], ratio: 0.3 },
    Yellow: { hue: [45, 80], ratio: 0.18 },
    Tan: { hue: [40, 65], ratio: 0.12 },
    Lime: { hue: [135, 180], ratio: 0.15 },
  },
}
// Hues that are neither neighbour, so a lens edge never excuses them (SHARED.md palette rules).
const THIRD_HUES = new Set(['pink', 'salmon', 'mauve', 'lavender', 'purple', 'magenta', 'mauve-grey'])

// Linear-light mixes that stay clean, measured in docs/light/research/perception-additive-light.md section 5.
// Every other pair goes grey, invents a hue (magenta, mint) or turns olive, khaki or brown, so its mix counts as
// outside the pack unless it is thin.
const CLEAN_MIXES = {
  bold: [['Meta Blue', 'Cyan'], ['Yellow', 'Orange-red']],
  elemental: [['Meta Blue', 'Forest'], ['Meta Blue', 'Plum']],
  atmospheric: 'all',
}
const WARM = { bold: ['Yellow', 'Orange-red'], elemental: ['Lime', 'Tan'], atmospheric: [] }
const NEUTRALS = { atmospheric: ['Ice', 'Steel', 'Slate', 'Near-black'] }

const args = parseArgs()
const lookArg = list(args.look)
if (!lookArg.length) {
  console.error('Give --look <sunset.bands|bands|...|all> and optionally --dev or --from <dir>; see scripts/light/README.md')
  process.exit(1)
}
const looks = lookArg.includes('all') ? LOOKS : lookArg.map((l) => (l.includes('.') ? l : LOOKS.find((id) => id.endsWith(`.${l}`)) ?? l))
for (const look of looks) if (!LOOKS.includes(look)) throw new Error(`Unknown look ${look}`)
const seeds = Number(args.seeds ?? 8)
const portraitSeeds = Number(args.portrait ?? 4)
const fromDir = typeof args.from === 'string' ? path.resolve(args.from) : null
const dev = Boolean(args.dev)
const devUrl = typeof args.url === 'string' ? args.url : 'http://localhost:3000'
const maps = Boolean(args.maps)
// old: every off-pack area thicker than a thin bridge counts; new (default, 2026-11-03): lens edges between two pack
// colors count as edges up to the lens's own width.
const rule = args.rule === 'old' ? 'old' : 'new'
const tailRule = args.tails === 'strict' ? 'strict' : 'drift'
// Control values for the render (--at intensity=1,softness=0,horizon=0.3; horizon or light is the mood control).
const controls = { intensity: 0.5, softness: 0.5, mood: 0.5 }
for (const pair of list(args.at)) {
  const [key, value] = pair.split('=')
  const name = key === 'horizon' || key === 'light' ? 'mood' : key
  if (!(name in controls) || Number.isNaN(Number(value))) throw new Error(`--at takes intensity, softness and horizon or light: ${pair}`)
  controls[name] = Number(value)
}
// The lens's radius follows Softness: R = 0.045 to 0.12 of the short side; a lens edge may be 2R wide.
T.lensEdge = 2 * (0.045 + 0.075 * controls.softness)
if (typeof args['lens-edge'] === 'string') T.lensEdge = Number(args['lens-edge'])
const startedAt = new Date()
const hhmm = startedAt.toTimeString().slice(0, 5)
const sourceLabel =
  typeof args.label === 'string' ? args.label : fromDir ? `files in ${path.relative(process.cwd(), fromDir)}` : dev ? `dev server ${devUrl} at ${hhmm}, uncommitted working tree` : `harness render of ${ROOT}`
const outDir = path.resolve(typeof args.out === 'string' ? args.out : path.join(ROOT, 'artifacts', 'palette-check', sourceLabel.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)))

const harness = await startHarness()
let browser = null
try {
  const { toneCurve } = await harness.ssr('/src/light/engine/output.ts')
  const { linearToOklab } = await harness.ssr('/src/light/color/oklab.ts')
  const { hexToLinear, srgbToLinear } = await harness.ssr('/src/light/color/srgb.ts')
  const { getPack } = await harness.ssr('/src/light/color/packs.ts')
  const rendering = !fromDir && !dev
  const { buildScene } = rendering ? await harness.ssr('/src/tool/controls.ts') : {}
  const { EXPORT_SIZES } = rendering ? await harness.ssr('/src/light/engine/frame.ts') : {}

  const SRGB_TO_LINEAR = Float64Array.from({ length: 256 }, (_, v) => srgbToLinear(v / 255))
  const lch = ([L, a, b]) => [L, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360]

  // --- per-pack classifier ---
  // Each pack color's light path, read at a given Oklab lightness: below nominal the color under less light (the
  // tone curve is the identity there, so hue and chroma/lightness stay), above nominal the tone curve's way to white.
  const LSTEPS = 1000
  const hueDiff = (x, y) => Math.abs((((x - y) % 360) + 540) % 360 - 180)
  function lightPath(lin, minStops, maxStops) {
    const lab0 = linearToOklab(lin)
    const [L0, C0, h0] = lch(lab0)
    const Lmin = L0 * Math.cbrt(2 ** -minStops)
    const C = new Float32Array(LSTEPS + 1).fill(NaN)
    const h = new Float32Array(LSTEPS + 1).fill(NaN)
    for (let i = 0; i <= LSTEPS; i++) {
      const L = i / LSTEPS
      if (L >= Lmin && L <= L0) {
        C[i] = (C0 * L) / L0
        h[i] = h0
      }
    }
    let last = Math.round(L0 * LSTEPS)
    for (let e = 0; e <= maxStops; e += 0.01) {
      const [L, Cp, hp] = lch(linearToOklab(toneCurve(lin.map((v) => v * 2 ** e))))
      const i = Math.round(L * LSTEPS)
      for (let j = last + 1; j <= i && j <= LSTEPS; j++) {
        C[j] = Cp
        h[j] = hp
      }
      last = Math.max(last, i)
    }
    return { L0, C0, h0, Lmin, C, h }
  }
  const warmStops = (lab) => (lch(lab)[2] < 60 ? T.warmDimStops.red : T.warmDimStops.yellowish)
  // How far a pixel at (L, C, h) is from a color's path at the same lightness, or Infinity when it is outside.
  // The hue must match (20 degrees, 35 for near-grey paths); the pixel may be deeper than the path, and greyer by
  // at most 35% below nominal (a blurred or slightly mixed color); above nominal any paler tint counts (cream,
  // pale blue: the color mixed with white light).
  function pathScore(path, L, C, h) {
    const i = Math.round(L * LSTEPS)
    const Cf = path.C[i]
    if (Number.isNaN(Cf)) return Infinity
    const hf = path.h[i]
    const pale = L > path.L0
    // A color at or below its own nominal brightness is a better reading than another color's overexposed version.
    const paleCost = pale ? 0.5 : 0
    if (path.C0 < 0.06) {
      // Near-grey pack colors (Atmospheric's Ice, Steel, Slate, Near-black) only count when the pixel is grey too;
      // near white, a cool tint (the light of a pale sky on it) still counts.
      const tint = L >= T.pale.L ? 0.03 : 0
      if (C > 1.2 * Cf + 0.015 + tint) return Infinity
      if (C >= 0.02 && hueDiff(h, hf) > 25 + (tint ? 15 : 0)) return Infinity
      return paleCost + C / 0.05
    }
    if (C < 0.025) return Cf < 0.06 ? paleCost + C / 0.025 : Infinity
    const dh = hueDiff(h, hf)
    if (dh > T.hueTolerance) return Infinity
    if (C > 1.6 * Cf + 0.03) return Infinity
    if (pale) return C > Cf + 0.03 ? Infinity : paleCost + dh / T.hueTolerance
    // Below nominal: a pale tint (light and greyer, like cream for Yellow) still counts; a dim one may only be a
    // little greyer than the path.
    if (C < T.greyer * Cf) return L >= T.pale.L ? 0.3 + dh / T.hueTolerance : Infinity
    return dh / T.hueTolerance + Math.abs(C - Cf) / Math.max(Cf, 0.03)
  }
  const toAb = (C, h) => [C * Math.cos((h * Math.PI) / 180), C * Math.sin((h * Math.PI) / 180)]
  // A clean mix of two colors at this lightness: near the straight chroma-plane line between the two paths.
  function bridgeScore(pi, pj, L, C, h) {
    const i = Math.round(L * LSTEPS)
    if (Number.isNaN(pi.C[i]) || Number.isNaN(pj.C[i])) return Infinity
    const [ax, ay] = toAb(pi.C[i], pi.h[i])
    const [bx, by] = toAb(pj.C[i], pj.h[i])
    const [px, py] = toAb(C, h)
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0
    const qx = ax + t * dx
    const qy = ay + t * dy
    const d = Math.hypot(px - qx, py - qy)
    const allowed = 0.02 + 0.2 * Math.hypot(qx, qy)
    return d <= allowed ? d / allowed : Infinity
  }

  function classifier(packId) {
    const pack = getPack(packId)
    const colors = pack.colors.map((c) => ({ name: c.name, hex: c.hex, lin: hexToLinear(c.hex) }))
    for (const c of colors) {
      c.lab = linearToOklab(c.lin)
      c.warm = WARM[packId].includes(c.name)
      // Dark pack colors stop reading as themselves soon above nominal (Forest turns aquamarine, Plum hot pink,
      // Steel pale sky blue: perception-additive-light.md 3), so their path ends 1 stop up; light colors go to white.
      c.path = lightPath(c.lin, c.warm ? warmStops(c.lab) : 12, c.lab[0] < 0.5 ? T.darkOverStops : 8)
    }
    const pairs = []
    const clean = CLEAN_MIXES[packId]
    for (let i = 0; i < colors.length; i++) {
      for (let j = i + 1; j < colors.length; j++) {
        const ok = clean === 'all' || clean.some(([x, y]) => (x === colors[i].name && y === colors[j].name) || (y === colors[i].name && x === colors[j].name))
        if (ok) pairs.push([i, j])
      }
    }
    const neutrals = (NEUTRALS[packId] ?? []).map((name) => colors.findIndex((c) => c.name === name))
    return { packId, pack, colors, pairs, neutrals }
  }
  const classifiers = Object.fromEntries(PACK_ORDER.map((id) => [id, classifier(id)]))
  function classify(k, L, C, h) {
    let fam = -1
    let best = Infinity
    k.colors.forEach((c, i) => {
      const s = pathScore(c.path, L, C, h)
      if (s < best) {
        best = s
        fam = i
      }
    })
    if (fam >= 0) return { fam, bridge: -1 }
    if (tailRule === 'drift') {
      for (let i = 0; i < k.colors.length; i++) {
        const c = k.colors[i]
        const tail = c.warm && T.tails[c.name]
        if (!tail || L >= c.path.L0 || C / Math.max(L, 1e-6) < tail.ratio) continue
        if (h >= tail.hue[0] && h <= tail.hue[1]) return { fam: i, bridge: -1 }
      }
    }
    let bridge = -1
    best = Infinity
    k.pairs.forEach(([i, j], n) => {
      const s = bridgeScore(k.colors[i].path, k.colors[j].path, L, C, h)
      if (s < best) {
        best = s
        bridge = n
      }
    })
    return { fam: -1, bridge }
  }

  // Plain names for colors outside the pack, from Oklab lightness, chroma and hue.
  function outsideName(L, C, h) {
    if (C < 0.03) return h > 20 && h < 110 && C >= 0.015 ? 'grey-brown' : C >= 0.012 && (h >= 290 || h < 20) ? 'mauve-grey' : 'grey'
    if (h < 20 || h >= 345) return L >= 0.7 ? 'pink' : L < 0.45 ? 'maroon' : 'red'
    if (h < 50) return L >= 0.7 ? 'salmon' : L < 0.55 ? (C < 0.08 ? 'grey-brown' : 'brick') : 'orange'
    if (h < 75) return L >= 0.78 ? 'peach' : L < 0.6 ? (C < 0.06 ? 'grey-brown' : 'brown') : 'ochre'
    if (h < 100) return L >= 0.82 ? 'cream' : L < 0.7 ? (C < 0.05 ? 'grey-brown' : 'olive') : 'khaki'
    if (h < 135) return L >= 0.85 ? 'pale lime' : L < 0.75 ? 'olive' : 'yellow-green'
    if (h < 190) return L >= 0.8 ? 'mint' : 'green'
    if (h < 235) return L >= 0.8 ? 'pale cyan' : 'teal'
    if (h < 275) return L >= 0.8 ? 'pale blue' : 'blue'
    if (h < 315) return L >= 0.68 ? 'lavender' : C >= 0.1 ? 'purple' : 'mauve'
    return L >= 0.72 ? 'pink' : C >= 0.12 ? 'magenta' : 'mauve'
  }

  // --- measuring one frame ---
  const BUCKET_DARK = -2
  const BUCKET_WHITE = -3
  const BUCKET_OUT = -4
  const BUCKET_PALE = -5
  const BUCKET_EDGE = -6 // new rule: on the linear-light mix of two pack colors in the frame (a lens edge)
  // Is this linear color a mix of pack colors i and j, a * ci + b * cj with a, b >= 0, through the tone curve?
  function onMix(k, pairs, lin, lab) {
    for (const [i, j] of pairs) {
      const ci = k.colors[i].lin
      const cj = k.colors[j].lin
      const ii = ci[0] * ci[0] + ci[1] * ci[1] + ci[2] * ci[2]
      const jj = cj[0] * cj[0] + cj[1] * cj[1] + cj[2] * cj[2]
      const ij = ci[0] * cj[0] + ci[1] * cj[1] + ci[2] * cj[2]
      const pi = lin[0] * ci[0] + lin[1] * ci[1] + lin[2] * ci[2]
      const pj = lin[0] * cj[0] + lin[1] * cj[1] + lin[2] * cj[2]
      const det = ii * jj - ij * ij
      if (det <= 1e-12) continue
      let a = (pi * jj - pj * ij) / det
      let b = (pj * ii - pi * ij) / det
      if (a < 0) [a, b] = [0, Math.max(0, pj / jj)]
      if (b < 0) [a, b] = [Math.max(0, pi / ii), 0]
      if (a <= 0 || b <= 0) continue
      const mix = linearToOklab(toneCurve([a * ci[0] + b * cj[0], a * ci[1] + b * cj[1], a * ci[2] + b * cj[2]]))
      if (Math.hypot(mix[0] - lab[0], mix[1] - lab[1], mix[2] - lab[2]) <= T.mixTolerance) return true
    }
    return false
  }
  // Pixels that survive an opening with a disc of radius r: the parts of the area thicker than 2r.
  function opening(isIn, W, H, r) {
    const n = W * H
    const offsets = []
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) offsets.push([dx, dy])
    const eroded = new Uint8Array(n)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let all = isIn(y * W + x)
        for (let o = 0; all && o < offsets.length; o++) {
          const xx = x + offsets[o][0]
          const yy = y + offsets[o][1]
          if (xx >= 0 && xx < W && yy >= 0 && yy < H && !isIn(yy * W + xx)) all = false
        }
        eroded[y * W + x] = all ? 1 : 0
      }
    }
    const opened = new Uint8Array(n)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!eroded[y * W + x]) continue
        for (const [dx, dy] of offsets) {
          const xx = x + dx
          const yy = y + dy
          if (xx >= 0 && xx < W && yy >= 0 && yy < H && isIn(yy * W + xx)) opened[yy * W + xx] = 1
        }
      }
    }
    return opened
  }
  async function analyse(file, packId, sceneHexes, mapFile, contour) {
    const k = classifiers[packId]
    const { data, info } = await sharp(file).resize(320, 320, { fit: 'inside' }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const W = info.width
    const H = info.height
    const n = W * H
    const bucket = new Int16Array(n)
    const names = new Array(n).fill(null)
    const Ls = new Float32Array(n)
    const shares = new Float64Array(k.colors.length)
    const own = new Float64Array(k.colors.length) // at or below the color's own nominal brightness, not overexposed
    const sat = new Float64Array(k.colors.length) // saturated (Oklab chroma 0.12 or more)
    const near = new Float64Array(k.colors.length) // at 60% of the color's nominal lightness or more: an area of that color, not a dim base
    const bridges = new Float64Array(k.pairs.length)
    const outside = {}
    let dark = 0
    let white = 0
    let pale = 0
    const labs = new Float32Array(n * 3)
    for (let p = 0; p < n; p++) {
      const lab = linearToOklab([SRGB_TO_LINEAR[data[3 * p]], SRGB_TO_LINEAR[data[3 * p + 1]], SRGB_TO_LINEAR[data[3 * p + 2]]])
      labs.set(lab, 3 * p)
      const [L, C, h] = lch(lab)
      Ls[p] = L
      if (L < T.dark) {
        bucket[p] = BUCKET_DARK
        dark++
        continue
      }
      if (L >= T.white && C < 0.04) {
        if (k.neutrals.length) {
          bucket[p] = k.neutrals[0]
          shares[k.neutrals[0]]++
        } else {
          bucket[p] = BUCKET_WHITE
          white++
        }
        continue
      }
      let { fam, bridge } = classify(k, L, C, h)
      // Atmospheric's neutrals share one hue, so a neutral, or a mix of two neutrals, is named by its lightness.
      if (k.neutrals.length && (k.neutrals.includes(fam) || (bridge >= 0 && k.pairs[bridge].every((i) => k.neutrals.includes(i))))) {
        fam = k.neutrals.reduce((best, i) => (Math.abs(k.colors[i].lab[0] - L) < Math.abs(k.colors[best].lab[0] - L) ? i : best), k.neutrals[0])
        bridge = -1
      }
      if (fam >= 0) {
        bucket[p] = fam
        shares[fam]++
        if (L <= k.colors[fam].path.L0) own[fam]++
        if (C >= 0.12) sat[fam]++
        if (L >= 0.6 * k.colors[fam].path.L0) near[fam]++
      } else if (bridge >= 0) {
        bucket[p] = 100 + bridge
        bridges[bridge]++
      } else if (L >= T.pale.L && C <= T.pale.C) {
        bucket[p] = BUCKET_PALE
        pale++
      } else {
        bucket[p] = BUCKET_OUT
        const name = outsideName(L, C, h)
        names[p] = name
        outside[name] = (outside[name] ?? 0) + 1
      }
    }
    // New rule: an off-pack pixel on the linear-light mix of two pack colors in the frame is a lens edge, unless its
    // hue is a third hue (pink, mauve, lavender and the like), which is neither neighbour. Both colors must show as
    // areas near their own brightness: a warm light's tail over a dim base is not an edge between two colors (C-025).
    let edge = 0
    if (rule === 'new') {
      // In Contour the dark base is not a lit area: a light's falloff over it is its tail, judged by C-025.
      const baseCount = new Float64Array(k.colors.length)
      for (let p = 0; p < n; p++) if (bucket[p] >= 0 && bucket[p] < 100 && Ls[p] < 0.35) baseCount[bucket[p]]++
      const base = contour ? baseCount.indexOf(Math.max(...baseCount)) : -1
      const inFrame = k.colors.map((c, i) => i).filter((i) => near[i] >= 0.01 * n && i !== base)
      const pairs = []
      for (let a = 0; a < inFrame.length; a++) for (let b = a + 1; b < inFrame.length; b++) pairs.push([inFrame[a], inFrame[b]])
      for (let p = 0; p < n; p++) {
        if (bucket[p] !== BUCKET_OUT || THIRD_HUES.has(names[p])) continue
        const lin = [SRGB_TO_LINEAR[data[3 * p]], SRGB_TO_LINEAR[data[3 * p + 1]], SRGB_TO_LINEAR[data[3 * p + 2]]]
        if (onMix(k, pairs, lin, labs.subarray(3 * p, 3 * p + 3))) {
          bucket[p] = BUCKET_EDGE
          edge++
          outside[names[p]]--
        }
      }
      for (const name of Object.keys(outside)) if (outside[name] <= 0) delete outside[name]
    }
    // Wide outside areas: what survives an opening with a disc of radius wideRadius x short side; a lens edge only
    // counts where it is wider than the lens's own width.
    const r = Math.max(2, Math.round(T.wideRadius * Math.min(W, H)))
    const isOut = (p) => bucket[p] === BUCKET_OUT
    const wide = opening(isOut, W, H, r)
    if (rule === 'new') {
      // A mix area wider than the lens's own width is an off-pack area again, for every check below.
      const wideEdge = opening((p) => bucket[p] === BUCKET_EDGE, W, H, Math.max(2, Math.round((T.lensEdge / 2) * Math.min(W, H))))
      for (let p = 0; p < n; p++) {
        if (!wideEdge[p]) continue
        wide[p] = 1
        bucket[p] = BUCKET_OUT
        edge--
        outside[names[p]] = (outside[names[p]] ?? 0) + 1
      }
    }
    let wideCount = 0
    const wideNames = {}
    for (let p = 0; p < n; p++) {
      if (!wide[p]) continue
      wideCount++
      wideNames[names[p]] = (wideNames[names[p]] ?? 0) + 1
    }
    let largest = 0
    const seen = new Uint8Array(n)
    const queue = new Int32Array(n)
    for (let p = 0; p < n; p++) {
      if (!wide[p] || seen[p]) continue
      let head = 0
      let tail = 0
      queue[tail++] = p
      seen[p] = 1
      while (head < tail) {
        const q = queue[head++]
        const x = q % W
        const y = (q - x) / W
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx
            const yy = y + dy
            if (xx < 0 || xx >= W || yy < 0 || yy >= H) continue
            const s = yy * W + xx
            if (wide[s] && !seen[s]) {
              seen[s] = 1
              queue[tail++] = s
            }
          }
        }
      }
      largest = Math.max(largest, tail)
    }
    if (mapFile) {
      // What each pixel counted as: its pack color, grey for a clean mix, white, black for the dark base,
      // red for a wide outside area and orange for a thin one.
      const px = Buffer.alloc(n * 3)
      const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
      const colorRgb = k.colors.map((c) => hexRgb(c.hex))
      for (let p = 0; p < n; p++) {
        const b = bucket[p]
        const rgb = b >= 100 ? [128, 128, 128] : b >= 0 ? colorRgb[b] : b === BUCKET_WHITE ? [255, 255, 255] : b === BUCKET_PALE ? [210, 210, 210] : b === BUCKET_DARK ? [0, 0, 0] : wide[p] ? [255, 0, 0] : b === BUCKET_EDGE ? [60, 120, 120] : [255, 150, 0]
        px.set(rgb, 3 * p)
      }
      await sharp(px, { raw: { width: W, height: H, channels: 3 } }).png().toFile(mapFile)
    }
    let darkLine = 0
    const darkLineNames = {}
    for (let p = 0; p < n; p++) {
      if (isOut(p) && !wide[p] && Ls[p] < 0.45) {
        darkLine++
        darkLineNames[names[p]] = (darkLineNames[names[p]] ?? 0) + 1
      }
    }
    // Contour: the dark base and the lit area.
    // The frame's light color: the pack color covering the most lit area at or below its own nominal brightness.
    // An overexposed core is left out (Meta Blue's turns cyan-white). Atmospheric's greys are one hue, so a grey
    // light is named by the lightest grey it reaches on at least 1% of the frame (an Ice light's falloff passes
    // through Steel's and Slate's lightness).
    const litOwn = new Float64Array(k.colors.length)
    let neutralLit = 0
    const neutralTop = new Float64Array(k.colors.length)
    for (let p = 0; p < n; p++) {
      const b = bucket[p]
      if (b < 0 || b >= 100 || Ls[p] < 0.35) continue
      if (k.neutrals.includes(b)) {
        neutralLit++
        neutralTop[b]++
      } else if (Ls[p] <= k.colors[b].path.L0) litOwn[b]++
    }
    let source = null
    litOwn.forEach((v, i) => {
      if (v > 0 && (source === null || v > litOwn[source])) source = i
    })
    if (k.neutrals.length && neutralLit > (source === null ? 0 : litOwn[source])) {
      source = k.neutrals.find((i) => neutralTop[i] >= 0.01 * n) ?? k.neutrals.find((i) => neutralTop[i] > 0) ?? source
    }
    let base = 0
    let baseOut = 0
    let lit = 0
    let litOut = 0
    const litByColor = new Float64Array(k.colors.length)
    // A drift into another color needs color: a near-grey (chroma under 0.05) belongs to no color family.
    const litChromatic = new Float64Array(k.colors.length)
    const baseNames = {}
    const litNames = {}
    for (let p = 0; p < n; p++) {
      const L = Ls[p]
      if (bucket[p] === BUCKET_DARK) continue
      if (L < 0.35) {
        base++
        if (isOut(p)) {
          baseOut++
          baseNames[names[p]] = (baseNames[names[p]] ?? 0) + 1
        }
      } else {
        lit++
        if (isOut(p)) {
          litOut++
          litNames[names[p]] = (litNames[names[p]] ?? 0) + 1
        } else if (bucket[p] >= 0 && bucket[p] < 100) {
          litByColor[bucket[p]]++
          if (Math.hypot(labs[3 * p + 1], labs[3 * p + 2]) >= 0.05) litChromatic[bucket[p]]++
        }
      }
    }
    const frac = (v) => v / n
    const top = (obj, total = n) =>
      Object.entries(obj)
        .sort((x, y) => y[1] - x[1])
        .map(([name, v]) => ({ name, share: v / total }))
    const result = {
      size: [W, H],
      shares: Object.fromEntries(k.colors.map((c, i) => [c.name, frac(shares[i])])),
      own: Object.fromEntries(k.colors.map((c, i) => [c.name, frac(own[i])])),
      bridges: Object.fromEntries(k.pairs.map(([i, j], b) => [`${k.colors[i].name} + ${k.colors[j].name}`, frac(bridges[b])])),
      dark: frac(dark),
      white: frac(white),
      pale: frac(pale),
      edge: frac(edge),
      saturated: Object.fromEntries(k.colors.map((c, i) => [c.name, frac(sat[i])])),
      outside: top(outside),
      outsideShare: frac(Object.values(outside).reduce((s, v) => s + v, 0)),
      wideShare: frac(wideCount),
      wideNames: top(wideNames),
      largestPatch: frac(largest),
      darkLine: frac(darkLine),
      darkLineNames: top(darkLineNames),
      base: { share: frac(base), outside: base ? baseOut / base : 0, names: top(baseNames, Math.max(1, base)) },
      lit: {
        share: frac(lit),
        outside: lit ? litOut / lit : 0,
        names: top(litNames, Math.max(1, lit)),
        byColor: Object.fromEntries(k.colors.map((c, i) => [c.name, lit ? litByColor[i] / lit : 0])),
        chromatic: Object.fromEntries(k.colors.map((c, i) => [c.name, lit ? litChromatic[i] / lit : 0])),
      },
      source: source === null ? null : k.colors[source].name,
      sceneColors: sceneHexes ? [...new Set(sceneHexes.map((h) => h.toUpperCase()))].filter((h) => h !== '#000000').map((h) => k.colors.find((c) => c.hex.toUpperCase() === h)?.name ?? h) : null,
    }
    return result
  }

  // --- the rules ---
  const pct = (v) => `${Math.round(v * 100)}%`
  function judge(look, packId, m) {
    const k = classifiers[packId]
    const fails = []
    const notes = []
    if (look.startsWith('sunset.') && m.dark >= 0.99) return { fails: ['blank frame (no light)'], notes }
    // Bold's two warm colors count as one warm light: Yellow's deeper tones and Orange-red's overexposed ones
    // overlap (orange, peach, cream), so a frame shows two warm colors only when both appear at their own
    // brightness or dimmer.
    const warmGroup = packId === 'bold' ? WARM.bold : []
    const present = []
    for (const c of k.colors) {
      if (warmGroup.includes(c.name)) continue
      if (m.shares[c.name] >= T.present) present.push(c.name)
    }
    if (warmGroup.length && warmGroup.reduce((s, name) => s + m.shares[name], 0) >= T.present) {
      const named = warmGroup.reduce((a, b) => (m.own[b] > m.own[a] ? b : a))
      const brightest = warmGroup.reduce((a, b) => (m.saturated[b] > m.saturated[a] ? b : a))
      present.push(m.own[named] >= 0.01 ? named : m.saturated[brightest] >= 0.02 ? `${brightest} (overexposed)` : 'pale warm light')
    }
    m.present = present
    if (m.largestPatch >= T.largestPatch || m.wideShare >= T.wideShare) {
      const named = m.wideNames.slice(0, 2).map((x) => x.name).join(' and ')
      fails.push(`wide ${named} ${pct(m.wideShare)} (largest ${pct(m.largestPatch)})`)
    }
    if (m.darkLine >= T.darkLine) notes.push(`thin dark ${m.darkLineNames[0]?.name ?? ''} line ${pct(m.darkLine)}`)
    if (look.startsWith('sunset.')) {
      if (m.shares['Meta Blue'] < T.present) fails.push('no Meta Blue sky')
      if (present.length < 3) {
        const [mix, share] = Object.entries(m.bridges).sort((x, y) => y[1] - x[1])[0] ?? []
        const haze = share >= 0.2 ? `, ${pct(share)} is a ${mix} mix` : ''
        fails.push(`${present.length} pack color${present.length === 1 ? '' : 's'} (${present.join(', ') || 'none'}${haze})`)
      }
      const warm = present.filter((name) => WARM[packId].includes(name) || name === 'pale warm light' || name.endsWith('(overexposed)'))
      if (WARM[packId].length && warm.length === 0) fails.push('no warm color')
      if (packId === 'bold' && WARM.bold.every((name) => m.own[name] >= T.present)) fails.push('two warm colors (Yellow and Orange-red)')
      if (packId === 'elemental' && warm.length > 1) notes.push('Lime and Tan together (open question 7)')
    } else {
      if (m.base.share >= 0.05 && m.base.outside >= T.baseOutside) fails.push(`base is ${m.base.names[0]?.name} (${pct(m.base.outside)} of the base)`)
      if (m.lit.share >= 0.01 && m.lit.outside >= T.litOutside) fails.push(`light goes ${m.lit.names[0]?.name} (${pct(m.lit.outside)} of the lit area)`)
      m.mainLight = m.source
      if (m.sceneColors) {
        // Atmospheric's greys are one hue named by lightness, so a grey light's falloff is never a drift.
        const neutralNames = k.neutrals.map((i) => k.colors[i].name)
        const lightsWith = new Set(m.sceneColors.some((name) => neutralNames.includes(name)) ? [...m.sceneColors, ...neutralNames] : m.sceneColors)
        const drifted = Object.entries(m.lit.chromatic).filter(([name]) => !lightsWith.has(name))
        const drift = drifted.reduce((s, [, v]) => s + v, 0)
        if (drift >= T.drift) {
          const into = drifted.sort((x, y) => y[1] - x[1])[0][0]
          fails.push(`${m.sceneColors.join(' and ')} light drifts into ${into} (${pct(drift)} of the lit area)`)
        }
      }
    }
    return { fails, notes }
  }

  // --- getting the frames ---
  const frameList = (look) => {
    const short = look.split('.')[1]
    const frames = []
    for (const pack of PACK_ORDER) {
      for (let s = 1; s <= seeds; s++) frames.push({ id: `${short}-${pack}-s${s}-16x9`, pack, seed: s, format: '16x9' })
      for (let s = 1; s <= portraitSeeds; s++) frames.push({ id: `${short}-${pack}-s${s}-9x16`, pack, seed: s, format: '9x16' })
    }
    return frames
  }
  const RENDER = { '16x9': { width: 640, height: 360 }, '9x16': { width: 360, height: 640 } }

  let page = null
  async function devShot(look, f, file) {
    if (!browser) {
      browser = await chromium.launch({ channel: 'chrome' })
      page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage()
    }
    const [mood, short] = look.split('.')
    const moodParam = mood === 'sunset' ? 'horizon' : 'light'
    const query = `intensity=${controls.intensity}&softness=${controls.softness}&${moodParam}=${controls.mood}`
    await page.goto(`${devUrl}/?mood=${mood}&look=${short}&pack=${f.pack}&seed=${f.seed}&format=${f.format}&${query}`, { waitUntil: 'load', timeout: 90000 })
    const settled = () => page.waitForSelector('canvas[data-settled="true"]', { timeout: 20000 }).then(() => true, () => false)
    if (await settled()) {
      await page.waitForTimeout(1200)
      await settled()
    } else await page.waitForTimeout(5000)
    const canvas = page.locator('canvas').first()
    await page.screenshot({ path: file, clip: await canvas.boundingBox() })
    // A blank canvas means the page was mid-update; try once more.
    const stats = await sharp(file).stats()
    if (Math.max(...stats.channels.slice(0, 3).map((c) => c.max - c.min)) < 4 && !f.retried) {
      f.retried = true
      await page.waitForTimeout(8000)
      await devShot(look, f, file)
    }
  }

  await fs.mkdir(path.join(outDir, 'renders'), { recursive: true })
  if (maps) await fs.mkdir(path.join(outDir, 'maps'), { recursive: true })
  const report = { source: sourceLabel, startedAt: startedAt.toISOString(), thresholds: T, looks: {} }
  const summary = [`# Palette check: ${sourceLabel}`, '', `Started ${startedAt.toISOString()}. Controls: intensity ${controls.intensity}, softness ${controls.softness}, mood ${controls.mood}. Rule: ${rule}${rule === 'new' ? `, lens edges up to ${T.lensEdge} of the short side` : ''}; warm tails: ${tailRule}. Thresholds in \`palette-check.mjs\` (T).`, '']
  for (const look of looks) {
    const frames = frameList(look)
    for (const f of frames) {
      f.file = fromDir ? path.join(fromDir, `${f.id}.png`) : path.join(outDir, 'renders', `${f.id}.png`)
      if (fromDir) {
        if (!existsSync(f.file)) f.missing = true
        continue
      }
      if (dev) {
        await devShot(look, f, f.file)
        continue
      }
      const exportSize = EXPORT_SIZES[f.format.replace('x', ':')]
      const scene = buildScene(look, getPack(f.pack), f.seed, controls, exportSize.width / exportSize.height)
      f.sceneHexes = scene.colors
      await savePng(f.file, await harness.render({ scene, ...RENDER[f.format], supersample: 2 }))
    }
    for (const f of frames) {
      if (f.missing) continue
      f.m = await analyse(f.file, f.pack, f.sceneHexes ?? null, maps ? path.join(outDir, 'maps', `${f.id}.png`) : null, look.startsWith('contour.'))
      Object.assign(f, judge(look, f.pack, f.m))
    }
    // Contour: across seeds 1-8 at 16:9, does every light color the pack offers light at least one frame?
    const rows = {}
    for (const pack of PACK_ORDER) {
      const k = classifiers[pack]
      // Atmospheric's light is Ice; its other greys are shades, and a grey light is a dimmer Ice light.
      const lightest = k.neutrals[0]
      const offered = k.colors.filter((c, i) => c.lab[0] >= T.lightL && (!k.neutrals.includes(i) || i === lightest)).map((c) => c.name)
      const asLight = (name) => (k.neutrals.some((i) => k.colors[i].name === name) ? k.colors[lightest].name : name)
      const mains = frames.filter((f) => f.pack === pack && f.format === '16x9' && f.m).map((f) => f.m.mainLight && asLight(f.m.mainLight)).filter(Boolean)
      const counts = Object.fromEntries(offered.map((name) => [name, mains.filter((x) => x === name).length]))
      const missing = look.startsWith('contour.') ? offered.filter((name) => !counts[name]) : []
      rows[pack] = { offered, counts, missing }
    }
    await drawSheet(look, frames, rows)
    report.looks[look] = { frames: frames.map(({ file, sceneHexes, ...f }) => ({ ...f, file: path.relative(process.cwd(), file) })), rows }
    summary.push(`## ${look}`, '')
    for (const pack of PACK_ORDER) {
      const failing = frames.filter((f) => f.pack === pack && f.fails?.length)
      const row = rows[pack]
      const across = look.startsWith('contour.') ? ` Main light across seeds 1-${seeds}: ${Object.entries(row.counts).map(([nm, c]) => `${nm} ${c}`).join(', ')}${row.missing.length ? `; never ${row.missing.join(', ')}: FAIL` : ''}.` : ''
      summary.push(`- ${pack}: ${failing.length} of ${frames.filter((f) => f.pack === pack && !f.missing).length} frames fail.${across}`)
      for (const f of failing) summary.push(`  - ${f.id}: ${f.fails.join('; ')}${f.notes.length ? ` (also ${f.notes.join('; ')})` : ''}`)
    }
    summary.push('')
    console.log(`${look}: ${path.relative(process.cwd(), path.join(outDir, `${look}.png`))}`)
  }
  await fs.writeFile(path.join(outDir, 'palette.json'), JSON.stringify(report, null, 1))
  await fs.writeFile(path.join(outDir, 'summary.md'), `${summary.join('\n')}\n`)
  console.log(`summary: ${path.relative(process.cwd(), path.join(outDir, 'summary.md'))}`)

  // --- the sheet: packs as rows, seeds as columns, a share bar and the verdict under each tile ---
  async function drawSheet(look, frames, rows) {
    const TW = 200
    const TH = 113
    const PW = 64
    const GAP = 8
    const LEFT = 96
    const BAR = 10
    const TEXT = 30
    const ROWH = 18 + TH + 4 + BAR + TEXT + 22
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const textSvg = (lines, w, h, size = 11, color = '#ddd') =>
      Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${lines.map((l, i) => `<text x="1" y="${(i + 1) * (size + 3)}" font-family="Helvetica" font-size="${size}" fill="${l.color ?? color}">${esc(l.text ?? l)}</text>`).join('')}</svg>`)
    const width = LEFT + seeds * (TW + GAP) + portraitSeeds * (PW + GAP) + 16
    const height = 70 + PACK_ORDER.length * ROWH + 40
    const comp = [
      { input: textSvg([{ text: `${look}: palette check`, color: '#fff' }], width, 22, 16), left: 12, top: 8 },
      { input: textSvg([sourceLabel, `Rule: ${rule}${rule === 'new' ? ` (lens edges up to ${T.lensEdge} of the short side)` : ''}. Bar: each pack color's share in its hex, then clean mixes (grey), lens edges (teal grey), pale bridges (light grey), white, the dark base (black), and outside colors (red). A red frame fails. Fail: a wide outside area ${pct(T.largestPatch)}+ (or ${pct(T.wideShare)}+ in all)${look.startsWith('sunset.') ? `, under 3 pack colors, no Meta Blue, no warm color, two warm colors (Bold)` : `, base or light outside the pack, a pack light color never used across seeds`}.`], width, 34, 11, '#aaa'), left: 12, top: 30 },
    ]
    for (const [r, pack] of PACK_ORDER.entries()) {
      const top = 70 + r * ROWH
      const k = classifiers[pack]
      comp.push({ input: textSvg([{ text: k.pack.name, color: '#fff' }], LEFT - 8, 20, 13), left: 12, top: top + 18 + Math.round(TH / 2) - 10 })
      const rowFrames = frames.filter((f) => f.pack === pack)
      for (const f of rowFrames) {
        const portrait = f.format === '9x16'
        const idx = portrait ? seeds + f.seed - 1 : f.seed - 1
        const left = LEFT + (portrait ? seeds * (TW + GAP) + (f.seed - 1) * (PW + GAP) : idx * (TW + GAP))
        const w = portrait ? PW : TW
        comp.push({ input: textSvg([`s${f.seed}${portrait ? ' 9:16' : ''}`], w, 16, 11, '#bbb'), left, top })
        if (f.missing || !f.m) {
          comp.push({ input: textSvg(['missing'], w, 16), left, top: top + 18 })
          continue
        }
        const failed = f.fails.length > 0
        const tile = await sharp(f.file).resize(w, TH, { fit: 'fill' }).toBuffer()
        if (failed) comp.push({ input: { create: { width: w + 6, height: TH + 6, channels: 3, background: '#ff2020' } }, left: left - 3, top: top + 15 })
        comp.push({ input: tile, left, top: top + 18 })
        comp.push({ input: await bar(f.m, k, w, BAR), left, top: top + 18 + TH + 4 })
        const verdict = failed ? f.fails : f.notes.length ? f.notes : ['ok']
        const lines = portrait ? [failed ? 'FAIL' : f.notes.length ? 'note' : 'ok'] : verdict.slice(0, 2).map((v) => v.slice(0, 40))
        comp.push({ input: textSvg(lines.map((t) => ({ text: t, color: failed ? '#ff7070' : f.notes.length ? '#e0c060' : '#8c8' })), w, TEXT, 10), left, top: top + 18 + TH + 4 + BAR + 2 })
      }
      const row = rows[pack]
      const counts = look.startsWith('contour.') ? `Main light per seed (16:9): ${Object.entries(row.counts).map(([nm, c]) => `${nm} ${c}`).join(', ')}${row.missing.length ? `. Never lit with ${row.missing.join(', ')}: FAIL` : '. Every light color used.'}` : ''
      if (counts) comp.push({ input: textSvg([{ text: counts, color: row.missing.length ? '#ff7070' : '#8c8' }], width - LEFT, 18, 11), left: LEFT, top: top + 18 + TH + 4 + BAR + TEXT })
    }
    await sharp({ create: { width, height, channels: 3, background: '#161616' } }).composite(comp).png().toFile(path.join(outDir, `${look}.png`))
  }

  async function bar(m, k, w, h) {
    const segs = []
    for (const c of k.colors) segs.push([m.shares[c.name], c.hex])
    segs.push([Object.values(m.bridges).reduce((s, v) => s + v, 0), '#808080'])
    segs.push([m.edge ?? 0, '#3c7878'])
    segs.push([m.pale, '#d2d2d2'])
    segs.push([m.white, '#ffffff'])
    segs.push([m.dark, '#000000'])
    segs.push([m.outsideShare, '#ff2020'])
    const px = Buffer.alloc(w * h * 3, 40)
    let x0 = 0
    for (const [share, hex] of segs) {
      const x1 = Math.min(w, x0 + Math.round(share * w))
      const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
      for (let y = 0; y < h; y++) for (let x = x0; x < x1; x++) px.set(rgb, 3 * (y * w + x))
      x0 = x1
    }
    return sharp(px, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer()
  }
} finally {
  if (browser) await browser.close()
  await harness.close()
}
