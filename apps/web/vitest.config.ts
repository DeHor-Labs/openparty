import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@openparty/protocol': resolve(__dirname, '../../packages/protocol/src/index.ts'),
    },
  },
  test: {
    environment: 'jsdom',
  },
})
