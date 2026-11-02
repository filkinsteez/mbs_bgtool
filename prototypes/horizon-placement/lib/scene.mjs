// CPU sketch of the proposed horizon placement: a sky built from added light (blue sky, one warm
// light reddened near the horizon, a pale bridge, a glow around the sun), and below the horizon
// either more sky, water (the sky mirrored, squeezed, smeared by ripples and dimmed by Fresnel
// reflection), a far shore over water, flat land or a ridge (lit by the sky, paler with distance).
// Everything is linear RGB; pack hexes only. Sketches to judge placement, not final looks.
import { hexToLinear } from './color.mjs'
import { fbm1 } from './noise.mjs'
import { toneCurve } from './tone.mjs'

const lin = (hex, gain = 1) => hexToLinear(hex).map((v) => v * gain)
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k]
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const clamp01 = (t) => Math.min(1, Math.max(0, t))
const smooth01 = (t) => {
  const x = clamp01(t)
  return x * x * (3 - 2 * x)
}
const logistic = (x) => 1 / (1 + Math.exp(-4.394 * x)) // 10% to 90% over one unit

/** Pack roles for the sketches. Every color is a pack hex; gains only scale light. */
export const SKETCH_PACKS = {
  // horizonDim: share of the glow left right at the horizon. Only a red light may darken toward the
  // horizon; darker tan or grey turns brown or dull, so those stay near the glow's own level.
  // water: the water's own light (sunlight scattered inside it and the sky it sees), a dark pack
  // color; it shows where the reflection weakens, so dim warm light turns rose or violet, not brown.
  bold: { name: 'Bold', sky: '#0064E0', low: '#1FCDF0', light: '#FF4F00', glow: 1.0, bridge: 0.16, horizonDim: 0.45, sun: 0.35, water: ['#0064E0', 0.3], landTop: ['#0064E0', 0.45], landBottom: ['#0064E0', 0.16] },
  elemental: { name: 'Elemental', sky: '#0064E0', low: null, light: '#B8996E', glow: 0.85, bridge: 0.18, horizonDim: 0.85, sun: 0.35, water: ['#4A0A3C', 1.6], landTop: ['#4A0A3C', 1.7], landBottom: ['#4A0A3C', 0.85] },
  atmospheric: { name: 'Atmospheric', sky: '#0064E0', low: null, light: '#F2F4F7', glow: 0.42, bridge: 0.1, horizonDim: 0.9, sun: 0.2, water: ['#384753', 1.2], landTop: ['#6A7788', 0.75], landBottom: ['#1C2B33', 1.0] },
}

/** Degrees of sky from the horizon to the top of the sky's layout (t = 1). */
export const SKY_DEGREES = 32
/** Degrees below the horizon at the bottom of the frame for water: a long lens, so the water stays light. */
export const WATER_DEGREES = 9
/** The reflection shows sky this many times higher than the mirror angle (ripples favour faces tilted toward the camera). */
export const SQUEEZE = 1.25

/** Fresnel reflectance of water (n 1.333) for unpolarized light at an incidence angle in degrees. */
export function fresnel(incidenceDeg, n = 1.333) {
  const i = (Math.min(89.999, Math.max(0, incidenceDeg)) * Math.PI) / 180
  const ci = Math.cos(i)
  const st = Math.sin(i) / n
  const ct = Math.sqrt(1 - st * st)
  const rs = ((ci - n * ct) / (ci + n * ct)) ** 2
  const rp = ((ct - n * ci) / (ct + n * ci)) ** 2
  return (rs + rp) / 2
}

function warmFamily(hex) {
  const w0 = lin(hex)
  const wm = Math.max(...w0)
  const warm = w0.map((v) => Math.max(0.004, v / wm))
  return (p) => warm.map((v) => v ** p)
}

