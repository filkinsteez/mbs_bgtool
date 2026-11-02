// CPU sketch of a Bands-style frame for the sideways and reflection questions: flat bands of pack
// colors, each laid over the one above through a soft edge in linear light, one crisper edge (the
// horizon), edges that drift and change softness along their length, and optionally the bands above
// the horizon mirrored below it (squeezed, softer, dimmer, with the water's own light).
import { hexToLinear } from './color.mjs'
import { fbm1 } from './noise.mjs'
import { fresnel } from './scene.mjs'

const logistic = (x) => 1 / (1 + Math.exp(-4.394 * x))
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

/**
 * spec.bands: [{ hex, gain, top, soft }] top to bottom; `top` is the band's top edge (frame fraction),
 * `soft` its 10-90 width in short-side units. spec.horizon: index of the band whose top edge is the
 * horizon. spec.reflect: mirror the bands above the horizon below it. spec.water: [hex, gain].
 */
export function renderBands(spec, W, H) {
  const { bands, horizon: hIndex = -1, reflect = false, water = null, seed = 1, pale = 0.06 } = spec
  const aspect = W / H
  const fw = Math.max(aspect, 1)
  const fh = Math.max(1 / aspect, 1)
  const colors = bands.map((b) => hexToLinear(b.hex).map((v) => v * (b.gain ?? 1)))
  const edgeAt = (k, u) => {
    const b = bands[k]
    const amp = k === hIndex ? 0.003 : 0.012
    const lean = k === hIndex ? 0 : 0.02 * fbm1(k * 3.7 + 0.5, seed + 41)
    return b.top + lean * (u - 0.5) + (amp * fbm1(u * fw * 0.9 + k * 5.1, seed + k)) / fh
  }
  const softAt = (k, u) => bands[k].soft * Math.exp(0.4 * fbm1(u * fw * 1.2 + k * 2.3, seed + 70 + k))
  const at = (u, v) => {
    let c = colors[0]
    for (let k = 1; k < bands.length; k++) {
      const t = logistic(((v - edgeAt(k, u)) * fh) / softAt(k, u))
      // the bridge between two bands is lighter: a little pale light where both weigh the same
      const bell = 4 * t * (1 - t)
      c = mix(c, colors[k], t)
      c = c.map((x, i) => x + pale * bell * Math.max(colors[k][i], colors[k - 1][i]))
    }
    return c
  }
  const out = new Float32Array(W * H * 3)
  for (let i = 0; i < W; i++) {
    const u = (i + 0.5) / W
    const yh = hIndex >= 0 ? edgeAt(hIndex, u) : 2
    for (let j = 0; j < H; j++) {
      const v = (j + 0.5) / H
      let c
      if (reflect && v > yh) {
        // the bands above the horizon, mirrored and squeezed, smeared up and down, dimmer with depth
        const d = (v - yh) * fh
        const dBottom = Math.max(0.15, (1 - yh) * fh)
        const R = fresnel(90 - (9 * d) / dBottom)
        let s = [0, 0, 0]
        let w = 0
        for (let k = -3; k <= 3; k++) {
          const g = Math.exp(-0.5 * (k / 1.6) ** 2)
          const vm = yh - (d * 1.25 * (1 + 0.15 * k * (0.2 + d))) / fh
          const sample = at(u, Math.min(yh - 0.001, vm))
          s = s.map((x, n) => x + g * sample[n])
          w += g
        }
        const own = water ? hexToLinear(water[0]).map((x) => x * water[1]) : [0, 0, 0]
        c = s.map((x, n) => (R * x) / w + (1 - R) * own[n])
        const edge = logistic(((v - yh) * fh) / 0.006)
        c = mix(at(u, v), c, edge)
      } else {
        c = at(u, v)
      }
      const o = (j * W + i) * 3
      out[o] = c[0]
      out[o + 1] = c[1]
      out[o + 2] = c[2]
    }
  }
  return out
}
