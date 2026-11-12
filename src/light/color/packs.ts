import { linearToOklab } from './oklab'
import { hexToLinear } from './srgb'

export type PackId = 'primary' | 'bold' | 'elemental' | 'atmospheric'

export interface PackColor {
  name: string
  hex: string
}

export interface ColorPack {
  id: PackId
  name: string
  tagline: string
  /** In pack order; Meta Blue leads. */
  colors: readonly PackColor[]
}

export const PACKS: readonly ColorPack[] = [
  {
    id: 'primary',
    name: 'Primary',
    tagline: 'The default for anything evergreen',
    colors: [
      { name: 'Meta Blue', hex: '#0064E0' },
      { name: 'White', hex: '#FFFFFF' },
      { name: 'Near-black', hex: '#1C2B33' },
    ],
  },
  {
    id: 'bold',
    name: 'Bold',
    tagline: 'Blue amplified',
    colors: [
      { name: 'Meta Blue', hex: '#0064E0' },
      { name: 'Cyan', hex: '#1FCDF0' },
      { name: 'Yellow', hex: '#FFD61E' },
      { name: 'Orange-red', hex: '#FF4F00' },
    ],
  },
  {
    id: 'elemental',
    name: 'Elemental',
    tagline: 'Blue contextualized',
    colors: [
      { name: 'Meta Blue', hex: '#0064E0' },
      { name: 'Lime', hex: '#D6F26C' },
      { name: 'Forest', hex: '#0F3D33' },
      { name: 'Tan', hex: '#B8996E' },
      { name: 'Plum', hex: '#4A0A3C' },
    ],
  },
  {
    id: 'atmospheric',
    name: 'Atmospheric',
    tagline: 'Blue distilled',
    colors: [
      { name: 'Meta Blue', hex: '#0064E0' },
      { name: 'Ice', hex: '#F2F4F7' },
      { name: 'Steel', hex: '#6A7788' },
      { name: 'Slate', hex: '#384753' },
      { name: 'Near-black', hex: '#1C2B33' },
    ],
  },
]

/**
 * Each pack's colors in hue order, by name, so colors that are neighbours on the color wheel sit next to each other
 * (owner, 2026-11-11, concept file node 193:160): the order of the color rows in the panel and of a link's mix=. The
 * pack's own color list keeps its order, which the looks index.
 */
export const HUE_ORDER: Readonly<Record<PackId, readonly string[]>> = {
  primary: ['White', 'Meta Blue', 'Near-black'],
  bold: ['Meta Blue', 'Cyan', 'Yellow', 'Orange-red'],
  elemental: ['Tan', 'Lime', 'Forest', 'Meta Blue', 'Plum'],
  atmospheric: ['Meta Blue', 'Ice', 'Steel', 'Slate', 'Near-black'],
}

/** The places of the pack's colors in its color list, in hue order (HUE_ORDER). */
export function hueOrder(pack: ColorPack): number[] {
  return HUE_ORDER[pack.id].map((name) => pack.colors.findIndex((color) => color.name === name))
}

export const PACK_IDS: readonly PackId[] = PACKS.map((pack) => pack.id)

export function getPack(id: PackId): ColorPack {
  const pack = PACKS.find((candidate) => candidate.id === id)
  if (!pack) throw new Error(`Unknown pack: ${id}`)
  return pack
}

export function isPackId(value: string): value is PackId {
  return PACK_IDS.includes(value as PackId)
}

/** The pack's hexes in pack order. */
export function packHexes(id: PackId): string[] {
  return getPack(id).colors.map((color) => color.hex)
}

/** The pack's hexes from darkest to lightest (Oklab L). */
export function packHexesByLightness(pack: ColorPack): string[] {
  return pack.colors
    .map((color) => ({ hex: color.hex, L: linearToOklab(hexToLinear(color.hex))[0] }))
    .sort((a, b) => a.L - b.L)
    .map((entry) => entry.hex)
}
