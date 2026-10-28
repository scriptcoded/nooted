import { nooted } from '../src/index.ts'

const $ = (id: string) => document.getElementById(id) as HTMLElement

// Errors are triggered on purpose, so the console shows them as well.
$('throw-error').addEventListener('click', () => {
  throw new Error('Playground: deliberate error from a click handler')
})

$('reject-promise').addEventListener('click', () => {
  void Promise.reject({ code: 42 })
})

// Fixtures for the capture e2e tests: a handler with a visible side effect, and a menu that opens on click.
$('fx-counter').addEventListener('click', () => {
  $('fx-count').textContent = String(Number($('fx-count').textContent) + 1)
})

$('fx-menu-button').addEventListener('click', () => {
  const menu = $('fx-menu')
  menu.hidden = !menu.hidden
  $('fx-menu-button').setAttribute('aria-expanded', String(!menu.hidden))
})

$('enable-nooted').addEventListener('click', () => {
  nooted.init()
})

$('disable-nooted').addEventListener('click', () => {
  nooted.disable()
})

$('report-problem').addEventListener('click', () => {
  nooted.open()
})

// SPA-style route switch: pushState on link clicks, popstate for back and forward.
function render(): void {
  const path = location.pathname
  $('page-cart').hidden = path !== '/cart'
  $('page-checkout').hidden = path !== '/checkout'
}

document.querySelectorAll<HTMLAnchorElement>('a[data-route]').forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault()
    history.pushState(null, '', link.getAttribute('data-route'))
    render()
  })
})

window.addEventListener('popstate', render)
render()
