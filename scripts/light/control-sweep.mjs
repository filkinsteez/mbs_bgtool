// Steps one tool control from 0 to 1 by 0.01 (the tool's own rounding) for each look, pack, seed and format, and
// measures how much the picture changes per step: the mean Oklab ΔE between neighbouring frames, both averaged down
// to 160 px on the long side. A step much larger than the steps around it is a jump: it gets a strip of the frames
// on both sides, and every look and format gets a sheet of the change per step for each control and pack.
// Scenes come from the tool's buildScene (src/tool/controls.ts) with the format's aspect, rendered by the light
// harness at 2x supersampling like the settled preview. Exits 1 when it finds a jump or a look does not load.
// The controls startx, starty, angle and length drag a line on the image (ControlValues.drag): the line's start moves
// by 0.01 of the frame along x or y, its angle turns by 0.01 of a full turn about the start, or its length grows by
// 0.01 of the short side, from each base line (--line), and the scene is what the tool shows for that drag
// (controlsForDrag: the line and the mood control set from its start). --grid writes two sheets per look: one start
// with 8 directions at one length, and one direction at 3 lengths.
// Usage: node scripts/light/control-sweep.mjs [--look ramp,bands,...]
//   [--control intensity,softness,horizon|light,startx,starty,angle,length|line] [--pack bold,...] [--seeds 1-12,5081]
//   [--format 16x9,9x16] [--at intensity=0.75,softness=1,horizon=0.79] [--from 0] [--to 1]
//   [--line 0.35,0.7,-40,0.6 ...] [--quick] [--rev HEAD [--patch file] | --tree] [--label text] [--out dir]
//   [--ratio 4] [--floor 0.003] [--peak-floor 0.02] [--frames 0:1:0.1] [--no-strips] [--strip-all]
//   [--tool-check http://localhost:3000]
//   node scripts/light/control-sweep.mjs --grid [--look ...] [--pack bold] [--seeds 1-3] [--format 16x9] [--out dir]
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFile, cp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { list, parseArgs } from './lib/args.mjs'
import { ROOT, startHarness } from './lib/harness.mjs'

const LOOKS = ['sunset.ramp', 'sunset.bands', 'sunset.blooms', 'contour.rim', 'contour.halo', 'contour.beam', 'contour.streaks']
const PACKS = ['bold', 'elemental', 'atmospheric']
/** The dragged line's sweeps: its start along x or y (frame units), its angle (turns) and its length (short sides). */
const LINE_CONTROLS = ['startx', 'starty', 'angle', 'length']
/**
 * The mood slider with a line set: `afterdrag` moves the line with the slider as the tool does (the light should move
 * once, by the slider's amount); `moodalone` holds the line still (a look that places its light from the line alone
 * doesn't change at all).
 */
const AFTER_DRAG_CONTROLS = ['afterdrag', 'moodalone']
const CONTROLS = ['intensity', 'softness', 'mood']
const FORMATS = ['16x9', '9x16', '1x1', '4x5']
/** Base lines: start x and y in frame units, angle in degrees (0 points right, -90 up), length in short sides. */
const BASE_LINES = [
  { from: [0.35, 0.7], angle: -40, length: 0.6 },
  { from: [0.7, 0.35], angle: 150, length: 0.4 },
  { from: [0.5, 0.92], angle: -90, length: 0.9 },
]
/** The grid sheets: one start with 8 directions at one length, and one direction at 3 lengths. */
const SHEET_START = { from: [0.5, 0.55], length: 0.5 }
const SHEET_DIRECTION = { from: [0.5, 0.88], angle: -90 }
const SHEET_LENGTHS = [0.25, 0.5, 0.9]
/** Long side of the frames the change is measured on, and how much larger they are rendered. */
const THUMB = 160
const RENDER_FACTOR = 2
/** Steps on each side that make up "the steps around" a step. */
const WINDOW = 6
/** Below this mean ΔE a step counts as no change when it is compared with the steps around it. */
const NOISE = 0.0005
/** The local change: the mean ΔE in the worst block of BLOCK x BLOCK thumbnail pixels. */
const BLOCK = 10
const PEAK_NOISE = 0.002
/** ΔE shown as white in the heat maps. */
const HEAT_MAX = 0.15
const BACKGROUND = '#161616'
/** Strips and sheets are only looked at, so they are JPEGs: a full audit writes hundreds. */
const JPEG_QUALITY = 82
const SNAPSHOT_FLAGS = ['rev', 'tree']

const args = parseArgs()

// --rev and --tree run this script again inside a copy of the code (a commit, or the working tree as it is now), so
// edits other agents make during the run cannot change the frames halfway through a sweep.
if (args.rev !== undefined || args.tree !== undefined) process.exit(await runInCopy())

const quick = args.quick === true
const grid = args.grid === true
const looks = list(args.look).length ? list(args.look).map(lookId) : LOOKS
const controls = list(args.control).length
  ? list(args.control).flatMap((name) => (name === 'line' ? LINE_CONTROLS : name === 'slider' ? AFTER_DRAG_CONTROLS : [controlKey(name)]))
  : CONTROLS
const packs = list(args.pack).length ? list(args.pack) : grid ? ['bold'] : PACKS
const seeds = parseSeeds(args.seeds, grid ? range(1, 3) : quick ? range(1, 6) : [...range(1, 12), 5081])
const formats = list(args.format).length ? list(args.format) : quick || grid ? ['16x9'] : ['16x9', '9x16']
const base = parseBase(args.at)
const values = range(Math.round(Number(args.from ?? 0) * 100), Math.round(Number(args.to ?? 1) * 100)).map((i) => i / 100)
/** Line sweeps: the base lines they start from, and each control's values (starts to 0.25 past each edge; --reach for more). */
const baseLines = args.line === undefined ? (quick ? BASE_LINES.slice(0, 1) : BASE_LINES) : [].concat(args.line).map(parseLine)
/** --reach R runs the start sweeps from -R to 1 + R, past the image's edges. */
const reach = args.reach === undefined ? null : Number(args.reach)
/** --off d1,d2 with --grid: sheets of lines that start off each edge and corner at those distances (frame units). */
const offDistances = list(args.off).map(Number)
/** --off-to mirror: those lines cross the frame to the point opposite their start; center (default): to the middle. */
const offToMirror = args['off-to'] === 'mirror'
const LINE_VALUES = {
  startx: reach !== null ? stepsBetween(-reach, 1 + reach) : stepsBetween(quick ? 0 : -0.25, quick ? 1 : 1.25),
  starty: reach !== null ? stepsBetween(-reach, 1 + reach) : stepsBetween(quick ? 0 : -0.25, quick ? 1 : 1.25),
  angle: stepsBetween(0, 1),
  length: stepsBetween(quick ? 0.1 : 0.05, quick ? 1 : 1.25),
  afterdrag: stepsBetween(0, 1),
  moodalone: stepsBetween(0, 1),
}
const ratioLimit = Number(args.ratio ?? 4)
const floor = Number(args.floor ?? 0.003)
const peakFloor = Number(args['peak-floor'] ?? 0.02)
const strips = args['no-strips'] !== true
const frameValues = parseFrames(args.frames)
const label = typeof args.label === 'string' ? args.label : `working tree at ${clock()}`
const outDir = path.resolve(ROOT, typeof args.out === 'string' ? args.out : defaultOut())

