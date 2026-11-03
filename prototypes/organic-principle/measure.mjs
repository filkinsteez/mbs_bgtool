// Measures what separates the poster and the ridge frame from renders.
// node prototypes/organic-principle/measure.mjs [--set tool|proto|all] [--out name]
// Writes out/measure-<name>.json and prints one line per image.
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { TARGETS, HERE, analysisSize } from './lib/targets.mjs'
import { loadLinear, toOklab } from './lib/image.mjs'
import { profileShare, octaveEnergy, residualSpectrum, flatness, columnEdges, edgeSummary, trackEdges, trackStats, anisotropy, valueStructure } from './lib/measure.mjs'

const args = process.argv.slice(2)
const opt = (k, d) => {
  const i = args.indexOf(k)
  return i >= 0 ? args[i + 1] : d
}
const set = opt('--set', 'all')
const name = opt('--out', set)

const inputs = {}
if (set === 'all' || set === 'targets' || set === 'tool') for (const [k, t] of Object.entries(TARGETS)) inputs[k] = t
const addDir = (dir, prefix) => {
  if (!fs.existsSync(dir)) return
  for (const f of fs.readdirSync(dir).sort()) if (f.endsWith('.png')) inputs[prefix + f.replace('.png', '')] = { file: path.join(dir, f) }
}
if (set === 'all' || set === 'tool') addDir(path.join(HERE, 'out/tool'), 'tool:')
if (set === 'all' || set === 'proto') addDir(path.join(HERE, 'out/proto'), 'proto:')
const extra = opt('--dir', null)
if (extra) addDir(path.resolve(extra), path.basename(extra) + ':')

const results = {}
for (const [key, t] of Object.entries(inputs)) {
  const meta = await sharp(t.file).metadata()
  const src = t.crop ?? { left: 0, top: 0, width: meta.width, height: meta.height }
  const size = analysisSize(src.width, src.height)
  const img = await loadLinear(t.file, { crop: t.crop, ...size })
  const lab = toOklab(img)
  const short = Math.min(lab.w, lab.h)
  const edges = columnEdges(lab)
  const tracks = trackEdges(edges, lab.w)
  const r = {
    size: [lab.w, lab.h],
    profile: profileShare(lab),
    octaves: octaveEnergy(lab),
    spectrum: (({ slopeMid, slopeFine }) => ({ slopeMid, slopeFine }))(residualSpectrum(lab)),
    flat: flatness(lab),
    edges: edgeSummary(edges, short),
    tracks: trackStats(tracks, short),
    aniso: anisotropy(lab),
    value: valueStructure(lab),
  }
  results[key] = r
  const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '  - ')
  const f3 = (v) => (Number.isFinite(v) ? v.toFixed(3) : '  -  ')
  const midL = r.octaves.L.slice(3, 6).reduce((s, v) => s + v * v, 0) ** 0.5
  const midC = r.octaves.C.slice(3, 6).reduce((s, v) => s + v * v, 0) ** 0.5
  const wig = r.tracks.per.map((p) => p.wiggle.toFixed(3)).join(',')
  console.log(
    key.padEnd(44),
    `1D L ${f2(r.profile.L)} ab ${f2(r.profile.ab)}`,
    `| mid2D L ${f3(midL)} C ${f3(midC)}`,
    `| slope ${f2(r.spectrum.slopeMid)}/${f2(r.spectrum.slopeFine)}`,
    `| flat ${f2(r.flat['Lab<0.05'])}`,
    `| edge ratio ${f2(r.edges.ratioMedian)} w ${f3(r.edges.w1090P10)}-${f3(r.edges.w1090P90)} n${r.edges.count}`,
    `| aniso ${f2(r.aniso.residualXY)}`,
    `| rev ${r.value.reversals} range ${f2(r.value.range)}`,
    `| wiggle ${wig}`,
  )
}
fs.writeFileSync(path.join(HERE, `out/measure-${name}.json`), JSON.stringify(results, null, 1))
