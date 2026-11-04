// Grain measurement on 8-bit sRGB images, the same for reference images and renders.
// The grain is the high-pass residual: each plane minus its gaussian blur of `hpSigma` px.
const SRGB_TO_LINEAR = Array.from({ length: 256 }, (_, v) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
})
const LUMA = [0.2126, 0.7152, 0.0722]

/** Oklab L, a, b planes and the 8-bit luma (Rec. 709 weights on the encoded values) of an RGBA image. */
export function grainPlanes(image) {
  const n = image.width * image.height
  const L = new Float32Array(n)
  const A = new Float32Array(n)
  const B = new Float32Array(n)
  const Y = new Float32Array(n)
  const R = new Float32Array(n)
  const G = new Float32Array(n)
  const Bl = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const r8 = image.data[i * 4]
    const g8 = image.data[i * 4 + 1]
    const b8 = image.data[i * 4 + 2]
    const r = SRGB_TO_LINEAR[r8]
    const g = SRGB_TO_LINEAR[g8]
    const b = SRGB_TO_LINEAR[b8]
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    L[i] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
    A[i] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
    B[i] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
    Y[i] = LUMA[0] * r8 + LUMA[1] * g8 + LUMA[2] * b8
    R[i] = r8
    G[i] = g8
    Bl[i] = b8
  }
  return { L, A, B, Y, R, G, Bl }
}

// Box widths for three box passes that approximate a gaussian of sigma (Kovesi, "Fast almost-gaussian filtering").
function boxWidths(sigma) {
  const ideal = Math.sqrt((12 * sigma * sigma) / 3 + 1)
  let lo = Math.floor(ideal)
  if (lo % 2 === 0) lo--
  const hi = lo + 2
  const m = Math.round((12 * sigma * sigma - 3 * lo * lo - 12 * lo - 9) / (-4 * lo - 4))
  return [0, 1, 2].map((k) => (k < m ? lo : hi))
}

function boxPass(src, dst, w, h, radius, horizontal) {
  const lines = horizontal ? h : w
  const len = horizontal ? w : h
  const stride = horizontal ? 1 : w
  const scale = 1 / (2 * radius + 1)
  const last = len - 1
  for (let line = 0; line < lines; line++) {
    const start = horizontal ? line * w : line
    const first = src[start]
    const end = src[start + last * stride]
    let sum = 0
    for (let k = -radius; k <= radius; k++) sum += src[start + (k < 0 ? 0 : k > last ? last : k) * stride]
    for (let k = 0; k < len; k++) {
      dst[start + k * stride] = sum * scale
      const add = k + radius + 1
      const drop = k - radius
      sum += (add > last ? end : src[start + add * stride]) - (drop < 0 ? first : src[start + drop * stride])
    }
  }
}

/** Gaussian blur of a plane (three box passes each way, edges repeated). */
export function blurPlane(plane, w, h, sigma) {
  if (sigma <= 0) return Float32Array.from(plane)
  let a = Float32Array.from(plane)
  let b = new Float32Array(plane.length)
  for (const width of boxWidths(sigma)) {
    const radius = (width - 1) / 2
    boxPass(a, b, w, h, radius, true)
    boxPass(b, a, w, h, radius, false)
  }
  return a
}

/**
 * Pixels to measure: away from the border, outside `rects` ([x, y, w, h]) and rounded corners, and away from
 * mid-scale structure (edges, folds, text), where the residual is not grain. Structure: the difference of the L
 * plane blurred at 0.4 and 1.6 hpSigma, above `structure` (Oklab L), grown by hpSigma. At 0.012 the coarse mottle of
 * riso-strength grain counts as structure and its grainiest areas drop out (a riso print measured 1.03 % on 21 % of
 * its pixels, against 1.70 % on 92 % at 0.04); ink edges, rims and bands still count at 0.04.
 */
