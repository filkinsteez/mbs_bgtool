import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  getMetaSymbolContours,
  META_SYMBOL_ASPECT_RATIO,
  META_SYMBOL_HEIGHT,
  META_SYMBOL_MIN_X,
  META_SYMBOL_MIN_Y,
  META_SYMBOL_PATH,
  META_SYMBOL_PATH_SHA256,
  META_SYMBOL_SOURCE_FILE,
  META_SYMBOL_SOURCE_URL,
  META_SYMBOL_VIEW_BOX,
  META_SYMBOL_WIDTH,
  metaSymbolContains,
  metaSymbolDistance,
} from './metaSymbol'

describe('canonical Meta symbol', () => {
  it('pins the exact path from Meta’s official company-brand archive', () => {
    const officialPathSha256 =
      'aefbd77408112a50ea8d92a123f629da0c988af3e19262cbc0d4ba2a44324f93'
    expect(META_SYMBOL_SOURCE_URL).toBe(
      'https://www.meta.com/brand/resources/meta/company-brand/',
    )
    expect(META_SYMBOL_SOURCE_FILE).toBe(
      'Meta_Company Lockup/3 Mono Black/RGB/Meta_lockup_mono_black_RGB.svg',
    )
    expect(META_SYMBOL_PATH_SHA256).toBe(officialPathSha256)
    expect(createHash('sha256').update(META_SYMBOL_PATH).digest('hex'))
      .toBe(officialPathSha256)
  })

  it('keeps the public asset byte-aligned with the canonical path and bounds', () => {
    const svg = readFileSync(resolve(process.cwd(), 'public/icon-fill.svg'), 'utf8')
    expect(svg.match(/<path d="([^"]+)"/)?.[1]).toBe(META_SYMBOL_PATH)
    expect(svg.match(/viewBox="([^"]+)"/)?.[1]).toBe(META_SYMBOL_VIEW_BOX)
    expect(Number(svg.match(/<svg width="([^"]+)"/)?.[1])).toBe(META_SYMBOL_WIDTH)
    expect(Number(svg.match(/height="([^"]+)"/)?.[1])).toBe(META_SYMBOL_HEIGHT)
  })

  it('uses the official natural bounds and aspect ratio', () => {
    expect(META_SYMBOL_MIN_X).toBe(1000)
    expect(META_SYMBOL_MIN_Y).toBe(1000)
    expect(META_SYMBOL_WIDTH).toBe(1504.8272)
    expect(META_SYMBOL_HEIGHT).toBe(1000)
    expect(META_SYMBOL_ASPECT_RATIO).toBe(1.5048272)
    expect(1 - (20 / 14) / META_SYMBOL_ASPECT_RATIO).toBeCloseTo(0.05067, 4)

    const points = getMetaSymbolContours().flat()
    expect(Math.min(...points.map((point) => point.x))).toBeCloseTo(0, 8)
    expect(Math.max(...points.map((point) => point.x))).toBeCloseTo(META_SYMBOL_WIDTH, 8)
    expect(Math.min(...points.map((point) => point.y))).toBeCloseTo(0, 8)
    expect(Math.max(...points.map((point) => point.y))).toBeCloseTo(META_SYMBOL_HEIGHT, 8)
  })

  it('preserves the filled lobes, center bridge, and negative-space holes', () => {
    expect(metaSymbolContains(75, 650)).toBe(true)
    expect(metaSymbolContains(1430, 650)).toBe(true)
    expect(metaSymbolContains(752, 470)).toBe(true)
    expect(metaSymbolContains(376, 500)).toBe(false)
    expect(metaSymbolContains(1129, 500)).toBe(false)
    expect(metaSymbolContains(752, 36)).toBe(false)
    expect(metaSymbolDistance(376, 500)).toBeGreaterThan(35)
  })
})
