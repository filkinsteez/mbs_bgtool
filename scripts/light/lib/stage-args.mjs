// How a check draws a look, from its --stage and --mix arguments. By default as the app draws it, since the color
// stage became the app's only path (962e496): the stage on at the default mix, the design drawn in the stage's design
// pack and given the picked pack's colors. `--stage off` draws the look in the picked pack without the stage, for
// comparisons; `--mix <name>` picks another mix (blue-off, Cyan:0.6, ...).
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { list } from './args.mjs'

export const DEFAULT_MIX = 'default'

// The mixes every stage and look change is judged under (SHARED, Wed 8:31 AM): the default, Meta Blue off, an even
// split, and one other color at half (Yellow in Bold, Lime in Elemental, Ice in Atmospheric; lib/color-read.mjs
// mixByName reads `even` and `half`). `--mix set` runs a check once for each.
export const MIX_SET = ['default', 'blue-off', 'even', 'half']

// The arguments for one mix's run of a check: the same arguments without --mix, --stage and --out, then that mix, the
// stage on and the mix's own folder.
export function mixRunArgs(argv, mix, out) {
  const kept = []
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '').split('=')[0]
    const dropped = argv[i].startsWith('--') && ['mix', 'stage', 'out'].includes(key)
    const takesValue = !argv[i].includes('=') && i + 1 < argv.length && !argv[i + 1].startsWith('--')
    if (!dropped) kept.push(argv[i])
    if (takesValue) {
      if (!dropped) kept.push(argv[i + 1])
      i++
    }
  }
  return [...kept, '--mix', mix, '--stage', 'on', '--out', out]
}

// How much of each mix's summary the combined summary keeps.
const SUMMARY_LINES = 40

// With --mix set: runs the check (`url`: its import.meta.url) once per mix in MIX_SET, each into <out>/<mix> (by
// default artifacts/<check>/mix-set-<time>), then writes <out>/summary.md with the first SUMMARY_LINES lines of each
// mix's summary. Returns the exit code (the worst of the runs), or null without --mix set.
export function runMixSet(args, url) {
  if (args.mix !== 'set') return null
  const script = fileURLToPath(url)
  const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, '')
  const out = path.resolve(typeof args.out === 'string' ? args.out : path.join('artifacts', path.basename(script, '.mjs'), `mix-set-${stamp}`))
  fs.mkdirSync(out, { recursive: true })
  const sections = []
  let code = 0
  for (const mix of MIX_SET) {
    const dir = path.join(out, mix)
    const run = spawnSync(process.execPath, [script, ...mixRunArgs(process.argv.slice(2), mix, dir)], { stdio: 'inherit' })
    code = Math.max(code, run.status ?? 1)
    const file = path.join(dir, 'summary.md')
    const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n') : ['', `(no summary: the run exited ${run.status})`]
    sections.push(`## Mix ${mix}`, '', ...lines.slice(1, 1 + SUMMARY_LINES).map((l) => l.replace(/^(#+) /, '#$1 ')).filter((l, i, all) => l || all[i - 1]), '')
  }
  fs.writeFileSync(path.join(out, 'summary.md'), [`# ${path.basename(script, '.mjs')}: the mix set (${MIX_SET.join(', ')}), stage on`, '', `Each mix's full output is in its own folder here.`, '', ...sections].join('\n'))
  console.log(`mix set: ${path.relative(process.cwd(), path.join(out, 'summary.md'))}`)
  return code
}

// One stage: { on, mix } (mix null with the stage off).
export function stageArgs(args) {
  const stages = list(args.stage)
  if (stages.length > 1 || (stages.length && stages[0] !== 'on' && stages[0] !== 'off')) throw new Error(`--stage ${args.stage}: give on or off`)
  const off = stages[0] === 'off'
  if (off && typeof args.mix === 'string') throw new Error('--stage off with --mix: a mix needs the stage on')
  return off ? { on: false, mix: null } : { on: true, mix: typeof args.mix === 'string' ? args.mix : DEFAULT_MIX }
}

// Several stages, for checks that can run both (--stage on,off): the list, `fallback` when none is given.
export function stagesArg(args, fallback = ['on']) {
  const stages = list(args.stage)
  for (const s of stages) if (s !== 'on' && s !== 'off') throw new Error(`--stage ${args.stage}: give on, off or on,off`)
  return stages.length ? [...new Set(stages)] : fallback
}

// The words for a summary header: "stage on, mix default" or "stage off".
export function stageText(on, mix) {
  return on ? `stage on, mix ${mix ?? DEFAULT_MIX}` : 'stage off'
}
