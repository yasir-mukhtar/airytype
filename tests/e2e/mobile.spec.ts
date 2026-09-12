import { expect, test } from '@playwright/test';

test.use({
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});

test('mobile is explicitly read-only without using viewport width as the desktop rule', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByText(
      'The mobile companion is read-only. Open AiryType on a desktop to write.',
    ),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'New note', exact: true }).first(),
  ).toBeDisabled();
  await expect(page.getByLabel('Library view')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
