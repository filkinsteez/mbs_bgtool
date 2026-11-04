'use client'

import '@/styles/dialkit.css'
import '@/styles/dial-panel.css'
import '@/styles/tool.css'
import { DialStore, useDialKitController } from 'dialkit'
import { useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { flushSync } from 'react-dom'
import { EXPORT_SIZES, getPack, type ExportAspect } from '@/light'
import {
  buildScene,
  clampDrag,
  controlsForDrag,
  DEFAULT_CONTROLS,
  MOOD_DIAL_KEY,
  moodForPoint,
  moveDragWithMood,
  type LightDrag,
} from './controls'
import { buildDialConfig, PANEL_ID, PANEL_NAME, readToolState } from './dialConfig'
import { exportPng } from './exportImage'
import { FILTER_DIAL_KEY, isFilterOn, withFilter } from './filterControl'
import { panelAccessFor, usePanelAccess } from './panelAccess'
import { Preview } from './Preview'
import { EMPTY_SEED_HISTORY, recordSeedChange, stepBack, stepForward, type SeedStep } from './seedHistory'
import { clampSeed, clampUnit, fixLook, isMoodId, parseQuery, SEED_MAX, SEED_MIN, toQuery, type SearchParams } from './state'
import { ToolPanel } from './ToolPanel'

const EXPORT_LABEL = 'Export PNG'
const EXPORTING_LABEL = 'Exporting…'
const EXPORT_FAILED_LABEL = 'Export failed'
const BACK_LABEL = 'Back'
const URL_DELAY_MS = 200

type ExportStatus = 'idle' | 'busy' | 'failed'

const subscribePanel = (onChange: () => void) => DialStore.subscribe(PANEL_ID, onChange)
const readPanelMood = () => DialStore.getValue(PANEL_ID, 'mood')
const readPanelFilter = () => DialStore.getValue(PANEL_ID, FILTER_DIAL_KEY)
const readNoMood = () => undefined

const nextPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

function randomSeed(current: number): number {
  let next = current
  while (next === current) next = SEED_MIN + Math.floor(Math.random() * (SEED_MAX - SEED_MIN + 1))
  return next
}

/** Width / height of the format's frame; recipes with `compose` lay out the scene for it. */
const frameAspect = (format: ExportAspect) => EXPORT_SIZES[format].width / EXPORT_SIZES[format].height

const isTextField = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select') !== null)

const SEED_FIELD_ID = 'tool-seed'

/** Back with nothing to go back to is marked off by the panel (aria-disabled, dimmed) but stays focusable; it isn't busy. */
const OFF_BUTTON: CSSProperties = { cursor: 'default' }

/**
 * The seed as a typed number. Enter or leaving the field applies what was typed, Escape puts the current seed back,
 * and the up and down arrows step it by 1 (10 with Shift).
 */
function SeedField({ seed, onChange }: { seed: number; onChange: (seed: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const typed = draft !== null && draft !== '' ? Number(draft) : null
  const apply = () => {
    setDraft(null)
    if (typed !== null) onChange(typed)
  }
  return (
    <div className="dialkit-text-control">
      <label className="dialkit-text-label" htmlFor={SEED_FIELD_ID}>
        Seed
      </label>
      <input
        id={SEED_FIELD_ID}
        className="dialkit-text-input"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        maxLength={String(SEED_MAX).length}
        value={draft ?? String(seed)}
        onChange={(event) => setDraft(event.target.value.replace(/[^0-9]/g, ''))}
        onBlur={apply}
        onKeyDown={(event) => {
          if (event.key === 'Enter') apply()
          else if (event.key === 'Escape') setDraft(null)
          else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            setDraft(null)
            onChange((typed ?? seed) + (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 10 : 1))
          }
        }}
      />
    </div>
  )
}

export function Tool({ searchParams }: { searchParams: SearchParams }) {
  const [start] = useState(() => parseQuery(searchParams))
  const panelMood = useSyncExternalStore(subscribePanel, readPanelMood, readNoMood)
  const mood = isMoodId(panelMood) ? panelMood : start.mood
  const panelFilter = useSyncExternalStore(subscribePanel, readPanelFilter, readNoMood)
  const filterOn = isFilterOn(panelFilter ?? start.filter)
  const [exportStatus, setExportStatus] = useState<ExportStatus>('idle')
  const [seedHistory, setSeedHistory] = useState(EMPTY_SEED_HISTORY)
  const [seed, setSeed] = useState(start.seed)
  const [drag, setDrag] = useState(start.drag)
  const [dragging, setDragging] = useState(false)
  const exportingRef = useRef(false)
  const panelRef = useRef<HTMLElement>(null)
  // The line and the mood control as this component last set or saw them. The panel store calls back
  // before React renders, so these tell a slider move by the user from the drag's own updates.
  const dragRef = useRef(start.drag)
  const seedRef = useRef(start.seed)
  const moodValueRef = useRef<number | undefined>(start.moodControl)
  const panelMoodRef = useRef(start.mood)
  const dragEndedRef = useRef(false)

  const exportLabel = exportStatus === 'busy' ? EXPORTING_LABEL : exportStatus === 'failed' ? EXPORT_FAILED_LABEL : EXPORT_LABEL
  const config = useMemo(() => buildDialConfig(mood, start, exportLabel, filterOn), [mood, start, exportLabel, filterOn])
  const dial = useDialKitController(PANEL_NAME, config, { id: PANEL_ID, onAction: (action) => handleAction(action) })
  const { getValues, setValue } = dial
  const state = { ...readToolState(dial.values, mood, seed), drag }
  const query = toQuery(state)
  const { look, pack, intensity, softness, moodControl, format, filter, strength } = state
  const scene = useMemo(() => {
    const controls = { intensity, softness, mood: moodControl, drag }
    return withFilter(buildScene(look, getPack(pack), seed, controls, frameAspect(format)), { filter, strength })
  }, [look, pack, seed, intensity, softness, moodControl, drag, format, filter, strength])

  // A disabled button would drop keyboard focus when Back runs out, so Back is only marked off.
  const backOff = seedHistory.back.length === 0
  const access = useMemo(
    () => panelAccessFor(PANEL_ID, PANEL_NAME, config, { busy: [...(exportStatus === 'busy' ? [EXPORTING_LABEL] : []), ...(backOff ? [BACK_LABEL] : [])] }),
    [config, exportStatus, backOff],
  )
  usePanelAccess(panelRef, access)

  useEffect(() => {
    const current = getValues().look
    const fixed = fixLook(mood, current)
    if (current !== fixed) setValue('look', fixed)
  }, [mood, getValues, setValue])

  // The URL changes when a drag ends, not while it runs.
  useEffect(() => {
    if (dragging) return
    const write = () => {
      if (window.location.search !== `?${query}`) window.history.replaceState(null, '', `?${query}`)
    }
    if (dragEndedRef.current) {
      dragEndedRef.current = false
      write()
      return
    }
    const timer = setTimeout(write, URL_DELAY_MS)
    return () => clearTimeout(timer)
  }, [query, dragging])

  function placeDrag(next: LightDrag | undefined) {
    dragRef.current = next
    setDrag(next)
  }

  function setMoodControl(value: number) {
    moodValueRef.current = value
    setValue(MOOD_DIAL_KEY[mood], value)
  }

  /** The line being dragged, and the mood control set from its start (the Horizon at the start's height). */
  function dragLine(line: LightDrag) {
    const next = clampDrag(line)
    if (!next) return
    const live = readToolState(getValues(), mood, seedRef.current)
    const controls = { intensity: live.intensity, softness: live.softness, mood: live.moodControl }
    const updated = controlsForDrag(live.look, getPack(live.pack), live.seed, controls, frameAspect(live.format), next)
    // One render for both: the panel store's update and the line's would otherwise render one after the other.
    flushSync(() => {
      placeDrag(updated.drag)
      if (updated.mood !== live.moodControl) setMoodControl(updated.mood)
    })
  }

  /** Double-click: the light goes back to the seed's own direction and reach. */
  function resetLight() {
    placeDrag(undefined)
    setMoodControl(DEFAULT_CONTROLS.mood)
  }

  function handleDragging(isDragging: boolean) {
    if (!isDragging) dragEndedRef.current = true
    setDragging(isDragging)
  }

  // Moving the mood slider after a drag moves the whole line by as much as the look's light moves, so the
  // light carries on from where the drag left it with the same direction and reach. A mood change clears
  // the line, as it resets the mood control.
  const onPanelChange = useEffectEvent(() => {
    const values = DialStore.getValues(PANEL_ID)
    const panelMoodNow = values.mood
    if (!isMoodId(panelMoodNow)) return
    if (panelMoodNow !== panelMoodRef.current) {
      panelMoodRef.current = panelMoodNow
      moodValueRef.current = undefined
      if (dragRef.current) placeDrag(undefined)
      return
    }
    const raw = values[MOOD_DIAL_KEY[panelMoodNow]]
    if (raw === undefined) return
    const next = clampUnit(raw, DEFAULT_CONTROLS.mood)
    const previous = moodValueRef.current
    moodValueRef.current = next
    const current = dragRef.current
    if (previous === undefined || previous === next || !current) return
    const live = readToolState(values, panelMoodNow, seedRef.current)
    placeDrag(moveDragWithMood(live.look, getPack(live.pack), live.seed, frameAspect(live.format), current, previous, next))
  })

  useEffect(() => DialStore.subscribe(PANEL_ID, () => onPanelChange()), [])

  // A new look, pack, seed or format keeps the line; the mood control moves to show its start in the new scene.
  const sceneKey = `${look}|${pack}|${seed}|${format}`
  const sceneKeyRef = useRef(sceneKey)
  const followScene = useEffectEvent(() => {
    const current = dragRef.current
    if (!current) return
    const next = moodForPoint(look, getPack(pack), seed, frameAspect(format), current.from)
    if (next !== null && next !== moodControl) setMoodControl(next)
  })

  useEffect(() => {
    if (sceneKeyRef.current === sceneKey) return
    sceneKeyRef.current = sceneKey
    followScene()
  }, [sceneKey])

  function placeSeed(value: number) {
    seedRef.current = value
    setSeed(value)
  }

  /** Every seed change (Shuffle, a typed seed, an arrow step) goes in the history, so Back can return to it. */
  function changeSeed(next: number) {
    const value = clampSeed(next, seed)
    if (value === seed) return
    setSeedHistory(recordSeedChange(seedHistory, seed))
    placeSeed(value)
  }

  function shuffle() {
    changeSeed(randomSeed(seed))
  }

  function travel(step: SeedStep | null): boolean {
    if (!step) return false
    setSeedHistory(step.history)
    placeSeed(step.seed)
    return true
  }

  const onUndoKey = useEffectEvent((event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== 'z' || isTextField(event.target)) return
    const step = event.shiftKey ? stepForward(seedHistory, seed) : stepBack(seedHistory, seed)
    if (travel(step)) event.preventDefault()
  })

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onUndoKey(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  function handleAction(action: string) {
    if (action === 'export') void startExport()
  }

  async function startExport() {
    if (exportingRef.current) return
    exportingRef.current = true
    setExportStatus('busy')
    try {
      await nextPaint()
      const outcome = await exportPng(scene, pack, format)
      console.info('Exported', outcome)
      setExportStatus('idle')
    } catch (error) {
      console.error('Export failed', error)
      setExportStatus('failed')
      setTimeout(() => setExportStatus((status) => (status === 'failed' ? 'idle' : status)), 3000)
    } finally {
      exportingRef.current = false
    }
  }

  const seedActions = (
    <>
      <SeedField seed={seed} onChange={changeSeed} />
      <div className="tool-seed-actions">
        <button
          type="button"
          className="dialkit-button"
          style={backOff ? OFF_BUTTON : undefined}
          aria-keyshortcuts="Meta+Z Control+Z"
          onClick={() => travel(stepBack(seedHistory, seed))}
        >
          {BACK_LABEL}
        </button>
        <button type="button" className="dialkit-button" onClick={shuffle}>
          Shuffle
        </button>
      </div>
    </>
  )

  return (
    <main className="tool">
      <Preview
        scene={scene}
        aspect={format}
        paused={exportStatus === 'busy'}
        onDrag={dragLine}
        onDragging={handleDragging}
        onReset={resetLight}
      />
      <aside ref={panelRef} className="tool-panel dial-column">
        <ToolPanel panelId={PANEL_ID} afterPath={MOOD_DIAL_KEY[mood]} after={seedActions} />
      </aside>
    </main>
  )
}
