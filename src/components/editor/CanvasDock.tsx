'use client'

import {
  Circle,
  Image as ImageIcon,
  Magnet,
  MousePointer2,
  Pentagon,
  Shapes,
  Slash,
  Square,
  Star,
  Type as TypeIcon,
} from 'lucide-react'
import { useStore, type CanvasTool, type DesignTab } from '@/core/state/store'
import { metaUnitOutline } from '@/core/sheet/sheet'

// The CURVE icon previews the legacy parametric figure used by this editor
// tool; it is not the canonical company-brand symbol.
const META_ICON_D = (() => {
  const pts = metaUnitOutline()
  return (
    pts
      .map((p, i) => `${i ? 'L' : 'M'}${(12 + p.x * 9).toFixed(2)} ${(12 + p.y * 9).toFixed(2)}`)
      .join('') + 'Z'
  )
})()

function MetaIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={24}
      height={24}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d={META_ICON_D} />
    </svg>
  )
}

// The SHADER icon: a soft-edged dot — the gradient field in miniature.
function ShaderIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width={24} height={24} fill="none" {...props}>
      <defs>
        <radialGradient id="dock-shader-grad">
          <stop offset="45%" stopColor="currentColor" stopOpacity="1" />
          <stop offset="78%" stopColor="currentColor" stopOpacity="0.55" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="12" cy="12" r="10" fill="url(#dock-shader-grad)" />
    </svg>
  )
}

// Lucide has no blob — this one speaks its dialect (24 grid, 2px round stroke)
function BlobIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={24}
      height={24}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M12 3.5c2.9 0 5.6 1.2 7 3.6 1.4 2.4 1.7 5.6.2 7.9-1.5 2.3-4.4 5.5-7.6 5.5-3.2 0-6.1-2.3-7.3-5.1-1.2-2.8-.6-6.2 1.3-8.6C7.5 4.4 9.8 3.5 12 3.5Z" />
    </svg>
  )
}

// The dock — the framelab/tldraw pattern: one floating bar under the
// canvas that is BOTH the tool switcher and the navigation. Two distinct
// states, two distinct looks: the ARMED TOOL gets the filled chip
// (exactly one at all times — cursor, text, or a drawing tool) and an
// OPEN PANEL gets a dot under its section chip. They never share a look.
const SHAPE_TOOL_DEFS: {
  tool: 'rect' | 'ellipse' | 'poly' | 'star' | 'line' | 'blob'
  label: string
  key: string
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
}[] = [
  { tool: 'rect', label: 'Rectangle', key: 'R', icon: Square },
  { tool: 'ellipse', label: 'Ellipse', key: 'O', icon: Circle },
  { tool: 'poly', label: 'Polygon', key: 'P', icon: Pentagon },
  { tool: 'star', label: 'Star', key: 'S', icon: Star },
  { tool: 'line', label: 'Line', key: 'L', icon: Slash },
  { tool: 'blob', label: 'Blob', key: 'B', icon: BlobIcon },
]

const SECTION_DEFS: {
  tab: DesignTab
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  hint: string
}[] = [
  { tab: 'system', icon: MetaIcon, hint: 'Curve — the system and its grid' },
  { tab: 'field', icon: ShaderIcon, hint: 'Shader — the gradient renderer' },
]

const FILL_SWATCHES = ['#f4f2ed', '#141412', '#1649ff', '#00d8ff', '#ff2aa3', '#ff5a2f']

const isShapeToolId = (t: CanvasTool) => SHAPE_TOOL_DEFS.some((d) => d.tool === t)

