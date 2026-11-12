import { existsSync } from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FilterPicker, FormatPicker } from './panelPickers'
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

  it('have a picture for every mood', () => {
    const pictures = MOOD_IDS.map((mood) => moodPicture(mood))
    expect(pictures).toEqual(['/panel/sunset-merged.webp', '/panel/contour-merged.webp', '/panel/rush-split.webp'])
    expect(pictures.filter((src) => !existsSync(path.join(process.cwd(), 'public', src)))).toEqual([])
  })
})
