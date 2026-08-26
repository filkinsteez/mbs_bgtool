import { mergeDeep } from '@/core/state/store'
import { PAPER } from '@/core/state/defaults'
import { META_BLUE } from '@/core/color/brand'
import type { LabState } from './types'
import { LAB_VERSION } from './types'
import { MARK_DEFAULTS } from './composition'
import { FLOW_DEFAULTS } from './flow'
import { PALETTES } from './colorField'
import { createFieldSource } from './territory'

// Lab recipes follow the editor's contract: whole state as JSON,
// partial saves healed by mergeDeep over defaults, a hard version gate.
// The source bitmap is NOT embedded — filename + dims + contentHash
// identify it, and a restored recipe asks for the matching file.

export function createDefaultLab(seed = 1913): LabState {
  return {
    version: LAB_VERSION,
    studyId: 'territory',
    seed,
    output: { width: 1400, height: 1400, transparent: false },
    source: null,
    // The default composition tells the thesis: the brand curve is the
    // organizing form — the photo survives only near it, marks carry
    // tone further out, contours band the transition, the far field
    // goes empty. Tone deepens the territory where the image is dark.
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
    colors: { ink: META_BLUE, paper: PAPER, palette: [...PALETTES[0].colors] },
    flow: { ...FLOW_DEFAULTS },
    finish: { grain: 0.12 },
    look: { id: null, strength: 1, complexity: 0.5 },
    motion: { enabled: false, amount: 0.35, speed: 0.12, loopSeconds: 8 },
  }
}

export { META_BLUE }

// A clean start that keeps the loaded source: with an image present the
// near band is the PHOTO (the image must never silently vanish into a
// treatment on reset), fills take the field around it.
export function resetLab(current: LabState): LabState {
  const lab = createDefaultLab(current.seed)
  lab.output = { ...current.output }
  lab.source = current.source ? { ...current.source } : null
  if (lab.source) {
    lab.territory.bands = ['blocks', 'beads', 'shingle', 'photo']
    // this IS the Frame look — the strip should say so
    lab.look = { id: 'frame', strength: 1 }
  }
  return lab
}

export function serializeLab(lab: LabState): string {
  return JSON.stringify(lab)
}

export function deserializeLab(json: string): LabState | null {
  try {
    const raw = JSON.parse(json) as Partial<LabState> & { studyId?: string }
    if (typeof raw !== 'object' || raw === null) return null
    if (raw.version !== LAB_VERSION) return null
    // older lab saves carried 'mark-translation'; the territory engine
    // supersedes it and heals their params in
    raw.studyId = 'territory'
    const lab = mergeDeep(createDefaultLab(typeof raw.seed === 'number' ? raw.seed : undefined), raw)
    lab.output.width = clampInt(lab.output.width, 64, 8192)
    lab.output.height = clampInt(lab.output.height, 64, 8192)
    lab.structure.baseCell = Math.max(8, Math.min(160, lab.structure.baseCell))
    lab.structure.maxLevels = Math.max(0, Math.min(2, Math.round(lab.structure.maxLevels))) as 0 | 1 | 2
    if (!lab.territory.bands.length) lab.territory.bands = ['empty', 'marks']
    lab.territory.bands = lab.territory.bands.slice(0, 5)
    while (lab.territory.bands.length < 2) lab.territory.bands.push('photo')
    lab.territory.gain = Math.max(0.2, Math.min(1.6, lab.territory.gain ?? 1))
    lab.mark.echo = Math.max(0, Math.min(6, Math.round(lab.mark.echo)))
    if (!Array.isArray(lab.colors.palette) || !lab.colors.palette.length) {
      lab.colors.palette = [...PALETTES[0].colors]
    }
    lab.colors.palette = lab.colors.palette.slice(0, 10)
    lab.flow.curl = Math.max(0, Math.min(1, lab.flow.curl))
    lab.flow.scale = Math.max(0, Math.min(1, lab.flow.scale))
    lab.flow.warp = Math.max(0, Math.min(1, lab.flow.warp))
    lab.finish.grain = Math.max(0, Math.min(1, lab.finish.grain))
    lab.look.strength = Math.max(0, Math.min(1, lab.look.strength))
    lab.motion = {
      enabled: !!lab.motion?.enabled,
      amount: Math.max(0, Math.min(1, lab.motion?.amount ?? 0.35)),
      speed: Math.max(0, Math.min(2, lab.motion?.speed ?? 0.12)),
      loopSeconds: Math.max(2, Math.min(30, lab.motion?.loopSeconds ?? 8)),
    }
    return lab
  } catch {
    return null
  }
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v) || lo))
}

// FNV-1a over strided pixel samples — enough to match a re-dropped file
// to its recipe without hashing every byte
export function labContentHash(rgba: Uint8ClampedArray, w: number, h: number): string {
  let hsh = 0x811c9dc5
  const stride = Math.max(4, (Math.floor((w * h) / 4096) >> 2) << 2)
  for (let i = 0; i < rgba.length; i += stride * 4) {
    hsh ^= rgba[i]
    hsh = Math.imul(hsh, 0x01000193) >>> 0
  }
  hsh = fnvNum(fnvNum(hsh, w), h)
  return hsh.toString(16).padStart(8, '0')
}

function fnvNum(h: number, v: number): number {
  h ^= v & 0xff
  h = Math.imul(h, 0x01000193) >>> 0
  h ^= (v >> 8) & 0xff
  h = Math.imul(h, 0x01000193) >>> 0
  return h >>> 0
}
