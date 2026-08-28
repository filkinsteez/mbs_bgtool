import type { V2Env } from './system'
import { chan } from '@/core/organic/random'
import { hexToRgb, rgbCss, type RGB } from '@/core/lab/colorField'

// V2 'Mandala' — a pixel-mandala built entirely from small squares on a
// fixed lattice. Concentric irregular zones of palette color radiate from
// a near-center point: sparse scatter at the rim, then successively
// higher-contrast zones, then a solid near-black core. Two signature
// qualities from the reference:
//   (a) "gradient without a gradient" — every zone transition mixes the
//       two zone colors dot-by-dot with an ordered (Bayer 4x4) dither,
//       never by blending pixel values;
//   (b) chunky/blocky zone outlines — the radius field is evaluated once
//       per 3x3-dot block, so zone edges step in coarse pixel clusters,
//       warped by a k-fold (k = 5..9, seeded) angular wobble so the rings
//       are organic, not circular.

const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
]

function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function relLum([r, g, b]: RGB): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

export function renderMandala(ctx: CanvasRenderingContext2D, env: V2Env): void {
  const { outW, outH, seed, complexity } = env

  // ---- ground -----------------------------------------------------------
  ctx.fillStyle = env.ground
  ctx.fillRect(0, 0, outW, outH)

  const minDim = Math.min(outW, outH)
  if (minDim <= 0) return

  // ---- fixed square-dot lattice ----------------------------------------
  // pitch: minDim / (44 dots at complexity 0 → 96 at complexity 1)
  const dotsAcross = Math.round(44 + 52 * complexity)
  const p = minDim / dotsAcross
  const cols = Math.ceil(outW / p)
  const rows = Math.ceil(outH / p)

  // ---- seeded geometry --------------------------------------------------
  const cx = outW / 2 + (chan(seed, 0, 'v2.mandala.cx') * 2 - 1) * 0.08 * minDim
  const cy = outH / 2 + (chan(seed, 0, 'v2.mandala.cy') * 2 - 1) * 0.08 * minDim
  const k = 5 + Math.floor(chan(seed, 0, 'v2.mandala.k') * 5) // 5..9-fold symmetry
  const a1 = 0.08 + 0.04 * chan(seed, 0, 'v2.mandala.a1')
  const a2 = 0.04 + 0.02 * chan(seed, 0, 'v2.mandala.a2')
  // breathing wobble: phases shift by sin(2π·phase), exact loop, static at 0
  const breath = Math.sin(2 * Math.PI * env.motionPhase) * 0.35 * env.motionAmount
  const phi1 = chan(seed, 0, 'v2.mandala.phi1') * Math.PI * 2 + breath
  const phi2 = chan(seed, 0, 'v2.mandala.phi2') * Math.PI * 2 - breath
  // sized so the scatter fringe (t → -0.15, radius ≈ maxR·1.15·(1+a1+a2))
  // dies out inside the canvas even with the seeded center offset
  const maxR = 0.31 * minDim
  const k2 = k + 3

  // ---- zone ramp: palette ordered by contrast vs ground, ground excluded
  const nZones = complexity < 0.33 ? 3 : 4
  let ordered: string[] = []
  if (env.plan) {
    const groundIdx = env.plan.roles.ground
    ordered = env.plan.depthOrder
      .filter((i) => i !== groundIdx)
      .map((i) => env.plan!.swatches[i].hex)
  }
  if (ordered.length === 0) ordered = [env.ink]

  const zoneRgb: RGB[] = []
  for (let z = 0; z < nZones; z++) {
    if (ordered.length === 1) {
      // degrade: tonal ramp from near-ground toward ink
      const f = (z + 1) / nZones
      zoneRgb.push(mixRgb(hexToRgb(env.ground), hexToRgb(ordered[0]), 0.3 + 0.7 * f))
    } else {
      // spread the ordered swatches across the zones (fractional mix when
      // the palette has fewer swatches than zones)
      const pos = (z * (ordered.length - 1)) / (nZones - 1)
      const lo = Math.floor(pos)
      const hi = Math.min(ordered.length - 1, lo + 1)
      zoneRgb.push(mixRgb(hexToRgb(ordered[lo]), hexToRgb(ordered[hi]), pos - lo))
    }
  }
  const zoneCss = zoneRgb.map(rgbCss)

  // ---- BLOCKY t field: one evaluation per 3x3-dot block -----------------
  const bCols = Math.ceil(cols / 3)
  const bRows = Math.ceil(rows / 3)
  const blockT = new Float32Array(bCols * bRows)
  const lum = env.luminance
  const groundIsLight = relLum(hexToRgb(env.ground)) > 0.45
  for (let by = 0; by < bRows; by++) {
    for (let bx = 0; bx < bCols; bx++) {
      const X = (bx * 3 + 1.5) * p
      const Y = (by * 3 + 1.5) * p
      let t: number
      if (lum) {
        // 3D material mode: captured-frame tone drives the ramp instead of
        // the radial field (contrast-vs-ground direction)
        const l = lum(X, Y)
        const tone = groundIsLight ? 1 - l : l
        t = tone * 1.3 - 0.15
      } else {
        const dx = X - cx
        const dy = Y - cy
        const dist = Math.hypot(dx, dy)
        const th = Math.atan2(dy, dx)
        const wob = 1 + a1 * Math.cos(k * th + phi1) + a2 * Math.cos(k2 * th + phi2)
        t = 1 - (dist * wob) / maxR
      }
      blockT[by * bCols + bx] = t
    }
  }

  // ---- dots: bucket rects per zone color, then paint --------------------
  const buckets: number[][] = zoneCss.map(() => [])
  for (let iy = 0; iy < rows; iy++) {
    const bRow = ((iy / 3) | 0) * bCols
    const bayerRow = BAYER4[iy & 3]
    for (let ix = 0; ix < cols; ix++) {
      const t = blockT[bRow + ((ix / 3) | 0)]
      if (t <= -0.15) continue

      let zone: number
      if (t < 0) {
        // scatter fringe: probability fades 1 → 0 over t 0 → -0.15
        const prob = 1 + t / 0.15
        if (chan(seed, iy * 8192 + ix, 'v2.mandala.scatter') >= prob) continue
        zone = 0
      } else {
        const pos = Math.min(t, 0.999999) * nZones
        const z = Math.min(nZones - 1, pos | 0)
        const frac = pos - z
        // ordered dither between this zone's color and the next
        const threshold = (bayerRow[ix & 3] + 0.5) / 16
        zone = frac > threshold ? Math.min(nZones - 1, z + 1) : z
      }

      // dot grows toward the core; near-solid center (side → p)
      const tc = Math.max(0, Math.min(1, t))
      let side = Math.min(p, p * (0.45 + 0.55 * Math.pow(tc, 1.3)))
      // deep core: dots touch so the center reads solid
      if (t > 1 - 0.5 / nZones) side = p
      const half = side / 2
      buckets[zone].push((ix + 0.5) * p - half, (iy + 0.5) * p - half, side)
    }
  }

  for (let z = 0; z < nZones; z++) {
    const rects = buckets[z]
    if (!rects.length) continue
    ctx.fillStyle = zoneCss[z]
    for (let i = 0; i < rects.length; i += 3) {
      ctx.fillRect(rects[i], rects[i + 1], rects[i + 2], rects[i + 2])
    }
  }
}
