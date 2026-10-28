// Describes a marked element for the capture (tag, role, name, text, selector, rect, node id).
// DOM code, covered by the e2e specs against the playground fixtures. Nothing from masked or
// blocked elements, or from form controls, may end up in a description.
import type { Mark } from '@nooted/shared'

const MAX_TEXT = 200
const MAX_SELECTOR = 500
const HIDDEN = '[data-nooted="mask"], [data-nooted="block"]'
/** Elements whose text is never read: form controls (values), scripts and Nooted's own UI. */
const OPAQUE = 'input, select, textarea, script, style, template, noscript, #nooted-host'

const normalize = (text: string): string => text.replace(/\s+/g, ' ').trim()

const isHidden = (element: Element): boolean => !!element.closest(HIDDEN)

/**
 * The element's text without masked/blocked/opaque descendants, normalized. Stops reading once
 * there is clearly enough (callers cut to 200 characters).
 */
function textOf(element: Element, limit = MAX_TEXT * 2): string {
  if (isHidden(element) || element.matches(OPAQUE)) return ''
  let out = ''
  const walk = (node: Node): void => {
    for (let child = node.firstChild; child && out.length < limit; child = child.nextSibling) {
      if (child.nodeType === Node.TEXT_NODE) out += child.nodeValue ?? ''
      else if (child instanceof Element && !child.matches(HIDDEN) && !child.matches(OPAQUE)) walk(child)
    }
  }
  walk(element)
  return normalize(out)
}

const IMPLICIT_ROLES: Record<string, string> = {
  button: 'button',
  textarea: 'textbox',
  img: 'img',
  nav: 'navigation',
  main: 'main',
  dialog: 'dialog',
  li: 'listitem',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
}
const INPUT_ROLES: Record<string, string> = {
  text: 'textbox',
  email: 'textbox',
  tel: 'textbox',
  url: 'textbox',
  search: 'searchbox',
  number: 'spinbutton',
  checkbox: 'checkbox',
  radio: 'radio',
  range: 'slider',
  button: 'button',
  submit: 'button',
  reset: 'button',
  image: 'button',
}

function roleOf(element: Element, tag: string): string | undefined {
  const explicit = element.getAttribute('role')?.trim().split(/\s+/)[0]
  if (explicit) return explicit
  if (tag === 'a') return element.hasAttribute('href') ? 'link' : undefined
  if (tag === 'input') return INPUT_ROLES[(element.getAttribute('type') ?? 'text').toLowerCase()]
  if (tag === 'select') return element.hasAttribute('multiple') || Number(element.getAttribute('size')) > 1 ? 'listbox' : 'combobox'
  return IMPLICIT_ROLES[tag]
}

function nameOf(element: Element, tag: string, role: string | undefined): string | undefined {
  if (isHidden(element)) return undefined
  const labelledBy = element.getAttribute('aria-labelledby')
  if (labelledBy) {
    const root = element.getRootNode() as Document | ShadowRoot
    const joined = normalize(
      labelledBy
        .split(/\s+/)
        .map((id) => {
          const target = id ? root.getElementById?.(id) : null
          return target ? textOf(target) : ''
        })
        .join(' '),
    )
    if (joined) return joined.slice(0, MAX_TEXT)
  }
  const label = normalize(element.getAttribute('aria-label') ?? '')
  if (label) return label.slice(0, MAX_TEXT)
  const alt = normalize(element.getAttribute('alt') ?? '')
  if (alt) return alt.slice(0, MAX_TEXT)
  const labels = (element as HTMLInputElement).labels
  if (labels?.length) {
    const text = normalize(Array.from(labels, (l) => textOf(l)).join(' '))
    if (text) return text.slice(0, MAX_TEXT)
  }
  if (tag === 'button' || tag === 'a' || role === 'button' || role === 'link') {
    const text = textOf(element)
    if (text) return text.slice(0, MAX_TEXT)
  }
  const title = normalize(element.getAttribute('title') ?? '')
  return title ? title.slice(0, MAX_TEXT) : undefined
}

