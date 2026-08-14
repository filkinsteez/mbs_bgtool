import type { BoundaryMode } from '@/core/lab/types'
import { STAINLESS_STEEL_PRESET } from './stainlessSteel'

export type MaterialId = 'clean' | 'liquid' | 'glass' | 'metal' | 'film' | 'pixel' | 'crt'

export type ShaderMaterialSpec = {
  id: MaterialId
  label: string
  shaderPrimitives: readonly string[]
  source: 'shaders.com'
  notes: string
  preset?: {
    id: string
    mcpTitle: string
  }
  fallback: {
    grain: number
    curl: number
    boundary: BoundaryMode
    subdivide: number
  }
}

// Development-time provenance manifest for the licensed Shaders runtime.
// We keep the mapping explicit so every UI material has a traceable source.
export const SHADERS_CATALOG: ShaderMaterialSpec[] = [
  { id: 'clean', label: 'Clean', shaderPrimitives: [], source: 'shaders.com', notes: 'unmodified renderer baseline', fallback: { grain: 0.02, curl: 0.05, boundary: 'hard', subdivide: 0.35 } },
  { id: 'liquid', label: 'Liquid', shaderPrimitives: ['LiquidMetal', 'Blob'], source: 'shaders.com', notes: 'fluid distortion with bubbles', fallback: { grain: 0.08, curl: 0.7, boundary: 'porous', subdivide: 0.55 } },
  { id: 'glass', label: 'Glass', shaderPrimitives: ['Glass', 'GlassTiles'], source: 'shaders.com', notes: 'refracted soft-edge finish', fallback: { grain: 0.03, curl: 0.22, boundary: 'hard', subdivide: 0.28 } },
  {
    id: 'metal',
    label: STAINLESS_STEEL_PRESET.displayLabel,
    shaderPrimitives: ['StudioBackground', 'Glass', 'Swirl', 'FilmGrain'],
    source: 'shaders.com',
    notes: 'Stainless Steel 1 replaces the previous Metal treatment',
    preset: {
      id: STAINLESS_STEEL_PRESET.id,
      mcpTitle: STAINLESS_STEEL_PRESET.mcpTitle,
    },
    fallback: { grain: 0.12, curl: 0.35, boundary: 'hard', subdivide: 0.48 },
  },
  { id: 'film', label: 'Film Grain', shaderPrimitives: ['FilmGrain', 'FilmStock'], source: 'shaders.com', notes: 'global grain and stock texture', fallback: { grain: 0.28, curl: 0.2, boundary: 'dither', subdivide: 0.42 } },
  { id: 'pixel', label: 'Pixel', shaderPrimitives: ['Pixelate'], source: 'shaders.com', notes: 'pixel quantization finish', fallback: { grain: 0.06, curl: 0.08, boundary: 'hard', subdivide: 0.08 } },
  { id: 'crt', label: 'CRT', shaderPrimitives: ['CRTScreen'], source: 'shaders.com', notes: 'scanline and phosphor finish', fallback: { grain: 0.18, curl: 0.3, boundary: 'dither', subdivide: 0.2 } },
]

export const MATERIAL_BY_ID = Object.fromEntries(
  SHADERS_CATALOG.map((material) => [material.id, material]),
) as Record<MaterialId, ShaderMaterialSpec>
