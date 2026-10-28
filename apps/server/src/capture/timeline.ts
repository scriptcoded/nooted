// What happened during a recording, read from its rrweb events without a DOM. Pure, no I/O.
// A serialized-node map follows the events (full snapshots replace it, mutations update it) so an
// element can be described at the moment it was clicked. Typed values are never read or emitted.
import { NOOTED_ERROR_TAG } from '@nooted/shared'
import type { Capture } from '@nooted/shared'
import { codeSpan, quote, singleLine } from './text.ts'

const MAX_ENTRIES = 30
const MAX_TEXT = 200
const MAX_QUIET_TEXT = 60
const MAX_SELECTOR = 500
const MAX_ERROR_LENGTH = 300
const TAP_WINDOW_MS = 500
const TYPING_GAP_MS = 1000

// rrweb 2.2.0 numeric enums.
const EVENT_FULL_SNAPSHOT = 2
const EVENT_INCREMENTAL = 3
const EVENT_META = 4
const EVENT_CUSTOM = 5
const SOURCE_MUTATION = 0
const SOURCE_MOUSE_INTERACTION = 2
const SOURCE_VIEWPORT_RESIZE = 4
const SOURCE_INPUT = 5
const MOUSE_CLICK = 2
const MOUSE_DBL_CLICK = 4
const MOUSE_TOUCH_END = 9
const NODE_ELEMENT = 2
const NODE_TEXT = 3

type Rec = Record<string, unknown>

type MapNode = {
  id: number
  tag: string // lowercase element name, or '#text'
  attrs: Map<string, string>
  parentId: number | null
  children: number[]
  text: string
}

export type NodeMap = Map<number, MapNode>

export type Described = { tag: string; role?: string; name?: string; text: string; selector: string }

export type TimelineEntry =
  | { t: number; kind: 'navigation'; href: string }
  | { t: number; kind: 'click'; double: boolean; target: Described; nodeId?: number; interactive?: false }
  | { t: number; kind: 'tap'; target: Described; nodeId?: number; interactive?: false }
  | { t: number; kind: 'typing'; target: Described }
  | { t: number; kind: 'checked'; checked: boolean; target: Described }
  | { t: number; kind: 'resize'; width: number; height: number }
  | { t: number; kind: 'error'; message: string }

export type Timeline = { entries: TimelineEntry[]; more: number }

const isRec = (value: unknown): value is Rec => typeof value === 'object' && value !== null
const asNumber = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

// ---- node map ----

function addNode(map: NodeMap, raw: unknown, parentId: number | null, nextId?: number | null): void {
  if (!isRec(raw)) return
  const id = asNumber(raw.id)
  const type = raw.type
  if (id === undefined) return
  if (type === NODE_ELEMENT) {
    const attrs = new Map<string, string>()
    if (isRec(raw.attributes)) setAttributes(attrs, raw.attributes)
    detach(map, id)
    map.set(id, { id, tag: String(raw.tagName ?? '').toLowerCase(), attrs, parentId, children: [], text: '' })
  } else if (type === NODE_TEXT) {
    detach(map, id)
    map.set(id, { id, tag: '#text', attrs: new Map(), parentId, children: [], text: typeof raw.textContent === 'string' ? raw.textContent : '' })
  } else if (type === 0) {
    detach(map, id)
    map.set(id, { id, tag: '#document', attrs: new Map(), parentId, children: [], text: '' })
  } else {
    return // doctype, cdata, comment: nothing we read
  }
  const parent = parentId === null ? undefined : map.get(parentId)
  if (parent) {
    const at = nextId === null || nextId === undefined ? -1 : parent.children.indexOf(nextId)
    if (at >= 0) parent.children.splice(at, 0, id)
    else parent.children.push(id)
  }
  if (Array.isArray(raw.childNodes)) for (const child of raw.childNodes) addNode(map, child, id)
}

