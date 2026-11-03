// A seeded Sunset scene made of pack-colored light, in short-side units
// (x across and centered on 0, y down from the top; the frame is w x h, short side 1).
//
// Sharp where real scenes are sharp, soft where light is soft, then one lens:
// - sky and glow: light. Their transitions are soft in the scene (light fading over a
//   distance), and where two lights overlap they add, so the bridge is lighter.
// - ground masses: silhouettes. Their outlines are sharp, uneven at several scales (a
//   few broad lobes and broad bumps, nothing near the lens size) and are sharp in some
//   stretches and soft in others, so through the lens their width changes along them.
// - light inside every band varies slowly (big patches), so nothing is flat.
// - light terms: a dome of light over the source, spill patches of a neighbour's color,
//   thin columns of light and a thin lit rim. Thin features are always light; dark
//   masses are always thick.
import { hexToLinear, oklch } from './color.mjs'
import { PACKS } from './packs.mjs'
import { random, noise1, gradientNoise, NOISE_RMS } from './noise.mjs'

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const lerp = (a, b, t) => a + (b - a) * t
const smooth = (t) => {
  const u = clamp(t, 0, 1)
  return u * u * (3 - 2 * u)
}
export const lightness = (hex) => oklch(hexToLinear(hex))[0]
/** Hue difference in degrees between two colors with real chroma (0 if either is near grey). */
export const hueGap = (a, b) => {
  const [, ca, ha] = oklch(hexToLinear(a))
  const [, cb, hb] = oklch(hexToLinear(b))
  if (ca < 0.06 || cb < 0.06) return 0
  const d = Math.abs(ha - hb) % 360
  return d > 180 ? 360 - d : d
}
const isWarm = (hex) => {
  const [, c, h] = oklch(hexToLinear(hex))
  return c > 0.04 && h >= 25 && h <= 105
}

/**
 * Roles from pack order: Meta Blue is the sky, the brightest of the rest is the
 * light near the horizon, the colors after it are the ground. At most one warm
 * color: with two (Bold), the seed keeps one.
 */
export function roles(pack, rnd) {
  const [sky, ...rest] = PACKS[pack]
  const warms = rest.filter(isWarm)
  const warm = warms.length > 1 ? warms[rnd.int(0, warms.length - 1)] : warms[0]
  const kept = rest.filter((hex) => !isWarm(hex) || hex === warm)
  const glow = kept.reduce((a, b) => (lightness(b) > lightness(a) ? b : a), kept[0])
  const at = kept.indexOf(glow)
  return { sky, upper: kept.slice(0, at), glow, ground: kept.slice(at + 1), warm }
}

/**
 * One boundary y(x): its own tilt and bow, a few broad asymmetric lobes and shape noise
 * at two broad scales (nothing near the lens size, which would come out as lumps), and a
 * scene softness that changes along the edge: some stretches are sharp, some soft, so
 * through the lens the edge is narrower in some places and wider in others.
 */
function makeBoundary(rnd, seed, { base, shape, soft, softVary, lobes, calm, frameW }) {
  const tilt = rnd.between(-0.05, 0.05) * (1 - calm)
  const bowAt = rnd.between(-0.3, 0.3) * frameW
  const bow = rnd.between(-0.04, 0.04) * (1 - 0.6 * calm)
  const big = [1.5, 0.75].map((lam, o) => ({ lam, amp: (lam / 1.5) ** 0.8 * rnd.between(0.6, 1.4), phase: rnd.between(0, 100), row: 0.5 + 7 * o }))
  const nb = Math.sqrt(big.reduce((s, o) => s + o.amp * o.amp, 0))
  const softAt = rnd.between(0, 100)
  const softLen = rnd.between(0.3, 0.7)
  return {
    base,
    /** Scene softness at x (10-90 width of the scene edge, short sides). */
    soft: (x) => soft * clamp(1 + softVary * noise1(x / softLen + softAt, seed + 91, 3.5), 0, 2.5),
    calmBy: 1,
    y(x) {
      let v = tilt * x + bow * ((x - bowAt) / frameW) ** 2 * 4
      for (const o of big) v += ((shape * o.amp) / nb) * noise1(x / o.lam + o.phase, seed + 17, o.row)
      for (const l of lobes) {
        const t = x - l.x
        const u = Math.abs(t / (t < 0 ? l.wl : l.wr))
        v += l.a * Math.exp(-(u ** 2))
      }
      return base + this.calmBy * v
    },
  }
}

