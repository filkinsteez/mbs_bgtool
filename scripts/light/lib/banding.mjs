// Banding score for the landing sheet (scripts/light/landing-sheet.mjs): how many hue bands a frame stacks as stripes
// along a line through its glow. A hint for the eye, not a gate (coordinator, 2026-11-11 5:23 PM).
//
// Lines run through the brightest place of the frame at evenly spaced angles. Along each line, a band is a stretch
// whose hue stays within `tolerance` of where it started for at least `band` px; grey and dark samples are skipped.
// A sharp step is a place where the hue turns fast (its slope peaks well above the line's usual slope) and far within
// a short stretch; a turn spread over a longer stretch is a blend. The score is the most bands found on one line,
// with the most sharp steps on one line beside it.

/** sRGB byte to linear light. */
export const LIN = Float32Array.from({ length: 256 }, (_, i) => {
  const v = i / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
})

/** Linear sRGB to Oklab [L, a, b]. */
export function oklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}

export const BANDING = {
  blur: 2, // px: box blur of the Oklab planes before the hue is read (renders 480 px on the long side)
  glowBlur: 12, // px: box blur that finds the brightest place
  minChroma: 0.03, // greyer samples have no reliable hue and are skipped
  minL: 0.25, // darker samples are skipped
  tolerance: 35, // degrees a band's hue may move from where the band started
  band: 10, // px: shorter stretches are transitions, not bands
  slope: 1.5, // degrees of hue per px at a step's peak, at least
  rise: 3, // and this many times the line's median slope
  turn: 12, // degrees the hue turns across a step, at least
  width: 24, // px: a step turns within this stretch; a longer turn is a blend
  gap: 6, // px between two steps
  angles: 12, // lines through the brightest place
}

const turnBetween = (h1, h0) => ((((h1 - h0) % 360) + 540) % 360) - 180

function boxBlur(src, w, h, r) {
  if (r <= 0) return src
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  const k = 2 * r + 1
  for (let y = 0; y < h; y++) {
    const row = y * w
    let acc = 0
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))]
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / k
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)]
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / k
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]
    }
  }
  return out
}

const colored = ({ L, a, b }, opts) => L >= opts.minL && Math.hypot(a, b) >= opts.minChroma
const hueOf = ({ a, b }) => (Math.atan2(b, a) * 180) / Math.PI

/** The hue bands along one line of samples ({ L, a, b } in Oklab, 1 px apart): [{ from, to, hue, n }]. */
export function hueBands(samples, opts = BANDING) {
  const bands = []
  let current = null
  const close = () => {
    if (current && current.n >= opts.band) bands.push(current)
    current = null
  }
  samples.forEach((sample, i) => {
    if (!colored(sample, opts)) return
    const hue = hueOf(sample)
    if (current && Math.abs(turnBetween(hue, current.hue)) <= opts.tolerance) {
      current.to = i
      current.n++
      return
    }
    close()
    current = { from: i, to: i, hue, n: 1 }
  })
  close()
  const merged = []
  for (const band of bands) {
    const last = merged.at(-1)
    if (last && Math.abs(turnBetween(band.hue, last.hue)) <= opts.tolerance) {
      last.to = band.to
      last.n += band.n
    } else merged.push({ ...band })
  }
  return merged
}

