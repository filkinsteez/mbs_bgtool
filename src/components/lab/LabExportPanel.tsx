'use client'

import { useEffect, useState } from 'react'
import { useLabStore } from '@/core/lab/labStore'
import { getLabSource } from '@/core/lab/sourceCache'
import { exportLabPng } from '@/core/lab/render'
import { resolveBankCached } from './bankCache'
import { ExportResolutionControl } from '@/components/background/ExportResolutionControl'
import { inspect8kCapability } from '@/features/background-generator/capabilities'
import { exportMaterialAtTarget } from '@/features/background-generator/material/exportMaterial'
import { useBackgroundStore } from '@/features/background-generator/store'

// Export is WYSIWYG: the PNG is the preview's exact painter at full
// output size. Transparency isn't a toggle — zones set to "None"
// export as alpha, exactly as the checkerboard shows them.
async function renderCurrentPng(): Promise<Blob> {
  const recipe = useBackgroundStore.getState().recipe
  const state = useLabStore.getState()
  const protos = resolveBankCached(state.lab.mark.bank)
  if (recipe.mode === 'material') return exportMaterialAtTarget(recipe, protos)
  return exportLabPng(
    state.lab,
    getLabSource(),
    protos,
    recipe.transforms.background,
  )
}

export function LabExportPanel() {
  const recipe = useBackgroundStore((state) => state.recipe)
  const output = recipe.format
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  const flash = (msg: string) => {
    setNote(msg)
    setTimeout(() => setNote(''), 2500)
  }

  const doExport = async () => {
    setBusy(true)
    try {
      if (recipe.format.resolution === '8k') {
        const capability = inspect8kCapability(
          recipe.format.aspect,
          recipe.mode === 'material' ? recipe.material.id : 'clean',
        )
        if (!capability.supported) throw new Error(capability.reason ?? '8K unsupported')
      }
      setNote(`Rendering ${output.width} × ${output.height}…`)
      const blob = await renderCurrentPng()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      const treatment = recipe.mode === 'background' ? recipe.look.id : recipe.material.id
      a.download = `mbs-${recipe.mode}-${treatment}-${recipe.seed}.png`
      a.click()
      URL.revokeObjectURL(a.href)
      flash('PNG exported')
    } catch (error) {
      flash(error instanceof Error ? `Export failed: ${error.message}` : 'Export failed')
    } finally {
      setBusy(false)
    }
  }

  // dev capture hook — the REAL export as a dataURL for the devshot loop
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return
    const w = window as unknown as { __lbsLabExportPng?: () => Promise<string> }
    w.__lbsLabExportPng = async () => {
      const blob = await renderCurrentPng()
      return await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.readAsDataURL(blob)
      })
    }
    return () => {
      delete w.__lbsLabExportPng
    }
  }, [])

  return (
    <div className="panel-section" role="region" aria-labelledby="export-heading">
      <div className="panel-heading" id="export-heading">Export</div>
      <ExportResolutionControl />
      <button type="button" className="ctl-action primary" disabled={busy} onClick={doExport}>
        {busy ? 'Rendering…' : 'Export PNG'}
      </button>
      <div className="panel-note">
        Static PNG at exact output dimensions. Materials render offscreen at target size.
      </div>
      {note ? (
        <div className="panel-note" role="status" aria-live="polite">
          {note}
        </div>
      ) : null}
    </div>
  )
}
