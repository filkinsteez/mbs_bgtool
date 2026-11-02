// Summary numbers for the doc from out/code-placement.json and out/shot-measures.json.
//   node prototypes/horizon-placement/summary.mjs > prototypes/horizon-placement/out/summary.txt
import { readFileSync } from 'node:fs'

const here = new URL('.', import.meta.url).pathname
const code = JSON.parse(readFileSync(here + 'out/code-placement.json', 'utf8'))
const shots = JSON.parse(readFileSync(here + 'out/shot-measures.json', 'utf8'))
const q = (v, p) => {
  const s = v.filter((x) => x !== null && Number.isFinite(x)).sort((a, b) => a - b)
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN
}
const f = (v) => (Number.isFinite(v) ? v.toFixed(2) : '-')
const pct = (n, d) => `${Math.round((100 * n) / d)}%`

console.log('Shots (seeds 1-8, 3 packs, 16:9 and 9:16): brightest row and light center, p10 / median / p90')
for (const look of ['ramp', 'bands', 'blooms']) {
  for (const h of [0, 0.5, 1]) {
    const r = shots.filter((x) => x.look === look && x.h === h)
    const b = r.map((x) => x.bright)
    const ly = r.map((x) => x.lightY)
    const bottom = r.filter((x) => x.bright >= 0.95).length
    const lower = r.filter((x) => x.bright >= 0.8).length
    console.log(
      `  ${look.padEnd(6)} H${h}: brightest ${f(q(b, 0.1))} / ${f(q(b, 0.5))} / ${f(q(b, 0.9))}  light ${f(q(ly, 0.1))} / ${f(q(ly, 0.5))} / ${f(q(ly, 0.9))}  brightest in the bottom 5%: ${pct(bottom, r.length)}, bottom 20%: ${pct(lower, r.length)}`,
    )
  }
}
console.log('\nShots: light center across the frame (x), share at a side edge (x < 0.05 or > 0.95)')
for (const look of ['ramp', 'bands', 'blooms']) {
  const r = shots.filter((x) => x.look === look)
  const side = r.filter((x) => x.lightX < 0.05 || x.lightX > 0.95).length
  console.log(`  ${look.padEnd(6)} ${pct(side, r.length)}`)
}
console.log('\nShots: sharpest color edge (Oklab distance across 3% of the height), median position and strength')
for (const look of ['ramp', 'bands', 'blooms']) {
  for (const h of [0, 0.5, 1]) {
    const r = shots.filter((x) => x.look === look && x.h === h)
    console.log(`  ${look.padEnd(6)} H${h}: at ${f(q(r.map((x) => x.edge), 0.5))}, strength ${q(r.map((x) => x.edgeE), 0.5).toFixed(3)}`)
  }
}
console.log('\nShots: Bands horizon tilt from the per-eighth drop rows (frame heights across the width), median |slope|')
{
  const r = shots.filter((x) => x.look === 'bands' && x.horizon !== null)
  const slopes = r
    .map((x) => {
      const pts = x.horizonCols.map((y, i) => [(i + 0.5) / 8, y]).filter((p) => p[1] !== null)
      if (pts.length < 5) return null
      const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length
      const my = pts.reduce((s, p) => s + p[1], 0) / pts.length
      return Math.abs(pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0))
    })
    .filter((v) => v !== null)
  console.log(`  n ${slopes.length}, median ${f(q(slopes, 0.5))}, p90 ${f(q(slopes, 0.9))}`)
}

console.log('\nCode, seeds 1-64: Ramp by structure, Horizon 0 / 0.5 / 1, horizon and glow line medians (16:9, 9:16)')
for (const s of ['open', 'corner', 'arcs', 'wave']) {
  for (const fmt of ['16x9', '9x16']) {
    const row = [0, 0.5, 1].map((h) => {
      const r = code.filter((x) => x.look === 'ramp' && x.structure === s && x.format === fmt && x.h === h)
      return `${f(q(r.map((x) => x.horizon), 0.5))}/${f(q(r.map((x) => x.glowLine), 0.5))}`
    })
    const tilt = code.filter((x) => x.look === 'ramp' && x.structure === s && x.format === fmt && x.h === 0.5).map((x) => Math.abs(x.tilt))
    console.log(`  ${s.padEnd(6)} ${fmt}: ${row.join('  ')}   |tilt| median ${f(q(tilt, 0.5))} deg, max ${f(Math.max(...tilt))}`)
  }
}
console.log('\nCode: Blooms lead light, share below the bottom edge vs beyond a side, and height range')
for (const h of [0, 0.5, 1]) {
  const r = code.filter((x) => x.look === 'blooms' && x.h === h)
  const below = r.filter((x) => x.structure === 'below').length
  console.log(`  H${h}: below ${pct(below, r.length)}; y p10/50/90 ${f(q(r.map((x) => x.sunY), 0.1))} ${f(q(r.map((x) => x.sunY), 0.5))} ${f(q(r.map((x) => x.sunY), 0.9))}`)
}
console.log('\nCode: Bands horizon range over every seed, Horizon 0 / 0.5 / 1 (min-max)')
for (const h of [0, 0.5, 1]) {
  const r = code.filter((x) => x.look === 'bands' && x.h === h).map((x) => x.horizon)
  console.log(`  H${h}: ${f(Math.min(...r))} - ${f(Math.max(...r))}`)
}
