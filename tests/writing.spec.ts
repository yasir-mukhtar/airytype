import { test, expect, type Page } from '@playwright/test'
import type * as Driver from './browser-driver'

async function driver<K extends keyof typeof Driver>(page: Page, method: K, ...args: Parameters<(typeof Driver)[K]>): Promise<ReturnType<(typeof Driver)[K]>> {
  return page.evaluate(async ({ method, args }) => {
    const path = '/tests/browser-driver.ts'
    const module = await import(/* @vite-ignore */ path)
    return module[method](...args)
  }, { method, args })
}

async function mode(page: Page, group: 'Focus' | 'Position', value: string) {
  await page.getByRole('group', { name: group, exact: true }).getByText(value, { exact: true }).click()
}

async function settle(page: Page) { await page.waitForTimeout(220) }

async function anchored(page: Page, fraction: number) {
  await expect.poll(async () => {
    const s = await driver(page, 'snapshot')
    return Math.abs((s.caretY ?? -10000) - s.viewportHeight * fraction)
  }).toBeLessThan(3)
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error' || /stabilize|Measure loop/.test(message.text())) errors.push(message.text()) })
  await page.goto('/poc.html')
  await page.evaluate(() => document.fonts.ready)
  await expect(page.getByRole('textbox', { name: 'Writing area' })).toBeFocused()
  await settle(page)
  ;(page as Page & { editorErrors: string[] }).editorErrors = errors
})

test.afterEach(async ({ page }) => {
  expect((page as Page & { editorErrors: string[] }).editorErrors).toEqual([])
})

test('opens immediately, preserves plain Markdown and resets without storage', async ({ page }) => {
  const before = await driver(page, 'snapshot')
  await page.keyboard.type('A new thought. ')
  expect((await driver(page, 'snapshot')).text).toContain('A new thought. Give them')
  expect(await page.evaluate(() => localStorage.length)).toBe(0)
  await page.reload()
  expect((await driver(page, 'snapshot')).text).toBe(before.text)
})

test('line focus follows a visual row inside a wrapped paragraph without moving text', async ({ page }) => {
  const text = 'A long sentence meanders across this page and keeps going. '.repeat(18)
  await driver(page, 'replace', text, 60)
  await settle(page)
  const before = await driver(page, 'snapshot')
  await mode(page, 'Focus', 'Line')
  await settle(page)
  const first = await driver(page, 'snapshot')
  expect(first.text).toBe(text)
  expect(first.scrollTop).toBeCloseTo(before.scrollTop, 0)
  expect(first.lineHeight!).toBeGreaterThan(first.rowBottom! - first.rowTop!)
  await page.keyboard.press('ArrowDown')
  await settle(page)
  const next = await driver(page, 'snapshot')
  expect(next.rowTop!).toBeGreaterThan(first.rowTop!)
  expect(next.text).toBe(text)
  expect(next.activeLineText).toBe(text)
  await page.keyboard.press('Shift+ArrowRight')
  expect((await driver(page, 'snapshot')).selection).toBe('range')
  expect(await page.locator('.cm-line').first().evaluate(el => getComputedStyle(el).opacity)).toBe('1')
})

for (const [label, text, needle, expected] of [
  ['English punctuation', '“Ready?” Yes! The value is 3.14, approximately. Next thought… then another.', '3.14', 'The value is 3.14, approximately. '],
  ['Indonesian punctuation', '“Mulai dari mana?” Dari satu kalimat, mungkin. Setelah itu, kita lanjut.', 'satu', 'Dari satu kalimat, mungkin. '],
  ['soft line breaks', 'One thought continues\non the next source line. A new thought begins.', 'continues', 'One thought continueson the next source line. '],
]) {
  test(`sentence focus handles ${label}`, async ({ page }) => {
    await driver(page, 'replace', text, text.indexOf(needle))
    await mode(page, 'Focus', 'Sentence')
    await settle(page)
    expect(await driver(page, 'activeText')).toBe(expected)
    expect((await driver(page, 'snapshot')).text).toBe(text)
  })
}