/**
 * Every band keeps a thickness at every x: at least 2 lens radii, and 3.2 for a band
 * darker than both neighbours (a thin dark band through the lens is a dark seam, which
 * reads as mud). Where a band is too thin the two boundaries around it are scaled toward
 * their mean height, step by step, until it holds.
 */
function keepThick(bands, w, h, R) {
  const xs = Array.from({ length: 96 }, (_, k) => (-0.5 + (k + 0.5) / 96) * w)
  const darkBetween = (i) => i > 0 && i + 1 < bands.length && lightness(bands[i].hex) < Math.min(lightness(bands[i - 1].hex), lightness(bands[i + 1].hex)) - 0.1
  for (const b of bands) if (b.boundary) b.boundary.calmBy = 1
  for (let it = 0; it < 12; it++) {
    let ok = true
    for (let i = 1; i < bands.length; i++) {
      const top = bands[i].boundary
      const next = bands[i + 1]?.boundary
      const need = (darkBetween(i) ? 3.2 : 2) * R
      const thin = Math.min(...xs.map((x) => (next ? next.y(x) : h + 0.5 * need) - top.y(x)))
      if (thin >= need) continue
      ok = false
      top.calmBy *= 0.8
      if (next) next.calmBy *= 0.8
    }
    if (ok) break
  }
}

/**
 * Composes a scene. Controls are 0..1: softness sets the lens radius, intensity the
 * light level, horizon how high the ground reaches. variant 'plain' keeps the layout
 * but drops the organic parts (lobes, scene softness, light variation, light terms).
 * layout 'horizon': sky, light near the horizon, ground (Ramp-like). layout 'stack':
 * three to five bands in pack order with no light source (Bands-like).
 */
export function composeScene(opts) {
  return opts.layout === 'stack' ? composeStack(opts) : composeHorizon(opts)
}

/**
 * Bands in pack order, top to bottom, each at least 2.6 lens radii tall (dark ones 3.5),
 * unequal heights. Every boundary has its own shape; about half are light fading into
 * light (soft in the scene, adding where they overlap), half are outlines (sharp in some
 * stretches). One band may rise into the one above as a broad dome, a dark band may
 * swell on one side, a light band may send thin columns of light up into its neighbour.
 */
