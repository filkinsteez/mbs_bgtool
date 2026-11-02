import { useDialKitController, type DialConfig } from 'dialkit'
import { useEffect, useEffectEvent, useMemo, useRef, useState, type RefObject } from 'react'
import { buildMask } from '@/light/audit/mask'
import { defaultParams } from '@/light/engine/resolve'
import { RECIPE_LIST, getRecipe } from '@/light/recipes'
import type { IgnoreRect } from '@/light/references'
import { isRecipeId, type LensSettings, type OutputSettings, type ParamValue, type Preset, type RecipeId } from '@/light/scene'
import { mergeAccess, panelAccessFor, usePanelAccess } from '@/tool/panelAccess'
import { DiffWorker, type DiffResult } from './diff'
import { errorMessage, useFlash, useLightCanvas } from './hooks'
import { presetToSave, sceneKeySteps } from './sceneConfig'
import { useScenePanel } from './useScenePanel'
import styles from './lab.module.css'

const REFERENCE_PANEL = 'lab-reference'

/** One entry of GET /api/light-preset. */
interface ReferenceInfo {
  id: string
  mood: string
  title: string
  recipe: RecipeId | null
  width: number
  height: number
  ignore: IgnoreRect[]
  cornerRadius: number
  hasPreset: boolean
}

interface TargetImage {
  /** Changes on every load, so diff results for an older load can be told apart. */
  key: number
  width: number
  height: number
  image: ImageData
  mask: Uint8Array
}

interface Loaded {
  reference: ReferenceInfo
  target: TargetImage
  file: Preset
  /** The Preset panel's DialKit id. */
  panelId: string
}

interface ViewSettings {
  diff: boolean
  blink: boolean
  supersample: 1 | 2
}

let loadCount = 0

/**
 * The Preset panel id last used and how many reference loads this page has
 * made. A reference picked in the panel gets a new id, so it starts from its
 * file; coming back from the Packs tab reuses the id and finds the edits.
 */
let lastPresetPanel: { referenceId: string; panelId: string } | null = null
let presetLoads = 0

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function responseError(response: Response): Promise<Error> {
  const text = await response.text()
  return new Error(text || `${response.status} ${response.statusText}`)
}

async function fetchReferences(): Promise<ReferenceInfo[]> {
  const response = await fetch('/api/light-preset', { cache: 'no-store' })
  if (!response.ok) throw await responseError(response)
  const body = (await response.json()) as { references: ReferenceInfo[] }
  return body.references
}

function startingPreset(reference: ReferenceInfo): Preset {
  const recipe = getRecipe(reference.recipe ?? RECIPE_LIST[0].id)
  return {
    id: `ref-${reference.id}`,
    referenceId: reference.id,
    scene: { recipe: recipe.id, seed: 1, colors: [...recipe.defaultColors], params: defaultParams(recipe), lens: {}, output: {} },
  }
}

/** Fields of the wrong type are replaced; everything else is kept as written, so saving it back gives the same file. */
function readPreset(raw: unknown, reference: ReferenceInfo): Preset {
  const scene = isRecord(raw) ? raw.scene : undefined
  if (!isRecord(raw) || !isRecord(scene)) throw new Error(`The preset for ${reference.id} has no scene.`)
  if (typeof scene.recipe !== 'string' || !isRecipeId(scene.recipe)) {
    throw new Error(`The preset for ${reference.id} names an unknown recipe: ${String(scene.recipe)}`)
  }
  return {
    id: typeof raw.id === 'string' && raw.id !== '' ? raw.id : `ref-${reference.id}`,
    referenceId: reference.id,
    scene: {
      recipe: scene.recipe,
      seed: typeof scene.seed === 'number' && Number.isFinite(scene.seed) ? scene.seed : 1,
      colors: Array.isArray(scene.colors) ? scene.colors.filter((color): color is string => typeof color === 'string') : [],
      params: isRecord(scene.params) ? (scene.params as Record<string, ParamValue>) : {},
      lens: isRecord(scene.lens) ? (scene.lens as Partial<LensSettings>) : {},
      output: isRecord(scene.output) ? (scene.output as Partial<OutputSettings>) : {},
    },
  }
}

async function fetchPreset(reference: ReferenceInfo): Promise<Preset> {
  if (!reference.hasPreset) return startingPreset(reference)
  const response = await fetch(`/api/light-preset?id=${encodeURIComponent(reference.id)}`, { cache: 'no-store' })
  if (response.status === 404) return startingPreset(reference)
  if (!response.ok) throw await responseError(response)
  return readPreset(await response.json(), reference)
}

