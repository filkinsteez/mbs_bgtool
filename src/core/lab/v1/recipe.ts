import { PAPER } from '@/core/state/defaults'
import type { LabState } from '../types'
import { LAB_VERSION } from '../types'
import { createFieldSource } from '../territory'
import { MARK_DEFAULTS } from './composition'
import { FLOW_DEFAULTS } from './flow'
import { PALETTES } from './colorField'

// The Lab defaults used by 67f7de1, kept separate from V2 defaults so
// future renderer work cannot silently alter a V1 preset's inherited fields.
export function createDefaultLabV1(seed = 1913): LabState {
  return {
    version: LAB_VERSION,
    studyId: 'territory',
    seed,
    output: { width: 1400, height: 1400, transparent: false },
    source: null,
    territory: {
      sources: [
        createFieldSource('curve', 'src-curve'),
        { ...createFieldSource('tone', 'src-tone'), weight: 0.35 },
      ],
      bands: ['mosaic', 'shingle', 'beads', 'blocks'],
      boundary: 'hard',
      gain: 1,
    },
    structure: { baseCell: 28, maxLevels: 2, subdivide: 0.55 },
    mark: { ...MARK_DEFAULTS },
    paint: null,
    sourceVisibility: 0,
    colors: { ink: '#0668e1', paper: PAPER, palette: [...PALETTES[0].colors] },
    flow: { ...FLOW_DEFAULTS },
    finish: { grain: 0.12 },
    look: { id: null, strength: 1, version: 'v1' },
    motion: { enabled: false, amount: 0.35, speed: 0.12, loopSeconds: 8 },
  }
}
