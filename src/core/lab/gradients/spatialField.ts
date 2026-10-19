export type SpatialSourceId = 'primary' | 'secondary' | 'tertiary'

export type SpatialFieldSource = {
  id: SpatialSourceId
  x: number
  y: number
  spread: number
}

export type SpatialGradientField = {
  version: 1
  sources: [SpatialFieldSource, SpatialFieldSource, SpatialFieldSource]
}

const IDS: readonly SpatialSourceId[] = ['primary', 'secondary', 'tertiary']

function clamp01(value: number, fallback: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : fallback))
}

function normalizeSource(
  fallback: SpatialFieldSource,
  value?: Partial<SpatialFieldSource> | null,
): SpatialFieldSource {
  return {
    id: fallback.id,
    x: clamp01(value?.x ?? fallback.x, fallback.x),
    y: clamp01(value?.y ?? fallback.y, fallback.y),
    spread: clamp01(value?.spread ?? fallback.spread, fallback.spread),
  }
}

export function createDefaultSpatialGradientField(
  seed = 0.5,
): SpatialGradientField {
  const arc = (Math.max(0, Math.min(1, seed)) - 0.5) * 0.18
  return {
    version: 1,
    sources: [
      { id: 'primary', x: 0.32 + arc, y: 0.52 - arc * 0.4, spread: 0.55 },
      { id: 'secondary', x: 0.64 - arc * 0.6, y: 0.35 + arc * 0.25, spread: 0.5 },
      { id: 'tertiary', x: 0.7 + arc * 0.35, y: 0.73 - arc * 0.2, spread: 0.45 },
    ],
  }
}

export function normalizeSpatialGradientField(
  value: Partial<SpatialGradientField> | null | undefined,
  fallback: SpatialGradientField = createDefaultSpatialGradientField(),
): SpatialGradientField {
  const fallbackMap = new Map(fallback.sources.map((source) => [source.id, source]))
  const raw = Array.isArray(value?.sources) ? value.sources : []
  const rawMap = new Map<SpatialSourceId, Partial<SpatialFieldSource>>()
  for (const source of raw) {
    const id = source?.id
    if (!IDS.includes(id as SpatialSourceId)) continue
    rawMap.set(id as SpatialSourceId, source)
  }
  const sources = IDS.map((id) =>
    normalizeSource(
      fallbackMap.get(id)!,
      rawMap.get(id),
    )) as SpatialGradientField['sources']
  return {
    version: 1,
    sources,
  }
}

export function activeSpatialSources(
  field: SpatialGradientField,
  count: number,
): SpatialFieldSource[] {
  const safeCount = Math.max(1, Math.min(3, Math.round(count)))
  return field.sources.slice(0, safeCount).map((source) => ({ ...source }))
}

