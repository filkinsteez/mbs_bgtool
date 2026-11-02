import { linearToOklab } from './oklab'
import { hexToLinear } from './srgb'

export type PackId = 'bold' | 'elemental' | 'atmospheric'

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
