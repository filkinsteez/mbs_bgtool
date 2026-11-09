// Drags a line on the tool page with real pointer input in system Chrome (Playwright) and reports, per look, how the
// preview keeps up: the time between animation frames during the drag, the time of each 1x preview render, and
// shader compiles during the drag (there should be none). With --checks it also clicks, drags, double-clicks, drags
// with touch and a pen and shuffles the seed, and checks the URL and the line shown while dragging after each. The
// panel has no Softness or mood sliders (owner, 2026-11-09); a look is opened by its URL. It uses a running dev server
// (the owner's at http://localhost:3000 by default) and never starts one.
// Usage: node scripts/light/drag-check.mjs [--url http://localhost:3000] [--look ramp,rim,...] [--pack bold] [--seed 3]
//   [--format 16x9] [--checks] [--steps 120] [--step-ms 8] [--out dir]
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from '@playwright/test'
import { list, parseArgs } from './lib/args.mjs'
import { ROOT } from './lib/harness.mjs'

const LOOKS = ['sunset.ramp', 'sunset.bands', 'sunset.blooms', 'contour.rim', 'contour.halo', 'contour.beam', 'contour.streaks']

const args = parseArgs()
const url = typeof args.url === 'string' ? args.url.replace(/\/$/, '') : 'http://localhost:3000'
const looks = list(args.look).length ? list(args.look).map((name) => LOOKS.find((id) => id === name || id.endsWith(`.${name}`)) ?? name) : LOOKS
const pack = typeof args.pack === 'string' ? args.pack : 'bold'
const seed = Number(args.seed ?? 3)
const format = typeof args.format === 'string' ? args.format : '16x9'
const steps = Number(args.steps ?? 120)
const stepMs = Number(args['step-ms'] ?? 8)
const outDir = path.resolve(ROOT, typeof args.out === 'string' ? args.out : 'artifacts/drag-check')
for (const look of looks) if (!LOOKS.includes(look)) throw new Error(`Unknown look ${look}; use ${LOOKS.join(', ')}`)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[xs.length >> 1] : Number.NaN)
const percentile = (xs, p) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))] : Number.NaN)
const fixed = (x, digits = 1) => (Number.isFinite(x) ? x.toFixed(digits) : '-')
const near = (a, b, tolerance = 0.003) => Array.isArray(a) && a.every((v, i) => Math.abs(v - b[i]) < tolerance)

