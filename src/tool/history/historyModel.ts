/** Most designs the history keeps; the oldest drops off past this. */
export const HISTORY_LIMIT = 8
/** Most steps Cmd/Ctrl+Z (and Shift+Cmd/Ctrl+Z) can take. */
export const STEP_LIMIT = 50

/**
 * The URL query parameters that make a design: the same mood, look, seed and format give the same layout in every
 * pack (owner, 2026-11-09, 5:58 PM). A change of anything else (the pack, the filter and its strength, the dragged
 * line) updates the shown design's entry instead of adding one.
 */
export const DESIGN_PARAMS = ['mood', 'look', 'seed', 'format'] as const

/** One design in the history: the tool state last shown with it, as its URL query, and a small JPEG of it. */
export interface HistoryEntry {
  id: string
  query: string
  /** A JPEG data URL, or '' until one is drawn. */
  thumb: string
}

export interface History {
  /** Newest first. */
  entries: readonly HistoryEntry[]
  /** The entry shown, or null before one is recorded. */
  current: string | null
  /** The states Cmd/Ctrl+Z goes to, as URL queries, the most recent last. */
  back: readonly string[]
  /** The states Shift+Cmd/Ctrl+Z goes to, the most recent last. */
  forward: readonly string[]
}

/** Where one tab is in the history: the shown entry and the steps. Each tab keeps its own. */
export type HistoryPlace = Omit<History, 'entries'>

export const EMPTY_HISTORY: History = { entries: [], current: null, back: [], forward: [] }

/** A query's design: its mood, look, seed and format. */
export function designOf(query: string): string {
  const params = new URLSearchParams(query)
  return DESIGN_PARAMS.map((key) => params.get(key) ?? '').join('|')
}

const currentEntry = (history: History) => history.entries.find((entry) => entry.id === history.current)

const keepSteps = (steps: readonly string[]) => steps.slice(-STEP_LIMIT)

/** The steps with the shown state added, when there is one. */
const withShown = (steps: readonly string[], shown: HistoryEntry | undefined) => (shown ? keepSteps([...steps, shown.query]) : steps)

const withEntry = (entries: readonly HistoryEntry[], id: string, change: Partial<HistoryEntry>) =>
  entries.map((entry) => (entry.id === id ? { ...entry, ...change } : entry))

/**
 * The entries with `query` shown: the entry with its design (the shown one first) takes the query, and the thumbnail
 * unless that is ''; with no such entry, a new one goes first and the oldest past HISTORY_LIMIT drops off.
 */
function place(history: History, query: string, thumb: string, newId: string): Pick<History, 'entries' | 'current'> {
  const design = designOf(query)
  const shown = currentEntry(history)
  const same = shown && designOf(shown.query) === design ? shown : history.entries.find((entry) => designOf(entry.query) === design)
  if (same) return { entries: withEntry(history.entries, same.id, { query, thumb: thumb || same.thumb }), current: same.id }
  return { entries: [{ id: newId, query, thumb }, ...history.entries].slice(0, HISTORY_LIMIT), current: newId }
}

/**
 * The history after a state settled, given its query and thumbnail: the state shown before it is one step back, and
 * the steps forward are dropped. The same state again only takes the new thumbnail ('' keeps the old one).
 */
export function record(history: History, query: string, thumb: string, newId: string): History {
  const shown = currentEntry(history)
  if (shown?.query === query) {
    return !thumb || thumb === shown.thumb ? history : { ...history, entries: withEntry(history.entries, shown.id, { thumb }) }
  }
  return { ...place(history, query, thumb, newId), back: withShown(history.back, shown), forward: [] }
}

/** A change made from the history: the history after it, and the state to show. */
export interface HistoryMove {
  history: History
  query: string
}

/** A click on entry `id`: its state is shown, and Cmd/Ctrl+Z returns to the state shown before. Null when it is already shown or gone. */
export function restore(history: History, id: string): HistoryMove | null {
  const entry = history.entries.find((item) => item.id === id)
  if (!entry || id === history.current) return null
  return { history: { ...history, current: id, back: withShown(history.back, currentEntry(history)), forward: [] }, query: entry.query }
}