function setAttributes(attrs: Map<string, string>, changes: Rec): void {
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) attrs.delete(key)
    else if (typeof value === 'string') attrs.set(key, value)
    else if (typeof value === 'number' || typeof value === 'boolean') attrs.set(key, String(value))
    // objects (style maps) are not needed
  }
}

/** Removes a node and its subtree, and unlinks it from its parent. */
function detach(map: NodeMap, id: number): void {
  const node = map.get(id)
  if (!node) return
  const parent = node.parentId === null ? undefined : map.get(node.parentId)
  if (parent) parent.children = parent.children.filter((c) => c !== id)
  const drop = (n: MapNode): void => {
    map.delete(n.id)
    for (const c of n.children) {
      const child = map.get(c)
      if (child) drop(child)
    }
  }
  drop(node)
}

function applyMutation(map: NodeMap, data: Rec): void {
  if (Array.isArray(data.removes)) {
    for (const r of data.removes) if (isRec(r) && typeof r.id === 'number') detach(map, r.id)
  }
  if (Array.isArray(data.adds)) {
    for (const a of data.adds) {
      if (!isRec(a)) continue
      addNode(map, a.node, asNumber(a.parentId) ?? null, asNumber(a.nextId) ?? null)
    }
  }
  if (Array.isArray(data.attributes)) {
    for (const a of data.attributes) {
      if (!isRec(a) || !isRec(a.attributes)) continue
      const node = typeof a.id === 'number' ? map.get(a.id) : undefined
      if (node) setAttributes(node.attrs, a.attributes)
    }
  }
  if (Array.isArray(data.texts)) {
    for (const t of data.texts) {
      if (!isRec(t) || typeof t.value !== 'string') continue
      const node = typeof t.id === 'number' ? map.get(t.id) : undefined
      if (node) node.text = t.value
    }
  }
}

/** Applies one rrweb event to the map. */
export function applyEvent(map: NodeMap, event: { type: number; data?: unknown }): void {
  const data = event.data
  if (!isRec(data)) return
  if (event.type === EVENT_FULL_SNAPSHOT) {
    map.clear()
    addNode(map, data.node, null)
  } else if (event.type === EVENT_INCREMENTAL && data.source === SOURCE_MUTATION) {
    applyMutation(map, data)
  }
}

// ---- describing an element ----

const HIDDEN = (node: MapNode): boolean => {
  const mode = node.attrs.get('data-nooted')
  return mode === 'mask' || mode === 'block'
}
/** Elements whose text is never read: form controls (values), scripts and Nooted's own UI. */
const OPAQUE_TAGS = new Set(['input', 'select', 'textarea', 'script', 'style', 'template', 'noscript'])
const isOpaque = (node: MapNode): boolean => OPAQUE_TAGS.has(node.tag) || node.attrs.get('id') === 'nooted-host'

const normalize = singleLine

function textOf(map: NodeMap, node: MapNode, limit = MAX_TEXT * 2): string {
  if (HIDDEN(node) || isOpaque(node)) return ''
  let out = ''
  const walk = (n: MapNode): void => {
    for (const c of n.children) {
      if (out.length >= limit) return
      const child = map.get(c)
      if (!child) continue
      if (child.tag === '#text') out += child.text
      else if (!HIDDEN(child) && !isOpaque(child)) walk(child)
    }
  }
  walk(node)
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

function roleOf(node: MapNode): string | undefined {
  const explicit = node.attrs.get('role')?.trim().split(/\s+/)[0]
  if (explicit) return explicit
  if (node.tag === 'a') return node.attrs.has('href') ? 'link' : undefined
  if (node.tag === 'input') return INPUT_ROLES[(node.attrs.get('type') ?? 'text').toLowerCase()]
  if (node.tag === 'select') return node.attrs.has('multiple') || Number(node.attrs.get('size')) > 1 ? 'listbox' : 'combobox'
  return IMPLICIT_ROLES[node.tag]
}

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option',
  'textbox', 'searchbox', 'combobox', 'listbox', 'slider', 'spinbutton', 'treeitem',
])

