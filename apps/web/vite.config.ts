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
  // Proxy de desenvolvimento: encaminha requisicoes para o server Bun na porta 3000.
  // Util quando VITE_SERVER_URL nao esta definida no .env local.
  server: {
    proxy: {
      // WebSocket: troca de eventos em tempo real
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
        changeOrigin: true,
      },
      // REST: rotas HTTP do servidor (rooms, health, etc.)
      '/rooms': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