for (const pack of packs) if (!PACKS.includes(pack)) throw new Error(`Unknown pack ${pack}`)
for (const format of formats) if (!FORMATS.includes(format)) throw new Error(`Unknown format ${format}; use ${FORMATS.join(', ')}`)
if (values.length < 3) throw new Error('Sweep at least three values')

function range(a, b) {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i)
}

function defaultOut() {
  if (args.grid === true) return 'artifacts/control-sweep/grid'
  return args.quick === true ? 'artifacts/control-sweep/quick' : 'artifacts/control-sweep'
}

function lookId(name) {
  const id = LOOKS.find((look) => look === name || look.endsWith(`.${name}`))
  if (!id) throw new Error(`Unknown look ${name}; use ${LOOKS.join(', ')}`)
  return id
}

function controlKey(name) {
  if (name === 'horizon' || name === 'light' || name === 'mood') return 'mood'
  if (name === 'intensity' || name === 'softness' || LINE_CONTROLS.includes(name) || AFTER_DRAG_CONTROLS.includes(name)) return name
  throw new Error(`Unknown control ${name}; use intensity, softness, horizon, light, ${[...LINE_CONTROLS, ...AFTER_DRAG_CONTROLS].join(', ')}`)
}

/** Sweeps with a dragged line: the line's own controls and the mood slider with a line set. */
const isLine = (control) => LINE_CONTROLS.includes(control) || AFTER_DRAG_CONTROLS.includes(control)

/** The tool's 0.01 steps from a to b. */
function stepsBetween(a, b) {
  return range(Math.round(a * 100), Math.round(b * 100)).map((i) => i / 100)
}

/** "x,y,angle,length": a base line's start (frame units), angle (degrees, 0 right, -90 up) and length (short sides). */
function parseLine(value) {
  const [x, y, angle, length] = String(value).split(',').map(Number)
  if (![x, y, angle, length].every(Number.isFinite) || length <= 0) throw new Error(`--line must look like 0.35,0.7,-40,0.6, got ${value}`)
  return { from: [x, y], angle, length }
}

const baseText = (base) => `start ${base.from.join(',')}, ${base.angle} degrees, length ${base.length}`
const baseTag = (base) => `${base.from.join('_')}_${base.angle}_${base.length}`

/** A sweep's name in captions, and in file names (no spaces). */
function sweepName(sweep) {
  const mood = controlName(sweep.look, 'mood')
  if (sweep.control === 'afterdrag') return `${mood} after a drag (line ${baseText(sweep.base)})`
  if (sweep.control === 'moodalone') return `${mood} with the line held (${baseText(sweep.base)})`
  return isLine(sweep.control) ? `line ${sweep.control} (${baseText(sweep.base)})` : controlName(sweep.look, sweep.control)
}

function sweepFileName(sweep) {
  return isLine(sweep.control) ? `${sweep.control}-${baseTag(sweep.base)}` : controlName(sweep.look, sweep.control)
}

/**
 * The line in frame units for a start, an angle (degrees, y down) and a length in short sides, so a line keeps its
 * length on screen whichever way it points.
 */
function lineAt(from, angle, length, aspect) {
  const [fw, fh] = aspect >= 1 ? [aspect, 1] : [1, 1 / aspect]
  const turn = (angle * Math.PI) / 180
  return { from, to: [from[0] + (length * Math.cos(turn)) / fw, from[1] + (length * Math.sin(turn)) / fh] }
}

/** The dragged line for a line sweep's value. */
function lineOf(sweep, value, aspect) {
  const { from, angle, length } = sweep.base
  switch (sweep.control) {
    case 'startx':
      return lineAt([value, from[1]], angle, length, aspect)
    case 'starty':
      return lineAt([from[0], value], angle, length, aspect)
    case 'angle':
      return lineAt(from, angle + 360 * value, length, aspect)
    case 'length':
      return lineAt(from, angle, value, aspect)
    case 'afterdrag':
    case 'moodalone':
      return lineAt(from, angle, length, aspect)
    default:
      throw new Error(`Not a line control: ${sweep.control}`)
  }
}

/** The control's name in the tool. */
function controlName(look, control) {
  return control === 'mood' ? (look.startsWith('sunset.') ? 'horizon' : 'light') : control
}

function parseSeeds(value, fallback) {
  const items = list(value)
  if (!items.length) return fallback
  return items.flatMap((item) => {
    const match = /^(\d+)-(\d+)$/.exec(item)
    return match ? range(Number(match[1]), Number(match[2])) : [Number(item)]
  })
}

/** Values for --frames: a list (0,0.5,1) or from:to:step (0:1:0.1, or -0.2:1.2:0.2 for a point), on the tool's 0.01 grid. */
function parseFrames(value) {
  if (typeof value !== 'string') return []
  const match = /^(-?[\d.]+):(-?[\d.]+):([\d.]+)$/.exec(value)
  const numbers = match
    ? range(0, Math.round((Number(match[2]) - Number(match[1])) / Number(match[3]))).map((k) => Number(match[1]) + k * Number(match[3]))
    : list(value).map(Number)
  return numbers.map((v) => Math.round(v * 100) / 100)
}

/** The other controls' values: the tool's defaults unless --at sets them. */
function parseBase(value) {
  const out = { intensity: 0.5, softness: 0.5, mood: 0.5 }
  for (const item of list(value)) {
    const [key, number] = item.split('=')
    out[controlKey(key)] = Math.round(Number(number) * 100) / 100
  }
  return out
}

function clock() {
  return new Date().toTimeString().slice(0, 5)
}

/** A path relative to the repo the run started from (a copy runs with that repo in CONTROL_SWEEP_REPO). */
function shown(file) {
  return path.relative(process.env.CONTROL_SWEEP_REPO ?? ROOT, file) || '.'
}

