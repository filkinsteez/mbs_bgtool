import { chan } from '@/core/organic/random'
import type { Field } from '../field'

// The generated COLOR FIELD — the content the fill treatments sample
// when there is no photograph (and the aurora under the mosaic even
// when there is). Every palette color claims territory: color k is
// happiest where T ≈ (k+0.5)/K, so the palette ORDERS itself along the
// composition — near-curve colors vs far colors — then smooth seeded
// noise breaks the banding into weather. Quantize it coarsely and the
// pixel-gradient reference appears; sample it per column and the
// stripe references appear.

export type RGB = [number, number, number]

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '')
  const v = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

export function rgbCss([r, g, b]: RGB): string {
  return `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`
}

export type ColorField = (x: number, y: number) => RGB

// smooth seeded scalar per palette slot, cosine-eased bilinear lattice
function slotNoise(seed: number, k: number, cellPx: number): Field {
  const smooth = (t: number) => t * t * (3 - 2 * t)
  const inv = 1 / Math.max(16, cellPx)
  const channel = `lab.cf${k}`
  return (x, y) => {
    const u = x * inv
    const v = y * inv
    const i0 = Math.floor(u)
    const j0 = Math.floor(v)
    const fu = smooth(u - i0)
    const fv = smooth(v - j0)
    const val = (i: number, j: number) =>
      chan(seed, ((j & 1023) + 512) * 4096 + ((i & 1023) + 512), channel)
    const top = val(i0, j0) * (1 - fu) + val(i0 + 1, j0) * fu
    const bot = val(i0, j0 + 1) * (1 - fu) + val(i0 + 1, j0 + 1) * fu
    return top * (1 - fv) + bot * fv
  }
}

export function buildColorField(opts: {
  palette: string[]
  seed: number
  T: Field
  outW: number
  outH: number
  // material mode: noise feature size in px (default keeps the classic
  // minDim * 0.3) — complexity shrinks it so a finer mosaic pitch also
  // means busier color, not the same gradient resampled
  featurePx?: number
}): ColorField {
  const { palette, seed, T, outW, outH } = opts
  const colors = (palette.length ? palette : ['#141412', '#f4f2ed']).map(hexToRgb)
  const K = colors.length
  const minDim = Math.min(outW, outH)
  const featurePx = opts.featurePx ?? minDim * 0.3
  const noises = colors.map((_, k) => slotNoise(seed, k, featurePx))
  const weather = slotNoise(seed, K, featurePx * 0.6)
  const sigma = 1.1 / K
  return (x, y) => {
    const t = T(x, y)
    let r = 0
    let g = 0
    let b = 0
    let sum = 0
    for (let k = 0; k < K; k++) {
      const mu = (k + 0.5) / K
      const d = (t - mu) / sigma
      // noise sampled anisotropically — features run taller than wide,
      // the vertical light-shaft read of the reference gradients. The
      // territory T stays in true output space.
      const w = Math.exp(-d * d) * (0.35 + 0.65 * noises[k](x * 1.5, y * 0.65))
      r += colors[k][0] * w
      g += colors[k][1] * w
      b += colors[k][2] * w
      sum += w
    }
    if (sum < 1e-9) return colors[0]
    // Keep the territory-directed color as the dominant signal, then fold
    // a broad palette weather field through every cell. This prevents the
    // zero-valued area outside a subject from collapsing to one flat color.
    const weatherPosition = weather(x, y) * Math.max(0, K - 1)
    const weatherFrom = Math.floor(weatherPosition)
    const weatherTo = Math.min(K - 1, weatherFrom + 1)
    const weatherMix = weatherPosition - weatherFrom
    const ambient: RGB = [
      colors[weatherFrom][0] * (1 - weatherMix) + colors[weatherTo][0] * weatherMix,
      colors[weatherFrom][1] * (1 - weatherMix) + colors[weatherTo][1] * weatherMix,
      colors[weatherFrom][2] * (1 - weatherMix) + colors[weatherTo][2] * weatherMix,
    ]
    const ambientAmount = 0.34
    return [
      (r / sum) * (1 - ambientAmount) + ambient[0] * ambientAmount,
      (g / sum) * (1 - ambientAmount) + ambient[1] * ambientAmount,
      (b / sum) * (1 - ambientAmount) + ambient[2] * ambientAmount,
    ]
  }
}

// curated palettes distilled from the reference sheet — one click each
export const PALETTES: { id: string; label: string; ground: string; ink: string; colors: string[] }[] = [
  {
    id: 'primary',
    label: 'Primary',
    ground: '#ffffff',
    ink: '#0064e0',
    colors: ['#0288f9', '#006ce1', '#034ae0', '#093ac7', '#132682', '#d1d4db', '#8b9baa', '#27353e'],
  },
  {
    id: 'bold',
    label: 'Bold',
    ground: '#ffffff',
    ink: '#0064e0',
    colors: ['#0064e0', '#26c8ee', '#fed61f', '#ff5001'],
  },
  {
    id: 'harmonious',
    label: 'Harmonious',
    ground: '#ffffff',
    ink: '#0064e0',
    colors: ['#0064e0', '#ae4fc3', '#824dff', '#1cc5ee', '#4f43ff'],
  },
  {
    id: 'atmospheric',
    label: 'Atmospheric',
    ground: '#ffffff',
    ink: '#0064e0',
    colors: ['#0064e0', '#d6e7ee', '#7ca0b8', '#526069', '#1c2a33'],
  },
  {
    id: 'neutrals',
    label: 'Neutrals',
    ground: '#ffffff',
    ink: '#0064e0',
    colors: ['#0064e0', '#ffffff', '#dae3ea', '#8d9dac', '#526069', '#1c2b32', '#000000'],
  },
]