function makeSky(P, sunX, fw) {
  const blue = lin(P.sky)
  const low = P.low ? lin(P.low, 0.8) : null
  const warmPow = warmFamily(P.light)
  const tp = 0.34
  const t0 = 0.05
  const q0 = t0 / (tp + t0)
  const rise0 = q0 * Math.exp(1 - q0)
  /** Sky light at normalized elevation t (0 at the horizon, 1 at the top of the layout) and column u. */
  return (t, u) => {
    const tt = Math.max(0, t)
    const dx = Math.abs(u - sunX) * fw
    const width = 0.55 + 0.6 * tt
    const side = 0.4 + 0.6 / (1 + (dx / width) ** 1.6)
    const kB = 0.12 + 0.88 * smooth01((tt - 0.08) / 0.85)
    let sky = scale(blue, kB)
    if (low) sky = scale(mix(low, blue, smooth01((tt - 0.15) / 0.65)), kB)
    const q = (tt + t0) / (tp + t0)
    const rise = (q * Math.exp(1 - q) - rise0) / (1 - rise0)
    // The horizon band is less dark toward the sun, so its darkness changes along it.
    const floor = P.horizonDim + ((1 - P.horizonDim) * 0.45) / (1 + (dx / 0.35) ** 2)
    const g = tt < tp ? floor + (1 - floor) * rise : Math.exp(-(((tt - tp) / 0.32) ** 1.7))
    // Redder near the horizon, paler above the peak, so the light's tail over the blue is near white, not violet.
    const p = (P.horizonDim < 0.6 ? 1.5 : 0.6) * Math.exp(-tt / 0.11) + 0.22 * Math.exp(-Math.max(0, tt - tp) / 0.25)
    sky = add(sky, warmPow(p), P.glow * g * side)
    const bell = Math.exp(-(((tt - 0.55) / 0.22) ** 2))
    sky = add(sky, warmPow(0.08), P.bridge * bell * (0.6 + 0.4 * side))
    return sky
  }
}

/**
 * Renders one sketch. spec:
 * - pack: 'bold' | 'elemental' | 'atmospheric'
 * - horizon: frame fraction down from the top at the center column (above 1: below the frame)
 * - below: 'sky' | 'water' | 'shore' (a far bank with water below it) | 'bank' (flat land) | 'ridge'
 * - rise: frame heights a ridge climbs toward the sun; tilt: degrees, positive descends to the right
 * - sunX: frame fraction; seed
 * Returns linear RGB (Float32Array, row-major).
 */
