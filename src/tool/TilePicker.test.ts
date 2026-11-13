import { existsSync } from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FilterPicker, FormatPicker, PackPicker } from './panelPickers'
import { moodPicture } from './panelPictures'
import { MOOD_IDS } from './state'
import { optionForKey } from './TilePicker'

describe('panel tiles', () => {
  it('move with the arrow keys, wrap at both ends, and jump with Home and End', () => {
    expect(optionForKey('ArrowRight', 0, 4)).toBe(1)
    expect(optionForKey('ArrowDown', 3, 4)).toBe(0)
    expect(optionForKey('ArrowLeft', 0, 4)).toBe(3)
    expect(optionForKey('ArrowUp', 1, 4)).toBe(0)
    expect(optionForKey('Home', 3, 4)).toBe(0)
    expect(optionForKey('End', 0, 4)).toBe(3)
    expect(optionForKey('Enter', 1, 4)).toBeNull()
  })

  it('in two rows of two, move between rows with Up and Down in the same column, wrapping, and in order with Left and Right', () => {
    expect([0, 1, 2, 3].map((i) => optionForKey('ArrowDown', i, 4, 2))).toEqual([2, 3, 0, 1])
    expect([0, 1, 2, 3].map((i) => optionForKey('ArrowUp', i, 4, 2))).toEqual([2, 3, 0, 1])
    expect([0, 1, 2, 3].map((i) => optionForKey('ArrowRight', i, 4, 2))).toEqual([1, 2, 3, 0])
    expect([0, 1, 2, 3].map((i) => optionForKey('ArrowLeft', i, 4, 2))).toEqual([3, 0, 1, 2])
    expect([optionForKey('Home', 3, 4, 2), optionForKey('End', 0, 4, 2)]).toEqual([0, 3])
    expect([0, 2, 4].map((i) => optionForKey('ArrowUp', i, 5, 2))).toEqual([4, 0, 2])
  })

  it('lay the four pack strips out two to a row', () => {
    expect(renderToStaticMarkup(createElement(PackPicker, { value: 'bold', onChange: () => {} }))).toContain('style="--tile-columns:2"')
  })

  it('show the filters and the formats as buttons that share the row, each name inside its button', () => {
    const pickers = [
      { html: renderToStaticMarkup(createElement(FilterPicker, { value: 'grain', onChange: () => {} })), names: ['None', 'Grain', 'Pixel'] },
      { html: renderToStaticMarkup(createElement(FormatPicker, { value: '16:9', onChange: () => {} })), names: ['16:9', '9:16', '1:1', '4:5'] },
    ]
    for (const { html, names } of pickers) {
      expect(html).toContain('data-kind="icon"')
      const buttons = [...html.matchAll(/<button[^>]*aria-label="([^"]+)"[^>]*>(.*?)<\/button>/g)]
      expect(buttons.map(([, name]) => name)).toEqual(names)
      for (const [, name, inner] of buttons) expect(inner, name).toMatch(new RegExp(`^<span class="tool-tile-face">.*<span class="tool-tile-label">${name}</span></span></span>$`))
    }
  })

  it('give the Colors card an info icon at the end of its title row, a button named About colors and described by its tip', () => {
    const html = renderToStaticMarkup(createElement(PackPicker, { value: 'bold', onChange: () => {} }))
    expect(html).toMatch(/<div class="tool-tiles-head"><span class="dialkit-select-label" aria-hidden="true">Colors<\/span><button type="button" class="tool-info" aria-label="About colors" aria-describedby="[^"]+-text">/)
    expect(renderToStaticMarkup(createElement(FilterPicker, { value: 'none', onChange: () => {} }))).not.toContain('tool-info')
  })

  it('show the four packs with Primary first, its strip from White through Meta Blue to Near-black', () => {
    const html = renderToStaticMarkup(createElement(PackPicker, { value: 'bold', onChange: () => {} }))
    expect([...html.matchAll(/aria-label="([^"]+)" tabindex/g)].map(([, name]) => name)).toEqual(['Primary', 'Bold', 'Elemental', 'Atmospheric'])
    expect(html).toContain('<span style="background:#FFFFFF"></span><span style="background:#0064E0"></span><span style="background:#1C2B33"></span>')
  })

  it('have a picture for every mood', () => {
    const pictures = MOOD_IDS.map((mood) => moodPicture(mood))
    expect(pictures).toEqual(['/panel/sunset-merged.webp', '/panel/contour-merged.webp', '/panel/rush-split.webp'])
    expect(pictures.filter((src) => !existsSync(path.join(process.cwd(), 'public', src)))).toEqual([])
  })
})