async function fetchTarget(reference: ReferenceInfo): Promise<TargetImage> {
  const response = await fetch(`/api/light-preset/target?id=${encodeURIComponent(reference.id)}`, { cache: 'no-store' })
  if (!response.ok) throw await responseError(response)
  const bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
  try {
    const { width, height } = bitmap
    const context = new OffscreenCanvas(width, height).getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })
    if (!context) throw new Error('2D canvas is not available.')
    context.drawImage(bitmap, 0, 0)
    return {
      key: ++loadCount,
      width,
      height,
      image: context.getImageData(0, 0, width, height, { colorSpace: 'srgb' }),
      mask: buildMask(width, height, reference.ignore, reference.cornerRadius),
    }
  } finally {
    bitmap.close()
  }
}

/** Key order of the preset files: id, referenceId, scene{recipe, seed, colors, params, lens, output}. */
function orderedPreset(preset: Preset): Preset {
  const { scene } = preset
  return {
    id: preset.id,
    referenceId: preset.referenceId,
    scene: { recipe: scene.recipe, seed: scene.seed, colors: scene.colors, params: scene.params, lens: scene.lens, output: scene.output },
  }
}

function drawImage(canvas: HTMLCanvasElement | null, image: ImageData) {
  if (!canvas) return
  canvas.width = image.width
  canvas.height = image.height
  canvas.getContext('2d', { colorSpace: 'srgb' })?.putImageData(image, 0, 0)
}

function MessageStage({ message }: { message: string | null }) {
  return (
    <div className={styles.stage}>
      <div className={styles.panel}>{message ? <p className={styles.message}>{message}</p> : null}</div>
      <div className={styles.panel} />
    </div>
  )
}

