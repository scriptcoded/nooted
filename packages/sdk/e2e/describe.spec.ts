import { expect, test } from '@playwright/test'
import type { Mark } from '@nooted/shared'
import { beginPoint, done, draftCaptures, mark, setup } from './capture-helpers.ts'

// Marks each fixture, one capture, and checks the descriptions.
const FIXTURES = ['#fx-counter', '#fx-name', '#fx-icon', '#fx-link', '#fx-heading', '#ember1234', '#fx-menu-button']

test('element descriptions of the playground fixtures', async ({ page }) => {
  await setup(page, '/checkout')
  await expect(page.locator('#account-number')).toBeVisible()
  await beginPoint(page)
  const selectors = [...FIXTURES, '#account-number', '#card', '#email']
  for (const selector of selectors) await mark(page, selector)
  await done(page)

  const [capture] = await draftCaptures(page)
  expect(capture!.marks).toHaveLength(selectors.length)
  const byFixture = new Map<string, Mark>(selectors.map((s, i) => [s, capture!.marks[i]!]))
  const get = (selector: string) => byFixture.get(selector)!

  expect(get('#fx-counter')).toMatchObject({ tag: 'button', role: 'button', name: 'Add to cart', text: 'Add to cart' })
  expect(get('#fx-name')).toMatchObject({ tag: 'input', role: 'textbox', name: 'Full name', text: '' })
  expect(get('#fx-icon')).toMatchObject({ tag: 'button', role: 'button', name: 'Open settings' })
  expect(get('#fx-link')).toMatchObject({ tag: 'a', role: 'link', name: 'Read the terms', text: 'Read the terms' })
  expect(get('#fx-heading')).toMatchObject({ tag: 'h2', role: 'heading', text: 'Fixture heading' })
  expect(get('#fx-heading').name).toBeUndefined()
  expect(get('#fx-menu-button')).toMatchObject({ tag: 'button', name: 'Menu' })

  // Masked, blocked and input elements leak nothing.
  const json = JSON.stringify(capture!.marks)
  for (const secret of ['SE45', '5000', 'Visa', '4242', 'Jane Doe']) expect(json).not.toContain(secret)
  expect(get('#account-number')).toMatchObject({ tag: 'span', text: '' })
  expect(get('#account-number').name).toBeUndefined()
  expect(get('#card')).toMatchObject({ tag: 'div', text: '' })
  expect(get('#email')).toMatchObject({ tag: 'input', text: '' })

  // Each selector finds exactly the marked element.
  for (const [selector, m] of byFixture) {
    const result = await page.evaluate(
      ({ sel, original }) => {
        const found = document.querySelectorAll(sel)
        return { count: found.length, same: found[0] === document.querySelector(original) }
      },
      { sel: m.selector, original: selector },
    )
    expect(result, `${selector} -> ${m.selector}`).toEqual({ count: 1, same: true })
  }

  // A stable id is used, a generated-looking one is not.
  expect(get('#fx-counter').selector).toBe('#fx-counter')
  expect(get('#ember1234').selector).not.toContain('ember1234')
  expect(get('#ember1234').selector).toContain('p')
  expect(get('#ember1234').selector.length).toBeLessThanOrEqual(500)

  // Rects are in page coordinates and match the element.
  for (const [selector, m] of byFixture) {
    const expected = await page.evaluate((sel) => {
      const r = document.querySelector(sel)!.getBoundingClientRect()
      return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height }
    }, selector)
    expect(m.rect.width).toBeGreaterThan(0)
    expect(m.rect.height).toBeGreaterThan(0)
    expect(Math.abs(m.rect.x - expected.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(m.rect.y - expected.y)).toBeLessThanOrEqual(1)
    expect(Math.abs(m.rect.width - expected.width)).toBeLessThanOrEqual(1)
  }
})

test('rects are page coordinates when the page is scrolled', async ({ page }) => {
  await setup(page)
  await beginPoint(page)
  await mark(page, '#fx-counter')
  await page.mouse.move(600, 300)
  await page.mouse.wheel(0, 200)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100)
  await done(page)
  const [capture] = await draftCaptures(page)
  const { top, scroll } = await page.evaluate(() => ({ top: document.querySelector('#fx-counter')!.getBoundingClientRect().top, scroll: scrollY }))
  expect(capture!.scroll.y).toBe(scroll)
  expect(Math.abs(capture!.marks[0]!.rect.y - (top + scroll))).toBeLessThanOrEqual(1)
})

test('marks that left the page before Done are dropped with a notice', async ({ page }) => {
  await setup(page)
  await beginPoint(page)
  await mark(page, '#fx-counter')
  await mark(page, '#fx-icon')
  await page.evaluate(() => document.getElementById('fx-icon')!.remove())
  await done(page)
  const [capture] = await draftCaptures(page)
  expect(capture!.marks.map((m) => m.name)).toEqual(['Add to cart'])
  await expect(page.locator('#nooted-host').getByText('1 marked element left the page')).toBeVisible()
})
