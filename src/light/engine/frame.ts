/** The formats named by their aspect ratio, 4K on the long side. */
export const EXPORT_SIZES = {
  '16:9': { width: 3840, height: 2160 },
  '9:16': { width: 2160, height: 3840 },
  '1:1': { width: 3840, height: 3840 },
  '4:5': { width: 3072, height: 3840 },
} as const

export type ExportAspect = keyof typeof EXPORT_SIZES

export const EXPORT_ASPECTS = Object.keys(EXPORT_SIZES) as ExportAspect[]

/** A device frame from Figma's frame presets. */
export interface DeviceFrame {
  /** Figma's name for it. */
  name: string
  /** Its group in the Format list, as in Figma. */
  group: 'Phone' | 'Tablet' | 'Desktop'
  /** Figma's frame size in points, width by height. */
  points: readonly [number, number]
  /** The screen's pixels per point: the export is the frame at this scale. */
  scale: number
}

/**
 * The device formats, Figma's frame presets by Figma's names and sizes (owner, 2026-11-17: "add in device sizes like
 * iphone, android, ipad, etc etc. reference figma device size presets"). An export has the screen's pixels: phones
 * at 3x the frame, tablets and laptops at 2x, and the TV at 3x, which is 4K (3840 x 2160).
 */
export const DEVICE_FRAMES = {
  'iphone-16': { name: 'iPhone 16', group: 'Phone', points: [393, 852], scale: 3 },
  'iphone-16-pro': { name: 'iPhone 16 Pro', group: 'Phone', points: [402, 874], scale: 3 },
  'iphone-16-pro-max': { name: 'iPhone 16 Pro Max', group: 'Phone', points: [440, 956], scale: 3 },
  'android-compact': { name: 'Android Compact', group: 'Phone', points: [412, 917], scale: 3 },
  'android-medium': { name: 'Android Medium', group: 'Phone', points: [700, 840], scale: 3 },
  'ipad-mini': { name: 'iPad mini 8.3', group: 'Tablet', points: [744, 1133], scale: 2 },
  'ipad-pro-11': { name: 'iPad Pro 11"', group: 'Tablet', points: [834, 1194], scale: 2 },
  'ipad-pro-12-9': { name: 'iPad Pro 12.9"', group: 'Tablet', points: [1024, 1366], scale: 2 },
  'surface-pro-8': { name: 'Surface Pro 8', group: 'Tablet', points: [1440, 960], scale: 2 },
  'android-expanded': { name: 'Android Expanded', group: 'Tablet', points: [1280, 800], scale: 2 },
  'macbook-air': { name: 'MacBook Air', group: 'Desktop', points: [1280, 832], scale: 2 },
  'macbook-pro-14': { name: 'MacBook Pro 14"', group: 'Desktop', points: [1512, 982], scale: 2 },
  'macbook-pro-16': { name: 'MacBook Pro 16"', group: 'Desktop', points: [1728, 1117], scale: 2 },
  desktop: { name: 'Desktop', group: 'Desktop', points: [1440, 1024], scale: 2 },
  tv: { name: 'TV', group: 'Desktop', points: [1280, 720], scale: 3 },
} as const satisfies Record<string, DeviceFrame>

export type DeviceFormat = keyof typeof DEVICE_FRAMES
/** A format the tool exports: an aspect ratio at 4K (`16:9`) or a device (`iphone-16`). */
export type ExportFormat = ExportAspect | DeviceFormat

export interface FrameSize {
  readonly width: number
  readonly height: number
}

const deviceSizes = Object.fromEntries(
  Object.entries<DeviceFrame>(DEVICE_FRAMES).map(([id, { points, scale }]) => [id, { width: points[0] * scale, height: points[1] * scale }]),
) as Record<DeviceFormat, FrameSize>

/** Every format's export size in pixels: the ratios first, then the devices in their Format list order. */
export const FORMAT_SIZES: Readonly<Record<ExportFormat, FrameSize>> = { ...EXPORT_SIZES, ...deviceSizes }

export const EXPORT_FORMATS = Object.keys(FORMAT_SIZES) as ExportFormat[]

export function isDeviceFormat(format: string): format is DeviceFormat {
  return Object.hasOwn(DEVICE_FRAMES, format)
}

/** A frame within this share of a ratio format's aspect counts as that format. Those formats are at least 22 % apart. */
const FORMAT_SNAP = 0.02

/**
 * The frame aspect recipes see: width / height. A frame within 2 % of a ratio
 * format's aspect gets the nearest such format's exact value (the number the
 * tool passes to compose), so a preview sized to the format in whole pixels and
 * the export of that format see the same aspect. Other frames get their own.
 * Device formats are left out: some lie within 0.1 % of each other (iPhone 16
 * Pro and Pro Max), closer than a preview's whole pixels can tell apart, and
 * reference frames lie within 2 % of others. A device's export size has its
 * exact aspect already, and the tool gives the preview its format's aspect
 * (`RenderOptions.aspect`).
 */
export function frameAspect(width: number, height: number): number {
  const ratio = width / height
  let nearest = ratio
  let nearestOff = FORMAT_SNAP
  for (const size of Object.values(EXPORT_SIZES)) {
    const format = size.width / size.height
    const off = Math.abs(ratio / format - 1)
    if (off <= nearestOff) {
      nearest = format
      nearestOff = off
    }
  }
  return nearest
}
