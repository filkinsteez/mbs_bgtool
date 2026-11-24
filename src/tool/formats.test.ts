import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { EXPORT_FORMATS, type ExportFormat } from '@/light'
import { buildDialConfig, FORMAT_GROUPS, FORMAT_OPTIONS, formatName, readToolState } from './dialConfig'
import { entryName, entryShape } from './history/HistoryStrip'
import { findOption, FormatPicker, formatShapeStyle, stepOption } from './FormatPicker'
import { DEFAULT_STATE, formatFromQuery, parseQuery, toQuery } from './state'

describe('device formats in the URL', () => {
  it('name a device by its id, and every format round-trips', () => {
    const state = { ...DEFAULT_STATE, format: 'iphone-16' as const }
    const query = toQuery(state)
    expect(query).toBe('mood=sunset&look=merged&pack=bold&seed=1&format=iphone-16')
    expect(parseQuery(new URLSearchParams(query))).toEqual(state)
    for (const format of EXPORT_FORMATS) expect(parseQuery(new URLSearchParams(toQuery({ ...DEFAULT_STATE, format }))), format).toEqual({ ...DEFAULT_STATE, format })
  })

  it('open old links with format=16x9 and the other ratios as before, and the ratio itself too', () => {
    const old: [string, ExportFormat][] = [
      ['16x9', '16:9'],
      ['9x16', '9:16'],
      ['1x1', '1:1'],
      ['4x5', '4:5'],
      ['16:9', '16:9'],
      ['4:5', '4:5'],
    ]
    for (const [value, format] of old) expect(formatFromQuery(value), value).toBe(format)
    expect(toQuery(parseQuery({ mood: 'contour', seed: '3', format: '4x5' }))).toBe('mood=contour&look=merged&pack=bold&seed=3&format=4x5')
  })

  it("open on 16:9 for a format they don't know", () => {
    for (const value of ['', 'iphone', 'iPhone-16', 'iphone-17', '2x1', 'android-e:panded', '16X9']) expect(parseQuery({ format: value }).format, value).toBe('16:9')
    expect(parseQuery({ format: 'android-expanded' }).format).toBe('android-expanded')
  })
})

