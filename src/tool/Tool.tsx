'use client'

import '@/styles/dialkit.css'
import '@/styles/dial-panel.css'
import '@/styles/tool.css'
import { DialStore, useDialKitController } from 'dialkit'
import { useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import { EXPORT_SIZES, getPack, type ExportAspect } from '@/light'
import { buildScene, controlsForPoint, DEFAULT_CONTROLS, MOOD_DIAL_KEY, moodForPoint, movePointWithMood, type LightPoint } from './controls'
import { buildDialConfig, PANEL_ID, PANEL_NAME, readToolState } from './dialConfig'
import { exportPng } from './exportImage'
import { FILTER_DIAL_KEY, isFilterOn, withFilter } from './filterControl'
import { panelAccessFor, usePanelAccess } from './panelAccess'
import { Preview } from './Preview'
import { EMPTY_SEED_HISTORY, recordShuffle, stepBack, stepForward, type SeedStep } from './seedHistory'
import { clampUnit, fixLook, isMoodId, parseQuery, SEED_MAX, SEED_MIN, toQuery, type SearchParams } from './state'
import { ToolPanel } from './ToolPanel'

const EXPORT_LABEL = 'Export PNG'
const EXPORTING_LABEL = 'Exporting…'
const EXPORT_FAILED_LABEL = 'Export failed'
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

export function Tool({ searchParams }: { searchParams: SearchParams }) {
  const [start] = useState(() => parseQuery(searchParams))
  const panelMood = useSyncExternalStore(subscribePanel, readPanelMood, readNoMood)
  const mood = isMoodId(panelMood) ? panelMood : start.mood
  const panelFilter = useSyncExternalStore(subscribePanel, readPanelFilter, readNoMood)
  const filterOn = isFilterOn(panelFilter ?? start.filter)
  const [exportStatus, setExportStatus] = useState<ExportStatus>('idle')
  const [seedHistory, setSeedHistory] = useState(EMPTY_SEED_HISTORY)
  const [point, setPoint] = useState(start.point)
  const [pressed, setPressed] = useState(false)
  const exportingRef = useRef(false)
  const panelRef = useRef<HTMLElement>(null)
  // The point and the mood control as this component last set or saw them. The panel store calls back
  // before React renders, so these tell a slider move by the user from the drag's own updates.
  const pointRef = useRef(start.point)
  const moodValueRef = useRef<number | undefined>(start.moodControl)
  const panelMoodRef = useRef(start.mood)
  const pressEndedRef = useRef(false)

  const exportLabel = exportStatus === 'busy' ? EXPORTING_LABEL : exportStatus === 'failed' ? EXPORT_FAILED_LABEL : EXPORT_LABEL
  const config = useMemo(() => buildDialConfig(mood, start, exportLabel, filterOn), [mood, start, exportLabel, filterOn])
  const dial = useDialKitController(PANEL_NAME, config, { id: PANEL_ID, onAction: (action) => handleAction(action) })
  const { getValues, setValue } = dial
  const state = { ...readToolState(dial.values, mood), point }
  const query = toQuery(state)
  const { look, pack, seed, intensity, softness, moodControl, format, filter, strength } = state
  const scene = useMemo(
    () => withFilter(buildScene(look, getPack(pack), seed, { intensity, softness, mood: moodControl, point }, frameAspect(format)), { filter, strength }),
    [look, pack, seed, intensity, softness, moodControl, point, format, filter, strength],
  )

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

  // The URL changes when a drag ends, not while the pointer is down.
  useEffect(() => {
    if (pressed) return
    const write = () => {
      if (window.location.search !== `?${query}`) window.history.replaceState(null, '', `?${query}`)
    }
    if (pressEndedRef.current) {
      pressEndedRef.current = false
      write()
      return
    }
    const timer = setTimeout(write, URL_DELAY_MS)
    return () => clearTimeout(timer)
  }, [query, pressed])

  function placePoint(next: LightPoint | undefined) {
    pointRef.current = next
    setPoint(next)
  }

  function setMoodControl(value: number) {
    moodValueRef.current = value
    setValue(MOOD_DIAL_KEY[mood], value)
  }

  /** Puts the light at the pointer, and the mood control where it shows that place (the Horizon at its height). */
  function dragLightTo(raw: LightPoint) {
    const live = readToolState(getValues(), mood)
    const controls = { intensity: live.intensity, softness: live.softness, mood: live.moodControl }
    const next = controlsForPoint(live.look, getPack(live.pack), live.seed, controls, frameAspect(live.format), raw)
    // One render for both: the panel store's update and the point's would otherwise render one after the other.
    flushSync(() => {
      placePoint(next.point)
      if (next.mood !== live.moodControl) setMoodControl(next.mood)
    })
  }

  /** Double-click: the light goes back to the seed's own place. */
  function resetLight() {
    placePoint(undefined)
    setMoodControl(DEFAULT_CONTROLS.mood)
  }

  function handlePress(isPressed: boolean) {
    if (!isPressed) pressEndedRef.current = true
    setPressed(isPressed)
  }

  // Moving the mood slider after a drag carries the light on from where the drag left it. A mood change
  // clears the point, as it resets the mood control.
  const onPanelChange = useEffectEvent(() => {
    const values = DialStore.getValues(PANEL_ID)
    const panelMoodNow = values.mood
    if (!isMoodId(panelMoodNow)) return
    if (panelMoodNow !== panelMoodRef.current) {
      panelMoodRef.current = panelMoodNow
      moodValueRef.current = undefined
      if (pointRef.current) placePoint(undefined)
      return
    }
    const raw = values[MOOD_DIAL_KEY[panelMoodNow]]
    if (raw === undefined) return
    const next = clampUnit(raw, DEFAULT_CONTROLS.mood)
    const previous = moodValueRef.current
    moodValueRef.current = next
    const current = pointRef.current
    if (previous === undefined || previous === next || !current) return
    const live = readToolState(values, panelMoodNow)
    placePoint(movePointWithMood(live.look, getPack(live.pack), live.seed, frameAspect(live.format), current, previous, next))
  })

  useEffect(() => DialStore.subscribe(PANEL_ID, () => onPanelChange()), [])

  // A new look, pack, seed or format keeps the light where the user put it; the mood control moves to show
  // that place in the new scene.
  const sceneKey = `${look}|${pack}|${seed}|${format}`
  const sceneKeyRef = useRef(sceneKey)
  const followScene = useEffectEvent(() => {
    const current = pointRef.current
    if (!current) return
    const next = moodForPoint(look, getPack(pack), seed, frameAspect(format), current)
    if (next !== null && next !== moodControl) setMoodControl(next)
  })

  useEffect(() => {
    if (sceneKeyRef.current === sceneKey) return
    sceneKeyRef.current = sceneKey
    followScene()
  }, [sceneKey])

  function shuffle() {
    setSeedHistory(recordShuffle(seedHistory, seed))
    setValue('seed', randomSeed(seed))
  }

  function travel(step: SeedStep | null): boolean {
    if (!step) return false
    setSeedHistory(step.history)
    setValue('seed', step.seed)
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
    <div className="tool-seed-actions">
      <button
        type="button"
        className="dialkit-button"
        disabled={seedHistory.back.length === 0}
        aria-keyshortcuts="Meta+Z Control+Z"
        onClick={() => travel(stepBack(seedHistory, seed))}
      >
        Back
      </button>
      <button type="button" className="dialkit-button" onClick={shuffle}>
        Shuffle
      </button>
    </div>
  )

  return (
    <main className="tool">
      <Preview
        scene={scene}
        aspect={format}
        paused={exportStatus === 'busy'}
        onPoint={dragLightTo}
        onPress={handlePress}
        onReset={resetLight}
      />
      <aside ref={panelRef} className="tool-panel dial-column">
        <ToolPanel panelId={PANEL_ID} afterPath="seed" after={seedActions} />
      </aside>
    </main>
  )
}
