import { describe, expect, it } from 'vitest'
import { DEVICE_FRAMES, EXPORT_FORMATS, FORMAT_SIZES, frameAspect, isDeviceFormat, type DeviceFormat } from '../frame'
import { MAX_SOURCE_SIDE } from '../output'
import { PIXEL_FILTER, pixelBaseGrid, pixelCells, pixelGrid } from './pixel'

const DENSITIES = Array.from({ length: 101 }, (_, k) => k / 100)
const source = PIXEL_FILTER.source!
/** Previews are fitted in whole pixels, so their own ratio is off by up to a pixel; the tool gives the format's aspect. */
const PREVIEW_SCALES = [0.13, 0.25, 0.4, 1 / 3]

describe('pixel filter at the device formats', () => {
  it('fits every format at every density within the frame source limit, cells square within the rounding to whole cells', () => {
    for (const format of EXPORT_FORMATS) {
      const { width, height } = FORMAT_SIZES[format]
      const frame = { width, height, seed: 1 }
      for (const d of DENSITIES) {
        for (const output of [{}, { pixelEven: 1 }]) {
          const size = source.size(frame, d, output)
          expect(Math.max(size.width, size.height), `${format} at ${d} ${JSON.stringify(output)}`).toBeLessThanOrEqual(MAX_SOURCE_SIDE)
        }
        const { across, down } = pixelGrid(frame, d)
        expect(Math.min(across, down), `${format} at ${d}`).toBe(pixelCells(d))
        expect(Math.abs(width / across / (height / down) - 1), `${format} at ${d}`).toBeLessThan(0.045)
      }
    }
  })

  it("gives a preview with its format's aspect the export's cells and source", () => {
    for (const format of EXPORT_FORMATS.filter(isDeviceFormat)) {
      const { width, height } = FORMAT_SIZES[format]
      const exported = { width, height, seed: 1 }
      for (const scale of PREVIEW_SCALES) {
        for (const nudge of [-1, 0, 1]) {
          const preview = { width: Math.round(width * scale) + nudge, height: Math.round(height * scale), seed: 1, aspect: width / height }
          for (const d of [0, 0.37, 0.74, 1]) {
            expect(pixelBaseGrid(preview, d), `${format} ${preview.width}x${preview.height} at ${d}`).toEqual(pixelBaseGrid(exported, d))
            expect(source.size(preview, d), `${format} ${preview.width}x${preview.height} at ${d}`).toEqual(source.size(exported, d))
          }
        }
      }
    }
  })

  it('needs the aspect for close phones: without it a whole-pixel preview of iPhone 16 can get other cells than its export', () => {
    const phone: DeviceFormat = 'iphone-16'
    const exported = FORMAT_SIZES[phone]
    const preview = { width: 153, height: 332 }
    expect(frameAspect(preview.width, preview.height)).not.toBe(exported.width / exported.height)
    expect(pixelBaseGrid(preview, 1)).not.toEqual(pixelBaseGrid(exported, 1))
    expect(pixelBaseGrid({ ...preview, aspect: exported.width / exported.height }, 1)).toEqual(pixelBaseGrid(exported, 1))
    expect(DEVICE_FRAMES[phone].points).toEqual([393, 852])
  })
})
