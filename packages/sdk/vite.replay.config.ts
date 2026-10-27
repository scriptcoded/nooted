import { defineConfig } from 'vite'

// The replay player is a second self-contained IIFE served by the Nooted server.
// emptyOutDir is off so it can share dist/ with the npm entries (vite.lib.config.ts).
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: true,
    lib: {
      entry: 'src/replay/main.ts',
      name: 'NootedReplay',
      formats: ['iife'],
      fileName: () => 'replay.js',
    },
  },
})