test('sentence boundaries, headings, blank lines and selection remain comfortable', async ({ page }) => {
  const text = '# A heading\n\nFirst sentence. Second sentence!\n\nLast thought.'
  await driver(page, 'replace', text, 4)
  await mode(page, 'Focus', 'Sentence')
  expect(await driver(page, 'activeText')).toBe('# A heading')
  await driver(page, 'select', text.indexOf('Second'))
  expect(await driver(page, 'activeText')).toBe('Second sentence!')
  await driver(page, 'select', 12)
  expect(await driver(page, 'activeText')).toBe('')
  await driver(page, 'select', text.length)
  expect(await driver(page, 'activeText')).toBe('Last thought.')
  await page.keyboard.press('Shift+ArrowLeft')
  expect(await page.locator('.cm-focus-muted').count()).toBe(0)
  expect(await driver(page, 'nativeSelection')).toBe('.')
  await mode(page, 'Focus', 'Off')
  expect((await driver(page, 'snapshot')).text).toBe(text)
})

for (const [position, fraction] of [['Top', .25], ['Middle', .5]] as const) {
  test(`${position}: typing and wraps stay anchored; navigation and manual scrolling stay free`, async ({ page }) => {
    const text = Array.from({ length: 80 }, (_, i) => `Paragraph ${i}. A thought to return to, when there is a little more time.\n\n`).join('')
    await driver(page, 'replace', text, text.indexOf('Paragraph 20') + 12)
    await settle(page)
    const initial = await driver(page, 'snapshot')
    await mode(page, 'Position', position)
    expect((await driver(page, 'snapshot')).scrollTop).toBeCloseTo(initial.scrollTop, 0)
    await page.keyboard.type('New words arrive, and then a few more. '.repeat(5), { delay: 3 })
    await anchored(page, fraction)
    await page.keyboard.press('Enter')
    await anchored(page, fraction)
    const atAnchor = await driver(page, 'snapshot')
    await page.keyboard.press('ArrowUp')
    await settle(page)
    const navigated = await driver(page, 'snapshot')
    expect(navigated.scrollTop).toBeCloseTo(atAnchor.scrollTop, 0)
    expect(Math.abs(navigated.caretY! - navigated.viewportHeight * fraction)).toBeGreaterThan(10)
    await page.keyboard.press('Shift+ArrowUp')
    await page.keyboard.press('Shift+ArrowLeft')
    expect((await driver(page, 'snapshot')).selection).toBe('range')
    await page.keyboard.press('ArrowRight')
    await page.mouse.move(1100, 350)
    await page.mouse.wheel(0, -1800)
    await settle(page)
    const scrolled = await driver(page, 'snapshot')
    await page.waitForTimeout(350)
    expect((await driver(page, 'snapshot')).scrollTop).toBeCloseTo(scrolled.scrollTop, 0)
    expect(scrolled.scrollTop).toBeLessThan(atAnchor.scrollTop - 500)
    await page.keyboard.type('Back to writing. ')
    await anchored(page, fraction)
  })

  test(`${position}: first and last characters can reach the anchor`, async ({ page }) => {
    await driver(page, 'replace', 'One small thought.', 0)
    await mode(page, 'Position', position)
    await page.keyboard.type('First. ')
    await anchored(page, fraction)
    await driver(page, 'select', (await driver(page, 'snapshot')).text.length)
    await page.keyboard.type(' Last.')
    await anchored(page, fraction)
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.press('Backspace')
    await anchored(page, fraction)
    expect((await driver(page, 'snapshot')).text).toBe('')
    await page.keyboard.type('Start again.')
    await anchored(page, fraction)
  })
}

