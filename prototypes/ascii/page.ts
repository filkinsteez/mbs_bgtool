/// <reference types="vite/client" />
// Prototype page for the ASCII filter: measures font glyphs, renders tool frames from a frozen copy of src/light
// (artifacts/ascii/head, made by run.mjs), and runs the filter over frames. Nothing here is engine code.
import { DEFAULT_KNOBS, type Knobs, type Ramp } from './filter'
import { Runner } from './runner'

let runner: Runner | null = null
const getRunner = () => (runner ??= new Runner())
let ramp: (Ramp & { byGlyph: number[] }) | null = null

/** The ramp sorted by each glyph's measured ink. */
function getRamp() {
  if (ramp) return ramp
  const byGlyph = getRunner().coverage()
  const order = byGlyph.map((_, i) => i).sort((a, b) => byGlyph[a] - byGlyph[b])
  ramp = { order, coverage: order.map((i) => byGlyph[i]), byGlyph }
  return ramp
}

const FROZEN_RECIPES = import.meta.glob([
  '../../artifacts/ascii/head/src/light/recipes/*/*.ts',
  '!../../artifacts/ascii/head/src/light/recipes/**/*.test.ts',
])

interface Rgba {
  width: number
  height: number
  data: Uint8Array
}

async function upload(key: string, bytes: Uint8Array | Uint8ClampedArray): Promise<void> {
  const body = new Blob([new Uint8Array(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength)])
  const response = await fetch(`/__ascii/upload/${encodeURIComponent(key)}`, { method: 'POST', body })
  if (!response.ok) throw new Error(`upload ${key} failed: ${response.status}`)
}

async function download(key: string): Promise<Rgba> {
  const response = await fetch(`/__ascii/blob/${encodeURIComponent(key)}`)
  if (!response.ok) throw new Error(`download ${key} failed: ${response.status}`)
  return {
    width: Number(response.headers.get('x-width')),
    height: Number(response.headers.get('x-height')),
    data: new Uint8Array(await response.arrayBuffer()),
  }
}

const loadedFonts = new Set<string>()

async function ensureFont(family: string, url?: string): Promise<void> {
  if (!url || loadedFonts.has(family)) return
  const face = new FontFace(family, `url(${url})`, { weight: '300 800' })
  await face.load()
  document.fonts.add(face)
  loadedFonts.add(family)
}

interface GlyphSheetRequest {
  family: string
  url?: string
  weight?: number
  chars: string
  /** Font size in px. */
  size: number
  /** Cell size in px; each glyph is centred horizontally in its cell. */
  cellW: number
  cellH: number
  /** Baseline in px from the top of the cell. */
  baseline: number
  key: string
}

// Engine and recipes load only when a frame is rendered, so the glyph and filter tools work without the frozen copy.
let rendererPromise: Promise<{
  renderer: import('../../artifacts/ascii/head/src/light/engine/programRenderer').ProgramRenderer
  composeScene: typeof import('../../artifacts/ascii/head/src/light/compose').composeScene
  getPack: typeof import('../../artifacts/ascii/head/src/light/color/packs').getPack
  frameAspect: typeof import('../../artifacts/ascii/head/src/light/engine/frame').frameAspect
}> | null = null

function engine() {
  rendererPromise ??= (async () => {
    const [{ ProgramRenderer }, { composeScene }, { getPack }, { frameAspect }] = await Promise.all([
      import('../../artifacts/ascii/head/src/light/engine/programRenderer'),
      import('../../artifacts/ascii/head/src/light/compose'),
      import('../../artifacts/ascii/head/src/light/color/packs'),
      import('../../artifacts/ascii/head/src/light/engine/frame'),
    ])
    return { renderer: new ProgramRenderer(document.createElement('canvas')), composeScene, getPack, frameAspect }
  })()
  return rendererPromise
}

async function recipeById(id: string) {
  const [mood, name] = id.split('.')
  const load = FROZEN_RECIPES[`../../artifacts/ascii/head/src/light/recipes/${mood}/${name}.ts`]
  if (!load) throw new Error(`no frozen recipe file for ${id}`)
  const exported = (await load()) as Record<string, unknown>
  const definition = Object.values(exported).find(
    (value) => typeof value === 'object' && value !== null && (value as { id?: string }).id === id && 'fragment' in (value as object),
  )
  if (!definition) throw new Error(`${id} not exported`)
  return definition as Parameters<typeof import('../../artifacts/ascii/head/src/light/compose').composeScene>[0]
}