async function runInCopy() {
  const rev = typeof args.rev === 'string' ? args.rev : null
  const sha = rev ? execFileSync('git', ['rev-parse', '--short', rev], { cwd: ROOT, encoding: 'utf8' }).trim() : null
  const patch = typeof args.patch === 'string' ? path.resolve(ROOT, args.patch) : null
  // Every run makes its own copy and removes it at the end: other agents may sweep the same commit at the same time.
  const dir = path.join(os.tmpdir(), `control-sweep-${rev ? sha : 'tree'}-${process.pid}`)
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  const paths = ['src', 'scripts', 'package.json', 'tsconfig.json']
  if (rev) {
    const tar = path.join(dir, 'code.tar')
    execFileSync('git', ['archive', '--format=tar', '-o', tar, sha, ...paths], { cwd: ROOT })
    execFileSync('tar', ['-xf', tar, '-C', dir])
    await rm(tar)
  } else {
    for (const item of paths) await cp(path.join(ROOT, item), path.join(dir, item), { recursive: true })
  }
  if (patch) execFileSync('git', ['apply', patch], { cwd: dir })
  await symlink(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'))
  // The copy runs this version of the script, whatever version the commit has.
  const script = path.join(dir, 'scripts/light/control-sweep.mjs')
  await copyFile(fileURLToPath(import.meta.url), script)
  const forward = []
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '').split('=')[0]
    if (SNAPSHOT_FLAGS.includes(key) || key === 'patch' || key === 'out' || key === 'label') {
      if (!argv[i].includes('=') && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) i++
      continue
    }
    forward.push(argv[i])
  }
  const source = rev ? `${sha.startsWith(rev) ? sha : `${rev} ${sha}`}${patch ? ` + ${path.basename(patch)}` : ''}` : `uncommitted, working tree at ${clock()}`
  const runLabel = typeof args.label === 'string' ? args.label : source
  const out = path.resolve(ROOT, typeof args.out === 'string' ? args.out : defaultOut())
  console.log(`Running on a copy of ${source} in ${dir}`)
  try {
    const result = spawnSync(process.execPath, [script, ...forward, '--out', out, '--label', runLabel], {
      cwd: dir,
      stdio: 'inherit',
      env: { ...process.env, CONTROL_SWEEP_REPO: ROOT },
    })
    return result.status ?? 1
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function median(numbers) {
  const sorted = [...numbers].sort((x, y) => x - y)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : 0.5 * (sorted[mid - 1] + sorted[mid])
}

/** Mean ΔE over the frame, the worst block's mean ΔE, and the ΔE per pixel, between two Oklab thumbnails. */
function change(a, b) {
  const { width, height } = a
  const blocksX = Math.ceil(width / BLOCK)
  const sums = new Float64Array(blocksX * Math.ceil(height / BLOCK))
  const counts = new Uint32Array(sums.length)
  const perPixel = new Float32Array(width * height)
  let total = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      const i = p * 3
      const dl = a.lab[i] - b.lab[i]
      const da = a.lab[i + 1] - b.lab[i + 1]
      const db = a.lab[i + 2] - b.lab[i + 2]
      const d = Math.sqrt(dl * dl + da * da + db * db)
      perPixel[p] = d
      total += d
      const k = Math.floor(y / BLOCK) * blocksX + Math.floor(x / BLOCK)
      sums[k] += d
      counts[k]++
    }
  }
  let peak = 0
  for (let k = 0; k < sums.length; k++) peak = Math.max(peak, sums[k] / counts[k])
  return { mean: total / (width * height), peak, perPixel }
}

/** Steps far larger than the steps around them; flagged steps next to each other make one jump. */
function findJumps(steps, peaks) {
  const flagged = []
  for (let i = 0; i < steps.length; i++) {
    const around = []
    for (let j = Math.max(0, i - WINDOW); j <= Math.min(steps.length - 1, i + WINDOW); j++) if (j !== i) around.push(j)
    const usual = median(around.map((j) => steps[j]))
    const usualPeak = median(around.map((j) => peaks[j]))
    const ratio = steps[i] / Math.max(usual, NOISE)
    const peakRatio = peaks[i] / Math.max(usualPeak, PEAK_NOISE)
    if ((steps[i] >= floor && ratio >= ratioLimit) || (peaks[i] >= peakFloor && peakRatio >= ratioLimit)) {
      flagged.push({ i, step: steps[i], usual, ratio, peak: peaks[i], peakRatio })
    }
  }
  const jumps = []
  for (const flag of flagged) {
    const last = jumps.at(-1)
    if (last && flag.i === last.to + 1) {
      last.to = flag.i
      if (flag.step > last.step) Object.assign(last, { i: flag.i, step: flag.step, usual: flag.usual, ratio: flag.ratio })
      last.peak = Math.max(last.peak, flag.peak)
    } else jumps.push({ ...flag, from: flag.i, to: flag.i })
  }
  return jumps
}

/** Numbers, booleans (as 0 or 1) and strings of a nested value, by path. */
function flatten(value, prefix = '', out = {}) {
  if (typeof value === 'number' || typeof value === 'string') out[prefix] = value
  else if (typeof value === 'boolean') out[prefix] = value ? 1 : 0
  else if (Array.isArray(value)) value.forEach((v, k) => flatten(v, `${prefix}[${k}]`, out))
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out)
  return out
}

/** How far apart two values are: numbers by size; anything else 0 when equal, Infinity when not. */
function difference(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(b - a)
  return a === b ? 0 : Infinity
}

function show(value) {
  return typeof value === 'number' ? String(Math.round(value * 1e4) / 1e4) : String(value)
}

/** The ΔE a heat map shows as white: the 99th percentile of its pixels, between 0.01 and HEAT_MAX. */
function heatScale(perPixel) {
  const sorted = Float32Array.from(perPixel).sort()
  return Math.min(HEAT_MAX, Math.max(0.01, sorted[Math.floor(0.99 * (sorted.length - 1))]))
}

/** ΔE per pixel as grey, white at `white`. */
function heatmap(perPixel, width, height, white = HEAT_MAX) {
  const data = Buffer.alloc(width * height * 4)
  for (let p = 0; p < width * height; p++) {
    const v = Math.min(255, Math.round((perPixel[p] / white) * 255))
    data.fill(v, p * 4, p * 4 + 3)
    data[p * 4 + 3] = 255
  }
  return { width, height, data }
}

async function enlarge(image, factor) {
  const { data, info } = await sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } })
    .resize(image.width * factor, image.height * factor, { kernel: 'nearest' })
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, data }
}

function escapeXml(text) {
  return String(text).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c])
}

function textSvg(text, width, size = 13, color = '#c8c8c8') {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(width)}" height="${size + 8}"><text x="0" y="${size}" fill="${color}" font-family="Helvetica, Arial, sans-serif" font-size="${size}">${escapeXml(text)}</text></svg>`,
  )
}

/** Splits text into lines of at most `chars` characters at spaces. */
function wrap(text, chars) {
  const lines = []
  let line = ''
  for (const word of text.split(' ')) {
    if (line && line.length + word.length + 1 > chars) {
      lines.push(line)
      line = word
    } else line = line ? `${line} ${word}` : word
  }
  return line ? [...lines, line] : lines
}

