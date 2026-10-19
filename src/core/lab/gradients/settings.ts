import type { GradientSettings } from '../types'

export const GRADIENT_DEFAULTS: Readonly<Required<GradientSettings>> = {
  softness: 0.65,
  distortion: 0.45,
  grain: 0.22,
  scale: 0.45,
  folds: 0.32,
  bleed: 0.6,
  depth: 0.45,
  reflow: 0.5,
  orientation: 0,
  centerX: 0.5,
  centerY: 0.5,
  source1X: 0.35,
  source1Y: 0.6,
  source1Spread: 0.55,
  source2X: 0.72,
  source2Y: 0.38,
  source2Spread: 0.48,
  source3X: 0.65,
  source3Y: 0.76,
  source3Spread: 0.42,
  sourceCount: 3,
}

export function normalizeGradientSettings(value?: Partial<GradientSettings> | null): Required<GradientSettings> {
  const read = (key: keyof GradientSettings) => {
    const n = value?.[key]
    return typeof n === 'number' && Number.isFinite(n)
      ? Math.max(0, Math.min(1, n))
      : GRADIENT_DEFAULTS[key]
  }
  return {
    softness: read('softness'),
    distortion: read('distortion'),
    grain: read('grain'),
    scale: read('scale'),
    folds: read('folds'),
    bleed: read('bleed'),
    depth: read('depth'),
    reflow: read('reflow'),
    orientation: value?.orientation === 90 || value?.orientation === 180 || value?.orientation === 270 ? value.orientation : 0,
    centerX: read('centerX'),
    centerY: read('centerY'),
    source1X: read('source1X'),
    source1Y: read('source1Y'),
    source1Spread: read('source1Spread'),
    source2X: read('source2X'),
    source2Y: read('source2Y'),
    source2Spread: read('source2Spread'),
    source3X: read('source3X'),
    source3Y: read('source3Y'),
    source3Spread: read('source3Spread'),
    sourceCount: Math.max(
      1,
      Math.min(
        3,
        Math.round(
          typeof value?.sourceCount === 'number' && Number.isFinite(value.sourceCount)
            ? value.sourceCount
            : GRADIENT_DEFAULTS.sourceCount,
        ),
      ),
    ),
  }
}
