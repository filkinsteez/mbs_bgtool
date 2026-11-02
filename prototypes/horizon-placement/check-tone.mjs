// Checks that lib/tone.mjs matches the engine's CPU tone curve.
//   node --import ./prototypes/horizon-placement/lib/ts-register.mjs prototypes/horizon-placement/check-tone.mjs
import { toneCurve as engine } from '../../src/light/engine/output.ts'
import { toneCurve as copy } from './lib/tone.mjs'

let worst = 0
let s = 12345
const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296)
for (let i = 0; i < 20000; i++) {
  const c = [rnd() * 4, rnd() * 4, rnd() * 4]
  const a = engine(c)
  const b = copy(c)
  worst = Math.max(worst, ...a.map((v, k) => Math.abs(v - b[k])))
}
console.log(`largest difference over 20000 colors: ${worst.toExponential(2)}`)
