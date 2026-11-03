// Markdown table of the measurements: targets one by one, renders as the median (and
// range) over their group. Reads out/measure-tool.json and out/measure-proto.json.
// node prototypes/organic-principle/summary.mjs
import fs from 'node:fs'
import path from 'node:path'
import { HERE } from './lib/targets.mjs'

const tool = JSON.parse(fs.readFileSync(path.join(HERE, 'out/measure-tool.json'), 'utf8'))
const proto = JSON.parse(fs.readFileSync(path.join(HERE, 'out/measure-proto.json'), 'utf8'))
const all = { ...tool, ...proto }

const groups = [
  ['poster (Etsy copy)', (k) => k === 'poster-etsy'],
  ['poster (moodboard copy)', (k) => k === 'poster-board'],
  ['ridge frame', (k) => k === 'ridge'],
  ['now: Bands (18)', (k) => k.startsWith('tool:bands-')],
  ['now: Ramp (18)', (k) => k.startsWith('tool:ramp-')],
  ['now: Blooms (6)', (k) => k.startsWith('tool:blooms-')],
  ['principle, stacked (18)', (k) => k.startsWith('proto:pb-')],
  ['principle, horizon (18)', (k) => k.startsWith('proto:pr-')],
]

const median = (a) => {
  const s = a.filter(Number.isFinite).sort((x, y) => x - y)
  return s.length ? s[Math.floor(s.length / 2)] : NaN
}
const range = (a) => {
  const s = a.filter(Number.isFinite).sort((x, y) => x - y)
  return s.length ? [s[0], s[s.length - 1]] : [NaN, NaN]
}
const fmt = (v, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : '-')
const cell = (vals, d, scale = 1) => {
  // JSON stores NaN (no strong edges found) as null
  const v = vals.map((x) => (x === null || x === undefined ? NaN : x * scale))
  if (!v.some(Number.isFinite)) return '-'
  if (v.length === 1) return fmt(v[0], d)
  const [lo, hi] = range(v)
  return `${fmt(median(v), d)} (${fmt(lo, d)}-${fmt(hi, d)})`
}

const rows = []
for (const [label, test] of groups) {
  const items = Object.entries(all)
    .filter(([k]) => test(k))
    .map(([, v]) => v)
  if (!items.length) continue
  const oct = (i) => items.map((r) => r.octaves.L[i])
  rows.push([
    label,
    cell(oct(1).map((v, j) => Math.hypot(v, oct(2)[j])), 1, 1000),
    cell(oct(3), 1, 1000),
    cell(oct(4), 1, 1000),
    cell(oct(5), 1, 1000),
    cell(
      items.map((r) => r.flat['Lab<0.05']),
      2,
    ),
    cell(
      items.map((r) => r.edges.w1090P10),
      2,
    ),
    cell(
      items.map((r) => r.edges.w1090Median),
      2,
    ),
    cell(
      items.map((r) => r.value.reversals),
      0,
    ),
    cell(
      items.map((r) => r.value.range),
      2,
    ),
  ])
}
const head = ['', '2D, 4-16 px', '2D, 16-32 px', '2D, 32-64 px', '2D, 64-128 px', 'flat share', 'edge 10-90, p10', 'edge 10-90, median', 'value reversals', 'lightness range']
const md = [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n')
fs.writeFileSync(path.join(HERE, 'out/summary.md'), md + '\n')
console.log(md)
