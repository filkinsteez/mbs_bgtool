import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const server = await createServer({ configFile: false, root, logLevel: 'error', resolve: { alias: { '@': path.join(root, 'src') } }, server: { host: '127.0.0.1', port: 0 } })
let browser
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }) })
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/scripts/look-thumbnails.html`)
  await page.waitForFunction(() => document.documentElement.dataset.thumbnails === 'ready')
  const items = await page.evaluate(() => window.thumbnailSet())
  const directory = path.join(root, 'public/look-thumbnails')
  await mkdir(directory, { recursive: true })
  for (const item of items) await writeFile(path.join(directory, `${item.name}.webp`), Buffer.from(item.dataUrl.split(',')[1], 'base64'))
  console.log(`Saved ${items.length} fixed look thumbnails`)
} finally {
  await browser?.close()
  await server.close()
}