export function CanvasDock() {
  const tool = useStore((s) => s.ui.tool)
  const designTab = useStore((s) => s.ui.designTab)
  const panelOpen = useStore((s) => s.ui.panelOpen)
  const snap = useStore((s) => s.ui.snap)
  const shapesFlyout = useStore((s) => s.ui.shapesFlyout)
  const selectedShapeIds = useStore((s) => s.ui.selectedShapeIds)
  const setUi = useStore((s) => s.setUi)

  const isShapeTool = isShapeToolId(tool)

  const openSection = (tab: DesignTab) => {
    if (panelOpen && designTab === tab) {
      setUi({ panelOpen: false })
      return
    }
    setUi({ designTab: tab, panelOpen: true, tool: 'select', shapesFlyout: false })
  }

  // The dock is ONE radio group: exactly one chip is lit, answering
  // "where am I" — an armed drawing tool, the text tool, the open
  // section, or the cursor. No dots, no second indicator of any kind.
  // 'layers' is not a dock chip (the rail is permanent), so selection
  // properties leave the cursor lit — which is the truth.
  const lit: 'cursor' | 'shapes' | DesignTab =
    isShapeTool || shapesFlyout
      ? 'shapes'
      : tool === 'text'
        ? 'type'
        : panelOpen && designTab !== 'layers'
          ? designTab
          : 'cursor'
  const chip = (active: boolean) => (active ? 'dock-chip active' : 'dock-chip')

  return (
    <div
      className="canvas-dock"
      role="toolbar"
      aria-label="Canvas tools"
      // a clicked chip must not keep the browser focus ring — it reads
      // as a second selection. Keyboard focus (tab) keeps its own style.
      onClickCapture={(e) => {
        const b = (e.target as HTMLElement).closest('button, label') as HTMLElement | null
        if (b) requestAnimationFrame(() => b.blur())
      }}
    >
      {shapesFlyout || isShapeTool ? (
        <div className="dock-flyout" role="group" aria-label="Drawing tools">
          {SHAPE_TOOL_DEFS.map((d) => {
            const Icon = d.icon
            return (
              <button
                key={d.tool}
                className={chip(tool === d.tool)}
                title={`${d.label} — drag on the canvas to draw (${d.key}); shift constrains`}
                aria-label={d.label}
                onClick={() => setUi({ tool: d.tool })}
              >
                <Icon />
              </button>
            )
          })}
          {selectedShapeIds.length ? (
            <span className="toolbar-swatches">
              {FILL_SWATCHES.map((hex) => (
                <button
                  key={hex}
                  className="layer-swatch"
                  style={{ background: hex }}
                  title="Fill selected shapes"
                  onClick={() => {
                    const st = useStore.getState()
                    st.apply({
                      shapes: st.project.shapes.map((s) =>
                        st.ui.selectedShapeIds.includes(s.id) ? { ...s, fill: hex } : s,
                      ),
                    })
                  }}
                />
              ))}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="dock-bar">
        <button
          className={chip(lit === 'cursor')}
          title="Cursor — select, move, marquee (V)"
          aria-label="Cursor"
          onClick={() => setUi({ tool: 'select', panelOpen: false, shapesFlyout: false })}
        >
          <MousePointer2 />
        </button>
        <button
          className={snap ? 'dock-chip toggled' : 'dock-chip'}
          title="Snap — on: objects lock to the grid; off: position anything anywhere"
          aria-label="Snap"
          aria-pressed={snap}
          onClick={() => setUi({ snap: !snap })}
        >
          <Magnet />
        </button>
        <span className="dock-divider" />
        {SECTION_DEFS.map((d) => {
          const Icon = d.icon
          return (
            <button
              key={d.tab}
              className={chip(lit === d.tab)}
              title={d.hint}
              aria-label={d.hint}
              onClick={() => openSection(d.tab)}
            >
              <Icon />
            </button>
          )
        })}
        <button
          className={chip(lit === 'shapes')}
          title="Shapes — the drawing tools"
          aria-label="Shapes"
          onClick={() => setUi({ shapesFlyout: !shapesFlyout })}
        >
          <Shapes />
        </button>
        <button
          className={chip(lit === 'type')}
          title="Text — click the canvas to place (T)"
          aria-label="Text"
          onClick={() => setUi({ tool: 'text', designTab: 'type', panelOpen: true, shapesFlyout: false })}
        >
          <TypeIcon />
        </button>
        <label className="dock-chip" title="Image — pick a file, or drop one on the canvas">
          <ImageIcon />
          <input
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              void (async () => {
                try {
                  const { importImageFile } = await import('@/core/images')
                  const { getDerived } = await import('@/core/pipeline')
                  const { placeImageAnchor } = await import('./ImagesLayer')
                  const src = await importImageFile(file)
                  const st = useStore.getState()
                  const grid = getDerived(st.project).grid
                  const W = st.project.artboard.width
                  const H = st.project.artboard.height
                  const id = `img-${Date.now().toString(36)}`
                  st.apply({
                    images: [
                      ...st.project.images,
                      { id, src, anchor: placeImageAnchor(grid, W * 0.3, H * 0.25) },
                    ],
                  })
                  st.setUi({
                    selectedImageIds: [id],
                    selectedBlockId: undefined,
                    selectedBlockIds: [],
                    selectedShapeIds: [],
                  })
                } catch {
                  // unreadable file — skip it
                }
              })()
            }}
          />
        </label>
      </div>
    </div>
  )
}
