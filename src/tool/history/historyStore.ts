import { parseQuery, toQuery } from '../state'
import {
  EMPTY_HISTORY,
  mapQueries,
  parseEntries,
  parsePlace,
  stringifyEntries,
  stringifyPlace,
  withEntries,
  type History,
  type HistoryEntry,
} from './historyModel'

/** The entries, in localStorage: every tab shows the same ones, and they outlast the page. */
const ENTRIES_KEY = 'mbs-bgtool:history'
/** This tab's shown entry and steps, in sessionStorage: a reload keeps them, a new tab starts without. */
const PLACE_KEY = 'mbs-bgtool:history-place'

let snapshot: History | null = null
const listeners = new Set<() => void>()

/** A stored query in the form the tool writes now, so a state from an older version matches the same state shown now. */
const currentForm = (query: string) => toQuery(parseQuery(new URLSearchParams(query)))

function read(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key)
  } catch {
    return null
  }
}

function write(storage: () => Storage, key: string, value: string): void {
  try {
    storage().setItem(key, value)
  } catch (error) {
    console.warn('History could not be stored', error)
  }
}

const local = () => window.localStorage
const session = () => window.sessionStorage

const readEntries = (text: string | null): HistoryEntry[] => parseEntries(text).map((entry) => ({ ...entry, query: currentForm(entry.query) }))

function load(): History {
  const entries = parseEntries(read(local, ENTRIES_KEY))
  return mapQueries({ entries, ...parsePlace(read(session, PLACE_KEY), entries) }, currentForm)
}

function publish(next: History): void {
  snapshot = next
  listeners.forEach((listener) => listener())
}

/** The history, read from storage on first use in the browser. */
export function readHistory(): History {
  snapshot ??= load()
  return snapshot
}

/** The server render has no history; the browser reads it after hydrating. */
export const readServerHistory = (): History => EMPTY_HISTORY

/** Sets the history and stores it; if the browser refuses (storage full or off), it lasts until the page closes. */
export function writeHistory(next: History): void {
  const previous = readHistory()
  if (next === previous) return
  if (next.entries !== previous.entries) write(local, ENTRIES_KEY, stringifyEntries(next.entries))
  write(session, PLACE_KEY, stringifyPlace(next))
  publish(next)
}

/** Another tab changed the entries. */
function handleStorage(event: StorageEvent): void {
  if (event.storageArea !== window.localStorage || (event.key !== ENTRIES_KEY && event.key !== null)) return
  publish(withEntries(readHistory(), readEntries(event.key === null ? null : event.newValue)))
}

export function subscribeHistory(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener('storage', handleStorage)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) window.removeEventListener('storage', handleStorage)
  }
}
