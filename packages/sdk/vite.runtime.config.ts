import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

// The runtime is one self-contained IIFE served by the Nooted server.
// emptyOutDir is off so it can share dist/ with the npm entries (vite.lib.config.ts).
export default defineConfig({
  plugins: [preact()],
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: true,
    lib: {
      entry: 'src/runtime/main.ts',
      name: 'NootedRuntime',
      formats: ['iife'],
      fileName: () => 'nooted.js',
    },
  },
})
