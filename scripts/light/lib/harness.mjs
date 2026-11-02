import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

/**
 * Starts a Vite server rooted at the repo (alias '@' -> src) and headless
 * system Chrome on the harness page. Large pixel buffers move over HTTP:
 * Node registers blobs the page downloads (/__light/blob/<key>) and the page
 * posts results back (/__light/upload/<key>).
 *
 * No GPU flags are passed: headless Chrome on macOS uses the Metal GPU and
 * has EXT_color_buffer_float. If a machine falls back to software rendering,
 * try LIGHT_CHROME_ARGS="--enable-gpu --ignore-gpu-blocklist".
 */
export async function startHarness({ verbose = false } = {}) {
  const blobs = new Map()
  const uploads = new Map()
  const ioPlugin = {
    name: 'light-harness-io',
    configureServer(server) {
      server.middlewares.use('/__light/blob/', (req, res) => {
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
      server.middlewares.use('/__light/upload/', (req, res) => {
        const key = decodeURIComponent((req.url ?? '').replace(/^\//, '').split('?')[0])
        const chunks = []
        req.on('data', (chunk) => chunks.push(chunk))
        req.on('end', () => {
          uploads.set(key, Buffer.concat(chunks))
          res.statusCode = 200
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
    plugins: [ioPlugin],
  })
  await server.listen()
  const { port } = server.httpServer.address()

  const extraArgs = (process.env.LIGHT_CHROME_ARGS ?? '').split(' ').filter(Boolean)
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: extraArgs })
  const page = await browser.newPage()
  const pageErrors = []
  // A module that fails to transform (for example an import of a file that does not exist yet) never runs, so the
  // page would only time out; report Vite's message as soon as the request fails instead.
  const moduleErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' || verbose) console.error(`[page] ${message.text()}`)
  })
  page.on('response', async (response) => {
    if (response.status() < 500) return
    const body = await response.text().catch(() => '')
    moduleErrors.push(`${response.url().replace(`http://127.0.0.1:${port}`, '')}: ${body.slice(0, 2000)}`)
  })
  await page.goto(`http://127.0.0.1:${port}/scripts/light/harness/index.html`)
  try {
    const deadline = Date.now() + 60_000
    while (!(await page.evaluate(() => document.documentElement.dataset.harness === 'ready'))) {
      if (moduleErrors.length > 0) throw new Error(`a module failed to load:\n${moduleErrors.join('\n')}`)
      if (pageErrors.length > 0) throw new Error(pageErrors.join('\n'))
      if (Date.now() > deadline) throw new Error('timed out after 60 s')
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  } catch (error) {
    await browser.close()
    await server.close()
    throw new Error(`Harness page did not start: ${pageErrors.join('\n') || error.message}`)
  }

  const call = async (method, ...args) =>
    page.evaluate(({ method, args }) => window.lightHarness[method](...args), { method, args })

  const takeUpload = (key) => {
    const data = uploads.get(key)
    if (!data) throw new Error(`No upload under ${key}`)
    uploads.delete(key)
    return data
  }

  let uploadCounter = 0

  return {
    page,
    server,
    port,
    call,
    info: () => call('info'),
    /** Loads a TypeScript module from the repo through Vite (e.g. '/src/light/references.ts'). */
    ssr: (modulePath) => server.ssrLoadModule(modulePath),
    putBlob: (key, image) => blobs.set(key, image),
    takeUpload,
    /** Renders and returns { width, height, data (RGBA Buffer), ms }. */
    async render(request) {
      const key = `render-${++uploadCounter}`
      const result = await call('render', { ...request, upload: key })
      return { width: request.width, height: request.height, data: takeUpload(key), ms: result.ms, uploadMs: result.uploadMs }
    },
    async close() {
      await browser.close()
      await server.close()
    },
  }
}
