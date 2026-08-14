import type { LabPatch } from './labStore'

// LOOKS — the preset layer every shipped image tool leads with. A look
// is a plain LabPatch: applying one goes through the normal patch/undo
// path, so every control underneath lands on real editable values (a
// look is an editable state, not a flattened result). Looks never touch
// the source, the output size, the painted mask, or the seed — your
// image and your strokes survive every look change.
//
// All ten are today's proven recipes, judged against the reference
// sheet before earning a slot.

export type LookId =
  | 'frame'
  | 'pixels'
  | 'scanlines'
  | 'streams'
  | 'brushwork'
  | 'beads'
  | 'quilt'
  | 'weave'
  | 'marks'
  | 'trails'

export type Look = { id: LookId; label: string; patch: LabPatch }

export const LOOKS: Look[] = [
  {
    id: 'frame',
    label: 'Frame',
    patch: {
      territory: { bands: ['blocks', 'beads', 'shingle', 'photo'], boundary: 'hard' },
      structure: { baseCell: 30, maxLevels: 1, subdivide: 0.5 },
      finish: { grain: 0.08 },
      sourceVisibility: 0,
    },
  },
  {
    id: 'pixels',
    label: 'Pixels',
    patch: {
      territory: { bands: ['mosaic', 'mosaic', 'photo'], boundary: 'hard' },
      structure: { baseCell: 40, maxLevels: 1, subdivide: 0.55 },
      finish: { grain: 0.1 },
      sourceVisibility: 0,
    },
  },
  {
    id: 'scanlines',
    label: 'Scanlines',
    patch: {
      territory: { bands: ['scan', 'scan', 'photo'], boundary: 'hard' },
      structure: { baseCell: 24, maxLevels: 0, subdivide: 0 },
      flow: { warp: 1 },
      finish: { grain: 0.12 },
      sourceVisibility: 0,
    },
  },
  {
    id: 'streams',
    label: 'Streams',
    patch: {
      territory: { bands: ['streams', 'streams', 'empty', 'photo'], boundary: 'hard' },
      flow: { basis: 'curve', curl: 0.35, scale: 0.5 },
      finish: { grain: 0.1 },
      sourceVisibility: 0,
    },
  },
  {
    id: 'brushwork',
    label: 'Brushwork',
    patch: {
      territory: { bands: ['dabs', 'dabs', 'dabs', 'photo'], boundary: 'hard' },
      structure: { baseCell: 26, maxLevels: 1, subdivide: 0.6 },
      mark: { colorMode: 'source', occupancy: 1 },
      flow: { basis: 'curve', curl: 0.5, scale: 0.35 },
      finish: { grain: 0.18 },
      sourceVisibility: 0,
    },
  },
  {
    id: 'beads',
    label: 'Beads',
    patch: {
      territory: { bands: ['beads', 'beads', 'photo'], boundary: 'hard' },
      structure: { baseCell: 40, maxLevels: 0, subdivide: 0 },
      finish: { grain: 0.05 },
      sourceVisibility: 0,
    },
  },
  {
    id: 'quilt',
    label: 'Quilt',
    patch: {
      territory: { bands: ['blocks', 'blocks', 'photo'], boundary: 'hard' },
      structure: { baseCell: 72, maxLevels: 1, subdivide: 0.35 },
      finish: { grain: 0 },
      sourceVisibility: 0,
    },
  },
  {
    id: 'weave',
    label: 'Weave',
    patch: {
      territory: { bands: ['shingle', 'shingle', 'photo'], boundary: 'hard' },
      structure: { baseCell: 84, maxLevels: 1, subdivide: 0.3 },
      finish: { grain: 0.2 },
      sourceVisibility: 0,
    },
  },
  {
    id: 'marks',
    label: 'Marks',
    patch: {
      territory: { bands: ['empty', 'marks', 'contours', 'photo'], boundary: 'hard' },
      structure: { baseCell: 28, maxLevels: 2, subdivide: 0.55 },
      mark: { colorMode: 'palette', occupancy: 0.85, echo: 0 },
      finish: { grain: 0.05 },
      sourceVisibility: 0,
    },
  },
  {
    id: 'trails',
    label: 'Trails',
    patch: {
      territory: { bands: ['empty', 'marks', 'marks', 'photo'], boundary: 'hard' },
      structure: { baseCell: 34, maxLevels: 0, subdivide: 0 },
      mark: { colorMode: 'palette', echo: 4, bank: 'geo', occupancy: 0.9 },
      flow: { basis: 'angle', angle: 0, curl: 0.15 },
      finish: { grain: 0.1 },
      sourceVisibility: 0,
    },
  },
]

// looks assume an image; without one, 'photo' zones render as ground —
// these swaps keep the no-image compositions full instead of hollow
export function lookPatchFor(look: Look, hasSource: boolean): LabPatch {
  if (hasSource) return look.patch
  const bands = look.patch.territory?.bands
  if (!bands) return look.patch
  return {
    ...look.patch,
    territory: {
      ...look.patch.territory,
      bands: bands.map((b) => (b === 'photo' ? 'mosaic' : b)),
    },
  }
}
