import { motionHarmonic, type V2Env } from '../v2/system'
import { normalizedLuminance } from '../v2/pattern'
import type { Field } from '../field'
import { chan, chanGauss } from '@/core/organic/random'

// 'Plates' — print physics. The frame is a riso/screenprint overprint:
// 2-4 ink PLATES (complexity moves the count), each a classic halftone
// screen — dot or line, at its own screen angle from the 15/45/75/0
// family — rasterizing a tone field derived from the canonical mark.
// Every plate sees the mark through its own slightly different
// symbolField variant (scale/offset/softness), carries a seeded
// misregistration offset of a few pixels, and composites over the paper
// in multiply (light paper) or screen (dark paper). Where dot screens
// cross, rosette moire emerges — the point of the exercise — and the
// mark reads as plural ghosted registrations of one form, never a clean
// single rendition. In 3D material mode each plate halftones the
// captured luminance with its own offset/gamma — an overprinted
// engraving of the model — and, when a depth pass exists, the first dot
// plate's screen subdivides to a finer pitch where the model is nearer.
// Motion: the registration offsets breathe and the tonal gradients roll
// on exact-loop sine terms (zero at the seam, scaled by amount, integer
// harmonic), so phase 0 is byte-identical to the static frame.

const C = 'v4.plates.'
const TAU = Math.PI * 2
const RAD = Math.PI / 180

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

// ---------------------------------------------------------------------------
// Ink pool — the enabled plan swatches that survive against the ground,
// same policy as the V3-tab systems (v2/dither): perceptual oklab
// distance >= 0.09, weight-proportional, classic single-ink fallback.
// ---------------------------------------------------------------------------

type PoolInk = { hex: string; weight: number }

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

function buildInkPool(env: V2Env): PoolInk[] {
  const plan = env.plan
  if (!plan || plan.depthOrder.length === 0) return [{ hex: env.ink, weight: 1 }]
  const [gl, ga, gb] = hexToOklab(env.ground)
  const pool: PoolInk[] = []
  for (const sw of plan.swatches) {
    const sa = Math.cos(sw.hue) * sw.chroma
    const sb = Math.sin(sw.hue) * sw.chroma
    const dist = Math.hypot(sw.lightness - gl, sa - ga, sb - gb)
    if (dist >= 0.09) pool.push({ hex: sw.hex, weight: Math.max(1e-4, sw.weight) })
  }
  if (pool.length === 0) {
    const idx = plan.depthOrder[plan.depthOrder.length - 1]
    return [{ hex: plan.swatches[idx]?.hex ?? env.ink, weight: 1 }]
  }
  return pool
}

// deal one ink per plate: weight-proportional draws WITHOUT replacement
// (each plate is a physically distinct ink drum), refilling the bag only
// when the mix runs out — a single-ink mix overprints itself, which under
// multiply still darkens at every screen crossing.
function dealPlateInks(seed: number, count: number, pool: PoolInk[]): string[] {
  const inks: string[] = []
  let bag = pool.slice()
  for (let p = 0; p < count; p++) {
    if (bag.length === 0) bag = pool.slice()
    const total = bag.reduce((sum, q) => sum + q.weight, 0) || 1
    const sample = chan(seed, p, C + 'ink') * total
    let acc = 0
    let pick = bag.length - 1
    for (let k = 0; k < bag.length; k++) {
      acc += bag[k].weight
      if (sample < acc) {
        pick = k
        break
      }
    }
    inks.push(bag[pick].hex)
    bag.splice(pick, 1)
  }
  return inks
}

// ---------------------------------------------------------------------------
// Screen rasterizers. Both sample the tone field in plate-canvas
// coordinates and draw with the plate's ink; AA'd fills give the slight
// ink spread of real print.
// ---------------------------------------------------------------------------

// AM halftone dot: area coverage tracks tone (pi r^2 = t p^2) with ~8%
// dot gain; capped so shadow dots merge only diagonally and paper flecks
// survive at maximum tone.
function dotRadius(t: number, pitch: number): number {
  return Math.min(0.54 * pitch, pitch * Math.sqrt(t / Math.PI) * 1.08)
}

