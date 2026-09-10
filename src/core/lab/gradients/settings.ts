import type { GradientSettings } from '../types'

export const GRADIENT_DEFAULTS: Readonly<Required<GradientSettings>> = {
  softness: 0.65,
  distortion: 0.45,
  grain: 0.22,
  scale: 0.45,
  folds: 0.32,
  bleed: 0.6,
  depth: 0.45,
}

export function normalizeGradientSettings(value?: Partial<GradientSettings> | null): Required<GradientSettings> {
  const read = (key: keyof GradientSettings) => {
    const n = value?.[key]
    return typeof n === 'number' && Number.isFinite(n)
      ? Math.max(0, Math.min(1, n))
      : GRADIENT_DEFAULTS[key]
  }
  return { softness: read('softness'), distortion: read('distortion'), grain: read('grain'), scale: read('scale'), folds: read('folds'), bleed: read('bleed'), depth: read('depth') }
}
