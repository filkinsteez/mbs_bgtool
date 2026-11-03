// A copy of the Sunset looks' folder in out/look-copy/sunset/ with another
// boundary.ts in it, so a look can run with that library next to the real one in
// the same session. Imports that leave the folder point back at src; the
// production files are not touched.

import fs from 'node:fs'
import path from 'node:path'
import { ROOT, PROTO } from '../lib/refs.mjs'

/** Import path of the copy's folder, for the dev server and SSR. */
export const COPY_URL = '/prototypes/organic-boundaries/out/look-copy/sunset/'

export function makeLookCopy(otherBoundary) {
  const copyDir = path.join(PROTO, 'out/look-copy/sunset')
  fs.rmSync(path.join(PROTO, 'out/look-copy'), { recursive: true, force: true })
  fs.mkdirSync(copyDir, { recursive: true })
  const src = path.join(ROOT, 'src/light/recipes/sunset')
  for (const name of fs.readdirSync(src).filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))) {
    const text = fs
      .readFileSync(path.join(src, name), 'utf8')
      .replace(/from '\.\.\/\.\.\/([^']+)'/g, "from '/src/light/$1'")
      .replace(/from '\.\.\/([^']+)'/g, "from '/src/light/recipes/$1'")
    fs.writeFileSync(path.join(copyDir, name), text)
  }
  fs.copyFileSync(otherBoundary, path.join(copyDir, 'boundary.ts'))
}

/** The look cases both tools run: every control at four values around the default. */
export function lookCases() {
  const cases = [['default', 0.5]]
  for (const control of ['softness', 'mood', 'intensity']) for (const v of [0.2, 0.4, 0.6, 0.8]) cases.push([control, v])
  return cases
}

export const LOOKS = [
  ['ramp', 'ramp.ts', 'sunsetRamp'],
  ['bands', 'bands.ts', 'sunsetBands'],
  ['blooms', 'blooms.ts', 'sunsetBlooms'],
]

export const FORMATS = [
  ['16x9', 640, 360],
  ['9x16', 360, 640],
]
