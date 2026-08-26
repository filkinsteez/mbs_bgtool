export type HueGroupId =
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'cyan'
  | 'blue'
  | 'purple'
  | 'magenta'
  | 'neutral'

export type HueGroup = {
  id: HueGroupId
  label: string
  colors: string[]
}

const BLUE_HUE = 225

// Representative hues are the centers of the hueGroupFor ranges below.
const CHROMATIC_GROUPS = [
  { id: 'red', label: 'Reds', hue: 0 },
  { id: 'orange', label: 'Oranges', hue: 30 },
  { id: 'yellow', label: 'Yellows', hue: 57.5 },
  { id: 'green', label: 'Greens', hue: 117.5 },
  { id: 'cyan', label: 'Cyans', hue: 180 },
  { id: 'blue', label: 'Blues', hue: BLUE_HUE },
  { id: 'purple', label: 'Purples', hue: 272.5 },
  { id: 'magenta', label: 'Magentas', hue: 317.5 },
] as const satisfies readonly { id: Exclude<HueGroupId, 'neutral'>; label: string; hue: number }[]

function circularHueDistance(first: number, second: number): number {
  const difference = Math.abs(first - second) % 360
  return Math.min(difference, 360 - difference)
}

function compareColorMetric(first: number, second: number): number {
  // Collapse floating-point noise so equivalent 8-bit colors reach the tie-breakers.
  return Math.round(first * 1_000_000) - Math.round(second * 1_000_000)
}

export function perceptualLightness(hex: string): number {
  const value = hex.replace('#', '')
  const linearize = (channel: string) => {
    const srgb = Number.parseInt(channel, 16) / 255
    return srgb <= 0.04045
      ? srgb / 12.92
      : ((srgb + 0.055) / 1.055) ** 2.4
  }
  const red = linearize(value.slice(0, 2))
  const green = linearize(value.slice(2, 4))
  const blue = linearize(value.slice(4, 6))
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue)
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue)
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue)
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
}

export function sortColorsLightToDark(colors: readonly string[]): string[] {
  return colors
    .map((color, sourceIndex) => ({
      color,
      sourceIndex,
      lightness: perceptualLightness(color),
    }))
    .sort((first, second) =>
      compareColorMetric(second.lightness, first.lightness)
      || first.sourceIndex - second.sourceIndex)
    .map(({ color }) => color)
}

const GROUPS: readonly { id: HueGroupId; label: string }[] = [
  ...[...CHROMATIC_GROUPS]
    .sort((a, b) =>
      circularHueDistance(a.hue, BLUE_HUE) - circularHueDistance(b.hue, BLUE_HUE) ||
      // Prefer the lower hue when two groups are equally close to blue.
      a.hue - b.hue
    ),
  { id: 'neutral', label: 'Neutrals' },
]

export function groupColorsByHue(colors: readonly string[]): HueGroup[] {
  const groups = new Map<HueGroupId, {
    color: string
    hue: number
    saturation: number
    chroma: number
    lightness: number
    sourceIndex: number
  }[]>()
  colors.forEach((color, sourceIndex) => {
    const hsl = hexToHsl(color)
    const id = hueGroupFor(hsl.hue, hsl.saturation, hsl.chroma)
    const values = groups.get(id) ?? []
    values.push({ color, sourceIndex, ...hsl })
    groups.set(id, values)
  })

  return GROUPS.flatMap(({ id, label }) => {
    const values = groups.get(id)
    if (!values?.length) return []
    values.sort((a, b) =>
      id === 'neutral'
        ? compareColorMetric(b.lightness, a.lightness) || a.sourceIndex - b.sourceIndex
        : compareColorMetric(b.chroma, a.chroma) ||
          compareColorMetric(b.saturation, a.saturation) ||
          compareColorMetric(b.lightness, a.lightness) ||
          compareColorMetric(a.hue, b.hue) ||
          a.sourceIndex - b.sourceIndex
    )
    return [{ id, label, colors: values.map((value) => value.color) }]
  })
}

function hueGroupFor(hue: number, saturation: number, chroma: number): HueGroupId {
  // HSL calls near-white pastels "100% saturated", which is useless for a
  // visual picker. Brightness-weighted RGB chroma plus HSV saturation keeps
  // tinted greys and almost-white colors in Neutrals while true colors stay chromatic.
  if (chroma < 0.13 || saturation < 0.2) return 'neutral'
  if (hue < 15 || hue >= 345) return 'red'
  if (hue < 45) return 'orange'
  if (hue < 70) return 'yellow'
  if (hue < 165) return 'green'
  if (hue < 195) return 'cyan'
  if (hue < 255) return 'blue'
  if (hue < 290) return 'purple'
  if (hue < 345) return 'magenta'
  return 'red'
}

function hexToHsl(
  hex: string,
): { hue: number; saturation: number; chroma: number; lightness: number } {
  const value = hex.replace('#', '')
  const red = Number.parseInt(value.slice(0, 2), 16) / 255
  const green = Number.parseInt(value.slice(2, 4), 16) / 255
  const blue = Number.parseInt(value.slice(4, 6), 16) / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const delta = max - min
  const lightness = (max + min) / 2
  if (delta === 0) return { hue: 0, saturation: 0, chroma: 0, lightness }

  const saturation = max === 0 ? 0 : delta / max
  let hue: number
  if (max === red) hue = 60 * (((green - blue) / delta) % 6)
  else if (max === green) hue = 60 * ((blue - red) / delta + 2)
  else hue = 60 * ((red - green) / delta + 4)
  if (hue < 0) hue += 360
  return { hue, saturation, chroma: delta * max, lightness }
}
