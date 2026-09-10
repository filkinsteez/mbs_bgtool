import { applyBrushSegment, emptyDeformation, encodeDeformation, type BrushDab, type Deformation } from './deformation'

const studies = new Map<string, Deformation>()
export function brushStudy(aspect: number, treatment: 'sweep' | 'fold'): Deformation {
  const key = `${aspect}:${treatment}`
  const cached = studies.get(key)
  if (cached) return cached
  let field = emptyDeformation()
  const stroke = (from: [number, number], to: [number, number], radius: number, mode: BrushDab['mode'], strength: number, reverse = false) => {
    field = applyBrushSegment(field, { from: { x: from[0], y: from[1] }, to: { x: to[0], y: to[1] }, radius, mode, strength, aspect, reverse })
  }
  if (treatment === 'sweep') {
    stroke([0.27, 0.65], [0.59, 0.35], 0.48, 'push', 0.8)
    stroke([0.62, 0.32], [0.76, 0.6], 0.38, 'push', 0.72)
    stroke([0.5, 0.48], [0.44, 0.69], 0.42, 'twirl', 0.8)
  } else {
    stroke([0.17, 0.74], [0.66, 0.22], 0.42, 'push', 0.95)
    stroke([0.72, 0.22], [0.35, 0.69], 0.34, 'push', 0.85)
    stroke([0.62, 0.32], [0.38, 0.62], 0.55, 'twirl', 0.95)
    stroke([0.38, 0.62], [0.62, 0.48], 0.4, 'twirl', 0.95)
    stroke([0.35, 0.3], [0.3, 0.53], 0.28, 'inflate', 0.9)
  }
  const result = encodeDeformation(field)
  studies.set(key, result)
  return result
}
