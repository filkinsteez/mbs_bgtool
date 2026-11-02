'use client'

import '@/styles/dialkit.css'
import '@/styles/dial-panel.css'
import '@/styles/tool.css'
import { DialRoot, DialStore, useDialKitController } from 'dialkit'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { getPack } from '@/light'
import { buildScene } from './controls'
import { buildDialConfig, PACK_SWATCHES, PANEL_ID, PANEL_NAME, readToolState } from './dialConfig'
import { exportPng } from './exportImage'
import { panelAccessFor, usePanelAccess } from './panelAccess'
import { Preview } from './Preview'
import { fixLook, isMoodId, SEED_MAX, SEED_MIN, toQuery, type ToolState } from './state'

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

export function Tool({ initial }: { initial: ToolState }) {
  const [start] = useState(initial)
  const panelMood = useSyncExternalStore(subscribePanel, readPanelMood, readNoMood)
  const mood = isMoodId(panelMood) ? panelMood : start.mood
  const [exportStatus, setExportStatus] = useState<ExportStatus>('idle')
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
    () => buildScene(look, getPack(pack), seed, { intensity, softness, mood: moodControl }),
    [look, pack, seed, intensity, softness, moodControl],
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

  function handleAction(action: string) {
    switch (action) {
      case 'shuffle':
        setValue('seed', randomSeed(seed))
        return
      case 'export':
        void startExport()
        return
      default:
        return
    }
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

  return (
    <main className="tool">
      <Preview scene={scene} aspect={format} paused={exportStatus === 'busy'} />
      <aside ref={panelRef} className="tool-panel dial-column">
        <DialRoot mode="inline" theme="dark" productionEnabled />
      </aside>
    </main>
  )
}
