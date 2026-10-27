import { nooted } from '../src/index.ts'

const $ = (id: string) => document.getElementById(id) as HTMLElement

// Errors are triggered on purpose, so the console shows them as well.
$('throw-error').addEventListener('click', () => {
  throw new Error('Playground: deliberate error from a click handler')
})

$('reject-promise').addEventListener('click', () => {
  void Promise.reject({ code: 42 })
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
