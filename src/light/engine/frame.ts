export const EXPORT_SIZES = {
  '16:9': { width: 3840, height: 2160 },
  '9:16': { width: 2160, height: 3840 },
  '1:1': { width: 3840, height: 3840 },
  '4:5': { width: 3072, height: 3840 },
} as const

export type ExportAspect = keyof typeof EXPORT_SIZES

export const EXPORT_ASPECTS = Object.keys(EXPORT_SIZES) as ExportAspect[]

/** A frame within this share of a format's aspect counts as that format. The formats are at least 22 % apart. */
const FORMAT_SNAP = 0.02

/**
 * The frame aspect recipes see: width / height. A frame within 2 % of an
 * export format's aspect gets the format's exact value (the number the tool
 * passes to compose), so a preview sized to the format in whole pixels and
 * the export of that format see the same aspect. Other frames get their own.
 */
export function frameAspect(width: number, height: number): number {
  const ratio = width / height
  for (const size of Object.values(EXPORT_SIZES)) {
    const format = size.width / size.height
    if (Math.abs(ratio / format - 1) <= FORMAT_SNAP) return format
  }
  return ratio
}
