import type { LabPatch } from '../labStore'
import type { Look, LookId } from '../looks'

// Snapshot of every Look preset from git commit 67f7de1.
export const V1_LOOK_PATCHES: Record<LookId, LabPatch> = {
  frame: {
    territory: { bands: ['blocks', 'beads', 'shingle', 'photo'], boundary: 'hard' },
    structure: { baseCell: 30, maxLevels: 1, subdivide: 0.5 },
    finish: { grain: 0.08 },
    sourceVisibility: 0,
  },
  pixels: {
    territory: { bands: ['mosaic', 'mosaic', 'photo'], boundary: 'hard' },
    structure: { baseCell: 40, maxLevels: 1, subdivide: 0.55 },
    finish: { grain: 0.1 },
    sourceVisibility: 0,
  },
  scanlines: {
    territory: { bands: ['scan', 'scan', 'photo'], boundary: 'hard' },
    structure: { baseCell: 24, maxLevels: 0, subdivide: 0 },
    flow: { warp: 1 },
    finish: { grain: 0.12 },
    sourceVisibility: 0,
  },
  streams: {
    territory: { bands: ['streams', 'streams', 'empty', 'photo'], boundary: 'hard' },
    flow: { basis: 'curve', curl: 0.35, scale: 0.5 },
    finish: { grain: 0.1 },
    sourceVisibility: 0,
  },
  brushwork: {
    territory: { bands: ['dabs', 'dabs', 'dabs', 'photo'], boundary: 'hard' },
    structure: { baseCell: 26, maxLevels: 1, subdivide: 0.6 },
    mark: { colorMode: 'source', occupancy: 1 },
    flow: { basis: 'curve', curl: 0.5, scale: 0.35 },
    finish: { grain: 0.18 },
    sourceVisibility: 0,
  },
  beads: {
    territory: { bands: ['beads', 'beads', 'photo'], boundary: 'hard' },
    structure: { baseCell: 40, maxLevels: 0, subdivide: 0 },
    finish: { grain: 0.05 },
    sourceVisibility: 0,
  },
  quilt: {
    territory: { bands: ['blocks', 'blocks', 'photo'], boundary: 'hard' },
    structure: { baseCell: 72, maxLevels: 1, subdivide: 0.35 },
    finish: { grain: 0 },
    sourceVisibility: 0,
  },
  weave: {
    territory: { bands: ['shingle', 'shingle', 'photo'], boundary: 'hard' },
    structure: { baseCell: 84, maxLevels: 1, subdivide: 0.3 },
    finish: { grain: 0.2 },
    sourceVisibility: 0,
  },
  marks: {
    territory: { bands: ['empty', 'marks', 'contours', 'photo'], boundary: 'hard' },
    structure: { baseCell: 28, maxLevels: 2, subdivide: 0.55 },
    mark: { colorMode: 'palette', occupancy: 0.85, echo: 0 },
    finish: { grain: 0.05 },
    sourceVisibility: 0,
  },
  trails: {
    territory: { bands: ['empty', 'marks', 'marks', 'photo'], boundary: 'hard' },
    structure: { baseCell: 34, maxLevels: 0, subdivide: 0 },
    mark: { colorMode: 'palette', echo: 4, bank: 'geo', occupancy: 0.9 },
    flow: { basis: 'angle', angle: 0, curl: 0.15 },
    finish: { grain: 0.1 },
    sourceVisibility: 0,
  },
}

export function v1LookPatchFor(look: Look, hasSource: boolean): LabPatch {
  const patch = V1_LOOK_PATCHES[look.id]
  if (hasSource) return patch
  const bands = patch.territory?.bands
  if (!bands) return patch
  return {
    ...patch,
    territory: {
      ...patch.territory,
      bands: bands.map((band) => (band === 'photo' ? 'mosaic' : band)),
    },
  }
}

export function v1DetailPatch(detail: number): LabPatch {
  return {
    structure: {
      baseCell: Math.round(16 + detail * 72),
    },
  }
}
