import type { LookColorPlan } from './colorDirection'
import type { Deformation } from './gradients/deformation'
import type { LookId } from './looks'

export type LabFit = 'contain' | 'cover'
export type LookVersion = 'gradients'
export type LabView = 'composite'

export type GradientSettings = {
  softness: number
  distortion: number
  grain: number
  scale?: number
  folds?: number
  bleed?: number
  depth?: number
  reflow?: number
  orientation?: 0 | 90 | 180 | 270
  centerX?: number
  centerY?: number
  source1X?: number
  source1Y?: number
  source1Spread?: number
  source2X?: number
  source2Y?: number
  source2Spread?: number
  source3X?: number
  source3Y?: number
  source3Spread?: number
  sourceCount?: number
}

export type LabSourceMeta = {
  filename?: string
  width: number
  height: number
  contentHash?: string
  fit: LabFit
}

export type LabState = {
  version: 1
  studyId: 'territory'
  seed: number
  output: {
    width: number
    height: number
    transparent: false
  }
  source: LabSourceMeta | null
  colors: {
    ink: string
    paper: string
    palette: string[]
    plan?: LookColorPlan
  }
  look: {
    id: LookId
    strength: number
    complexity: number
    version: LookVersion
    gradient: GradientSettings
    deformation?: Deformation
  }
}