export function renderScene(spec, W, H) {
  const { pack, horizon, below = 'sky', tilt = 0, sunX = 0.7, seed = 1 } = spec
  // spec.roles overrides pack roles (another pack hex as the light, say) for side-by-side checks
  const P = { ...SKETCH_PACKS[pack], ...(spec.roles ?? {}) }
  const aspect = W / H
  const fw = Math.max(aspect, 1)
  const fh = Math.max(1 / aspect, 1)
  const sky = makeSky(P, sunX, fw)
  const warmPow = warmFamily(P.light)
  const tanT = Math.tan((tilt * Math.PI) / 180)
  const px = fh / H // one pixel in short-side units
  const waterBelow = below === 'water' || below === 'shore'

  // The level horizon (frame fraction per column), nearly still for water.
  const wobble = below === 'water' ? 0.0015 : 0.009
  const levelAt = (u) => horizon + (tanT * (u - 0.5) * fw) / fh + (wobble * fbm1(u * fw * 1.3 + 3.1, seed)) / fh
  // Where the sky ends, and the level horizon behind it that the sky's light is measured from.
  let edgeAt = levelAt
  let trueAt = levelAt
  if (below === 'shore') {
    // A far shore whose height changes along it, never an even strip.
    edgeAt = (u) => levelAt(u) - (0.05 + 0.03 * fbm1(u * fw * 0.7 + 2.2, seed + 5)) / fh
  } else if (below === 'ridge') {
    const rise = spec.rise ?? 0.22
    const toward = sunX > 0.5 ? 1 : -1
    // One long climb toward the sun's side with a broad shoulder, never a row of bumps.
    edgeAt = (u) => {
      const s = toward > 0 ? u : 1 - u
      return horizon - rise * (0.5 * smooth01((s - 0.05) / 0.95) + 0.5 * s * s - 0.35) + (0.012 * fbm1(u * fw * 0.9 + 5.3, seed + 3)) / fh
    }
    const lowest = Math.max(...Array.from({ length: 65 }, (_, i) => edgeAt(i / 64)))
    trueAt = () => lowest + 0.03
  }
  const skyScale = (u) => Math.max(0.3, Math.min(1, trueAt(u) * fh))
  // The sun sits just below the horizon, or just behind the ridge's crest.
  const sunY = below === 'ridge' ? edgeAt(Math.min(0.98, Math.max(0.02, sunX))) + 0.04 : trueAt(sunX) + 0.03
  const sunColor = warmPow(0.3)
  // A wide, flat glow around the sun, never a disc or a spot.
  const aureole = (u, v) => {
    const r2 = ((u - sunX) * fw / 0.45) ** 2 + ((v - sunY) * fh / 0.16) ** 2
    return scale(sunColor, P.sun / (1 + r2) ** 1.3)
  }
  const skyAt = (u, v) => add(sky(((trueAt(u) - v) * fh) / skyScale(u), u), aureole(u, v))

  const out = new Float32Array(W * H * 3)
  for (let i = 0; i < W; i++) {
    const u = (i + 0.5) / W
    const yEdge = edgeAt(u)
    const yLevel = levelAt(u)
    // Softness changes along the line; land edges are softer than the far edge of calm water.
    const soft = (below === 'water' ? 0.01 : 0.035) * Math.exp(0.45 * fbm1(u * fw * 1.1 + 9.7, seed + 11)) + 0.8 * px
    const lineVar = 0.55 + 0.45 * fbm1(u * fw * 2.2 + 1.3, seed + 23)
    const lowSky = skyAt(u, yLevel - 0.01)
    const bankColor = mix(lin(...P.landTop), scale(sky(0.08, u), 0.8), 0.55)
    const dBottom = Math.max(0.15, (1 - yLevel) * fh)
    for (let j = 0; j < H; j++) {
      const v = (j + 0.5) / H
      const skyLight = skyAt(u, Math.min(v, yEdge))
      let c = skyLight
      if (below !== 'sky') {
        let ground
        if (waterBelow && v > yLevel) {
          const d = (v - yLevel) * fh
          // Fresnel at the angle the camera sees the water; the reflection shows the sky (and the
          // shore) from SQUEEZE times higher, smeared up and down by ripples, more with depth.
          const dep = (WATER_DEGREES * d) / dBottom
          const R = fresnel(90 - dep)
          const lift = (dep * SQUEEZE) / SKY_DEGREES // reflected elevation, in sky layout units
          const spread = 0.012 + 0.12 * lift
          let refl = [0, 0, 0]
          let wsum = 0
          for (let k = -3; k <= 3; k++) {
            const w = Math.exp(-0.5 * (k / 1.6) ** 2)
            const vm = yLevel - ((lift + (spread * k) / 2) * skyScale(u)) / fh
            const sample = below === 'shore' && vm > yEdge ? mix(skyAt(u, yEdge), bankColor, logistic(((vm - yEdge) * fh) / soft - 0.5)) : skyAt(u, vm)
            refl = add(refl, sample, w)
            wsum += w
          }
          ground = add(scale(refl, R / wsum), lin(...P.water), 1 - R)
          // Far water is seen through more air; a thin lighter line sits on the horizon.
          ground = mix(ground, lowSky, 0.3 * Math.exp(-d / 0.02))
          // A soft lighter strip, not a crisp line: wave faces on the far water catch sky from higher up.
          const sig = Math.max(0.005, 0.7 * px)
          if (below === 'water') ground = add(ground, skyAt(u, yLevel - (0.14 * skyScale(u)) / fh), 0.3 * lineVar * Math.exp(-0.5 * (d / sig) ** 2))
          if (below === 'shore') ground = mix(bankColor, ground, logistic(((v - yLevel) * fh) / (0.4 * soft)))
        } else if (below === 'shore') {
          ground = bankColor
        } else {
          const d = Math.max(0, (v - yEdge) * fh)
          const room = Math.max(0.2, (1 - yEdge) * fh)
          const own = mix(lin(...P.landTop), lin(...P.landBottom), smooth01(d / room))
          // Far land is seen through more air, so it takes on the low sky's light.
          const haze = scale(sky(0.08, u), 0.8)
          ground = mix(own, haze, Math.exp(-d / 0.1))
        }
        c = mix(skyLight, ground, logistic(((v - yEdge) * fh) / soft - 0.5))
      }
      const o = (j * W + i) * 3
      out[o] = c[0]
      out[o + 1] = c[1]
      out[o + 2] = c[2]
    }
  }
  return out
}

/** Turns a render 90 degrees clockwise: the sky's top ends up on the right. */
export function turnClockwise(rgb, W, H) {
  const out = new Float32Array(W * H * 3)
  // source W x H -> target H x W; target (x', y') = (H - 1 - y, x)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const s = (y * W + x) * 3
      const tx = H - 1 - y
      const ty = x
      const t = (ty * H + tx) * 3
      out[t] = rgb[s]
      out[t + 1] = rgb[s + 1]
      out[t + 2] = rgb[s + 2]
    }
  }
  return out
}

/**
 * Linear RGB to 8-bit sRGB through the engine's tone curve. With `dither` +-0.5 LSB noise is added;
 * the committed sheets go without it, so their PNGs stay small (tiles are too small to band).
 */
export function encode(rgb, W, H, seed = 7, dither = false) {
  const buf = Buffer.alloc(W * H * 3)
  let s = (seed * 2654435761) >>> 0
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const enc = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)
  for (let p = 0; p < W * H; p++) {
    const c = toneCurve([rgb[p * 3], rgb[p * 3 + 1], rgb[p * 3 + 2]])
    for (let k = 0; k < 3; k++) buf[p * 3 + k] = Math.max(0, Math.min(255, Math.floor(enc(c[k]) * 255 + (dither ? rnd() : 0.5))))
  }
  return buf
}
