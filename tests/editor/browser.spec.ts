import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/editor/harness.html');
  await expect(
    page.getByRole('textbox', { name: 'Note content' }),
  ).toBeVisible();
});

test('all nine independent focus and scroll modes preserve input and undo', async ({
  page,
}) => {
  const errors: string[] = [];
  const inserted = 'sentinel rapid input 0123456789 '.repeat(4);
  page.on('pageerror', (error) => errors.push(error.message));
  for (const focus of ['off', 'line', 'sentence'] as const) {
    for (const scroll of ['off', 'top', 'middle'] as const) {
      const before = await page.evaluate(
        ({ focus, scroll }) => {
          const editor = window.editorHarness;
          editor.setPreferences({ focus, scroll });
          editor.focus();
          editor.view.dispatch({ selection: { anchor: 48 } });
          return editor.getText();
        },
        { focus, scroll },
      );
      await page.keyboard.type(inserted);
      await expect
        .poll(() => page.evaluate(() => window.editorHarness.getText()), {
          message: `Exact typing in ${focus}/${scroll}`,
        })
        .toBe(before.slice(0, 48) + inserted + before.slice(48));
      await page.evaluate(() => window.editorHarness.undo());
      await expect
        .poll(() => page.evaluate(() => window.editorHarness.getText()))
        .toBe(before);
      if (focus === 'off')
        await expect(page.locator('.airy-focus-muted')).toHaveCount(0);
      else
        await expect(page.locator('.airy-focus-muted').first()).toBeVisible();
    }
  }
  expect(errors).toEqual([]);
});

test('visible-row focus does not illuminate the whole wrapped source line and suspends for selection', async ({
  page,
}) => {
  await page.evaluate(() => {
    const editor = window.editorHarness;
    editor.focus();
    editor.setPreferences({ focus: 'line' });
    editor.view.dispatch({ selection: { anchor: 130 } });
  });
  await expect(page.locator('.airy-focus-muted').first()).toBeVisible();
  const geometry = await page.evaluate(() => {
    const view = window.editorHarness.view;
    const position = view.state.selection.main.head;
    const caret = view.coordsAtPos(position)!;
    const line = view.state.doc.lineAt(position);
    const last = view.coordsAtPos(line.to)!;
    const activeRects = [...document.querySelectorAll('.cm-line')].flatMap(
      (lineDOM) => {
        const walker = document.createTreeWalker(lineDOM, NodeFilter.SHOW_TEXT);
        const rects = [];
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (
            node.parentElement?.closest('.airy-focus-muted') ||
            !node.textContent?.trim()
          )
            continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          rects.push(
            ...Array.from(range.getClientRects(), (rect) => ({
              top: rect.top,
              bottom: rect.bottom,
            })),
          );
        }
        return rects;
      },
    );
    return {
      caret: { top: caret.top, bottom: caret.bottom },
      last: last.top,
      activeRects,
    };
  });
  expect(geometry.last).toBeGreaterThan(geometry.caret.bottom);
  for (const rect of geometry.activeRects)
    expect(Math.abs(rect.top - geometry.caret.top)).toBeLessThan(3);
  await page.evaluate(() =>
    window.editorHarness.view.dispatch({
      selection: { anchor: 48, head: 160 },
    }),
  );
  await expect(page.locator('.airy-focus-muted')).toHaveCount(0);
});

test('typewriter input reaches each anchor while wheel inspection stays put', async ({
  page,
}) => {
  for (const scroll of ['top', 'middle'] as const) {
    await page.evaluate((scroll) => {
      const editor = window.editorHarness;
      editor.focus();
      editor.setPreferences({ focus: 'off', scroll });
      editor.view.dispatch({
        selection: { anchor: 3000 },
        scrollIntoView: true,
      });
    }, scroll);
    await page.keyboard.type('a');
    await expect
      .poll(() =>
        page.evaluate((scroll) => {
          const view = window.editorHarness.view;
          const caret = view.coordsAtPos(view.state.selection.main.head)!;
          const rect = view.scrollDOM.getBoundingClientRect();
          return Math.abs(
            (caret.top + caret.bottom) / 2 -
              (rect.top +
                view.scrollDOM.clientTop +
                view.scrollDOM.clientHeight * (scroll === 'top' ? 0.25 : 0.5)),
          );
        }, scroll),
      )
      .toBeLessThanOrEqual(2);
    const scroller = page.locator('.cm-scroller');
    await scroller.hover();
    const beforeWheel = await page.evaluate(
      () => window.editorHarness.view.scrollDOM.scrollTop,
    );
    await page.mouse.wheel(0, 500);
    await expect
      .poll(() =>
        page.evaluate(() => window.editorHarness.view.scrollDOM.scrollTop),
      )
      .toBeGreaterThanOrEqual(beforeWheel + 490);
    const inspection = await page.evaluate(
      () => window.editorHarness.view.scrollDOM.scrollTop,
    );
    await page.waitForTimeout(180);
    expect(
      await page.evaluate(() => window.editorHarness.view.scrollDOM.scrollTop),
    ).toBe(inspection);
  }
});