test('clicking, dragging and keyboard navigation do not activate fixed scrolling', async ({ page }) => {
  const text = Array.from({ length: 80 }, (_, i) => `Line ${i} has a small thought.\n`).join('')
  await driver(page, 'replace', text, text.indexOf('Line 15'))
  await mode(page, 'Position', 'Top')
  await mode(page, 'Focus', 'Line')
  await page.keyboard.type('Here. ')
  await anchored(page, .25)
  const before = await driver(page, 'snapshot')
  const start = await driver(page, 'point', before.text.indexOf('Line 17') + 2)
  const end = await driver(page, 'point', before.text.indexOf('Line 19') + 12)
  await page.mouse.click(start.x, start.y)
  await settle(page)
  expect((await driver(page, 'snapshot')).scrollTop).toBeCloseTo(before.scrollTop, 0)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 12 })
  await page.mouse.up()
  expect((await driver(page, 'snapshot')).selection).toBe('range')
  expect((await driver(page, 'nativeSelection'))!.length).toBeGreaterThan(20)
  await page.keyboard.press('ArrowLeft')
  for (const key of ['Home', 'End', 'PageUp', 'PageDown', 'ArrowDown', 'ArrowRight']) {
    await page.keyboard.press(key)
    await settle(page)
    const s = await driver(page, 'snapshot')
    await page.waitForTimeout(150)
    expect((await driver(page, 'snapshot')).scrollTop).toBeCloseTo(s.scrollTop, 0)
    expect(s.text).toBe(before.text)
  }
})

test('paste, undo and redo keep source and history intact across mode changes', async ({ page }) => {
  await driver(page, 'replace', 'Beginning.\n\nEnd.', 10)
  await mode(page, 'Focus', 'Sentence')
  await mode(page, 'Position', 'Top')
  const pasted = '\n\n## Pasted heading\n\n“Hello!” **Selamat pagi.**\n'
  await driver(page, 'paste', pasted)
  await anchored(page, .25)
  const edited = await driver(page, 'snapshot')
  expect(edited.text).toContain(pasted)
  await mode(page, 'Focus', 'Line')
  await mode(page, 'Position', 'Middle')
  await page.keyboard.press('ControlOrMeta+z')
  await settle(page)
  const undone = await driver(page, 'snapshot')
  expect(undone.text).toBe('Beginning.\n\nEnd.')
  expect(Math.abs(undone.caretY! - undone.viewportHeight / 2)).toBeGreaterThan(20)
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await settle(page)
  expect((await driver(page, 'snapshot')).text).toBe(edited.text)
})

test('long Markdown stays virtualized and responsive', async ({ page }) => {
  const text = Array.from({ length: 1600 }, (_, i) => `## Thought ${i}\n\nA quiet sentence, with **emphasis**, a number (3.14), and a question? Kalimat berikutnya tetap mengalir.\n\n`).join('')
  await driver(page, 'replace', text, text.indexOf('Thought 1200'))
  await mode(page, 'Focus', 'Sentence')
  await mode(page, 'Position', 'Middle')
  const start = Date.now()
  await page.keyboard.type('Writing remains responsive. ', { delay: 5 })
  await anchored(page, .5)
  const s = await driver(page, 'snapshot')
  expect(s.text).toContain('Writing remains responsive. Thought 1200')
  expect(s.renderedLines).toBeLessThan(180)
  expect(Date.now() - start).toBeLessThan(3000)
})

test('native composition preserves text and waits until commit to anchor', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native composition automation uses Chromium CDP; other IMEs need manual testing.')
  await driver(page, 'replace', 'A quiet beginning.\n\nA second thought.', 8)
  await mode(page, 'Focus', 'Sentence')
  await mode(page, 'Position', 'Top')
  const before = await driver(page, 'snapshot')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.imeSetComposition', { text: 'にほん', selectionStart: 3, selectionEnd: 3 })
  await settle(page)
  expect((await driver(page, 'snapshot')).scrollTop).toBeCloseTo(before.scrollTop, 0)
  await cdp.send('Input.insertText', { text: '日本' })
  await anchored(page, .25)
  expect((await driver(page, 'snapshot')).text).toBe('A quiet 日本beginning.\n\nA second thought.')
})

