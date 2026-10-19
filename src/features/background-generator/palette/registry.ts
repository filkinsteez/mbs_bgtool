import { META_BLUE } from '@/core/color/brand'

export { META_BLUE }

export type ColorMix = {
  color: string
  ratio: number
  enabled: boolean
}

export type ProductionColorPackId =
  | 'blues'
  | 'primary'
  | 'bold'
  | 'atmospheric'
  | 'elemental'

export type PalettePack = {
  id: ProductionColorPackId
  label: string
  tier: 'primary' | 'secondary'
  colors: readonly string[]
  supportsAccent: boolean
}

export const ELEMENTAL_ACCENTS = [
  '#D5F57A',
  '#174A3A',
  '#B69D74',
  '#410840',
] as const

export const PALETTE_PACKS: readonly PalettePack[] = [
  {
    id: 'blues',
    label: 'Blues',
    tier: 'primary',
    colors: [META_BLUE, '#132682'],
    supportsAccent: false,
  },
  {
    id: 'primary',
    label: 'Primary',
    tier: 'primary',
    colors: [META_BLUE, '#FFFFFF'],
    supportsAccent: false,
  },
  {
    id: 'bold',
    label: 'Bold',
    tier: 'secondary',
    colors: [META_BLUE, '#25C8EE'],
    supportsAccent: false,
  },
  {
    id: 'atmospheric',
    label: 'Atmospheric',
    tier: 'secondary',
    colors: [META_BLUE, '#D7E7EE', '#1C2B33'],
    supportsAccent: false,
  },
  {
    id: 'elemental',
    label: 'Elemental',
    tier: 'secondary',
    colors: [META_BLUE, ELEMENTAL_ACCENTS[0]],
    supportsAccent: true,
  },
]

export const PRODUCTION_COLOR_PACKS = PALETTE_PACKS

const LEGACY_HEX_MIGRATION: Readonly<Record<string, string>> = {
  '#26C8EE': '#25C8EE',
  '#FED61F': '#FFD61E',
  '#FF5001': '#FF4F00',
  '#1CC5EE': '#1AC5ED',
  '#AE4FC3': '#AF4EC5',
  '#824DFF': '#814DFF',
  '#4F43FF': '#5043FF',
  '#D6E7EE': '#D7E7EE',
  '#7CA0B8': '#7CA0B7',
  '#526069': '#53606A',
  '#1C2A33': '#1C2B33',
}

const APPROVED_COLOR_NAMES: Readonly<Record<string, string>> = {
  [META_BLUE]: 'Meta blue',
  '#132682': 'Deep blue',
  '#FFFFFF': 'White',
  '#25C8EE': 'Cyan',
  '#D7E7EE': 'Pale blue',
  '#1C2B33': 'Ink',
  '#D5F57A': 'Lime',
  '#174A3A': 'Forest',
  '#B69D74': 'Sand',
  '#410840': 'Plum',
}

export function migrateLegacyHex(color: string): string {
  return LEGACY_HEX_MIGRATION[color.trim().toUpperCase()] ?? color
}

export function approvedColorName(color: string): string {
  const normalized = migrateLegacyHex(color.trim().toUpperCase())
  return APPROVED_COLOR_NAMES[normalized] ?? normalized
}

export function colorMixForPack(
  pack: PalettePack,
  metaBlueShare = 70,
): ColorMix[] {
  const blueShare = Math.max(50, Math.min(95, Math.round(metaBlueShare)))
  const remainder = 100 - blueShare
  const tailCount = Math.max(1, pack.colors.length - 1)
  const baseTail = Math.floor(remainder / tailCount)
  let extra = remainder - baseTail * tailCount
  return pack.colors.map((color, index) => {
    if (index === 0) return { color, enabled: true, ratio: blueShare }
    const ratio = baseTail + (extra > 0 ? 1 : 0)
    extra -= 1
    return { color, enabled: ratio > 0, ratio }
  })
}

export function buildWeightedPalette(
  mix: readonly ColorMix[],
  slots = 10,
): string[] {
  const active = mix.filter((item) => item.enabled && item.ratio > 0)
  if (!active.length) return [META_BLUE]
  const total = active.reduce((sum, item) => sum + item.ratio, 0)
  const target = Math.max(1, Math.round(slots))
  const allocations = active.map((item, index) => {
    const exact = item.ratio / total * target
    return {
      color: item.color,
      count: Math.floor(exact),
      remainder: exact % 1,
      index,
    }
  })
  const remaining = target
    - allocations.reduce((sum, item) => sum + item.count, 0)
  const ranked = [...allocations].sort(
    (a, b) => b.remainder - a.remainder || a.index - b.index,
  )
  for (let index = 0; index < remaining; index += 1) {
    ranked[index % ranked.length].count += 1
  }
  return allocations.flatMap((item) =>
    Array.from({ length: item.count }, () => item.color))
}
