'use client'

import '@/styles/dialkit.css'
import '@/styles/dial-panel.css'
import '@/styles/tool.css'
import { DialStore, useDialKitController } from 'dialkit'
import { useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { EXPORT_SIZES, getPack, type ExportAspect, type PackId } from '@/light'
import { mixForPack } from '@/light/color/mix'
import { COLOR_DESIGN_PACK, withColorMix } from '@/light/color/stage'
import { buildScene, clampDrag, keepsLine, toolControls, type LightDrag } from './controls'
import { buildDialConfig, MIX_DIAL_KEY, mixPanelValue, PACK_DIAL_KEY, PANEL_ID, PANEL_NAME, panelLabels, readToolState, SEED_DIAL_KEY } from './dialConfig'
import { exportImage } from './exportImage'
import { FILTER_DIAL_KEY, readChoice, withFilter } from './filterControl'
import { panelAccessFor, usePanelAccess } from './panelAccess'
import { HistoryStrip } from './history/HistoryStrip'
import { applyPanelValues, panelValues } from './history/panelValues'
import { useHistory } from './history/useHistory'
import { MixControl } from './MixControl'
import { FilterPicker, FormatPicker, MoodPicker, PackPicker } from './panelPickers'
import { Preview } from './Preview'
import { customMix, isMoodId, parseQuery, randomSeed, sceneLook, toQuery, type SearchParams } from './state'
import { ToolPanel } from './ToolPanel'
import { usePictureMix } from './usePictureMix'

const EXPORT_LABEL = 'Export'
const EXPORTING_LABEL = 'Exporting…'
const EXPORT_FAILED_LABEL = 'Export failed'
/**
 * The tiles take the place of DialKit's selects, Shuffle the place of the Seed slider, and the color percentages the
 * place of the mix's text field.
 */
const MOOD_PATHS = ['mood']
const PACK_PATHS = [PACK_DIAL_KEY]
const MIX_PATHS = [MIX_DIAL_KEY]
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
  const [drag, setDrag] = useState(start.drag)
  const [dragging, setDragging] = useState(false)
  // The drag hint shows on every page load until the first drag or the first use of a control in the panel
  // (owner, 2026-11-06 and 2026-11-09).
  const [dragHint, setDragHint] = useState(true)
  const exportingRef = useRef(false)
  const panelRef = useRef<HTMLElement>(null)
  // The line and the mood as this component last set or saw them. The panel store calls back before React renders, so
  // these tell a change by the user from this component's own updates.
  const dragRef = useRef(start.drag)
  const panelMoodRef = useRef(start.mood)
  const dragEndedRef = useRef(false)

  const exportLabel = exportStatus === 'busy' ? EXPORTING_LABEL : exportStatus === 'failed' ? EXPORT_FAILED_LABEL : EXPORT_LABEL
  const config = useMemo(() => buildDialConfig(start, exportLabel, chosenFilter), [start, exportLabel, chosenFilter])
  const dial = useDialKitController(PANEL_NAME, config, { id: PANEL_ID, onAction: (action) => handleAction(action) })
  const { setValue } = dial
  const state = { ...readToolState(dial.values, mood), drag }
  const query = toQuery(state)
  const { look, pack, seed, format, filter, strength, mix } = state
  const drawn = sceneLook(state)
  // Every pack draws one design, and the color stage gives it the pack's colors and the mix (always on, owner 2026-11-11).
  const pictureMix = usePictureMix(mixPanelValue(mix))
  const shares = pictureMix.shares
  const scene = useMemo(() => {
    const aspect = frameAspect(format)
    const design = getPack(COLOR_DESIGN_PACK)
    const controls = toolControls(drawn, design, seed, aspect, drag)
    const built = buildScene(drawn, design, seed, controls, aspect)
    return withFilter(withColorMix(built, getPack(pack), { shares: shares.split(',').map(Number) }), { filter, strength })
  }, [drawn, pack, seed, drag, format, filter, strength, shares])

  const labels = useMemo(() => panelLabels(chosenFilter), [chosenFilter])
  const access = useMemo(
    () => panelAccessFor(PANEL_ID, PANEL_NAME, config, { busy: exportStatus === 'busy' ? [EXPORTING_LABEL] : [], labels }),
    [config, exportStatus, labels],
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
    if (current && !keepsLine(drawn, getPack(COLOR_DESIGN_PACK), seed, frameAspect(format), current.from)) placeDrag(undefined)
  })

  useEffect(() => {
    if (sceneKeyRef.current === sceneKey) return
    sceneKeyRef.current = sceneKey
    followScene()
  }, [sceneKey])

  /**
   * Shows a state from the history: the panel's values and the line it had, with no mood change clearing the line and
   * no scene change moving it. Returns the query the tool reads back for it.
   */
  function showState(target: string): string {
    const next = parseQuery(new URLSearchParams(target))
    panelMoodRef.current = next.mood
    sceneKeyRef.current = `${next.look}|${next.pack}|${next.seed}|${next.format}`
    placeDrag(next.drag)
    setDragHint(false)
    applyPanelValues(PANEL_ID, panelValues(buildDialConfig(next, exportLabel, next.filter)))
    return toQuery(next)
  }

  const history = useHistory({ query, scene, dragging, panelRef, show: showState })

  function shuffle() {
    setValue(SEED_DIAL_KEY, randomSeed(seed))
  }

  /** A new pack keeps Meta Blue's share, and its other colors share the rest evenly. */
  function choosePack(next: PackId) {
    if (next === pack) return
    DialStore.updateValues(PANEL_ID, { [PACK_DIAL_KEY]: next, [MIX_DIAL_KEY]: mixPanelValue(mixForPack(getPack(pack), mix, getPack(next))) })
  }

  const onUndoKey = useEffectEvent((event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== 'z' || isTextField(event.target)) return
    if (event.shiftKey ? history.redo() : history.undo()) event.preventDefault()
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
      const outcome = await exportImage(scene, pack, format, { drag, mix: customMix(state) })
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
      <div className="tool-view">
        <Preview
          scene={scene}
          aspect={format}
          paused={exportStatus === 'busy'}
          hint={dragHint}
          onDrag={dragLine}
          onDragging={handleDragging}
          onReset={resetLight}
          onSettle={history.onSettle}
        />
        <HistoryStrip history={history.history} onRestore={history.restore} onRemove={history.remove} />
      </div>
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
              node: <PackPicker value={pack} onChange={choosePack} />,
              replace: true,
              card: 'colors',
              step: '1. Pick a color pack',
            },
            {
              paths: MIX_PATHS,
              node: (
                <MixControl pack={getPack(pack)} mix={mix} onChange={(next) => setValue(MIX_DIAL_KEY, mixPanelValue(next))} onDragging={pictureMix.setDragging} />
              ),
              replace: true,
              card: 'colors',
            },
            {
              paths: MOOD_PATHS,
              node: <MoodPicker value={mood} onChange={(next) => setValue('mood', next)} />,
              replace: true,
              card: 'mood',
              step: '2. Pick a mood',
            },
            { paths: SEED_PATHS, node: shuffleButton, replace: true, card: 'mood' },
            {
              paths: FILTER_PATHS,
              node: <FilterPicker value={filter} onChange={(next) => setValue(FILTER_DIAL_KEY, next)} />,
              replace: true,
              card: 'filter',
              step: '3. Apply a filter',
            },
            { paths: FORMAT_PATHS, node: <FormatPicker value={format} onChange={(next) => setValue('format', next)} />, replace: true, step: '4. Export' },
          ]}
          labels={labels}
        />
      </aside>
    </main>
  )
}
