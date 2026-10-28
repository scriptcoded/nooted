import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react()],
  server: {
    host: true,
    port: 4800,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:4810',
      '/auth': 'http://localhost:4810',
      '/sdk': 'http://localhost:4810',
      '/mcp': 'http://localhost:4810',
      '/oauth': 'http://localhost:4810',
      '/.well-known': 'http://localhost:4810',
    },
  },
})
