import type { ApiMethod, LoaderConfig, NootedStub } from './types.ts'

// Self-contained: no runtime imports. scripts/build-loader.ts minifies the default
// export into a function expression that index.ts and the Vite plugin call with the config.
export default function load(c: LoaderConfig): void {
  try {
    const w = window
    if (w.nooted) return

    const key = 'nooted:enabled'
    const flag = (on: boolean) => {
      try {
        if (on) localStorage.setItem(key, '1')
        else localStorage.removeItem(key)
      } catch {}
    }

    // Read currentScript now: it is null once the script has finished running.
    const me = document.currentScript as HTMLScriptElement | null
    const nonce = me && (me.nonce || me.getAttribute('nonce'))
    const src = c.u + '/sdk/v1/nooted.js'
    let loading = false

    const n: NootedStub = {
      v: 1,
      k: c.k,
      u: c.u,
      r: c.r,
      q: [],
      l() {
        if (loading) return
        loading = true
        const s = document.createElement('script')
        s.async = true
        s.src = src
        if (nonce) s.setAttribute('nonce', nonce)
        s.onerror = () =>
          console.warn(
            `[nooted] Could not load ${src}. Likely causes: a Content Security Policy script-src that does not allow ${c.u}, or the Nooted server being unreachable.`,
          )
        document.head.appendChild(s)
      },
    } as unknown as NootedStub

    for (const m of ['init', 'open', 'signOut', 'disable'] as ApiMethod[]) {
      n[m] = (...a: unknown[]) => {
        n.q.push([m, a])
        try {
          if (m == 'init') {
            flag(true)
            n.l()
          } else if (m == 'disable') flag(false)
        } catch (e) {
          console.warn('[nooted]', e)
        }
      }
    }
    w.nooted = n

    let on = false
    try {
      on = localStorage.getItem(key) == '1'
    } catch {}
    if (on) n.l()
  } catch (e) {
    console.warn('[nooted]', e)
  }
}
