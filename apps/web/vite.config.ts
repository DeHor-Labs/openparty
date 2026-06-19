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
  // Proxy de desenvolvimento: encaminha /ws/* para o server Bun na 3000.
  // Util quando VITE_SERVER_URL nao esta definida no .env local.
  server: {
    proxy: {
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