export function grainMask(planes, w, h, { hpSigma, rects = [], cornerRadius = 0, structure = 0.04 }) {
  const mask = new Uint8Array(w * h)
  const border = Math.ceil(2 * hpSigma) + 2
  for (let y = border; y < h - border; y++) for (let x = border; x < w - border; x++) mask[y * w + x] = 1
  for (const [rx, ry, rw, rh] of rects) {
    for (let y = Math.max(0, ry); y < Math.min(h, ry + rh); y++) for (let x = Math.max(0, rx); x < Math.min(w, rx + rw); x++) mask[y * w + x] = 0
  }
  if (cornerRadius > 0) {
    const r = cornerRadius + border
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = Math.max(r - x, x - (w - 1 - r), 0)
        const dy = Math.max(r - y, y - (h - 1 - r), 0)
        if (dx > 0 && dy > 0 && Math.hypot(dx, dy) > r - border) mask[y * w + x] = 0
      }
    }
  }
  if (structure > 0) {
    const fine = blurPlane(planes.L, w, h, Math.max(1, 0.4 * hpSigma))
    const coarse = blurPlane(planes.L, w, h, 1.6 * hpSigma)
    const bad = new Float32Array(w * h)
    for (let i = 0; i < bad.length; i++) bad[i] = Math.abs(fine[i] - coarse[i]) > structure ? 1 : 0
    const grown = blurPlane(bad, w, h, hpSigma)
    for (let i = 0; i < mask.length; i++) if (grown[i] > 0.02) mask[i] = 0
  }
  return mask
}

function robustStd(values) {
  if (values.length === 0) return NaN
  const sorted = Float64Array.from(values).sort()
  const median = sorted[sorted.length >> 1]
  const deviations = sorted.map((v) => Math.abs(v - median)).sort()
  return 1.4826 * deviations[deviations.length >> 1]
}

function rms(values) {
  if (values.length === 0) return NaN
  let mean = 0
  for (const v of values) mean += v
  mean /= values.length
  let sum = 0
  for (const v of values) sum += (v - mean) ** 2
  return Math.sqrt(sum / values.length)
}

function moments(values) {
  const n = values.length
  let mean = 0
  for (const v of values) mean += v
  mean /= n
  let m2 = 0
  let m3 = 0
  let m4 = 0
  for (const v of values) {
    const d = v - mean
    m2 += d * d
    m3 += d * d * d
    m4 += d * d * d * d
  }
  m2 /= n
  m3 /= n
  m4 /= n
  return { std: Math.sqrt(m2), skew: m2 > 0 ? m3 / m2 ** 1.5 : 0, kurtosis: m2 > 0 ? m4 / (m2 * m2) - 3 : 0 }
}

function correlation(a, b) {
  let ma = 0
  let mb = 0
  for (let i = 0; i < a.length; i++) {
    ma += a[i]
    mb += b[i]
  }
  ma /= a.length
  mb /= b.length
  let ab = 0
  let aa = 0
  let bb = 0
  for (let i = 0; i < a.length; i++) {
    ab += (a[i] - ma) * (b[i] - mb)
    aa += (a[i] - ma) ** 2
    bb += (b[i] - mb) ** 2
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0
}

// Deterministic sample of masked pixel indices (every k-th), at most `limit`.
function sampleIndices(mask, limit) {
  let count = 0
  for (const v of mask) count += v
  const step = Math.max(1, Math.floor(count / limit))
  const out = []
  let seen = 0
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue
    if (seen++ % step === 0) out.push(i)
  }
  return out
}

/**
 * Radial autocorrelation of a residual plane at lags 0..maxLag px and its half width (the lag where it falls to
 * 0.5). White per-pixel noise has a half width of about 0.5 px; a gaussian clump of sigma s about 1.67 s.
 */
export function radialAutocorrelation(hp, mask, w, h, maxLag = 8, limit = 300_000) {
  const sample = sampleIndices(mask, limit)
  let mean = 0
  for (const i of sample) mean += hp[i]
  mean /= sample.length
  let v0 = 0
  for (const i of sample) v0 += (hp[i] - mean) ** 2
  v0 /= sample.length
  const sums = new Float64Array(maxLag + 1)
  const counts = new Float64Array(maxLag + 1)
  for (let dy = -maxLag; dy <= maxLag; dy++) {
    for (let dx = -maxLag; dx <= maxLag; dx++) {
      const r = Math.round(Math.hypot(dx, dy))
      if (r > maxLag) continue
      let s = 0
      let c = 0
      for (const i of sample) {
        const x = i % w
        const y = (i - x) / w
        const x2 = x + dx
        const y2 = y + dy
        if (x2 < 0 || y2 < 0 || x2 >= w || y2 >= h) continue
        const j = y2 * w + x2
        if (!mask[j]) continue
        s += (hp[i] - mean) * (hp[j] - mean)
        c++
      }
      if (c) {
        sums[r] += s / c / v0
        counts[r]++
      }
    }
  }
  const radial = Array.from(sums, (s, r) => (counts[r] ? s / counts[r] : 0))
  let half = maxLag
  for (let k = 1; k < radial.length; k++) {
    if (radial[k] <= 0.5) {
      half = k - 1 + (radial[k - 1] - 0.5) / (radial[k - 1] - radial[k])
      break
    }
  }
  return { radial, half }
}

