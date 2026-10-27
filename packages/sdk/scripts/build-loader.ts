import { buildSync } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Minifies src/loader/loader.ts into src/loader/code.generated.ts. loaderCode is a
// function expression (`function e(n){...}`) so callers can wrap it as `(code)(CONFIG)`.
const root = fileURLToPath(new URL('..', import.meta.url))
const entry = `${root}src/loader/loader.ts`
const output = `${root}src/loader/code.generated.ts`

const result = buildSync({
  entryPoints: [entry],
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2020',
  write: false,
})

const esm = result.outputFiles[0]!.text.trim()
const exportTail = /;?export\s*\{\s*\w+\s+as\s+default\s*\};?$/
if (!exportTail.test(esm)) throw new Error(`unexpected loader build output: ${esm.slice(-80)}`)
const code = esm.replace(exportTail, '')
writeFileSync(output, `export const loaderCode = ${JSON.stringify(code)}\n`)
console.log(`[sdk] wrote ${output} (${code.length} chars)`)
