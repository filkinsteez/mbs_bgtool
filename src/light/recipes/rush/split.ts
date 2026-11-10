import type { NumberParam, RecipeDefinition, VectorParam } from '../../scene'
import { composeRush, rushSlotsFromPack } from './split-compose'
import { MAX_LIGHTS, MAX_TONGUES, RUSH_SPLIT_GLSL } from './split-shader'

const vector = (key: string, label: string, length: number): VectorParam => ({ kind: 'vector', key, label, min: -64, max: 64, step: 0.0001, default: new Array(length).fill(0) })
const number = (key: string, label: string, max = 64, value = 0): NumberParam => ({ kind: 'number', key, label, min: -64, max, step: 0.0001, default: value })

export const rushSplit: RecipeDefinition = {
  id: 'rush.split',
  mood: 'rush',
  label: 'Split',
  colorSlots: [
    { key: 'c0', label: 'Color 1' },
    { key: 'c1', label: 'Color 2' },
    { key: 'c2', label: 'Color 3' },
    { key: 'c3', label: 'Color 4' },
    { key: 'ground', label: 'Ground' },
  ],
  defaultColors: ['#0064E0', '#1FCDF0', '#FFD61E', '#FF4F00', '#0064E0'],
  params: [
    vector('run', 'Run', 4),
    vector('hook', 'Bend along the flow', 2),
    vector('stack', 'Stack', 4),
    vector('swell', 'Broad swell across', 4),
    vector('la', 'Streak places and widths', 4 * MAX_LIGHTS),
    vector('lb', 'Streak sides and split', 4 * MAX_LIGHTS),
    vector('lc', 'Streak light', 4 * MAX_LIGHTS),
    vector('ld', 'Streak gradient and texture', 4 * MAX_LIGHTS),
    vector('le', 'Streak fades and color', 4 * MAX_LIGHTS),
    vector('lf', 'Streak drift and core', 4 * MAX_LIGHTS),
    vector('lg', 'Streak taper and falloff', 4 * MAX_LIGHTS),
    vector('lh', 'Streak skirts', 4 * MAX_LIGHTS),
    number('lights', 'Streaks', MAX_LIGHTS),
    vector('spectrum', 'Color places', 4),
    vector('fringe', 'White fringe levels', 4),
    vector('ramp', 'Dim path per color', 48),
    number('comps', 'Colors', 4),
    number('groundLevel', 'Ground level', 4),
    vector('tongue', 'Shadow tongues', 4 * MAX_TONGUES),
    vector('tongueLook', 'Shadow look', 4),
    number('tongues', 'Shadow count', MAX_TONGUES),
  ],
  fragment: RUSH_SPLIT_GLSL,
  uniforms: (ctx) => {
    const ground = ctx.color('ground')
    const level = ctx.num('groundLevel')
    return {
      uRun: ctx.vec('run'),
      uHook: ctx.vec('hook'),
      uStack: ctx.vec('stack'),
      uSwell: ctx.vec('swell'),
      uLA: new Float32Array(ctx.vec('la')),
      uLB: new Float32Array(ctx.vec('lb')),
      uLC: new Float32Array(ctx.vec('lc')),
      uLD: new Float32Array(ctx.vec('ld')),
      uLE: new Float32Array(ctx.vec('le')),
      uLF: new Float32Array(ctx.vec('lf')),
      uLG: new Float32Array(ctx.vec('lg')),
      uLH: new Float32Array(ctx.vec('lh')),
      uLights: Math.round(ctx.num('lights')),
      uC0: ctx.color('c0'),
      uC1: ctx.color('c1'),
      uC2: ctx.color('c2'),
      uC3: ctx.color('c3'),
      uRamp: new Float32Array(ctx.vec('ramp')),
      uSpectrum: ctx.vec('spectrum'),
      uFringe: ctx.vec('fringe'),
      uComps: Math.round(ctx.num('comps')),
      uGround: ground.map((v) => v * level),
      uTongue: new Float32Array(ctx.vec('tongue')),
      uTongueLook: ctx.vec('tongueLook'),
      uTongues: Math.round(ctx.num('tongues')),
    }
  },
  radianceScale: 0.5,
  lens: { bloom: 0.04, bloomLevels: [1, 0.7, 0.45, 0.25, 0.12, 0.05, 0, 0], halation: 0, glare: 0.01 },
  fromPack: rushSlotsFromPack,
  compose: composeRush,
}