function fft(re, im) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    for (let i = 0; i < n; i += len) {
      for (let j = 0; j < len / 2; j++) {
        const cr = Math.cos(ang * j)
        const ci = Math.sin(ang * j)
        const k = i + j + len / 2
        const br = re[k] * cr - im[k] * ci
        const bi = re[k] * ci + im[k] * cr
        re[k] = re[i + j] - br
        im[k] = im[i + j] - bi
        re[i + j] += br
        im[i + j] += bi
      }
    }
  }
}

/**
 * Radially averaged power spectrum of the residual over n x n windows that lie at least 95 % inside the mask (Hann
 * window, averaged; masked-out pixels count as 0), in cycles per pixel. `highShare` is the share of power above
 * 0.25 cycles/px: white per-pixel noise has about 0.8, clumped grain much less.
 */
export function residualSpectrum(hp, mask, w, h, n = 64, maxWindows = 48) {
  const windows = []
  for (let y0 = 0; y0 + n <= h && windows.length < 4 * maxWindows; y0 += n) {
    for (let x0 = 0; x0 + n <= w; x0 += n) {
      let inside = 0
      for (let y = y0; y < y0 + n; y += 4) for (let x = x0; x < x0 + n; x += 4) inside += mask[y * w + x]
      if (inside >= 0.95 * (n / 4) * (n / 4)) windows.push([x0, y0])
    }
  }
  if (windows.length < 3) return null
  const step = Math.max(1, Math.floor(windows.length / maxWindows))
  const power = new Float64Array(n * n)
  let used = 0
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  const gridRe = new Float64Array(n * n)
  const gridIm = new Float64Array(n * n)
  for (let k = 0; k < windows.length; k += step) {
    const [x0, y0] = windows[k]
    let mean = 0
    let inside = 0
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = (y0 + y) * w + x0 + x
        if (!mask[i]) continue
        mean += hp[i]
        inside++
      }
    }
    mean /= inside || 1
    for (let y = 0; y < n; y++) {
      const wy = 0.5 - 0.5 * Math.cos((2 * Math.PI * (y + 0.5)) / n)
      for (let x = 0; x < n; x++) {
        const wx = 0.5 - 0.5 * Math.cos((2 * Math.PI * (x + 0.5)) / n)
        const i = (y0 + y) * w + x0 + x
        gridRe[y * n + x] = mask[i] ? (hp[i] - mean) * wx * wy : 0
        gridIm[y * n + x] = 0
      }
    }
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        re[x] = gridRe[y * n + x]
        im[x] = gridIm[y * n + x]
      }
      fft(re, im)
      for (let x = 0; x < n; x++) {
        gridRe[y * n + x] = re[x]
        gridIm[y * n + x] = im[x]
      }
    }
    for (let x = 0; x < n; x++) {
      for (let y = 0; y < n; y++) {
        re[y] = gridRe[y * n + x]
        im[y] = gridIm[y * n + x]
      }
      fft(re, im)
      for (let y = 0; y < n; y++) power[y * n + x] += re[y] ** 2 + im[y] ** 2
    }
    used++
  }
  const bins = n / 2
  const radial = new Float64Array(bins)
  const counts = new Float64Array(bins)
  let total = 0
  let high = 0
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const fx = (x < n / 2 ? x : x - n) / n
      const fy = (y < n / 2 ? y : y - n) / n
      const f = Math.hypot(fx, fy)
      if (f === 0) continue
      const p = power[y * n + x]
      total += p
      if (f > 0.25) high += p
      const bin = Math.round(f * n)
      if (bin < bins) {
        radial[bin] += p
        counts[bin]++
      }
    }
  }
  const curve = Array.from(radial, (p, i) => (counts[i] ? p / counts[i] : 0))
  const plateau = (curve[2] + curve[3] + curve[4]) / 3
  let halfFrequency = 0.5
  for (let i = 3; i < bins; i++) {
    if (curve[i] < plateau / 2) {
      halfFrequency = i / n
      break
    }
  }
  return { windows: used, highShare: total > 0 ? high / total : 0, halfFrequency, curve: curve.map((p) => p / (plateau || 1)) }
}

