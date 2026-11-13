import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { placeTip, TipBubble, tipPath } from './InfoTip'

const icon = { left: 1398, top: 44.75, right: 1416, bottom: 62.75 }
const bubble = (href: string, open = true) => renderToStaticMarkup(createElement(TipBubble, { id: 't', textId: 't-text', text: 'Some text.', href, place: null, open }))

describe('the info tip', () => {
  it('opens just left of the icon, 8 px from it, its bottom 2 px under the icon, on the desktop and on a phone', () => {
    expect(placeTip(icon, 1440)).toEqual({ side: 'beside', style: { top: 64.75, left: 1390 } })
    expect(placeTip({ left: 348, top: 467.75, right: 366, bottom: 485.75 }, 390)).toEqual({ side: 'beside', style: { top: 487.75, left: 340 } })
  })

  it('opens under the icon when the window has no room on its left', () => {
    expect(placeTip({ left: 200, top: 40, right: 218, bottom: 58 }, 250)).toEqual({ side: 'below', style: { top: 66, right: 32 } })
  })

  it('stays open along the way from the icon to the tip', () => {
    expect(tipPath('beside', icon, { left: 1224, top: 33.75, right: 1390, bottom: 64.75 })).toEqual({ left: 1390, top: 40.75, right: 1416, bottom: 66.75 })
    expect(tipPath('below', icon, { left: 1184, top: 70.75, right: 1416, bottom: 180 })).toEqual({ left: 1394, top: 44.75, right: 1420, bottom: 70.75 })
  })

  it('makes its text a link only with a documentation URL, and opens it in a new tab', () => {
    expect(bubble('')).not.toContain('<a')
    expect(bubble('')).toContain('<p id="t-text">Some text.</p>')
    expect(bubble('https://example.com/colors')).toContain('<a class="tool-info-link" href="https://example.com/colors" target="_blank" rel="noreferrer">Some text.</a>')
    expect(bubble('')).toContain('role="tooltip"')
    expect(bubble('', false)).toContain('hidden=""')
  })
})
