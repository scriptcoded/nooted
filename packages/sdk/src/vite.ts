import { createHash } from 'node:crypto'
import type { Plugin } from 'vite'
import { loaderScript, type LoaderOptions } from './index.ts'

export interface NootedPluginOptions extends LoaderOptions {
  /** Inline the loader into index.html instead of emitting an external file. */
  inline?: boolean
}

/**
 * Adds the Nooted loader as the first script in <head>. By default it is a content-hashed
 * external file, which a strict `script-src 'self'` allows; `inline: true` inlines it.
 */
export function nooted(options: NootedPluginOptions): Plugin {
  const source = loaderScript(options)
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 8)
  let fileName = ''
  let base = '/'
  let serving = false

  return {
    name: 'nooted',

    configResolved(config) {
      serving = config.command === 'serve'
      // Relative bases ('' or './') are served from the root in dev.
      base = serving && !config.base.startsWith('/') && !/^\w+:/.test(config.base) ? '/' : config.base
      fileName = `${config.build.assetsDir}/nooted-loader-${hash}.js`
    },

    buildStart() {
      if (!serving && !options.inline) this.emitFile({ type: 'asset', fileName, source })
    },

    configureServer(server) {
      if (options.inline) return
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== base + fileName) return next()
        res.setHeader('Content-Type', 'text/javascript')
        res.setHeader('Cache-Control', 'no-cache')
        res.end(source)
      })
    },

    transformIndexHtml() {
      return [
        options.inline
          ? { tag: 'script', children: source, injectTo: 'head-prepend' }
          : { tag: 'script', attrs: { src: base + fileName }, injectTo: 'head-prepend' },
      ]
    },
  }
}

export default nooted
