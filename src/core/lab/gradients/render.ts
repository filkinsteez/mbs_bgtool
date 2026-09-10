import type { LabState, LabView } from '../types'
import type { LabSource } from '../sourceCache'
import { GRADIENT_IDS } from '../looks'
import { buildV2Env, type V2Env } from '../v2/system'
import { normalizeGradientSettings } from './settings'
import { GRADIENT_FRAGMENT, GRADIENT_VERTEX, GRADIENT_SCATTER } from './shader'
import { boxBlur } from '@/core/math/blur'
import { deformationTexture, DEFORMATION_SIZE } from './deformation'

const STYLES = ['diffusion', 'halo', 'flow', 'smear']

// Each deposit receives a selected swatch, independent of spatial position.
// Stratified samples preserve the mix's weighting without interpolating a ramp.
export function gradientPigments(env: Pick<V2Env, 'plan' | 'palette' | 'ink'>, tints = false): Float32Array {
  const colors = env.plan?.swatches.length
    ? env.plan.swatches.map((s) => ({ hex: s.hex, weight: s.weight }))
    : (env.palette.length ? env.palette : [env.ink]).map((hex) => ({ hex, weight: 1 }))
  const total = colors.reduce((sum, c) => sum + c.weight, 0) || 1
  // The lead swatch already occupies the ground. Repeating it in every layer
  // would wash over the other swatches and make a 40% lead cover most pixels.
  const deposits = colors.length > 1 ? colors.slice(1) : colors
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
    data.set([((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255, 1], i * 4)
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

// Keep each selected swatch at the center of a weighted interval. Interpolate in
// sRGB, like a diffused exposure; do not add colors outside the user's palette.
export function gradientPalette(env: Pick<V2Env, 'plan' | 'palette' | 'ink'>): Uint8Array {
  const swatches = env.plan?.swatches.length
    ? env.plan.swatches.map((s) => ({ hex: s.hex, weight: s.weight }))
    : (env.palette.length ? env.palette : [env.ink]).map((hex) => ({ hex, weight: 1 }))
  const total = swatches.reduce((sum, s) => sum + s.weight, 0) || 1
  let accumulated = 0
  const stops = swatches.map((s) => {
    const center = (accumulated + s.weight / 2) / total
    accumulated += s.weight
    const hex = parseInt(s.hex.replace('#', ''), 16)
    return { center, rgb: [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255] }
  })
  const data = new Uint8Array(512 * 4)
  for (let i = 0; i < 512; i++) {
    const t = i / 511
    let right = stops.findIndex((s) => s.center >= t)
    if (right < 0) right = stops.length - 1
    const a = stops[Math.max(0, right - 1)], b = stops[right]
    let f = Math.max(0, Math.min(1, (t - a.center) / Math.max(1e-6, b.center - a.center)))
    f = f * f * (3 - 2 * f)
    for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round(a.rgb[c] * (1 - f) + b.rgb[c] * f)
    data[i * 4 + 3] = 255
  }
  return data
}

class GradientRenderer {
  readonly canvas = document.createElement('canvas')
  readonly gl: WebGL2RenderingContext
  private program: WebGLProgram | null = null
  private scatter: WebGLProgram | null = null
  private framebuffer: WebGLFramebuffer | null = null
  private exposureSize = ''
  private scatterUniforms = new Map<string, WebGLUniformLocation | null>()
  private textures: WebGLTexture[] = []
  private uniforms = new Map<string, WebGLUniformLocation | null>()
  private fieldKey = ''
  private paletteKey = ''
  private deformationKey: string | undefined = undefined

  constructor() {
    const gl = this.canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: true })
    if (!gl) throw new Error('Gradients require WebGL 2. Enable graphics acceleration in your browser.')
    this.gl = gl
    this.canvas.addEventListener('webglcontextlost', (event) => { event.preventDefault(); this.program = null })
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.textures = []
      this.uniforms.clear()
      this.fieldKey = ''
      this.paletteKey = ''
    })
  }

  private setup() {
    const gl = this.gl
    if (this.program) return
    const vs = compile(gl, gl.VERTEX_SHADER, GRADIENT_VERTEX)
    const fs = compile(gl, gl.FRAGMENT_SHADER, GRADIENT_FRAGMENT)
    const program = gl.createProgram()!
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
    this.program = program
    const scatterVertex = compile(gl, gl.VERTEX_SHADER, GRADIENT_VERTEX)
    const scatterFragment = compile(gl, gl.FRAGMENT_SHADER, GRADIENT_SCATTER)
    this.scatter = gl.createProgram()!
    gl.attachShader(this.scatter, scatterVertex)
    gl.attachShader(this.scatter, scatterFragment)
    gl.linkProgram(this.scatter)
    gl.deleteShader(scatterVertex)
    gl.deleteShader(scatterFragment)
    if (!gl.getProgramParameter(this.scatter, gl.LINK_STATUS)) throw new Error(`Gradient scatter: ${gl.getProgramInfoLog(this.scatter)}`)
    this.framebuffer = gl.createFramebuffer()
    this.exposureSize = ''
    this.scatterUniforms.clear()
    this.uniforms.clear()
    this.textures = [gl.createTexture()!, gl.createTexture()!]
    this.textures.push(gl.createTexture()!)
    this.deformationKey = undefined
    this.fieldKey = ''
    this.paletteKey = ''
    for (let i = 0; i < 3; i++) {
      gl.activeTexture(gl.TEXTURE0 + i)
      gl.bindTexture(gl.TEXTURE_2D, this.textures[i])
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    }
  }

  draw(lab: LabState, source: LabSource | null) {
    const gl = this.gl
    if (gl.isContextLost()) throw new Error('Graphics context was lost. Reload to render gradients.')
    this.setup()
    const env = buildV2Env(lab, source)
    const settings = normalizeGradientSettings(lab.look.gradient)
    const loc = (name: string) => {
      if (!this.uniforms.has(name)) this.uniforms.set(name, gl.getUniformLocation(this.program!, name))
      return this.uniforms.get(name)!
    }
    if (this.canvas.width !== env.outW) this.canvas.width = env.outW
    if (this.canvas.height !== env.outH) this.canvas.height = env.outH
    gl.viewport(0, 0, env.outW, env.outH)
    gl.useProgram(this.program)
    const colorsKey = JSON.stringify([env.plan?.swatches, env.palette, env.ink])
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
      gl.uniform4fv(loc('pigments[0]'), gradientPigments(env))
      gl.uniform4fv(loc('pigmentTints[0]'), gradientPigments(env, true))
      const lead = gradientPalette(env)
      gl.uniform3f(loc('groundPigment'), lead[0] / 255, lead[1] / 255, lead[2] / 255)
      const swatches = env.plan?.swatches
      const groundShare = swatches?.length
        ? swatches[0].weight / Math.max(0.0001, swatches.reduce((sum, c) => sum + c.weight, 0))
        : 1 / Math.max(1, env.palette.length)
      gl.uniform1f(loc('groundShare'), groundShare)
      this.paletteKey = colorsKey
    }
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.textures[1])
    const key = JSON.stringify([lab.territory.sources, env.outW, env.outH, !!source])
    if (key !== this.fieldKey || source) {
      const size = 96
      const data = new Uint8Array(size * size * 4)
      const symbolData = new Float32Array(size * size)
      const luminanceData = new Float32Array(size * size)
      // A captured 3D frame supplies its own form. Do not insert a second,
      // canonical symbol into arbitrary source imagery.
      const symbol = source ? () => 0 : env.symbolField({ softness: 0.8 })
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const px = (x + 0.5) / size * env.outW, py = (y + 0.5) / size * env.outH
        const i = (y * size + x) * 4
        symbolData[y * size + x] = Math.max(0, Math.min(1, symbol(px, py)))
        luminanceData[y * size + x] = env.luminance?.(px, py) ?? 0.5
        data[i + 3] = 255
      }
      boxBlur(symbolData, size, size, 10)
      if (source) boxBlur(luminanceData, size, size, 2 + settings.softness * 6)
      for (let i = 0; i < symbolData.length; i++) {
        data[i * 4] = Math.round(symbolData[i] * 255)
        data[i * 4 + 1] = Math.round(luminanceData[i] * 255)
      }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data)
      this.fieldKey = key
    }
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
    const phase = ((env.motionPhase % 1) + 1) % 1 * Math.PI * 2
    const amount = env.motionAmount * 0.45
    const harmonic = 2 + Math.round(env.motionEnergy * 2)
    gl.uniform2f(loc('motion'),
      (Math.sin(phase) + Math.sin(phase * harmonic) * env.motionEnergy * 0.3) * amount,
      (Math.cos(phase) - 1 + (Math.cos(phase * harmonic) - 1) * env.motionEnergy * 0.2) * amount)
    gl.uniform1f(loc('seed'), (env.seed % 65521) * 0.0137)
    gl.uniform1f(loc('complexity'), env.complexity)
    gl.uniform1f(loc('softness'), settings.softness)
    gl.uniform1f(loc('distortion'), settings.distortion)
    gl.uniform1f(loc('warpScale'), settings.scale)
    gl.uniform1f(loc('folds'), settings.folds)
    gl.uniform1f(loc('bleed'), settings.bleed)
    gl.uniform1f(loc('depth'), settings.depth)
    gl.uniform1f(loc('grain'), settings.grain)
    gl.uniform1i(loc('style'), STYLES.indexOf(lab.look.id!))
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
    gl.uniform2f(post('resolution'), env.outW, env.outH)
    gl.uniform1f(post('softness'), settings.softness)
    gl.uniform1f(post('bleed'), settings.bleed)
    gl.uniform1f(post('grain'), settings.grain)
    gl.uniform1f(post('seed'), (env.seed % 65521) * 0.0137)
    gl.uniform1i(post('style'), STYLES.indexOf(lab.look.id!))
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    return this.canvas
  }
}

let renderer: GradientRenderer | null = null

export function renderGradient(ctx: CanvasRenderingContext2D, lab: LabState, source: LabSource | null, view: LabView): boolean {
  if (lab.look.version !== 'gradients' || !GRADIENT_IDS.has(lab.look.id ?? '') || view !== 'composite') return false
  renderer ??= new GradientRenderer()
  ctx.drawImage(renderer.draw(lab, source), 0, 0, lab.output.width, lab.output.height)
  return true
}
