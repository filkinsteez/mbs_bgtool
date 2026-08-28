import type { LabPatch } from '../labStore'
import type { Look, LookId } from '../looks'

// V1b Looks are FULL-FRAME fields: no band is quiet, so no Look sits a
// shape on solid ground. The territory grades density and color instead
// of gating presence.
// LOOKS — the preset layer every shipped image tool leads with. A look
// is a plain LabPatch: applying one goes through the normal patch/undo
// path, so every control underneath lands on real editable values (a
// look is an editable state, not a flattened result). Looks never touch
// the source, the output size, the painted mask, or the seed — your
// image and your strokes survive every look change.
//
// All ten are today's proven recipes, judged against the reference
// sheet before earning a slot.




const V1B_LOOKS: Look[] = [
  {
    id: 'frame',
    label: 'Frame',
    patch: {
      // blocks carry the symbol body; the territory lean inside
      // buildBlockFills keeps paper breathing through the mosaic
      territory: { bands: ['blocks', 'blocks', 'blocks', 'blocks'], boundary: 'hard' },
      structure: { baseCell: 30, maxLevels: 1, subdivide: 0.46 },
      finish: { grain: 0.08 },
      sourceVisibility: 0,
    },
  },
  {
    id: 'pixels',
    label: 'Pixels',
    patch: {
      territory: { bands: ['mosaic', 'mosaic', 'mosaic', 'mosaic'], boundary: 'dither' },
      structure: { baseCell: 40, maxLevels: 2, subdivide: 0.72 },
      finish: { grain: 0.1 },
      sourceVisibility: 0,
    },
  },
  {
    id: 'scanlines',
    label: 'Scanlines',
    patch: {
      territory: { bands: ['scan', 'scan', 'scan'], boundary: 'porous' },
      structure: { baseCell: 24, maxLevels: 0, subdivide: 0 },
      flow: { basis: 'contour', curl: 0.22, warp: 1 },
      finish: { grain: 0.05 },
      sourceVisibility: 0,
    },
  },
  {
    id: 'streams',
    label: 'Streams',
    patch: {
      territory: { bands: ['streams', 'streams', 'streams', 'streams'], boundary: 'porous' },
      flow: { basis: 'curve', curl: 0.22, scale: 0.42 },
      finish: { grain: 0.1 },
      sourceVisibility: 0,
    },
  },
  {
    id: 'brushwork',
    label: 'Brushwork',
    patch: {
      territory: { bands: ['dabs', 'dabs', 'dabs'], boundary: 'porous' },
      structure: { baseCell: 26, maxLevels: 2, subdivide: 0.68 },
      mark: { colorMode: 'palette', occupancy: 1 },
      flow: { basis: 'curve', curl: 0.5, scale: 0.35 },
      finish: { grain: 0.12 },
      sourceVisibility: 0,
    },
  },
  {
    id: 'beads',
    label: 'Beads',
    patch: {
      territory: { bands: ['beads', 'beads', 'beads', 'beads'], boundary: 'hard' },
      structure: { baseCell: 40, maxLevels: 0, subdivide: 0 },
      finish: { grain: 0.05 },
      sourceVisibility: 0,
    },
  },
  {
    id: 'quilt',
    label: 'Quilt',
    patch: {
      territory: { bands: ['blocks', 'blocks', 'blocks', 'blocks'], boundary: 'hard' },
      structure: { baseCell: 72, maxLevels: 2, subdivide: 0.52 },
      finish: { grain: 0 },
      sourceVisibility: 0,
    },
  },
  {
    id: 'weave',
    label: 'Weave',
    patch: {
      territory: { bands: ['shingle', 'shingle', 'shingle', 'shingle'], boundary: 'dither' },
      structure: { baseCell: 84, maxLevels: 1, subdivide: 0.42 },
      finish: { grain: 0.14 },
      sourceVisibility: 0,
    },
  },
  {
    id: 'marks',
    label: 'Marks',
    patch: {
      territory: { bands: ['marks', 'marks', 'contours', 'photo'], boundary: 'hard' },
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
      territory: { bands: ['marks', 'marks', 'marks'], boundary: 'porous' },
      structure: { baseCell: 34, maxLevels: 0, subdivide: 0 },
      mark: { colorMode: 'palette', echo: 4, bank: 'geo', occupancy: 0.9 },
      flow: { basis: 'angle', angle: 0, curl: 0.15 },
      finish: { grain: 0.1 },
      sourceVisibility: 0,
    },
  },
]

type ComplexityProfile = {
  coarseCell: number
  fineCell: number
  levels: readonly [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2]
  subdivide: readonly [number, number]
  occupancy?: readonly [number, number]
  curl?: readonly [number, number]
  warp?: readonly [number, number]
  echo?: readonly [number, number]
}