/** A step to the last state of `from`; the shown state goes on the other side. A design that left the history comes back first. */
function move(history: History, from: 'back' | 'forward', newId: string): HistoryMove | null {
  const steps = history[from]
  const query = steps.at(-1)
  if (query === undefined) return null
  const rest = steps.slice(0, -1)
  const other = withShown(from === 'back' ? history.forward : history.back, currentEntry(history))
  const placed = place(history, query, '', newId)
  return { history: from === 'back' ? { ...placed, back: rest, forward: other } : { ...placed, back: other, forward: rest }, query }
}

/**
 * The history without entry `id`: its design also leaves the steps, so Cmd/Ctrl+Z doesn't bring it back, and when it
 * was the shown entry none is shown.
 */
export function remove(history: History, id: string): History {
  const entry = history.entries.find((item) => item.id === id)
  if (!entry) return history
  const design = designOf(entry.query)
  const others = (steps: readonly string[]) => steps.filter((step) => designOf(step) !== design)
  return {
    entries: history.entries.filter((item) => item !== entry),
    current: history.current === id ? null : history.current,
    back: others(history.back),
    forward: others(history.forward),
  }
}

/** Cmd/Ctrl+Z: the state before the last change, or null when there is none. */
export const undo = (history: History, newId: string) => move(history, 'back', newId)

/** Shift+Cmd/Ctrl+Z: the state the last Cmd/Ctrl+Z left, or null when there is none. */
export const redo = (history: History, newId: string) => move(history, 'forward', newId)

/** The history with entry `id`'s query set, for a state that reads back in a newer form after it is shown. */
export function setQuery(history: History, id: string | null, query: string): History {
  const entry = history.entries.find((item) => item.id === id)
  return !entry || entry.query === query ? history : { ...history, entries: withEntry(history.entries, entry.id, { query }) }
}

/** The history with another tab's entries; this tab's steps stay, and its shown entry while it is still there. */
export function withEntries(history: History, entries: readonly HistoryEntry[]): History {
  return { ...history, entries, current: entries.some((entry) => entry.id === history.current) ? history.current : null }
}

/** The history with every query in it rewritten, for states stored in an older form. */
export function mapQueries(history: History, rewrite: (query: string) => string): History {
  return {
    entries: history.entries.map((entry) => ({ ...entry, query: rewrite(entry.query) })),
    current: history.current,
    back: history.back.map(rewrite),
    forward: history.forward.map(rewrite),
  }
}

/** Longest stored id, query and thumbnail; a longer id or query leaves its entry or step out, a longer thumbnail its picture. */
const MAX_ID = 100
const MAX_QUERY = 1000
const MAX_THUMB = 100_000
/** A JPEG data URL and nothing else, so it can go in a CSS url() as it is. */
const THUMB_PATTERN = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/
const VERSION = 1

const isText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max

function parseStored(text: string | null): Record<string, unknown> | null {
  if (!text) return null
  try {
    const data: unknown = JSON.parse(text)
    return typeof data === 'object' && data !== null && (data as { version?: unknown }).version === VERSION ? (data as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function readEntry(value: unknown): HistoryEntry | null {
  const { id, query, thumb } = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  if (!isText(id, MAX_ID) || !isText(query, MAX_QUERY)) return null
  return { id, query, thumb: isText(thumb, MAX_THUMB) && THUMB_PATTERN.test(thumb) ? thumb : '' }
}

const readSteps = (value: unknown): string[] => (Array.isArray(value) ? keepSteps(value.filter((step) => isText(step, MAX_QUERY))) : [])

/** The entries stored as JSON; anything unreadable is left out. */
export function parseEntries(text: string | null): HistoryEntry[] {
  const stored = parseStored(text)?.entries
  if (!Array.isArray(stored)) return []
  return stored.flatMap((value) => readEntry(value) ?? []).slice(0, HISTORY_LIMIT)
}

export function stringifyEntries(entries: readonly HistoryEntry[]): string {
  return JSON.stringify({ version: VERSION, entries })
}

/** A tab's place stored as JSON, against the entries it can show; anything unreadable is no place. */
export function parsePlace(text: string | null, entries: readonly HistoryEntry[]): HistoryPlace {
  const stored = parseStored(text)
  const current = stored?.current
  return {
    current: typeof current === 'string' && entries.some((entry) => entry.id === current) ? current : null,
    back: readSteps(stored?.back),
    forward: readSteps(stored?.forward),
  }
}

export function stringifyPlace({ current, back, forward }: HistoryPlace): string {
  return JSON.stringify({ version: VERSION, current, back, forward })
}
