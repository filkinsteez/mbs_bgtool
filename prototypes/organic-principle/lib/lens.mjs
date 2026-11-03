// The lens: one defocus blur over the whole scene, in linear light, then the tone curve.
import { convolve } from './fft.mjs'
import { toneCurve } from './tone.mjs'

/**
 * Disc of radius R px with a soft rim: (1 - rim) of a disc plus rim of a Gaussian with
 * sigma R/2 (the measured poster edges sit between a disc and a Gaussian). stretch > 1
 * widens it horizontally.
 */
export function lensKernel(R, { rim = 0.2, stretch = 1 } = {}) {
  const sig = R / 2
  const discArea = Math.PI * R * R * stretch
  const gaussArea = 2 * Math.PI * sig * sig * stretch
  return (dx, dy) => {
    const ex = dx / stretch
    const d = Math.hypot(ex, dy)
    const disc = Math.min(1, Math.max(0, R + 0.5 - d)) / discArea
    const gauss = Math.exp((-d * d) / (2 * sig * sig)) / gaussArea
    return (1 - rim) * disc + rim * gauss
  }
}

export function lensBlur(img, R, opts = {}) {
  const stretch = opts.stretch ?? 1
  const reach = Math.ceil(Math.max(R * stretch, 3 * (R / 2) * stretch)) + 2
  const [r, g, b] = convolve([img.r, img.g, img.b], img.w, img.h, lensKernel(R, opts), reach)
  return { w: img.w, h: img.h, r, g, b }
}

/** Gaussian blur of the same 10-90 edge width as a disc of radius R (for comparison). */
export function gaussBlurLike(img, R) {
  const sigma = (1.374 * R) / 2.563
  const reach = Math.ceil(3.5 * sigma) + 2
  const k = (dx, dy) => Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma))
  const [r, g, b] = convolve([img.r, img.g, img.b], img.w, img.h, k, reach)
  return { w: img.w, h: img.h, r, g, b }
}

export function tone(img) {
  const n = img.w * img.h
  const r = new Float32Array(n)
  const g = new Float32Array(n)
  const b = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const c = toneCurve([img.r[i], img.g[i], img.b[i]])
    r[i] = c[0]
    g[i] = c[1]
    b[i] = c[2]
  }
  return { w: img.w, h: img.h, r, g, b }
}
