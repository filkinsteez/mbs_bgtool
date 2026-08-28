import type { V2Env } from './system'
import { chan } from '@/core/organic/random'
import { hexToRgb, type RGB } from '@/core/lab/colorField'

// 'Stitch' — a cross-stitch / perler-bead mosaic. A COARSE grid of chunky
// rounded squares, each carrying a smaller inner square of a strongly
// contrasting shade plus a pierced-center hole dot (the bead read). The
// mark's stroke runs 4-8 cells wide, so it reads as filled cell-masses,
// not an outline. Most color regions checker two tonal shades per-cell,
// so up close each patch looks like woven two-tone beadwork.
// Loud color regions (~3.5-cell features, dealt from the plan swatches
// plus tinted/shaded variants of each) cross the strokes; blob clusters
// fused to the mask edge bleed the silhouette outward so at a glance it
// is just a colorful mosaic — the mark emerges only when looked for.

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

// OKLab lightness, matching the scale of PlannedSwatch.lightness — plan
// swatches carry their own value; synthesized variants need the same
// measure so the adjacent-region contrast rule compares like with like.
function oklabL(c: RGB): number {
  const lin = (ch: number) => {
    const v = ch / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const r = lin(c[0])
  const g = lin(c[1])
  const b = lin(c[2])
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
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

  // Ground everywhere first — untouched outside ON cells.
  ctx.fillStyle = env.ground
  ctx.fillRect(0, 0, outW, outH)

  // 1. Grid: 11 cells across the min dimension at complexity 0 → 22 at 1.
  // Deliberately coarse so the mark's stroke spans 4-8 cells and reads as
  // chunky filled masses instead of a thin traced outline.
  const minDim = Math.min(outW, outH)
  const cellsAcross = Math.round(11 + 11 * complexity)
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

  const raw = new Uint8Array(cols * rows)
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if (form(centerX(i), centerY(j)) > threshold) raw[j * cols + i] = 1
    }
  }
  // Fatten the mark: its drawn stroke is only 1-2 cells wide at this
  // coarse grid, so dilate the mask ~2 cells until the stroke spans 4-8
  // cells and reads as chunky filled masses, not a traced outline.
  // (Captured-frame luminance is already massy — dilating it would only
  // smear the source detail, so it keeps the raw mask.)
  let mask = raw
  if (!lum) {
    mask = new Uint8Array(cols * rows)
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        if (raw[j * cols + i] !== 1) continue
        for (let dj = -2; dj <= 2; dj++) {
          for (let di = -2; di <= 2; di++) {
            if (di * di + dj * dj > 4) continue
            const ii = i + di
            const jj = j + dj
            if (ii >= 0 && jj >= 0 && ii < cols && jj < rows) mask[jj * cols + ii] = 1
          }
        }
      }
    }
  }
  let maskCells = 0
  for (let k = 0; k < mask.length; k++) maskCells += mask[k]

  const isMask = (i: number, j: number) =>
    i >= 0 && j >= 0 && i < cols && j < rows && mask[j * cols + i] === 1
  const anyMaskWithin = (i: number, j: number, r: number): boolean => {
    for (let dj = -r; dj <= r; dj++)
      for (let di = -r; di <= r; di++) if (isMask(i + di, j + dj)) return true
    return false
  }

  // 3. Camouflage blobs, ~30% of the mask area: most clusters are FUSED
  // to the mask — centered just outside its edge so their lobes straddle
  // the boundary and the silhouette bleeds outward — plus a couple of
  // detached islands (loop counters and open ground). Each cluster is
  // 1-3 overlapping ellipse lobes.
  const blobCount = 5 + Math.floor(chan(seed, 20, 'v2.stitch.blobCount') * 1.999)
  const fusedCount = blobCount - 2
  const targetArea =
    maskCells > 0
      ? maskCells * (0.28 + 0.06 * chan(seed, 21, 'v2.stitch.blobArea'))
      : cols * rows * 0.12
  const blobs: Blob[] = []
  for (let b = 0; b < blobCount; b++) {
    const fused = maskCells > 0 && b < fusedCount
    let cx = -1
    let cy = -1
    for (let attempt = 0; attempt < 24; attempt++) {
      const id = b * 32 + attempt
      const tryX = (0.04 + 0.92 * chan(seed, id, 'v2.stitch.blobX')) * cols
      const tryY = (0.04 + 0.92 * chan(seed, id, 'v2.stitch.blobY')) * rows
      if (maskCells > 0) {
        const ci = Math.floor(tryX)
        const cj = Math.floor(tryY)
        if (isMask(ci, cj)) continue // center always sits off the mark
        // fused clusters hug the mask edge (a loop counter qualifies —
        // bleeding there breaks the silhouette read hardest); islands
        // stay clearly away from it
        if (fused ? !anyMaskWithin(ci, cj, 2) : anyMaskWithin(ci, cj, 3)) continue
      }
      cx = tryX
      cy = tryY
      break
    }
    if (cx < 0) continue
    const lobes = 1 + Math.floor(chan(seed, b, 'v2.stitch.blobLobes') * 2.999)
    for (let l = 0; l < lobes; l++) {
      const id = b * 32 + l * 4 + 1
      blobs.push({
        cx: cx + (chan(seed, id, 'v2.stitch.lobeDX') - 0.5) * 3 * (l > 0 ? 1 : 0),
        cy: cy + (chan(seed, id, 'v2.stitch.lobeDY') - 0.5) * 3 * (l > 0 ? 1 : 0),
        rx: 1.5 + chan(seed, id, 'v2.stitch.blobRx') * 2.5,
        ry: 1.5 + chan(seed, id, 'v2.stitch.blobRy') * 2.5,
      })
    }
  }
  if (blobs.length > 0) {
    let area = 0
    for (const blob of blobs) area += Math.PI * blob.rx * blob.ry
    // lobes overlap each other, and fused lobes overlap the mask itself,
    // so budget extra raw ellipse area to land near the visible target
    const scale = Math.max(0.3, Math.min(4, Math.sqrt((targetArea * 1.4) / Math.max(1e-6, area))))
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

  const shadeNoise = cellNoise(seed, 'v2.stitch.shadeN', 7)

  const white: RGB = [255, 255, 255]
  const black: RGB = [0, 0, 0]

  // Region pool: every enabled non-ground plan swatch PLUS two synthesized
  // variants of each — 30% toward white and 30% toward black — so the
  // regions block loudly in value even when the user's mix is three blues.
  type BaseSwatch = { rgb: RGB; weight: number; lightness: number }
  let bases: BaseSwatch[]
  if (env.plan) {
    const groundRole = env.plan.roles.ground
    const all = env.plan.swatches.map((s, index) => ({
      rgb: hexToRgb(s.hex),
      weight: Math.max(0.05, s.weight),
      lightness: s.lightness,
      index,
    }))
    const nonGround = all.filter((s) => s.index !== groundRole)
    bases = (nonGround.length >= 2 ? nonGround : all).map(({ rgb, weight, lightness }) => ({
      rgb,
      weight,
      lightness,
    }))
  } else if (env.palette.length > 0) {
    bases = env.palette.map((hex) => {
      const rgb = hexToRgb(hex)
      return { rgb, weight: 1, lightness: oklabL(rgb) }
    })
  } else {
    const rgb = hexToRgb(env.ink)
    bases = [{ rgb, weight: 1, lightness: oklabL(rgb) }]
  }

  type PoolEntry = { rgb: RGB; weight: number; base: number; lightness: number }
  const pool: PoolEntry[] = []
  bases.forEach((s, base) => {
    const tinted = mix(s.rgb, white, 0.3)
    const shaded = mix(s.rgb, black, 0.3)
    pool.push({ rgb: s.rgb, weight: s.weight * 0.4, base, lightness: s.lightness })
    pool.push({ rgb: tinted, weight: s.weight * 0.3, base, lightness: oklabL(tinted) })
    pool.push({ rgb: shaded, weight: s.weight * 0.3, base, lightness: oklabL(shaded) })
  })
  const totalWeight = pool.reduce((sum, s) => sum + s.weight, 0)
  const weightedPick = (r: number): number => {
    let acc = 0
    const target = r * totalWeight
    for (let k = 0; k < pool.length; k++) {
      acc += pool[k].weight
      if (target < acc) return k
    }
    return pool.length - 1
  }

  // 4. Regions: a jittered-site mosaic. Sites sit on a ~3.5-cell lattice
  // (plus a pad ring past every edge) and each bead belongs to its
  // nearest site, so colors block into organic ~3.5-cell patches and
  // several distinct regions cross each stroke of the fattened mark.
  // Colors are dealt per site by weight; a site must differ from its
  // west and north neighbors by >=0.12 OKLab lightness or come from a
  // different base swatch, so every region change reads LOUD.
  const REG = 3.5
  const gcols = Math.ceil(cols / REG) + 3
  const grows = Math.ceil(rows / REG) + 3
  const siteX = new Float64Array(gcols * grows)
  const siteY = new Float64Array(gcols * grows)
  const siteColor = new Int32Array(gcols * grows)
  const siteTowardWhite = new Uint8Array(gcols * grows)
  const sitePartner = new Int32Array(gcols * grows)
  const siteChecker = new Uint8Array(gcols * grows)
  for (let gj = 0; gj < grows; gj++) {
    for (let gi = 0; gi < gcols; gi++) {
      const si = gj * gcols + gi
      siteX[si] = (gi - 1 + 0.15 + 0.7 * chan(seed, si, 'v2.stitch.siteX')) * REG
      siteY[si] = (gj - 1 + 0.15 + 0.7 * chan(seed, si, 'v2.stitch.siteY')) * REG
      let idx = weightedPick(chan(seed, si, 'v2.stitch.deal'))
      if (pool.length > 1) {
        const west = gi > 0 ? pool[siteColor[si - 1]] : null
        const north = gj > 0 ? pool[siteColor[si - gcols]] : null
        const loud = (k: number): boolean => {
          const cand = pool[k]
          const differs = (p: PoolEntry | null) =>
            !p || cand.base !== p.base || Math.abs(cand.lightness - p.lightness) >= 0.12
          return differs(west) && differs(north)
        }
        for (let attempt = 0; attempt < 8 && !loud(idx); attempt++) {
          idx = weightedPick(chan(seed, si * 16 + attempt + 1, 'v2.stitch.redeal'))
        }
        if (!loud(idx)) {
          for (let step = 1; step < pool.length; step++) {
            const k = (idx + step) % pool.length
            if (loud(k)) {
              idx = k
              break
            }
          }
        }
      }
      siteColor[si] = idx
      // Per-region shading parity: this region's cells drift toward
      // white or toward black ("gradient within the shape").
      siteTowardWhite[si] =
        chan(seed, si, 'v2.stitch.parity') < (relLum(pool[idx].rgb) < 0.45 ? 0.7 : 0.3) ? 1 : 0
      // Within-region checkerboard: every region carries a shade PAIR —
      // the dealt primary plus a partner from the pool — and ~60% of
      // regions alternate the two per-cell in a checker. The partner is
      // normally a TONAL NEIGHBOR (the primary's own base swatch at a
      // different 30% tint/shade step) so checkered regions read as woven
      // two-tone cloth; a seeded few instead pair the pool entry farthest
      // away in lightness, giving each canvas some high-contrast accent
      // patches. Partners never affect the adjacent-region loudness rule
      // above — that is judged on primaries, and tonal partners hug their
      // primary, so the >=0.12 region-to-region separation still reads.
      let partner = idx
      if (pool.length > 1) {
        const b3 = pool[idx].base * 3
        if (chan(seed, si, 'v2.stitch.accent') < 0.14) {
          let bestGap = -1
          for (let k = 0; k < pool.length; k++) {
            const gap = Math.abs(pool[k].lightness - pool[idx].lightness)
            if (gap > bestGap) {
              bestGap = gap
              partner = k
            }
          }
        } else if (idx === b3) {
          partner = b3 + 1 + (chan(seed, si, 'v2.stitch.pairPick') < 0.5 ? 0 : 1)
        } else {
          partner = b3
        }
        // A near-invisible pair (a base whose 30% variant barely moves in
        // lightness) upgrades to the base's other variant, keeping the
        // checker legible while staying inside the same swatch family.
        if (
          partner !== idx &&
          pool[partner].base === pool[idx].base &&
          Math.abs(pool[partner].lightness - pool[idx].lightness) < 0.055
        ) {
          const alt = b3 + 1 + (partner === b3 + 1 ? 1 : 0)
          if (
            alt !== idx &&
            Math.abs(pool[alt].lightness - pool[idx].lightness) >
              Math.abs(pool[partner].lightness - pool[idx].lightness)
          ) {
            partner = alt
          }
        }
      }
      sitePartner[si] = partner
      siteChecker[si] = partner !== idx && chan(seed, si, 'v2.stitch.checker') < 0.6 ? 1 : 0
    }
  }
  // Nearest site for a bead at cell-space (u, v); the low bit of the
  // return flags a fringe bead sitting on the seam between two regions.
  const regionAt = (u: number, v: number): number => {
    const tgi = Math.floor(u / REG) + 1
    const tgj = Math.floor(v / REG) + 1
    let best = Infinity
    let second = Infinity
    let bestSi = 0
    for (let dj = -1; dj <= 1; dj++) {
      const gj = tgj + dj
      if (gj < 0 || gj >= grows) continue
      for (let di = -1; di <= 1; di++) {
        const gi = tgi + di
        if (gi < 0 || gi >= gcols) continue
        const si = gj * gcols + gi
        const dx = u - siteX[si]
        const dy = v - siteY[si]
        const d = dx * dx + dy * dy
        if (d < best) {
          second = best
          best = d
          bestSi = si
        } else if (d < second) {
          second = d
        }
      }
    }
    const fringe = Math.sqrt(second) - Math.sqrt(best) < 0.35
    return bestSi * 2 + (fringe ? 1 : 0)
  }

  const groundRgb = hexToRgb(env.ground)

  // Motion: a very subtle whole-grid shimmer — the shade-noise sample
  // point slides by sin(2π·phase)·0.3·amount cells. Exactly loops; static
  // at motionAmount 0.
  const shimmer = Math.sin(2 * Math.PI * env.motionPhase) * 0.3 * env.motionAmount

  // 5. Paint ON cells: outer rounded square inset 5%, then the inner
  // contrast square — 55% toward black in light cells, 55% toward white
  // in dark cells.
  const inset = 0.05 * c
  const outer = c - inset * 2
  const outerR = 0.2 * c
  const inner = 0.42 * c
  const innerR = 0.1 * c
  // Bead hole: pierced-center dot, ~0.14c across. Skipped entirely when
  // cells run small (fine grids would just muddy), and mixed less hard at
  // low complexity so big beads stay calm.
  const holeR = 0.07 * c
  const drawHoles = c >= 14
  const holeMix = 0.72 + 0.2 * complexity

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const cellId = j * 8192 + i
      const inMask = mask[j * cols + i] === 1
      // drop ~5% of interior mask cells and bite harder into boundary
      // cells so the form's edge crumbles instead of tracing a clean
      // outline; blob-only cells are more porous still, so on inspection
      // the solid mark masses separate from their camouflage satellites
      const dropRate = inMask
        ? !isMask(i - 1, j) || !isMask(i + 1, j) || !isMask(i, j - 1) || !isMask(i, j + 1)
          ? 0.12 + 0.12 * complexity
          : 0.05
        : 0.2
      const on =
        (inMask || inBlob(i, j)) && chan(seed, cellId, 'v2.stitch.drop') >= dropRate
      if (!on) continue

      const u = i + 0.5
      const v = j + 0.5
      const region = regionAt(u, v)
      const si = region >> 1
      const fringe = (region & 1) === 1

      // Checkered regions alternate the pair by cell parity; noise
      // shading nearly vanishes there so the two tones stay crisp.
      // Solid regions keep the full noise drift as before.
      const checker = siteChecker[si] === 1
      const entryIdx = checker && ((i + j) & 1) === 1 ? sitePartner[si] : siteColor[si]
      const base = pool[entryIdx].rgb
      const shade = shadeNoise(u + shimmer, v) * (checker ? 0.05 : 0.2)
      let cell = mix(base, siteTowardWhite[si] === 1 ? white : black, shade)
      if (fringe) cell = mix(cell, groundRgb, 0.45)

      const x = x0 + i * c + inset
      const y = y0 + j * c + inset
      ctx.fillStyle = css(cell)
      roundedRect(ctx, x, y, outer, outer, outerR)
      ctx.fill()

      const dark = relLum(cell) <= 0.5
      const innerColor = dark ? mix(cell, white, 0.55) : mix(cell, black, 0.55)
      ctx.fillStyle = css(innerColor)
      roundedRect(ctx, x0 + i * c + (c - inner) / 2, y0 + j * c + (c - inner) / 2, inner, inner, innerR)
      ctx.fill()

      // The pierced-bead hole rides on top of the inner square — pushed
      // toward white in dark cells and toward black in light ones, one
      // step past the inner square's own flip.
      if (drawHoles) {
        ctx.fillStyle = css(dark ? mix(cell, white, holeMix) : mix(cell, black, holeMix))
        ctx.beginPath()
        ctx.arc(centerX(i), centerY(j), holeR, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
}
