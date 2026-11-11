import { describe, expect, it } from 'vitest'
import { sliderPointer, type SliderPointerEvent, type SliderPress } from './sliderRelease'

/** Runs events through the guard from no press, giving each step's outcome. */
function run(events: SliderPointerEvent<string>[]) {
  let press: SliderPress<string> | null = null
  return events.map((event) => {
    const outcome = sliderPointer(press, event)
    press = outcome.press
    return outcome
  })
}

const down = (track: string | null, primary = true): SliderPointerEvent<string> => ({ kind: 'down', track, primary, pointerId: 1, x: 10, y: 5 })
const move = (track: string | null, pressed: boolean, x = 20): SliderPointerEvent<string> => ({ kind: 'move', track, pressed, x, y: 5 })

describe('a slider drag', () => {
  it('ends on a release that reaches the slider, with nothing left to end', () => {
    const [, , up, hover] = run([down('cyan'), move('cyan', true), { kind: 'up', track: 'cyan' }, move('cyan', false)])
    expect(up).toEqual({ block: false, end: null, press: null })
    expect(hover.block).toBe(true)
    expect(hover.end).toBeNull()
  })

  it('is ended where the pointer last was when the release lands outside the slider', () => {
    const [, , up] = run([down('cyan'), move('cyan', true, 42), { kind: 'up', track: null }])
    expect(up.end).toEqual({ track: 'cyan', pointerId: 1, x: 42, y: 5 })
    expect(up.press).toBeNull()
  })

  it('is ended on pointercancel, lost capture and a lost window focus, which DialKit leaves dragging', () => {
    for (const kind of ['cancel', 'lost', 'blur'] as const) {
      const [, , ended, hover] = run([down('cyan'), move('cyan', true, 30), { kind }, move('cyan', false)])
      expect(ended.end, kind).toEqual({ track: 'cyan', pointerId: 1, x: 30, y: 5 })
      expect(hover, kind).toEqual({ block: true, end: null, press: null })
    }
  })

  it('missed altogether is ended by the first move with no button down, which never reaches a slider', () => {
    const [, , hover, overOther] = run([down('cyan'), move('cyan', true, 30), move('yellow', false, 50), move('strength', false, 60)])
    expect(hover).toEqual({ block: true, end: { track: 'cyan', pointerId: 1, x: 30, y: 5 }, press: null })
    expect(overOther).toEqual({ block: true, end: null, press: null })
  })

  it('never starts with another button than the main one', () => {
    const [right, hover] = run([down('cyan', false), move('cyan', false)])
    expect(right).toEqual({ block: true, end: null, press: null })
    expect(hover.end).toBeNull()
  })

  it('leaves presses and moves away from the sliders alone', () => {
    const [press, drag, up] = run([down(null), move(null, true), { kind: 'up', track: null }])
    for (const outcome of [press, drag, up]) expect(outcome).toEqual({ block: false, end: null, press: null })
  })
})
