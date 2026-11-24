import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText, LINK_COPIED, LINK_NOT_COPIED, shareLink } from './share'
import { DEFAULT_STATE, parseQuery, toQuery } from './state'

const PAGE = { origin: 'https://backgrounds.example.com', pathname: '/' }

describe('the Share link', () => {
  it("is the page's origin and path, then the query of the state, which opens on that state", () => {
    const query = 'mood=contour&look=merged&pack=elemental&mix=tan:40,meta-blue:40,plum:20&from=0.2,0.8&to=0.7,0.3&seed=12&format=iphone-16&filter=grain&strength=0.4'
    const state = parseQuery(new URLSearchParams(query))
    const link = shareLink(PAGE, toQuery(state))
    expect(link).toBe(`https://backgrounds.example.com/?${query}`)
    expect(parseQuery(new URL(link).searchParams)).toEqual(state)
    expect(shareLink({ origin: 'http://localhost:3000', pathname: '/tool' }, toQuery(DEFAULT_STATE))).toBe(
      'http://localhost:3000/tool?mood=sunset&look=merged&pack=bold&seed=1&format=16x9',
    )
  })

  it('says Link copied, or that it could not copy', () => {
    expect([LINK_COPIED, LINK_NOT_COPIED]).toEqual(['Link copied', "Couldn't copy link"])
  })
})

/** A page with no clipboard API, or one that refuses, and the copy command that copies, refuses or throws. */
function fakePage({ clipboard, copy }: { clipboard: 'none' | 'copies' | 'refuses'; copy: boolean | 'throws' }) {
  const steps: string[] = []
  class FakeElement {
    focus = vi.fn(() => steps.push('focus the button'))
  }
  const button = new FakeElement()
  const field = {
    value: '',
    readOnly: false,
    style: {} as Record<string, string>,
    select: vi.fn(() => steps.push('select')),
    remove: vi.fn(() => steps.push('remove')),
  }
  const writeText = vi.fn(async (text: string) => {
    steps.push(`clipboard ${text}`)
    if (clipboard === 'refuses') throw new DOMException('Write permission denied.', 'NotAllowedError')
  })
  vi.stubGlobal('navigator', clipboard === 'none' ? {} : { clipboard: { writeText } })
  vi.stubGlobal('HTMLElement', FakeElement)
  vi.stubGlobal('document', {
    activeElement: button,
    body: { append: vi.fn(() => steps.push('append')) },
    createElement: vi.fn(() => field),
    execCommand: vi.fn((command: string) => {
      steps.push(`${command} ${field.value}`)
      if (copy === 'throws') throw new Error('copy failed')
      return copy
    }),
  })
  return { steps, field, button }
}

describe('copying the link', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the clipboard API where the page has it', async () => {
    const page = fakePage({ clipboard: 'copies', copy: true })
    expect(await copyText('https://x.test/?a=1')).toBe(true)
    expect(page.steps).toEqual(['clipboard https://x.test/?a=1'])
  })

  it('copies from a hidden text field with the copy command where the clipboard API is missing or refuses, and gives focus back', async () => {
    for (const clipboard of ['none', 'refuses'] as const) {
      const page = fakePage({ clipboard, copy: true })
      expect(await copyText('https://x.test/?a=1'), clipboard).toBe(true)
      expect(page.steps.filter((step) => !step.startsWith('clipboard')), clipboard).toEqual(['append', 'select', 'copy https://x.test/?a=1', 'remove', 'focus the button'])
      expect(page.field.readOnly).toBe(true)
      expect(page.field.style).toMatchObject({ position: 'fixed', opacity: '0', pointerEvents: 'none' })
    }
  })

  it('says it could not copy when the copy command fails too', async () => {
    for (const copy of [false, 'throws'] as const) {
      const page = fakePage({ clipboard: 'refuses', copy })
      expect(await copyText('https://x.test/?a=1'), String(copy)).toBe(false)
      expect(page.steps.slice(-2), String(copy)).toEqual(['remove', 'focus the button'])
    }
  })
})
