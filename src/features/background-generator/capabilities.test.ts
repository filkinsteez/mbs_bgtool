import { describe, expect, it } from 'vitest'
import { inspect8kCapability } from './capabilities'

describe('8K capability gate', () => {
  it('rejects devices below the requested texture size', () => {
    expect(inspect8kCapability('16:9', 'clean', 4096).supported).toBe(false)
  })

  it('allows tile-safe low-pass materials on capable devices', () => {
    expect(inspect8kCapability('16:9', 'clean', 8192).supported).toBe(true)
  })

  it('rejects memory-heavy square multipass materials', () => {
    expect(inspect8kCapability('1:1', 'glass', 16384).supported).toBe(false)
  })
})