test('responsive layout and mode controls remain usable on a small viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await settle(page)
  await mode(page, 'Focus', 'Line')
  await mode(page, 'Position', 'Middle')
  await page.keyboard.type('A mobile thought. ')
  await anchored(page, .5)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await expect(page.getByRole('group', { name: 'Position', exact: true })).toBeInViewport()
  await page.screenshot({ path: 'test-results/airytype-mobile.png' })
})

test('desktop appearance and sentence focus', async ({ page }) => {
  await page.screenshot({ path: 'test-results/airytype-desktop.png' })
  await mode(page, 'Focus', 'Sentence')
  await page.screenshot({ path: 'test-results/airytype-sentence.png' })
})

test('all nine mode combinations preserve text geometry, caret, and undo', async ({ page }) => {
  const original = (await driver(page, 'snapshot')).text
  for (const focus of ['Off', 'Line', 'Sentence']) {
    for (const position of ['Off', 'Top', 'Middle']) {
      const before = await driver(page, 'snapshot')
      await mode(page, 'Focus', focus)
      await mode(page, 'Position', position)
      await settle(page)
      const after = await driver(page, 'snapshot')
      expect(after.head).toBe(before.head)
      expect(after.scrollTop).toBeCloseTo(before.scrollTop, 0)
      expect(after.caretY).toBeCloseTo(before.caretY!, 0)
      await page.keyboard.type('word ')
      if (position !== 'Off') await anchored(page, position === 'Top' ? .25 : .5)
    }
  }
  for (let i = 0; i < 9; i++) {
    if ((await driver(page, 'snapshot')).text === original) break
    await page.keyboard.press('ControlOrMeta+z')
  }
  expect((await driver(page, 'snapshot')).text).toBe(original)
})

test('keyboard users can change modes and return to the same caret', async ({ page, browserName }) => {
  const before = await driver(page, 'snapshot')
  // Safari uses Option+Tab to visit controls when full keyboard access is off.
  const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab'
  const back = browserName === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab'
  await page.keyboard.press(tab)
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('group', { name: 'Focus', exact: true }).getByRole('radio', { name: 'Line', exact: true })).toBeFocused()
  expect((await driver(page, 'snapshot')).focus).toBe('line')
  await expect(page.getByRole('group', { name: 'Focus', exact: true }).getByRole('radio', { name: 'Line', exact: true })).toBeChecked()
  await page.keyboard.press(tab)
  await page.keyboard.press('ArrowRight')
  expect((await driver(page, 'snapshot')).position).toBe('top')
  await page.keyboard.press(back)
  await page.keyboard.press(back)
  await expect(page.getByRole('textbox', { name: 'Writing area' })).toBeFocused()
  expect((await driver(page, 'snapshot')).head).toBe(before.head)
  await page.keyboard.type('Keyboard thought. ')
  await anchored(page, .25)
})

test('manual input interrupts a pending scroll correction', async ({ page }) => {
  const text = 'A thought on its own line.\n'.repeat(100)
  await driver(page, 'replace', text, 1000)
  await mode(page, 'Position', 'Top')
  await page.keyboard.type('x')
  await page.mouse.move(1100, 350)
  await page.mouse.wheel(0, -500)
  await settle(page)
  const scrolled = await driver(page, 'snapshot')
  await page.waitForTimeout(300)
  expect((await driver(page, 'snapshot')).scrollTop).toBeCloseTo(scrolled.scrollTop, 0)
  await page.keyboard.type('y')
  await anchored(page, .25)
})

test('text can be enlarged to 200 percent without clipping controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
  await settle(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await mode(page, 'Focus', 'Sentence')
  await mode(page, 'Position', 'Middle')
  await page.keyboard.type('Larger text. ')
  await anchored(page, .5)
  await expect(page.getByRole('group', { name: 'Position', exact: true })).toBeInViewport()
})