test('oversized paste is fully rejected and external replacements clear stale undo', async ({
  page,
}) => {
  const before = await page.evaluate(() => window.editorHarness.getText());
  await page.evaluate(() =>
    window.editorHarness.view.dispatch({
      changes: { from: 0, insert: 'x'.repeat(1024 * 1024) },
      userEvent: 'input.paste',
    }),
  );
  expect(await page.evaluate(() => window.editorHarness.getText())).toBe(
    before,
  );
  await expect(page.locator('#status')).toContainText('Nothing was inserted');
  await page.evaluate(() => {
    window.editorHarness.focus();
    window.editorHarness.view.dispatch({ selection: { anchor: 10 } });
  });
  await page.keyboard.type('local');
  await page.evaluate(() =>
    window.editorHarness.replaceExternal('Authoritative remote 🌱'),
  );
  expect(await page.evaluate(() => window.editorHarness.undo())).toBe(false);
  expect(await page.evaluate(() => window.editorHarness.getText())).toBe(
    'Authoritative remote 🌱',
  );
});

test('note navigation retains session selection and undo without remounting EditorView', async ({
  page,
}) => {
  await page.evaluate(() => {
    window.editorHarness.focus();
    window.editorHarness.view.dispatch({ selection: { anchor: 50 } });
  });
  await page.keyboard.type('remember');
  const result = await page.evaluate(() => {
    const editor = window.editorHarness;
    const view = editor.view;
    const first = editor.getText();
    const caret = view.state.selection.main.head;
    editor.openNote({ noteId: 'another', doc: 'Second note' });
    editor.openNote({ noteId: 'fixture', doc: first });
    return {
      sameView: editor.view === view,
      caret,
      restoredCaret: view.state.selection.main.head,
      undone: editor.undo(),
      body: editor.getText(),
    };
  });
  expect(result.sameView).toBe(true);
  expect(result.restoredCaret).toBe(result.caret);
  expect(result.undone).toBe(true);
  expect(result.body).not.toContain('remember');
});

test('first and last rows can reach either typing anchor', async ({ page }) => {
  for (const scroll of ['top', 'middle'] as const) {
    for (const position of ['first', 'last'] as const) {
      await page.evaluate(
        ({ scroll, position }) => {
          const editor = window.editorHarness;
          editor.replaceExternal('First row.\n\nLast row.');
          editor.focus();
          editor.setPreferences({ scroll });
          editor.view.dispatch({
            selection: {
              anchor: position === 'first' ? 0 : editor.view.state.doc.length,
            },
          });
        },
        { scroll, position },
      );
      await page.keyboard.type('a');
      await expect
        .poll(() =>
          page.evaluate((scroll) => {
            const view = window.editorHarness.view;
            const caret = view.coordsAtPos(view.state.selection.main.head)!;
            const top =
              view.scrollDOM.getBoundingClientRect().top +
              view.scrollDOM.clientTop;
            return Math.abs(
              (caret.top + caret.bottom) / 2 -
                top -
                view.scrollDOM.clientHeight * (scroll === 'top' ? 0.25 : 0.5),
            );
          }, scroll),
        )
        .toBeLessThanOrEqual(2);
    }
  }
});

test('composition-tagged oversized text remains complete and permits reduction', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const editor = window.editorHarness;
    const complete = '🌱'.repeat(262145);
    editor.view.dispatch({
      changes: { from: 0, to: editor.view.state.doc.length, insert: complete },
      userEvent: 'input.type.compose',
    });
    const preserved = editor.getText() === complete;
    editor.view.dispatch({
      changes: {
        from: 0,
        to: editor.view.state.doc.length,
        insert: 'Reduced draft 🌱',
      },
      userEvent: 'input.paste',
    });
    return { preserved, reduced: editor.getText() };
  });
  expect(result).toEqual({ preserved: true, reduced: 'Reduced draft 🌱' });
});
