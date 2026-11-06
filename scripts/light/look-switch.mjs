// How long the tool's page stops responding when you switch looks. Loads the tool in a fresh Chrome profile, then
// switches through all seven looks with the panel's keyboard keys, twice in the same page and once in a second page
// of the same browser. For each switch: the longest main-thread task (Long Tasks API) from the key press until the
// new look's settled frame, the time to its first frame and to its settled frame. Also the time from page load to
// the first frame. The page starts on Bands (or Halo with --start contour), so that look's first compile is in the
// page load; run both to time every look's first switch. The canvas's times for the new look's first 1x and 2x
// frames are kept too: from issuing the frame until it is on the canvas (data-fast-ms, data-settled-ms; whole
// animation frames, and any compile), and the GPU's own time for the render (data-fast-gpu-ms, data-settled-gpu-ms;
// when the browser offers EXT_disjoint_timer_query_webgl2). The longest task also catches other page work (in dev,
// hot reloads from other agents' edits). --no-parallel hides KHR_parallel_shader_compile from the page. Writes
// look-switch-<start>.json to --out.
// Usage: node scripts/light/look-switch.mjs [--start sunset|contour] [--no-parallel] [--url http://localhost:3000] [--label text] [--out dir]
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from '@playwright/test'
import { parseArgs } from './lib/args.mjs'
import { ROOT } from './lib/harness.mjs'

const args = parseArgs()
const url = typeof args.url === 'string' ? args.url : 'http://localhost:3000'
const label = typeof args.label === 'string' ? args.label : new Date().toTimeString().slice(0, 5)
const outDir = path.resolve(ROOT, typeof args.out === 'string' ? args.out : 'artifacts/look-switch')
const start = args.start === 'contour' ? 'contour' : 'sunset'
const START =
  start === 'contour'
    ? '/?mood=contour&look=halo&pack=bold&intensity=0.5&softness=0.5&light=0.5&seed=1&format=16x9'
    : '/?mood=sunset&look=bands&pack=bold&intensity=0.5&softness=0.5&horizon=0.5&seed=1&format=16x9'

/** Each step: which select to move and which way, and the look it lands on. Switching the mood lands on its first look. */
const SUNSET = [
  ['look', 'ArrowDown', 'sunset.ramp'],
  ['look', 'ArrowDown', 'sunset.blooms'],
]
const CONTOUR = [
  ['look', 'ArrowDown', 'contour.rim'],
  ['look', 'ArrowDown', 'contour.beam'],
  ['look', 'ArrowDown', 'contour.streaks'],
]
const STEPS =
  start === 'contour'
    ? [...CONTOUR, ['mood', 'ArrowUp', 'sunset.bands'], ...SUNSET, ['mood', 'ArrowDown', 'contour.halo']]
    : [...SUNSET, ['mood', 'ArrowDown', 'contour.halo'], ...CONTOUR, ['mood', 'ArrowUp', 'sunset.bands']]

// Runs in the page before its scripts: long tasks, key presses and the canvas's frame and settled marks, with times.
const RECORDER = () => {
  const events = []
  window.__lookSwitch = events
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) events.push({ kind: 'task', t: entry.startTime, ms: entry.duration })
  }).observe({ type: 'longtask', buffered: true })
  window.addEventListener('keydown', () => events.push({ kind: 'key', t: performance.now() }), true)
  document.addEventListener('webglcontextlost', () => events.push({ kind: 'context lost', t: performance.now() }), true)
  // A status query waits until the driver has finished that shader or program: the time compiling blocks the page.
  for (const name of ['getProgramParameter', 'getShaderParameter']) {
    const query = WebGL2RenderingContext.prototype[name]
    WebGL2RenderingContext.prototype[name] = function (object, pname) {
      const t = performance.now()
      const value = query.call(this, object, pname)
      const ms = performance.now() - t
      if (ms > 1) events.push({ kind: 'wait', t, ms, pname, ...(ms > 50 ? { stack: new Error().stack } : {}) })
      return value
    }
  }
  // Other calls that can wait for the GPU process: any taking over 5 ms, by name.
  for (const name of ['getUniformLocation', 'getActiveUniform', 'checkFramebufferStatus', 'readPixels', 'getError', 'getSyncParameter', 'getQueryParameter', 'getParameter', 'clientWaitSync', 'getExtension', 'texImage2D', 'linkProgram', 'compileShader']) {
    const call = WebGL2RenderingContext.prototype[name]
    WebGL2RenderingContext.prototype[name] = function (...callArgs) {
      const t = performance.now()
      const value = call.apply(this, callArgs)
      const ms = performance.now() - t
      if (ms > 5) events.push({ kind: 'slow call', t, ms, name })
      return value
    }
  }
  new MutationObserver((records) => {
    for (const record of records) {
      const value = record.target.getAttribute(record.attributeName)
      events.push({ kind: record.attributeName, t: performance.now(), value })
    }
  }).observe(document, {
    subtree: true,
    attributes: true,
    attributeFilter: ['data-frame', 'data-settled', 'data-fast-ms', 'data-settled-ms', 'data-fast-gpu-ms', 'data-settled-gpu-ms'],
  })
}