interface FrameRequest {
  recipe: string
  pack: string
  seed: number
  controls?: { intensity: number; softness: number; mood: number }
  width: number
  height: number
  supersample?: 1 | 2
  /** Output settings laid over the composed scene's (e.g. { ascii: 1 }). */
  output?: Record<string, number>
  key: string
}

const api = {
  async glyphSheet(request: GlyphSheetRequest) {
    await ensureFont(request.family, request.url)
    const { chars, cellW, cellH } = request
    const canvas = new OffscreenCanvas(Math.ceil(cellW * chars.length), Math.ceil(cellH))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#000000'
    ctx.font = `${request.weight ?? 400} ${request.size}px "${request.family}"`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    const metrics = [...chars].map((ch, i) => {
      ctx.fillText(ch, (i + 0.5) * cellW, request.baseline)
      const m = ctx.measureText(ch)
      return {
        ch,
        advance: m.width,
        left: m.actualBoundingBoxLeft,
        right: m.actualBoundingBoxRight,
        ascent: m.actualBoundingBoxAscent,
        descent: m.actualBoundingBoxDescent,
      }
    })
    const font = ctx.measureText('Hxg')
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    await upload(request.key, pixels)
    return {
      width: canvas.width,
      height: canvas.height,
      metrics,
      fontAscent: font.fontBoundingBoxAscent,
      fontDescent: font.fontBoundingBoxDescent,
      resolved: ctx.font,
    }
  },

  async renderFrame(request: FrameRequest) {
    const { renderer, composeScene, getPack, frameAspect } = await engine()
    const recipe = await recipeById(request.recipe)
    const controls = request.controls ?? { intensity: 0.5, softness: 0.5, mood: 0.5 }
    const scene = composeScene(recipe, {
      pack: getPack(request.pack as Parameters<typeof getPack>[0]),
      controls,
      seed: request.seed,
      aspect: frameAspect(request.width, request.height),
    })
    if (!scene) throw new Error(`${request.recipe} has no compose`)
    const start = performance.now()
    const withOutput = { ...scene, output: { ...scene.output, ...request.output } }
    renderer.renderProgram(recipe, withOutput, { width: request.width, height: request.height, supersample: request.supersample ?? 2 })
    const data = renderer.readPixels()
    const ms = performance.now() - start
    await upload(request.key, data)
    return { ms, colors: scene.colors }
  },

  async echo(key: string, out: string) {
    const image = await download(key)
    await upload(out, image.data)
    return { width: image.width, height: image.height }
  },

  ramp() {
    return getRamp()
  },

  /** Compiles the engine's output pass with the ASCII stage (from the working tree) and returns the log. */
  async compileEnginePass() {
    const [{ buildOutputShader }, { ASCII_FILTER }] = await Promise.all([
      import('../../src/light/engine/output'),
      import('../../src/light/engine/filters/ascii'),
    ])
    const source = buildOutputShader([ASCII_FILTER])
    const gl = new OffscreenCanvas(1, 1).getContext('webgl2') as WebGL2RenderingContext
    const shader = gl.createShader(gl.FRAGMENT_SHADER) as WebGLShader
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    return { ok: Boolean(gl.getShaderParameter(shader, gl.COMPILE_STATUS)), log: gl.getShaderInfoLog(shader) ?? '', lines: source.split('\n').length }
  },

  /** The stage's glyphs side by side (top row first), for comparing with a font sheet. */
  async sdfGlyphs(request: { ids: number[]; em: number; cellW: number; cellH: number; baselineFromBottom: number; key: string }) {
    const sheet = getRunner().glyphs(request.ids, request.em, request.cellW, request.cellH, request.baselineFromBottom)
    const rowBytes = sheet.width * 4
    const flipped = new Uint8Array(sheet.data.length)
    for (let y = 0; y < sheet.height; y++) flipped.set(sheet.data.subarray((sheet.height - 1 - y) * rowBytes, (sheet.height - y) * rowBytes), y * rowBytes)
    await upload(request.key, flipped)
    return { width: sheet.width, height: sheet.height }
  },

  async filter(request: { frameKey: string; strength: number; seed: number; knobs?: Partial<Knobs>; key: string; filter?: boolean }) {
    const frame = await download(request.frameKey)
    const start = performance.now()
    const result = getRunner().ascii(frame, request.strength, request.seed, { ...DEFAULT_KNOBS, ...request.knobs }, getRamp(), request.filter ?? true)
    const ms = performance.now() - start
    await upload(request.key, result.data)
    return { grid: result.grid, ms }
  },
}

export type AsciiProtoApi = typeof api

declare global {
  interface Window {
    asciiProto: AsciiProtoApi
  }
}

window.asciiProto = api
document.documentElement.dataset.ascii = 'ready'
