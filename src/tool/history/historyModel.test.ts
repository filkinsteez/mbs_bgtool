import { describe, expect, it } from 'vitest'
import {
  designOf,
  EMPTY_HISTORY,
  HISTORY_LIMIT,
  mapQueries,
  parseEntries,
  parsePlace,
  record,
  redo,
  restore,
  setQuery,
  STEP_LIMIT,
  stringifyEntries,
  stringifyPlace,
  undo,
  withEntries,
  type History,
} from './historyModel'

const THUMB = 'data:image/jpeg;base64,AAAA'
const query = (seed: number, extra = '') => `mood=contour&look=halo&pack=bold&seed=${seed}&format=16x9${extra}`

let ids = 0
const newId = () => `e${++ids}`
const add = (history: History, q: string, thumb = THUMB) => record(history, q, thumb, newId())
const shown = (history: History) => history.entries.find((entry) => entry.id === history.current)?.query
const queries = (history: History) => history.entries.map((entry) => entry.query)

/** Every Cmd/Ctrl+Z until there is none, checking that each shows its state; the states shown, in order. */
function undoAll(start: History): { history: History; seen: string[] } {
  let history = start
  const seen: string[] = []
  for (let move = undo(history, newId()); move; move = undo(history, newId())) {
    history = move.history
    seen.push(move.query)
    expect(shown(history)).toBe(move.query)
  }
  return { history, seen }
}