const COMPLEXITY_PROFILES: Record<LookId, ComplexityProfile> = {
  frame: { coarseCell: 76, fineCell: 22, levels: [0, 1, 1], subdivide: [0.24, 0.62] },
  pixels: { coarseCell: 98, fineCell: 28, levels: [1, 1, 2], subdivide: [0.38, 0.9] },
  scanlines: {
    coarseCell: 52,
    fineCell: 12,
    levels: [0, 0, 0],
    subdivide: [0, 0],
    curl: [0.08, 0.42],
    warp: [0.42, 1],
  },
  streams: {
    coarseCell: 92,
    fineCell: 20,
    levels: [0, 0, 0],
    subdivide: [0, 0],
    // beyond ~0.3 the curl overwhelms the curve basis and the hatching
    // collapses into fingerprint whorls with visible spiral centers
    curl: [0.08, 0.28],
  },
  brushwork: {
    // dense enough to read as stippling even at the calm end — sparse
    // large dabs on paper read as noise, not brushwork
    coarseCell: 44,
    fineCell: 18,
    levels: [0, 1, 1],
    subdivide: [0.28, 0.78],
    occupancy: [0.72, 1],
    curl: [0.12, 0.4],
  },
  beads: { coarseCell: 82, fineCell: 18, levels: [0, 0, 0], subdivide: [0, 0] },
  quilt: { coarseCell: 96, fineCell: 40, levels: [0, 1, 2], subdivide: [0.22, 0.72] },
  weave: { coarseCell: 116, fineCell: 32, levels: [0, 0, 1], subdivide: [0, 0.4] },
  marks: {
    coarseCell: 44,
    fineCell: 14,
    // two subdivision levels grind sourceless marks into sub-pixel dust;
    // one level keeps every stamp legible at export scale
    levels: [0, 1, 1],
    subdivide: [0.3, 0.8],
    occupancy: [0.72, 0.98],
  },
  trails: {
    coarseCell: 64,
    fineCell: 20,
    levels: [1, 1, 1],
    subdivide: [0.35, 0.56],
    occupancy: [0.68, 0.94],
    // near-linear runs, short comets: heavy curl and long echo chains
    // turn the trail grammar into swirling smoke
    curl: [0.1, 0.28],
    echo: [3, 6],
  },
}

function mix(from: number, to: number, amount: number): number {
  return from + (to - from) * amount
}

export function lookComplexityPatchV1b(lookId: LookId, value: number): LabPatch {
  const complexity = Math.max(0, Math.min(1, value))
  // Preserve the dense echo grammar that makes Trails coherent. The low end
  // should simplify it, not reduce it to unrelated fragments.
  const structuralComplexity = lookId === 'trails'
    ? 0.52 + complexity * 0.48
    : complexity
  const profile = COMPLEXITY_PROFILES[lookId]
  const level = profile.levels[
    structuralComplexity < 0.34 ? 0 : structuralComplexity < 0.67 ? 1 : 2
  ]
  const patch: LabPatch = {
    structure: {
      baseCell: Math.round(mix(profile.coarseCell, profile.fineCell, structuralComplexity)),
      maxLevels: level,
      subdivide: mix(profile.subdivide[0], profile.subdivide[1], structuralComplexity),
    },
  }
  if (profile.occupancy) {
    patch.mark = {
      occupancy: mix(profile.occupancy[0], profile.occupancy[1], structuralComplexity),
    }
  }
  if (profile.curl || profile.warp) {
    patch.flow = {}
    if (profile.curl) {
      patch.flow.curl = mix(profile.curl[0], profile.curl[1], structuralComplexity)
    }
    if (profile.warp) {
      patch.flow.warp = mix(profile.warp[0], profile.warp[1], structuralComplexity)
    }
  }
  if (profile.echo) {
    patch.mark = {
      ...patch.mark,
      echo: Math.round(mix(profile.echo[0], profile.echo[1], structuralComplexity)),
    }
  }
  return patch
}

// Generated backgrounds are full-frame artwork. Photo zones become palette
// mosaics and sparse zones become solid quiet space rather than accidental
// transparency that reveals the editor behind the canvas. Marks is the
// exception: a solid mosaic core would read as a blob inside its speckle
// grammar, so its photo zone densifies into marks instead.
function v1bPatch(look: Look, hasSource: boolean): LabPatch {
  if (hasSource) return look.patch
  const bands = look.patch.territory?.bands
  if (!bands) return look.patch
  return {
    ...look.patch,
    territory: {
      ...look.patch.territory,
      bands: bands.map((band) => {
        if (band === 'photo') return look.id === 'marks' ? 'marks' : 'mosaic'
        if (band === 'empty') return 'quiet'
        return band
      }),
    },
  }
}

// Entry point for the dispatcher: V1b resolves the preset from its OWN
// table by id, so the shared LOOKS array never leaks V2 patches into it.
export function lookPatchForV1b(lookId: LookId, hasSource: boolean): LabPatch {
  const look = V1B_LOOKS.find((item) => item.id === lookId) ?? V1B_LOOKS[0]
  return v1bPatch(look, hasSource)
}