function composeStack({ pack, seed, aspect, softness = 0.5, intensity = 0.5, horizon = 0.5, variant = 'principle' }) {
  const rnd = random(seed * 6151 + pack.length * 17 + 3)
  const plain = variant === 'plain'
  const w = Math.max(aspect, 1)
  const h = Math.max(1 / aspect, 1)
  const R = lerp(0.045, 0.12, softness)
  const daylight = 2 ** ((intensity - 0.5) * 1.2)
  const [sky, ...rest] = PACKS[pack]
  const warms = rest.filter(isWarm)
  const warm = warms.length > 1 ? warms[rnd.int(0, warms.length - 1)] : warms[0]
  let colors = [sky, ...rest.filter((hex) => !isWarm(hex) || hex === warm)]
  // a pack with fewer than four such colors (Bold) gets the sky color again at the bottom, with less light
  const deepLast = colors.length < 4
  if (deepLast) colors.push(sky)
  // the brightest color after the sky always stays; the seed may drop up to two others (pack order is kept)
  const brightest = colors.slice(1).reduce((a, b) => (lightness(b) > lightness(a) ? b : a), colors[1])
  const droppable = () => colors.map((c, i) => i).filter((i) => i > 0 && colors[i] !== brightest && !(deepLast && i === colors.length - 1))
  const drops = Math.min(colors.length - 3, rnd.int(0, 2))
  for (let k = 0; k < drops; k++) {
    const d = droppable()
    if (d.length) colors.splice(d[rnd.int(0, d.length - 1)], 1)
  }
  const need = (hex, i) => (lightness(hex) < 0.45 || (deepLast && i === colors.length - 1) ? 3.5 : 2.6) * R
  while (colors.length > 3 && colors.reduce((s, c, i) => s + need(c, i), 0) > h * 0.95) {
    const d = droppable()
    if (!d.length) break
    colors.splice(d[rnd.int(0, d.length - 1)], 1)
  }
  const weights = colors.map(() => rnd.between(0.45, 1.9))
  const floors = colors.map(need)
  const extra = Math.max(0, h - floors.reduce((s, v) => s + v, 0))
  // the horizon control moves weight from the top bands to the bottom ones
  const tilt = lerp(1.4, 0.7, horizon)
  const ws = weights.map((v, i) => v * tilt ** ((i - (colors.length - 1) / 2) / ((colors.length - 1) / 2)))
  const spans = floors.map((f, i) => f + (extra * ws[i]) / ws.reduce((s, v) => s + v, 0))
  const bands = []
  let at = 0
  colors.forEach((hex, i) => {
    bands.push({ hex, kind: i === 0 ? 'sky' : 'band', topBase: at })
    at += spans[i]
  })
  if (deepLast) bands[bands.length - 1].deep = true

  bands.forEach((b, i) => {
    if (i === 0) return
    const lobes = []
    if (!plain) {
      const n = rnd.int(1, 3)
      for (let k = 0; k < n; k++) lobes.push({ x: rnd.between(-0.55, 0.55) * w, wl: rnd.between(0.2, 0.55), wr: rnd.between(0.2, 0.55), a: rnd.sign() * rnd.between(0.02, 0.06) })
    }
    b.lobes = lobes
    b.mode = i === 1 || rnd.chance(0.5) ? 'light' : 'cover'
    // distant hues meet as two lights that add, so the bridge goes pale instead of a strong mix
    if (!plain && hueGap(b.hex, bands[i - 1].hex) > 90) {
      b.mode = 'light'
      b.overlap = 0.5
    }
  })
  const lights = []
  if (!plain) {
    // a dome: a band lighter than the one above rises into it
    const domes = bands.map((b, i) => i).filter((i) => i >= 1 && lightness(bands[i].hex) > lightness(bands[i - 1].hex) + 0.05 && !bands[i].deep)
    if (domes.length && rnd.chance(0.75)) {
      const i = domes[rnd.int(0, domes.length - 1)]
      bands[i].lobes.push({ x: rnd.between(-0.35, 0.35) * w, wl: rnd.between(0.25, 0.5), wr: rnd.between(0.25, 0.5), a: -rnd.between(0.04, 0.08) })
    }
    // a dark mass: the darkest band swells into the band above on one side
    const darkest = bands.reduce((m, b, i) => (i > 0 && lightness(b.hex) < lightness(bands[m].hex) ? i : m), 1)
    if (lightness(bands[darkest].hex) < 0.45 && rnd.chance(0.6)) {
      bands[darkest].darkMass = true
      bands[darkest].lobes.push({ x: rnd.sign() * rnd.between(0.3, 0.55) * w, wl: rnd.between(0.3, 0.6), wr: rnd.between(0.3, 0.6), a: -rnd.between(0.03, 0.06) })
    }
    // thin columns of light: a light band sends streaks of its light up into the band above
    const lightest = bands.reduce((m, b, i) => (i > 0 && lightness(b.hex) > lightness(bands[m].hex) ? i : m), 1)
    if (rnd.chance(0.55)) {
      let x = rnd.between(-0.45, 0.1) * w
      const n = rnd.int(2, 4)
      for (let k = 0; k < n; k++) {
        x += rnd.between(0.08, 0.2)
        lights.push({ kind: 'column', band: lightest, x, half: rnd.between(0.006, 0.014), tall: rnd.between(0.08, 0.18), gain: rnd.between(0.35, 0.8), color: hexToLinear(bands[lightest].hex) })
      }
    }
  }
  bands.forEach((b, i) => {
    if (i === 0) return
    const isLight = b.mode === 'light'
    const shape = plain ? 0.004 : 0.02 * rnd.between(0.7, 1.4)
    const soft = plain ? 0 : isLight ? rnd.between(1.2, 2.6) * R : rnd.between(0.3, 0.8) * R
    b.boundary = makeBoundary(rnd, seed * 13 + i * 101, { base: b.topBase, shape, soft, softVary: plain ? 0 : isLight ? 0.35 : 0.9, lobes: b.lobes, calm: 0, frameW: w })
  })
  keepThick(bands, w, h, R)
  // light inside each band: slow patches and a lean of its own toward one side
  const vary = plain ? 0 : rnd.between(0.1, 0.17)
  bands.forEach((b, i) => {
    b.color = hexToLinear(b.hex)
    b.seed = seed * 97 + i * 13
    const lean = plain ? 0 : rnd.between(-0.3, 0.3)
    // a cool band next to a neighbour of similar lightness gets less light, so neighbours contrast
    const near = [bands[i - 1], bands[i + 1]].filter(Boolean)
    const similar = near.some((o) => Math.abs(lightness(o.hex) - lightness(b.hex)) < 0.1)
    b.gainBase = b.deep ? 0.5 : similar && !isWarm(b.hex) && !plain ? 0.75 : 1
    b.light = (x) => Math.exp((lean * x) / w)
  })
  if (!plain) {
    const nSpill = rnd.int(1, 2)
    for (let k = 0; k < nSpill; k++) {
      const bi = rnd.int(1, bands.length - 1)
      const nb = bands[rnd.chance(0.5) && bi + 1 < bands.length ? bi + 1 : bi - 1]
      const top = bands[bi].topBase
      const bottom = bi + 1 < bands.length ? bands[bi + 1].topBase : h
      // a neighbour's light only spills into a band of a close hue (or a near-grey one)
      if (hueGap(nb.hex, bands[bi].hex) > 90) continue
      lights.push({ kind: 'spill', band: bi, x: rnd.between(-0.4, 0.4) * w, y: lerp(top, bottom, rnd.between(0.3, 0.7)), sx: rnd.between(2.5, 5) * R, sy: rnd.between(0.9, 1.4) * R, gain: rnd.between(0.08, 0.18), color: hexToLinear(nb.hex) })
    }
    lights.push({ kind: 'shade', band: rnd.int(0, bands.length - 1), x: rnd.sign() * rnd.between(0.2, 0.45) * w, sx: rnd.between(0.15, 0.3) * w, amount: rnd.between(0.15, 0.3) })
  }
  return { pack, seed, aspect, w, h, R, daylight, bands, lights, vary, horizonY: h, horizonIndex: -1, overlap: plain ? 1 : 0.65, spill: plain ? 0 : 0.12, layout: 'stack' }
}

