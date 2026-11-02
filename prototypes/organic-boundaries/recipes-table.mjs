// Pass/fail table per recipe from recipes-audit.mjs's report, and the small
// sheets for results/. node recipes-table.mjs
//
// Pack frames: generic bands. A check is "not measured" when it needs two
// boundaries and the frame has one, or (wavelength) when no boundary wiggles more
// than 0.3% H. Frames listed in UNRELIABLE are left out of the counts.

import fs from 'node:fs'
import path from 'node:path'
import { ROOT, PROTO } from './lib/refs.mjs'
import { loadCanvas, saveCanvas, resizeCanvas, column } from './lib/image.mjs'

const DIR = path.join(ROOT, 'artifacts/organic-boundaries/recipes')
const report = JSON.parse(fs.readFileSync(path.join(DIR, 'report.json'), 'utf8'))
const CATS = ['wander', 'wavelength', 'width', 'neighbours', 'spacing', 'folds']
// A light band between a Meta Blue sky and a Meta Blue ground: every projection
// confuses the two blues, so these frames' isolines are not the frame's boundaries.
const UNRELIABLE = new Set(['sunset.bands-bold-16x9-s2', 'sunset.bands-bold-9x16-s2'])

const lines = []
const out = (s = '') => {
  lines.push(s)
  console.log(s)
}
const median = (v) => {
  const s = v.filter(Number.isFinite).sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : NaN
}
const f = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '-')

out('## Pack frames (generic bands): frames passing / frames measured')
out()
out(`| recipe | ${CATS.join(' | ')} | left out |`)
out(`| --- | ${CATS.map(() => '---').join(' | ')} | --- |`)
const byRecipe = {}
for (const [key, r] of Object.entries(report.packs)) (byRecipe[r.recipe] ??= []).push([key, r])
for (const [recipe, frames] of Object.entries(byRecipe)) {
  const cells = CATS.map((cat) => {
    let pass = 0
    let measured = 0
    for (const [key, r] of frames) {
      if (UNRELIABLE.has(key) || !r.checks) continue
      let v = r.checks[cat].pass
      if (cat === 'wavelength' && !r.checks.wavelength.value.aspects.length) v = null
      if (v === null) continue
      measured++
      if (v) pass++
    }
    return `${pass}/${measured}`
  })
  out(`| ${recipe} | ${cells.join(' | ')} | ${frames.filter(([k]) => UNRELIABLE.has(k)).length} |`)
}
out()
out('Typical values (median over the measured frames):')
out()
for (const [recipe, frames] of Object.entries(byRecipe)) {
  const ok = frames.filter(([k, r]) => !UNRELIABLE.has(k) && r.checks)
  const c = (fn) => median(ok.map(([, r]) => fn(r.checks)))
  out(
    `- ${recipe}: widest boundary wiggle ${f(c((k) => k.wander.value.widest))} % H, lowest ${f(c((k) => k.wander.value.lowest))} % H; ` +
      `top component share ${f(c((k) => Math.max(...k.wavelength.value.shares)))}; ` +
      `width min/max ${f(median(ok.flatMap(([, r]) => r.checks.width.value.minOverMax)))}; ` +
      `neighbour corr ${f(c((k) => k.neighbours.value))}; spacing CV ${f(c((k) => k.spacing.value))}; ` +
      `warp folds ${f(c((k) => k.folds.value.hooks * 100))} %, slope p01 ${f(c((k) => k.folds.value.slopeP01))}`,
  )
}
out()
out('## Reference presets (1:1 bands): pass or fail per reference')
out()
out(`| reference | recipe | ${CATS.join(' | ')} |`)
out(`| --- | --- | ${CATS.map(() => '---').join(' | ')} |`)
for (const [id, r] of Object.entries(report.refs)) {
  if (!r.checks) continue
  out(`| ${id.replace('sunset-', '')} | ${r.recipe} | ${CATS.map((cat) => (r.checks[cat].pass ? 'pass' : 'FAIL')).join(' | ')} |`)
}
fs.writeFileSync(path.join(DIR, 'table.md'), `${lines.join('\n')}\n`)

// one sheet of pack frames (ramp, bands, blooms) and one of reference presets for the README
const stack = async (files, width) => {
  const sheets = []
  for (const file of files) if (fs.existsSync(file)) sheets.push(await resizeCanvas(...fit(await loadCanvas(file), width)))
  return column(sheets, { gap: 10 })
}
const fit = (c, width) => [c, width, Math.round((c.h * width) / c.w)]
const packs = ['sunset.ramp', 'sunset.bands', 'sunset.blooms'].map((r) => path.join(DIR, `iso-packs-${r}.jpg`))
await saveCanvas(await stack(packs, 1400), path.join(PROTO, 'results', 'recipes-packs.jpg'), { quality: 78 })
const refs = ['sunset.ramp', 'sunset.bands'].map((r) => path.join(DIR, `iso-refs-${r}.jpg`))
await saveCanvas(await stack(refs, 1200), path.join(PROTO, 'results', 'recipes-refs.jpg'), { quality: 78 })