// Runs in the page before its scripts: every fragment shader gets a line unique to this run that never changes a
// pixel (it can't discard, since gl_FragCoord.x is never below -1) but survives translation, so the first page
// compiles from scratch (no browser or system shader cache has seen the code) and the second page of the run finds
// the browser's cache warm. A comment would not do: translation strips comments, and the system cache still hits.
const UNIQUE_SOURCES = (tag) => {
  const shaderSource = WebGL2RenderingContext.prototype.shaderSource
  WebGL2RenderingContext.prototype.shaderSource = function (shader, source) {
    if (source.includes('gl_Position')) return shaderSource.call(this, shader, source)
    window.__lookSwitchTagged = (window.__lookSwitchTagged ?? 0) + 1
    return shaderSource.call(this, shader, source.replace('void main() {', `void main() {\n  if (gl_FragCoord.x < -1.0 - ${tag}.0) discard;`))
  }
}

// Runs in the page before its scripts: hides the drag hint ("Drag to reposition the gradient"), which shows on every
// page load until the first drag.
const HIDE_HINT = () =>
  document.addEventListener('DOMContentLoaded', () => document.head.append(Object.assign(document.createElement('style'), { textContent: '.tool-hint{display:none!important}' })))

// Runs in the page before its scripts when --no-parallel is given: the page sees a browser without the extension.
const HIDE_PARALLEL = () => {
  const getExtension = WebGL2RenderingContext.prototype.getExtension
  WebGL2RenderingContext.prototype.getExtension = function (name) {
    return name === 'KHR_parallel_shader_compile' ? null : getExtension.call(this, name)
  }
}

async function settledAfter(page, t0) {
  try {
    await page.waitForFunction(
      (since) => window.__lookSwitch.some((e) => e.kind === 'data-settled' && e.value === 'true' && e.t > since),
      t0,
      { timeout: 60_000, polling: 50 },
    )
  } catch (error) {
    const state = await page.evaluate((since) => ({
      canvas: { ...document.querySelector('canvas.tool-canvas')?.dataset },
      events: window.__lookSwitch.filter((e) => e.t >= since && e.kind !== 'task').slice(0, 30),
      lost: window.__lookSwitch.filter((e) => e.kind === 'context lost').length,
    }), t0)
    console.log(`no settled frame within 60 s: ${JSON.stringify(state)}`)
    console.log(`console errors: ${consoleErrors.join(' | ')}`)
    throw error
  }
  await page.waitForTimeout(400)
  return page.evaluate((since) => {
    const events = window.__lookSwitch.filter((e) => e.t >= since)
    const settled = events.find((e) => e.kind === 'data-settled' && e.value === 'true')
    const frame = events.find((e) => e.kind === 'data-frame')
    const tasks = events.filter((e) => e.kind === 'task' && e.t <= settled.t)
    const fast = events.find((e) => e.kind === 'data-fast-ms')
    const slow = events.find((e) => e.kind === 'data-settled-ms')
    const fastGpu = events.find((e) => e.kind === 'data-fast-gpu-ms')
    const slowGpu = events.find((e) => e.kind === 'data-settled-gpu-ms')
    const waits = events.filter((e) => e.kind === 'wait' && e.t <= settled.t)
    const slowCalls = {}
    for (const e of events) if (e.kind === 'slow call' && e.t <= settled.t) slowCalls[e.name] = Math.round((slowCalls[e.name] ?? 0) + e.ms)
    return {
      slowCalls,
      longWaits: waits.filter((e) => e.ms > 50).map((e) => ({ ms: Math.round(e.ms), pname: e.pname, stack: e.stack })),
      compileWait: waits.reduce((s, e) => s + e.ms, 0),
      longestWait: waits.reduce((m, e) => Math.max(m, e.ms), 0),
      longestTask: tasks.reduce((m, e) => Math.max(m, e.ms), 0),
      tasks: tasks.length,
      firstFrame: frame ? frame.t - since : null,
      settled: settled.t - since,
      render1x: fast ? Number(fast.value) : null,
      render2x: slow ? Number(slow.value) : null,
      gpu1x: fastGpu ? Number(fastGpu.value) : null,
      gpu2x: slowGpu ? Number(slowGpu.value) : null,
    }
  }, t0)
}