function composeHorizon({ pack, seed, aspect, softness = 0.5, intensity = 0.5, horizon = 0.5, variant = 'principle' }) {
  const rnd = random(seed * 7919 + pack.length * 31 + 7)
  const plain = variant === 'plain'
  const w = Math.max(aspect, 1)
  const h = Math.max(1 / aspect, 1)
  const R = lerp(0.045, 0.12, softness) // lens radius, short sides
  const role = roles(pack, rnd)
  const daylight = 2 ** ((intensity - 0.5) * 1.2)

  // vertical layout
  const hy = clamp(lerp(0.82, 0.42, horizon) + rnd.between(-0.08, 0.08), 0.3, 0.88) * h
  const glowH = Math.max(2.2 * R, rnd.between(0.12, 0.22) * h)
  const sunX = (rnd.chance(0.5) ? rnd.between(0.15, 0.42) : rnd.between(-0.42, -0.15)) * w
  // ground: pack order after the glow; every band at least 2.6 lens radii tall, dark ones 3.5
  let ground = role.ground.slice()
  if (ground.length === 0) ground = [role.sky]
  const room = h - hy
  const need = (hex) => (lightness(hex) < 0.45 ? 3.5 : 2.6) * R
  while (ground.length > 1 && ground.reduce((s, c) => s + need(c), 0) > room) {
    const k = ground.findIndex((c, i) => i > 0 && i < ground.length - 1 && lightness(c) < Math.min(lightness(ground[i - 1]), lightness(ground[i + 1])) - 0.15)
    ground.splice(k >= 0 ? k : ground.length - 1, 1)
  }
  const weights = ground.map(() => rnd.between(0.6, 1.5))
  const floors = ground.map(need)
  const extra = Math.max(0, room - floors.reduce((s, v) => s + v, 0))
  const spans = floors.map((f, i) => f + (extra * weights[i]) / weights.reduce((s, v) => s + v, 0))

  // bands top to bottom: sky, upper colors, glow (light), ground (silhouettes)
  const bands = [{ hex: role.sky, kind: 'sky' }]
  let at = hy - glowH
  const upperTops = []
  for (let i = role.upper.length - 1; i >= 0; i--) {
    at -= Math.max(2.2 * R, rnd.between(0.1, 0.2) * h)
    upperTops.unshift(Math.max(0.12 * h, at))
  }
  role.upper.forEach((hex, i) => bands.push({ hex, kind: 'upper', topBase: upperTops[i] }))
  bands.push({ hex: role.glow, kind: 'glow', topBase: hy - glowH })
  let gy = hy
  ground.forEach((hex, i) => {
    bands.push({ hex, kind: i === 0 ? 'horizon' : 'ground', topBase: gy })
    gy += spans[i]
  })
  const glowIndex = bands.findIndex((b) => b.kind === 'glow')
  const horizonIndex = bands.findIndex((b) => b.kind === 'horizon')

  bands.forEach((b, i) => {
    if (i === 0) return
    const isLight = b.kind === 'upper' || b.kind === 'glow'
    const isHorizon = b.kind === 'horizon'
    const lobes = []
    if (!plain) {
      const n = rnd.int(isHorizon ? 0 : 1, isHorizon ? 2 : 3)
      for (let k = 0; k < n; k++) lobes.push({ x: rnd.between(-0.55, 0.55) * w, wl: rnd.between(0.2, 0.55), wr: rnd.between(0.2, 0.55), a: rnd.sign() * rnd.between(0.02, isHorizon ? 0.035 : 0.06) })
      // a dark mass: the first dark ground band swells up on one side
      if (!isLight && lightness(b.hex) < 0.45 && !bands.some((o) => o.darkMass) && rnd.chance(0.6)) {
        b.darkMass = true
        lobes.push({ x: rnd.sign() * rnd.between(0.3, 0.55) * w, wl: rnd.between(0.3, 0.6), wr: rnd.between(0.3, 0.6), a: -rnd.between(0.03, 0.06) })
      }
      // a dome: the glow rises over the light source
      if (b.kind === 'glow' && rnd.chance(0.7)) lobes.push({ x: sunX + rnd.between(-0.1, 0.1), wl: rnd.between(0.25, 0.5), wr: rnd.between(0.25, 0.5), a: -rnd.between(0.03, 0.065) })
    }
    const shape = plain ? 0.004 : (isHorizon ? 0.012 : isLight ? 0.024 : 0.018) * rnd.between(0.7, 1.4)
    // light transitions are soft in the scene; silhouettes are sharp in places and soft in others
    b.mode = isLight ? 'light' : 'cover'
    const soft = plain ? 0 : isLight ? rnd.between(1.2, 2.6) * R : rnd.between(0.3, 0.8) * R
    const softVary = plain ? 0 : isLight ? 0.35 : 0.9
    b.boundary = makeBoundary(rnd, seed * 13 + i * 101, { base: b.topBase, shape, soft, softVary, lobes, calm: isHorizon ? 0.6 : 0, frameW: w })
  })
  keepThick(bands, w, h, R)

  // light inside each band
  const sunW = rnd.between(0.35, 0.6) * w
  const lateral = (x) => 1 / (1 + ((x - sunX) / sunW) ** 2)
  const vary = plain ? 0 : rnd.between(0.1, 0.17)
  bands.forEach((b, i) => {
    b.color = hexToLinear(b.hex)
    b.seed = seed * 97 + i * 13
    const dark = lightness(b.hex) < 0.45
    b.gainBase = b.kind === 'horizon' && b.hex === role.sky ? 0.5 : 1
    if (b.kind === 'sky') b.light = (x, y) => (1 + 0.15 * lateral(x)) * Math.exp(-0.4 * clamp((hy - glowH - y) / h, 0, 1))
    else if (b.kind === 'glow') {
      const peak = rnd.between(0.3, 0.7)
      b.light = (x) => 1 + peak * lateral(x)
    } else if (b.kind === 'horizon') b.light = (x) => (dark ? 0.85 + 0.35 * lateral(x) : 0.85 + 0.3 * lateral(x))
    else b.light = () => 0.92
  })

  // light terms (soft light in the scene, added)
  const glowColor = hexToLinear(role.glow)
  const lights = []
  lights.push({ kind: 'dome', x: sunX, y: hy + rnd.between(0.02, 0.06), sx: rnd.between(0.3, 0.5) * w, sy: rnd.between(0.18, 0.32), gain: plain ? 0.25 : rnd.between(0.25, 0.45), color: glowColor })
  if (!plain) {
    const nSpill = rnd.int(1, 2)
    for (let k = 0; k < nSpill; k++) {
      const bi = rnd.int(1, bands.length - 1)
      const nb = bands[bi - 1]
      const top = bands[bi].topBase
      const bottom = bi + 1 < bands.length ? bands[bi + 1].topBase : h
      if (hueGap(nb.hex, bands[bi].hex) > 90) continue
      lights.push({ kind: 'spill', band: bi, x: rnd.between(-0.4, 0.4) * w, y: lerp(top, bottom, rnd.between(0.3, 0.7)), sx: rnd.between(2.5, 5) * R, sy: rnd.between(0.9, 1.4) * R, gain: rnd.between(0.08, 0.2), color: hexToLinear(nb.hex) })
    }
    const di = rnd.int(1, bands.length - 1)
    lights.push({ kind: 'shade', band: di, x: rnd.sign() * rnd.between(0.2, 0.45) * w, sx: rnd.between(0.15, 0.3) * w, amount: rnd.between(0.15, 0.3) })
    if (rnd.chance(0.6)) {
      const from = rnd.chance(0.5) ? horizonIndex : glowIndex
      let x = sunX + rnd.between(-0.35, 0.05) * w
      const n = rnd.int(2, 4)
      for (let k = 0; k < n; k++) {
        x += rnd.between(0.08, 0.2)
        lights.push({ kind: 'column', band: from, x, half: rnd.between(0.006, 0.014), tall: rnd.between(0.08, 0.18), gain: rnd.between(0.4, 0.9), color: glowColor })
      }
    }
    if (rnd.chance(0.5)) lights.push({ kind: 'rim', x0: sunX - rnd.between(0.2, 0.5) * w, x1: sunX + rnd.between(0.2, 0.5) * w, t: rnd.between(0.006, 0.014), gain: rnd.between(0.8, 1.6), color: glowColor })
  }

  return { pack, seed, aspect, w, h, R, daylight, bands, lights, role, vary, horizonY: hy, horizonIndex, overlap: plain ? 1 : 0.65, spill: plain ? 0 : 0.12 }
}

