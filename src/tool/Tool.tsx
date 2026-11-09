'use client'

import '@/styles/dialkit.css'
import '@/styles/dial-panel.css'
import '@/styles/tool.css'
import { DialStore, useDialKitController } from 'dialkit'
import { useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { EXPORT_SIZES, getPack, type ExportAspect } from '@/light'
import { buildScene, clampDrag, keepsLine, toolControls, type LightDrag } from './controls'
import { buildDialConfig, PACK_DIAL_KEY, PANEL_ID, PANEL_LABELS, PANEL_NAME, readToolState, SEED_DIAL_KEY } from './dialConfig'
import { exportImage } from './exportImage'
import { FILTER_DIAL_KEY, readChoice, withFilter } from './filterControl'
import { panelAccessFor, usePanelAccess } from './panelAccess'
import { FilterPicker, FormatPicker, MoodPicker, PackPicker } from './panelPickers'
import { Preview } from './Preview'
import { EMPTY_SEED_HISTORY, recordSeedChange, stepBack, stepForward, type SeedStep } from './seedHistory'
import { isMoodId, parseQuery, randomSeed, readSeed, toQuery, type SearchParams } from './state'
import { ToolPanel } from './ToolPanel'
import { TypePreview } from './TypePreview'

const EXPORT_LABEL = 'Export'
const EXPORTING_LABEL = 'Exporting…'
const EXPORT_FAILED_LABEL = 'Export failed'
/** The tiles take the place of DialKit's selects, and Shuffle the place of the Seed slider. */
const MOOD_PATHS = ['mood']
const PACK_PATHS = [PACK_DIAL_KEY]
const SEED_PATHS = [SEED_DIAL_KEY]
const FILTER_PATHS = [FILTER_DIAL_KEY]
const FORMAT_PATHS = ['format']
/** Export keeps DialKit's button; its slot ends the Format card, which holds the Headline control. */
const EXPORT_PATHS = ['export']
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

/** The panel's sliders, tiles and buttons. */
const PANEL_CONTROL = '.dialkit-slider-wrapper, button, [role="button"]'

const inControl = (target: EventTarget | null) => target instanceof Element && target.closest(PANEL_CONTROL) !== null

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
  // The drag hint shows on every page load until the first drag or the first use of a control in the panel
  // (owner, 2026-11-06 and 2026-11-09).
  const [dragHint, setDragHint] = useState(true)
  const exportingRef = useRef(false)
  const panelRef = useRef<HTMLElement>(null)
  // The line, the seed and the mood as this component last set or saw them. The panel store calls back before React
  // renders, so these tell a change by the user from this component's own updates.
  const dragRef = useRef(start.drag)
  const seedRef = useRef(start.seed)
  const panelMoodRef = useRef(start.mood)
  const dragEndedRef = useRef(false)

  const exportLabel = exportStatus === 'busy' ? EXPORTING_LABEL : exportStatus === 'failed' ? EXPORT_FAILED_LABEL : EXPORT_LABEL
  const config = useMemo(() => buildDialConfig(start, exportLabel, chosenFilter), [start, exportLabel, chosenFilter])
  const dial = useDialKitController(PANEL_NAME, config, { id: PANEL_ID, onAction: (action) => handleAction(action) })
  const { setValue } = dial
  // The seed picks the look; the link's own look holds at the link's mood and seed.
  const state = { ...readToolState(dial.values, mood, start), drag }
  const query = toQuery(state)
  const { look, pack, seed, intensity, format, filter, strength } = state
  const scene = useMemo(() => {
    const aspect = frameAspect(format)
    const controls = toolControls(look, getPack(pack), seed, aspect, intensity, drag)
    return withFilter(buildScene(look, getPack(pack), seed, controls, aspect), { filter, strength })
  }, [look, pack, seed, intensity, drag, format, filter, strength])

  const access = useMemo(
    () => panelAccessFor(PANEL_ID, PANEL_NAME, config, { busy: exportStatus === 'busy' ? [EXPORTING_LABEL] : [], labels: PANEL_LABELS }),
    [config, exportStatus],
  )
  usePanelAccess(panelRef, access)

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

  /** The line being dragged; the scene sets the mood control from its start (`toolControls`). */
  function dragLine(line: LightDrag) {
    const next = clampDrag(line)
    if (next) placeDrag(next)
  }

  /** Double-click: the light goes back to the seed's own direction and reach. */
  function resetLight() {
    placeDrag(undefined)
  }

  function handleDragging(isDragging: boolean) {
    if (isDragging) setDragHint(false)
    else dragEndedRef.current = true
    setDragging(isDragging)
  }

  // A mood change clears the line.
  const onPanelChange = useEffectEvent(() => {
    const panelMoodNow = DialStore.getValue(PANEL_ID, 'mood')
    if (!isMoodId(panelMoodNow) || panelMoodNow === panelMoodRef.current) return
    panelMoodRef.current = panelMoodNow
    if (dragRef.current) placeDrag(undefined)
  })

  useEffect(() => DialStore.subscribe(PANEL_ID, () => onPanelChange()), [])

  // A new look, pack, seed or format keeps the line when the new scene's light can come near its start. A Contour light
  // whose new path passes far from the start would only reach an end of its track, so there the line goes.
  const sceneKey = `${look}|${pack}|${seed}|${format}`
  const sceneKeyRef = useRef(sceneKey)
  const followScene = useEffectEvent(() => {
    const current = dragRef.current
    if (current && !keepsLine(look, getPack(pack), seed, frameAspect(format), current.from)) placeDrag(undefined)
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
      const outcome = await exportImage(scene, pack, format, { intensity, drag })
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
        hint={dragHint}
        onDrag={dragLine}
        onDragging={handleDragging}
        onReset={resetLight}
      />
      <TypePreview shown={state.headline} />
      <aside
        ref={panelRef}
        className="tool-panel dial-column"
        onPointerDownCapture={(event) => {
          if (inControl(event.target)) setDragHint(false)
        }}
        onClickCapture={(event) => {
          if (inControl(event.target)) setDragHint(false)
        }}
        onKeyDown={(event) => {
          // A key that changes a control has its default prevented by now, by usePanelAccess's handler on this
          // element (sliders) or by TilePicker's own (tiles).
          if (event.defaultPrevented && inControl(event.target)) setDragHint(false)
        }}
      >
        <ToolPanel
          panelId={PANEL_ID}
          slots={[
            {
              paths: PACK_PATHS,
              node: <PackPicker value={pack} onChange={(next) => setValue(PACK_DIAL_KEY, next)} />,
              replace: true,
              card: 'colors',
              step: '1. Pick a color pack',
            },
            { paths: SEED_PATHS, node: shuffleButton, replace: true, card: 'colors' },
            { paths: MOOD_PATHS, node: <MoodPicker value={mood} onChange={(next) => setValue('mood', next)} />, replace: true, step: '2. Pick a mood' },
            {
              paths: FILTER_PATHS,
              node: <FilterPicker value={filter} onChange={(next) => setValue(FILTER_DIAL_KEY, next)} />,
              replace: true,
              card: 'filter',
              step: '3. Apply a filter',
            },
            {
              paths: FORMAT_PATHS,
              node: <FormatPicker value={format} onChange={(next) => setValue('format', next)} />,
              replace: true,
              card: 'format',
              step: '4. Export',
            },
            { paths: EXPORT_PATHS, node: null },
          ]}
          labels={PANEL_LABELS}
        />
      </aside>
    </main>
  )
}
