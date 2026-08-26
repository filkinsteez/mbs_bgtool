import {
  EXTENDED_APPROVED_COLORS,
  EXTENDED_CORE,
  EXTENDED_DEEP_BLUES,
  EXTENDED_NEUTRALS,
  EXTENDED_PRODUCT_BLUES,
} from './extended'

export type PaletteTier = 'primary' | 'secondary' | 'extended'

export type PalettePack = {
  id: string
  label: string
  tier: PaletteTier
  source: string
  hue: string
  tone: string
  colors: readonly string[]
}

export const META_BLUE = '#0064E0'
export const CUSTOM_PALETTE_ID = 'custom'

export const APPROVED_COLOR_GROUPS = [
  { id: 'core', label: 'Core ramps', colors: EXTENDED_CORE },
  { id: 'neutral', label: 'Neutrals', colors: EXTENDED_NEUTRALS },
  { id: 'product-blue', label: 'Product blues', colors: EXTENDED_PRODUCT_BLUES },
  { id: 'deep-blue', label: 'Deep blues', colors: EXTENDED_DEEP_BLUES },
] as const

export const PALETTE_PACKS: readonly PalettePack[] = [
  {
    id: 'primary-core',
    label: 'Primary',
    tier: 'primary',
    source: 'primary-palette-reference.png',
    hue: 'blue',
    tone: 'full ramp',
    colors: ['#0288F9', '#006CE1', '#034AE0', '#093AC7', '#132682'],
  },
  {
    id: 'primary-neutrals',
    label: 'Neutrals',
    tier: 'primary',
    source: 'primary-palette-reference.png',
    hue: 'neutral',
    tone: 'light to dark',
    colors: ['#FFFFFF', '#D1D4DB', '#8B9BAA', '#506171', '#27353E', '#000000'],
  },
  {
    id: 'bold',
    label: 'Bold',
    tier: 'secondary',
    source: 'bold-palette-reference.png',
    hue: 'cyan, yellow, orange',
    tone: 'vivid',
    colors: ['#26C8EE', '#FED61F', '#FF5001'],
  },
  {
    id: 'harmonious',
    label: 'Harmonious',
    tier: 'secondary',
    source: 'harmonious-palette-reference.png',
    hue: 'violet and cyan',
    tone: 'vivid',
    colors: ['#AE4FC3', '#824DFF', '#1CC5EE', '#4F43FF'],
  },
  {
    id: 'atmospheric',
    label: 'Atmospheric',
    tier: 'secondary',
    source: 'atmospheric-palette-reference.png',
    hue: 'blue grey',
    tone: 'soft',
    colors: ['#D6E7EE', '#7CA0B8', '#526069', '#1C2A33'],
  },
  {
    id: 'neutral-flex',
    label: 'Neutral Flex',
    tier: 'secondary',
    source: 'neutral-palette-reference.png',
    hue: 'neutral',
    tone: 'light to dark',
    colors: ['#FFFFFF', '#DAE3EA', '#8D9DAC', '#526069', '#1C2B32', '#000000'],
  },
  {
    id: 'extended-approved',
    label: 'More approved colors',
    tier: 'extended',
    source: 'extended-palette-reference.png',
    hue: 'full approved spectrum',
    tone: '24-step ramps',
    colors: EXTENDED_APPROVED_COLORS,
  },
]

export type ColorMix = {
  color: string
  ratio: number
  enabled: boolean
}

export function normalizeColorRatios(values: readonly number[], enabled: readonly boolean[]): number[] {
  const out = values.map((v, i) => (enabled[i] ? Math.max(0, v) : 0))
  const sum = out.reduce((acc, v) => acc + v, 0)
  if (sum <= 0) {
    const first = out.findIndex((v, i) => enabled[i] && i >= 0)
    if (first >= 0) out[first] = 1
    return out.map((v) => (v > 0 ? 100 : 0))
  }
  const normalized = out.map((v) => (v / sum) * 100)
  const last = normalized.findLastIndex((v) => v > 0)
  if (last >= 0) {
    normalized[last] = 100 - normalized.reduce((acc, v, i) => (i === last ? acc : acc + v), 0)
  }
  return normalized
}

export function addColorToMix(mix: readonly ColorMix[], color: string): ColorMix[] {
  const existingIndex = mix.findIndex(
    (item) => item.color.toUpperCase() === color.toUpperCase(),
  )
  if (existingIndex >= 0 && mix[existingIndex].enabled) return [...mix]

  const next = mix.map((item) => ({ ...item }))
  const previousWeight = existingIndex >= 0 ? next[existingIndex].ratio : 0
  const added = {
    color,
    enabled: true,
    ratio: previousWeight > 0 ? previousWeight : 50,
  }
  if (existingIndex >= 0) next[existingIndex] = added
  else next.push(added)
  return next
}

export function buildWeightedPalette(mix: readonly ColorMix[], slots = 10): string[] {
  const active = mix.filter((m) => m.enabled && m.ratio > 0)
  if (!active.length) return [META_BLUE]
  const total = active.reduce((acc, m) => acc + m.ratio, 0)
  const target = Math.max(1, Math.round(slots))
  const allocations = active.map((m, index) => {
    const exact = (m.ratio / total) * target
    return { color: m.color, count: Math.floor(exact), remainder: exact % 1, index }
  })
  const remaining = target - allocations.reduce((acc, item) => acc + item.count, 0)
  const byRemainder = [...allocations].sort(
    (a, b) => b.remainder - a.remainder || a.index - b.index,
  )
  for (let i = 0; i < remaining; i++) byRemainder[i % byRemainder.length].count += 1
  const result: string[] = []
  allocations.forEach((item) => {
    for (let i = 0; i < item.count; i++) result.push(item.color)
  })
  return result
}
