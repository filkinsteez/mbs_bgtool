import { motionHarmonic, type V2Env } from '../v2/system'
import { normalizedLuminance } from '../v2/pattern'
import type { Field } from '../field'
import { chan, chanGauss } from '@/core/organic/random'
import { hexToRgb, rgbCss, type RGB } from '../colorField'
import { CANONICAL_META_SAFE_AREA } from '../metaInfluence'
import { META_SYMBOL_HEIGHT, META_SYMBOL_WIDTH } from '@/core/metaSymbol'

// 'Loom' — machine-knit colorwork. The whole frame is one stockinette
// fabric: courses of chunky raster stitches whose loops interlock (each
// stitch's bottom point tucks through the notch between the next course's
// arms), striped into seeded fair-isle row bands dealt from the plan's
// inks. The canonical mark is KNITTED IN — per-stitch yarn choice from
// the quantized symbol field (band ink inside the mark, a mixed echo ring
// around it, dithered stitch-stepped edges) — so the silhouette reads as
// colorwork, never as an overlay.
//
// THE LOOP IS THE STORY: a carriage band (~10-15% of the frame, seeded
// home position and travel direction) sweeps the frame exactly h times
// per loop (h = the integer Energy harmonic) and wraps by construction —
// band position is frac(phase·h) mapped from the seeded home, a whole-
// period wrapped translation, so phase 0 and phase 1 are byte-identical.
// Inside the band the fabric is mid-knit: rows slide sideways off
// register, stitches elongate toward the leading edge, some drop to a
// dark void or unravel into bare hanging threads, and loose yarn arcs
// sag across the working zone. Every disturbance term scales with
// motionAmount and depends only on the band-relative coordinate plus
// seeded channels, so at amount 0 the render is the pure finished
// fabric, and at any phase at least ~85% of the frame lies finished.
//
// 3D material mode is a knit portrait of the captured frame: per-stitch
// yarn quantized from env.luminance onto a ground->ink ladder (ordered
// by contrast, stochastically dithered), the row-band striping kept as
// tone-on-tone ground so the model reads through one continuous fabric.
// When a depth pass exists, near model regions knit CHUNKIER — aligned
// 2x2 stitch blocks fuse into one double-gauge stitch across a
// chan-dithered boundary — and the branch degrades silently to the
// all-fine fabric when depth is null.
//
// Randomness: 'v4.loom.*' channels only.

const C = 'v4.loom.'

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const smooth01 = (t: number) => {
  const u = clamp01(t)
  return u * u * (3 - 2 * u)
}

function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function scaleRgb(c: RGB, f: number): RGB {
  return [c[0] * f, c[1] * f, c[2] * f]
}

function rgbKey(c: RGB): string {
  return `${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])}`
}

// ---------------------------------------------------------------------------
// Yarn pool — the enabled plan swatches that survive against the ground,
// the same policy the V3-tab systems and the sibling V4 looks use:
// perceptual oklab distance >= 0.09, weight kept for the band deal.
// ---------------------------------------------------------------------------

type Yarn = { rgb: RGB; weight: number; contrast: number }

