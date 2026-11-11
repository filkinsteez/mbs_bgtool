// How a check draws a look, from its --stage and --mix arguments. By default as the app draws it, since the color
// stage became the app's only path (962e496): the stage on at the default mix, the design drawn in the stage's design
// pack and given the picked pack's colors. `--stage off` draws the look in the picked pack without the stage, for
// comparisons; `--mix <name>` picks another mix (blue-off, Cyan:0.6, ...).
import { list } from './args.mjs'

export const DEFAULT_MIX = 'default'

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
