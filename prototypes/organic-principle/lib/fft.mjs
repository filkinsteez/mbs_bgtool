// Radix-2 FFT, FFT convolution with mirrored padding, and radially averaged power spectra.

export const nextPow2 = (n) => 2 ** Math.ceil(Math.log2(Math.max(1, n)))

const twiddleCache = new Map()
function twiddles(n) {
  let t = twiddleCache.get(n)
  if (!t) {
    t = { cos: new Float64Array(n / 2), sin: new Float64Array(n / 2) }
    for (let k = 0; k < n / 2; k++) {
      t.cos[k] = Math.cos((2 * Math.PI * k) / n)
      t.sin[k] = Math.sin((2 * Math.PI * k) / n)
    }
    twiddleCache.set(n, t)
  }
  return t
}

/** In-place complex FFT of length n (a power of 2). inverse divides by n. */
export function fft1(re, im, inverse = false) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      let t = re[i]
      re[i] = re[j]
      re[j] = t
      t = im[i]
      im[i] = im[j]
      im[j] = t
    }
  }
  const { cos, sin } = twiddles(n)
  const sign = inverse ? 1 : -1
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1
    const step = n / len
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step]
        const wi = sign * sin[k * step]
        const a = i + k
        const b = a + half
        const xr = re[b] * wr - im[b] * wi
        const xi = re[b] * wi + im[b] * wr
        re[b] = re[a] - xr
        im[b] = im[a] - xi
        re[a] += xr
        im[a] += xi
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n
      im[i] /= n
    }
  }
}

/** In-place 2D FFT of a W x H grid (row-major). */
export function fft2(re, im, W, H, inverse = false) {
  const rr = new Float64Array(W)
  const ri = new Float64Array(W)
  for (let y = 0; y < H; y++) {
    const o = y * W
    for (let x = 0; x < W; x++) {
      rr[x] = re[o + x]
      ri[x] = im[o + x]
    }
    fft1(rr, ri, inverse)
    for (let x = 0; x < W; x++) {
      re[o + x] = rr[x]
      im[o + x] = ri[x]
    }
  }
  const cr = new Float64Array(H)
  const ci = new Float64Array(H)
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      cr[y] = re[y * W + x]
      ci[y] = im[y * W + x]
    }
    fft1(cr, ci, inverse)
    for (let y = 0; y < H; y++) {
      re[y * W + x] = cr[y]
      im[y * W + x] = ci[y]
    }
  }
}

const mirror = (i, n) => {
  const p = 2 * n
  i = ((i % p) + p) % p
  return i < n ? i : p - 1 - i
}

/**
 * Convolves planes (Float32Array w*h each) with a real kernel k(dx, dy), nonzero within
 * |dx|, |dy| <= reach pixels. Borders are mirrored. The kernel is normalized to sum 1.
 * Two planes go through one complex transform.
 */
export function convolve(planes, w, h, kernel, reach) {
  const pad = Math.ceil(reach) + 2
  const W = nextPow2(w + 2 * pad)
  const H = nextPow2(h + 2 * pad)
  const kr = new Float64Array(W * H)
  const ki = new Float64Array(W * H)
  let sum = 0
  const R = Math.ceil(reach)
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const v = kernel(dx, dy)
      if (!v) continue
      kr[((dy + H) % H) * W + ((dx + W) % W)] += v
      sum += v
    }
  }
  for (let i = 0; i < kr.length; i++) kr[i] /= sum
  fft2(kr, ki, W, H)
  const out = planes.map(() => new Float32Array(w * h))
  for (let p = 0; p < planes.length; p += 2) {
    const a = planes[p]
    const b = planes[p + 1]
    const re = new Float64Array(W * H)
    const im = new Float64Array(W * H)
    for (let gy = 0; gy < H; gy++) {
      const sy = mirror(gy - pad, h) * w
      for (let gx = 0; gx < W; gx++) {
        const s = sy + mirror(gx - pad, w)
        re[gy * W + gx] = a[s]
        if (b) im[gy * W + gx] = b[s]
      }
    }
    fft2(re, im, W, H)
    for (let i = 0; i < re.length; i++) {
      const xr = re[i] * kr[i] - im[i] * ki[i]
      const xi = re[i] * ki[i] + im[i] * kr[i]
      re[i] = xr
      im[i] = xi
    }
    fft2(re, im, W, H, true)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const g = (y + pad) * W + x + pad
        out[p][y * w + x] = re[g]
        if (b) out[p + 1][y * w + x] = im[g]
      }
    }
  }
  return out
}

/** Disc of radius R with a one-pixel antialiased rim; sx stretches it horizontally. */
export const discKernel = (R, sx = 1) => (dx, dy) => Math.min(1, Math.max(0, R + 0.5 - Math.hypot(dx / sx, dy)))

/**
 * Radially averaged power spectrum of one plane (mean removed, Hann window).
 * Returns bins in cycles per short side: { f, p } with p the mean power per bin.
 */
export function powerSpectrum(plane, w, h, bins = 40) {
  const W = nextPow2(w)
  const H = nextPow2(h)
  const re = new Float64Array(W * H)
  const im = new Float64Array(W * H)
  let mean = 0
  for (let i = 0; i < w * h; i++) mean += plane[i]
  mean /= w * h
  let wsum = 0
  for (let y = 0; y < h; y++) {
    const wy = 0.5 - 0.5 * Math.cos((2 * Math.PI * (y + 0.5)) / h)
    for (let x = 0; x < w; x++) {
      const wx = 0.5 - 0.5 * Math.cos((2 * Math.PI * (x + 0.5)) / w)
      re[y * W + x] = (plane[y * w + x] - mean) * wx * wy
      wsum += (wx * wy) ** 2
    }
  }
  fft2(re, im, W, H)
  const short = Math.min(w, h)
  const fmin = 1
  const fmax = short / 2
  const edges = Array.from({ length: bins + 1 }, (_, k) => fmin * (fmax / fmin) ** (k / bins))
  const acc = new Float64Array(bins)
  const cnt = new Float64Array(bins)
  for (let ky = 0; ky < H; ky++) {
    const fy = (ky <= H / 2 ? ky : ky - H) / H
    for (let kx = 0; kx < W; kx++) {
      const fx = (kx <= W / 2 ? kx : kx - W) / W
      const f = Math.hypot(fx, fy) * short // cycles per short side
      if (f < fmin || f >= fmax) continue
      const b = Math.min(bins - 1, Math.floor((Math.log(f / fmin) / Math.log(fmax / fmin)) * bins))
      const i = ky * W + kx
      acc[b] += (re[i] * re[i] + im[i] * im[i]) / wsum
      cnt[b]++
    }
  }
  const f = []
  const p = []
  for (let b = 0; b < bins; b++) {
    if (!cnt[b]) continue
    f.push(Math.sqrt(edges[b] * edges[b + 1]))
    p.push(acc[b] / cnt[b])
  }
  return { f, p }
}

/** Least-squares slope of log p against log f over [f0, f1]. */
export function spectrumSlope({ f, p }, f0, f1) {
  const xs = []
  const ys = []
  for (let i = 0; i < f.length; i++) {
    if (f[i] < f0 || f[i] > f1 || !(p[i] > 0)) continue
    xs.push(Math.log(f[i]))
    ys.push(Math.log(p[i]))
  }
  const n = xs.length
  const mx = xs.reduce((s, v) => s + v, 0) / n
  const my = ys.reduce((s, v) => s + v, 0) / n
  let sxy = 0
  let sxx = 0
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my)
    sxx += (xs[i] - mx) ** 2
  }
  return sxy / sxx
}
