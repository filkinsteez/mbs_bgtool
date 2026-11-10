import '@/styles/history.css'
import { memo, useId, useRef, type CSSProperties, type KeyboardEvent } from 'react'
import { EXPORT_SIZES, getPack } from '@/light'
import { MOOD_OPTIONS } from '../dialConfig'
import { FILTER_OPTIONS } from '../filterControl'
import { parseQuery } from '../state'
import { optionForKey } from '../TilePicker'
import type { History } from './historyModel'

const TITLE = 'History'

/** What a screen reader says for an entry: "Contour, Bold, Grain, 16:9, seed 15". */
function entryName(query: string): string {
  const state = parseQuery(new URLSearchParams(query))
  const mood = MOOD_OPTIONS.find((option) => option.value === state.mood)?.label ?? state.mood
  const filter = state.filter === 'none' ? [] : [FILTER_OPTIONS.find((option) => option.value === state.filter)?.label ?? state.filter]
  return [mood, getPack(state.pack).name, ...filter, state.format, `seed ${state.seed}`].join(', ')
}

function entryShape(query: string): CSSProperties {
  const { width, height } = EXPORT_SIZES[parseQuery(new URLSearchParams(query)).format]
  return { aspectRatio: `${width} / ${height}` }
}

interface HistoryStripProps {
  history: History
  onRestore: (id: string) => void
}

/**
 * The history under the preview: a small picture of each recent design, newest first, the shown one ringed. A radio
 * group like the panel's pickers: clicking a picture or moving to it with the arrow keys shows it, and Tab reaches the
 * shown one only.
 */
export const HistoryStrip = memo(function HistoryStrip({ history, onRestore }: HistoryStripProps) {
  const titleId = useId()
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const { entries } = history
  const shown = entries.findIndex((entry) => entry.id === history.current)
  const focusable = Math.max(shown, 0)

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = optionForKey(event.key, index, entries.length)
    if (next === null) return
    event.preventDefault()
    onRestore(entries[next].id)
    buttons.current[next]?.focus()
  }

  return (
    <section className="tool-history" aria-labelledby={titleId} data-empty={entries.length === 0 || undefined}>
      <h2 id={titleId} className="tool-history-title">
        {TITLE}
      </h2>
      <div className="tool-history-items" role="radiogroup" aria-labelledby={titleId}>
        {entries.map((entry, index) => (
          <button
            key={entry.id}
            ref={(element) => void (buttons.current[index] = element)}
            type="button"
            role="radio"
            className="tool-history-item"
            style={entryShape(entry.query)}
            aria-checked={index === shown}
            aria-label={entryName(entry.query)}
            tabIndex={index === focusable ? 0 : -1}
            onClick={() => onRestore(entry.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {entry.thumb && <span className="tool-history-picture" style={{ backgroundImage: `url(${entry.thumb})` }} />}
          </button>
        ))}
      </div>
    </section>
  )
})
