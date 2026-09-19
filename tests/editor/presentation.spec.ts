import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/editor/harness.html');
  await page.evaluate(() => document.fonts.ready);
});

test('heading hierarchy hangs faint markers outside the aligned, wrapping prose column', async ({
  page,
}) => {
  const source =
    '# A quiet page for every kind of thought\n\nOrdinary prose.\n\n## A heading that is deliberately long enough to wrap across more than one line in the writing column\n\n### Smaller heading\n\n#### Fourth heading\n\n##### Fifth heading\n\n###### Sixth heading\n\nCaret.';
  await page.evaluate(
    (source) => window.editorHarness.replaceExternal(source),
    source,
  );
  await expect(page.locator('.airy-heading')).toHaveCount(6);
  const layout = await page.evaluate((source) => {
    const view = window.editorHarness.view;
    const headings = [
      ...document.querySelectorAll<HTMLElement>('.airy-heading'),
    ];
    const firstText = view.coordsAtPos(2)!;
    const prose = view.coordsAtPos(source.indexOf('Ordinary'))!;
    const secondText = view.coordsAtPos(source.indexOf('## ') + 3)!;
    const marker = document.querySelector('.airy-heading-marker')!;
    return {
      left: [firstText.left, prose.left, secondText.left],
      marker: marker.getBoundingClientRect().left,
      ink: getComputedStyle(marker).color,
      size: headings.map((h) => getComputedStyle(h).fontSize),
      italic: headings.slice(4).map((h) => getComputedStyle(h).fontStyle),
      weight: headings.map((h) => getComputedStyle(h).fontWeight),
      wraps: headings[1].getBoundingClientRect().height > 76,
    };
  }, source);
  expect(Math.max(...layout.left) - Math.min(...layout.left)).toBeLessThan(1);
  expect(layout.marker).toBeLessThan(layout.left[0]);
  expect(layout.ink).toBe('rgb(210, 210, 210)');
  expect(layout.size).toEqual([
    '50px',
    '28px',
    '21px',
    '14.5px',
    '14.5px',
    '14.5px',
  ]);
  expect(layout.weight).toEqual(['800', '700', '700', '700', '700', '400']);
  expect(layout.italic).toEqual(['italic', 'italic']);
  expect(layout.wraps).toBe(true);
  expect(await page.evaluate(() => window.editorHarness.getText())).toBe(
    source,
  );
  await page.evaluate(() => {
    const editor = window.editorHarness;
    editor.focus();
    editor.view.dispatch({
      selection: { anchor: editor.getText().length },
      scrollIntoView: true,
    });
  });
  await page.keyboard.press('ControlOrMeta+Home');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const heading = document
          .querySelector('.airy-heading-1')!
          .getBoundingClientRect();
        return (
          heading.top -
          window.editorHarness.view.scrollDOM.getBoundingClientRect().top
        );
      }),
    )
    .toBeGreaterThanOrEqual(-1);
  await page.evaluate(() => window.editorHarness.find());
  await page.getByPlaceholder('Find').pressSequentially('#');
  await page.getByPlaceholder('Find').press('Enter');
  expect(
    await page.evaluate((source) => {
      const view = window.editorHarness.view;
      return Math.abs(
        view.coordsAtPos(2)!.left -
          view.coordsAtPos(source.indexOf('Ordinary'))!.left,
      );
    }, source),
  ).toBeLessThan(1);
});

test('compact links preserve exact destinations and reveal their source for editing, selection, and find', async ({
  page,
}) => {
  const source =
    'Start with [`README.md`](./README.md "A title") and [**strong label**](https://example.com/a(b)/long).\n\n[Reference][id] and [collapsed][] and [shortcut].\n\n<https://example.com> and <writer@example.com>.\n\n[unresolved] and \\[escaped](literal) and `[literal](code)`.\n\n[id]: /destination\n[collapsed]: /two\n[shortcut]: /three\n\nCaret.';
  await page.evaluate((source) => {
    const editor = window.editorHarness;
    editor.replaceExternal(source);
    editor.view.dispatch({ selection: { anchor: source.length } });
  }, source);
  await expect(page.locator('.airy-link-label')).toHaveCount(7);
  await expect(page.locator('.cm-line').first()).toHaveText(
    'Start with `README.md` and **strong label**.',
  );
  await expect(
    page.getByRole('textbox', { name: 'Note content' }),
  ).toContainText('[unresolved]');
  await expect(
    page.getByRole('textbox', { name: 'Note content' }),
  ).toContainText('[literal](code)');
  const pos = source.indexOf('./README.md');
  await page.evaluate((pos) => {
    window.editorHarness.focus();
    window.editorHarness.view.dispatch({ selection: { anchor: pos } });
  }, pos);
  await expect(page.locator('.cm-line').first()).toContainText(
    './README.md "A title"',
  );
  await page.keyboard.type('updated/');
  expect(await page.evaluate(() => window.editorHarness.getText())).toBe(
    source.slice(0, pos) + 'updated/' + source.slice(pos),
  );
  await page.evaluate(() => window.editorHarness.undo());
  expect(await page.evaluate(() => window.editorHarness.getText())).toBe(
    source,
  );
  await page.evaluate(() => {
    const editor = window.editorHarness;
    editor.view.dispatch({ selection: { anchor: editor.getText().length } });
    editor.find();
  });
  await page.getByPlaceholder('Find').pressSequentially('./README.md');
  await page.getByPlaceholder('Find').press('Enter');
  await expect(page.locator('.cm-line').first()).toContainText('./README.md');
  expect(await page.evaluate(() => window.editorHarness.getText())).toBe(
    source,
  );
});