/** The sharp steps along one line of samples ({ L, a, b } in Oklab, 1 px apart): [{ at, turn }], `at` the index. */
export function hueSteps(samples, opts = BANDING) {
  const n = samples.length
  const hue = new Float32Array(n)
  const ok = new Uint8Array(n)
  samples.forEach((sample, i) => {
    ok[i] = colored(sample, opts) ? 1 : 0
    hue[i] = hueOf(sample)
  })
  const slope = new Float32Array(n)
  const slopes = []
  for (let i = 1; i < n - 1; i++) {
    if (!(ok[i - 1] && ok[i] && ok[i + 1])) continue
    slope[i] = turnBetween(hue[i + 1], hue[i - 1]) / 2
    slopes.push(Math.abs(slope[i]))
  }
  if (slopes.length < 3 * opts.gap) return []
  slopes.sort((x, y) => x - y)
  const floor = Math.max(opts.slope, opts.rise * slopes[slopes.length >> 1])
  const half = opts.gap >> 1
  const steps = []
  for (let i = 1; i < n - 1; i++) {
    const s = Math.abs(slope[i])
    if (s < floor) continue
    let peak = true
    for (let j = Math.max(1, i - half); j <= Math.min(n - 2, i + half) && peak; j++) {
      const sj = Math.abs(slope[j])
      if (sj > s || (sj === s && j < i)) peak = false
    }
    if (!peak) continue
    const sign = Math.sign(slope[i])
    const keeps = (j) => ok[j] && Math.sign(slope[j]) === sign && Math.abs(slope[j]) >= s / 4
    let lo = i
    let hi = i
    while (lo > 1 && keeps(lo - 1)) lo--
    while (hi < n - 2 && keeps(hi + 1)) hi++
    if (hi - lo + 1 > opts.width) continue
    const turn = Math.abs(turnBetween(hue[hi + 1], hue[lo - 1]))
    if (turn < opts.turn) continue
    const last = steps.at(-1)
    if (last && i - last.at < opts.gap) {
      if (turn > last.turn) steps[steps.length - 1] = { at: i, turn }
      continue
    }
    steps.push({ at: i, turn })
  }
  return steps
}

/** The pixels of the line through `c` in direction `d`, from one edge of a w by h frame to the other, 1 px apart. */
export function linePoints(c, d, w, h) {
  let lo = -Infinity
  let hi = Infinity
  for (const [p, v, size] of [
    [c[0], d[0], w],
    [c[1], d[1], h],
  ]) {
    if (Math.abs(v) < 1e-9) continue
    const [t1, t2] = [(0 - p) / v, (size - 1 - p) / v]
    lo = Math.max(lo, Math.min(t1, t2))
    hi = Math.min(hi, Math.max(t1, t2))
  }
  const points = []
  for (let t = Math.ceil(lo); t <= Math.floor(hi); t++) points.push([Math.round(c[0] + t * d[0]), Math.round(c[1] + t * d[1])])
  return points
}

/**
 * The banding score of an sRGB frame (3 bytes a pixel): `bands`, the most hue bands on one line through the brightest
 * place, and `sharp`, the most sharp steps on one line; `glow`, that place; `angle` (degrees, 0 = across, 90 = down)
 * and `line` ([start, end]) of the line with the most bands.
 */
export function bandingScore(rgb, w, h, opts = BANDING) {
  const n = w * h
  const planes = [new Float32Array(n), new Float32Array(n), new Float32Array(n)]
  for (let i = 0; i < n; i++) {
    const lab = oklab([LIN[rgb[3 * i]], LIN[rgb[3 * i + 1]], LIN[rgb[3 * i + 2]]])
    for (let k = 0; k < 3; k++) planes[k][i] = lab[k]
  }
  const [L, A, B] = planes.map((p) => boxBlur(p, w, h, opts.blur))
  const glow = boxBlur(planes[0], w, h, opts.glowBlur)
  let at = 0
  for (let i = 1; i < n; i++) if (glow[i] > glow[at]) at = i
  const c = [at % w, Math.floor(at / w)]
  const best = { bands: 0, sharp: 0, glow: c, angle: 0, line: null }
  for (let k = 0; k < opts.angles; k++) {
    const angle = (k * 180) / opts.angles
    const rad = (angle * Math.PI) / 180
    const points = linePoints(c, [Math.cos(rad), Math.sin(rad)], w, h)
    const samples = points.map(([x, y]) => ({ L: L[y * w + x], a: A[y * w + x], b: B[y * w + x] }))
    const bands = hueBands(samples, opts).length
    if (bands > best.bands) Object.assign(best, { bands, angle, line: [points[0], points.at(-1)] })
    best.sharp = Math.max(best.sharp, hueSteps(samples, opts).length)
  }
  return best
}
