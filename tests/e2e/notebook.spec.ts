import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue(
    'A little space for your thoughts',
  );
  await expect(
    page.getByRole('button', { name: 'Saved on this device', exact: true }),
  ).toBeVisible();
});

test('notebook renders, persists exact new text across reload, and exports current memory', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(page.locator('.writing-footer')).toBeInViewport();
  await expect(page.locator('.note-panel-footer')).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath('airytype-desktop.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Note title' })
    .fill('Exact export 🌿');
  const body =
    '  # A literal draft\n\nSentinel 🌱 é — selamat pagi.\n\n- Keep my spaces.  \n';
  const content = page.getByRole('textbox', { name: 'Note content' });
  await content.fill(body);
  await expect(
    page.getByRole('button', { name: 'Saved on this device', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue(
    'Exact export 🌿',
  );
  await expect(content).toContainText('Sentinel 🌱 é — selamat pagi.');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download current note' }).click();
  const download = await downloadEvent;
  expect(await readFile((await download.path())!, 'utf8')).toBe(body);
  expect(errors).toEqual([]);
});

test('folders, dirty search, trash, restore, and archive export preserve note membership', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'New folder', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Folder name' })
    .fill('Morning pages');
  await page
    .getByRole('button', { name: 'Create folder', exact: true })
    .click();
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Note title' })
    .fill('A fresh thought');
  await page
    .getByRole('textbox', { name: 'Note content' })
    .fill('newlytyped-sentinel has literal %_ punctuation.');
  await page
    .getByRole('textbox', { name: 'Search this device' })
    .fill('newlytyped-sentinel %_');
  await expect(page.locator('.note-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Note actions' }).click();
  await page
    .getByRole('button', { name: 'Move to Trash', exact: true })
    .click();
  await expect(
    page.getByText('This note is in Trash. Its text is preserved.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Export library' }).click();
  await page.getByRole('checkbox', { name: 'Include notes in Trash' }).check();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download notebook' }).click();
  const download = await downloadEvent;
  const files = unzipSync(await readFile((await download.path())!));
  expect(
    Object.values(files).some((bytes) =>
      strFromU8(bytes).includes(
        'newlytyped-sentinel has literal %_ punctuation.',
      ),
    ),
  ).toBe(true);
  expect(files['manifest.json']).toBeDefined();
  await page.getByRole('button', { name: 'Restore note', exact: true }).click();
  await expect(
    page.getByText('This note is in Trash. Its text is preserved.'),
  ).toHaveCount(0);
  await expect(
    page.getByRole('textbox', { name: 'Note content' }),
  ).toContainText('newlytyped-sentinel');
});