/** Counts shader compiles, records animation frame times and the preview's draws while recording. */
function instrument() {
  const state = { compiles: 0, links: 0, recording: false, ticks: [], draws: [], compiled: [], observer: null, from: { compiles: 0, links: 0 } }
  window.__drag = state
  const proto = WebGL2RenderingContext.prototype
  const compile = proto.compileShader
  proto.compileShader = function (shader) {
    state.compiles++
    if (state.recording) {
      const source = this.getShaderSource(shader) ?? ''
      state.compiled.push({ length: source.length, functions: [...source.matchAll(/\n(?:vec[234]|float|void)\s+(\w+)\s*\(/g)].map((m) => m[1]).slice(-6) })
    }
    return compile.call(this, shader)
  }
  const link = proto.linkProgram
  proto.linkProgram = function (program) {
    state.links++
    return link.call(this, program)
  }
  const tick = (time) => {
    if (state.recording) state.ticks.push(time)
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  state.start = () => {
    state.ticks = []
    state.draws = []
    state.compiled = []
    state.from = { compiles: state.compiles, links: state.links }
    const canvas = document.querySelector('.tool-frame canvas')
    state.observer = new MutationObserver(() => {
      const data = canvas.dataset
      state.draws.push({ time: performance.now(), supersample: Number(data.supersample), fastMs: Number(data.fastMs), settledMs: Number(data.settledMs), size: data.renderSize })
    })
    state.observer.observe(canvas, { attributes: true, attributeFilter: ['data-frame'] })
    state.recording = true
  }
  state.stop = () => {
    state.recording = false
    state.observer?.disconnect()
    return { ticks: state.ticks, draws: state.draws, compiled: state.compiled, compiles: state.compiles - state.from.compiles, links: state.links - state.from.links }
  }
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const report = { url, pack, seed, format, steps, stepMs, looks: {}, checks: [] }
let failed = false
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, hasTouch: true })
  await context.addInitScript(instrument)
  const page = await context.newPage()
  const errors = []
  const reloads = []
  page.on('pageerror', (error) => errors.push(error.message))
  // Another agent's edit makes the dev server push a module update; one that lands during a drag recompiles shaders.
  page.on('console', (message) => {
    if (/fast refresh|hmr/i.test(message.text())) reloads.push(Date.now())
  })
  const cdp = await context.newCDPSession(page)

  const settle = () => page.waitForFunction(() => document.querySelector('.tool-frame canvas')?.dataset.settled === 'true', null, { timeout: 120_000 })
  const open = async (look, extra = {}) => {
    const [mood, short] = look.split('.')
    const query = new URLSearchParams({ mood, look: short, pack, seed: String(seed), format, ...extra })
    await page.goto(`${url}/?${query}`, { waitUntil: 'load', timeout: 180_000 })
    await settle()
    // Let background compiles of the look's other programs finish before measuring.
    await sleep(1500)
    await settle()
  }
  const frameRect = () => page.evaluate(() => document.querySelector('.tool-frame').getBoundingClientRect().toJSON())
  const query = () => page.evaluate(() => Object.fromEntries(new URLSearchParams(window.location.search)))
  const pointOf = (value) => (value ? value.split(',').map(Number) : null)
  const waitForQuery = async (test, timeout = 3000) => {
    const end = Date.now() + timeout
    let q = await query()
    while (!test(q) && Date.now() < end) {
      await sleep(25)
      q = await query()
    }
    return q
  }
  const cursor = () => page.evaluate(() => getComputedStyle(document.querySelector('.tool-frame')).cursor)
  const lineShown = () => page.evaluate(() => getComputedStyle(document.querySelector('.tool-frame svg')).display !== 'none')
  const check = (name, ok, detail) => {
    report.checks.push({ name, ok: Boolean(ok), detail })
    if (!ok) failed = true
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`)
  }

  /**
   * A mouse drag through `points` (frame units) with a move every `stepMs`, sent without waiting for each to be
   * handled, the way a trackpad reports faster than the display draws.
   */
  const timedDrag = async (rect, points) => {
    const at = ([x, y]) => ({ x: rect.x + x * rect.width, y: rect.y + y * rect.height })
    const mouse = (type, p) => cdp.send('Input.dispatchMouseEvent', { type, ...at(p), button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at(points[0]), button: 'none', buttons: 0 })
    await mouse('mousePressed', points[0])
    const sent = []
    for (const p of points.slice(1)) {
      sent.push(mouse('mouseMoved', p))
      await sleep(stepMs)
    }
    await Promise.all(sent)
    await mouse('mouseReleased', points.at(-1))
  }

  /** One drag from a start right of the middle: the pointer circles the start, nearer and farther, so the line turns a full circle and its length changes. */
  const START = [0.45, 0.6]
  const loopPath = () => [
    START,
    ...Array.from({ length: steps }, (_, i) => {
      const angle = (2 * Math.PI * i) / (steps - 1)
      const reach = 0.18 + 0.12 * Math.sin(3 * angle)
      return [START[0] + reach * Math.cos(angle), START[1] + 1.6 * reach * Math.sin(angle)]
    }),
  ]

  for (const look of looks) {
    await open(look)
    const rect = await frameRect()
    const path = loopPath()
    await page.evaluate(() => window.__drag.start())
    const start = Date.now()
    await timedDrag(rect, path)
    const seconds = (Date.now() - start) / 1000
    const result = await page.evaluate(() => window.__drag.stop())
    const reloaded = reloads.some((time) => time >= start - 500)
    const intervals = result.ticks.slice(1).map((t, i) => t - result.ticks[i])
    const fast = result.draws.filter((d) => d.supersample === 1).map((d) => d.fastMs)
    const q = await waitForQuery((x) => Boolean(x.from))
    const row = {
      seconds,
      frames: result.ticks.length,
      frameMs: { median: median(intervals), p95: percentile(intervals, 0.95), max: Math.max(...intervals) },
      longFrames: intervals.filter((ms) => ms > 25).length,
      draws: fast.length,
      drawsPerSecond: fast.length / seconds,
      renderMs: { median: median(fast), p95: percentile(fast, 0.95), max: Math.max(...fast) },
      renderSize: result.draws.at(-1)?.size,
      compiles: result.compiles,
      links: result.links,
      compiled: result.compiled,
      reloaded,
      from: pointOf(q.from),
      to: pointOf(q.to),
      lastPointer: path.at(-1),
    }
    report.looks[look] = row
    console.log(
      `${look.padEnd(16)} ${row.renderSize}: frame ${fixed(row.frameMs.median)} ms median, ${fixed(row.frameMs.p95)} p95, ${fixed(row.frameMs.max)} max, ${row.longFrames} over 25 ms; ` +
        `${row.draws} draws (${fixed(row.drawsPerSecond, 0)}/s), render ${fixed(row.renderMs.median)} ms median, ${fixed(row.renderMs.p95)} p95; ` +
        `compiles ${row.compiles}${reloaded ? ' (a module update from the dev server landed during the drag)' : ''}; line ${q.from} to ${q.to}`,
    )
    for (const shader of result.compiled) console.log(`    compiled during the drag: ${shader.length} chars, ${shader.functions.join(', ')}`)
    if (result.compiles > 0 && !reloaded) failed = true
    if (!near(row.from, START) || !near(row.to, row.lastPointer)) check(`${look}: the URL has the dragged line`, false, `${q.from} to ${q.to}`)
  }

  if (args.checks === true) {
    for (const look of ['sunset.ramp', 'contour.rim']) {
      const mood = look.split('.')[0]
      await open(look)
      const rect = await frameRect()
      const at = ([x, y]) => [rect.x + x * rect.width, rect.y + y * rect.height]
      check(`${look}: grab cursor over the image`, (await cursor()) === 'grab', await cursor())

      // A click does nothing, and shows no line.
      const quiet = page.url()
      await page.mouse.move(...at([0.3, 0.6]))
      await page.mouse.down()
      const pressedCursor = await cursor()
      const lineOnClick = await lineShown()
      await page.mouse.up()
      await sleep(400)
      check(`${look}: closed hand while pressed`, pressedCursor === 'grabbing', pressedCursor)
      check(`${look}: a click without dragging does nothing`, page.url() === quiet && !lineOnClick, page.url().split('?')[1])

      // A drag: the line shows while dragging and goes on release; the URL changes only when it ends.
      await page.mouse.move(...at([0.3, 0.7]))
      await page.mouse.down()
      for (let i = 1; i <= 20; i++) {
        await page.mouse.move(...at([0.3 + i * 0.02, 0.7 - i * 0.015]))
        await sleep(20)
      }
      const shownWhileDragging = await lineShown()
      const during = page.url()
      await page.mouse.up()
      let q = await waitForQuery((x) => Boolean(x.from))
      check(`${look}: the line shows while dragging and goes on release`, shownWhileDragging && !(await lineShown()))
      check(`${look}: the URL changes when the drag ends, not during it`, during === quiet && near(pointOf(q.from), [0.3, 0.7]) && near(pointOf(q.to), [0.7, 0.4]), `from ${q.from} to ${q.to}`)

      // Shuffle picks a new seed, and the seed picks the look. A Sunrise line always stays; a Contour line stays when
      // the new look's light can come near its start and goes otherwise (keepsLine), and it never moves.
      q = await query()
      const lineKept = `${q.from} ${q.to}`
      await page.getByRole('button', { name: 'Shuffle' }).click()
      q = await waitForQuery((x) => x.seed !== String(seed))
      const lineNow = q.from ? `${q.from} ${q.to}` : null
      check(
        `${look}: a new seed ${mood === 'sunset' ? 'keeps the line' : 'keeps the line or clears it, and never moves it'}`,
        mood === 'sunset' ? lineNow === lineKept : lineNow === lineKept || lineNow === null,
        `seed ${q.seed}, look ${q.look}, line ${lineNow ?? 'cleared'}`,
      )

      // A double-click returns to the seed's own direction and reach; a fresh drag first, in case Shuffle cleared the line.
      await page.mouse.move(...at([0.3, 0.7]))
      await page.mouse.down()
      for (let i = 1; i <= 10; i++) await page.mouse.move(...at([0.3 + i * 0.03, 0.7 - i * 0.02]))
      await page.mouse.up()
      await waitForQuery((x) => Boolean(x.from))
      await page.mouse.dblclick(...at([0.5, 0.5]))
      q = await waitForQuery((x) => !x.from)
      check(`${look}: a double-click returns to the seed's own direction and reach`, !q.from && !q.to, page.url().split('?')[1])

      // Touch: a finger drag draws the line and neither scrolls the page nor selects text.
      const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: at(p)[0], y: at(p)[1] }] : [] })
      await touch('touchStart', [0.25, 0.7])
      for (let i = 1; i <= 30; i++) {
        await touch('touchMove', [0.25 + (0.5 * i) / 30, 0.7 - (0.25 * i) / 30])
        await sleep(stepMs)
      }
      await touch('touchEnd')
      q = await waitForQuery((x) => Boolean(x.from))
      const touched = await page.evaluate(() => ({ scroll: [window.scrollX, window.scrollY, document.scrollingElement?.scrollTop ?? 0], selection: window.getSelection()?.toString() ?? '' }))
      check(`${look}: a touch drag draws the line`, near(pointOf(q.from), [0.25, 0.7]) && near(pointOf(q.to), [0.75, 0.45]), `from ${q.from} to ${q.to}`)
      check(`${look}: a touch drag doesn't scroll or select`, touched.scroll.every((v) => v === 0) && touched.selection === '', JSON.stringify(touched))

      // A pen.
      const pen = (type, p) =>
        cdp.send('Input.dispatchMouseEvent', { type, x: at(p)[0], y: at(p)[1], button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'pen' })
      await pen('mousePressed', [0.6, 0.5])
      for (let i = 1; i <= 20; i++) {
        await pen('mouseMoved', [0.6 - (0.2 * i) / 20, 0.5 + (0.15 * i) / 20])
        await sleep(stepMs)
      }
      await pen('mouseReleased', [0.4, 0.65])
      q = await waitForQuery((x) => pointOf(x.from)?.[0] > 0.55)
      check(`${look}: a pen drag draws the line`, near(pointOf(q.from), [0.6, 0.5]) && near(pointOf(q.to), [0.4, 0.65]), `from ${q.from} to ${q.to}`)
    }
    check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  }
} finally {
  await browser.close()
}
await mkdir(outDir, { recursive: true })
await writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2))
console.log(`Wrote ${path.relative(ROOT, path.join(outDir, 'report.json'))}`)
process.exit(failed ? 1 : 0)
