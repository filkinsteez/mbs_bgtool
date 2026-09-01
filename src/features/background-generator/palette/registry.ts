import { META_BLUE } from '@/core/color/brand'
import { sortColorsLightToDark } from './hue'

export type PaletteTier = 'primary' | 'secondary' | 'extended'

export type PalettePack = {
  id: string
  label: string
  tier: PaletteTier
  source: string
  hue: string
  tone: string
  colors: readonly string[]
  defaultMix: readonly number[]
}

export { META_BLUE }
export const CUSTOM_PALETTE_ID = 'custom'

// Eleven swatches shipped one digit off the official brand cards before
// 2026-08-29. Saved recipes and preset files carry those bytes forever, so
// loading heals them to the corrected values.
export const LEGACY_HEX_MIGRATION: Readonly<Record<string, string>> = {
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

export function migrateLegacyHex(color: string): string {
  return LEGACY_HEX_MIGRATION[color.trim().toUpperCase()] ?? color
}

export const APPROVED_COLOR_GROUPS = [
  {
    id: 'blue',
    label: 'Blues',
    colors: sortColorsLightToDark([
      META_BLUE, '#56A8FE', '#0288F9', '#006CE1', '#034AE0', '#093AC7', '#132682', '#060F2C',
    ]),
  },
  {
    id: 'cyan',
    label: 'Cyans & teals',
    colors: sortColorsLightToDark([
      '#B9E9F3', '#25C8EE', '#1AC5ED', '#25C8F1', '#20C3B8', '#058382', '#043F4D',
    ]),
  },
  {
    id: 'green',
    label: 'Greens',
    colors: sortColorsLightToDark([
      '#C0ECC9', '#86E59F', '#24D366', '#153B21',
    ]),
  },
  {
    id: 'warm',
    label: 'Yellows & oranges',
    colors: sortColorsLightToDark([
      '#FCEBA6', '#FFE7CF', '#FFD61E', '#FF4F00', '#8C4F00',
    ]),
  },
  {
    id: 'red',
    label: 'Reds & pinks',
    colors: sortColorsLightToDark([
      '#FFD8DB', '#FF9CA6', '#FF5766', '#E2193D', '#FD96DB', '#E638B5',
    ]),
  },
  {
    id: 'purple',
    label: 'Purples',
    colors: sortColorsLightToDark([
      '#E7DCFE', '#AF4EC5', '#814DFF', '#5043FF', '#7852FF', '#3D2A83',
    ]),
  },
  {
    id: 'neutral',
    label: 'Neutrals',
    colors: sortColorsLightToDark([
      '#FFFFFF', '#DAE3EA', '#D7E7EE', '#D1D4DB', '#8D9DAC', '#8B9BAA',
      '#7CA0B7', '#53606A', '#506171', '#27353E', '#1C2B32', '#1C2B33', '#000000',
    ]),
  },
] as const

export const CURATED_APPROVED_COLORS = APPROVED_COLOR_GROUPS.flatMap(
  (group) => group.colors,
)

export const PALETTE_PACKS: readonly PalettePack[] = [
  {
    id: 'primary-core',
    label: 'Primary',
    tier: 'primary',
    source: 'primary-palette-reference.png',
    hue: 'blue',
    tone: 'full ramp',
    colors: [META_BLUE, '#0288F9', '#006CE1', '#034AE0', '#093AC7', '#132682'],
    defaultMix: [0, 1, 5],
  },
  {
    id: 'primary-neutrals',
    label: 'Neutrals',
    tier: 'primary',
    source: 'primary-palette-reference.png',
    hue: 'neutral',
    tone: 'light to dark',
    colors: [META_BLUE, '#FFFFFF', '#D1D4DB', '#8B9BAA', '#506171', '#27353E', '#000000'],
    defaultMix: [0, 1, 6],
  },
  {
    id: 'bold',
    label: 'Bold',
    tier: 'secondary',
    source: 'bold-palette-reference.png',
    hue: 'cyan, yellow, orange',
    tone: 'vivid',
    colors: [META_BLUE, '#FFD61E', '#FF4F00', '#25C8EE'],
    defaultMix: [0, 1, 2],
  },
  {
    id: 'harmonious',
    label: 'Harmonious',
    tier: 'secondary',
    source: 'harmonious-palette-reference.png',
    hue: 'violet and cyan',
    tone: 'vivid',
    colors: [META_BLUE, '#1AC5ED', '#AF4EC5', '#814DFF', '#5043FF'],
    defaultMix: [0, 1, 3],
  },
  {
    id: 'atmospheric',
    label: 'Atmospheric',
    tier: 'secondary',
    source: 'atmospheric-palette-reference.png',
    hue: 'blue grey',
    tone: 'soft',
    colors: [META_BLUE, '#D7E7EE', '#7CA0B7', '#53606A', '#1C2B33'],
    defaultMix: [0, 1, 4],
  },
  {
    id: 'neutral-flex',
    label: 'Neutral Flex',
    tier: 'secondary',
    source: 'neutral-palette-reference.png',
    hue: 'neutral',
    tone: 'light to dark',
    colors: [META_BLUE, '#FFFFFF', '#DAE3EA', '#8D9DAC', '#53606A', '#1C2B32', '#000000'],
    defaultMix: [0, 1, 6],
  },
  {
    id: 'extended-approved',
    label: 'Approved colors',
    tier: 'extended',
    source: 'extended-palette-reference.png',
    hue: 'curated spectrum',
    tone: 'light to dark',
    colors: CURATED_APPROVED_COLORS,
    defaultMix: [0, 7, CURATED_APPROVED_COLORS.length - 1],
  },
]

export type ColorMix = {
  color: string
  ratio: number
  enabled: boolean
}

export function colorMixForPack(pack: PalettePack): ColorMix[] {
  // Applying a pack deals EVERY one of its colors (owner directive): the
  // lead color carries 40 and the rest split the remaining 60 evenly. The
  // extended tier is the 49-swatch approved library, not a real pack — it
  // keeps its curated three-color starting deal.
  if (pack.tier === 'extended') {
    return pack.colors.map((color, index) => {
      const position = pack.defaultMix.indexOf(index)
      return {
        color,
        enabled: position >= 0,
        ratio: position === 0 ? 60 : position > 0 ? 20 : 0,
      }
    })
  }
  const rest = pack.colors.length - 1
  if (rest <= 0) {
    return pack.colors.map((color) => ({ color, enabled: true, ratio: 100 }))
  }
  const base = Math.floor(60 / rest)
  let remainder = 60 - base * rest
  return pack.colors.map((color, index) => {
    if (index === 0) return { color, enabled: true, ratio: 40 }
    const extra = remainder > 0 ? 1 : 0
    remainder -= extra
    return { color, enabled: true, ratio: base + extra }
  })
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
