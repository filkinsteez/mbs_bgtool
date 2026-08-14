import type { LabState } from './types'

export function scaleLabForPreview(lab: LabState, maxLongEdge: number): LabState {
  const longEdge = Math.max(lab.output.width, lab.output.height)
  const scale = Math.min(1, Math.max(1, maxLongEdge) / Math.max(1, longEdge))
  if (scale === 1) return lab
  return {
    ...lab,
    output: {
      ...lab.output,
      width: Math.max(1, Math.round(lab.output.width * scale)),
      height: Math.max(1, Math.round(lab.output.height * scale)),
    },
    structure: {
      ...lab.structure,
      baseCell: Math.max(2, lab.structure.baseCell * scale),
    },
  }
}
