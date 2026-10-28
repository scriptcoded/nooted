// Marking on the live page. While active, window capture-phase listeners keep the page from
// reacting to clicks and taps, and a click toggles a mark on the element instead. The page stays
// scrollable (pointer and touch events are not default-prevented). The store below feeds the
// highlight layer in the shadow root.
import { guard } from '../safe.ts'

export const MAX_MARKS = 20

type Listener = () => void

let marked: Element[] = []
let hover: Element | null = null
/** Bumped when something that moves highlights changes (scroll, resize, element resize). */
let version = 0
const listeners = new Set<Listener>()

let active = false
let removeListeners: (() => void) | undefined
let resizeObserver: ResizeObserver | undefined
let frame = 0
let onCountChange: ((count: number) => void) | undefined

function emit(): void {
  version++
  for (const listener of [...listeners]) listener()
}

export function subscribeMarking(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const getMarked = (): readonly Element[] => marked
export const getHover = (): Element | null => hover
export const getVersion = (): number => version

/** Forgets every mark (a new capture starts, or it ended). */
export function clearMarks(): void {
  marked = []
  hover = null
  resizeObserver?.disconnect()
  emit()
  onCountChange?.(0)
}

function inHost(event: Event): boolean {
  return event.composedPath().some((node) => node instanceof Element && node.id === 'nooted-host')
}

/** The element an event was aimed at (text nodes redirect to their parent, content inside a block to the block), null for html and body. */
function targetOf(event: Event): Element | null {
  let node: EventTarget | undefined = event.composedPath()[0]
  if (node instanceof Node && node.nodeType !== Node.ELEMENT_NODE) node = node.parentElement ?? undefined
  if (!(node instanceof Element)) return null
  if (node === document.documentElement || node === document.body) return null
  // Blocked content is not in the snapshot, so a mark inside it would have no node id: mark the block itself.
  let target: Element = node
  for (let p = node.parentElement; p; p = p.parentElement) if (p.matches('[data-nooted="block"]')) target = p
  return target
}

function toggle(element: Element): void {
  const index = marked.indexOf(element)
  if (index >= 0) {
    marked = marked.filter((m) => m !== element)
    resizeObserver?.unobserve(element)
  } else {
    if (marked.length >= MAX_MARKS) return
    marked = [...marked, element]
    resizeObserver?.observe(element)
  }
  emit()
  onCountChange?.(marked.length)
}

const SWALLOW = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchend', 'click', 'submit', 'contextmenu', 'keydown'] as const
const PREVENT = new Set(['click', 'mousedown', 'submit', 'contextmenu'])

const onIntercept = guard((event: Event) => {
  if (inHost(event)) return
  if (event.type === 'keydown') {
    const key = (event as KeyboardEvent).key
    // Enter and Space activate buttons and links (as a click, which marks). Other keys, including
    // the Nooted shortcut and Tab, are left alone.
    if (key !== 'Enter' && key !== ' ') return
  }
  event.stopImmediatePropagation()
  if (PREVENT.has(event.type)) event.preventDefault()
  if (event.type === 'click') {
    const target = targetOf(event)
    if (target) toggle(target)
  }
})

const onMove = guard((event: PointerEvent) => {
  if (event.pointerType !== 'mouse' || inHost(event)) {
    if (hover) {
      hover = null
      emit()
    }
    return
  }
  const target = targetOf(event)
  if (target === hover) return
  hover = target
  schedule()
})

function schedule(): void {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    emit()
  })
}

/** Starts intercepting. `onCount` is told the mark count whenever it changes. Idempotent. */
export function startMarking(onCount: (count: number) => void): void {
  if (active) return
  active = true
  onCountChange = onCount
  resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : undefined
  for (const element of marked) resizeObserver?.observe(element)

  for (const type of SWALLOW) window.addEventListener(type, onIntercept, true)
  window.addEventListener('pointermove', onMove, true)
  window.addEventListener('scroll', schedule, { capture: true, passive: true })
  window.addEventListener('resize', schedule)
  removeListeners = () => {
    for (const type of SWALLOW) window.removeEventListener(type, onIntercept, true)
    window.removeEventListener('pointermove', onMove, true)
    window.removeEventListener('scroll', schedule, true)
    window.removeEventListener('resize', schedule)
  }
  onCount(marked.length)
  emit()
}

/** Stops intercepting (the marks are kept). Used for Done, Cancel, turn-off and during demos. */
export function stopMarking(): void {
  if (!active) return
  active = false
  removeListeners?.()
  removeListeners = undefined
  resizeObserver?.disconnect()
  resizeObserver = undefined
  cancelAnimationFrame(frame)
  frame = 0
  hover = null
  onCountChange = undefined
  emit()
}
