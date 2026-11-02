import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { buildMask } from '@/light/audit/mask'
import { defaultParams, resolveColors, resolveScene } from '@/light/engine/resolve'
import { RECIPE_LIST, getRecipe } from '@/light/recipes'
import type { IgnoreRect } from '@/light/references'
import {
  LENS_COLORS,
  LENS_NUMBERS,
  OUTPUT_NUMBERS,
  isRecipeId,
  type LensSettings,
  type OutputSettings,
  type ParamValue,
  type Preset,
  type RecipeId,
  type Scene,
} from '@/light/scene'
import { ColorRow, NumberRow, ParamControls, RECIPE_OPTIONS, SeedRow, SelectRow, Toggle } from './controls'
import { DiffWorker, type DiffResult } from './diff'
import { errorMessage, useFlash, useLightCanvas } from './hooks'
import styles from './lab.module.css'

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
}

let loadCount = 0

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

export function ReferencesView({ active }: { active: boolean }) {
  const [references, setReferences] = useState<ReferenceInfo[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [preset, setPreset] = useState<Preset | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [diff, setDiff] = useState(false)
  const [blink, setBlink] = useState(false)
  const [blinkOn, setBlinkOn] = useState(false)
  const [supersample, setSupersample] = useState<1 | 2>(1)
  const flash = useFlash()

  const targetCanvas = useRef<HTMLCanvasElement>(null)
  const diffCanvas = useRef<HTMLCanvasElement>(null)
  const overlayCanvas = useRef<HTMLCanvasElement>(null)
  const renderHost = useRef<HTMLDivElement>(null)
  const loadToken = useRef(0)
  const diffWorker = useRef<DiffWorker | null>(null)

  const recipe = preset ? getRecipe(preset.scene.recipe) : null
  const resolved = useMemo(() => (preset ? resolveScene(getRecipe(preset.scene.recipe), preset.scene) : null), [preset])

  const view = useLightCanvas({
    host: renderHost,
    scene: loaded && preset ? preset.scene : null,
    width: loaded?.target.width ?? 1,
    height: loaded?.target.height ?? 1,
    supersample,
    canvasClass: styles.canvas,
    onRendered: () => {
      if (diff) requestDiff()
    },
  })

  function requestDiff() {
    const worker = diffWorker.current
    if (!worker || !loaded) return
    const { target } = loaded
    worker.request(() => {
      const pixels = view.readPixels()
      if (!pixels || pixels.width !== target.width || pixels.height !== target.height) return null
      return { key: target.key, width: target.width, height: target.height, target: target.image.data, render: pixels.data, mask: target.mask }
    })
  }

  const showDiff = useEffectEvent((result: DiffResult) => {
    const canvas = diffCanvas.current
    if (!canvas || !loaded || result.key !== loaded.target.key) return
    drawImage(canvas, new ImageData(result.heat, result.width, result.height))
  })

  useEffect(() => {
    const worker = new DiffWorker(
      (result) => showDiff(result),
      (message) => setProblem(message),
    )
    diffWorker.current = worker
    return () => {
      worker.dispose()
      diffWorker.current = null
    }
  }, [])

  async function pick(reference: ReferenceInfo) {
    const token = ++loadToken.current
    setSelectedId(reference.id)
    try {
      const [nextPreset, target] = await Promise.all([fetchPreset(reference), fetchTarget(reference)])
      if (token !== loadToken.current) return
      setLoaded({ reference, target })
      setPreset(nextPreset)
      setProblem(null)
    } catch (cause) {
      if (token !== loadToken.current) return
      setLoaded(null)
      setPreset(null)
      setProblem(errorMessage(cause))
    }
  }

  const start = useEffectEvent((list: ReferenceInfo[]) => {
    setReferences(list)
    if (list.length > 0) void pick(list[0])
    else setProblem('No reference images found.')
  })

  useEffect(() => {
    let cancelled = false
    fetchReferences().then(
      (list) => {
        if (!cancelled) start(list)
      },
      (cause: unknown) => {
        if (!cancelled) setProblem(errorMessage(cause))
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!loaded) return
    drawImage(targetCanvas.current, loaded.target.image)
    drawImage(overlayCanvas.current, loaded.target.image)
    const canvas = diffCanvas.current
    if (canvas) {
      canvas.width = loaded.target.width
      canvas.height = loaded.target.height
    }
  }, [loaded])

  useEffect(() => {
    if (!blink || !active) return
    const timer = window.setInterval(() => setBlinkOn((on) => !on), 500)
    return () => window.clearInterval(timer)
  }, [blink, active])

  function updateScene(change: (scene: Scene) => Scene) {
    setPreset((current) => (current ? { ...current, scene: change(current.scene) } : current))
  }

  function setParam(key: string, value: ParamValue) {
    updateScene((scene) => ({ ...scene, params: { ...scene.params, [key]: value } }))
  }

  function setColor(index: number, hex: string) {
    updateScene((scene) => ({
      ...scene,
      colors: resolveColors(getRecipe(scene.recipe), scene.colors).map((color, i) => (i === index ? hex : color)),
    }))
  }

  function setRecipe(id: RecipeId) {
    updateScene((scene) => {
      const next = getRecipe(id)
      const kept = resolveColors(getRecipe(scene.recipe), scene.colors)
      return {
        ...scene,
        recipe: id,
        colors: next.colorSlots.map((_, i) => kept[i] ?? next.defaultColors[i]),
        params: defaultParams(next),
      }
    })
  }

  function setLens<K extends keyof LensSettings>(key: K, value: LensSettings[K]) {
    updateScene((scene) => ({ ...scene, lens: { ...scene.lens, [key]: value } }))
  }

  function setOutput<K extends keyof OutputSettings>(key: K, value: OutputSettings[K]) {
    updateScene((scene) => ({ ...scene, output: { ...scene.output, [key]: value } }))
  }

  function toggleDiff(on: boolean) {
    setDiff(on)
    if (on) requestDiff()
  }

  async function copy() {
    if (!preset) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(orderedPreset(preset), null, 2))
      flash.show('copy', 'Copied')
    } catch (cause) {
      flash.show('copy', errorMessage(cause))
    }
  }

  async function save() {
    if (!preset) return
    const referenceId = preset.referenceId
    try {
      const response = await fetch('/api/light-preset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(orderedPreset(preset)),
      })
      if (!response.ok) throw await responseError(response)
      flash.show('save', 'Saved')
      setReferences((list) => list.map((reference) => (reference.id === referenceId ? { ...reference, hasPreset: true } : reference)))
    } catch (cause) {
      flash.show('save', errorMessage(cause))
    }
  }

  const referenceOptions = references.map((reference) => ({ value: reference.id, label: reference.id }))
  const showOverlay = loaded !== null && blink && active && blinkOn

  return (
    <div className={active ? styles.view : styles.hidden}>
      <div className={styles.stage}>
        <div className={styles.panel}>
          <canvas ref={targetCanvas} className={loaded && !diff ? styles.fill : styles.hidden} />
          <canvas ref={diffCanvas} className={loaded && diff ? styles.fill : styles.hidden} />
          {problem ? <p className={styles.message}>{problem}</p> : null}
        </div>
        <div className={styles.panel}>
          <div ref={renderHost} className={loaded && !view.error ? styles.fill : styles.hidden} />
          <canvas ref={overlayCanvas} className={showOverlay ? styles.fill : styles.hidden} />
          {view.error ? <p className={styles.message}>{view.error}</p> : null}
        </div>
      </div>
      <div className={styles.side}>
        <div className={styles.group}>
          <SelectRow
            label="Reference"
            value={selectedId}
            options={referenceOptions}
            onChange={(id) => {
              const reference = references.find((candidate) => candidate.id === id)
              if (reference) void pick(reference)
            }}
          />
          <div className={styles.toggles}>
            <Toggle label="Diff" checked={diff} onChange={toggleDiff} />
            <Toggle label="Blink" checked={blink} onChange={setBlink} />
            <Toggle label="2x" checked={supersample === 2} onChange={(on) => setSupersample(on ? 2 : 1)} />
          </div>
          <div className={styles.buttons}>
            <button type="button" className={styles.button} disabled={!preset} onClick={() => void copy()}>
              {flash.label('copy', 'Copy preset JSON')}
            </button>
            <button type="button" className={styles.button} disabled={!preset} onClick={() => void save()}>
              {flash.label('save', 'Save preset')}
            </button>
          </div>
        </div>
        {preset && recipe && resolved ? (
          <>
            <div className={styles.group}>
              <SelectRow label="Recipe" value={preset.scene.recipe} options={RECIPE_OPTIONS} onChange={setRecipe} />
              <SeedRow value={preset.scene.seed} onChange={(seed) => updateScene((scene) => ({ ...scene, seed }))} />
            </div>
            <div className={styles.group}>
              {recipe.colorSlots.map((slot, index) => (
                <ColorRow key={slot.key} label={slot.label} value={resolved.hex[index]} onChange={(hex) => setColor(index, hex)} />
              ))}
            </div>
            <div className={styles.group}>
              <ParamControls specs={recipe.params} values={resolved.params} onChange={setParam} />
            </div>
            <div className={styles.group}>
              {LENS_NUMBERS.map((setting) => (
                <NumberRow
                  key={setting.key}
                  label={setting.label}
                  min={setting.min}
                  max={setting.max}
                  step={setting.step}
                  value={resolved.lens[setting.key]}
                  onChange={(value) => setLens(setting.key, value)}
                />
              ))}
              {LENS_COLORS.map((setting) => (
                <ColorRow
                  key={setting.key}
                  label={setting.label}
                  value={resolved.lens[setting.key]}
                  onChange={(hex) => setLens(setting.key, hex)}
                />
              ))}
            </div>
            <div className={styles.group}>
              {OUTPUT_NUMBERS.map((setting) => (
                <NumberRow
                  key={setting.key}
                  label={setting.label}
                  min={setting.min}
                  max={setting.max}
                  step={setting.step}
                  value={resolved.output[setting.key]}
                  onChange={(value) => setOutput(setting.key, value)}
                />
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