function hexToOklab(hex: string): [number, number, number] {
  const match = hex.trim().match(/^#?([0-9a-f]{6})$/i)
  const value = match ? Number.parseInt(match[1], 16) : 0
  const lin = (c: number) => {
    const u = c / 255
    return u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4
  }
  const r = lin((value >> 16) & 255)
  const g = lin((value >> 8) & 255)
  const b = lin(value & 255)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

function buildYarnPool(env: V2Env): Yarn[] {
  const plan = env.plan
  const [gl, ga, gb] = hexToOklab(env.ground)
  if (!plan || plan.depthOrder.length === 0) {
    const [il] = hexToOklab(env.ink)
    return [{ rgb: hexToRgb(env.ink), weight: 1, contrast: Math.abs(il - gl) }]
  }
  const pool: Yarn[] = []
  for (const sw of plan.swatches) {
    const sa = Math.cos(sw.hue) * sw.chroma
    const sb = Math.sin(sw.hue) * sw.chroma
    const dist = Math.hypot(sw.lightness - gl, sa - ga, sb - gb)
    if (dist >= 0.09) {
      pool.push({ rgb: hexToRgb(sw.hex), weight: Math.max(1e-4, sw.weight), contrast: dist })
    }
  }
  if (pool.length === 0) {
    const idx = plan.depthOrder[plan.depthOrder.length - 1]
    const hex = plan.swatches[idx]?.hex ?? env.ink
    const [il] = hexToOklab(hex)
    return [{ rgb: hexToRgb(hex), weight: 1, contrast: Math.abs(il - gl) }]
  }
  return pool
}

// ---------------------------------------------------------------------------
// Stitch tiles — the chunky raster loop. Each yarn gets three heather
// shades of one prerendered stitch cell, built per-pixel (aliased
// stepped edges ARE the medium) and cached across frames so motion
// preview stays drawImage-only. The cell carries a TRANSPARENT notch
// between the arms at the top and an overhanging loop point below its
// bottom edge: drawn course by course top-to-bottom, each stitch's point
// shows through the next course's notch and tucks behind its arms — the
// interlock that makes the fabric read as knitting, not chevron print.
// ---------------------------------------------------------------------------

// Arms reach the cell corners at the top (spread 0.5), so each arm meets
// its neighbor's opposite arm on the shared column edge and every course
// reads as one continuous zigzag strand of yarn; the loop bottom plumps
// where the legs merge. The transparent notch between the arms is filled
// by the course above's overhanging loop point.
const LEG_HALF_W = 0.24
const OVERHANG = 0.5 // loop point drop, fraction of stitch height

const tileCache = new Map<string, HTMLCanvasElement>()

function stitchOverhang(sh: number): number {
  return Math.max(2, Math.round(sh * OVERHANG))
}

function yarnTile(sw: number, sh: number, yarn: RGB, shade: number): HTMLCanvasElement {
  const key = `${sw}x${sh}|${rgbKey(yarn)}|${shade}`
  const hit = tileCache.get(key)
  if (hit) return hit
  if (tileCache.size > 480) tileCache.clear()
  const ov = stitchOverhang(sh)
  const canvas = document.createElement('canvas')
  canvas.width = sw
  canvas.height = sh + ov
  const tctx = canvas.getContext('2d')
  if (!tctx) return canvas
  const img = tctx.createImageData(sw, sh + ov)
  const data = img.data
  const heather = 0.95 + 0.05 * shade
  for (let py = 0; py < sh + ov; py++) {
    const v = (py + 0.5) / sh
    for (let px = 0; px < sw; px++) {
      const u = (px + 0.5) / sw
      const du = u - 0.5
      // deterministic fiber fleck — texture without random channels
      const fleck = 0.97 + 0.06 * (((px * 7 + py * 13) % 5) / 4)
      let f = -1 // <0 = transparent
      if (v <= 1) {
        const spread = 0.5 * (1 - v)
        const sideL = (du + spread) / LEG_HALF_W
        const sideR = (du - spread) / LEG_HALF_W
        if (Math.abs(sideL) < 1 || Math.abs(sideR) < 1) {
          const onLeft = Math.abs(sideL) <= Math.abs(sideR)
          const side = onLeft ? sideL : sideR
          f = 1.12 - 0.26 * v // light falls from the top of the loop
          f *= onLeft ? 1.04 - 0.13 * side : 1.04 + 0.13 * side
          if (Math.abs(side) > 0.72) f *= 0.88 // rounded leg edge
        } else if (Math.abs(du) < spread - LEG_HALF_W) {
          f = -1 // the notch: the course above's point shows through
        } else {
          f = 0.38 + 0.06 * v // shadowed yarn in the furrows
        }
      } else {
        // the loop point dropping through the next course's notch
        const t = (v - 1) / OVERHANG
        const pw = 0.3 * (1 - 0.55 * t * t)
        if (Math.abs(du) < pw) {
          f = (0.95 - 0.38 * t) * (1 - 0.25 * Math.abs(du) / pw)
        }
      }
      const o = (py * sw + px) * 4
      if (f < 0) {
        data[o + 3] = 0
        continue
      }
      const lum = f * heather * fleck
      const spec = Math.max(0, lum - 1) * 70
      data[o] = Math.max(0, Math.min(255, yarn[0] * lum + spec))
      data[o + 1] = Math.max(0, Math.min(255, yarn[1] * lum + spec))
      data[o + 2] = Math.max(0, Math.min(255, yarn[2] * lum + spec))
      data[o + 3] = 255
    }
  }
  tctx.putImageData(img, 0, 0)
  tileCache.set(key, canvas)
  return canvas
}

// ---------------------------------------------------------------------------
// Row bands — the fair-isle striping plan. Heights of 3-8 courses, each
// band dealing one pool ink: mostly tone-on-tone grounds so the fabric
// stays calm, tinted stripes, rare narrow accent stripes. Ground lice
// stitches pepper some bands on a drifting diagonal the way fair-isle
// grounds carry them.
// ---------------------------------------------------------------------------

type RowBand = {
  bg: RGB // ground yarn of the band
  figure: RGB // yarn the mark knits in
  halo: RGB // echo ring around the mark
  lice: RGB | null
  licePhase: number
}

function buildBands(
  env: V2Env,
  rows: number,
  pool: Yarn[],
  muted: boolean,
): { of: Int16Array; bands: RowBand[] } {
  const { seed } = env
  const ground = hexToRgb(env.ground)
  const of = new Int16Array(rows)
  const bands: RowBand[] = []
  const totalW = pool.reduce((s, y) => s + y.weight, 0) || 1
  let row = 0
  let lastInk = -1
  while (row < rows) {
    const b = bands.length
    const height = 3 + Math.floor(chan(seed, b, C + 'bandRows') * 6)
    // weight-proportional ink deal, nudged off the previous band's ink
    let pick = pool.length - 1
    const sample = chan(seed, b, C + 'bandInk') * totalW
    let acc = 0
    for (let k = 0; k < pool.length; k++) {
      acc += pool[k].weight
      if (sample < acc) {
        pick = k
        break
      }
    }
    if (pool.length > 1 && pick === lastInk) pick = (pick + 1) % pool.length
    lastInk = pick
    const ink = pool[pick].rgb
    const style = chan(seed, b, C + 'bandStyle')
    const accent = !muted && style >= 0.9 && height <= 4
    const bg = accent
      ? mixRgb(ground, ink, 0.3)
      : style < 0.52
        ? mixRgb(ground, ink, 0.04)
        : mixRgb(ground, ink, muted ? 0.09 : 0.14)
    const band: RowBand = {
      bg,
      figure: ink,
      halo: mixRgb(bg, ink, 0.42),
      lice:
        !accent && chan(seed, b, C + 'bandLice') < (muted ? 0.24 : 0.4)
          ? mixRgb(bg, ink, 0.45)
          : null,
      licePhase: Math.floor(chan(seed, b, C + 'bandLicePhase') * 9),
    }
    bands.push(band)
    for (let k = 0; k < height && row < rows; k++) of[row++] = b
  }
  return { of, bands }
}

// ---------------------------------------------------------------------------
// The fabric plan shared by both branches
// ---------------------------------------------------------------------------

type Gauge = { sw: number; sh: number; cols: number; rows: number }

function fabricGauge(env: V2Env, fineBias: number): Gauge {
  const minDim = Math.min(env.outW, env.outH)
  const across = 26 + Math.round(env.complexity * 44) + fineBias
  const sw = Math.max(5, Math.round(minDim / across))
  const sh = Math.max(4, Math.round(sw * 0.8))
  return { sw, sh, cols: Math.ceil(env.outW / sw) + 1, rows: Math.ceil(env.outH / sh) }
}

// symbol softness so the echo ring runs ~1.5 courses wide whatever the
// gauge: buildMetaSymbolField's falloff is softness * symbolScale * 2,
// and the canonical placement fits the safe area exactly
function haloSoftness(env: V2Env, sh: number): number {
  const boxW = CANONICAL_META_SAFE_AREA.width * env.outW
  const boxH = CANONICAL_META_SAFE_AREA.height * env.outH
  const symbolScale = Math.max(
    0.001,
    Math.min(boxW / META_SYMBOL_WIDTH, boxH / META_SYMBOL_HEIGHT),
  )
  return (1.5 * sh) / (2 * symbolScale)
}

// per-stitch yarn of the FINISHED fabric (2D generated path)
function stitchYarn(
  env: V2Env,
  field: Field,
  bands: RowBand[],
  of: Int16Array,
  g: Gauge,
  col: number,
  row: number,
): RGB {
  const band = bands[of[Math.max(0, Math.min(of.length - 1, row))]]
  const cx = (col + 0.5) * g.sw
  const cy = (row + 0.5) * g.sh
  const id = row * 4096 + (col & 4095)
  const s = field(cx, cy) + (chan(env.seed, id, C + 'edgeDither') - 0.5) * 0.1
  if (s >= 0.985) return band.figure
  if (s >= 0.55) return band.halo
  if (
    band.lice &&
    (col + row * 4 + band.licePhase) % 9 === 0 &&
    chan(env.seed, id, C + 'lice') < 0.75
  ) {
    return band.lice
  }
  return band.bg
}

// smooth fabric sheen: a bilinear seeded lattice over stitch coords
// (feature ~7 stitches), plus a whisper of per-stitch fleck
function shadeIndex(seed: number, col: number, row: number): number {
  const x = (col + 2048) / 7
  const y = (row + 2048) / 7
  const i0 = Math.floor(x)
  const j0 = Math.floor(y)
  const fu = smooth01(x - i0)
  const fv = smooth01(y - j0)
  const val = (i: number, j: number) => chan(seed, (j & 1023) * 4096 + (i & 1023), C + 'sheen')
  const top = val(i0, j0) * (1 - fu) + val(i0 + 1, j0) * fu
  const bot = val(i0, j0 + 1) * (1 - fu) + val(i0 + 1, j0 + 1) * fu
  const sheen = top * (1 - fv) + bot * fv
  const fleck = chan(seed, row * 4096 + (col & 4095), C + 'fleck')
  return Math.min(2, Math.floor((sheen * 0.7 + fleck * 0.3) * 3))
}

// ---------------------------------------------------------------------------
// 2D render — finished fabric + the carriage band
// ---------------------------------------------------------------------------

export function renderLoom(ctx: CanvasRenderingContext2D, env: V2Env): void {
  if (env.luminance) {
    renderLoomMaterial(ctx, env)
    return
  }

  const { outW: W, outH: H, seed } = env
  const g = fabricGauge(env, 0)
  const pool = buildYarnPool(env)
  const { of, bands } = buildBands(env, g.rows, pool, false)
  const field = env.symbolField({ softness: haloSoftness(env, g.sh) })
  const ground = hexToRgb(env.ground)

  ctx.save()
  ctx.imageSmoothingEnabled = false
  // the shadow between loops — everything else is knitted over it
  ctx.fillStyle = rgbCss(scaleRgb(ground, 0.4))
  ctx.fillRect(0, 0, W, H)

  // ---- carriage band geometry: a whole-period wrapped translation.
  // travel's fractional part is 0 at phase 0 AND phase 1 (h integer), so
  // the band sits at its seeded home at both seam frames — byte-equal by
  // construction. Direction only remaps the same wrap.
  const amt = env.motionAmount
  const h = motionHarmonic(env)
  const dir = chan(seed, 0, C + 'sweepDir') < 0.5 ? 1 : -1
  const home = chan(seed, 0, C + 'home')
  const travel = env.motionPhase * h
  let ft = travel - Math.floor(travel)
  if (dir < 0 && ft > 0) ft = 1 - ft
  let pos = home + ft
  if (pos >= 1) pos -= 1
  const bandTop = pos * H
  const bh = (0.1 + 0.05 * chan(seed, 0, C + 'bandH')) * H

  // band-relative coordinates per row: lead = 1 at the working edge the
  // carriage advances with, 0 where the fabric has just settled finished.
  // The disturbance envelope peaks near the lead and dies at both edges.
  const rowLead = (row: number): number => {
    if (amt <= 0) return -1
    const mid = (row + 0.5) * g.sh
    let rel = (mid - bandTop) / H
    rel -= Math.floor(rel)
    rel = (rel * H) / bh
    if (rel < 0 || rel >= 1) return -1
    return dir > 0 ? rel : 1 - rel
  }
  const profile = (lead: number): number =>
    lead < 0 ? 0 : lead < 0.8 ? smooth01(lead / 0.8) : smooth01((1 - lead) / 0.2)

  const drawRow = (row: number, dispX: number, lead: number) => {
    const prof = profile(lead)
    const y = row * g.sh
    const jit = Math.round(chanGauss(seed, row, C + 'tension') * g.sw * 0.06)
    const stretchRow = prof * amt * (0.35 + 0.55 * chan(seed, row, C + 'rowStretch'))
    for (let col = -3; col < g.cols + 3; col++) {
      const id = row * 4096 + (col & 4095)
      const x = col * g.sw + jit + dispX
      if (x + g.sw < 0 || x > W) continue
      const yarn = stitchYarn(env, field, bands, of, g, col, row)
      if (prof > 0) {
        // dropped stitch: the void shows through
        if (chan(seed, id, C + 'drop') < 0.24 * prof * amt) continue
        // unravelled: the stitch hangs as a bare thread
        if (chan(seed, id, C + 'unravel') < 0.3 * prof * amt) {
          const tw = Math.max(2, Math.round(g.sw * 0.18))
          const len = Math.round(g.sh * (1.1 + 1.4 * stretchRow))
          ctx.fillStyle = rgbCss(scaleRgb(yarn, 0.92))
          const tx = x + ((g.sw - tw) >> 1)
          const ty = dir > 0 ? y : y + g.sh - len
          ctx.fillRect(tx, ty, tw, len)
          ctx.beginPath()
          ctx.arc(tx + tw / 2, dir > 0 ? ty + len : ty, tw * 0.85, 0, Math.PI * 2)
          ctx.fill()
          continue
        }
      }
      const tile = yarnTile(g.sw, g.sh, yarn, shadeIndex(seed, col, row))
      if (prof > 0 && stretchRow > 0.02) {
        const stretch = stretchRow * (0.55 + 0.75 * chan(seed, id, C + 'stitchStretch'))
        const dh = Math.round((g.sh + stitchOverhang(g.sh)) * (1 + stretch))
        if (dh > tile.height) {
          ctx.drawImage(tile, x, dir > 0 ? y : y + g.sh - dh, g.sw, dh)
          continue
        }
      }
      ctx.drawImage(tile, x, y)
    }
  }

  // pass 1: finished rows, knitted top-to-bottom so every loop point
  // tucks through the next course's notch
  const bandRows: number[] = []
  for (let row = 0; row < g.rows; row++) {
    const lead = rowLead(row)
    if (lead >= 0) {
      bandRows.push(row)
      continue
    }
    drawRow(row, 0, -1)
  }

  if (bandRows.length > 0) {
    // pass 2: the void behind the working zone
    const void_ = rgbCss(scaleRgb(ground, 0.3))
    ctx.fillStyle = void_
    for (const row of bandRows) ctx.fillRect(0, row * g.sh, W, g.sh)

    // pass 3: mid-knit rows, drawn trailing-first so stitches stretching
    // toward the lead land on top
    const ordered = dir > 0 ? bandRows : [...bandRows].reverse()
    for (const row of ordered) {
      const lead = rowLead(row)
      const prof = profile(lead)
      const dispX = Math.round(
        g.sw * (0.5 + 2.4 * prof) * amt * chanGauss(seed, row, C + 'rowShift'),
      )
      drawRow(row, dispX, lead)
    }

    // pass 4: loose yarn arcs sagging across the working zone. Anchored
    // in band coordinates so they travel (and wrap) with the carriage;
    // sag and alpha scale with amount so they fade out, never pop.
    const arcN = 3 + Math.floor(chan(seed, 0, C + 'arcN') * 5)
    ctx.lineCap = 'round'
    for (let k = 0; k < arcN; k++) {
      const tA = 0.2 + 0.65 * chan(seed, k, C + 'arcT')
      const prof = profile(tA)
      const vis = clamp01(prof * amt * 2.2)
      if (vis <= 0.02) continue
      const rel = dir > 0 ? tA : 1 - tA
      const yA = bandTop + rel * bh
      const x0 = chan(seed, k, C + 'arcX') * W
      const span = (3 + 9 * chan(seed, k, C + 'arcSpan')) * g.sw
      const sag = amt * prof * (0.5 + 1.1 * chan(seed, k, C + 'arcSag')) * bh * 0.5
      const rowAt = Math.max(0, Math.min(g.rows - 1, Math.floor(yA / g.sh)))
      const yarn = bands[of[rowAt]].figure
      ctx.strokeStyle = rgbCss(scaleRgb(yarn, 0.95))
      ctx.lineWidth = Math.max(2, g.sw * 0.16)
      ctx.globalAlpha = vis
      for (const wrapY of [yA - H, yA, yA + H]) {
        if (wrapY + sag < -g.sh || wrapY - g.sh > H + g.sh) continue
        ctx.beginPath()
        ctx.moveTo(x0, wrapY)
        ctx.quadraticCurveTo(x0 + span / 2, wrapY + sag * 2, x0 + span, wrapY)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }

    // pass 5: the carriage's working edge — a thin shadow line at the
    // lead boundary, fading with amount
    const leadY = dir > 0 ? bandTop + bh : bandTop
    ctx.globalAlpha = clamp01(amt * 1.4) * 0.5
    ctx.fillStyle = void_
    const edgeH = Math.max(2, Math.round(g.sh * 0.3))
    for (const wrapY of [leadY - H, leadY, leadY + H]) {
      ctx.fillRect(0, Math.round(wrapY - edgeH / 2), W, edgeH)
    }
    ctx.globalAlpha = 1
  }

  ctx.restore()
}

// ---------------------------------------------------------------------------
// 3D material mode — a knit portrait of the captured frame
// ---------------------------------------------------------------------------

function renderLoomMaterial(ctx: CanvasRenderingContext2D, env: V2Env): void {
  const { outW: W, outH: H, seed } = env
  const g = fabricGauge(env, 12)
  const pool = buildYarnPool(env)
  const { of, bands } = buildBands(env, g.rows, pool, true)
  const tone = normalizedLuminance(env)
  const ground = hexToRgb(env.ground)

  ctx.save()
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = rgbCss(scaleRgb(ground, 0.4))
  ctx.fillRect(0, 0, W, H)

  // yarn ladder ground -> strongest ink, ordered by contrast so the
  // quantized portrait ramps monotonically; slot 0 is the band ground
  const ordered = [...pool].sort((a, b) => a.contrast - b.contrast)
  const ramp: RGB[] = [mixRgb(ground, ordered[0].rgb, 0.42)]
  for (const yarn of ordered) ramp.push(yarn.rgb)
  while (ramp.length < 3) ramp.push(scaleRgb(ramp[ramp.length - 1], 0.82))
  const levels = Math.min(6, ramp.length + 1) // 0 = band bg, 1.. = ramp

  const depth = env.depth ?? null
  const near: Field | null = depth ? (x, y) => 1 - depth(x, y) : null

  // per-cell tone, 2x2-sampled inside the stitch footprint
  const cellTone = (col: number, row: number): number => {
    const x = col * g.sw
    const y = row * g.sh
    return (
      (tone(x + g.sw * 0.28, y + g.sh * 0.28) +
        tone(x + g.sw * 0.72, y + g.sh * 0.28) +
        tone(x + g.sw * 0.28, y + g.sh * 0.72) +
        tone(x + g.sw * 0.72, y + g.sh * 0.72)) /
      4
    )
  }

  const yarnFor = (col: number, row: number, t: number): RGB => {
    const q = clamp01(t) * (levels - 1)
    let level = Math.floor(q)
    const fract = q - level
    const id = row * 4096 + (col & 4095)
    if (chan(seed, id, C + 'toneDither') < fract) level += 1
    if (level <= 0) {
      const band = bands[of[Math.max(0, Math.min(of.length - 1, row))]]
      if (
        band.lice &&
        (col + row * 4 + band.licePhase) % 9 === 0 &&
        chan(seed, id, C + 'lice') < 0.75
      ) {
        return band.lice
      }
      return band.bg
    }
    return ramp[Math.min(ramp.length - 1, level - 1)]
  }

  // draw in aligned 2x2 blocks: where the model is NEAR (depth pass
  // present), the block fuses into one chunky double-gauge stitch across
  // a chan-dithered boundary; otherwise four fine stitches. Depth null
  // degrades silently to the all-fine fabric.
  for (let bj = 0; bj * 2 < g.rows; bj++) {
    for (let bi = 0; bi * 2 < g.cols; bi++) {
      const col = bi * 2
      const row = bj * 2
      let chunky = false
      if (near) {
        const nx = (col + 1) * g.sw
        const ny = (row + 1) * g.sh
        const n = near(Math.min(W - 1, nx), Math.min(H - 1, ny))
        if (n > 0.03) {
          const bid = bj * 4096 + (bi & 4095)
          chunky = n > 0.42 + 0.34 * chan(seed, bid, C + 'chunk')
        }
      }
      if (chunky) {
        const t =
          (cellTone(col, row) +
            cellTone(col + 1, row) +
            cellTone(col, row + 1) +
            cellTone(col + 1, row + 1)) /
          4
        const yarn = yarnFor(col, row, t)
        const tile = yarnTile(g.sw * 2, g.sh * 2, yarn, shadeIndex(seed, col, row))
        ctx.drawImage(tile, col * g.sw, row * g.sh)
        continue
      }
      for (let dj = 0; dj < 2; dj++) {
        for (let di = 0; di < 2; di++) {
          const cc = col + di
          const rr = row + dj
          if (cc * g.sw > W || rr * g.sh > H) continue
          const yarn = yarnFor(cc, rr, cellTone(cc, rr))
          const tile = yarnTile(g.sw, g.sh, yarn, shadeIndex(seed, cc, rr))
          ctx.drawImage(tile, cc * g.sw, rr * g.sh)
        }
      }
    }
  }

  ctx.restore()
}
