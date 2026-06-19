// apps/extension/vite.config.ts
import { defineConfig } from 'vite'
import { crx } from '@crxjs/vite-plugin'
import { fileURLToPath } from 'node:url'
import manifest from './manifest.json'

export default defineConfig({
  plugins: [
    crx({ manifest }),
  ],
  resolve: {
    alias: {
      // Alias absoluto usando fileURLToPath para evitar ambiguidade em paths relativos
      '@openparty/protocol': fileURLToPath(
        new URL('../../packages/protocol/src/index.ts', import.meta.url),
      ),
    },
  },
  build: {
    // Saida padrao: dist/
    outDir: 'dist',
    // Nao minificar em dev para facilitar inspecao na aba chrome://extensions
    minify: false,
  },
  test: {
    // Ambiente jsdom para testes que dependem de DOM (adapters, content script)
    environment: 'jsdom',
    globals: true,
  },
})
