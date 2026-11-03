// Fast Gaussian blur by three box passes per axis (Kutskir's widths), mirrored borders.

function boxesForGauss(sigma, n = 3) {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1)
  let wl = Math.floor(wIdeal)
  if (wl % 2 === 0) wl--
  const wu = wl + 2
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4)
  const m = Math.round(mIdeal)
  return Array.from({ length: n }, (_, i) => (i < m ? wl : wu))
}

const mirror = (i, n) => {
  const p = 2 * n
  i = ((i % p) + p) % p
  return i < n ? i : p - 1 - i
}

function boxLine(src, dst, n, stride, offset, r) {
  // running sum over [i - r, i + r] with mirrored ends
  let acc = 0
  for (let k = -r; k <= r; k++) acc += src[offset + mirror(k, n) * stride]
  const inv = 1 / (2 * r + 1)
  for (let i = 0; i < n; i++) {
    dst[offset + i * stride] = acc * inv
    acc += src[offset + mirror(i + r + 1, n) * stride] - src[offset + mirror(i - r, n) * stride]
  }
}

/** Gaussian blur of one plane; sx and sy are the sigmas along x and y in pixels. */
export function gauss(plane, w, h, sx, sy = sx) {
  let a = Float32Array.from(plane)
  let b = new Float32Array(w * h)
  if (sx > 0.3) {
    for (const size of boxesForGauss(sx)) {
      const r = (size - 1) / 2
      for (let y = 0; y < h; y++) boxLine(a, b, w, 1, y * w, r)
      ;[a, b] = [b, a]
    }
  }
  if (sy > 0.3) {
    for (const size of boxesForGauss(sy)) {
      const r = (size - 1) / 2
      for (let x = 0; x < w; x++) boxLine(a, b, h, w, x, r)
      ;[a, b] = [b, a]
    }
  }
  return a
}
