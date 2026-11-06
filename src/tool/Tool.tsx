'use client'

import '@/styles/dialkit.css'
import '@/styles/dial-panel.css'
import '@/styles/tool.css'
import { DialStore, useDialKitController } from 'dialkit'
import { useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import { EXPORT_SIZES, getPack, type ExportAspect } from '@/light'
import {
  buildScene,
  clampDrag,
  controlsForDrag,
  DEFAULT_CONTROLS,
  keepsLine,
  MOOD_DIAL_KEY,
  moodForPoint,
  moveDragWithMood,
  type LightDrag,
} from './controls'
import { buildDialConfig, PACK_DIAL_KEY, PANEL_ID, PANEL_NAME, readToolState, SEED_DIAL_KEY } from './dialConfig'
import { exportPng } from './exportImage'
import { FILTER_DIAL_KEY, readChoice, withFilter } from './filterControl'
import { panelAccessFor, usePanelAccess } from './panelAccess'
import { FilterPicker, FormatPicker, LookPicker, MoodPicker, PackPicker } from './panelPickers'
import { Preview } from './Preview'
import { EMPTY_SEED_HISTORY, recordSeedChange, stepBack, stepForward, type SeedStep } from './seedHistory'
import { clampUnit, fixLook, isMoodId, parseQuery, randomSeed, readSeed, toQuery, type SearchParams } from './state'
import { ToolPanel } from './ToolPanel'

const EXPORT_LABEL = 'Export PNG'
const EXPORTING_LABEL = 'Exporting…'
const EXPORT_FAILED_LABEL = 'Export failed'
/** The tiles take the place of DialKit's selects, and Shuffle the place of the Seed slider. */
const MOOD_PATHS = ['mood']
const LOOK_PATHS = ['look']
const PACK_PATHS = [PACK_DIAL_KEY]
const SEED_PATHS = [SEED_DIAL_KEY]
const FILTER_PATHS = [FILTER_DIAL_KEY]
const FORMAT_PATHS = ['format']
const URL_DELAY_MS = 200

type ExportStatus = 'idle' | 'busy' | 'failed'

const subscribePanel = (onChange: () => void) => DialStore.subscribe(PANEL_ID, onChange)
const readPanelMood = () => DialStore.getValue(PANEL_ID, 'mood')
const readPanelFilter = () => DialStore.getValue(PANEL_ID, FILTER_DIAL_KEY)
const readNoMood = () => undefined

const nextPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

/** Width / height of the format's frame; recipes with `compose` lay out the scene for it. */
const frameAspect = (format: ExportAspect) => EXPORT_SIZES[format].width / EXPORT_SIZES[format].height

const isTextField = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select') !== null)

export function Tool({ searchParams }: { searchParams: SearchParams }) {
  const [start] = useState(() => parseQuery(searchParams))
  const panelMood = useSyncExternalStore(subscribePanel, readPanelMood, readNoMood)
  const mood = isMoodId(panelMood) ? panelMood : start.mood
  const panelFilter = useSyncExternalStore(subscribePanel, readPanelFilter, readNoMood)
  const chosenFilter = readChoice(panelFilter ?? start.filter)
  const [exportStatus, setExportStatus] = useState<ExportStatus>('idle')
  const [seedHistory, setSeedHistory] = useState(EMPTY_SEED_HISTORY)
  const [drag, setDrag] = useState(start.drag)
  const [dragging, setDragging] = useState(false)
  const exportingRef = useRef(false)
  const panelRef = useRef<HTMLElement>(null)
  // The line, the mood control and the seed as this component last set or saw them. The panel store calls back
  // before React renders, so these tell a slider move by the user from this component's own updates.
  const dragRef = useRef(start.drag)
  const seedRef = useRef(start.seed)
  const moodValueRef = useRef<number | undefined>(start.moodControl)
  const panelMoodRef = useRef(start.mood)
  const dragEndedRef = useRef(false)

  const exportLabel = exportStatus === 'busy' ? EXPORTING_LABEL : exportStatus === 'failed' ? EXPORT_FAILED_LABEL : EXPORT_LABEL
  const config = useMemo(() => buildDialConfig(mood, start, exportLabel, chosenFilter), [mood, start, exportLabel, chosenFilter])
  const dial = useDialKitController(PANEL_NAME, config, { id: PANEL_ID, onAction: (action) => handleAction(action) })
  const { getValues, setValue } = dial
  const state = { ...readToolState(dial.values, mood), drag }
  const query = toQuery(state)
  const { look, pack, seed, intensity, softness, moodControl, format, filter, strength } = state
  const scene = useMemo(() => {
    const controls = { intensity, softness, mood: moodControl, drag }
    return withFilter(buildScene(look, getPack(pack), seed, controls, frameAspect(format)), { filter, strength })
  }, [look, pack, seed, intensity, softness, moodControl, drag, format, filter, strength])

  const access = useMemo(
    () => panelAccessFor(PANEL_ID, PANEL_NAME, config, { busy: exportStatus === 'busy' ? [EXPORTING_LABEL] : [] }),
    [config, exportStatus],
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
    const live = readToolState(getValues(), mood)
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
    const live = readToolState(values, panelMoodNow)
    placeDrag(moveDragWithMood(live.look, getPack(live.pack), live.seed, frameAspect(live.format), current, previous, next))
  })

  useEffect(() => DialStore.subscribe(PANEL_ID, () => onPanelChange()), [])

  // A new look, pack, seed or format keeps the line when the new scene's light can come near its start, and the mood
  // control moves to show the start in the new scene. A Contour light whose new path passes far from the start would
  // only reach an end of its track, so there the line goes and the mood control stays where it is.
  const sceneKey = `${look}|${pack}|${seed}|${format}`
  const sceneKeyRef = useRef(sceneKey)
  const followScene = useEffectEvent(() => {
    const current = dragRef.current
    if (!current) return
    const scenePack = getPack(pack)
    const aspect = frameAspect(format)
    if (!keepsLine(look, scenePack, seed, aspect, current.from)) {
      placeDrag(undefined)
      return
    }
    const next = moodForPoint(look, scenePack, seed, aspect, current.from)
    if (next !== null && next !== moodControl) setMoodControl(next)
  })

  useEffect(() => {
    if (sceneKeyRef.current === sceneKey) return
    sceneKeyRef.current = sceneKey
    followScene()
  }, [sceneKey])

  // Every Shuffle goes in the history, so Cmd/Ctrl+Z can return to the seed before it.
  const onSeedChange = useEffectEvent(() => {
    const previous = seedRef.current
    const next = readSeed(DialStore.getValue(PANEL_ID, SEED_DIAL_KEY), previous)
    if (next === previous) return
    seedRef.current = next
    setSeedHistory((history) => recordSeedChange(history, previous))
  })

  useEffect(() => DialStore.subscribe(PANEL_ID, () => onSeedChange()), [])

  function shuffle() {
    setValue(SEED_DIAL_KEY, randomSeed(seedRef.current))
  }

  /** Back and forward set the history themselves, so the seed they set doesn't go in again. */
  function travel(step: SeedStep | null): boolean {
    if (!step) return false
    setSeedHistory(step.history)
    seedRef.current = step.seed
    setValue(SEED_DIAL_KEY, step.seed)
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
      const outcome = await exportPng(scene, pack, format, { intensity, softness, mood: moodControl, drag })
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

  const shuffleButton = (
    <button type="button" className="dialkit-button" onClick={shuffle}>
      Shuffle
    </button>
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
        <ToolPanel
          panelId={PANEL_ID}
          slots={[
            { paths: MOOD_PATHS, node: <MoodPicker value={mood} pack={pack} onChange={(next) => setValue('mood', next)} />, replace: true },
            { paths: LOOK_PATHS, node: <LookPicker mood={mood} value={look} pack={pack} onChange={(next) => setValue('look', next)} />, replace: true },
            { paths: PACK_PATHS, node: <PackPicker value={pack} onChange={(next) => setValue(PACK_DIAL_KEY, next)} />, replace: true, card: 'colors' },
            { paths: SEED_PATHS, node: shuffleButton, replace: true, card: 'colors' },
            { paths: FILTER_PATHS, node: <FilterPicker value={filter} onChange={(next) => setValue(FILTER_DIAL_KEY, next)} />, replace: true, card: 'filter' },
            { paths: FORMAT_PATHS, node: <FormatPicker value={format} onChange={(next) => setValue('format', next)} />, replace: true },
          ]}
        />
      </aside>
    </main>
  )
}
