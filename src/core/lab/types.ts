import type { CompositionPlan } from './compositionPlan'
import type { LookColorPlan } from './colorDirection'

// Research-lab state. A LabState IS the recipe: everything needed to
// regenerate a study except the source pixels themselves, which are
// matched back by contentHash when a recipe is restored. Bitmaps and
// analysis rasters never enter this state — history snapshots are
// JSON.stringify of it, so it stays a few KB. (The painted mask is the
// one raster that DOES live here: it is authored state, capped at a
// 128-wide byte grid ≈ 10KB base64.)
export const LAB_VERSION = 1

export type LabFit = 'contain' | 'cover'
// V1b is a comparison variant of the V1-era Canvas2D pipeline carrying the
// texture-on-paper color direction. It lives in `./v1b` and does not share
// renderers with V1 or V2, so neither is affected by changes to it.
// V4 is the next catalog generation: three systems rendered through
// src/core/lab/v4/ over the same V2Env the V3-tab systems consume.
export type LookVersion = 'v1' | 'v1b' | 'v2' | 'v4'

export type LabSourceMeta = {
  filename?: string
  width: number // source pixels
  height: number
  contentHash?: string
  fit: LabFit
}

// ---------------------------------------------------------------------------
// Territory: WHERE different laws apply. A stack of masking fields —
// the brand curve's distance field, gradients, a painted mask, image
// signals — composes into one scalar territory, which quantizes into
// BANDS. Each band owns a treatment; the boundary decides how bands
// hand off (hard grid steps, ordered dither, porous noise).

export type FieldSourceKind = 'curve' | 'linear' | 'radial' | 'tone' | 'detail' | 'paint'
export type CombineMode = 'add' | 'subtract' | 'multiply' | 'max'

// snapshot of the editor curve taken when the source is added, so a
// recipe reproduces without the editor's autosave present
export type CurveSnapshot = {
  frequencyX: number
  frequencyY: number
  phase: number
  amplitudeX: number
  amplitudeY: number
  rotation: number
  offsetX: number
  offsetY: number
  curve?: 'meta'
  silhouette?: 'meta-symbol'
}

export type FieldSourceState = {
  id: string
  kind: FieldSourceKind
  enabled: boolean
  weight: number // 0..1
  invert: boolean
  combine: CombineMode
  // linear: direction + midpoint position along it; softness = ramp width
  angle: number // radians
  offset: number // 0..1
  softness: number // 0..1 — also the curve band width and radial falloff
  // radial
  centerX: number // 0..1 of output width
  centerY: number
  radius: number // 0..1 of output min dimension
  curve?: CurveSnapshot
}

export type TreatmentId =
  | 'empty'
  | 'quiet'
  | 'flat'
  | 'mosaic'
  | 'photo'
  | 'marks'
  | 'contours'
  | 'scan'
  | 'dabs'
  | 'streams'
  | 'blocks'
  | 'beads'
  | 'shingle'

// labels are perceptual — what the zone will look like, not how the
// renderer works
export const TREATMENTS: { id: TreatmentId; label: string }[] = [
  { id: 'photo', label: 'Photo' },
  { id: 'empty', label: 'None' },
  { id: 'mosaic', label: 'Pixels' },
  { id: 'blocks', label: 'Color blocks' },
  { id: 'beads', label: 'Dot grid' },
  { id: 'shingle', label: 'Gradients' },
  { id: 'marks', label: 'Marks' },
  { id: 'contours', label: 'Contour lines' },
  { id: 'scan', label: 'Scanlines' },
  { id: 'dabs', label: 'Brush dabs' },
  { id: 'streams', label: 'Flow lines' },
  { id: 'flat', label: 'Ink fill' },
]

// The vector field: WHICH WAY the process treatments move. The scalar
// territory decides where a law applies; flow decides the direction
// scan lines bend, dabs stroke, and streams travel.
export type FlowBasis = 'curve' | 'noise' | 'contour' | 'angle'

