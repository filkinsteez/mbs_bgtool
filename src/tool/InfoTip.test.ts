import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { placeTip, TipBubble, tipPath } from './InfoTip'

const icon = { left: 1398, top: 44.75, right: 1416, bottom: 62.75 }
const bubble = (href: string, open = true) => renderToStaticMarkup(createElement(TipBubble, { id: 't', textId: 't-text', text: 'Some text.', href, place: null, open }))

describe('the info tip', () => {
  it('opens beside the panel, over the picture, level with the icon, when the panel is at the right', () => {
    expect(placeTip(icon, { left: 1140, top: 0, right: 1440, bottom: 900 }, 1440)).toEqual({ side: 'left', style: { top: 36.75, left: 1132 } })
  })

  it('opens above the panel when the panel spans the window, and under the icon when there is no room above', () => {
    const panel = { left: 0, top: 450, right: 700, bottom: 900 }
    const low = { left: 668, top: 494, right: 686, bottom: 512 }
    expect(placeTip(low, panel, 700)).toEqual({ side: 'above', style: { top: 442, right: 14 } })
    expect(placeTip(low, { ...panel, top: 60 }, 700)).toEqual({ side: 'below', style: { top: 520, right: 14 } })
  })

  it('stays open along the way from the icon to the tip', () => {
    expect(tipPath('left', icon, { left: 900, top: 36.75, right: 1132, bottom: 143.75 })).toEqual({ left: 1132, top: 40.75, right: 1416, bottom: 66.75 })
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
