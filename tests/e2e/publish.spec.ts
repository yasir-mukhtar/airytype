import { expect, test } from '@playwright/test';

const publishLink = (page: import('@playwright/test').Page) =>
  page.locator('#publish-link');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue(
    'A little space for your thoughts',
  );
  await expect(
    page.getByRole('button', { name: 'Saved on this device', exact: true }),
  ).toBeVisible();
});

test('a published note opens as a read-only formatted page', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('button', { name: 'Note actions' }).click();
  await page.getByRole('button', { name: 'Publish note', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish this note' });
  await expect(dialog).toBeVisible();
  // Dev server has no publication API: the embedded fallback must appear.
  await expect(publishLink(page)).toHaveValue(/\/published\.html#v1\./);
  const link = await publishLink(page).inputValue();
  await expect(
    dialog.getByRole('link', { name: 'Open page' }),
  ).toHaveAttribute('href', link);

  await page.goto(link);
  const content = page.locator('.doc-content');
  await expect(content).toBeVisible();
  await expect(page.locator('.doc-title')).toHaveText(
    'A little space for your thoughts',
  );
  // Markdown is rendered as typography; no markers leak into the page.
  await expect(
    content.getByRole('heading', { name: 'Make room for a thought.' }),
  ).toBeVisible();
  await expect(content.getByText('sentence focus')).toHaveCSS(
    'font-weight',
    '700',
  );
  await expect(content.locator('hr')).toHaveCount(1);
  expect(await content.textContent()).not.toContain('**');
  // Nothing on the page is editable.
  await expect(page.locator('[contenteditable="true"]')).toHaveCount(0);
  await expect(
    page.locator('input, textarea, select, button'),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a token link stays short and the page fetches its stored snapshot', async ({
  page,
}) => {
  const token = '0123456789abcdef0123456789abcdef';
  const stored = {
    t: 'A little space for your thoughts',
    b: '# A little space for your thoughts\n\nA *short* link, served from the server.\n',
    u: 1_759_000_000_000,
  };
  const published: unknown[] = [];
  await page.route('**/api/publish', async (route) => {
    published.push(await route.request().postDataJSON());
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ token }),
    });
  });
  await page.route(`**/api/publication/${token}`, async (route) => {
    if (route.request().method() === 'DELETE')
      return route.fulfill({ status: 204 });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(stored),
    });
  });

  await page.getByRole('button', { name: 'Note actions' }).click();
  await page.getByRole('button', { name: 'Publish note', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish this note' });
  await expect(publishLink(page)).toHaveValue(
    new RegExp(`/published\\.html#t\\.${token}$`),
  );
  const link = await publishLink(page).inputValue();
  // The whole URL — token included — stays comfortably short.
  expect(link).toContain(`/published.html#t.${token}`);
  expect(link.length).toBeLessThan(80);
  expect(published).toHaveLength(1);
  await expect(dialog.getByRole('button', { name: 'Revoke' })).toBeVisible();

  await page.goto(link);
  const content = page.locator('.doc-content');
  await expect(content).toBeVisible();
  // The note's own # heading is the title; it renders inside the content.
  await expect(
    content.getByRole('heading', { name: 'A little space for your thoughts' }),
  ).toBeVisible();
  await expect(content.getByText('short')).toHaveCSS('font-style', 'italic');
  expect(await content.textContent()).toContain(
    'served from the server',
  );
});

test('a revoked or unknown token shows a calm unavailable page', async ({
  page,
}) => {
  const token = 'f'.repeat(32);
  await page.route(`**/api/publication/${token}`, (route) =>
    route.fulfill({ status: 404, body: '' }),
  );
  await page.goto(`/published.html#t.${token}`);
  await expect(page.locator('.sheet-unavailable')).toBeVisible();
  await expect(
    page.getByText('This page isn’t available'),
  ).toBeVisible();
});

test('the published page reads cleanly at desktop, tablet, and phone sizes', async ({
  page,
}, testInfo) => {
  await page.getByRole('button', { name: 'Note actions' }).click();
  await page.getByRole('button', { name: 'Publish note', exact: true }).click();
  await expect(publishLink(page)).toHaveValue(/#v1\.|#t\./);
  const link = await publishLink(page).inputValue();
  for (const [name, viewport] of [
    ['desktop', { width: 1440, height: 1000 }],
    ['tablet', { width: 834, height: 1112 }],
    ['phone', { width: 390, height: 844 }],
  ] as const) {
    await page.setViewportSize(viewport);
    await page.goto(link);
    await expect(page.locator('.sheet')).toBeVisible();
    // The sheet stays inside the viewport; nothing overflows horizontally.
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      sheetLeft: document
        .querySelector('.sheet')!
        .getBoundingClientRect().left,
      sheetRight: document
        .querySelector('.sheet')!
        .getBoundingClientRect().right,
    }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
    expect(metrics.sheetLeft).toBeGreaterThanOrEqual(0);
    expect(metrics.sheetRight).toBeLessThanOrEqual(metrics.clientWidth + 1);
    await page.screenshot({
      path: testInfo.outputPath(`published-${name}.png`),
      fullPage: true,
    });
  }
});

test('a damaged or empty link shows a calm unavailable page', async ({
  page,
}) => {
  await page.goto('/published.html');
  await expect(page.locator('.sheet-unavailable')).toBeVisible();
  await page.goto('/published.html#v1.corrupted');
  await expect(
    page.getByText('This page isn’t available'),
  ).toBeVisible();
  await page.goto('/published.html#t.not-a-token');
  await expect(page.locator('.sheet-unavailable')).toBeVisible();
});