export type FlowState = {
  basis: FlowBasis
  angle: number // radians, the 'angle' basis direction
  curl: number // 0..1 — noise turbulence blended over the basis
  scale: number // 0..1 — noise feature size (small = tight eddies)
  warp: number // 0..1 — image-luminance displacement on scan lines
}

export type BoundaryMode = 'hard' | 'dither' | 'porous'

export type TerritoryState = {
  sources: FieldSourceState[]
  bands: TreatmentId[] // band 0 = territory 0 (far), last = territory 1 (near)
  boundary: BoundaryMode
  // global territory gain — the COVERAGE dial: how far the effect
  // reaches. Works in every composition because it shifts every band
  // boundary at once.
  gain: number
}

// the multiscale carrier: base cells that subdivide where image detail
// (scaled by SUBDIVIDE) demands finer resolution
export type StructureState = {
  baseCell: number // output px
  maxLevels: 0 | 1 | 2
  subdivide: number // 0..1 eagerness
}

// painted mask, output-space, stored as raw bytes in base64
export type PaintState = {
  w: number
  h: number
  data: string
}

export type MarkBankId = 'dots' | 'geo' | 'brand'
export type MarkColorMode = 'ink' | 'tint' | 'source' | 'palette'

export type MarkParams = {
  bank: MarkBankId
  evidenceMix: number // 0 tone chooses the mark, 1 structure chooses it
  occupancy: number
  minScale: number
  maxScale: number
  rotationInfluence: number // edge direction rotates marks
  flow: number // 0 image edges orient marks .. 1 the curve's tangent does
  coherenceScale: number
  colorMode: MarkColorMode
  // each mark repeats along the flow with a decaying ramp — motion
  // unfolded into space (0 = single stamp)
  echo: number
}

export type MotionState = {
  enabled: boolean
  amount: number // 0..1
  speed: number // 0.1..2, blends in faster temporal harmonics
  loopSeconds: number // loop duration for deterministic previews
  // Runtime-only phase injected by applyMotionAt. Persisted recipes omit it.
  frame?: { phase: number }
}

export type LabState = {
  version: number
  studyId: 'territory'
  seed: number
  output: { width: number; height: number; transparent: boolean }
  source: LabSourceMeta | null
  sourceMask?: 'border-distance'
  territory: TerritoryState
  structure: StructureState
  mark: MarkParams
  paint: PaintState | null
  sourceVisibility: number // 0..1 alpha of the source under everything
  // ink = hairline/mark color, paper = ground, palette = the color
  // system every fill treatment deals from — the references are all
  // palette surfaces, not marks on paper. distinct is material mode only
  // (sourceAwareLabForRecipe): the palette deduplicated to its distinct
  // colors in mix order, for slot arithmetic that degenerates on the
  // 100-slot run-length palette (a shift of floor(t*100) mod 100 lands
  // inside same-color runs). 2D recipes never set it.
  colors: {
    ink: string
    paper: string
    palette: string[]
    distinct?: string[]
    plan?: LookColorPlan
  }
  flow: FlowState
  // shared surface pass over the whole composite
  finish: { grain: number }
  // the applied look and its strength: 1 = full effect, lower blends
  // the photo back over the result (the Lightroom-Amount read)
  look: {
    id: string | null
    strength: number
    complexity?: number
    version?: LookVersion
  }
  composition?: CompositionPlan
  motion: MotionState
}

// Views are ui, not recipe: composite plus the intermediate maps that
// explain the outcome (the brief's "maps as creative evidence").
export type LabView =
  | 'composite'
  | 'source'
  | 'territory'
  | 'bands'
  | 'cells'
  | 'lum'
  | 'edge'
  | 'orient'

export const LAB_VIEWS: { id: LabView; label: string }[] = [
  { id: 'composite', label: 'Result' },
  { id: 'source', label: 'Photo' },
  { id: 'territory', label: 'Effect area' },
  { id: 'bands', label: 'Zones' },
  { id: 'cells', label: 'Grid' },
  { id: 'lum', label: 'Tone' },
  { id: 'edge', label: 'Edges' },
  { id: 'orient', label: 'Direction' },
]
