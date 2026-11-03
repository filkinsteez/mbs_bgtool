// Time calibrateBoundary on the params the looks pass (tools/capture-params.mjs),
// and compare its uniforms with another version of the module.
// node tools/calib-time.mjs <module.ts> [out/params.json] [--against <module.ts>] [--look ramp]

import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const opt = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : null
}
const modPath = path.resolve(args[0])
const paramsFile = args[1] && !args[1].startsWith('--') ? args[1] : 'out/params.json'
const B = await import(modPath)
const against = opt('--against') ? await import(path.resolve(opt('--against'))) : null
const onlyLook = opt('--look')
const calls = JSON.parse(fs.readFileSync(paramsFile, 'utf8')).filter((c) => !onlyLook || c.look === onlyLook)
const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '-')

// warm up the JIT on a few calls
for (const c of calls.slice(0, 20)) B.calibrateBoundary(c.params, c.aspect, c.seed)
const groups = {}
let worstRel = 0
let worstAbs = 0
let worstKey = ''
for (const c of calls) {
  const t0 = performance.now()
  const cal = B.calibrateBoundary(c.params, c.aspect, c.seed)
  const ms = performance.now() - t0
  const key = `${c.look} ${c.aspect > 1 ? '16x9' : '9x16'}`
  ;(groups[key] ??= []).push(ms)
  if (against) {
    const ref = against.calibrateBoundary(c.params, c.aspect, c.seed).uniforms
    for (const [name, v] of Object.entries(ref)) {
      const a = Array.isArray(v) ? v : [v]
      const b = cal.uniforms[name]
      const bb = Array.isArray(b) ? b : [b]
      for (let i = 0; i < a.length; i++) {
        const d = Math.abs(a[i] - bb[i])
        const rel = d / Math.max(1e-9, Math.abs(a[i]))
        if (d > worstAbs) worstAbs = d
        if (rel > worstRel && d > 1e-9) {
          worstRel = rel
          worstKey = `${c.look} ${c.tag} ${name}[${i}] ${a[i]} vs ${bb[i]}`
        }
      }
    }
  }
}
for (const [key, times] of Object.entries(groups)) {
  times.sort((p, q) => p - q)
  console.log(`${key.padEnd(12)} ${times.length} calls: median ${f(times[Math.floor(times.length / 2)], 2)} ms, 90% ${f(times[Math.floor(times.length * 0.9)], 2)} ms, worst ${f(times[times.length - 1], 2)} ms`)
}
if (against) console.log(`uniforms against the other module: largest difference ${worstAbs.toExponential(2)}, largest relative ${worstRel.toExponential(2)}${worstKey ? ` (${worstKey})` : ''}`)