async function pressAndMeasure(page, select, key) {
  await page.locator(`.tool-panel [data-dial-path="${select}"]`).first().focus()
  const before = await page.evaluate(() => window.__lookSwitch.length)
  await page.keyboard.press(key)
  const t0 = await page.evaluate((n) => window.__lookSwitch.slice(n).find((e) => e.kind === 'key')?.t ?? performance.now(), before)
  return settledAfter(page, t0)
}

const consoleErrors = []

async function loadPage(context) {
  const page = await context.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') consoleErrors.push(message.text().slice(0, 300))
  })
  page.on('pageerror', (error) => consoleErrors.push(`page error: ${error.message}`))
  await page.setViewportSize({ width: 1280, height: 800 })
  if (args['no-parallel'] === true) await page.addInitScript(HIDE_PARALLEL)
  await page.addInitScript(UNIQUE_SOURCES, RUN_TAG)
  await page.addInitScript(RECORDER)
  await page.goto(`${url}${START}`, { waitUntil: 'load', timeout: 180_000 })
  await page.waitForFunction(() => window.__lookSwitch.some((e) => e.kind === 'data-settled' && e.value === 'true'), null, { timeout: 180_000 })
  await page.waitForTimeout(400)
  const load = await page.evaluate(() => {
    const events = window.__lookSwitch
    const frame = events.find((e) => e.kind === 'data-frame')
    const settled = events.find((e) => e.kind === 'data-settled' && e.value === 'true')
    const tasks = events.filter((e) => e.kind === 'task' && e.t <= settled.t)
    const waits = events.filter((e) => e.kind === 'wait' && e.t <= settled.t)
    const slowCalls = {}
    for (const e of events) if (e.kind === 'slow call' && e.t <= settled.t) slowCalls[e.name] = Math.round((slowCalls[e.name] ?? 0) + e.ms)
    return {
      slowCalls,
      firstFrame: frame.t,
      settled: settled.t,
      longestTask: tasks.reduce((m, e) => Math.max(m, e.ms), 0),
      compileWait: waits.reduce((s, e) => s + e.ms, 0),
      tagged: window.__lookSwitchTagged ?? 0,
    }
  })
  return { page, load }
}

const RUN_TAG = String(Date.now() % 1e8)
const fmt = (ms) => (ms === null ? '-' : `${Math.round(ms)}`)
const fmtGpu = (ms) => (ms === null ? '-' : ms.toFixed(1))
const browser = await chromium.launch({ channel: 'chrome' })
const result = { label, url, start, parallel: args['no-parallel'] !== true, pages: [] }
try {
  const context = await browser.newContext()
  await context.addInitScript(HIDE_HINT)
  for (const [pageIndex, rounds] of [
    [0, ['cold', 'same page']],
    [1, ['browser cache']],
  ]) {
    const { page, load } = await loadPage(context)
    console.log(
      `page ${pageIndex + 1}: first frame ${fmt(load.firstFrame)} ms after navigation, settled ${fmt(load.settled)} ms, longest task ${fmt(load.longestTask)} ms, compile wait ${fmt(load.compileWait)} ms (${load.tagged} shader sources tagged), slow calls ${JSON.stringify(load.slowCalls)}`,
    )
    const entry = { load, switches: [] }
    for (const round of rounds) {
      for (const [select, key, look] of STEPS) {
        const m = await pressAndMeasure(page, select, key)
        entry.switches.push({ round, look, ...m })
        console.log(
          `  ${round.padEnd(13)} ${look.padEnd(16)} compile wait ${fmt(m.compileWait).padStart(5)} ms (longest ${fmt(m.longestWait).padStart(5)}), longest task ${fmt(m.longestTask).padStart(5)} ms, first frame ${fmt(m.firstFrame).padStart(5)} ms, settled ${fmt(m.settled).padStart(5)} ms; on canvas 1x ${fmt(m.render1x).padStart(5)}, 2x ${fmt(m.render2x).padStart(5)} ms; GPU 1x ${fmtGpu(m.gpu1x).padStart(5)}, 2x ${fmtGpu(m.gpu2x).padStart(5)} ms${Object.keys(m.slowCalls).length ? `; slow calls ${JSON.stringify(m.slowCalls)}` : ''}`,
        )
      }
    }
    result.pages.push(entry)
    await page.close()
  }
} finally {
  await browser.close()
}
await mkdir(outDir, { recursive: true })
const file = path.join(outDir, `look-switch-${start}${args['no-parallel'] === true ? '-no-parallel' : ''}.json`)
await writeFile(file, JSON.stringify(result, null, 1))
console.log(`Wrote ${path.relative(ROOT, file)}`)