function renderDotScreen(
  pctx: CanvasRenderingContext2D,
  fw: number,
  fh: number,
  cx: number,
  cy: number,
  pitch: number,
  angle: number,
  tone: Field,
  near: Field | null,
  seed: number,
): void {
  const cosA = Math.cos(angle)
  const sinA = Math.sin(angle)
  const R = Math.hypot(fw, fh) * 0.5 + 2 * pitch
  pctx.beginPath()
  for (let v = -R; v <= R; v += pitch) {
    for (let u = -R; u <= R; u += pitch) {
      const x = cx + u * cosA - v * sinA
      const y = cy + u * sinA + v * cosA
      if (x < -pitch || x > fw + pitch || y < -pitch || y > fh + pitch) continue
      if (near) {
        // depth-following pitch: where the model is near, the cell
        // subdivides into a 2x2 cluster of half-pitch dots (recursive AM
        // screening). The threshold is chan-dithered per lattice cell so
        // the fine/coarse boundary is a stochastic band, not a contour.
        const n = near(x, y)
        if (n > 0.02) {
          const id =
            (Math.imul(Math.round(u / pitch) + 4096, 0x9e3779b1) ^
              Math.imul(Math.round(v / pitch) + 4096, 0x85ebca77)) >>>
            0
          if (n > 0.38 + 0.4 * chan(seed, id, C + 'subdiv')) {
            const q = pitch * 0.25
            for (let sv = -1; sv <= 1; sv += 2) {
              for (let su = -1; su <= 1; su += 2) {
                const sx = x + su * q * cosA - sv * q * sinA
                const sy = y + su * q * sinA + sv * q * cosA
                const t = tone(sx, sy)
                if (t < 0.012) continue
                const r = dotRadius(t, pitch * 0.5)
                pctx.moveTo(sx + r, sy)
                pctx.arc(sx, sy, r, 0, TAU)
              }
            }
            continue
          }
        }
      }
      const t = tone(x, y)
      if (t < 0.012) continue
      const r = dotRadius(t, pitch)
      pctx.moveTo(x + r, y)
      pctx.arc(x, y, r, 0, TAU)
    }
  }
  pctx.fill()
}

function renderLineScreen(
  pctx: CanvasRenderingContext2D,
  fw: number,
  fh: number,
  cx: number,
  cy: number,
  pitch: number,
  angle: number,
  tone: Field,
): void {
  const cosA = Math.cos(angle)
  const sinA = Math.sin(angle)
  const R = Math.hypot(fw, fh) * 0.5 + 2 * pitch
  const du = Math.max(2, pitch * 0.8)
  // a paper groove always survives between lines, even at full tone
  const gap = Math.max(1.2, 0.28 * pitch)
  const thMax = pitch - gap
  pctx.save()
  pctx.translate(cx, cy)
  pctx.rotate(angle)
  pctx.beginPath()
  for (let v = -R; v <= R; v += pitch) {
    for (let u = -R; u <= R; u += du) {
      const x = cx + u * cosA - v * sinA
      const y = cy + u * sinA + v * cosA
      if (x < -pitch || x > fw + pitch || y < -pitch || y > fh + pitch) continue
      const t = tone(x, y)
      if (t < 0.02) continue
      const th = Math.min(thMax, t * 1.4 * pitch)
      pctx.rect(u - du * 0.5, v - th * 0.5, du + 0.35, th)
    }
  }
  pctx.fill()
  pctx.restore()
}

// ---------------------------------------------------------------------------
// 3D shading: the model's own tonal range, percentile-normalized where
// the border-referenced level reads "figure" (same policy the dither
// figure uses), so the engraving spans the capture's real exposure.
// ---------------------------------------------------------------------------

function subjectShade(env: V2Env, level: Field): Field {
  const lum = env.luminance
  if (!lum) return () => 0.5
  const { outW, outH } = env
  const cols = 64
  const rows = Math.max(2, Math.round((cols * outH) / Math.max(1, outW)))
  const subject: number[] = []
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = ((i + 0.5) / cols) * outW
      const y = ((j + 0.5) / rows) * outH
      if (level(x, y) > 0.6) subject.push(lum(x, y))
    }
  }
  subject.sort((a, b) => a - b)
  const lo = subject.length > 0 ? subject[Math.floor(subject.length * 0.05)] : 0
  const hi =
    subject.length > 0
      ? subject[Math.min(subject.length - 1, Math.floor(subject.length * 0.95))]
      : 1
  const span = hi - lo
  if (span < 0.02) return () => 0.5
  return (x, y) => clamp01((hi - lum(x, y)) / span)
}

// ---------------------------------------------------------------------------
// The press
// ---------------------------------------------------------------------------

let plateScratch: HTMLCanvasElement | null = null

