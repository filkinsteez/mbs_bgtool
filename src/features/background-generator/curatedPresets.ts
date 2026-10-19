export {
  ELEMENTAL_ACCENTS,
  PRODUCTION_COLOR_PACKS,
  type PalettePack as ProductionColorPack,
  type ProductionColorPackId,
} from './palette/registry'
import type { SpatialGradientField } from '@/core/lab/gradients/spatialField'

export type GradientFamily = 'diffusion' | 'smear'
export type GradientOrientation = 0 | 90 | 180 | 270

export type SemanticGradientControls = {
  detail: number
  blend: number
  distortion: number
  position: number
}

export type CuratedPreset = {
  id: string
  label: string
  family: GradientFamily
  seed: number
  controls: SemanticGradientControls
  grain: number
  orientation: GradientOrientation
  field: SpatialGradientField
}

export const CURATED_PRESETS: readonly CuratedPreset[] = [
  {
    id: 'soft-diffusion',
    label: 'Soft Diffusion',
    family: 'diffusion',
    seed: 1913,
    controls: { detail: 0.3, blend: 0.8, distortion: 0.2, position: 0.5 },
    grain: 0.06,
    orientation: 0,
    field: {
      version: 1,
      sources: [
        { id: 'primary', x: 0.36, y: 0.58, spread: 0.58 },
        { id: 'secondary', x: 0.7, y: 0.36, spread: 0.48 },
        { id: 'tertiary', x: 0.6, y: 0.78, spread: 0.42 },
      ],
    },
  },
  {
    id: 'focused-diffusion',
    label: 'Focused Diffusion',
    family: 'diffusion',
    seed: 9027,
    controls: { detail: 0.42, blend: 0.18, distortion: 0.28, position: 0.62 },
    grain: 0.03,
    orientation: 90,
    field: {
      version: 1,
      sources: [
        { id: 'primary', x: 0.43, y: 0.46, spread: 0.42 },
        { id: 'secondary', x: 0.76, y: 0.5, spread: 0.52 },
        { id: 'tertiary', x: 0.58, y: 0.24, spread: 0.38 },
      ],
    },
  },
  {
    id: 'folded-diffusion',
    label: 'Folded Diffusion',
    family: 'diffusion',
    seed: 14023,
    controls: { detail: 0.62, blend: 0.42, distortion: 0.82, position: 0.18 },
    grain: 0.08,
    orientation: 270,
    field: {
      version: 1,
      sources: [
        { id: 'primary', x: 0.3, y: 0.44, spread: 0.56 },
        { id: 'secondary', x: 0.52, y: 0.78, spread: 0.5 },
        { id: 'tertiary', x: 0.74, y: 0.26, spread: 0.4 },
      ],
    },
  },
  {
    id: 'wide-smear',
    label: 'Wide Smear',
    family: 'smear',
    seed: 1913,
    controls: { detail: 0.18, blend: 0.6, distortion: 0.28, position: 0.5 },
    grain: 0.05,
    orientation: 0,
    field: {
      version: 1,
      sources: [
        { id: 'primary', x: 0.34, y: 0.64, spread: 0.62 },
        { id: 'secondary', x: 0.65, y: 0.36, spread: 0.46 },
        { id: 'tertiary', x: 0.8, y: 0.62, spread: 0.34 },
      ],
    },
  },
  {
    id: 'fine-smear',
    label: 'Fine Smear',
    family: 'smear',
    seed: 9027,
    controls: { detail: 0.82, blend: 0.32, distortion: 0.4, position: 0.64 },
    grain: 0.1,
    orientation: 90,
    field: {
      version: 1,
      sources: [
        { id: 'primary', x: 0.44, y: 0.62, spread: 0.44 },
        { id: 'secondary', x: 0.72, y: 0.34, spread: 0.36 },
        { id: 'tertiary', x: 0.24, y: 0.28, spread: 0.4 },
      ],
    },
  },
  {
    id: 'folded-smear',
    label: 'Folded Smear',
    family: 'smear',
    seed: 14023,
    controls: { detail: 0.58, blend: 0.38, distortion: 0.86, position: 0.24 },
    grain: 0.08,
    orientation: 180,
    field: {
      version: 1,
      sources: [
        { id: 'primary', x: 0.56, y: 0.34, spread: 0.52 },
        { id: 'secondary', x: 0.24, y: 0.68, spread: 0.46 },
        { id: 'tertiary', x: 0.76, y: 0.74, spread: 0.38 },
      ],
    },
  },
]

export const DEFAULT_PRESET_ID = 'soft-diffusion'

export function findPreset(id: string): CuratedPreset {
  return CURATED_PRESETS.find((preset) => preset.id === id) ?? CURATED_PRESETS[0]
}

