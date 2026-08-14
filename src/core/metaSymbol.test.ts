import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  META_SYMBOL_PATH,
  metaSymbolContains,
  metaSymbolDistance,
} from './metaSymbol'

describe('canonical Meta symbol', () => {
  it('uses the exact path shipped in public/icon-fill.svg', () => {
    const svg = readFileSync(resolve(process.cwd(), 'public/icon-fill.svg'), 'utf8')
    expect(svg.match(/<path d="([^"]+)"/)?.[1]).toBe(META_SYMBOL_PATH)
  })

  it('preserves the filled lobes, center bridge, and negative-space holes', () => {
    expect(metaSymbolContains(1, 9)).toBe(true)
    expect(metaSymbolContains(19, 9)).toBe(true)
    expect(metaSymbolContains(10, 6)).toBe(true)
    expect(metaSymbolContains(5, 7)).toBe(false)
    expect(metaSymbolContains(15, 7)).toBe(false)
    expect(metaSymbolContains(10, 0.5)).toBe(false)
    expect(metaSymbolDistance(5, 7)).toBeGreaterThan(0.5)
  })
})
