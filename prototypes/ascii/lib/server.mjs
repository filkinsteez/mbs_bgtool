import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
export const OUT = path.join(ROOT, 'prototypes/ascii/out')
/** A copy of src/light at one commit, so frames render from committed code while other agents edit the engine. */
export const FROZEN = path.join(ROOT, 'artifacts/ascii/head')

/** The renderer change that makes the output pass run the filter chain (with the coordinator until it lands). */
const CHAIN_PATCH = path.join(ROOT, 'artifacts/grain/programRenderer-filter-chain.patch')

/**
 * Copies src/light at `rev` into FROZEN (src/light imports nothing outside itself), with the chain patch applied when
 * that commit's renderer does not call prepareOutputFilters yet. Returns a label: the short sha, '+chain' if patched.
 */
export function freezeLight(rev = 'HEAD') {
  const sha = execFileSync('git', ['rev-parse', '--short', rev], { cwd: ROOT }).toString().trim()
  const stamp = path.join(FROZEN, 'REV')
  if (fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8').trim().split('+')[0] === sha) return fs.readFileSync(stamp, 'utf8').trim()
  fs.rmSync(FROZEN, { recursive: true, force: true })
  fs.mkdirSync(FROZEN, { recursive: true })
  const tar = execFileSync('git', ['archive', '--format=tar', sha, 'src/light'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 })
  execFileSync('tar', ['-x', '-C', FROZEN], { input: tar })
  let label = sha
  const renderer = fs.readFileSync(path.join(FROZEN, 'src/light/engine/programRenderer.ts'), 'utf8')
  if (!renderer.includes('prepareOutputFilters') && fs.existsSync(CHAIN_PATCH)) {
    execFileSync('patch', ['-p1', '-s', '-d', FROZEN, '-i', CHAIN_PATCH])
    label += '+chain'
  }
  fs.writeFileSync(stamp, `${label}\n`)
  return label
}

/**
 * Vite rooted at the repo and headless system Chrome on prototypes/ascii/index.html.
 * Pixels move over HTTP: Node registers blobs the page downloads (/__ascii/blob/<key>)
 * and the page posts results back (/__ascii/upload/<key>). Same pattern as scripts/light/lib/harness.mjs.
 */
export async function startPrototype({ verbose = false, rev = 'HEAD' } = {}) {
  const frozen = freezeLight(rev)
  if (verbose) console.error(`frames render from src/light at ${frozen}`)
  const blobs = new Map()
  const uploads = new Map()
  const io = {
    name: 'ascii-prototype-io',
    configureServer(server) {
      server.middlewares.use('/__ascii/blob/', (req, res) => {
        const key = decodeURIComponent((req.url ?? '').replace(/^\//, '').split('?')[0])
        const blob = blobs.get(key)
        if (!blob) {
          res.statusCode = 404
          res.end(`no blob ${key}`)
          return
        }
        res.setHeader('content-type', 'application/octet-stream')
        res.setHeader('x-width', String(blob.width))
        res.setHeader('x-height', String(blob.height))
        res.end(blob.data)
      })
      server.middlewares.use('/__ascii/upload/', (req, res) => {
        const key = decodeURIComponent((req.url ?? '').replace(/^\//, '').split('?')[0])
        const chunks = []
        req.on('data', (chunk) => chunks.push(chunk))
        req.on('end', () => {
          uploads.set(key, Buffer.concat(chunks))
          res.end('ok')
        })
      })
    },
  }
  const server = await createServer({
    configFile: false,
    root: ROOT,
    logLevel: verbose ? 'info' : 'error',
    resolve: { alias: { '@': path.join(ROOT, 'src') } },
    server: { host: '127.0.0.1', port: 0, watch: null, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [io],
  })
  await server.listen()
  const { port } = server.httpServer.address()
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' || verbose) console.error(`[page] ${message.text()}`)
  })
  page.on('response', async (response) => {
    if (response.status() < 500) return
    errors.push(`${response.url()}: ${(await response.text().catch(() => '')).slice(0, 1500)}`)
  })
  await page.goto(`http://127.0.0.1:${port}/prototypes/ascii/index.html`)
  const deadline = Date.now() + 60_000
  while (!(await page.evaluate(() => document.documentElement.dataset.ascii === 'ready'))) {
    if (errors.length > 0 || Date.now() > deadline) {
      await browser.close()
      await server.close()
      throw new Error(`prototype page did not start: ${errors.join('\n') || 'timed out'}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  let counter = 0
  const call = (method, ...args) => page.evaluate(({ method, args }) => window.asciiProto[method](...args), { method, args })
  const take = (key) => {
    const data = uploads.get(key)
    if (!data) throw new Error(`no upload under ${key}`)
    uploads.delete(key)
    return data
  }
  return {
    call,
    take,
    putBlob: (key, image) => blobs.set(key, image),
    nextKey: (prefix) => `${prefix}-${++counter}`,
    errors,
    async close() {
      await browser.close()
      await server.close()
    },
  }
}