/** Title lines (wrapped to the panels' width), then panels in rows of up to `columns`, with a caption above each. */
async function composeStrip(file, title, panels, columns = panels.length) {
  const gap = 8
  const lineHeight = 20
  const captionHeight = 20
  const cellWidth = Math.max(...panels.map((p) => p.image.width)) + gap
  const cellHeight = captionHeight + Math.max(...panels.map((p) => p.image.height)) + gap
  const perRow = Math.min(columns, panels.length)
  const width = Math.max(perRow * cellWidth - gap, 640)
  const lines = [].concat(title).filter(Boolean).flatMap((text, k) => wrap(text, Math.floor((width - 8) / 7.4)).map((line) => ({ line, k })))
  const titleHeight = 6 + lines.length * lineHeight
  const height = titleHeight + Math.ceil(panels.length / perRow) * cellHeight - gap
  const composites = lines.map(({ line, k }, n) => ({ input: textSvg(line, width - 4, 13, k ? '#ffb070' : '#e8e8e8'), left: 4, top: 4 + n * lineHeight }))
  panels.forEach((panel, k) => {
    const x = (k % perRow) * cellWidth
    const y = titleHeight + Math.floor(k / perRow) * cellHeight
    composites.push({ input: panel.image.data, raw: { width: panel.image.width, height: panel.image.height, channels: 4 }, left: x, top: y + captionHeight })
    composites.push({ input: textSvg(panel.caption, panel.image.width - 4), left: x + 4, top: y })
  })
  await mkdir(path.dirname(file), { recursive: true })
  await sharp({ create: { width, height, channels: 3, background: BACKGROUND } }).composite(composites).jpeg({ quality: JPEG_QUALITY }).toFile(file)
}

