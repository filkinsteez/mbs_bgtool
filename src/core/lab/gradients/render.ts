import type { LabState, LabView } from '../types'
import type { LabSource } from '../sourceCache'
import { GRADIENT_IDS } from '../looks'
import { normalizeGradientSettings } from './settings'
import { GRADIENT_FRAGMENT, GRADIENT_VERTEX, GRADIENT_SCATTER } from './shader'
import { GRADIENT_FRAGMENT as OPTICAL_FRAGMENT, GRADIENT_SCATTER as OPTICAL_SCATTER } from './opticalStudy'
import { deformationTexture, DEFORMATION_SIZE } from './deformation'
import { fitRect } from '../field'
import { boxBlur } from '@/core/math/blur'
import {
  selectedSwatches,
  weightedPalette,
  weightedPigments,
  weightedPigment,
  paletteLightness,
  pigmentIntervals,
  type GradientPaletteInput,
} from './palette'

const STYLES = ['diffusion', 'halo', 'flow', 'smear']
export const gradientPigments = weightedPigments

type GradientRenderEnv = GradientPaletteInput & {
  outW: number
  outH: number
  seed: number
  complexity: number
}

function buildGradientRenderEnv(lab: LabState): GradientRenderEnv {
  return {
    outW: lab.output.width,
    outH: lab.output.height,
    seed: lab.seed,
    complexity: Math.max(0, Math.min(1, lab.look.complexity ?? 0.5)),
    ink: lab.colors.ink,
    palette: lab.colors.palette,
    plan: lab.colors.plan,
  }
}

// Close hues must carry form through their tonal range. Measure selected colors
// rather than palette names so custom mixes receive the same treatment.
export function gradientToneProfile(
  env: GradientPaletteInput,
): [number, number, number, number] {
  const swatches = env.plan?.swatches.length
    ? env.plan.swatches.map((s) => ({ hex: s.hex, weight: s.weight }))
    : (env.palette.length ? env.palette : [env.ink]).map((hex) => ({ hex, weight: 1 }))
  let total = 0, mean = 0, low = 1, high = 0, hx = 0, hy = 0, chroma = 0
  for (const { hex, weight } of swatches) {
    if (weight <= 0) continue
    const n = parseInt(hex.replace('#', ''), 16)
    const [r, g, b] = [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]
    const v = Math.max(r, g, b), d = v - Math.min(r, g, b)
    const h = d === 0 ? 0 : (v === r ? (g - b) / d : v === g ? (b - r) / d + 2 : (r - g) / d + 4) * Math.PI / 3
    const w = weight * d
    hx += Math.cos(h) * w; hy += Math.sin(h) * w; chroma += w
    low = Math.min(low, v); high = Math.max(high, v)
    mean += v * weight; total += weight
  }
  if (!total) return [0, 1, 0.5, 0]
  // Weighted end ranges prevent a trace dark/light swatch from changing the
  // contrast of every other color when it is removed.
  const values = selectedSwatches(env).map(s => ({ value: Math.max(...s.rgb), weight: s.weight })).sort((a, b) => a.value - b.value)
  let edge = 0
  low = 0; high = 0
  for (const item of values) {
    const start = edge
    edge += item.weight
    low += item.value * Math.max(0, Math.min(edge, .05) - start) / .05
    high += item.value * Math.max(0, edge - Math.max(start, .95)) / .05
  }
  if (values.every(item => item.value === values[0].value)) low = high = values[0].value
  const coherence = chroma ? Math.hypot(hx, hy) / chroma : 1
  const narrowHue = Math.max(0, Math.min(1, (coherence - 0.6) / 0.35))
  return [low, high, mean / total, narrowHue]
}

