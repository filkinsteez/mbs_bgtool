// Where each Sunset look puts its horizon and light, read from the compose code (read-only import of src/).
//   node --import ./prototypes/horizon-placement/lib/ts-register.mjs prototypes/horizon-placement/code-placement.mjs
// Writes out/code-placement.json: one row per look x pack x format x seed (1-64) x Horizon (0, 0.25, 0.5, 0.75, 1).
// Heights are frame fractions down from the top at the frame's center column; above 1 is below the bottom edge.
import { writeFileSync } from 'node:fs'
import { getPack } from '../../src/light/color/packs.ts'
import { hexToLinear } from '../../src/light/color/srgb.ts'
import { linearToOklab } from '../../src/light/color/oklab.ts'
import { composeRamp, rampStructure } from '../../src/light/recipes/sunset/ramp-compose.ts'
import { composeBands } from '../../src/light/recipes/sunset/bands-compose.ts'
import { composeLayout } from '../../src/light/recipes/sunset/blooms-compose.ts'

const PACK_IDS = ['bold', 'elemental', 'atmospheric']
const FORMATS = { '16x9': 16 / 9, '9x16': 9 / 16 }
const SEEDS = Array.from({ length: 64 }, (_, i) => i + 1)
const HORIZONS = [0, 0.25, 0.5, 0.75, 1]

// blooms.ts rolesFromPack: sky, two unused deep slots, the two lightest other colors as light1, light2
function bloomColors(packId) {
  const [sky, ...rest] = getPack(packId).colors.map((c) => c.hex)
  const L = (hex) => linearToOklab(hexToLinear(hex))[0]
  const by = [...rest].sort((a, b) => L(a) - L(b))
  const light1 = by[by.length - 1] ?? sky
  const light2 = by[by.length - 2] ?? light1
  return [sky, '#000000', '#000000', light1, light2].map(hexToLinear)
}

const rows = []
for (const pack of PACK_IDS) {
  for (const [format, aspect] of Object.entries(FORMATS)) {
    const tall = Math.max(1, 1 / aspect)
    for (const seed of SEEDS) {
      for (const h of HORIZONS) {
        const controls = { intensity: 0.5, softness: 0.5, mood: h }
        // ramp
        {
          const c = composeRamp(pack, controls, seed, aspect)
          const p = c.params
          const horizonY = p.anchor[1]
          const glowLine = horizonY + p.glowOffset / tall
          rows.push({ look: 'ramp', pack, format, seed, h, structure: rampStructure(seed), horizon: horizonY, glowLine, tilt: p.angle, sunX: p.sunAt[0], sunY: p.sunAt[1] })
        }
        // bands: the glow band is the one with sun cover; the next band's top edge is the horizon
        {
          const c = composeBands({ pack: getPack(pack), seed, aspect, intensity: 0.5, softness: 0.5, horizon: h })
          const p = c.params
          let glow = -1
          for (let i = 0; i < p.bands; i++) if (p[`band${i + 1}Sun`]?.[1] > 0) glow = i
          const horizon = glow >= 0 && glow + 1 < p.bands ? p[`band${glow + 2}Edges`][0] : null
          const glowTop = glow >= 0 ? p[`band${glow + 1}Edges`][0] : null
          rows.push({ look: 'bands', pack, format, seed, h, structure: `${p.bands - glow - 1} ground`, horizon, glowLine: glowTop, tilt: 0, sunX: p.sun[0], sunY: horizon })
        }
        // blooms: the lead glow's center
        {
          const layout = composeLayout(bloomColors(pack), seed, { intensity: 0.5, softness: 0.5, rise: h })
          const lead = layout.glows[0]
          const kind = lead.at[1] >= 1.0 && lead.at[0] > -0.02 && lead.at[0] < 1.02 ? 'below' : lead.at[0] < 0 || lead.at[0] > 1 ? 'beyond side' : 'in frame'
          rows.push({ look: 'blooms', pack, format, seed, h, structure: kind, horizon: null, glowLine: lead.at[1], tilt: lead.angle, sunX: lead.at[0], sunY: lead.at[1] })
        }
      }
    }
  }
}
const out = new URL('./out/code-placement.json', import.meta.url).pathname
writeFileSync(out, JSON.stringify(rows))

// summary
const q = (v, p) => {
  const s = v.filter((x) => x !== null && Number.isFinite(x)).sort((a, b) => a - b)
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN
}
const f = (v) => (Number.isFinite(v) ? v.toFixed(2) : '  - ')
console.log(`${rows.length} rows -> ${out}`)
for (const look of ['ramp', 'bands', 'blooms']) {
  console.log(`\n${look}`)
  for (const format of Object.keys(FORMATS)) {
    for (const h of HORIZONS) {
      const r = rows.filter((x) => x.look === look && x.format === format && x.h === h)
      const hz = r.map((x) => x.horizon)
      const inFrame = hz.filter((v) => v !== null && v < 1).length
      const gl = r.map((x) => x.glowLine)
      console.log(
        `  ${format} H${h.toFixed(2)}  horizon p10/50/90 ${f(q(hz, 0.1))} ${f(q(hz, 0.5))} ${f(q(hz, 0.9))}  in frame ${inFrame}/${r.length}  light line p10/50/90 ${f(q(gl, 0.1))} ${f(q(gl, 0.5))} ${f(q(gl, 0.9))}`,
      )
    }
  }
}
const structures = {}
for (const r of rows.filter((x) => x.look !== 'bands' && x.h === 0.5)) structures[`${r.look} ${r.structure}`] = (structures[`${r.look} ${r.structure}`] ?? 0) + 1
console.log('\nstructures at Horizon 0.5:', structures)
