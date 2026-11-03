// Copy of the engine's CPU tone curve (src/light/engine/output.ts, `toneCurve`, toe 0),
// so the prototype needs no TypeScript loader. Colors whose largest channel is <= 1
// pass through unchanged; above 1 the other channels fill toward white.

const TONE_CROSSTALK = [
  [0, 0.8, 0.16],
  [0.15, 0, 0.3],
  [0.02, 0.15, 0],
]
const TONE_GAP_SOFTNESS = 0.05
const TONE_LATE_WHITENING = 0.005
const TONE_TIE_BAND = 0.05
const TONE_TIE_SHARE = TONE_TIE_BAND / (TONE_TIE_BAND + TONE_GAP_SOFTNESS)
const LUMA = [0.2126, 0.7152, 0.0722]

const smoothstep = (edge, x) => {
  const t = Math.min(1, Math.max(0, x / edge))
  return t * t * (3 - 2 * t)
}

export function toneCurve(rgb) {
  const c = [Math.max(0, rgb[0]), Math.max(0, rgb[1]), Math.max(0, rgb[2])]
  const m = Math.max(c[0], c[1], c[2])
  if (m <= 1) return c
  const r = c.map((v) => v / m)
  const gap = r.map((v) => 1 - v)
  const fill = r.map((v, i) => v + TONE_CROSSTALK[i][0] * r[0] + TONE_CROSSTALK[i][1] * r[1] + TONE_CROSSTALK[i][2] * r[2])
  const w = fill.map((f, i) => f / (gap[i] + TONE_GAP_SOFTNESS))
  let top = 0
  for (let i = 1; i < 3; i++) if (gap[i] < gap[top]) top = i
  let slope = 0
  for (let i = 0; i < 3; i++) {
    if (i === top) continue
    const near = 1 - smoothstep(TONE_TIE_BAND, gap[i])
    const pair = 0.5 * (LUMA[i] * fill[i] + LUMA[top] * fill[top]) * TONE_TIE_SHARE
    slope += (1 - near) * LUMA[i] * gap[i] * w[i] + near * pair
  }
  const k = (LUMA[0] * r[0] + LUMA[1] * r[1] + LUMA[2] * r[2]) / Math.max(slope, 1e-6)
  const x = m - 1
  return gap.map((g, i) => Math.min(1, Math.max(0, 1 - g * Math.exp(-k * x * w[i] - TONE_LATE_WHITENING * x * x))))
}