const isInteractive = (node: MapNode): boolean =>
  ['a', 'button', 'input', 'select', 'textarea', 'label', 'summary'].includes(node.tag) ||
  INTERACTIVE_ROLES.has(node.attrs.get('role')?.trim().split(/\s+/)[0]?.toLowerCase() ?? '') ||
  node.attrs.has('onclick') ||
  node.attrs.has('tabindex')

const shortText = (text: string): string => (text.length > MAX_QUIET_TEXT ? `${text.slice(0, MAX_QUIET_TEXT - 1).trimEnd()}…` : text)

/** The `<label>` text for a form control: `for=` match first, then a wrapping label. */
function labelText(map: NodeMap, node: MapNode): string {
  const id = node.attrs.get('id')
  if (id) {
    for (const other of map.values()) {
      if (other.tag === 'label' && other.attrs.get('for') === id) {
        const text = textOf(map, other)
        if (text) return text
      }
    }
  }
  for (let p = node.parentId === null ? undefined : map.get(node.parentId); p; p = p.parentId === null ? undefined : map.get(p.parentId)) {
    if (p.tag === 'label') return textOf(map, p)
  }
  return ''
}

function nameOf(map: NodeMap, node: MapNode, text: string): string | undefined {
  if (HIDDEN(node)) return undefined
  const attr = (key: string): string => normalize(node.attrs.get(key) ?? '')
  const candidates = [attr('aria-label')]
  if (['input', 'select', 'textarea'].includes(node.tag)) candidates.push(labelText(map, node))
  candidates.push(attr('alt'), attr('title'), attr('placeholder'), text)
  const name = candidates.find((c) => c !== '')
  return name?.slice(0, MAX_TEXT)
}

// Mirrors the SDK's rule: hashes and counters in a name change between builds, so a selector on them breaks.
const GENERATED = [/\d{4,}/, /^:/, /^(ember|react|radix|headlessui|mui|rc|vue)[-_:.]?\d/i, /^(react|radix|headlessui)-/i, /(^|[-_:.])(?=[0-9a-f]*\d)[0-9a-f]{6,}($|[-_:.])/i]
const looksGenerated = (name: string): boolean => GENERATED.some((pattern) => pattern.test(name))

const SAFE_CLASS = /^[A-Za-z_][\w-]*$/
const cssIdent = (value: string): string => value.replace(/[^\w-]/g, (c) => `\\${c}`)

function classesOf(node: MapNode): string {
  const classes = (node.attrs.get('class') ?? '').split(/\s+/).filter(Boolean)
  return classes
    .filter((name) => name.length <= 30 && SAFE_CLASS.test(name) && !looksGenerated(name) && !/^(css|sc|jsx|svelte)-/.test(name))
    .slice(0, 2)
    .map((name) => `.${cssIdent(name)}`)
    .join('')
}

/** `#id` or `[data-testid="…"]` when the value is unique in the map and not generated-looking. */
function stableSelector(map: NodeMap, node: MapNode): string | undefined {
  const id = node.attrs.get('id')
  if (id && !looksGenerated(id)) {
    let count = 0
    for (const other of map.values()) if (other.attrs.get('id') === id) count++
    if (count === 1) return `#${cssIdent(id)}`
  }
  const testId = node.attrs.get('data-testid')
  if (testId) {
    let count = 0
    for (const other of map.values()) if (other.attrs.get('data-testid') === testId) count++
    if (count === 1) return `[data-testid="${testId.replace(/["\\]/g, '\\$&')}"]`
  }
  return undefined
}

