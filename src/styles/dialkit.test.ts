import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

describe('vendored DialKit styles', () => {
  const source = read('../../node_modules/dialkit/dist/styles.css').split('\n')
  const vendored = read('./dialkit.css')
  const body = vendored.slice(vendored.indexOf('*/\n') + 3)

  it('match DialKit styles.css without its first line', () => {
    expect(source[0]).toMatch(/^@import url\('https:\/\/fonts\.googleapis\.com\//)
    expect(body).toBe(source.slice(1).join('\n'))
  })

  it('load nothing from other sites', () => {
    expect(body).not.toMatch(/@import|url\(\s*['"]?(https?:)?\/\//)
  })

  it('keep the MIT notice', () => {
    expect(vendored).toContain('Copyright (c) 2026 Josh Puckett')
    expect(vendored).toContain('The above copyright notice and this permission notice shall be included in all')
  })
})
