import type { V2Env } from './system'
import { chan } from '@/core/organic/random'
import { hexToRgb, rgbCss, type RGB } from '@/core/lab/colorField'

// V2 'Mandala' — a pixel-mandala built entirely from small squares on a
// fixed lattice. Concentric irregular ZONES of palette color radiate from
// a near-center point: sparse scatter at the rim, then successively
// higher-contrast solid zones, then a solid near-core. Signature qualities
// from the reference:
//   (a) distinct zones — a dot deep inside a zone paints exactly that
//       zone's color; the two adjacent zone colors interleave dot-by-dot
//       (ordered Bayer 4x4 dither) ONLY inside a narrow boundary band, so
//       the transitions read as pixel-mixing, never as a smooth gradient;
//   (b) chunky/blocky zone outlines — the radius field is evaluated once
//       per 4x4-dot block, so zone edges step in coarse pixel clusters,
//       warped by a k-fold (k = 5..9, seeded) angular wobble so the rings
//       are organic, not circular.

const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
]

// half-width of the dithered boundary band, in zone-fraction units
const BAND = 0.18
// t-range of the stochastic scatter fringe outside zone 0
const FRINGE = 0.15

function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function relLum([r, g, b]: RGB): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

// OKLab lightness of an sRGB color — same scale as plan swatch .lightness
function oklabL([r, g, b]: RGB): number {
  const lin = (c: number) => {
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const R = lin(r)
  const G = lin(g)
  const B = lin(b)
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
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
  const cx = outW / 2 + (chan(seed, 0, 'v2.mandala.cx') * 2 - 1) * 0.05 * minDim
  const cy = outH / 2 + (chan(seed, 0, 'v2.mandala.cy') * 2 - 1) * 0.05 * minDim
  const k = 5 + Math.floor(chan(seed, 0, 'v2.mandala.k') * 5) // 5..9-fold symmetry
  const a1 = 0.12 + 0.04 * chan(seed, 0, 'v2.mandala.a1') // ~0.14: unmistakable steps
  const a2 = 0.04 + 0.02 * chan(seed, 0, 'v2.mandala.a2')
  // breathing wobble: phases shift by sin(2π·phase), exact loop, static at 0
  const breath = Math.sin(2 * Math.PI * env.motionPhase) * 0.35 * env.motionAmount
  const phi1 = chan(seed, 0, 'v2.mandala.phi1') * Math.PI * 2 + breath
  const phi2 = chan(seed, 0, 'v2.mandala.phi2') * Math.PI * 2 - breath
  // the mandala dominates the frame: zone-0 rim at ~0.6·minDim, clipping
  // top/bottom slightly. Only on the LONG axis must the scatter fringe
  // (t → -FRINGE, worst-case radius (1+FRINGE)·maxR / min wobble) still
  // die out before the canvas edge — clamp maxR to guarantee it.
  const wobMin = 1 - a1 - a2
  const halfLong = outW >= outH ? Math.min(cx, outW - cx) : Math.min(cy, outH - cy)
  const maxR = Math.min(0.6 * minDim, (halfLong * wobMin) / (1 + FRINGE))
  const k2 = k + 3

  // ---- zone ramp: palette ordered by contrast vs ground, ground excluded
  const nZones = complexity < 0.33 ? 3 : 4
  const groundRgb = hexToRgb(env.ground)
  const orderedRgb: RGB[] = []
  const orderedL: number[] = []
  if (env.plan) {
    const groundIdx = env.plan.roles.ground
    for (const i of env.plan.depthOrder) {
      if (i === groundIdx) continue
      orderedRgb.push(hexToRgb(env.plan.swatches[i].hex))
      orderedL.push(env.plan.swatches[i].lightness)
    }
  }
  if (orderedRgb.length === 0) {
    const inkRgb = hexToRgb(env.ink)
    orderedRgb.push(inkRgb)
    orderedL.push(oklabL(inkRgb))
  }

  const zoneRgb: RGB[] = []
  const zoneL: number[] = []
  for (let z = 0; z < nZones; z++) {
    if (orderedRgb.length === 1) {
      // degrade: tonal ramp from near-ground toward ink
      const f = (z + 1) / nZones
      const rgb = mixRgb(groundRgb, orderedRgb[0], 0.3 + 0.7 * f)
      zoneRgb.push(rgb)
      zoneL.push(oklabL(rgb))
    } else {
      // spread the ordered swatches across the zones (fractional mix when
      // the palette has fewer swatches than zones)
      const pos = (z * (orderedRgb.length - 1)) / (nZones - 1)
      const lo = Math.floor(pos)
      const hi = Math.min(orderedRgb.length - 1, lo + 1)
      zoneRgb.push(mixRgb(orderedRgb[lo], orderedRgb[hi], pos - lo))
      zoneL.push(orderedL[lo] + (orderedL[hi] - orderedL[lo]) * (pos - lo))
    }
  }

  // ---- separation pass: monochrome packs collapse adjacent zones --------
  // Wherever two adjacent zones sit closer than 0.10 in OKLab lightness,
  // synthesize separation: pull the outer member 25-40% toward the ground,
  // or push the core toward the white/black pole opposite the ground's
  // lightness, so three-blues mixes still read as distinct rings.
  const groundL = oklabL(groundRgb)
  const poleRgb: RGB = groundL > 0.5 ? [0, 0, 0] : [255, 255, 255]
  for (let z = nZones - 2; z >= 0; z--) {
    const gap = Math.abs(zoneL[z + 1] - zoneL[z])
    if (gap >= 0.1) continue
    const f = 0.25 + 0.15 * (1 - gap / 0.1) // deficit-scaled, 25%..40%
    if (z + 1 === nZones - 1) {
      zoneRgb[z + 1] = mixRgb(zoneRgb[z + 1], poleRgb, f)
      zoneL[z + 1] = oklabL(zoneRgb[z + 1])
    }
    // re-measure (the core may have moved), then fix the outer member
    if (Math.abs(zoneL[z + 1] - zoneL[z]) < 0.1) {
      zoneRgb[z] = mixRgb(zoneRgb[z], groundRgb, f)
      zoneL[z] = oklabL(zoneRgb[z])
    }
  }
  const zoneCss = zoneRgb.map(rgbCss)

  // ---- BLOCKY t field: one evaluation per 4x4-dot block -----------------
  const bCols = Math.ceil(cols / 4)
  const bRows = Math.ceil(rows / 4)
  const blockT = new Float32Array(bCols * bRows)
  const lum = env.luminance
  const groundIsLight = relLum(groundRgb) > 0.45
  for (let by = 0; by < bRows; by++) {
    for (let bx = 0; bx < bCols; bx++) {
      const X = (bx * 4 + 2) * p
      const Y = (by * 4 + 2) * p
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
    const bRow = (iy >> 2) * bCols
    const bayerRow = BAYER4[iy & 3]
    for (let ix = 0; ix < cols; ix++) {
      const t = blockT[bRow + (ix >> 2)]
      if (t <= -FRINGE) continue

      let zone: number
      if (t < 0) {
        // scatter fringe: probability fades 1 → 0 over t 0 → -FRINGE
        const prob = 1 + t / FRINGE
        if (chan(seed, iy * 8192 + ix, 'v2.mandala.scatter') >= prob) continue
        zone = 0
      } else {
        const pos = Math.min(t, 0.999999) * nZones
        let z = Math.min(nZones - 1, pos | 0)
        const frac = pos - z
        // SOLID interiors; ordered dither only inside the ±BAND boundary
        // band, interleaving the two adjacent zone colors dot-by-dot
        if (frac > 1 - BAND && z < nZones - 1) {
          const u = (frac - (1 - BAND)) / (2 * BAND) // 0 → 0.5 nearing the edge
          if (u > (bayerRow[ix & 3] + 0.5) / 16) z += 1
        } else if (frac < BAND && z > 0) {
          const u = 0.5 + frac / (2 * BAND) // 0.5 → 1 leaving the edge
          if (u <= (bayerRow[ix & 3] + 0.5) / 16) z -= 1
        }
        zone = z
      }

      // dot size steps PER ZONE (flat density inside each ring, so the
      // interiors read solid), growing toward a merged core. Dither-band
      // dots take their painted zone's size, so boundaries interleave in
      // both color and scale.
      let side: number
      if (t < 0) {
        side = 0.45 * p // delicate scatter fringe
      } else if (zone === nZones - 1) {
        // core ring: hairline grid seams, fully merged deep inside
        side = t > 1 - 0.5 / nZones ? p : 0.92 * p
      } else {
        side = p * (0.5 + 0.5 * Math.pow((zone + 1) / nZones, 1.2))
      }
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