function selectorOf(map: NodeMap, node: MapNode): string {
  const own = stableSelector(map, node)
  if (own) return own.slice(0, MAX_SELECTOR)
  const segments: string[] = []
  let current: MapNode | undefined = node
  for (let depth = 0; current && depth < 3; depth++) {
    if (depth > 0) {
      const anchor = stableSelector(map, current)
      if (anchor) {
        segments.unshift(anchor)
        break
      }
    }
    const parent: MapNode | undefined = current.parentId === null ? undefined : map.get(current.parentId)
    let nth = ''
    if (parent) {
      const same = parent.children.map((c) => map.get(c)).filter((s): s is MapNode => s?.tag === current!.tag)
      if (same.length > 1) nth = `:nth-of-type(${same.indexOf(current) + 1})`
    }
    segments.unshift(`${current.tag}${classesOf(current)}${nth}`)
    if (current.tag === 'body' || current.tag === 'html') break
    current = parent
  }
  return segments.join(' > ').slice(-MAX_SELECTOR)
}

/**
 * The element a click or input is about: from the target up to the nearest interactive ancestor
 * (a click on a span inside a button names the button). With no interactive ancestor it is the
 * target itself and `interactive` is false. Undefined when the node is gone from the map.
 */
function resolveTarget(map: NodeMap, id: number): { node: MapNode; interactive: boolean } | undefined {
  let node = map.get(id)
  // A text node target stands for its parent element.
  while (node && node.tag === '#text') node = node.parentId === null ? undefined : map.get(node.parentId)
  if (!node || node.tag === '#document') return undefined
  for (let c: MapNode | undefined = node; c && c.tag !== '#document'; c = c.parentId === null ? undefined : map.get(c.parentId)) {
    if (isInteractive(c)) return { node: c, interactive: true }
  }
  return { node, interactive: false }
}

function describeResolved(map: NodeMap, { node, interactive }: { node: MapNode; interactive: boolean }): Described {
  const full = textOf(map, node).slice(0, MAX_TEXT)
  // A click on a non-interactive area says little: no name, a short text.
  const text = interactive ? full : shortText(full)
  const described: Described = { tag: node.tag.slice(0, 64), text, selector: selectorOf(map, node) }
  const role = roleOf(node)
  const name = interactive ? nameOf(map, node, text) : undefined
  if (role) described.role = role.slice(0, 64)
  if (name) described.name = name
  return described
}

/**
 * The element a click or input is about, described like a Mark. Undefined when the node is gone
 * from the map. See `resolveTarget` for how the element is chosen.
 */
export function describeNode(map: NodeMap, id: number): Described | undefined {
  const resolved = resolveTarget(map, id)
  return resolved && describeResolved(map, resolved)
}

// ---- timeline ----

type Raw = { entry: TimelineEntry; id?: number }

