// Careful timing of calibrateBoundary on the looks' params (tools/capture-params.mjs):
// each call runs `reps` times and keeps its fastest run, so load from other work on
// the machine does not count. Several modules run in the same process, in turn.
// node tools/calib-bench.mjs <params.json> <module.ts> [<module.ts> ...] [--reps 3]

import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const repsAt = args.indexOf('--reps')
const reps = repsAt >= 0 ? Number(args[repsAt + 1]) : 3
const files = args.filter((a, i) => !a.startsWith('--') && i !== repsAt + 1)
const calls = JSON.parse(fs.readFileSync(files[0], 'utf8'))
const modules = []
for (const f of files.slice(1)) modules.push([path.basename(path.dirname(f)) + '/' + path.basename(f), await import(path.resolve(f))])
const f = (v) => v.toFixed(2)
for (const [, B] of modules) for (const c of calls.slice(0, 30)) B.calibrateBoundary(c.params, c.aspect, c.seed)
const results = modules.map(() => ({}))
for (const c of calls) {
  modules.forEach(([, B], m) => {
    let best = Infinity
    for (let k = 0; k < reps; k++) {
      const t0 = performance.now()
      B.calibrateBoundary(c.params, c.aspect, c.seed)
      best = Math.min(best, performance.now() - t0)
    }
    const key = `${c.look} ${c.aspect > 1 ? '16x9' : '9x16'}`
    ;(results[m][key] ??= []).push(best)
  })
}
for (const key of Object.keys(results[0])) {
  const cells = results.map((res, m) => {
    const t = res[key].slice().sort((p, q) => p - q)
    return `${modules[m][0]}: median ${f(t[t.length >> 1])} worst ${f(t[t.length - 1])}`
  })
  console.log(`${key.padEnd(12)} ${cells.join(' | ')} ms`)
}
