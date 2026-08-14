import { defineConfig } from '@playwright/test'

const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL
const noProxyHosts = new Set(
  (process.env.NO_PROXY ?? process.env.no_proxy ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean),
)
noProxyHosts.add('127.0.0.1')
noProxyHosts.add('localhost')
process.env.NO_PROXY = [...noProxyHosts].join(',')

export default defineConfig({
  testDir: './tests/browser',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: externalBaseUrl ?? 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium-fallback',
      use: {
        browserName: 'chromium',
        launchOptions: { args: ['--disable-features=WebGPU'] },
      },
    },
  ],
  webServer: externalBaseUrl
    ? undefined
    : {
        command: 'npm run dev -- --hostname 127.0.0.1',
        url: 'http://127.0.0.1:3000',
        reuseExistingServer: true,
        timeout: 120_000,
      },
})