describe('the Format dropdown', () => {
  it('lists the ratios, then Phone, Tablet and Desktop, each device by its name and Figma size', () => {
    expect(FORMAT_GROUPS.map(({ title, options }) => [title, options.map((option) => option.label)])).toEqual([
      ['Aspect ratio', ['16:9', '9:16', '1:1', '4:5']],
      ['Phone', ['iPhone 16 · 393 × 852', 'iPhone 16 Pro · 402 × 874', 'iPhone 16 Pro Max · 440 × 956', 'Android Compact · 412 × 917', 'Android Medium · 700 × 840']],
      ['Tablet', ['iPad mini 8.3 · 744 × 1133', 'iPad Pro 11" · 834 × 1194', 'iPad Pro 12.9" · 1024 × 1366', 'Surface Pro 8 · 1440 × 960', 'Android Expanded · 1280 × 800']],
      ['Desktop', ['MacBook Air · 1280 × 832', 'MacBook Pro 14" · 1512 × 982', 'MacBook Pro 16" · 1728 × 1117', 'Desktop · 1440 × 1024', 'TV · 1280 × 720']],
    ])
    expect(FORMAT_GROUPS.flatMap(({ options }) => options)).toEqual(FORMAT_OPTIONS)
    expect(FORMAT_OPTIONS.map((option) => option.value)).toEqual(EXPORT_FORMATS)
  })

  it('is a closed button named Format that shows the chosen format\'s icon and name', () => {
    const html = renderToStaticMarkup(createElement(FormatPicker, { value: 'iphone-16-pro', onChange: () => {} }))
    expect(html).toMatch(/<button type="button" class="tool-format-button" data-dial-path="format" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="[^"]+">/)
    expect(html).toContain('>Format</span>')
    expect(html).toMatch(/<span class="dialkit-select-value" id="[^"]+">iPhone 16 Pro<\/span>/)
    expect(html).toContain('<span class="tool-format-shape" style="width:calc(var(--format-shape-box) * 0.459954233409611);height:calc(var(--format-shape-box) * 1)"></span>')
    expect(html).not.toContain('role="listbox"')
    expect(renderToStaticMarkup(createElement(FormatPicker, { value: '4:5', onChange: () => {} }))).toMatch(/>4:5<\/span>/)
  })

  it('draws each icon in its format\'s ratio with the long side filling the box', () => {
    expect(formatShapeStyle('16:9')).toEqual({ width: 'calc(var(--format-shape-box) * 1)', height: 'calc(var(--format-shape-box) * 0.5625)' })
    expect(formatShapeStyle('1:1')).toEqual({ width: 'calc(var(--format-shape-box) * 1)', height: 'calc(var(--format-shape-box) * 1)' })
    expect(formatShapeStyle('4:5')).toEqual({ width: 'calc(var(--format-shape-box) * 0.8)', height: 'calc(var(--format-shape-box) * 1)' })
  })

  it('moves through the list with the arrows, Home and End, stopping at the ends', () => {
    expect(stepOption('ArrowDown', 3, 19)).toBe(4)
    expect(stepOption('ArrowDown', 18, 19)).toBe(18)
    expect(stepOption('ArrowUp', 0, 19)).toBe(0)
    expect(stepOption('Home', 9, 19)).toBe(0)
    expect(stepOption('End', 2, 19)).toBe(18)
    expect(stepOption('a', 2, 19)).toBeNull()
  })

  it('finds an option by its first letters, and steps through the names that start with a letter typed again', () => {
    const labels = FORMAT_OPTIONS.map((option) => option.label)
    const at = (name: string) => labels.findIndex((label) => label.startsWith(name))
    expect(findOption(labels, 'm', 0)).toBe(at('MacBook Air'))
    expect(findOption(labels, 'macbook p', at('MacBook Air'))).toBe(at('MacBook Pro 14'))
    expect(findOption(labels, 'i', at('iPhone 16 ·'))).toBe(at('iPhone 16 Pro ·'))
    expect(findOption(labels, 'ii', at('iPhone 16 Pro ·'))).toBe(at('iPhone 16 Pro Max'))
    expect(findOption(labels, 't', 0)).toBe(at('TV'))
    expect(findOption(labels, '1', at('TV'))).toBe(at('16:9'))
    expect(findOption(labels, 'x', 0)).toBeNull()
  })

  it("keeps a device format as the panel's value, and falls back to 16:9 for anything else", () => {
    expect(readToolState({ format: 'ipad-pro-11' }, 'sunset').format).toBe('ipad-pro-11')
    expect(readToolState({ format: 'ipad' }, 'sunset').format).toBe('16:9')
    expect(buildDialConfig({ ...DEFAULT_STATE, format: 'tv' }, 'Export', 'none').format).toMatchObject({ type: 'select', default: 'tv' })
    expect(formatName('macbook-pro-14')).toBe('MacBook Pro 14"')
    expect(formatName('9:16')).toBe('9:16')
  })
})

describe('device formats in the history', () => {
  it("name an entry's format as the panel does, and give its picture the format's shape", () => {
    const query = 'mood=contour&look=merged&pack=bold&seed=15&format=iphone-16'
    expect(entryName(query)).toBe('Contour, Bold, iPhone 16, seed 15')
    expect(entryShape(query)).toEqual({ aspectRatio: '1179 / 2556' })
    expect(entryName(query.replace('iphone-16', '16x9'))).toBe('Contour, Bold, 16:9, seed 15')
    expect(entryShape(query.replace('iphone-16', '16x9'))).toEqual({ aspectRatio: '3840 / 2160' })
  })
})
