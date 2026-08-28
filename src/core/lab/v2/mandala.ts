import { motionHarmonic, type V2Env } from './system'
import type { Field } from '../field'
import { chan } from '@/core/organic/random'
import { hexToRgb, rgbCss, type RGB } from '@/core/lab/colorField'

// V2 'Mandala' — a pixel-mandala built entirely from small squares on a
// fixed lattice. Concentric irregular ZONES of palette color emanate from
// the MARK'S FORM: the symbol's graded distance field (rendered very soft,
// oversized and off-center so the mark is cropped by the frame) drives the
// zone ramp — sparse scatter at the far rim, then successively
// higher-contrast solid contour bands hugging the mark's silhouette, then
// a solid core inside/along the mark itself. An angular wobble perturbs
// the ramp so the outline never renders cleanly — the mark is felt
// everywhere, readable nowhere. Signature qualities from the reference:
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
  const phi1 = chan(seed, 0, 'v2.mandala.phi1') * Math.PI * 2
  const phi2 = chan(seed, 0, 'v2.mandala.phi2') * Math.PI * 2
  const k2 = k + 3
  // Motion: the angular wobble PRECESSES — each harmonic crossfades between
  // its static crest pattern and a copy that rotates a whole number of turns
  // per loop (the finer k2 harmonic counter-rotates, so the crests shear past
  // each other instead of turning as a rigid disk). At phase 0/1 the rotated
  // copy coincides with the static pattern (h is an integer), and at
  // motionAmount 0 the crossfade collapses to the static term — both give a
  // frame byte-identical to the static render.
  const amt = env.motionAmount
  const h = motionHarmonic(env)
  const prec = 2 * Math.PI * env.motionPhase * h
  const wobble = (th: number): number =>
    a1 * ((1 - amt) * Math.cos(k * th + phi1) + amt * Math.cos(k * th + phi1 + prec)) +
    a2 * ((1 - amt) * Math.cos(k2 * th + phi2) + amt * Math.cos(k2 * th + phi2 - prec))

  // ---- the mark's graded field drives the zone ramp ---------------------
  // Oversized, pushed off-center along a seeded direction and gently
  // tilted, so a partial/cropped mark anchors the composition; very high
  // softness turns the silhouette into a wide smooth gradient whose level
  // sets become the contour bands.
  const fScale = 1.15 + 0.45 * chan(seed, 0, 'v2.mandala.fieldScale')
  const fDir = chan(seed, 0, 'v2.mandala.fieldDir') * Math.PI * 2
  const fDist = 0.2 + 0.3 * chan(seed, 0, 'v2.mandala.fieldDist')
  const fRot = (chan(seed, 0, 'v2.mandala.fieldRot') * 2 - 1) * 0.4
  const fSoft = 2.6 + 0.8 * chan(seed, 0, 'v2.mandala.fieldSoft')
  // softness pyramid: the same placed mark rendered at growing softness
  // and summed. Every layer is 1 inside the silhouette and graded outside
  // over a wider and wider falloff, so the sum is a topographic gradient
  // whose level sets are true dilations of the mark's form — stepped
  // contour bands AROUND the silhouette, core = inside the mark — graded
  // no matter how tight the silhouette's native falloff is.
  // geometric falloff spread; ascending weights so the broad layers carry
  // more of the range than the steep silhouette-hugging one — the bands
  // share the annulus around the mark instead of collapsing onto its edge
  const SOFT_STACK: [number, number][] = [
    [1, 0.55],
    [1.8, 0.7],
    [3.2, 0.85],
    [5.8, 1],
    [10.5, 1.15],
    [19, 1.3],
  ]
  const fOffX = Math.cos(fDir) * fDist
  const fOffY = Math.sin(fDir) * fDist
  const symLayers: [Field, number][] = SOFT_STACK.map(([m, w]) => [
    env.symbolField({
      scale: fScale,
      offsetX: fOffX,
      offsetY: fOffY,
      rotation: fRot,
      softness: fSoft * m,
    }),
    w,
  ])
  // low-frequency coordinate warp (1-2 undulations per frame): displaces
  // the field spatially by a fixed amount, so even where the field is
  // steep (right at the silhouette) the mark's outline never renders
  // cleanly — influenced, not shown
  const wAmp = (0.055 + 0.03 * chan(seed, 0, 'v2.mandala.warpAmp')) * minDim
  const wf1 = (4.5 + 3 * chan(seed, 0, 'v2.mandala.warpF1')) / minDim
  const wf2 = (4.5 + 3 * chan(seed, 0, 'v2.mandala.warpF2')) / minDim
  const wq1 = chan(seed, 0, 'v2.mandala.warpQ1') * Math.PI * 2
  const wq2 = chan(seed, 0, 'v2.mandala.warpQ2') * Math.PI * 2
  const wq3 = chan(seed, 0, 'v2.mandala.warpQ3') * Math.PI * 2
  const wq4 = chan(seed, 0, 'v2.mandala.warpQ4') * Math.PI * 2
  const symField = (x: number, y: number): number => {
    const wx = x + wAmp * (Math.sin(y * wf1 + wq1) + 0.6 * Math.sin((x + y) * wf2 + wq2))
    const wy = y + wAmp * (Math.sin(x * wf2 + wq3) + 0.6 * Math.sin((x - y) * wf1 + wq4))
    let acc = 0
    for (const [f, w] of symLayers) acc += f(wx, wy) * w
    return acc
  }
  // anchor of the angular wobble = the mark's placement center
  const ax = outW / 2 + (fOffX * outW) / 2
  const ay = outH / 2 + (fOffY * outH) / 2
  // point-radial fallback (no mark loaded): zone-0 rim at ~0.6·minDim; on
  // the LONG axis the scatter fringe (t → -FRINGE, worst-case radius
  // (1+FRINGE)·maxR / min wobble) must die out before the canvas edge.
  const wobMin = 1 - a1 - a2
  const halfLong = outW >= outH ? Math.min(cx, outW - cx) : Math.min(cy, outH - cy)
  const maxR = Math.min(0.6 * minDim, (halfLong * wobMin) / (1 + FRINGE))

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
  if (lum) {
    // 3D material mode: captured-frame tone drives the ramp instead of
    // the symbol field (contrast-vs-ground direction) — unchanged
    for (let by = 0; by < bRows; by++) {
      for (let bx = 0; bx < bCols; bx++) {
        const l = lum((bx * 4 + 2) * p, (by * 4 + 2) * p)
        const tone = groundIsLight ? 1 - l : l
        blockT[by * bCols + bx] = tone * 1.3 - 0.15
      }
    }
  } else {
    // pass 1: sample the mark's graded field once per block
    let fMin = Infinity
    let fMax = -Infinity
    for (let by = 0; by < bRows; by++) {
      for (let bx = 0; bx < bCols; bx++) {
        const v = symField((bx * 4 + 2) * p, (by * 4 + 2) * p)
        blockT[by * bCols + bx] = v
        if (v < fMin) fMin = v
        if (v > fMax) fMax = v
      }
    }
    const span = fMax - fMin
    if (span > 1e-4) {
      // pass 2: histogram-equalize the sampled field over the frame. The
      // mapping is monotone, so t's level sets still flow around the
      // mark's form, but every zone is guaranteed a real share of the
      // canvas however steep the silhouette's native falloff is: the
      // bottom R0 of blocks sit below t=0 (fringe scatter fading into
      // bare ground on the field's far side), the rest split evenly into
      // the stepped zones, core = deepest inside the mark. The angular
      // wobble rides on t through a mid-band window (zero at both
      // extremes: far ground stays clean, core stays coherent) so the
      // contour bands stay chunky-organic and the outline never sharpens.
      const R0 = 0.32
      const sorted = blockT.slice()
      sorted.sort()
      const nB = sorted.length
      const cdf = (v: number): number => {
        let lo = 0
        let hi = nB
        while (lo < hi) {
          const mid = (lo + hi) >> 1
          if (sorted[mid] < v) lo = mid + 1
          else hi = mid
        }
        const first = lo
        hi = nB
        while (lo < hi) {
          const mid = (lo + hi) >> 1
          if (sorted[mid] <= v) lo = mid + 1
          else hi = mid
        }
        return (first + lo) / 2 / nB
      }
      for (let by = 0; by < bRows; by++) {
        for (let bx = 0; bx < bCols; bx++) {
          const i = by * bCols + bx
          const n = (cdf(blockT[i]) - R0) / (1 - R0)
          const th = Math.atan2((by * 4 + 2) * p - ay, (bx * 4 + 2) * p - ax)
          const wob = wobble(th)
          const m = Math.max(0, Math.min(1, n))
          blockT[i] = n + wob * Math.min(1, 4 * m * (1 - m))
        }
      }
    } else {
      // no mark loaded: fall back to the point-radial composition
      for (let by = 0; by < bRows; by++) {
        for (let bx = 0; bx < bCols; bx++) {
          const dx = (bx * 4 + 2) * p - cx
          const dy = (by * 4 + 2) * p - cy
          const dist = Math.hypot(dx, dy)
          const th = Math.atan2(dy, dx)
          const wob = 1 + wobble(th)
          blockT[by * bCols + bx] = 1 - (dist * wob) / maxR
        }
      }
    }
  }

  // ---- ring breathing ---------------------------------------------------
  // A spatially-constant swell added to the ramp before zone quantization,
  // so every zone boundary moves outward and back together — the rings
  // breathe. Applied to all three t-field branches (symbol, point-radial
  // fallback AND captured-luminance), so 3D captures breathe too. The
  // sin(θ+φ) − sin(φ) form is exactly zero at phase 0/1 — the loop seam and
  // the phase-0 thumbnail stay byte-identical to the static render — while
  // moving at full rate right through the seam (no dead zone), and the
  // seeded φ keeps the swell from locking step with the precession.
  const bPhi = 2 * Math.PI * chan(seed, 0, 'v2.mandala.breathePhase')
  const breathe =
    amt *
    0.11 *
    (Math.sin(2 * Math.PI * env.motionPhase * h + bPhi) - Math.sin(bPhi))
  if (breathe !== 0) {
    for (let i = 0; i < blockT.length; i++) blockT[i] += breathe
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
