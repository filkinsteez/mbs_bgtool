import type { V2Env } from './system'
import { chan } from '@/core/organic/random'
import { hexToRgb, type RGB } from '@/core/lab/colorField'

// 'Stitch' — a cross-stitch / perler-bead mosaic. A coarse grid of chunky
// rounded squares, each carrying a smaller inner square of a contrasting
// shade (the double-square bead read). Cells cluster into color regions
// dealt from the palette; the regions tile the Meta mark so it stays
// barely legible, while stray elliptical blob clusters and a crumbled
// mask edge camouflage it into "just a colorful mosaic" at a glance.

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function css(c: RGB): string {
  return `rgb(${Math.round(c[0])} ${Math.round(c[1])} ${Math.round(c[2])})`
}

function relLum(c: RGB): number {
  return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255
}

// Smooth seeded lattice noise over CELL space, cosine-eased bilinear.
// feature = feature size in cells.
function cellNoise(seed: number, channel: string, feature: number): (u: number, v: number) => number {
  const smooth = (t: number) => t * t * (3 - 2 * t)
  const inv = 1 / Math.max(1, feature)
  return (u, v) => {
    const x = u * inv
    const y = v * inv
    const i0 = Math.floor(x)
    const j0 = Math.floor(y)
    const fu = smooth(x - i0)
    const fv = smooth(y - j0)
    const val = (i: number, j: number) =>
      chan(seed, ((j & 1023) + 512) * 4096 + ((i & 1023) + 512), channel)
    const top = val(i0, j0) * (1 - fu) + val(i0 + 1, j0) * fu
    const bot = val(i0, j0 + 1) * (1 - fu) + val(i0 + 1, j0 + 1) * fu
    return top * (1 - fv) + bot * fv
  }
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

type Blob = { cx: number; cy: number; rx: number; ry: number }

export function renderStitch(ctx: CanvasRenderingContext2D, env: V2Env): void {
  const { outW, outH, seed } = env
  const complexity = clamp01(env.complexity)

  // 6. Ground everywhere first — untouched outside ON cells.
  ctx.fillStyle = env.ground
  ctx.fillRect(0, 0, outW, outH)

  // 1. Grid: 16 cells across the min dimension at complexity 0 → 34 at 1.
  const minDim = Math.min(outW, outH)
  const cellsAcross = Math.round(16 + 18 * complexity)
  const c = minDim / cellsAcross
  const cols = Math.ceil(outW / c)
  const rows = Math.ceil(outH / c)
  const x0 = (outW - cols * c) / 2
  const y0 = (outH - rows * c) / 2

  // 2. Underlying form: the Meta mark (canonical placement), or the
  // captured frame's luminance when in 3D material mode.
  const lum = env.luminance
  const form = lum ?? env.symbolField()
  const threshold = lum ? 0.45 : 0.5
  const centerX = (i: number) => x0 + (i + 0.5) * c
  const centerY = (j: number) => y0 + (j + 0.5) * c

  const mask = new Uint8Array(cols * rows)
  let maskCells = 0
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if (form(centerX(i), centerY(j)) > threshold) {
        mask[j * cols + i] = 1
        maskCells++
      }
    }
  }

  // 3. Camouflage blobs: 4-6 seeded clusters OUTSIDE the mask (each 1-3
  // overlapping ellipse lobes so they read like stray mark fragments),
  // together ~18-24% of the mask area (fallback footprint with no mark).
  const blobCount = 5 + Math.floor(chan(seed, 20, 'v2.stitch.blobCount') * 1.999)
  const targetArea =
    maskCells > 0
      ? maskCells * (0.2 + 0.06 * chan(seed, 21, 'v2.stitch.blobArea'))
      : cols * rows * 0.1
  const blobs: Blob[] = []
  for (let b = 0; b < blobCount; b++) {
    let cx = -1
    let cy = -1
    for (let attempt = 0; attempt < 16; attempt++) {
      const id = b * 32 + attempt
      const tryX = (0.04 + 0.92 * chan(seed, id, 'v2.stitch.blobX')) * cols
      const tryY = (0.04 + 0.92 * chan(seed, id, 'v2.stitch.blobY')) * rows
      // keep the cluster center clearly off the mark, not hugging its edge
      // (loop interiors qualify too — a blob inside a counter breaks the
      // silhouette read hardest)
      if (form(x0 + tryX * c, y0 + tryY * c) > threshold * 0.3) continue
      cx = tryX
      cy = tryY
      break
    }
    if (cx < 0) continue
    const lobes = 1 + Math.floor(chan(seed, b, 'v2.stitch.blobLobes') * 2.999)
    for (let l = 0; l < lobes; l++) {
      const id = b * 32 + l * 4 + 1
      blobs.push({
        cx: cx + (chan(seed, id, 'v2.stitch.lobeDX') - 0.5) * 4 * (l > 0 ? 1 : 0),
        cy: cy + (chan(seed, id, 'v2.stitch.lobeDY') - 0.5) * 4 * (l > 0 ? 1 : 0),
        rx: 1.6 + chan(seed, id, 'v2.stitch.blobRx') * 3.4,
        ry: 1.6 + chan(seed, id, 'v2.stitch.blobRy') * 3.4,
      })
    }
  }
  if (blobs.length > 0) {
    let area = 0
    for (const blob of blobs) area += Math.PI * blob.rx * blob.ry
    // lobes overlap, so budget a little extra raw ellipse area
    const scale = Math.max(0.5, Math.min(4, Math.sqrt((targetArea * 1.4) / Math.max(1e-6, area))))
    for (const blob of blobs) {
      blob.rx *= scale
      blob.ry *= scale
    }
  }
  const inBlob = (i: number, j: number): boolean => {
    const u = i + 0.5
    const v = j + 0.5
    for (const blob of blobs) {
      const dx = (u - blob.cx) / blob.rx
      const dy = (v - blob.cy) / blob.ry
      if (dx * dx + dy * dy <= 1) return true
    }
    return false
  }

  // 4. Regions: coarse smooth noise (~6-cell features) quantized into 5-8
  // levels; each level is dealt one color from the enabled swatches by
  // weight, adjacent levels forced to differ.
  const levels = 5 + Math.floor(chan(seed, 30, 'v2.stitch.levels') * 3.999)
  const regionNoise = cellNoise(seed, 'v2.stitch.region', 6)
  const shadeNoise = cellNoise(seed, 'v2.stitch.shadeN', 9)

  type Swatch = { rgb: RGB; weight: number }
  let swatches: Swatch[]
  if (env.plan) {
    const groundRole = env.plan.roles.ground
    const all = env.plan.swatches.map((s, index) => ({
      rgb: hexToRgb(s.hex),
      weight: Math.max(0.05, s.weight),
      index,
    }))
    const nonGround = all.filter((s) => s.index !== groundRole)
    swatches = (nonGround.length >= 2 ? nonGround : all).map(({ rgb, weight }) => ({ rgb, weight }))
  } else if (env.palette.length > 0) {
    swatches = env.palette.map((hex) => ({ rgb: hexToRgb(hex), weight: 1 }))
  } else {
    swatches = [{ rgb: hexToRgb(env.ink), weight: 1 }]
  }
  const totalWeight = swatches.reduce((sum, s) => sum + s.weight, 0)
  const weightedPick = (r: number): number => {
    let acc = 0
    const target = r * totalWeight
    for (let k = 0; k < swatches.length; k++) {
      acc += swatches[k].weight
      if (target < acc) return k
    }
    return swatches.length - 1
  }

  const levelSwatch: number[] = []
  for (let l = 0; l < levels; l++) {
    let idx = weightedPick(chan(seed, l, 'v2.stitch.deal'))
    if (l > 0 && swatches.length > 1 && idx === levelSwatch[l - 1]) {
      idx = (idx + 1 + Math.floor(chan(seed, l, 'v2.stitch.redeal') * (swatches.length - 1))) % swatches.length
      if (idx === levelSwatch[l - 1]) idx = (idx + 1) % swatches.length
    }
    levelSwatch.push(idx)
  }
  const levelColor = levelSwatch.map((idx) => swatches[idx].rgb)
  // Per-region shading parity: this region's cells drift toward white
  // or toward black across the region ("gradient within the shape").
  const levelTowardWhite = levelColor.map(
    (rgb, l) => chan(seed, l, 'v2.stitch.parity') < (relLum(rgb) < 0.45 ? 0.7 : 0.3),
  )

  const groundRgb = hexToRgb(env.ground)
  const white: RGB = [255, 255, 255]
  const black: RGB = [0, 0, 0]

  // 7. Motion: a very subtle whole-grid shimmer — the shade-noise sample
  // point slides by sin(2π·phase)·0.3·amount cells. Exactly loops; static
  // at motionAmount 0.
  const shimmer = Math.sin(2 * Math.PI * env.motionPhase) * 0.3 * env.motionAmount

  // 5. Paint ON cells: outer rounded square inset 5%, then the inner
  // contrast square — darker in light cells, lighter in dark cells.
  const inset = 0.05 * c
  const outer = c - inset * 2
  const outerR = 0.2 * c
  const inner = 0.42 * c
  const innerR = 0.1 * c

  // Drop ~6% of interior mask cells, and bite much harder into boundary
  // cells so the form's edge crumbles instead of tracing a clean outline.
  const isMask = (i: number, j: number) =>
    i >= 0 && j >= 0 && i < cols && j < rows && mask[j * cols + i] === 1

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const cellId = j * 8192 + i
      const inMask = mask[j * cols + i] === 1
      let dropped = false
      if (inMask) {
        const boundary =
          !isMask(i - 1, j) || !isMask(i + 1, j) || !isMask(i, j - 1) || !isMask(i, j + 1)
        // at coarse grids the strokes are 1-2 cells wide and almost every
        // cell is a boundary cell, so scale the edge bite with complexity
        dropped = chan(seed, cellId, 'v2.stitch.drop') < (boundary ? 0.14 + 0.18 * complexity : 0.06)
      }
      const on = (inMask && !dropped) || inBlob(i, j)
      if (!on) continue

      const u = i + 0.5
      const v = j + 0.5
      const q = regionNoise(u, v)
      const level = Math.min(levels - 1, Math.floor(q * levels))
      const frac = q * levels - level
      const fringe = frac < 0.08 || frac > 0.92

      const base = levelColor[level]
      const shade = shadeNoise(u + shimmer, v) * 0.25
      let cell = mix(base, levelTowardWhite[level] ? white : black, shade)
      if (fringe) cell = mix(cell, groundRgb, 0.45)

      const x = x0 + i * c + inset
      const y = y0 + j * c + inset
      ctx.fillStyle = css(cell)
      roundedRect(ctx, x, y, outer, outer, outerR)
      ctx.fill()

      const innerColor = relLum(cell) > 0.5 ? mix(cell, black, 0.4) : mix(cell, white, 0.4)
      ctx.fillStyle = css(innerColor)
      roundedRect(ctx, x0 + i * c + (c - inner) / 2, y0 + j * c + (c - inner) / 2, inner, inner, innerR)
      ctx.fill()
    }
  }
}
