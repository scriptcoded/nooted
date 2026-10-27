import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import nooted from './vite.ts'

const fixtures = fileURLToPath(new URL('./__fixtures__', import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'nooted-vite-'))
after(() => rmSync(tmp, { recursive: true, force: true }))

const options = { projectKey: 'proj-key-123', nootedUrl: 'https://nooted.test' }

async function run(name: string, plugin: Parameters<typeof nooted>[0], base = '/') {
  const root = join(tmp, name)
  cpSync(fixtures, root, { recursive: true })
  await build({ root, base, configFile: false, logLevel: 'silent', plugins: [nooted(plugin)], build: { outDir: 'out' } })
  const out = join(root, 'out')
  return { out, html: readFileSync(join(out, 'index.html'), 'utf8') }
}

test('external loader is emitted and is the first script in head', async () => {
  const { out, html } = await run('external', options)
  const file = readdirSync(join(out, 'assets')).find((f) => /^nooted-loader-\w+\.js$/.test(f))
  assert.ok(file)
  assert.match(readFileSync(join(out, 'assets', file), 'utf8'), /proj-key-123/)
  const first = html.indexOf('<script')
  assert.equal(first, html.indexOf(`<script src="/assets/${file}">`))
  assert.ok(html.indexOf('<head>') < first && first < html.indexOf('other.js'))
  assert.ok(!/<script[^>]*src="\/assets\/nooted-loader[^>]*(async|defer|module)/.test(html))
})

test('base is respected', async () => {
  const { out, html } = await run('base', options, '/sub/')
  const m = html.match(/<script src="(\/sub\/assets\/nooted-loader-\w+\.js)">/)
  assert.ok(m)
  assert.ok(existsSync(join(out, m[1]!.replace('/sub/', ''))))
  assert.equal(html.indexOf('<script'), html.indexOf(m[0]))
})

test('inline option puts the snippet first and emits no file', async () => {
  const { out, html } = await run('inline', { ...options, inline: true })
  assert.equal(html.indexOf('<script'), html.indexOf('<script>'))
  assert.ok(html.indexOf('proj-key-123') < html.indexOf('other.js'))
  assert.ok(!readdirSync(join(out, 'assets')).some((f) => f.startsWith('nooted-loader')))
})