/**
 * Banding: the share of measured pixels in runs of 16 px or more of one 8-bit color (all three channels) along
 * which the blurred luma changes by more than half a code value, both ways. Runs of exact black are left out:
 * nothing can dither below 0.
 */
export function flatRunShare(planes, lowY, mask, w, h) {
  let flagged = 0
  let count = 0
  const same = (i, p) => planes.R[i] === planes.R[p] && planes.G[i] === planes.G[p] && planes.Bl[i] === planes.Bl[p]
  const runs = (horizontal) => {
    const lines = horizontal ? h : w
    const len = horizontal ? w : h
    for (let line = 0; line < lines; line++) {
      let start = 0
      for (let k = 1; k <= len; k++) {
        const i = horizontal ? line * w + k : k * w + line
        const p = horizontal ? line * w + k - 1 : (k - 1) * w + line
        if (k < len && same(i, p)) continue
        const runLength = k - start
        if (runLength >= 16) {
          const a = horizontal ? line * w + start : start * w + line
          const b = p
          const black = planes.R[a] === 0 && planes.G[a] === 0 && planes.Bl[a] === 0
          if (!black && mask[a] && mask[b] && Math.abs(lowY[a] - lowY[b]) > 0.5) flagged += runLength
        }
        start = k
      }
    }
  }
  runs(true)
  runs(false)
  for (const v of mask) count += v
  return count ? flagged / (2 * count) : 0
}

const BANDS = [
  ['shadows', 0, 0.35],
  ['mids', 0.35, 0.7],
  ['highlights', 0.7, 1.01],
]

/**
 * Grain statistics of an RGBA image. Amplitudes are standard deviations of the residual over the measured pixels:
 * Oklab L in % (0.01 L = 1 %) and 8-bit luma in code values; `robustStdL` (1.4826 x median absolute deviation)
 * reads sparse specks as almost nothing, so the two differ for speckle and agree for film grain. Lightness bands
 * use the blurred L. `mono` is var(L) / (var(L) + var(a) + var(b)) of the residual. Specks are residuals beyond
 * 3 standard deviations.
 */