/** One panel per control and pack: the change per step against the control's value, one line per seed, log scale. */
async function writeCurves(look, format, lookSweeps) {
  const panelWidth = 420
  const panelHeight = 200
  const gap = 18
  const top = 40
  const left = 50
  const lo = Math.log10(1e-4)
  const hi = Math.log10(0.3)
  // One row per control, and per base line for the line's controls.
  const rowOf = (s) => (isLine(s.control) ? `${s.control}@${baseTag(s.base)}` : s.control)
  const usedControls = [...new Set(lookSweeps.map(rowOf))]
  const usedPacks = [...new Set(lookSweeps.map((s) => s.pack))]
  const width = Math.max(left + usedPacks.length * (panelWidth + gap), 1300)
  const height = top + usedControls.length * (panelHeight + gap + 20) + 10
  const parts = [`<rect width="100%" height="100%" fill="${BACKGROUND}"/>`]
  const text = (x, y, value, size = 12, color = '#9a9a9a', anchor = 'start') =>
    parts.push(`<text x="${x}" y="${y}" fill="${color}" font-family="Helvetica, Arial, sans-serif" font-size="${size}" text-anchor="${anchor}">${escapeXml(value)}</text>`)
  const others = Object.entries(base)
    .map(([key, value]) => `${controlName(look, key)} ${value}`)
    .join(', ')
  text(8, 22, `${label}: ${look} ${format}. Change per 0.01 step (mean Oklab ΔE, log scale), one line per seed, red dots are jumps. Other controls at ${others}.`, 14, '#e8e8e8')
  usedControls.forEach((rowKey, row) => {
    const rowSweeps = lookSweeps.filter((s) => rowOf(s) === rowKey)
    const rowValues = rowSweeps[0].values
    usedPacks.forEach((pack, col) => {
      const x0 = left + col * (panelWidth + gap)
      const y0 = top + row * (panelHeight + gap + 20) + 18
      const yOf = (v) => y0 + panelHeight - ((Math.log10(Math.max(v, 1e-4)) - lo) / (hi - lo)) * panelHeight
      const xOf = (i) => x0 + ((rowValues[i] + rowValues[i + 1]) / 2 - rowValues[0]) / (rowValues.at(-1) - rowValues[0]) * panelWidth
      parts.push(`<rect x="${x0}" y="${y0}" width="${panelWidth}" height="${panelHeight}" fill="#1e1e1e" stroke="#333"/>`)
      for (const level of [1e-3, 1e-2, 1e-1]) {
        parts.push(`<line x1="${x0}" x2="${x0 + panelWidth}" y1="${yOf(level)}" y2="${yOf(level)}" stroke="#333"/>`)
        if (col === 0) text(x0 - 4, yOf(level) + 4, String(level), 10, '#777', 'end')
      }
      for (const tick of [0, 0.25, 0.5, 0.75, 1]) {
        const t = rowValues[0] + tick * (rowValues.at(-1) - rowValues[0])
        text(x0 + tick * panelWidth, y0 + panelHeight + 13, t.toFixed(2), 10, '#777', 'middle')
      }
      text(x0 + 4, y0 - 5, `${sweepName(rowSweeps[0])}, ${pack}`, 13, '#d8d8d8')
      for (const sweep of rowSweeps.filter((s) => s.pack === pack)) {
        const points = sweep.steps.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ')
        parts.push(`<polyline points="${points}" fill="none" stroke="${sweep.jumps.length ? '#e0a040' : '#6f9fd8'}" stroke-opacity="0.6" stroke-width="1.2"/>`)
        for (const jump of sweep.jumps) {
          const cx = xOf(jump.i)
          const cy = yOf(jump.step)
          parts.push(`<circle cx="${cx}" cy="${cy}" r="4" fill="#ff4040"/>`)
          text(cx + 5, cy - 4, `s${sweep.seed}`, 10, '#ff8080')
        }
      }
    })
  })
  const file = path.join(outDir, 'curves', `${look.split('.')[1]}-${format}.png`)
  await mkdir(path.dirname(file), { recursive: true })
  await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${parts.join('')}</svg>`))
    .png()
    .toFile(file)
}

const harness = await startHarness()
let failed = false
try {
  const info = await harness.info()
  const { buildScene, clampDrag, controlsForDrag, moodForPoint, moveDragWithMood, toolControls } = await harness.ssr('/src/tool/controls.ts')
  const { getPack } = await harness.ssr('/src/light/color/packs.ts')
  const { EXPORT_SIZES } = await harness.ssr('/src/light/engine/frame.ts')
  const { linearToOklab } = await harness.ssr('/src/light/color/oklab.ts')
  const { srgbToLinear } = await harness.ssr('/src/light/color/srgb.ts')
  const { getRecipe } = await harness.ssr('/src/light/recipes/index.ts')
  const { recipeContext, resolveScene } = await harness.ssr('/src/light/engine/resolve.ts')
  const toLinear = Float32Array.from({ length: 256 }, (_, i) => srgbToLinear(i / 255))

  const frameOf = (format) => {
    const size = EXPORT_SIZES[format.replace('x', ':')]
    const aspect = size.width / size.height
    const thumb = aspect >= 1 ? { width: THUMB, height: Math.round(THUMB / aspect) } : { width: Math.round(THUMB * aspect), height: THUMB }
    return { aspect, thumb, render: { width: thumb.width * RENDER_FACTOR, height: thumb.height * RENDER_FACTOR } }
  }

  const timing = { compose: 0, render: 0, measure: 0, frames: 0 }
  /** The tool's controls for a dragged line (as the tool clamps it), or the controls without one. */
  const controlsForLine = (look, pack, seed, format, line) => {
    const drag = line ? clampDrag(line) : undefined
    return drag ? controlsForDrag(look, getPack(pack), seed, base, frameOf(format).aspect, drag) : base
  }
  /** The tool's controls for a sweep's value: a slider at that value, or the line for that value. */
  /**
   * The lines the tool shows for each slider value after a drag: from the value the drag gave the slider (set from
   * the line's start), one 0.01 step at a time each way, the way the tool moves the line as the slider moves.
   */
  const steppedLines = new Map()
  const afterDragLine = (sweep, value) => {
    const key = `${sweep.look}|${sweep.pack}|${sweep.seed}|${sweep.format}|${baseTag(sweep.base)}`
    let lines = steppedLines.get(key)
    if (!lines) {
      const { aspect } = frameOf(sweep.format)
      const pack = getPack(sweep.pack)
      const line = clampDrag(lineOf(sweep, value, aspect))
      const first = Math.round((moodForPoint(sweep.look, pack, sweep.seed, aspect, line.from) ?? base.mood) * 100)
      lines = new Map([[first, line]])
      for (const way of [1, -1]) {
        let current = line
        for (let k = first + way; k >= 0 && k <= 100; k += way) {
          current = moveDragWithMood(sweep.look, pack, sweep.seed, aspect, current, (k - way) / 100, k / 100)
          lines.set(k, current)
        }
      }
      steppedLines.set(key, lines)
    }
    return lines.get(Math.round(value * 100))
  }
  /** The mood slider at `value` with the base line set: `afterdrag` moves the line as the tool does, `moodalone` holds it still. */
  const afterDragControls = (sweep, value) => {
    if (sweep.control === 'moodalone') return { ...base, mood: value, drag: clampDrag(lineOf(sweep, value, frameOf(sweep.format).aspect)) }
    return { ...base, mood: value, drag: afterDragLine(sweep, value) }
  }
  const controlsFor = (sweep, value) => {
    if (AFTER_DRAG_CONTROLS.includes(sweep.control)) return afterDragControls(sweep, value)
    return isLine(sweep.control)
      ? controlsForLine(sweep.look, sweep.pack, sweep.seed, sweep.format, lineOf(sweep, value, frameOf(sweep.format).aspect))
      : { ...base, [sweep.control]: value }
  }
  const sceneFor = (sweep, value) => {
    const start = performance.now()
    const scene = buildScene(sweep.look, getPack(sweep.pack), sweep.seed, controlsFor(sweep, value), frameOf(sweep.format).aspect)
    timing.compose += performance.now() - start
    return scene
  }

  /**
   * A copy of a frame with the dragged line drawn on it (frame units): white with a dark edge, and a ring at the start,
   * where the light should be strongest, so a sheet shows what the drag asked for.
   */
  const withLine = (image, line) => {
    const data = Buffer.from(image.data)
    const { width, height } = image
    const [ax, ay] = [line.from[0] * width, line.from[1] * height]
    const [bx, by] = [line.to[0] * width, line.to[1] * height]
    const ring = 0.03 * Math.min(width, height)
    const dx = bx - ax
    const dy = by - ay
    const length2 = Math.max(dx * dx + dy * dy, 1e-9)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const px = x + 0.5
        const py = y + 0.5
        const t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / length2))
        const toLine = Math.hypot(ax + t * dx - px, ay + t * dy - py)
        const toRing = Math.abs(Math.hypot(px - ax, py - ay) - ring)
        const d = Math.min(toLine, toRing)
        if (d > 2) continue
        data.fill(d < 0.8 ? 255 : 0, (y * width + x) * 4, (y * width + x) * 4 + 3)
      }
    }
    return { width, height, data }
  }
  const shownFrame = (sweep, value, image) => {
    const drag = isLine(sweep.control) ? controlsFor(sweep, value).drag : undefined
    return drag ? withLine(image, drag) : image
  }

  const renderFrame = async (sweep, value, size = frameOf(sweep.format).render) => {
    const scene = sceneFor(sweep, value)
    const start = performance.now()
    const image = await harness.render({ scene, width: size.width, height: size.height, supersample: 2 })
    timing.render += performance.now() - start
    timing.frames++
    return image
  }

  /** Oklab per pixel of the frame averaged down by `factor` in linear light. */
  const labThumb = (image, factor = RENDER_FACTOR) => {
    const width = Math.floor(image.width / factor)
    const height = Math.floor(image.height / factor)
    const lab = new Float32Array(width * height * 3)
    const n = factor * factor
    for (let ty = 0; ty < height; ty++) {
      for (let tx = 0; tx < width; tx++) {
        let r = 0
        let g = 0
        let b = 0
        for (let dy = 0; dy < factor; dy++) {
          for (let dx = 0; dx < factor; dx++) {
            const i = ((ty * factor + dy) * image.width + tx * factor + dx) * 4
            r += toLinear[image.data[i]]
            g += toLinear[image.data[i + 1]]
            b += toLinear[image.data[i + 2]]
          }
        }
        lab.set(linearToOklab([r / n, g / n, b / n]), (ty * width + tx) * 3)
      }
    }
    return { width, height, lab }
  }

  /** Every number and string in the composed scene (`params`) and in the recipe's uniforms, by path. */
  const numbersAt = (sweep, value) => {
    const scene = sceneFor(sweep, value)
    const recipe = getRecipe(sweep.look)
    const uniforms = recipe.uniforms(recipeContext(resolveScene(recipe, scene), frameOf(sweep.format).aspect))
    const { params, colors, lens, output } = scene
    return { params: flatten({ params, colors, lens, output }), uniforms: flatten(uniforms) }
  }

  /**
   * The scene params and uniforms that jump at a jump: their change across it is more than 4 times their usual
   * change per step around it (or they switch where they otherwise hold still). That points at the code to fix.
   */
  const jumpCauses = (sweep, jump) => {
    const ks = range(Math.max(0, jump.from - 3), Math.min(sweep.values.length - 1, jump.to + 4))
    const sets = ks.map((k) => numbersAt(sweep, sweep.values[k]))
    const at = ks.indexOf(jump.from)
    const span = jump.to - jump.from + 1
    const causes = []
    for (const kind of ['params', 'uniforms']) {
      const keys = new Set(sets.flatMap((set) => Object.keys(set[kind])))
      for (const key of keys) {
        const series = sets.map((set) => set[kind][key])
        const deltas = series.slice(1).map((v, j) => difference(series[j], v))
        const across = Math.max(...deltas.slice(at, at + span))
        const usual = median(deltas.filter((_, j) => j < at || j >= at + span))
        const scale = Math.max(1e-6, ...series.filter((v) => typeof v === 'number').map(Math.abs)) * 1e-6
        if (across > scale && across > 4 * usual) {
          causes.push({ kind, key, before: series[at], after: series[at + span], usual, ratio: usual > 0 ? across / usual : Infinity })
        }
      }
    }
    return causes.sort((p, q) => q.ratio - p.ratio || p.key.localeCompare(q.key))
  }

  const describeCauses = (causes, count = 8) =>
    causes
      .slice(0, count)
      .map((c) => `${c.kind === 'params' ? '' : 'uniform '}${c.key} ${show(c.before)} → ${show(c.after)}${Number.isFinite(c.ratio) ? ` (${c.ratio.toFixed(0)}x usual)` : ''}`)
      .join('; ')

  /** The frames on both sides of a jump, two steps out, and where the jump changes the picture. */
  const writeStrip = async (sweep, jump) => {
    const name = sweepName(sweep)
    const panels = []
    const thumbs = new Map()
    let previous = null
    for (const k of range(Math.max(0, jump.from - 2), Math.min(sweep.values.length - 1, jump.to + 3))) {
      const image = await renderFrame(sweep, sweep.values[k])
      const thumb = labThumb(image)
      thumbs.set(k, thumb)
      const step = previous ? `  Δ ${change(previous, thumb).mean.toFixed(4)}` : ''
      panels.push({ image: shownFrame(sweep, sweep.values[k], image), caption: `${sweep.control === 'mood' ? name : sweep.control} ${sweep.values[k].toFixed(2)}${step}` })
      previous = thumb
    }
    const a = thumbs.get(jump.from)
    const { perPixel } = change(a, thumbs.get(jump.to + 1))
    const white = heatScale(perPixel)
    panels.push({ image: await enlarge(heatmap(perPixel, a.width, a.height, white), RENDER_FACTOR), caption: `ΔE ${jump.a.toFixed(2)} to ${jump.b.toFixed(2)}, white ${white.toFixed(3)}` })
    const title = `${label}: ${sweep.look} ${sweep.pack} seed ${sweep.seed} ${sweep.format}, ${name} ${jump.a.toFixed(2)} to ${jump.b.toFixed(2)}: ΔE ${jump.step.toFixed(4)}, ${jump.ratio.toFixed(1)}x the steps around it (${jump.usual.toFixed(4)}), worst block ${jump.peak.toFixed(3)}`
    const file = path.join(outDir, 'jumps', `${sweep.look.split('.')[1]}-${sweepFileName(sweep)}-${sweep.pack}-s${sweep.seed}-${sweep.format}-${jump.a.toFixed(2)}.jpg`)
    const causes = jump.causes ? `Jumps with it: ${describeCauses(jump.causes, 5) || 'nothing in the scene or uniforms'}` : ''
    await composeStrip(file, [title, causes], panels)
    return file
  }

  const othersText = (sweep) =>
    Object.entries(base)
      .filter(([key]) => key !== sweep.control && !(isLine(sweep.control) && key === 'mood'))
      .map(([key, value]) => `${controlName(sweep.look, key)} ${value}`)
      .concat(isLine(sweep.control) && !AFTER_DRAG_CONTROLS.includes(sweep.control) ? [`${controlName(sweep.look, 'mood')} set from the line's start`] : [])
      .join(', ')

  /** Frames at the --frames values, with the change from the frame before; returns the frames for the contact sheet. */
  const writeFrames = async (sweep) => {
    const name = sweepName(sweep)
    const panels = []
    let previous = null
    for (const value of frameValues) {
      const image = await renderFrame(sweep, value)
      const thumb = labThumb(image)
      const caption = isLine(sweep.control) ? `${sweep.control} ${value.toFixed(2)}` : `${name} ${value.toFixed(2)}`
      panels.push({ image: shownFrame(sweep, value, image), caption: `${caption}${previous ? `  Δ ${change(previous, thumb).mean.toFixed(3)}` : ''}` })
      previous = thumb
    }
    const file = path.join(outDir, 'frames', `${sweep.look.split('.')[1]}-${sweepFileName(sweep)}-${sweep.pack}-s${sweep.seed}-${sweep.format}.jpg`)
    const columns = sweep.format === '16x9' ? 4 : 6
    await composeStrip(file, `${label}: ${sweep.look} ${sweep.pack} seed ${sweep.seed} ${sweep.format}, ${name} across its range (${othersText(sweep)}); Δ: mean ΔE from the frame before`, panels, columns)
    return panels
  }

  /** One sheet per look, control (and point line) and format: a row of frames per pack and seed, a column per --frames value. */
  const writeContact = async (look, sweepKey, format, rows) => {
    const name = sweepName({ look, ...sweepKey })
    const fileName = sweepFileName({ look, ...sweepKey })
    const control = sweepKey.control
    const { thumb } = frameOf(format)
    const scale = format === '16x9' ? 1.2 : 0.75
    const width = Math.round(thumb.width * scale)
    const height = Math.round(thumb.height * scale)
    const labelWidth = 120
    const gap = 4
    const top = 48
    const sheetWidth = labelWidth + frameValues.length * (width + gap)
    const composites = [
      { input: textSvg(`${label}: ${look} ${format}, ${name} at ${frameValues.map((v) => v.toFixed(2)).join(', ')}; other controls ${othersText({ look, control })}`, sheetWidth - 8, 14, '#e8e8e8'), left: 4, top: 4 },
    ]
    frameValues.forEach((value, c) => composites.push({ input: textSvg(`${name} ${value.toFixed(2)}`, width), left: labelWidth + c * (width + gap) + 2, top: top - 20 }))
    for (const [r, row] of rows.entries()) {
      const y = top + r * (height + gap)
      composites.push({ input: textSvg(`${row.pack} s${row.seed}`, labelWidth - 6), left: 4, top: y + height / 2 - 8 })
      for (const [c, panel] of row.panels.entries()) {
        const small = await sharp(panel.image.data, { raw: { width: panel.image.width, height: panel.image.height, channels: 4 } }).resize(width, height).png().toBuffer()
        composites.push({ input: small, left: labelWidth + c * (width + gap), top: y })
      }
    }
    const file = path.join(outDir, 'contact', `${look.split('.')[1]}-${fileName}-${format}.jpg`)
    await mkdir(path.dirname(file), { recursive: true })
    await sharp({ create: { width: sheetWidth, height: top + rows.length * (height + gap), channels: 3, background: BACKGROUND } })
      .composite(composites)
      .jpeg({ quality: JPEG_QUALITY })
      .toFile(file)
  }

  /**
   * The tool's settled canvas for a few frames of the first sweep next to the harness render of the same scene. The
   * tool reads only the line from the URL and sends its own fixed intensity, softness and mood control (`toolControls`),
   * so the harness renders those, and a sweep without a line gives one page, checked once. The drag hint, which shows
   * over the canvas on every page load until the first drag, is hidden.
   */
  const toolCheck = async (url, sweep) => {
    const browser = harness.page.context().browser()
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await page.addInitScript(() =>
      document.addEventListener('DOMContentLoaded', () => document.head.append(Object.assign(document.createElement('style'), { textContent: '.tool-hint{display:none!important}' }))),
    )
    const checked = new Set()
    try {
      for (const value of [sweep.values[0], sweep.values[sweep.values.length >> 1], sweep.values.at(-1)]) {
        const line = controlsFor(sweep, value).drag
        const [mood, look] = sweep.look.split('.')
        const query = new URLSearchParams({
          mood,
          look,
          pack: sweep.pack,
          ...(line ? { from: line.from.join(','), to: line.to.join(',') } : {}),
          seed: String(sweep.seed),
          format: sweep.format,
        })
        if (checked.has(String(query))) continue
        checked.add(String(query))
        await page.goto(`${url}/?${query}`, { waitUntil: 'load', timeout: 180_000 })
        await page.waitForFunction(() => document.querySelector('canvas')?.dataset.settled === 'true', null, { timeout: 120_000 })
        const canvas = page.locator('canvas').first()
        const size = await canvas.evaluate((element) => ({ width: element.width, height: element.height }))
        const shot = await sharp(await canvas.screenshot()).resize(size.width, size.height, { fit: 'fill' }).ensureAlpha().raw().toBuffer()
        const { aspect } = frameOf(sweep.format)
        const scene = buildScene(sweep.look, getPack(sweep.pack), sweep.seed, toolControls(sweep.look, getPack(sweep.pack), sweep.seed, aspect, line), aspect)
        const render = await harness.render({ scene, width: size.width, height: size.height, supersample: 2 })
        const factor = Math.max(1, Math.floor(Math.min(size.width, size.height) / frameOf(sweep.format).thumb[size.width >= size.height ? 'height' : 'width']))
        const tool = labThumb({ ...size, data: shot }, factor)
        const ours = labThumb(render, factor)
        const { mean, peak } = change(tool, ours)
        const file = path.join(outDir, 'tool-check', `${sweep.look.split('.')[1]}-${sweep.pack}-s${sweep.seed}-${sweepFileName(sweep)}-${value.toFixed(2)}.jpg`)
        await composeStrip(file, `${url}/?${query} (${size.width}x${size.height}): tool canvas, harness render; mean ΔE ${mean.toFixed(4)}, worst block ${peak.toFixed(4)}`, [
          { image: { ...size, data: shot }, caption: 'tool' },
          { image: render, caption: `harness (${label})` },
        ])
        console.log(`tool check ${query}: ${size.width}x${size.height}, mean ΔE ${mean.toFixed(4)}, worst block ${peak.toFixed(4)}; ${shown(file)}`)
      }
    } finally {
      await page.close()
    }
  }

  /** A frame of the look with the line dragged (or none) as the tool composes it, 1.5 times the sweep size, with the line drawn on it. */
  const renderLine = async (look, pack, seed, format, line) => {
    const { aspect, render } = frameOf(format)
    const controls = controlsForLine(look, pack, seed, format, line)
    const scene = buildScene(look, getPack(pack), seed, controls, aspect)
    const image = await harness.render({ scene, width: Math.round(render.width * 1.5), height: Math.round(render.height * 1.5), supersample: 2 })
    return { image: controls.drag ? withLine(image, controls.drag) : image, mood: controls.mood }
  }

  /**
   * Two sheets per look and format. Directions: per pack and seed, a 3 x 3 block with the seed's own frame in the middle
   * and the line from one start in 8 directions at one length, each frame where its direction points. Lengths: per pack
   * and seed, the seed's own frame and one direction at 3 lengths. The line is drawn on each frame.
   */
  const writeSheets = async (look, format) => {
    const { aspect } = frameOf(format)
    const moodName = controlName(look, 'mood')
    const others = `intensity ${base.intensity}, softness ${base.softness}`
    // Left to right, top to bottom: the direction each place in the block points to; null is the seed's own frame.
    const compass = [-135, -90, -45, 180, null, 0, 135, 90, 45]
    const directionPanels = []
    const lengthPanels = []
    for (const pack of packs) {
      for (const seed of seeds) {
        const own = await renderLine(look, pack, seed, format, null)
        const ownPanel = { image: own.image, caption: `${pack} s${seed}: own (${moodName} ${base.mood})` }
        for (const angle of compass) {
          if (angle === null) {
            directionPanels.push(ownPanel)
            continue
          }
          const frame = await renderLine(look, pack, seed, format, lineAt(SHEET_START.from, angle, SHEET_START.length, aspect))
          directionPanels.push({ image: frame.image, caption: `${angle} degrees, ${moodName} ${frame.mood}` })
        }
        lengthPanels.push(ownPanel)
        for (const length of SHEET_LENGTHS) {
          const frame = await renderLine(look, pack, seed, format, lineAt(SHEET_DIRECTION.from, SHEET_DIRECTION.angle, length, aspect))
          lengthPanels.push({ image: frame.image, caption: `length ${length}, ${moodName} ${frame.mood}` })
        }
      }
    }
    const directions = path.join(outDir, `${look.split('.')[1]}-directions-${format}.jpg`)
    await composeStrip(
      directions,
      `${label}: ${look} ${format}, ${others}. Each block: the seed's own frame in the middle, around it the line from ${SHEET_START.from.join(', ')} with length ${SHEET_START.length} short sides in 8 directions (0 right, -90 up), each where it points. The drawn line runs from the start (ring) to its end.`,
      directionPanels,
      3,
    )
    const lengths = path.join(outDir, `${look.split('.')[1]}-lengths-${format}.jpg`)
    await composeStrip(
      lengths,
      `${label}: ${look} ${format}, ${others}. Per row: the seed's own frame, then the line from ${SHEET_DIRECTION.from.join(', ')} at ${SHEET_DIRECTION.angle} degrees with length ${SHEET_LENGTHS.join(', ')} short sides. The drawn line runs from the start (ring) to its end.`,
      lengthPanels,
      SHEET_LENGTHS.length + 1,
    )
    console.log(`${look} ${format}: ${shown(directions)}, ${shown(lengths)}`)
  }

  /**
   * One sheet per look, format and distance: per seed (rows) and pack (columns) a 3 x 3 block with the seed's own frame
   * in the middle and, around it, the line starting `distance` off each edge and corner of the image, where it sits,
   * and running to the image's middle. Captions give the start and the frame's mean Oklab L, so a frame gone dark shows.
   */
  const writeOffSheet = async (look, format, distance) => {
    const { aspect, render } = frameOf(format)
    const d = distance
    const places = [[-d, -d], [0.5, -d], [1 + d, -d], [-d, 0.5], null, [1 + d, 0.5], [-d, 1 + d], [0.5, 1 + d], [1 + d, 1 + d]]
    const gap = 4
    const captionHeight = 18
    const cellWidth = render.width + gap
    const cellHeight = render.height + captionHeight + gap
    const blockWidth = 3 * cellWidth + 3 * gap
    const blockHeight = 3 * cellHeight + 3 * gap
    const titleHeight = 30
    const composites = [
      {
        input: textSvg(`${label}: ${look} ${format}. Per pack and seed: the seed's own frame in the middle; around it the line from ${d} off each edge and corner of the image ${offToMirror ? 'across it to the point opposite' : 'to its middle'} (drawn where it is on the image). L: mean Oklab L.`, packs.length * blockWidth - 8, 13, '#e8e8e8'),
        left: 4,
        top: 6,
      },
    ]
    for (const [row, seed] of seeds.entries()) {
      for (const [column, pack] of packs.entries()) {
        for (const [i, place] of places.entries()) {
          const end = place ? (offToMirror ? [1 - place[0], 1 - place[1]] : [0.5, 0.5]) : null
          const controls = controlsForLine(look, pack, seed, format, place ? { from: place, to: end } : null)
          const scene = buildScene(look, getPack(pack), seed, controls, aspect)
          const image = await harness.render({ scene, width: render.width, height: render.height, supersample: 2 })
          const thumb = labThumb(image)
          let sum = 0
          for (let k = 0; k < thumb.lab.length; k += 3) sum += thumb.lab[k]
          const meanL = (sum / (thumb.lab.length / 3)).toFixed(2)
          const shownImage = controls.drag ? withLine(image, controls.drag) : image
          const left = column * blockWidth + (i % 3) * cellWidth
          const top = titleHeight + row * blockHeight + Math.floor(i / 3) * cellHeight
          const caption = place ? `${place.map((v) => Math.round(v * 100) / 100).join(', ')}  L ${meanL}` : `${pack} s${seed} own  L ${meanL}`
          composites.push({ input: textSvg(caption, render.width - 4, 12), left: left + 2, top })
          composites.push({ input: shownImage.data, raw: { width: shownImage.width, height: shownImage.height, channels: 4 }, left, top: top + captionHeight })
        }
      }
    }
    const file = path.join(outDir, `${look.split('.')[1]}-off${d}${offToMirror ? '-across' : ''}-${format}.jpg`)
    await mkdir(outDir, { recursive: true })
    await sharp({ create: { width: packs.length * blockWidth, height: titleHeight + seeds.length * blockHeight, channels: 3, background: BACKGROUND } })
      .composite(composites)
      .jpeg({ quality: JPEG_QUALITY })
      .toFile(file)
    console.log(`${look} ${format} off ${d}: ${shown(file)}`)
  }

  if (grid) {
    for (const look of looks) {
      if (info.recipeErrors[look]) {
        console.log(`${look}: did not load: ${info.recipeErrors[look].split('\n')[0]}`)
        failed = true
        continue
      }
      for (const format of formats) {
        if (offDistances.length) for (const distance of offDistances) await writeOffSheet(look, format, distance)
        else await writeSheets(look, format)
      }
    }
  }

  const sweeps = []
  for (const look of grid ? [] : looks) {
    if (info.recipeErrors[look]) {
      console.log(`${look}: did not load: ${info.recipeErrors[look].split('\n')[0]}`)
      failed = true
      continue
    }
    for (const format of formats) {
      const lookSweeps = []
      // A line sweep runs once per base line; a slider sweep once.
      const sweepKeys = controls.flatMap((control) => (isLine(control) ? baseLines.map((line) => ({ control, base: line })) : [{ control }]))
      if (sweepKeys.some((key) => isLine(key.control)) && typeof controlsForDrag !== 'function') {
        console.log('This code has no controlsForDrag (src/tool/controls.ts), so the line sweeps are skipped.')
      }
      for (const sweepKey of sweepKeys) {
        if (isLine(sweepKey.control) && typeof controlsForDrag !== 'function') continue
        const sweepValues = isLine(sweepKey.control) ? LINE_VALUES[sweepKey.control] : values
        const contactRows = []
        for (const pack of packs) {
          for (const seed of seeds) {
            const sweep = { look, ...sweepKey, pack, seed, format, values: sweepValues }
            const steps = []
            const peaks = []
            let previous = null
            for (const value of sweepValues) {
              const image = await renderFrame(sweep, value)
              const start = performance.now()
              const thumb = labThumb(image)
              if (previous) {
                const { mean, peak } = change(previous, thumb)
                steps.push(mean)
                peaks.push(peak)
              }
              previous = thumb
              timing.measure += performance.now() - start
            }
            const jumps = findJumps(steps, peaks).map((jump) => ({ ...jump, a: sweepValues[jump.from], b: sweepValues[jump.to + 1] }))
            for (const jump of jumps) jump.causes = jumpCauses(sweep, jump)
            const result = { ...sweep, steps, peaks, jumps }
            lookSweeps.push(result)
            sweeps.push(result)
            const largest = Math.max(...steps)
            const at = steps.indexOf(largest)
            const notes = jumps.map((j) => `${j.a.toFixed(2)}-${j.b.toFixed(2)} ΔE ${j.step.toFixed(4)} (${j.ratio.toFixed(1)}x, worst block ${j.peak.toFixed(3)})`)
            console.log(
              `${look} ${sweepName(sweep)} ${pack} seed ${seed} ${format}: largest step ${largest.toFixed(4)} at ${sweepValues[at].toFixed(2)}-${sweepValues[at + 1].toFixed(2)}, median ${median(steps).toFixed(4)}${notes.length ? `  JUMP ${notes.join(', ')}` : ''}`,
            )
            for (const jump of jumps) console.log(`    jumps with it: ${describeCauses(jump.causes) || 'nothing in the scene or uniforms (look in the shader)'}`)
            if (jumps.length) failed = true
            if (strips) for (const jump of jumps) await writeStrip(result, jump)
            if (frameValues.length) contactRows.push({ pack, seed, panels: await writeFrames(result) })
            if (args['strip-all'] === true) await writeStrip(result, { from: at, to: at, i: at, a: sweepValues[at], b: sweepValues[at + 1], step: largest, usual: median(steps), ratio: largest / Math.max(median(steps), NOISE), peak: peaks[at] })
          }
        }
        if (contactRows.length) await writeContact(look, sweepKey, format, contactRows)
      }
      if (lookSweeps.length) await writeCurves(look, format, lookSweeps)
    }
  }

  await mkdir(outDir, { recursive: true })
  const round = (x) => Math.round(x * 1e5) / 1e5
  await writeFile(
    path.join(outDir, 'steps.json'),
    JSON.stringify({
      label,
      base,
      values: [values[0], values.at(-1)],
      thresholds: { ratio: ratioLimit, floor, peakFloor, window: WINDOW },
      sweeps: sweeps.map(({ values: run, ...s }) => ({ ...s, range: [run[0], run.at(-1)], steps: s.steps.map(round), peaks: s.peaks.map(round) })),
    }),
  )
  const jumpCount = sweeps.reduce((n, s) => n + s.jumps.length, 0)
  const perFrame = (ms) => (ms / Math.max(1, timing.frames)).toFixed(1)
  console.log(`${label}: ${sweeps.length} sweeps, ${jumpCount} jumps. Wrote ${shown(outDir)}`)
  console.log(`${timing.frames} frames; per frame ${perFrame(timing.compose)} ms compose, ${perFrame(timing.render)} ms render, ${perFrame(timing.measure)} ms measure`)
  if (typeof args['tool-check'] === 'string' && sweeps.length) await toolCheck(args['tool-check'], sweeps[0])
} finally {
  await harness.close()
}
process.exit(failed ? 1 : 0)
