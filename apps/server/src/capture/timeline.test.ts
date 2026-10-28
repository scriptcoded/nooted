import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { applyEvent, buildTimeline, describeNode, formatEntry, type NodeMap } from './timeline.ts'

type Ev = { type: number; timestamp: number; data: unknown }

const el = (id: number, tagName: string, attributes: Record<string, unknown> = {}, childNodes: unknown[] = []) => ({
  type: 2, id, tagName, attributes, childNodes,
})
const txt = (id: number, textContent: string) => ({ type: 3, id, textContent })

const snapshot = (timestamp: number, ...body: unknown[]): Ev => ({
  type: 2,
  timestamp,
  data: { node: { type: 0, id: 1, childNodes: [el(2, 'html', {}, [el(3, 'body', {}, body)])] } },
})
const meta = (timestamp: number, href: string): Ev => ({ type: 4, timestamp, data: { href } })
const mouse = (timestamp: number, type: number, id: number): Ev => ({ type: 3, timestamp, data: { source: 2, type, id } })
const input = (timestamp: number, id: number, text: string, isChecked = false): Ev => ({
  type: 3, timestamp, data: { source: 5, id, text, isChecked },
})
const mutation = (timestamp: number, data: Record<string, unknown>): Ev => ({ type: 3, timestamp, data: { source: 0, ...data } })

const base = (...body: unknown[]): Ev[] => [meta(1000, 'https://x.example/a'), snapshot(1001, ...body)]

describe('describeNode', () => {
  const build = (...body: unknown[]): NodeMap => {
    const map: NodeMap = new Map()
    applyEvent(map, snapshot(0, ...body))
    return map
  }

  it('climbs from a span to the button and names it', () => {
    const map = build(el(4, 'button', { id: 'buy' }, [el(5, 'span', {}, [txt(6, ' Add  to\ncart ')])]))
    assert.deepEqual(describeNode(map, 5), { tag: 'button', role: 'button', name: 'Add to cart', text: 'Add to cart', selector: '#buy' })
    assert.equal(describeNode(map, 6)?.tag, 'button')
  })

  it('names inputs from for= and wrapping labels, then placeholder', () => {
    const map = build(
      el(4, 'label', { for: 'e' }, [txt(5, 'Email')]),
      el(6, 'input', { id: 'e', type: 'email' }),
      el(7, 'label', {}, [txt(8, 'Phone'), el(9, 'input', { type: 'tel' })]),
      el(10, 'input', { type: 'text', placeholder: 'Search' }),
    )
    assert.equal(describeNode(map, 6)?.name, 'Email')
    assert.equal(describeNode(map, 9)?.name, 'Phone')
    assert.equal(describeNode(map, 10)?.name, 'Search')
    assert.equal(describeNode(map, 6)?.role, 'textbox')
  })

  it('prefers aria-label and alt, and never reads input values', () => {
    const map = build(
      el(4, 'a', { href: '/x', 'aria-label': 'Home' }, [txt(5, 'ignored')]),
      el(6, 'img', { alt: 'Logo' }),
      el(7, 'input', { type: 'text', value: 'hunter2' }),
    )
    assert.equal(describeNode(map, 4)?.name, 'Home')
    assert.equal(describeNode(map, 4)?.role, 'link')
    assert.equal(describeNode(map, 6)?.name, undefined) // not interactive: no name
    assert.equal(describeNode(map, 6)?.role, 'img')
    assert.equal(JSON.stringify(describeNode(map, 7)).includes('hunter2'), false)
  })

  it('builds selectors: data-testid, duplicate ids, and short paths', () => {
    const map = build(
      el(4, 'div', { class: 'row' }, [el(5, 'p', { 'data-testid': 'intro' }), el(6, 'p', { class: 'note css-abc' })]),
      el(7, 'p', { id: 'dup' }),
      el(8, 'p', { id: 'dup' }),
    )
    assert.equal(describeNode(map, 5)?.selector, '[data-testid="intro"]')
    assert.equal(describeNode(map, 6)?.selector, 'body > div.row > p.note:nth-of-type(2)')
    assert.ok(describeNode(map, 7)?.selector.startsWith('body > '), 'duplicate id is not used')
  })

  it('truncates long names, text and selectors', () => {
    const map = build(el(4, 'button', {}, [txt(5, 'x'.repeat(500))]))
    const d = describeNode(map, 4)!
    assert.equal(d.name?.length, 200)
    assert.equal(d.text.length, 200)
    assert.ok(d.selector.length <= 500)
  })
})