test('caret traversal and typing in formatted content preserve source and undo in all nine writing modes', async ({
  page,
}) => {
  const source =
    '# A quiet heading\n\nBefore [**a strong label**](./a/long/destination.md) after.\n\n> Quoted thoughts remain editable.\n\nCaret.';
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const focus of ['off', 'line', 'sentence'] as const) {
    for (const scroll of ['off', 'top', 'middle'] as const) {
      const position = source.indexOf('strong');
      await page.evaluate(
        ({ source, focus, scroll, position }) => {
          const editor = window.editorHarness;
          editor.replaceExternal(source);
          editor.setPreferences({ focus, scroll });
          editor.focus();
          editor.view.dispatch({ selection: { anchor: position } });
        },
        { source, focus, scroll, position },
      );
      const text = 'a thought stays exact ';
      await page.keyboard.type(text);
      expect(await page.evaluate(() => window.editorHarness.getText())).toBe(
        source.slice(0, position) + text + source.slice(position),
      );
      await page.evaluate(() => window.editorHarness.undo());
      expect(await page.evaluate(() => window.editorHarness.getText())).toBe(
        source,
      );
    }
  }
  await page.evaluate(() => {
    const editor = window.editorHarness;
    editor.setPreferences({ focus: 'off', scroll: 'off' });
    editor.view.dispatch({
      selection: { anchor: editor.getText().indexOf('[') - 1 },
    });
  });
  // Every source character remains reachable; hidden syntax is never atomic.
  const initial = source.indexOf('[') - 1;
  for (
    let i = 1;
    i <= '[**a strong label**](./a/long/destination.md)'.length + 2;
    i++
  ) {
    await page.keyboard.press('ArrowRight');
    expect(
      await page.evaluate(
        () => window.editorHarness.view.state.selection.main.head,
      ),
    ).toBe(initial + i);
  }
  expect(errors).toEqual([]);
});

test('code punctuation stays literal, fences are editable, and wrapped lists and quotes hang correctly', async ({
  page,
}) => {
  const source =
    '```md\n# A literal heading\n**literal** [link](destination)\n```\n\n- A list item that is deliberately long enough to wrap over several visual lines so its continuation aligns with the first word.\n\n> A quote that is deliberately long enough to wrap over several visual lines so its continuation aligns with the first word.\n\nCaret.';
  await page.evaluate((source) => {
    const editor = window.editorHarness;
    editor.replaceExternal(source);
    editor.view.dispatch({ selection: { anchor: source.length } });
  }, source);
  await expect(page.locator('.airy-heading')).toHaveCount(0);
  await expect(page.locator('.airy-link-label')).toHaveCount(0);
  await expect(page.locator('.airy-code-block')).toHaveCount(4);
  await expect(page.locator('.airy-code-first')).toHaveText('md');
  await expect(page.locator('.airy-code-block').nth(2)).toHaveText(
    '**literal** [link](destination)',
  );
  const layout = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.airy-hanging-line')].map(
      (line) => {
        const prefix = line.querySelector('.airy-block-prefix')!;
        const range = document.createRange();
        range.setStartAfter(prefix);
        range.setEnd(line, line.childNodes.length);
        const rects = [...range.getClientRects()].filter((r) => r.width > 0);
        return { first: rects[0].left, wrapped: rects.at(-1)!.left };
      },
    ),
  );
  for (const line of layout)
    expect(Math.abs(line.first - line.wrapped)).toBeLessThan(1);
  await page.evaluate(() => {
    const editor = window.editorHarness;
    editor.focus();
    editor.view.dispatch({ selection: { anchor: 1 } });
  });
  await expect(page.locator('.airy-code-first')).toHaveText('```md');
  expect(await page.evaluate(() => window.editorHarness.getText())).toBe(
    source,
  );
});
