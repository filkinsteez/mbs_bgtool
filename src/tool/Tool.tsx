'use client'

import '@/styles/dialkit.css'
import '@/styles/dial-panel.css'
import '@/styles/tool.css'
import { DialStore, useDialKitController } from 'dialkit'
import { useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { EXPORT_SIZES, getPack, type ExportAspect } from '@/light'
import { buildScene } from './controls'
import { buildDialConfig, PACK_SWATCHES, PANEL_ID, PANEL_NAME, readToolState } from './dialConfig'
import { exportPng } from './exportImage'
import { panelAccessFor, usePanelAccess } from './panelAccess'
import { Preview } from './Preview'
import { EMPTY_SEED_HISTORY, recordShuffle, stepBack, stepForward, type SeedStep } from './seedHistory'
import { fixLook, isMoodId, SEED_MAX, SEED_MIN, toQuery, type ToolState } from './state'
import { ToolPanel } from './ToolPanel'

const EXPORT_LABEL = 'Export PNG'
const EXPORTING_LABEL = 'Exporting…'
const EXPORT_FAILED_LABEL = 'Export failed'
const URL_DELAY_MS = 200

type ExportStatus = 'idle' | 'busy' | 'failed'

const subscribePanel = (onChange: () => void) => DialStore.subscribe(PANEL_ID, onChange)
const readPanelMood = () => DialStore.getValue(PANEL_ID, 'mood')
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

export function Tool({ initial }: { initial: ToolState }) {
  const [start] = useState(initial)
  const panelMood = useSyncExternalStore(subscribePanel, readPanelMood, readNoMood)
  const mood = isMoodId(panelMood) ? panelMood : start.mood
  const [exportStatus, setExportStatus] = useState<ExportStatus>('idle')
  const [seedHistory, setSeedHistory] = useState(EMPTY_SEED_HISTORY)
  const exportingRef = useRef(false)
  const panelRef = useRef<HTMLElement>(null)

  const exportLabel = exportStatus === 'busy' ? EXPORTING_LABEL : exportStatus === 'failed' ? EXPORT_FAILED_LABEL : EXPORT_LABEL
  const config = useMemo(() => buildDialConfig(mood, start, exportLabel), [mood, start, exportLabel])
  const dial = useDialKitController(PANEL_NAME, config, { id: PANEL_ID, onAction: (action) => handleAction(action) })
  const { getValues, setValue } = dial
  const state = readToolState(dial.values, mood)
  const query = toQuery(state)
  const { look, pack, seed, intensity, softness, moodControl, format } = state
  const scene = useMemo(
    () => buildScene(look, getPack(pack), seed, { intensity, softness, mood: moodControl }, frameAspect(format)),
    [look, pack, seed, intensity, softness, moodControl, format],
  )

  const access = useMemo(
    () => panelAccessFor(PANEL_ID, PANEL_NAME, config, { busy: exportStatus === 'busy' ? [EXPORTING_LABEL] : [], swatches: PACK_SWATCHES }),
    [config, exportStatus],
  )
  usePanelAccess(panelRef, access)

  useEffect(() => {
    const current = getValues().look
    const fixed = fixLook(mood, current)
    if (current !== fixed) setValue('look', fixed)
  }, [mood, getValues, setValue])

  useEffect(() => {
    const timer = setTimeout(() => {
      if (window.location.search !== `?${query}`) window.history.replaceState(null, '', `?${query}`)
    }, URL_DELAY_MS)
    return () => clearTimeout(timer)
  }, [query])

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
      <Preview scene={scene} aspect={format} paused={exportStatus === 'busy'} />
      <aside ref={panelRef} className="tool-panel dial-column">
        <ToolPanel panelId={PANEL_ID} afterPath="seed" after={seedActions} />
      </aside>
    </main>
  )
}