// A hash or counter in a name changes between builds and renders, so a selector built on it breaks.
// Heuristic, deliberately simple: a long digit run (`ember1234`, `item-20931`), a colon id
// (React's `:r1:`), a framework prefix with a counter (`react-select-3-input`, `radix-…`), or a hex-ish token
// of 6+ characters that contains a digit (`a1b2c3d4`, `Button_root__3fa9c1`).
const GENERATED = [/\d{4,}/, /^:/, /^(ember|react|radix|headlessui|mui|rc|vue)[-_:.]?\d/i, /^(react|radix|headlessui)-/i, /(^|[-_:.])(?=[0-9a-f]*\d)[0-9a-f]{6,}($|[-_:.])/i]
export function looksGenerated(name: string): boolean {
  return GENERATED.some((pattern) => pattern.test(name))
}

const SAFE_CLASS = /^[A-Za-z_][\w-]*$/
function classesOf(element: Element): string {
  return Array.from(element.classList)
    .filter((name) => name.length <= 30 && SAFE_CLASS.test(name) && !looksGenerated(name) && !/^(css|sc|jsx|svelte)-/.test(name))
    .slice(0, 2)
    .map((name) => `.${CSS.escape(name)}`)
    .join('')
}

function nthOfType(element: Element): number {
  let index = 1
  for (let s = element.previousElementSibling; s; s = s.previousElementSibling) if (s.localName === element.localName) index++
  return index
}

function hasSameTagSibling(element: Element): boolean {
  const parent = element.parentElement
  if (!parent) return false
  for (const s of parent.children) if (s !== element && s.localName === element.localName) return true
  return false
}

function matchesOnly(root: ParentNode, selector: string, element: Element): boolean {
  try {
    const found = root.querySelectorAll(selector)
    return found.length === 1 && found[0] === element
  } catch {
    return false
  }
}

const stableId = (element: Element, root: ParentNode): string | null => {
  const id = element.id
  if (!id || looksGenerated(id)) return null
  const selector = `#${CSS.escape(id)}`
  return matchesOnly(root, selector, element) ? selector : null
}

/**
 * `#id` when the id is unique and not generated-looking. Otherwise a short chain of
 * `tag.class:nth-of-type(n)` segments from the element up to the nearest stable id or `body`,
 * stopping as soon as it is unique; the fallback is the full `nth-of-type` path.
 */
export function selectorOf(element: Element): string {
  const root = element.getRootNode() as ParentNode
  const own = stableId(element, root)
  if (own) return own

  const segments: string[] = []
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (current !== element) {
      const anchor = stableId(current, root)
      if (anchor) {
        const selector = [anchor, ...segments].join(' > ')
        if (matchesOnly(root, selector, element)) return selector.slice(-MAX_SELECTOR)
        break
      }
    }
    if (current === document.body || current === document.documentElement) {
      segments.unshift(current.localName)
    } else {
      const nth = hasSameTagSibling(current) ? `:nth-of-type(${nthOfType(current)})` : ''
      segments.unshift(`${current.localName}${classesOf(current)}${nth}`)
    }
    const selector = segments.join(' > ')
    if (matchesOnly(root, selector, element)) return selector.slice(-MAX_SELECTOR)
    if (current === document.body) break
  }

  const path: string[] = []
  for (let current: Element | null = element; current; current = current.parentElement) {
    path.unshift(current === document.documentElement ? 'html' : `${current.localName}:nth-of-type(${nthOfType(current)})`)
  }
  return path.join(' > ').slice(-MAX_SELECTOR)
}

/** The Mark for an element. `nodeId` is its id in the capture's snapshot. */
export function describeElement(element: Element, nodeId: number): Mark {
  const tag = element.localName
  const role = roleOf(element, tag)
  const name = nameOf(element, tag, role)
  const rect = element.getBoundingClientRect()
  const mark: Mark = {
    nodeId,
    tag,
    text: textOf(element).slice(0, MAX_TEXT),
    selector: selectorOf(element),
    rect: {
      x: Math.round(rect.left + window.scrollX),
      y: Math.round(rect.top + window.scrollY),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
  }
  if (role) mark.role = role
  if (name) mark.name = name
  return mark
}
