import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('application settings and sidebar layout settle without editor measure loops', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning' && message.text().includes('Measure loop'))
      warnings.push(message.text());
  });
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue(
    'A little space for your thoughts',
  );
  await page.getByRole('button', { name: 'Writing controls' }).click();
  await page.getByRole('button', { name: 'Sentence', exact: true }).click();
  await page.getByRole('button', { name: 'Middle', exact: true }).click();
  await page.getByLabel('Sentence language').selectOption('id');
  await page.getByRole('button', { name: 'Close writing controls' }).click();
  await page
    .getByRole('button', { name: 'Enter distraction-free mode' })
    .click();
  await page.getByRole('textbox', { name: 'Note content' }).click();
  await page.keyboard.type('input sentinel');
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
  await page.waitForTimeout(100);
  expect(warnings).toEqual([]);
});

for (const size of [100_000, 500_000]) {
  test(`persisted ${size}-character draft input, acknowledgement and exact export`, async ({
    page,
  }, testInfo) => {
    const line =
      'Writing in English and Indonesian. Menulis dengan tenang. Keep the exact source.\n\n';
    const body = line.repeat(Math.ceil(size / line.length)).slice(0, size);
    await page.goto('/');
    await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue(
      'A little space for your thoughts',
    );
    await page
      .locator('input[type="file"]')
      .setInputFiles({
        name: `performance-${size}.md`,
        mimeType: 'text/markdown',
        buffer: Buffer.from(body),
      });
    await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue(
      `performance-${size}`,
    );
    const content = page.getByRole('textbox', { name: 'Note content' });
    await content.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.evaluate(() => {
      const metrics = { frames: [] as number[], latestInput: 0, ack: 0 };
      (window as Window & { inputMetrics?: typeof metrics }).inputMetrics =
        metrics;
      document.addEventListener('keydown', (event) => {
        if (
          event.key.length !== 1 ||
          !(event.target as Element)?.closest('.cm-content')
        )
          return;
        const start = performance.now();
        metrics.latestInput = start;
        requestAnimationFrame(() =>
          requestAnimationFrame(() =>
            metrics.frames.push(performance.now() - start),
          ),
        );
      });
      const status = document.querySelector('.save-status')!;
      new MutationObserver(() => {
        if (status.textContent?.includes('Saved on this device'))
          metrics.ack = performance.now() - metrics.latestInput;
      }).observe(status, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    });
    const sentinel = 'performance input stays exact';
    await page.keyboard.type(sentinel, { delay: 25 });
    await expect(
      page.getByRole('button', { name: 'Saved on this device', exact: true }),
    ).toBeVisible();
    const metrics = await page.evaluate(
      () =>
        (
          window as Window & {
            inputMetrics?: { frames: number[]; ack: number };
          }
        ).inputMetrics!,
    );
    const timings = [...metrics.frames].sort((a, b) => a - b);
    const report = {
      characters: size,
      samples: timings.length,
      twoAnimationFramesP95Ms: timings[Math.floor(timings.length * 0.95)],
      finalLocalAckMs: metrics.ack,
      mode: 'development build, real keyboard events through Playwright, persistence enabled, focus and scrolling off',
    };
    console.log('input-performance', JSON.stringify(report));
    await testInfo.attach(`performance-${size}`, {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    });
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download current note' }).click();
    const download = await downloadEvent;
    expect(await readFile((await download.path())!, 'utf8')).toBe(
      body + sentinel,
    );
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue(
      `performance-${size}`,
    );
    const afterReload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download current note' }).click();
    expect(await readFile((await (await afterReload).path())!, 'utf8')).toBe(
      body + sentinel,
    );
  });
}
