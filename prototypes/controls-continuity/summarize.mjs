// Sums up one or more control-sweep runs (their steps.json): per look and control, how many sweeps jump, how large
// the jumps are, at which values, for which seeds, packs and formats, and which scene params or uniforms jump with
// them most often (indices dropped, so uBndDark[14] and uBndDark[10] count as one). Also how much each control does:
// the median step and the share of steps that change almost nothing.
// Usage: node prototypes/controls-continuity/summarize.mjs <run dir> [<run dir> ...] [--md]
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const args = process.argv.slice(2)
const markdown = args.includes('--md')
const dirs = args.filter((a) => !a.startsWith('--'))
const DEAD = 0.0005

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}
const fmt = (x, d = 3) => x.toFixed(d)
const range = (xs, d = 3) => (xs.length ? `${fmt(Math.min(...xs), d)}-${fmt(Math.max(...xs), d)}` : '-')
const controlName = (look, control) => (control === 'mood' ? (look.startsWith('sunset.') ? 'horizon' : 'light') : control)

for (const dir of dirs) {
  const run = JSON.parse(await readFile(path.join(dir, 'steps.json'), 'utf8'))
  console.log(markdown ? `\n### ${run.label} (${path.basename(dir)})\n` : `\n== ${run.label} (${dir})`)
  if (markdown) console.log('| Look | Control | Sweeps with jumps | Jump ΔE (x the steps around) | Values | Seeds | Packs, formats | Jumps with it (count) | Median step, share near 0 |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  const groups = new Map()
  for (const sweep of run.sweeps) {
    const key = `${sweep.look}|${sweep.control}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(sweep)
  }
  for (const [key, sweeps] of groups) {
    const [look, control] = key.split('|')
    const jumps = sweeps.flatMap((s) => s.jumps.map((j) => ({ ...j, seed: s.seed, pack: s.pack, format: s.format })))
    const withJumps = sweeps.filter((s) => s.jumps.length)
    const steps = sweeps.flatMap((s) => s.steps)
    const dead = steps.filter((v) => v < DEAD).length / Math.max(1, steps.length)
    const causeCounts = new Map()
    for (const jump of jumps) {
      const names = new Set((jump.causes ?? []).map((c) => `${c.kind === 'params' ? '' : 'u:'}${c.key.replace(/\[\d+\]/g, '[]')}`))
      for (const name of names) causeCounts.set(name, (causeCounts.get(name) ?? 0) + 1)
    }
    const shaderOnly = jumps.filter((j) => !(j.causes ?? []).length).length
    const causes = [...causeCounts].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n, c]) => `${n} (${c})`)
    if (shaderOnly) causes.push(`only the shader (${shaderOnly})`)
    const values = [...new Set(jumps.map((j) => j.a.toFixed(2)))].sort()
    const seeds = [...new Set(jumps.map((j) => j.seed))].sort((a, b) => a - b)
    const packs = [...new Set(jumps.map((j) => j.pack))]
    const formats = [...new Set(jumps.map((j) => j.format))]
    const name = controlName(look, control)
    const size = jumps.length ? `${range(jumps.map((j) => j.step))} (${range(jumps.map((j) => j.ratio), 1)}x), worst block ${range(jumps.map((j) => j.peak), 2)}` : '-'
    const shownValues = values.length > 10 ? `${values.length} values, ${values[0]}-${values.at(-1)}` : values.join(' ')
    const largest = jumps.reduce((best, j) => (!best || j.step > best.step ? j : best), null)
    if (markdown) {
      console.log(`| ${look} | ${name} | ${withJumps.length} of ${sweeps.length} | ${size} | ${shownValues || '-'} | ${seeds.join(' ') || '-'} | ${packs.join(' ')} ${formats.join(' ')} | ${causes.join('; ') || '-'} | ${fmt(median(steps), 4)}, ${(dead * 100).toFixed(0)} % |`)
    } else {
      console.log(`${look} ${name}: ${withJumps.length} of ${sweeps.length} sweeps jump; ${jumps.length} jumps, ΔE ${size}`)
      if (jumps.length) {
        console.log(`  values ${shownValues}; seeds ${seeds.join(' ')}; packs ${packs.join(' ')}; formats ${formats.join(' ')}`)
        console.log(`  largest: ${largest.pack} seed ${largest.seed} ${largest.format} at ${largest.a.toFixed(2)}-${largest.b.toFixed(2)}, ΔE ${fmt(largest.step, 4)}`)
        console.log(`  jumps with it: ${causes.join('; ')}`)
      }
      console.log(`  median step ${fmt(median(steps), 4)}, ${(dead * 100).toFixed(0)} % of steps below ${DEAD}`)
    }
  }
}
