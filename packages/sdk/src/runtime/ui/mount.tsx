// Mounts the UI in a shadow root under #nooted-host and keeps it attached.
import { render } from 'preact'
import { log } from '../safe.ts'
import { adoptCss } from './adopt-css.ts'
import { App } from './App.tsx'
import { css } from './styles.ts'

let host: HTMLElement | undefined
let observer: MutationObserver | undefined
let cleanup: (() => void) | undefined

function debugOpen(): boolean {
  try {
    return localStorage.getItem('nooted:debug') === '1'
  } catch {
    return false
  }
}

// The host lives in the page's light DOM, so page CSS can reach it. Inline !important beats author !important.
function lockHostStyles(el: HTMLElement): void {
  const styles: [string, string][] = [
    ['all', 'initial'],
    ['display', 'block'],
    ['visibility', 'visible'],
    ['opacity', '1'],
    ['position', 'fixed'],
    ['top', '0'],
    ['left', '0'],
    ['width', '0'],
    ['height', '0'],
    ['overflow', 'visible'],
    ['z-index', '2147483647'],
    ['pointer-events', 'none'], // the host covers nothing; children opt back in
    ['transform', 'none'],
  ]
  for (const [prop, value] of styles) el.style.setProperty(prop, value, 'important')
}

function applyStyles(shadow: ShadowRoot): void {
  adoptCss(shadow, css, 'ui', true)
}

function whenBody(fn: () => void): void {
  if (document.body) fn()
  else document.addEventListener('DOMContentLoaded', fn, { once: true })
}

/** Mounts once. `shakeThreshold` lets the button's permission flow reach the motion trigger. */
export function mount(shakeThreshold: () => number | undefined): void {
  if (host) return
  whenBody(() => {
    if (host) return
    const el = document.createElement('div')
    el.id = 'nooted-host'
    lockHostStyles(el)
    const shadow = el.attachShadow({ mode: debugOpen() ? 'open' : 'closed' })
    applyStyles(shadow)
    const root = document.createElement('div')
    shadow.append(root)
    host = el
    document.body.append(el)
    render(<App shakeThreshold={shakeThreshold} />, root)

    // Re-attach if the page removes the host (body contents replaced, or body itself swapped).
    const watch = () => {
      observer?.disconnect()
      observer = new MutationObserver(() => {
        try {
          if (host && !host.isConnected && document.body) {
            document.body.append(host)
            watch()
          }
        } catch (error) {
          log.warn(error)
        }
      })
      observer.observe(document.documentElement, { childList: true })
      if (document.body) observer.observe(document.body, { childList: true })
    }
    watch()
    cleanup = () => {
      observer?.disconnect()
      render(null, root)
      el.remove()
    }
  })
}

/** Removes the UI ("Turn off"). */
export function unmount(): void {
  cleanup?.()
  cleanup = undefined
  observer = undefined
  host = undefined
}
