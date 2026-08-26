export type MaterialId = 'clean' | 'liquid' | 'glass' | 'metal'

export type MaterialSpec = {
  id: MaterialId
  label: string
  notes: string
}

export const MATERIALS: MaterialSpec[] = [
  { id: 'clean', label: 'Clean', notes: 'Unmodified matte surface' },
  { id: 'liquid', label: 'Liquid', notes: 'Glossy fluid surface' },
  { id: 'glass', label: 'Glass', notes: 'Clear refracted surface' },
  { id: 'metal', label: 'Stainless Steel', notes: 'Reflective brushed-metal surface' },
]

export const MATERIAL_BY_ID = Object.fromEntries(
  MATERIALS.map((material) => [material.id, material]),
) as Record<MaterialId, MaterialSpec>