export function ReferencesView({ panelRoot }: { panelRoot: RefObject<HTMLElement | null> }) {
  const [references, setReferences] = useState<ReferenceInfo[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchReferences().then(
      (list) => {
        if (cancelled) return
        if (list.length > 0) setReferences(list)
        else setProblem('No reference images found.')
      },
      (cause: unknown) => {
        if (!cancelled) setProblem(errorMessage(cause))
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  if (!references) return <MessageStage message={problem} />
  return (
    <ReferenceEditor
      references={references}
      panelRoot={panelRoot}
      onSaved={(id) => setReferences((list) => list?.map((reference) => (reference.id === id ? { ...reference, hasPreset: true } : reference)) ?? list)}
    />
  )
}

function ReferenceEditor({
  references,
  panelRoot,
  onSaved,
}: {
  references: ReferenceInfo[]
  panelRoot: RefObject<HTMLElement | null>
  onSaved: (referenceId: string) => void
}) {
  const flash = useFlash()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const firstLoad = useRef(true)
  const presetToCopy = useRef<Preset | null>(null)

  const config = useMemo<DialConfig>(
    () => ({
      reference: { type: 'select', options: references.map((reference) => ({ value: reference.id, label: reference.id })), default: references[0].id },
      diff: false,
      blink: false,
      supersample: false,
      copyPreset: { type: 'action', label: flash.label('copy', 'Copy preset JSON') },
      savePreset: { type: 'action', label: flash.label('save', 'Save preset') },
    }),
    [references, flash],
  )
  const dial = useDialKitController('Reference', config, { id: REFERENCE_PANEL, onAction: (action) => void act(action) })
  const referenceId = typeof dial.values.reference === 'string' ? dial.values.reference : references[0].id
  const view: ViewSettings = { diff: dial.values.diff === true, blink: dial.values.blink === true, supersample: dial.values.supersample === true ? 2 : 1 }
  const access = useMemo(() => panelAccessFor(REFERENCE_PANEL, 'Reference', config), [config])

  const load = useEffectEvent((id: string, isCancelled: () => boolean) => {
    const reference = references.find((candidate) => candidate.id === id)
    if (!reference) return
    Promise.all([fetchPreset(reference), fetchTarget(reference)]).then(
      ([file, target]) => {
        if (isCancelled()) return
        const reuse = firstLoad.current && lastPresetPanel?.referenceId === reference.id ? lastPresetPanel.panelId : null
        const panelId = reuse ?? `lab-preset-${reference.id}-${++presetLoads}`
        lastPresetPanel = { referenceId: reference.id, panelId }
        firstLoad.current = false
        setLoaded({ reference, target, file, panelId })
        setProblem(null)
      },
      (cause: unknown) => {
        if (isCancelled()) return
        setLoaded(null)
        setProblem(errorMessage(cause))
      },
    )
  })

  useEffect(() => {
    let cancelled = false
    load(referenceId, () => cancelled)
    return () => {
      cancelled = true
    }
  }, [referenceId])

  async function act(action: string) {
    const preset = presetToCopy.current
    if (!preset) return
    switch (action) {
      case 'copyPreset':
        try {
          await navigator.clipboard.writeText(JSON.stringify(orderedPreset(preset), null, 2))
          flash.show('copy', 'Copied')
        } catch (cause) {
          flash.show('copy', errorMessage(cause))
        }
        return
      case 'savePreset':
        try {
          const response = await fetch('/api/light-preset', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(orderedPreset(preset)),
          })
          if (!response.ok) throw await responseError(response)
          flash.show('save', 'Saved')
          if (preset.referenceId) onSaved(preset.referenceId)
        } catch (cause) {
          flash.show('save', errorMessage(cause))
        }
        return
      default:
        return
    }
  }

  if (!loaded) {
    return <ReferenceAccess panelRoot={panelRoot} access={access} message={problem} />
  }
  return (
    <PresetEditor
      loaded={loaded}
      view={view}
      panelRoot={panelRoot}
      referenceAccess={access}
      onPreset={(preset) => {
        presetToCopy.current = preset
      }}
    />
  )
}

/** The stage while nothing is loaded, with keyboard support for the Reference panel. */
function ReferenceAccess({ panelRoot, access, message }: { panelRoot: RefObject<HTMLElement | null>; access: ReturnType<typeof panelAccessFor>; message: string | null }) {
  usePanelAccess(panelRoot, access)
  return <MessageStage message={message} />
}

function PresetEditor({
  loaded,
  view,
  panelRoot,
  referenceAccess,
  onPreset,
}: {
  loaded: Loaded
  view: ViewSettings
  panelRoot: RefObject<HTMLElement | null>
  referenceAccess: ReturnType<typeof panelAccessFor>
  onPreset: (preset: Preset) => void
}) {
  const { target, file, panelId } = loaded
  const [blinkOn, setBlinkOn] = useState(false)
  const targetCanvas = useRef<HTMLCanvasElement>(null)
  const diffCanvas = useRef<HTMLCanvasElement>(null)
  const overlayCanvas = useRef<HTMLCanvasElement>(null)
  const renderHost = useRef<HTMLDivElement>(null)
  const diffWorker = useRef<DiffWorker | null>(null)

  const { scene, recipe, config } = useScenePanel({ id: panelId, name: 'Preset', base: file.scene, colors: true })
  const access = useMemo(
    () => mergeAccess(referenceAccess, panelAccessFor(panelId, 'Preset', config, { keySteps: sceneKeySteps(recipe) })),
    [referenceAccess, panelId, config, recipe],
  )
  usePanelAccess(panelRoot, access)

  useEffect(() => {
    onPreset(presetToSave(file, scene))
  })

  const canvas = useLightCanvas({
    host: renderHost,
    scene,
    width: target.width,
    height: target.height,
    supersample: view.supersample,
    canvasClass: styles.canvas,
    onRendered: () => {
      if (view.diff) requestDiff()
    },
  })

  function requestDiff() {
    const worker = diffWorker.current
    if (!worker) return
    worker.request(() => {
      const pixels = canvas.readPixels()
      if (!pixels || pixels.width !== target.width || pixels.height !== target.height) return null
      return { key: target.key, width: target.width, height: target.height, target: target.image.data, render: pixels.data, mask: target.mask }
    })
  }

  const showDiff = useEffectEvent((result: DiffResult) => {
    const element = diffCanvas.current
    if (!element || result.key !== target.key) return
    drawImage(element, new ImageData(result.heat, result.width, result.height))
  })

  const [diffProblem, setDiffProblem] = useState<string | null>(null)
  useEffect(() => {
    const worker = new DiffWorker(
      (result) => showDiff(result),
      (message) => setDiffProblem(message),
    )
    diffWorker.current = worker
    return () => {
      worker.dispose()
      diffWorker.current = null
    }
  }, [])

  useEffect(() => {
    drawImage(targetCanvas.current, target.image)
    drawImage(overlayCanvas.current, target.image)
    const element = diffCanvas.current
    if (element) {
      element.width = target.width
      element.height = target.height
    }
  }, [target])

  const askDiff = useEffectEvent(() => requestDiff())
  useEffect(() => {
    if (view.diff) askDiff()
  }, [view.diff])

  useEffect(() => {
    if (!view.blink) return
    const timer = window.setInterval(() => setBlinkOn((on) => !on), 500)
    return () => window.clearInterval(timer)
  }, [view.blink])

  const showOverlay = view.blink && blinkOn
  return (
    <div className={styles.stage}>
      <div className={styles.panel}>
        <canvas ref={targetCanvas} className={view.diff ? styles.hidden : styles.fill} />
        <canvas ref={diffCanvas} className={view.diff ? styles.fill : styles.hidden} />
        {diffProblem ? <p className={styles.message}>{diffProblem}</p> : null}
      </div>
      <div className={styles.panel}>
        <div ref={renderHost} className={canvas.error ? styles.hidden : styles.fill} />
        <canvas ref={overlayCanvas} className={showOverlay ? styles.fill : styles.hidden} />
        {canvas.error ? <p className={styles.message}>{canvas.error}</p> : null}
      </div>
    </div>
  )
}