export function measureGrain(image, { hpSigma, rects = [], cornerRadius = 0, structure = 0.04, minBin = 1500, mask: given } = {}) {
  const { width: w, height: h } = image
  const short = Math.min(w, h)
  const sigma = hpSigma ?? Math.max(2, 0.0065 * short)
  const planes = grainPlanes(image)
  // A mask from the same frame without grain keeps coarse grain from being taken for structure.
  const mask = given ?? grainMask(planes, w, h, { hpSigma: sigma, rects, cornerRadius, structure })
  const lowL = blurPlane(planes.L, w, h, sigma)
  const residual = {}
  let lowY = null
  for (const key of ['L', 'A', 'B', 'Y', 'R', 'G', 'Bl']) {
    const low = key === 'L' ? lowL : blurPlane(planes[key], w, h, sigma)
    if (key === 'Y') lowY = low
    const hp = new Float32Array(w * h)
    for (let i = 0; i < hp.length; i++) hp[i] = planes[key][i] - low[i]
    residual[key] = hp
  }
  const pick = (key, test) => {
    const plane = residual[key]
    let count = 0
    for (let i = 0; i < mask.length; i++) if (mask[i] && (!test || test(i))) count++
    const out = new Float32Array(count)
    let k = 0
    for (let i = 0; i < mask.length; i++) if (mask[i] && (!test || test(i))) out[k++] = plane[i]
    return out
  }
  const used = mask.reduce((sum, v) => sum + v, 0)
  const valuesL = pick('L')
  const stdL = rms(valuesL)
  const stdA = rms(pick('A'))
  const stdB = rms(pick('B'))
  const shape = moments(valuesL)
  let dark = 0
  let light = 0
  for (const v of valuesL) {
    if (v < -3 * stdL) dark++
    else if (v > 3 * stdL) light++
  }
  const rgb = ['R', 'G', 'Bl'].map((key) => pick(key))
  const acf = radialAutocorrelation(residual.L, mask, w, h)
  const spectrum = residualSpectrum(residual.L, mask, w, h)
  // One pass of sums per lightness bin (0.1 wide) and band.
  const sums = (count) => Array.from({ length: count }, () => ({ n: 0, l: 0, l2: 0, y: 0, y2: 0 }))
  const binSums = sums(10)
  const bandSums = sums(BANDS.length)
  let meanL = 0
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue
    const level = lowL[i]
    meanL += level
    const l = residual.L[i]
    const y = residual.Y[i]
    const add = (s) => {
      s.n++
      s.l += l
      s.l2 += l * l
      s.y += y
      s.y2 += y * y
    }
    add(binSums[Math.min(9, Math.max(0, Math.floor(level * 10)))])
    BANDS.forEach(([, lo, hi], k) => {
      if (level >= lo && level < hi) add(bandSums[k])
    })
  }
  const spread = (s) => ({
    n: s.n,
    stdL: Math.sqrt(Math.max(0, s.l2 / s.n - (s.l / s.n) ** 2)),
    stdY: Math.sqrt(Math.max(0, s.y2 / s.n - (s.y / s.n) ** 2)),
  })
  const bins = binSums.flatMap((s, k) => (s.n >= minBin ? [{ lo: k / 10, hi: (k + 1) / 10, ...spread(s) }] : []))
  const bands = Object.fromEntries(BANDS.map(([name], k) => [name, bandSums[k].n >= minBin ? spread(bandSums[k]) : null]))
  const sampleStep = Math.max(1, Math.floor(valuesL.length / 400_000))
  return {
    width: w,
    height: h,
    hpSigma: sigma,
    used,
    usedShare: used / (w * h),
    meanL: used ? meanL / used : NaN,
    stdL,
    robustStdL: robustStd(valuesL.filter((_, i) => i % sampleStep === 0)),
    stdY: rms(pick('Y')),
    mono: (stdL * stdL) / (stdL * stdL + stdA * stdA + stdB * stdB),
    rgbCorrelation: (correlation(rgb[0], rgb[1]) + correlation(rgb[1], rgb[2]) + correlation(rgb[0], rgb[2])) / 3,
    skew: shape.skew,
    kurtosis: shape.kurtosis,
    darkSpecks: valuesL.length ? dark / valuesL.length : 0,
    lightSpecks: valuesL.length ? light / valuesL.length : 0,
    acf: acf.radial,
    acfHalf: acf.half,
    acfHalfShort: acf.half / short,
    spectrum,
    flatRuns: flatRunShare(planes, lowY, mask, w, h),
    bands,
    bins,
    mask,
    lowL,
  }
}

/** One line per measure, for logs and tables. */
export function grainSummary(m) {
  const pct = (v) => (v == null || !Number.isFinite(v) ? '-' : (v * 100).toFixed(2))
  const band = (b) => (b ? `${pct(b.stdL)} % (${b.stdY.toFixed(2)} cv)` : '-')
  return [
    `L std ${pct(m.stdL)} % (robust ${pct(m.robustStdL)} %), luma ${m.stdY.toFixed(2)} code values`,
    `shadows ${band(m.bands.shadows)}, mids ${band(m.bands.mids)}, highlights ${band(m.bands.highlights)}`,
    `half width ${m.acfHalf.toFixed(2)} px (${(m.acfHalfShort * 1000).toFixed(2)} per 1000 of the short side), high-frequency share ${m.spectrum ? m.spectrum.highShare.toFixed(2) : '-'}`,
    `mono ${m.mono.toFixed(3)}, RGB correlation ${m.rgbCorrelation.toFixed(2)}, skew ${m.skew.toFixed(2)}, kurtosis ${m.kurtosis.toFixed(2)}, dark specks ${pct(m.darkSpecks)} %, light ${pct(m.lightSpecks)} %`,
    `flat 8-bit runs ${pct(m.flatRuns)} % of measured pixels; measured ${(m.usedShare * 100).toFixed(0)} % of the image`,
  ].join('\n')
}
