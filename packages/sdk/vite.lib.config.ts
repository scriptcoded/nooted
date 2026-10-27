import { defineConfig } from 'vite'

// npm entries (nooted API and the Vite plugin), ES modules with everything external
// except relative imports. emptyOutDir is off so the runtime bundle in dist/ survives.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: {
        index: 'src/index.ts',
        vite: 'src/vite.ts',
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: [/^[^./]/],
      output: {
        entryFileNames: '[name].js',
      },
    },
  },
})
