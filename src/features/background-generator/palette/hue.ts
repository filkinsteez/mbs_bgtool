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
    lightness: number
    sourceIndex: number
  }[]>()
  colors.forEach((color, sourceIndex) => {
    const hsl = hexToHsl(color)
    const id = hueGroupFor(hsl.hue, hsl.saturation)
    const values = groups.get(id) ?? []
    values.push({ color, sourceIndex, ...hsl })
    groups.set(id, values)
  })

  return GROUPS.flatMap(({ id, label }) => {
    const values = groups.get(id)
    if (!values?.length) return []
    values.sort((a, b) =>
      compareColorMetric(a.saturation, b.saturation) ||
      compareColorMetric(b.lightness, a.lightness) ||
      compareColorMetric(a.hue, b.hue) ||
      a.sourceIndex - b.sourceIndex
    )
    return [{ id, label, colors: values.map((value) => value.color) }]
  })
}

function hueGroupFor(hue: number, saturation: number): HueGroupId {
  if (saturation < 0.2) return 'neutral'
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

function hexToHsl(hex: string): { hue: number; saturation: number; lightness: number } {
  const value = hex.replace('#', '')
  const red = Number.parseInt(value.slice(0, 2), 16) / 255
  const green = Number.parseInt(value.slice(2, 4), 16) / 255
  const blue = Number.parseInt(value.slice(4, 6), 16) / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const delta = max - min
  const lightness = (max + min) / 2
  if (delta === 0) return { hue: 0, saturation: 0, lightness }

  const saturation = delta / (1 - Math.abs(2 * lightness - 1))
  let hue: number
  if (max === red) hue = 60 * (((green - blue) / delta) % 6)
  else if (max === green) hue = 60 * ((blue - red) / delta + 2)
  else hue = 60 * ((red - green) / delta + 4)
  if (hue < 0) hue += 360
  return { hue, saturation, lightness }
}