// Retain the old deposit allocation only for the isolated optical experiment.
function legacyGradientPigments(
  env: GradientPaletteInput,
  tints = false,
): Float32Array {
  const colors = env.plan?.swatches.length
    ? env.plan.swatches.map((s) => ({ hex: s.hex, weight: s.weight }))
    : (env.palette.length ? env.palette : [env.ink]).map((hex) => ({ hex, weight: 1 }))
  const total = colors.reduce((sum, c) => sum + c.weight, 0) || 1
  // Every swatch receives continuous fields, including the lead. Fields are
  // normalized together rather than painted over an opaque lead-color ground.
  const deposits = colors
  const depositTotal = deposits.reduce((sum, c) => sum + c.weight, 0) || total
  const data = new Float32Array(12 * 4)
  for (let i = 0; i < 12; i++) {
    const target = (((i * 5) % 12 + 0.5) / 12) * depositTotal
    let cumulative = 0
    const color = deposits.find((c) => { cumulative += c.weight; return cumulative >= target }) ?? deposits[deposits.length - 1]
    let selected = color.hex
    if (tints && colors.length > 1) {
      const rgb = (hex: string) => { const n = parseInt(hex.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }
      const base = rgb(color.hex)
      const nearest = colors.filter((c) => c.hex !== color.hex).sort((a, b) => {
        const distance = (hex: string) => rgb(hex).reduce((sum, v, channel) => sum + (v - base[channel]) ** 2, 0)
        return distance(a.hex) - distance(b.hex)
      })[0]
      selected = nearest?.hex ?? selected
    }
    const hex = parseInt(selected.replace('#', ''), 16)
    data.set([((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255, colors.indexOf(color)], i * 4)
  }
  return data
}

function compile(gl: WebGL2RenderingContext, kind: number, source: string): WebGLShader {
  const shader = gl.createShader(kind)
  if (!shader) throw new Error('Could not allocate gradient shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`Gradient shader: ${message}`)
  }
  return shader
}

export const gradientPalette = weightedPalette

// The palette grades the processed frame; it must not generate its own shapes.
// Background/marks roles choose the ends, while every enabled mix color keeps
// its weight between them. Zero-weight swatches are excluded by the color plan.
export function gradientSourcePalette(env: GradientPaletteInput): Uint8Array {
  const plan = env.plan
  if (!plan) return gradientPalette(env, true)
  const { ground, ink } = plan.roles
  const order = [ground, ...plan.swatches.map((_, i) => i).filter(i => i !== ground && i !== ink)]
  if (ink !== ground) order.push(ink)
  return gradientPalette({ ...env, plan: { ...plan, swatches: order.map(i => plan.swatches[i]) } }, true)
}

// Stable source-relative tonal range, shared by preview and export. Ignore a
// few antialiasing/highlight outliers so close source tones can use the palette.
function sourceToneRange(tones: Float32Array): [number, number] {
  const bins = new Uint32Array(256)
  for (const value of tones) bins[Math.max(0, Math.min(255, Math.round(value * 255)))]++
  const count = tones.length
  let cumulative = 0, low = -1, high = 255
  for (let i = 0; i < bins.length; i++) {
    cumulative += bins[i]
    if (low < 0 && cumulative >= count * 0.02) low = i
    if (cumulative >= count * 0.98) { high = i; break }
  }
  return [low / 255, Math.max((high - low) / 255, 0.08)]
}

function colorizeSource(source: LabSource | null, palette: Uint8Array, style: number): Uint8Array {
  if (!source) return new Uint8Array([0, 0, 0, 255])
  const { rgba, w, h } = source.maps
  const tones = new Float32Array(w * h)
  const warmth = new Float32Array(w * h)
  for (let i = 0; i < tones.length; i++) {
    const j = i * 4
    tones[i] = (rgba[j] * 0.2126 + rgba[j + 1] * 0.7152 + rgba[j + 2] * 0.0722) / 255
    warmth[i] = (rgba[j] - rgba[j + 2]) / 255
  }
  // Spread the captured shape before grading, so flat-lit meshes still expose
  // intermediate palette colors; diffuse those colors again in the GPU pass.
  const radius = [0.14, 0.035, 0.065, 0.08][style] ?? 0.12
  boxBlur(tones, w, h, Math.max(1, Math.round(Math.min(w, h) * radius)), 3)
  boxBlur(warmth, w, h, Math.max(1, Math.round(Math.min(w, h) * radius)), 3)
  const [low, span] = sourceToneRange(tones)
  const data = new Uint8Array(rgba.length)
  for (let i = 0; i < rgba.length; i += 4) {
    const luminance = tones[i / 4]
    const tone = (luminance - low) / span + warmth[i / 4] * 0.3
    const index = Math.max(0, Math.min(511, tone * 511))
    const left = Math.floor(index), right = Math.min(511, left + 1), f = index - left
    for (let c = 0; c < 3; c++) data[i + c] = Math.round(palette[left * 4 + c] * (1 - f) + palette[right * 4 + c] * f)
    // Alpha stores the captured frame's normalized tone, never its silhouette.
    // This lets optical contours and close-hue palettes retain source detail.
    data[i + 3] = Math.round(Math.max(0, Math.min(1, tone)) * 255)
  }
  return data
}

// Preserve scalar image information through mipmaps and spatial filtering.
// Applying the selected colors happens once, after transporting these tones.
export function gradientSourceField(source: LabSource | null): Float32Array {
  if (!source) return new Float32Array([0, 0, 0, 1])
  const { rgba, w, h } = source.maps
  const tones = new Float32Array(w * h)
  const warmth = new Float32Array(w * h)
  for (let i = 0; i < tones.length; i++) {
    const j = i * 4
    tones[i] = (rgba[j] * .2126 + rgba[j + 1] * .7152 + rgba[j + 2] * .0722) / 255
    warmth[i] = (rgba[j] - rgba[j + 2]) / 255
  }
  boxBlur(tones, w, h, Math.max(1, Math.round(Math.min(w, h) * .012)), 3)
  boxBlur(warmth, w, h, Math.max(1, Math.round(Math.min(w, h) * .012)), 3)
  const [low, span] = sourceToneRange(tones)
  let min = 1, max = 0
  for (const tone of tones) { min = Math.min(min, tone); max = Math.max(max, tone) }
  const strength = Math.min(1, (max - min) / .08) * .88
  const data = new Float32Array(rgba.length)
  let mean = 0, squared = 0
  for (let i = 0; i < tones.length; i++) {
    const normalized = (tones[i] - low) / span
    const tone = tones[i] * (1 - strength) + normalized * strength + warmth[i] * .2 * strength
    data.set([tone, warmth[i], tone * tone, tones[i]], i * 4)
    mean += tone; squared += tone * tone
  }
  mean /= tones.length
  const deviation = Math.max(.04, Math.sqrt(Math.max(0, squared / tones.length - mean * mean)))
  for (let i = 0; i < tones.length; i++) {
    // A continuous exposure response preserves dim source structure. This is
    // computed before filtering, so bright pixels spread into their neighbors.
    const z = Math.max(-16, Math.min(16, 1.2 * (data[i * 4] - mean) / deviation))
    data[i * 4 + 3] = Math.log1p(Math.exp(z)) / 1.2
  }
  return data
}

// A bounded focus region follows the captured exposure. A slight directional
// bias selects part of the exposure rather than sharpening the entire loop.
export function gradientSourceFocus(data: Float32Array, width: number, height: number): number[] {
  let total = 0, x = 0, y = 0, xx = 0, yy = 0
  for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
    const u = (col + .5) / width, v = (row + .5) / height
    const exposure = Math.max(0, data[(row * width + col) * 4 + 3])
    const weight = exposure * exposure * exposure * (.4 + .6 * u) * (1 - .4 * v)
    total += weight; x += u * weight; y += v * weight
    xx += u * u * weight; yy += v * v * weight
  }
  if (total < 1e-12) return [.5, .5, .1, .1]
  x /= total; y /= total
  const rx = Math.max(.045, Math.min(.13, Math.sqrt(Math.max(0, xx / total - x * x)) * .5))
  const ry = Math.max(.045, Math.min(.13, Math.sqrt(Math.max(0, yy / total - y * y)) * .5))
  return [x, y, rx, ry]
}

// Average edge directions over the focal region. A single stable axis avoids
// changing the blur direction abruptly at the center of a bright source line.
export function gradientSourceAxis(data: Float32Array, width: number, height: number, focus: number[]): number[] {
  let xx = 0, xy = 0, yy = 0
  const step = Math.max(1, Math.round(Math.min(width, height) * .015))
  for (let y = step; y < height - step; y++) for (let x = step; x < width - step; x++) {
    const dx = (data[(y * width + x + step) * 4 + 3] - data[(y * width + x - step) * 4 + 3]) * width
    const dy = (data[((y + step) * width + x) * 4 + 3] - data[((y - step) * width + x) * 4 + 3]) * height
    const u = ((x + .5) / width - focus[0]) / focus[2]
    const v = ((y + .5) / height - focus[1]) / focus[3]
    const weight = Math.exp(-.5 * (u * u + v * v))
    xx += dx * dx * weight; xy += dx * dy * weight; yy += dy * dy * weight
  }
  const angle = .5 * Math.atan2(2 * xy, xx - yy)
  return [Math.cos(angle), Math.sin(angle)]
}

class GradientRenderer {
  readonly canvas = document.createElement('canvas')
  readonly gl: WebGL2RenderingContext
  private floatSource: boolean
  private program: WebGLProgram | null = null
  private programs = new Map<number, WebGLProgram>()
  private scatter: WebGLProgram | null = null
  private framebuffer: WebGLFramebuffer | null = null
  private exposureSize = ''
  private statsAllocated = false
  private flowEmissionAllocated = false
  private scatterUniforms = new Map<string, WebGLUniformLocation | null>()
  private textures: WebGLTexture[] = []
  private uniforms = new Map<string, WebGLUniformLocation | null>()
  private fieldKey = ''
  private paletteKey = ''
  private sourcePalette: Uint8Array = new Uint8Array(512 * 4)
  private deformationKey: string | undefined = undefined

  constructor(private readonly optical = false) {
    const gl = this.canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: true })
    if (!gl) throw new Error('Gradients require WebGL 2. Enable graphics acceleration in your browser.')
    this.floatSource = Boolean(gl.getExtension('EXT_color_buffer_float'))
    this.gl = gl
    this.canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault()
      this.program = null
      this.programs.clear()
      this.scatter = null
    })
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.floatSource = Boolean(gl.getExtension('EXT_color_buffer_float'))
      this.textures = []
      this.uniforms.clear()
      this.fieldKey = ''
      this.paletteKey = ''
    })
  }

  private setup(style: number) {
    const gl = this.gl
    const key = this.optical ? -1 : style
    let program = this.programs.get(key)
    if (!program) {
      const vs = compile(gl, gl.VERTEX_SHADER, GRADIENT_VERTEX)
      // Compile only the chosen construction. Otherwise the first Diffusion
      // frame also pays for Flow's larger filter and every other family.
      const fragment = this.optical ? OPTICAL_FRAGMENT
        : GRADIENT_FRAGMENT.replace('uniform int style;', `const int style = ${style};`)
      const fs = compile(gl, gl.FRAGMENT_SHADER, fragment)
      program = gl.createProgram()!
      gl.attachShader(program, vs)
      gl.attachShader(program, fs)
      gl.linkProgram(program)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const message = gl.getProgramInfoLog(program)
        gl.deleteProgram(program)
        throw new Error(`Gradient program: ${message}`)
      }
      this.programs.set(key, program)
    }
    if (this.program !== program) {
      this.program = program
      this.uniforms.clear()
      this.fieldKey = ''
      this.paletteKey = ''
    }
    if (this.scatter) return
    const scatterVertex = compile(gl, gl.VERTEX_SHADER, GRADIENT_VERTEX)
    const scatterFragment = compile(gl, gl.FRAGMENT_SHADER, this.optical ? OPTICAL_SCATTER : GRADIENT_SCATTER)
    this.scatter = gl.createProgram()!
    gl.attachShader(this.scatter, scatterVertex)
    gl.attachShader(this.scatter, scatterFragment)
    gl.linkProgram(this.scatter)
    gl.deleteShader(scatterVertex)
    gl.deleteShader(scatterFragment)
    if (!gl.getProgramParameter(this.scatter, gl.LINK_STATUS)) throw new Error(`Gradient scatter: ${gl.getProgramInfoLog(this.scatter)}`)
    this.framebuffer = gl.createFramebuffer()
    this.exposureSize = ''
    this.statsAllocated = false
    this.flowEmissionAllocated = false
    this.scatterUniforms.clear()
    this.uniforms.clear()
    this.textures = Array.from({ length: 7 }, () => gl.createTexture()!)
    this.deformationKey = undefined
    this.fieldKey = ''
    this.paletteKey = ''
    for (let i = 0; i < 7; i++) {
      gl.activeTexture(gl.TEXTURE0 + i)
      gl.bindTexture(gl.TEXTURE_2D, this.textures[i])
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      if (i === 4 || i === 6) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))
      if (i === 5) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 512, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    }
  }

  draw(lab: LabState, source: LabSource | null) {
    const gl = this.gl
    if (gl.isContextLost()) throw new Error('Graphics context was lost. Reload to render gradients.')
    this.setup(STYLES.indexOf(lab.look.id!))
    const env = buildGradientRenderEnv(lab)
    const settings = normalizeGradientSettings(lab.look.gradient)
    const loc = (name: string) => {
      if (!this.uniforms.has(name)) this.uniforms.set(name, gl.getUniformLocation(this.program!, name))
      return this.uniforms.get(name)!
    }
    if (this.canvas.width !== env.outW) this.canvas.width = env.outW
    if (this.canvas.height !== env.outH) this.canvas.height = env.outH
    gl.viewport(0, 0, env.outW, env.outH)
    gl.useProgram(this.program)
    const colorsKey = JSON.stringify([env.plan?.swatches, env.plan?.roles, env.palette, env.ink, Boolean(source)])
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.textures[0])
    if (this.exposureSize !== `${env.outW}:${env.outH}`) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, env.outW, env.outH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      this.exposureSize = `${env.outW}:${env.outH}`
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures[0], 0)
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Gradient exposure buffer unavailable')
    if (colorsKey !== this.paletteKey) {
      gl.uniform4fv(loc('pigments[0]'), this.optical ? legacyGradientPigments(env) : gradientPigments(env))
      gl.uniform1i(loc('pigmentCount'), selectedSwatches(env).length)
      if (!this.optical) gl.uniform2fv(loc('pigmentIntervals[0]'), pigmentIntervals(env))
      gl.uniform1i(loc('sourceInk'), env.plan?.roles.ink ?? 0)
      gl.uniform1i(loc('sourceGround'), env.plan?.roles.ground ?? Math.max(0, env.palette.length - 1))
      gl.uniform3fv(loc('averagePigment'), weightedPigment(env))
      gl.uniform3fv(loc('lumaProfile'), paletteLightness(env))
      if (this.optical) gl.uniform4fv(loc('pigmentTints[0]'), legacyGradientPigments(env, true))
      const lead = gradientPalette(env)
      gl.uniform3f(loc('groundPigment'), lead[0] / 255, lead[1] / 255, lead[2] / 255)
      const colors = env.plan?.swatches.map((s) => s.hex) ?? env.palette
      gl.uniform1f(loc('paletteSpread'), new Set(colors.map((c) => c.toLowerCase())).size > 1 ? 1 : 0)
      const toneProfile = gradientToneProfile(env)
      gl.uniform4fv(loc('toneProfile'), toneProfile)
      this.sourcePalette = gradientSourcePalette(env)
      gl.activeTexture(gl.TEXTURE3)
      gl.bindTexture(gl.TEXTURE_2D, this.textures[3])
      const paletteRadius = !this.optical && lab.look.id === 'halo' ? .12 + .14 * toneProfile[3] : .26
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 512, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, source ? this.sourcePalette : gradientPalette(env, true, paletteRadius))
      gl.uniform3fv(loc('darkPigment'), weightedPigment(env, -6))
      gl.uniform3fv(loc('lightPigment'), weightedPigment(env, 6))
      gl.uniform3fv(loc('darkTip'), weightedPigment(env, -6, .05))
      gl.uniform3fv(loc('lightTip'), weightedPigment(env, 6, .05))
      this.paletteKey = colorsKey
    }
    gl.uniform1i(loc('lookPalette'), 3)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.textures[1])
    const style = STYLES.indexOf(lab.look.id!)
    const key = source ? (this.optical ? `${source.hash}:${colorsKey}:${style}` : source.hash) : 'no-rendered-frame'
    if (key !== this.fieldKey) {
      if (this.optical) {
        const data = colorizeSource(source, this.sourcePalette, style)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, source?.maps.w ?? 1, source?.maps.h ?? 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data)
      } else {
        const field = gradientSourceField(source)
        const focus = gradientSourceFocus(field, source?.maps.w ?? 1, source?.maps.h ?? 1)
        gl.uniform4fv(loc('sourceFocus'), focus)
        gl.uniform2fv(loc('sourceAxis'), gradientSourceAxis(field, source?.maps.w ?? 1, source?.maps.h ?? 1, focus))
        for (let i = 1; i < field.length; i += 4) field[i] = field[i] * .5 + .5
        if (this.floatSource) {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, source?.maps.w ?? 1, source?.maps.h ?? 1, 0, gl.RGBA, gl.FLOAT, field)
        } else {
          const bytes = Uint8Array.from(field, value => Math.round(Math.max(0, Math.min(1, value)) * 255))
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, source?.maps.w ?? 1, source?.maps.h ?? 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes)
        }
      }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
      gl.generateMipmap(gl.TEXTURE_2D)
      const sourceError = gl.getError()
      if (sourceError !== gl.NO_ERROR) throw new Error(`Gradient source texture: ${sourceError}`)
      this.fieldKey = key
    }
    const rect = source ? fitRect(source.fullW, source.fullH, env.outW, env.outH, lab.source?.fit ?? 'cover') : { x: 0, y: 0, w: env.outW, h: env.outH }
    gl.uniform4f(loc('sourceRect'), rect.x / env.outW, rect.y / env.outH, rect.w / env.outW, rect.h / env.outH)
    gl.uniform1i(loc('influence'), 1)
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, this.textures[2])
    const deformationKey = lab.look.deformation?.data ?? ''
    if (this.deformationKey !== deformationKey) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, DEFORMATION_SIZE, DEFORMATION_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, deformationTexture(lab.look.deformation))
      this.deformationKey = deformationKey
    }
    gl.uniform1i(loc('deformation'), 2)
    gl.uniform1f(loc('painted'), deformationKey ? 1 : 0)
    gl.uniform2f(loc('resolution'), env.outW, env.outH)
    gl.uniform1f(loc('seed'), (env.seed % 65521) * 0.0137)
    gl.uniform1f(loc('complexity'), env.complexity)
    gl.uniform1f(loc('softness'), settings.softness)
    gl.uniform1f(loc('distortion'), settings.distortion)
    gl.uniform1f(loc('warpScale'), settings.scale)
    gl.uniform1f(loc('folds'), settings.folds)
    gl.uniform1f(loc('bleed'), settings.bleed)
    gl.uniform1f(loc('depth'), settings.depth)
    gl.uniform1f(loc('reflow'), settings.reflow)
    gl.uniform1f(loc('sourceMode'), source ? 1 : 0)
    gl.uniform1f(loc('grain'), settings.grain)
    gl.uniform1f(loc('orientation'), settings.orientation ?? 0)
    gl.uniform2f(loc('gradientCenter'), settings.centerX, settings.centerY)
    gl.uniform1f(loc('useSpatialField'), spatialStudy ? 1 : 0)
    gl.uniform4fv(loc('spatialSources[0]'), new Float32Array([
      settings.source1X,
      settings.source1Y,
      settings.source1Spread,
      (settings.sourceCount ?? 1) >= 1 ? 1 : 0,
      settings.source2X,
      settings.source2Y,
      settings.source2Spread,
      (settings.sourceCount ?? 1) >= 2 ? 1 : 0,
      settings.source3X,
      settings.source3Y,
      settings.source3Spread,
      (settings.sourceCount ?? 1) >= 3 ? 1 : 0,
    ]))
    gl.uniform1i(loc('style'), STYLES.indexOf(lab.look.id!))
    gl.uniform1i(loc('transportStats'), 4)
    gl.uniform1f(loc('transportMeasure'), 0)
    gl.uniform1f(loc('transportStatsReady'), 0)
    gl.uniform1i(loc('transportRank'), 5)
    gl.uniform1f(loc('transportRankMeasure'), 0)
    gl.uniform1i(loc('flowEmission'), 6)
    gl.uniform1f(loc('flowEmissionMeasure'), 0)
    gl.uniform1f(loc('flowEmissionReady'), 0)
    if (source && style === 2 && this.floatSource && !this.optical) {
      // Grade the captured pixels before filtering. Prefiltering those colored
      // emissions keeps narrow palette transitions out of the sparse gather.
      gl.activeTexture(gl.TEXTURE6)
      gl.bindTexture(gl.TEXTURE_2D, this.textures[6])
      if (!this.flowEmissionAllocated) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 512, 512, 0, gl.RGBA, gl.FLOAT, null)
        this.flowEmissionAllocated = true
      }
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures[6], 0)
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Flow emission buffer unavailable')
      gl.bindTexture(gl.TEXTURE_2D, this.textures[1])
      gl.viewport(0, 0, 512, 512)
      gl.uniform1f(loc('flowEmissionMeasure'), 1)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures[0], 0)
      gl.bindTexture(gl.TEXTURE_2D, this.textures[6])
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
      gl.generateMipmap(gl.TEXTURE_2D)
      gl.viewport(0, 0, env.outW, env.outH)
      gl.uniform1f(loc('flowEmissionMeasure'), 0)
      gl.uniform1f(loc('flowEmissionReady'), 1)
    }
    if (source && style !== 2 && this.floatSource && !this.optical) {
      // Measure the transported exposure, whose range changes with blur and
      // cropping. Reducing a fixed-size float image keeps preview/export equal
      // and avoids a synchronous GPU readback while controls are moving.
      gl.activeTexture(gl.TEXTURE4)
      gl.bindTexture(gl.TEXTURE_2D, this.textures[4])
      if (!this.statsAllocated) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 128, 128, 0, gl.RGBA, gl.FLOAT, null)
        this.statsAllocated = true
      }
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures[4], 0)
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Gradient range buffer unavailable')
      // A shader cannot sample its current render target, even when that
      // sampler sits behind a disabled uniform branch.
      gl.bindTexture(gl.TEXTURE_2D, this.textures[1])
      gl.viewport(0, 0, 128, 128)
      gl.uniform1f(loc('transportMeasure'), 1)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures[0], 0)
      gl.bindTexture(gl.TEXTURE_2D, this.textures[4])
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
      gl.generateMipmap(gl.TEXTURE_2D)
      gl.viewport(0, 0, env.outW, env.outH)
      gl.uniform1f(loc('transportMeasure'), 0)
      gl.uniform1f(loc('transportStatsReady'), 1)
      // Measure cumulative coverage of the filtered image. Palette intervals
      // can then occupy their selected proportions even with a skewed source.
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures[5], 0)
      gl.activeTexture(gl.TEXTURE5)
      gl.bindTexture(gl.TEXTURE_2D, this.textures[1])
      gl.viewport(0, 0, 512, 1)
      gl.uniform1f(loc('transportRankMeasure'), 1)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures[0], 0)
      gl.bindTexture(gl.TEXTURE_2D, this.textures[5])
      gl.viewport(0, 0, env.outW, env.outH)
      gl.uniform1f(loc('transportRankMeasure'), 0)
      const rangeError = gl.getError()
      if (rangeError !== gl.NO_ERROR) throw new Error(`Gradient range pass: ${rangeError}`)
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.useProgram(this.scatter)
    const post = (name: string) => {
      if (!this.scatterUniforms.has(name)) this.scatterUniforms.set(name, gl.getUniformLocation(this.scatter!, name))
      return this.scatterUniforms.get(name)!
    }
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.textures[0])
    gl.uniform1i(post('exposure'), 0)
    if (style !== 2) {
      gl.generateMipmap(gl.TEXTURE_2D)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    } else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.uniform2f(post('resolution'), env.outW, env.outH)
    gl.uniform1f(post('softness'), settings.softness)
    gl.uniform1f(post('bleed'), settings.bleed)
    gl.uniform1f(post('grain'), settings.grain)
    gl.uniform1f(post('orientation'), settings.orientation ?? 0)
    gl.uniform2f(post('gradientCenter'), settings.centerX, settings.centerY)
    gl.uniform1f(post('seed'), (env.seed % 65521) * 0.0137)
    gl.uniform1i(post('style'), STYLES.indexOf(lab.look.id!))
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    return this.canvas
  }
}

let renderer: GradientRenderer | null = null
let studyRenderer: GradientRenderer | null = null
let opticalStudy = false
let spatialStudy = false

// A per-tab development comparison. Saved recipes and the main generator keep
// the shipped renderer; this experiment cannot be enabled in production.
export function setGradientOpticalStudy(enabled: boolean) {
  opticalStudy = process.env.NODE_ENV === 'development' && enabled
}

export function setGradientSpatialStudy(enabled: boolean) {
  spatialStudy = process.env.NODE_ENV === 'development' && enabled
}

export function renderGradient(ctx: CanvasRenderingContext2D, lab: LabState, source: LabSource | null, view: LabView): boolean {
  if (lab.look.version !== 'gradients' || !GRADIENT_IDS.has(lab.look.id ?? '') || view !== 'composite') return false
  if (opticalStudy) {
    studyRenderer ??= new GradientRenderer(true)
    ctx.drawImage(studyRenderer.draw(lab, source), 0, 0, lab.output.width, lab.output.height)
    return true
  }
  renderer ??= new GradientRenderer()
  ctx.drawImage(renderer.draw(lab, source), 0, 0, lab.output.width, lab.output.height)
  return true
}
