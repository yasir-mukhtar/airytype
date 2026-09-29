import { expect, test } from '@playwright/test';

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
  const link = await dialog.locator('#publish-link').inputValue();
  expect(link).toContain('/published.html#v1.');
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

test('the published page reads cleanly at desktop, tablet, and phone sizes', async ({
  page,
}, testInfo) => {
  await page.getByRole('button', { name: 'Note actions' }).click();
  await page.getByRole('button', { name: 'Publish note', exact: true }).click();
  const link = await page.locator('#publish-link').inputValue();
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
});
