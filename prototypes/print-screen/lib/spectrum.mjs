// 2D spectra of image windows: power per channel, peaks, and how well channels line up at a peak.

const SRGB_TO_LINEAR = Array.from({ length: 256 }, (_, v) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
})

/** Planes of an RGB(A) buffer: encoded R, G, B (0..255), Rec. 709 luma of the encoded values, and Oklab L. */
export function planes(image) {
  const { width: w, height: h, data, channels = 4 } = image
  const n = w * h
  const out = { R: new Float64Array(n), G: new Float64Array(n), B: new Float64Array(n), Y: new Float64Array(n), L: new Float64Array(n) }
  for (let i = 0; i < n; i++) {
    const r8 = data[i * channels]
    const g8 = data[i * channels + 1]
    const b8 = data[i * channels + 2]
    out.R[i] = r8
    out.G[i] = g8
    out.B[i] = b8
    out.Y[i] = 0.2126 * r8 + 0.7152 * g8 + 0.0722 * b8
    const r = SRGB_TO_LINEAR[r8]
    const g = SRGB_TO_LINEAR[g8]
    const b = SRGB_TO_LINEAR[b8]
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    out.L[i] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  }
  return out
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
 * Complex 2D spectrum of an n x n window of a plane, minus its plane fit (so a gradient doesn't leak), with a
 * Hann window. Index (y * n + x); frequency fx = (x < n/2 ? x : x - n) / n cycles per pixel.
 */
export function windowSpectrum(plane, w, x0, y0, n) {
  // Least-squares plane a + b x + c y over the window.
  let s = 0
  let sx = 0
  let sy = 0
  let sxx = 0
  let syy = 0
  let sv = 0
  let svx = 0
  let svy = 0
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = plane[(y0 + y) * w + x0 + x]
      s++
      sx += x
      sy += y
      sxx += x * x
      syy += y * y
      sv += v
      svx += v * x
      svy += v * y
    }
  }
  const mx = sx / s
  const my = sy / s
  const mv = sv / s
  const b = (svx / s - mx * mv) / (sxx / s - mx * mx)
  const c = (svy / s - my * mv) / (syy / s - my * my)
  const re = new Float64Array(n * n)
  const im = new Float64Array(n * n)
  for (let y = 0; y < n; y++) {
    const wy = 0.5 - 0.5 * Math.cos((2 * Math.PI * (y + 0.5)) / n)
    for (let x = 0; x < n; x++) {
      const wx = 0.5 - 0.5 * Math.cos((2 * Math.PI * (x + 0.5)) / n)
      const v = plane[(y0 + y) * w + x0 + x] - (mv + b * (x - mx) + c * (y - my))
      re[y * n + x] = v * wx * wy
    }
  }
  const rowRe = new Float64Array(n)
  const rowIm = new Float64Array(n)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      rowRe[x] = re[y * n + x]
      rowIm[x] = im[y * n + x]
    }
    fft(rowRe, rowIm)
    for (let x = 0; x < n; x++) {
      re[y * n + x] = rowRe[x]
      im[y * n + x] = rowIm[x]
    }
  }
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      rowRe[y] = re[y * n + x]
      rowIm[y] = im[y * n + x]
    }
    fft(rowRe, rowIm)
    for (let y = 0; y < n; y++) {
      re[y * n + x] = rowRe[y]
      im[y * n + x] = rowIm[y]
    }
  }
  return { re, im, mean: mv }
}

/** Hann window energy, to turn summed power into the amplitude of a sinusoid. */
export function hannGain(n) {
  let s = 0
  for (let i = 0; i < n; i++) s += 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / n)
  return s / n
}

/**
 * Peaks of a (summed) power spectrum: local maxima at least `ratio` times the median power at their radius,
 * in the half-plane fy > 0 or (fy = 0 and fx > 0). Returns frequency, period, angle of the wave vector (0 deg =
 * along x, positive toward +y, i.e. down the image), and strength.
 */
export function findPeaks(power, n, { ratio = 8, minRadius = 3, limit = 12 } = {}) {
  const radiusMedian = []
  const byRadius = Array.from({ length: n }, () => [])
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const fx = x < n / 2 ? x : x - n
      const fy = y < n / 2 ? y : y - n
      byRadius[Math.round(Math.hypot(fx, fy))].push(power[y * n + x])
    }
  }
  for (let r = 0; r < n; r++) {
    const list = byRadius[r].sort((a, b) => a - b)
    radiusMedian[r] = list.length ? list[list.length >> 1] : 0
  }
  const peaks = []
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const fx = x < n / 2 ? x : x - n
      const fy = y < n / 2 ? y : y - n
      if (fy < 0 || (fy === 0 && fx <= 0)) continue
      const r = Math.hypot(fx, fy)
      if (r < minRadius || r >= n / 2) continue
      const v = power[y * n + x]
      const ref = radiusMedian[Math.round(r)] || 1e-30
      if (v < ratio * ref) continue
      let isMax = true
      for (let dy = -1; dy <= 1 && isMax; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue
          const xx = (x + dx + n) % n
          const yy = (y + dy + n) % n
          if (power[yy * n + xx] > v) {
            isMax = false
            break
          }
        }
      }
      if (!isMax) continue
      peaks.push({ fx: fx / n, fy: fy / n, ix: x, iy: y, periodPx: n / r, angleDeg: (Math.atan2(fy, fx) * 180) / Math.PI, ratio: v / ref, power: v })
    }
  }
  return peaks.sort((a, b) => b.ratio - a.ratio).slice(0, limit)
}