describe('history', () => {
  it('adds a new design first and keeps the last few', () => {
    let history = EMPTY_HISTORY
    for (let seed = 1; seed <= HISTORY_LIMIT + 3; seed++) history = add(history, query(seed))
    expect(history.entries).toHaveLength(HISTORY_LIMIT)
    expect(history.entries[0].query).toBe(query(HISTORY_LIMIT + 3))
    expect(history.entries.at(-1)?.query).toBe(query(4))
    expect(shown(history)).toBe(query(HISTORY_LIMIT + 3))
    expect(history.back).toHaveLength(HISTORY_LIMIT + 2)
  })

  it('adds nothing for the state already shown, but takes its new thumbnail', () => {
    const history = add(EMPTY_HISTORY, query(1))
    expect(add(history, query(1), THUMB)).toBe(history)
    const again = add(history, query(1), `${THUMB}B`)
    expect(again.entries).toHaveLength(1)
    expect(again.entries[0].thumb).toBe(`${THUMB}B`)
    expect(again.back).toEqual([])
    expect(add(history, query(1), '')).toBe(history)
  })

  it('updates the shown design for a new pack, filter, filter strength or line, and steps back through each', () => {
    const states = [
      query(1),
      query(1).replace('pack=bold', 'pack=elemental'),
      query(1, '&filter=grain&strength=0.5'),
      query(1, '&filter=grain&strength=0.7'),
      query(1).replace('&seed', '&from=0.2,0.8&to=0.7,0.3&seed'),
    ]
    let history = EMPTY_HISTORY
    for (const state of states) history = add(history, state)
    expect(history.entries).toHaveLength(1)
    expect(history.back).toEqual(states.slice(0, -1))
    expect(undoAll(history).seen).toEqual(states.slice(0, -1).reverse())
  })

  it('shows a design already in the history where it is, without adding it again', () => {
    let history = add(add(add(EMPTY_HISTORY, query(1)), query(2)), query(3))
    history = add(history, query(1, '&filter=pixel&strength=0.5'))
    expect(queries(history)).toEqual([query(3), query(2), query(1, '&filter=pixel&strength=0.5')])
    expect(shown(history)).toBe(query(1, '&filter=pixel&strength=0.5'))
    expect(history.entries[2].thumb).toBe(THUMB)
  })

  it('tells designs apart by mood, look, seed and format only', () => {
    expect(designOf(query(1))).toBe(designOf(query(1).replace('pack=bold', 'pack=atmospheric')))
    expect(designOf(query(1))).toBe(designOf(query(1, '&filter=grain&strength=0.3')))
    expect(designOf(query(1))).not.toBe(designOf(query(2)))
    expect(designOf(query(1))).not.toBe(designOf(query(1).replace('16x9', '9x16')))
    expect(designOf(query(1))).not.toBe(designOf(query(1).replace('look=halo', 'look=rim')))
    expect(designOf(query(1))).not.toBe(designOf(query(1).replace('mood=contour&look=halo', 'mood=sunset&look=bands')))
  })

  it('shows a clicked entry without adding one, and Cmd+Z returns to where the click came from', () => {
    let history = add(add(add(EMPTY_HISTORY, query(1)), query(2)), query(3))
    const first = history.entries.at(-1)!
    const click = restore(history, first.id)!
    expect(click.query).toBe(query(1))
    history = click.history
    expect(queries(history)).toEqual([query(3), query(2), query(1)])
    expect(shown(history)).toBe(query(1))
    expect(restore(history, first.id)).toBeNull()
    expect(restore(history, 'gone')).toBeNull()
    const back = undo(history, newId())!
    expect(back.query).toBe(query(3))
    expect(undo(back.history, newId())?.query).toBe(query(2))
    expect(redo(back.history, newId())?.query).toBe(query(1))
    expect(queries(back.history)).toEqual(queries(history))
  })

  it('drops the steps forward on a new change', () => {
    let history = add(add(EMPTY_HISTORY, query(1)), query(2))
    history = undo(history, newId())!.history
    expect(history.forward).toEqual([query(2)])
    history = add(history, query(1).replace('pack=bold', 'pack=elemental'))
    expect(history.forward).toEqual([])
    expect(redo(history, newId())).toBeNull()
    expect(undo(history, newId())?.query).toBe(query(1))
  })

  it('goes back past the designs the history still shows, putting each one first again', () => {
    let history = EMPTY_HISTORY
    const last = HISTORY_LIMIT + 4
    for (let seed = 1; seed <= last; seed++) history = add(history, query(seed))
    const { history: start, seen } = undoAll(history)
    expect(seen).toEqual(Array.from({ length: last - 1 }, (_, i) => query(last - 1 - i)))
    expect(start.entries).toHaveLength(HISTORY_LIMIT)
    expect(start.entries[0]).toMatchObject({ query: query(1), thumb: '' })
    let end = start
    for (let move = redo(end, newId()); move; move = redo(end, newId())) end = move.history
    expect(shown(end)).toBe(query(last))
    expect(end.back).toHaveLength(last - 1)
  })

  it('keeps at most STEP_LIMIT steps back', () => {
    let history = EMPTY_HISTORY
    for (let step = 0; step <= STEP_LIMIT + 5; step++) history = add(history, query(1, `&filter=grain&strength=${step / 100}`))
    expect(history.back).toHaveLength(STEP_LIMIT)
    expect(history.back[0]).toBe(query(1, '&filter=grain&strength=0.05'))
  })

  it('sets an entry to the query its state reads back as', () => {
    const history = add(EMPTY_HISTORY, `${query(1)}&softness=0.5`)
    const id = history.entries[0].id
    expect(setQuery(history, id, query(1)).entries[0].query).toBe(query(1))
    expect(setQuery(history, id, `${query(1)}&softness=0.5`)).toBe(history)
    expect(setQuery(history, null, query(1))).toBe(history)
  })

  it("takes another tab's entries and keeps this tab's steps", () => {
    const history = add(add(EMPTY_HISTORY, query(1)), query(2))
    const other = add(EMPTY_HISTORY, query(5))
    const kept = withEntries(history, [...other.entries, ...history.entries])
    expect(kept.current).toBe(history.current)
    expect(kept.back).toEqual(history.back)
    const gone = withEntries(history, other.entries)
    expect(gone.current).toBeNull()
    expect(gone.back).toEqual([query(1)])
  })

  it('rewrites every query for states stored in an older form', () => {
    const old = (q: string) => `${q}&intensity=0.5`
    const history = undo(add(add(EMPTY_HISTORY, old(query(1))), old(query(2))), newId())!.history
    const now = mapQueries(history, (q) => q.replace('&intensity=0.5', ''))
    expect(queries(now)).toEqual([query(2), query(1)])
    expect(now.forward).toEqual([query(2)])
    expect(now.current).toBe(history.current)
  })

  it('reads back what it stores and leaves out what it cannot read', () => {
    const history = undo(add(add(EMPTY_HISTORY, query(1)), query(2)), newId())!.history
    const entries = parseEntries(stringifyEntries(history.entries))
    expect(entries).toEqual(history.entries)
    expect({ entries, ...parsePlace(stringifyPlace(history), entries) }).toEqual(history)
    expect(parseEntries(null)).toEqual([])
    expect(parseEntries('{not json')).toEqual([])
    expect(parseEntries(JSON.stringify({ version: 2, entries: history.entries }))).toEqual([])
    expect(parsePlace(stringifyPlace(history), [])).toEqual({ current: null, back: history.back, forward: history.forward })
    const bad = JSON.parse(stringifyEntries(history.entries))
    bad.entries[0].thumb = 'javascript:alert(1)'
    bad.entries[1].query = 7
    expect(parseEntries(JSON.stringify(bad))).toEqual([{ ...history.entries[0], thumb: '' }])
    bad.entries[0].thumb = `${THUMB}) red`
    expect(parseEntries(JSON.stringify(bad))[0].thumb).toBe('')
    const place = JSON.parse(stringifyPlace(history))
    place.current = 'missing'
    place.back = [query(1), 3, null]
    expect(parsePlace(JSON.stringify(place), entries)).toEqual({ current: null, back: [query(1)], forward: history.forward })
  })
})
