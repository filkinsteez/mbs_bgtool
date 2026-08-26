import { describe, expect, it } from 'vitest'
import { createDefaultLab } from './recipe'
import { DEFAULT_SCOPES, shuffleLab } from './shuffle'
import { createFieldSource } from './territory'
import { TREATMENTS } from './types'

const ALL = { seed: true, fields: true, bands: true, marks: true, colors: true }
const NONE = { seed: false, fields: false, bands: false, marks: false, colors: false }

function labWithSource() {
  const lab = createDefaultLab(7)
  lab.source = { filename: 'x.png', width: 800, height: 600, fit: 'contain' }
  lab.territory.sources.push({ ...createFieldSource('paint', 'p1'), weight: 0.7 })
  return lab
}

describe('shuffleLab', () => {
  it('is deterministic per shuffle seed', () => {
    const lab = labWithSource()
    expect(JSON.stringify(shuffleLab(lab, 123, ALL))).toBe(JSON.stringify(shuffleLab(lab, 123, ALL)))
    expect(JSON.stringify(shuffleLab(lab, 123, ALL))).not.toBe(
      JSON.stringify(shuffleLab(lab, 124, ALL)),
    )
  })

  it('touches nothing outside its scopes (plus the look-highlight clear)', () => {
    const lab = labWithSource()
    // every shuffle clears the applied-look highlight and nothing else
    expect(shuffleLab(lab, 5, NONE)).toEqual({ look: { id: null } })
    const seedOnly = shuffleLab(lab, 5, { ...NONE, seed: true })
    expect(Object.keys(seedOnly).sort()).toEqual(['look', 'seed'])
    const marksOnly = shuffleLab(lab, 5, { ...NONE, marks: true })
    expect(Object.keys(marksOnly).sort()).toEqual(['look', 'mark'])
  })

  it('never touches the painted mask or the stack structure', () => {
    const lab = labWithSource()
    const patch = shuffleLab(lab, 9, ALL)
    const sources = patch.territory!.sources!
    expect(sources.map((s) => s!.kind)).toEqual(lab.territory.sources.map((s) => s.kind))
    expect(sources.map((s) => s!.id)).toEqual(lab.territory.sources.map((s) => s.id))
    const paint = sources.find((s) => s!.kind === 'paint')!
    expect(paint).toEqual(lab.territory.sources.find((s) => s.kind === 'paint'))
  })

  it('keeps values inside the curated ranges', () => {
    const lab = labWithSource()
    const valid = new Set(TREATMENTS.map((t) => t.id))
    for (let seed = 0; seed < 40; seed++) {
      const p = shuffleLab(lab, seed, ALL)
      for (const s of p.territory!.sources!) {
        expect(s!.weight).toBeGreaterThan(0.15)
        expect(s!.weight).toBeLessThanOrEqual(1)
      }
      const bands = p.territory!.bands!
      expect(bands.length).toBeGreaterThanOrEqual(3)
      expect(bands.length).toBeLessThanOrEqual(4)
      for (const b of bands) expect(valid.has(b!)).toBe(true)
      expect(p.structure!.baseCell).toBeGreaterThanOrEqual(16)
      expect(p.structure!.baseCell).toBeLessThanOrEqual(44)
      expect(p.mark!.occupancy).toBeGreaterThanOrEqual(0.55)
      expect(p.colors!.ink).toMatch(/^#[0-9a-f]{6}$/i)
      expect(p.colors!.paper).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('photo and mosaic bands only appear when a source exists', () => {
    const bare = createDefaultLab(7) // source: null
    for (let seed = 0; seed < 40; seed++) {
      const p = shuffleLab(bare, seed, { ...NONE, bands: true })
      for (const b of p.territory!.bands!) {
        expect(b).not.toBe('photo')
        expect(b).not.toBe('mosaic')
      }
    }
  })

  it('flow only engages when an enabled curve source exists', () => {
    const lab = labWithSource()
    lab.territory.sources = lab.territory.sources.filter((s) => s.kind !== 'curve')
    for (let seed = 0; seed < 10; seed++) {
      expect(shuffleLab(lab, seed, { ...NONE, marks: true }).mark!.flow).toBe(0)
    }
  })

  it('default scopes leave colors alone', () => {
    const p = shuffleLab(labWithSource(), 3, DEFAULT_SCOPES)
    expect(p.colors).toBeUndefined()
  })
})
