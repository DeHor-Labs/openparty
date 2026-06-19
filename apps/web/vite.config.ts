// apps/web/vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@openparty/protocol': '../packages/protocol/src/index.ts',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