test('a second tab is read-only and becomes the writer after the original closes', async ({
  page,
  context,
}) => {
  const second = await context.newPage();
  await second.goto('/');
  await expect(second.getByText(/This tab is read-only/)).toBeVisible();
  await expect(
    second.getByRole('button', { name: 'New note', exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('textbox', { name: 'Note title' })
    .fill('Owner tab sentinel');
  await expect(
    page.getByRole('button', { name: 'Saved on this device', exact: true }),
  ).toBeVisible();
  await expect(second.getByRole('textbox', { name: 'Note title' })).toHaveValue(
    'Owner tab sentinel',
  );
  await page.close();
  await second.reload();
  await expect(
    second.getByRole('button', { name: 'New note', exact: true }),
  ).toBeEnabled();
  await expect(second.getByRole('textbox', { name: 'Note title' })).toHaveValue(
    'Owner tab sentinel',
  );
});

test('writing controls persist independently and distraction-free mode keeps the editor', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Writing controls' }).click();
  await page.getByRole('button', { name: 'Sentence', exact: true }).click();
  await page.getByRole('button', { name: 'Middle', exact: true }).click();
  await page.getByLabel('Sentence language').selectOption('id');
  await page.getByRole('button', { name: 'Close writing controls' }).click();
  await page
    .getByRole('button', { name: 'Enter distraction-free mode' })
    .click();
  await expect(page.locator('.note-panel')).toBeHidden();
  await expect(
    page.getByRole('textbox', { name: 'Note content' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.note-panel')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Writing controls' }).click();
  await expect(
    page.getByRole('button', { name: 'Sentence', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('button', { name: 'Middle', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Sentence language')).toHaveValue('id');
});

test('narrow desktop remains writable and no layout escapes viewport', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 650, height: 850 });
  await expect(
    page.getByRole('button', { name: 'New note', exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('airytype-narrow-desktop.png'),
    fullPage: true,
  });
});

test('search shortcut leaves distraction-free writing without changing the draft', async ({
  page,
}) => {
  const content = page.getByRole('textbox', { name: 'Note content' });
  const before = await content.textContent();
  await page
    .getByRole('button', { name: 'Enter distraction-free mode' })
    .click();
  await content.click();
  await page.keyboard.press('ControlOrMeta+Shift+f');
  await expect(
    page.getByRole('textbox', { name: 'Search this device' }),
  ).toBeFocused();
  await page.keyboard.type('search-only-sentinel');
  expect(await content.textContent()).toBe(before);
});

test('batch import reports invalid UTF-8 and exports normalized exact Markdown', async ({
  page,
}) => {
  await page.locator('input[type=file]').setInputFiles([
    {
      name: 'Imported.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('Hello 🌱\r\n\r\nKeep  spaces.\r\n'),
    },
    {
      name: 'Invalid.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from([0xc3, 0x28]),
    },
  ]);
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue(
    'Imported',
  );
  await expect(page.locator('.toast')).toContainText(
    '1 file imported. 1 failed.',
  );
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download current note' }).click();
  const download = await event;
  expect(await readFile((await download.path())!, 'utf8')).toBe(
    'Hello 🌱\n\nKeep  spaces.\n',
  );
});

test('large titles wrap and resize while remaining independent of Markdown', async ({
  page,
}) => {
  const title = page.getByRole('textbox', { name: 'Note title' });
  const content = page.getByRole('textbox', { name: 'Note content' });
  const downloadBody = async () => {
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download current note' }).click();
    return readFile((await (await event).path())!, 'utf8');
  };
  const originalBody = await downloadBody();
  const name = 'A longer title that needs room for every thought';
  await title.fill(name);
  await page.evaluate(() => document.fonts.ready);
  await expect
    .poll(() =>
      title.evaluate((element) => {
        const style = getComputedStyle(element);
        return (
          element.clientHeight > parseFloat(style.lineHeight) &&
          element.scrollHeight <= element.clientHeight + 1
        );
      }),
    )
    .toBe(true);
  await title.press('Enter');
  await expect(content).toBeFocused();
  await page.setViewportSize({ width: 650, height: 850 });
  await expect(title).toHaveValue(name);
  await expect
    .poll(() =>
      title.evaluate((element) => element.scrollWidth <= element.clientWidth),
    )
    .toBe(true);
  expect(await downloadBody()).toBe(originalBody);
  await expect(
    page.getByRole('button', { name: 'Saved on this device', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(title).toHaveValue(name);
  expect(await downloadBody()).toBe(originalBody);
});

test('a matching Markdown title is shown once and the separate note title remains renameable', async ({
  page,
}) => {
  const source =
    '# A quiet page\n\nA **strong thought** with a [compact link](https://example.com/long/destination).\n';
  await page.locator('input[type="file"]').setInputFiles({
    name: 'A quiet page.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(source),
  });
  await expect(
    page.getByRole('textbox', { name: 'Note content' }),
  ).toContainText('A quiet page');
  await expect(page.locator('.document-heading')).toBeHidden();
  await expect(page.locator('.airy-heading-1')).toBeVisible();
  await page.getByRole('button', { name: 'Note actions' }).click();
  await page.getByRole('button', { name: 'Rename note', exact: true }).click();
  const title = page.getByRole('textbox', { name: 'Note title' });
  await expect(title).toBeFocused();
  await expect(title).toHaveValue('A quiet page');
  await title.fill('My notebook title');
  await title.press('Enter');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download current note' }).click();
  expect(await readFile((await (await download).path())!, 'utf8')).toBe(source);
  await expect(
    page.getByRole('button', { name: 'Saved on this device', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(title).toHaveValue('My notebook title');
  await expect(page.locator('.airy-heading-1')).toContainText('A quiet page');
});

test('compact library keeps folders, account and search reachable without changing the draft', async ({
  page,
}) => {
  await page.setViewportSize({ width: 650, height: 850 });
  const content = page.getByRole('textbox', { name: 'Note content' });
  const before = await content.textContent();
  const library = page.getByRole('complementary', {
    name: 'Library navigation',
  });
  await expect(library).toBeHidden();
  await page.getByRole('button', { name: 'Show folders', exact: true }).click();
  await expect(library).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'New folder', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Your writing space/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: /Find a thought/ }).click();
  await expect(library).toBeHidden();
  await expect(
    page.getByRole('textbox', { name: 'Search this device' }),
  ).toBeFocused();
  expect(await content.textContent()).toBe(before);
  await page.getByRole('button', { name: 'Show folders', exact: true }).click();
  await page
    .getByRole('button', { name: 'Close library', exact: true })
    .click();
  await expect(library).toBeHidden();
});