describe('buildTimeline', () => {
  it('records navigations after the first page, with times from the first event', () => {
    const { entries } = buildTimeline({ events: [...base(), meta(3500, 'https://x.example/a'), meta(4000, 'https://x.example/b')] })
    assert.deepEqual(entries, [{ t: 3000, kind: 'navigation', href: 'https://x.example/b' }])
  })

  it('records clicks, double clicks and unmatched taps', () => {
    const body = [el(4, 'button', {}, [txt(5, 'Go')]), el(6, 'a', { href: '/y' }, [txt(7, 'Next')])]
    const { entries } = buildTimeline({
      events: [
        ...base(...body),
        mouse(1500, 2, 5),
        mouse(2000, 2, 4),
        mouse(2100, 2, 4),
        mouse(2150, 4, 4),
        mouse(3000, 9, 7), // tap: no click follows
        mouse(4000, 9, 4), // touch end, then click: only the click counts
        mouse(4050, 2, 4),
        mouse(5000, 0, 4), // mouse up: ignored
      ],
    })
    assert.deepEqual(entries.map((e) => e.kind), ['click', 'click', 'tap', 'click'])
    const second = entries[1]!
    assert.equal(second.kind === 'click' && second.double, true)
    assert.equal(formatEntry(entries[0]!), 'clicked button "Go" (selector `body > button`)')
    assert.equal(formatEntry(entries[2]!), 'tapped link "Next" (selector `body > a`)')
  })

  it('drops clicks on the page itself and describes non-interactive targets briefly', () => {
    const long = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore'
    const { entries } = buildTimeline({
      events: [
        ...base(
          el(4, 'section', { id: 'fixtures' }, [txt(5, long)]),
          el(6, 'div', { tabindex: '0' }, [txt(7, 'Focusable')]),
          el(8, 'div', { role: 'presentation' }, [txt(9, 'Plain')]),
        ),
        mouse(2000, 2, 2), // html
        mouse(2100, 2, 3), // body
        mouse(2200, 2, 1), // document
        mouse(2300, 2, 5),
        mouse(2400, 2, 7),
        mouse(2500, 2, 9),
      ],
    })
    assert.equal(entries.length, 3)
    const [prose, focusable, presentation] = entries
    assert.equal(prose!.kind === 'click' && prose!.interactive, false)
    assert.equal(prose!.kind === 'click' && prose!.target.name, undefined)
    assert.equal(formatEntry(prose!), `clicked <section> "${long.slice(0, 59)}…" (selector \`#fixtures\`)`)
    assert.equal(focusable!.kind === 'click' && focusable!.interactive, undefined)
    assert.equal(formatEntry(focusable!), 'clicked <div> "Focusable" (selector `body > div:nth-of-type(1)`)')
    assert.equal(presentation!.kind === 'click' && presentation!.interactive, false)
  })

  it('collapses a typing burst into one entry at the last input, without values', () => {
    const { entries } = buildTimeline({
      events: [
        ...base(el(4, 'input', { type: 'text', placeholder: 'Name' })),
        input(2000, 4, 'a-secret'),
        input(2400, 4, 'a-secret-longer'),
        input(3100, 4, 'a-secret-longest'),
        input(5000, 4, 'next burst'),
      ],
    })
    assert.deepEqual(entries.map((e) => [e.t, e.kind]), [[2100, 'typing'], [4000, 'typing']])
    const json = JSON.stringify(entries) + entries.map((e) => formatEntry(e)).join('\n')
    assert.equal(/secret|next burst/.test(json), false)
    assert.equal(formatEntry(entries[0]!), 'typed in textbox "Name" (selector `body > input`)')
  })

  it('records checkbox changes as checked and unchecked', () => {
    const { entries } = buildTimeline({
      events: [
        ...base(el(4, 'label', {}, [txt(5, 'Terms'), el(6, 'input', { type: 'checkbox' })])),
        input(2000, 6, '', true),
        input(2100, 6, '', false),
      ],
    })
    assert.deepEqual(entries.map((e) => formatEntry(e)), [
      'checked checkbox "Terms" (selector `body > label > input`)',
      'unchecked checkbox "Terms" (selector `body > label > input`)',
    ])
  })

  it('records resizes and errors, and drops scrolls', () => {
    const { entries } = buildTimeline({
      events: [
        ...base(),
        { type: 3, timestamp: 1500, data: { source: 3, id: 3, x: 0, y: 100 } },
        { type: 3, timestamp: 2000, data: { source: 4, width: 390, height: 844 } },
        { type: 5, timestamp: 2500, data: { tag: 'nooted:error', payload: { message: 'Boom\n at x' } } },
        { type: 5, timestamp: 2600, data: { tag: 'other', payload: { message: 'no' } } },
      ],
    })
    assert.deepEqual(entries.map((e) => formatEntry(e)), ['resized the viewport to 390×844', 'error: Boom at x'])
  })

  it('describes an element added by a mutation, and follows removes, attributes and texts', () => {
    const { entries } = buildTimeline({
      events: [
        ...base(el(4, 'div', {}, [])),
        mutation(1500, { adds: [{ parentId: 4, nextId: null, node: el(10, 'button', { id: 'late' }, [txt(11, 'Old')]) }] }),
        mutation(1600, { texts: [{ id: 11, value: 'Later' }], attributes: [{ id: 10, attributes: { 'aria-label': 'Renamed', id: null } }] }),
        mouse(2000, 2, 10),
        mutation(2100, { removes: [{ parentId: 4, id: 10 }] }),
        mouse(2200, 2, 10), // gone from the map: skipped
      ],
    })
    assert.equal(entries.length, 1)
    assert.equal(formatEntry(entries[0]!), 'clicked button "Renamed" with text "Later" (selector `body > div > button`)')
  })

  it('replaces the map on a new full snapshot', () => {
    const { entries } = buildTimeline({
      events: [...base(el(4, 'button', {}, [txt(5, 'One')])), snapshot(1500, el(4, 'button', {}, [txt(5, 'Two')])), mouse(2000, 2, 4)],
    })
    assert.match(formatEntry(entries[0]!), /"Two"/)
  })

  it('caps at 30 entries and counts the rest', () => {
    const clicks = Array.from({ length: 35 }, (_, i) => mouse(2000 + i * 1000, 2, 4))
    const { entries, more } = buildTimeline({ events: [...base(el(4, 'button', {}, [txt(5, 'Go')])), ...clicks] })
    assert.equal(entries.length, 30)
    assert.equal(more, 5)
  })
})
