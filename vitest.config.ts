import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    passWithNoTests: true,
    environment: 'node',
    // Many tests compose every look over packs, seeds and formats, and take 8 to 11 s on a busy machine.
    testTimeout: 30_000,
  },
})