/** The entries of a capture, in time order, at most 30; `more` counts the ones left out. */
export function buildTimeline(capture: Pick<Capture, 'events'>): Timeline {
  const events = capture.events
  if (events.length === 0) return { entries: [], more: 0 }
  const start = events[0]!.timestamp
  const map: NodeMap = new Map()
  const raw: Raw[] = []
  let href: string | undefined
  let lastInput: { id: number; at: number; index: number } | undefined

  for (const event of events) {
    const t = Math.max(0, Math.round(event.timestamp - start))
    const data = isRec(event.data) ? event.data : undefined
    applyEvent(map, event)
    if (!data) continue

    if (event.type === EVENT_META) {
      const next = typeof data.href === 'string' && data.href !== '' ? data.href : undefined
      if (next !== undefined && next !== href) {
        if (href !== undefined) raw.push({ entry: { t, kind: 'navigation', href: next } })
        href = next
      }
    } else if (event.type === EVENT_CUSTOM) {
      const payload = isRec(data.payload) ? data.payload : undefined
      if (data.tag !== NOOTED_ERROR_TAG || typeof payload?.message !== 'string') continue
      const message = singleLine(payload.message).slice(0, MAX_ERROR_LENGTH)
      if (message !== '') raw.push({ entry: { t, kind: 'error', message } })
    } else if (event.type === EVENT_INCREMENTAL) {
      const id = asNumber(data.id)
      if (data.source === SOURCE_MOUSE_INTERACTION && id !== undefined) {
        const type = data.type
        if (type !== MOUSE_CLICK && type !== MOUSE_DBL_CLICK && type !== MOUSE_TOUCH_END) continue
        const resolved = resolveTarget(map, id)
        // Clicks on the page itself are text selections and the like.
        if (!resolved || resolved.node.tag === 'html' || resolved.node.tag === 'body') continue
        const target = describeResolved(map, resolved)
        const extra = { nodeId: resolved.node.id, ...(resolved.interactive ? {} : { interactive: false as const }) }
        if (type === MOUSE_CLICK) {
          raw.push({ entry: { t, kind: 'click', double: false, target, ...extra }, id })
        } else if (type === MOUSE_DBL_CLICK) {
          // The two clicks of a double click were recorded first; fold them into it.
          while (raw.length > 0) {
            const prev = raw[raw.length - 1]!
            if (prev.entry.kind !== 'click' || prev.id !== id || t - prev.entry.t > TAP_WINDOW_MS) break
            raw.pop()
          }
          raw.push({ entry: { t, kind: 'click', double: true, target, ...extra }, id })
        } else {
          raw.push({ entry: { t, kind: 'tap', target, ...extra }, id })
        }
      } else if (data.source === SOURCE_VIEWPORT_RESIZE) {
        const width = asNumber(data.width)
        const height = asNumber(data.height)
        if (width !== undefined && height !== undefined) raw.push({ entry: { t, kind: 'resize', width, height } })
      } else if (data.source === SOURCE_INPUT && id !== undefined) {
        const target = describeNode(map, id)
        if (!target) continue
        if (target.tag === 'input' && (target.role === 'checkbox' || target.role === 'radio') && typeof data.isChecked === 'boolean') {
          raw.push({ entry: { t, kind: 'checked', checked: data.isChecked, target }, id })
          lastInput = undefined
        } else if (lastInput && lastInput.id === id && lastInput.index === raw.length - 1 && t - lastInput.at < TYPING_GAP_MS) {
          raw[lastInput.index] = { entry: { t, kind: 'typing', target }, id }
          lastInput.at = t
        } else {
          raw.push({ entry: { t, kind: 'typing', target }, id })
          lastInput = { id, at: t, index: raw.length - 1 }
        }
      }
    }
  }

  // A tap is a TouchEnd the browser did not follow with a click on the same element.
  const clicks = raw.filter((r) => r.entry.kind === 'click')
  const kept = raw.filter((r) => {
    if (r.entry.kind !== 'tap') return true
    return !clicks.some((c) => c.id === r.id && c.entry.t - r.entry.t >= 0 && c.entry.t - r.entry.t <= TAP_WINDOW_MS)
  })
  const entries = kept.map((r) => r.entry)
  return { entries: entries.slice(0, MAX_ENTRIES), more: Math.max(0, entries.length - MAX_ENTRIES) }
}

// ---- formatting ----

function targetText(target: Described): string {
  const name = target.name?.trim()
  const what = target.role ?? `<${target.tag}>`
  let out = name ? `${what} ${quote(name)}` : what
  if (!name && target.text !== '') out += ` ${quote(target.text)}`
  else if (name && target.text !== '' && target.text !== name) out += ` with text ${quote(target.text)}`
  return `${out} (selector ${codeSpan(target.selector)})`
}

/** One entry as a sentence fragment. Never includes typed values. `href` lets the caller shorten URLs. */
export function formatEntry(entry: TimelineEntry, options: { href?: (href: string) => string } = {}): string {
  switch (entry.kind) {
    case 'navigation':
      return `navigated to ${options.href ? options.href(entry.href) : entry.href}`
    case 'click':
      return `${entry.double ? 'double-clicked' : 'clicked'} ${targetText(entry.target)}`
    case 'tap':
      return `tapped ${targetText(entry.target)}`
    case 'typing':
      return `typed in ${targetText(entry.target)}`
    case 'checked':
      return `${entry.checked ? 'checked' : 'unchecked'} ${targetText(entry.target)}`
    case 'resize':
      return `resized the viewport to ${entry.width}×${entry.height}`
    case 'error':
      return `error: ${entry.message}`
  }
}