export function renderPlates(ctx: CanvasRenderingContext2D, env: V2Env): void {
  const { outW: W, outH: H, seed } = env
  const minDim = Math.min(W, H)
  const scale = minDim / 1080

  ctx.save()
  ctx.fillStyle = env.ground
  ctx.fillRect(0, 0, W, H)

  const pool = buildInkPool(env)
  // complexity moves the plate count: 2 at low, up to 4 at high
  const plateCount = 2 + Math.round(env.complexity * 2)
  const inks = dealPlateInks(seed, plateCount, pool)
  // overprint physics by paper polarity: multiply onto light paper,
  // screen (light-ink overprint) onto dark paper
  const blend: GlobalCompositeOperation =
    hexToOklab(env.ground)[0] >= 0.55 ? 'multiply' : 'screen'

  // screen pitch from complexity (coarse poster screens -> fine ones);
  // per-plate ~5% frequency jitter adds the slow beat real presses have
  const basePitch = Math.max(2.2, minDim / (40 + 66 * env.complexity))
  // classic angle family, whole set tilted by one seeded press rotation
  const angleBase = (chan(seed, 0, C + 'angleBase') * 2 - 1) * 4 * RAD
  const ANGLE_OFFSETS = [15, 45, 75, 0]

  // per-plate screen kind; at least two dot screens carry the rosette
  const kinds: ('dot' | 'line')[] = []
  for (let p = 0; p < plateCount; p++) {
    kinds.push(chan(seed, p, C + 'kind') < 0.72 ? 'dot' : 'line')
  }
  let dotCount = kinds.filter((kind) => kind === 'dot').length
  for (let p = plateCount - 1; p >= 0 && dotCount < 2; p--) {
    if (kinds[p] === 'line') {
      kinds[p] = 'dot'
      dotCount++
    }
  }
  const depthPlate = kinds.indexOf('dot')

  // exact-loop motion: integer harmonic, sin(theta+phi)-sin(phi) forms
  const amt = env.motionAmount
  const theta = TAU * env.motionPhase * motionHarmonic(env)

  // ONE press gradient shared by every plate (split-fountain style): the
  // plates thin out together on the same side of the form, so the dense
  // overprint opens up into sparse single-screen dots instead of every
  // plate independently saturating the union
  const pressDir = chan(seed, 0, C + 'pressDir') * TAU
  const pressFreq = (TAU * (0.5 + 0.4 * chan(seed, 0, C + 'pressFreq'))) / minDim
  const pressPhase = chan(seed, 0, C + 'pressPhase') * TAU

  // 3D material mode tone sources (null in 2D)
  let level: Field | null = null
  let shade: Field | null = null
  if (env.luminance) {
    level = normalizedLuminance(env)
    shade = subjectShade(env, level)
  }
  const depth = env.depth ?? null
  const near: Field | null = level && depth ? (x, y) => 1 - depth(x, y) : null

  // plate canvases carry a bleed margin so misregistration never exposes
  // an unprinted strip at the frame edge
  const margin = Math.ceil(7.5 * scale + 2)
  const fw = W + margin * 2
  const fh = H + margin * 2
  if (!plateScratch) plateScratch = document.createElement('canvas')
  if (plateScratch.width !== fw || plateScratch.height !== fh) {
    plateScratch.width = fw
    plateScratch.height = fh
  }
  const pctx = plateScratch.getContext('2d')
  if (!pctx) {
    ctx.restore()
    return
  }

  for (let p = 0; p < plateCount; p++) {
    const angle =
      angleBase + ANGLE_OFFSETS[p] * RAD + 1.2 * RAD * chanGauss(seed, p, C + 'angleJit')
    const pitch = Math.max(2.2, basePitch * (1 + 0.05 * chanGauss(seed, p, C + 'pitchJit')))

    // this plate's take on the shared press gradient (small angle/phase
    // drift), plus an optional faint paper wash; the wave rolls with the
    // loop
    const gDir = pressDir + 0.3 * chanGauss(seed, p, C + 'gradDir')
    const gFreq = pressFreq * (1 + 0.15 * chanGauss(seed, p, C + 'gradFreq'))
    const gkx = Math.cos(gDir) * gFreq
    const gky = Math.sin(gDir) * gFreq
    const gPhase = pressPhase + 1.1 * (chan(seed, p, C + 'gradPhase') - 0.5)
    const gPhi = chan(seed, p, C + 'gradPhi') * TAU
    const gradSlide = 0.9 * amt * (Math.sin(theta + gPhi) - Math.sin(gPhi))
    const washAmp =
      p === 0
        ? 0.05 + 0.06 * chan(seed, p, C + 'washAmp')
        : chan(seed, p, C + 'washOn') < 0.35
          ? 0.04 + 0.09 * chan(seed, p, C + 'washAmp')
          : 0
    const wDir = chan(seed, p, C + 'washDir') * TAU
    const wFreq = (TAU * (0.35 + 0.4 * chan(seed, p, C + 'washFreq'))) / minDim
    const wkx = Math.cos(wDir) * wFreq
    const wky = Math.sin(wDir) * wFreq
    const wPhase = chan(seed, p, C + 'washPhase') * TAU
    const wash: Field = (x, y) =>
      washAmp * (0.5 + 0.5 * Math.sin(x * wkx + y * wky + wPhase))

    let tone: Field
    if (level && shade) {
      // engraving: halftone the captured frame, per-plate offset/gamma
      // splitting the model's tonality across the inks
      const levelF = level
      const shadeF = shade
      const off = 0.12 * chanGauss(seed, p, C + 'toneOff')
      const gam = 0.7 + 0.7 * chan(seed, p, C + 'toneGamma')
      tone = (x, y) => {
        const body = clamp01(0.1 + 0.78 * Math.pow(shadeF(x, y), gam) + off)
        return Math.min(0.9, wash(x, y) * 0.7 + levelF(x, y) * body)
      }
    } else {
      // 2D: the canonical mark through this plate's own variant — a hair
      // of scale/offset/softness drift so plate edges fringe like real
      // misregistered print. Placement stays canonical and centered; the
      // geometry itself is never touched.
      // ghosting grows down the plate order: the first plate anchors the
      // register, each later pass sits a little further off
      const ghost = 0.5 + p * 0.5
      const sym = env.symbolField({
        scale: 1 + 0.04 * ghost * chanGauss(seed, p, C + 'symScale'),
        offsetX: 0.009 * ghost * chanGauss(seed, p, C + 'symOx'),
        offsetY: 0.009 * ghost * chanGauss(seed, p, C + 'symOy'),
        softness: 2.5 + 5 * chan(seed, p, C + 'symSoft'),
      })
      // moderate per-plate coverage: the mark's density is built by
      // plates OVERPRINTING, not by any one screen running solid — that
      // is where the crossings (and the rosette) live
      tone = (x, y) => {
        const interior = 0.4 + 0.3 * Math.sin(x * gkx + y * gky + gPhase + gradSlide)
        return Math.min(0.9, wash(x, y) + interior * sym(x, y))
      }
    }

    // misregistration: a seeded rest offset of order 1-3px at 1080p —
    // growing down the plate order like the ghosting above — that
    // breathes with the loop as the plates slide in and out of register
    const regMag = (1.6 + 2.4 * (p / Math.max(1, plateCount - 1))) * scale
    const regX = regMag * chanGauss(seed, p, C + 'regX')
    const regY = regMag * chanGauss(seed, p, C + 'regY')
    const phiX = chan(seed, p, C + 'phiX') * TAU
    const phiY = chan(seed, p, C + 'phiY') * TAU
    const ampR = (1.6 + 2.8 * chan(seed, p, C + 'ampR')) * scale
    const offX = regX + ampR * amt * (Math.sin(theta + phiX) - Math.sin(phiX))
    const offY = regY + 0.8 * ampR * amt * (Math.sin(theta + phiY) - Math.sin(phiY))

    // seeded lattice phase so two plates never share dot centers
    const cx = fw * 0.5 + (chan(seed, p, C + 'latX') - 0.5) * pitch * 2
    const cy = fh * 0.5 + (chan(seed, p, C + 'latY') - 0.5) * pitch * 2

    const toneC: Field = (x, y) => tone(x - margin, y - margin)
    const nearC: Field | null =
      near && p === depthPlate ? (x, y) => near(x - margin, y - margin) : null

    pctx.setTransform(1, 0, 0, 1, 0, 0)
    pctx.clearRect(0, 0, fw, fh)
    pctx.fillStyle = inks[p]
    if (kinds[p] === 'dot') {
      renderDotScreen(pctx, fw, fh, cx, cy, pitch, angle, toneC, nearC, seed)
    } else {
      renderLineScreen(pctx, fw, fh, cx, cy, pitch, angle, toneC)
    }

    ctx.globalCompositeOperation = blend
    ctx.drawImage(plateScratch, offX - margin, offY - margin)
  }

  ctx.restore()
}