function bandLight(sc, b, x, y) {
  let g = b.gainBase * b.light(x, y)
  if (sc.vary > 0) {
    const n = (gradientNoise(x / 0.6 + 3.1, y / 0.5 + 1.7, b.seed) + 0.3 * gradientNoise(x / 0.33 + 9.4, y / 0.3 + 4.2, b.seed + 1)) / (NOISE_RMS * 1.044)
    g *= Math.exp(sc.vary * n)
  }
  return [b.color[0] * g, b.color[1] * g, b.color[2] * g]
}

/**
 * Radiance of the scene at (x, y) in linear RGB. Bands are laid top to bottom: a light
 * band fades in over its soft width and adds to the light above it (each light keeps
 * more of its strength across the overlap than a plain mix: weight^overlap), a ground
 * band covers what is above it with a hard edge.
 */
export function radiance(sc, x, y) {
  const { bands } = sc
  let c = bandLight(sc, bands[0], x, y)
  let shadeBand = 0
  for (let i = 1; i < bands.length; i++) {
    const b = bands[i]
    const d = y - b.boundary.y(x)
    const sw = b.boundary.soft(x) / 0.8 // smoothstep 10-90 is 0.8 of its full width
    const t = sw > 1e-4 ? smooth(0.5 + d / sw) : d >= 0 ? 1 : 0
    if (t <= 0) continue
    const n = bandLight(sc, b, x, y)
    if (b.mode === 'cover') {
      c = [c[0] + (n[0] - c[0]) * t, c[1] + (n[1] - c[1]) * t, c[2] + (n[2] - c[2]) * t]
      if (t > 0.5) shadeBand = i
      continue
    }
    const ov = b.overlap ?? sc.overlap
    const ka = (1 - t) ** ov
    const kb = t ** ov
    c = [c[0] * ka + n[0] * kb, c[1] * ka + n[1] * kb, c[2] * ka + n[2] * kb]
    if (t > 0.5) shadeBand = i
  }
  let [r, gg, bb] = c
  const add = (col, k) => {
    r += col[0] * k
    gg += col[1] * k
    bb += col[2] * k
  }
  // a lighter neighbour spills a little light across the boundary (haze, glare), so the
  // dark side is lit most next to the bright one and a bridge never dips
  if (sc.spill > 0) {
    const b = bands[shadeBand]
    const lb = b.lightness ?? (b.lightness = lightness(b.hex))
    const above = shadeBand > 0 ? bands[shadeBand - 1] : null
    const below = shadeBand + 1 < bands.length ? bands[shadeBand + 1] : null
    if (above && (above.lightness ?? (above.lightness = lightness(above.hex))) > lb + 0.1) {
      const d = Math.max(0, y - b.boundary.y(x))
      add(above.color, sc.spill * above.gainBase * Math.exp(-d / (1.2 * sc.R)))
    }
    if (below && (below.lightness ?? (below.lightness = lightness(below.hex))) > lb + 0.1) {
      const d = Math.max(0, below.boundary.y(x) - y)
      add(below.color, sc.spill * below.gainBase * Math.exp(-d / (1.2 * sc.R)))
    }
  }
  // a lighter neighbour spills a little light across the boundary (haze, glare), so the
  // dark side is lit most next to the bright one and a bridge never dips
  if (sc.spill > 0) {
    const b = bands[shadeBand]
    const lb = b.lightness ?? (b.lightness = lightness(b.hex))
    const above = shadeBand > 0 ? bands[shadeBand - 1] : null
    const below = shadeBand + 1 < bands.length ? bands[shadeBand + 1] : null
    if (above && (above.lightness ?? (above.lightness = lightness(above.hex))) > lb + 0.1) {
      const d = Math.max(0, y - b.boundary.y(x))
      add(above.color, sc.spill * above.gainBase * Math.exp(-d / (1.2 * sc.R)))
    }
    if (below && (below.lightness ?? (below.lightness = lightness(below.hex))) > lb + 0.1) {
      const d = Math.max(0, below.boundary.y(x) - y)
      add(below.color, sc.spill * below.gainBase * Math.exp(-d / (1.2 * sc.R)))
    }
  }
  const hb = sc.horizonIndex > 0 ? bands[sc.horizonIndex].boundary.y(x) : sc.h
  for (const l of sc.lights) {
    if (l.kind === 'dome') {
      const dx = (x - l.x) / l.sx
      const dy = (y - l.y) / l.sy
      const d2 = dx * dx + dy * dy
      add(l.color, l.gain * (y < hb ? 1 : 0.3) * (0.5 * Math.exp(-2 * d2) + 0.5 / (1 + 4 * d2)))
    } else if (l.kind === 'spill' && shadeBand === l.band) {
      const dx = (x - l.x) / l.sx
      const dy = (y - l.y) / l.sy
      add(l.color, l.gain * Math.exp(-0.5 * (dx * dx + dy * dy)))
    } else if (l.kind === 'shade' && shadeBand === l.band) {
      const k = 1 - l.amount * Math.exp(-0.5 * ((x - l.x) / l.sx) ** 2)
      r *= k
      gg *= k
      bb *= k
    } else if (l.kind === 'column') {
      const top = bands[l.band].boundary.y(l.x)
      if (Math.abs(x - l.x) < l.half && y < top + 0.01 && y > top - l.tall) add(l.color, l.gain * (1 - (top - y) / l.tall))
    } else if (l.kind === 'rim') {
      if (x > l.x0 && x < l.x1 && y < hb && y > hb - l.t) add(l.color, l.gain * Math.sin((Math.PI * (x - l.x0)) / (l.x1 - l.x0)))
    }
  }
  const k = sc.daylight
  return [r * k, gg * k, bb * k]
}

/** Rasterizes the scene at W x H pixels with ss x ss samples per pixel. */
export function rasterize(sc, W, H, ss = 2) {
  const S = Math.min(W, H)
  const r = new Float32Array(W * H)
  const g = new Float32Array(W * H)
  const b = new Float32Array(W * H)
  const inv = 1 / (ss * ss)
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      let ar = 0
      let ag = 0
      let ab = 0
      for (let j = 0; j < ss; j++) {
        for (let i = 0; i < ss; i++) {
          const c = radiance(sc, (px + (i + 0.5) / ss) / S - sc.w / 2, (py + (j + 0.5) / ss) / S)
          ar += c[0]
          ag += c[1]
          ab += c[2]
        }
      }
      const k = py * W + px
      r[k] = ar * inv
      g[k] = ag * inv
      b[k] = ab * inv
    }
  }
  return { w: W, h: H, r, g, b }
}
