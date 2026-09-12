import { expect, test } from '@playwright/test';

test('real Chromium uses strict local transactions and measures 100k-character journal acknowledgement', async ({
  page,
  browser,
}, testInfo) => {
  await page.goto('/tests/storage/harness.html');
  await expect(page.locator('#status')).toHaveText('writer');
  const evidence = await page.evaluate(async () => {
    const repository = window.storageHarness;
    const note = await repository.createNote({
      title: 'Disposable storage benchmark',
      body: 'a'.repeat(100_000),
    });
    const durations: number[] = [];
    const dirtyStates: string[] = [];
    for (let sample = 0; sample < 25; sample += 1) {
      // Let the previous drain finish so each sample includes the idle scheduling delay.
      await new Promise((resolve) => setTimeout(resolve, 1));
      const started = performance.now();
      const suffix = `\nAcknowledged sentinel ${sample}`;
      repository.updateNote(note.id, {
        body: 'a'.repeat(100_000 - suffix.length) + suffix,
      });
      dirtyStates.push(repository.getSnapshot().statuses[note.id]);
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          unsubscribe();
          reject(new Error('Journal acknowledgement timed out.'));
        }, 5000);
        const unsubscribe = repository.subscribe(() => {
          if (repository.getSnapshot().statuses[note.id] === 'saved-local') {
            clearTimeout(timeout);
            unsubscribe();
            resolve();
          }
        });
      });
      durations.push(performance.now() - started);
    }
    const stored = await repository.database.drafts.get([
      repository.accountId,
      note.id,
    ]);
    const sorted = [...durations].sort((a, b) => a - b);
    return {
      documentCharacters: 100_000,
      sampleCount: durations.length,
      p50Ms: sorted[Math.floor(sorted.length * 0.5)],
      p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
      maximumMs: sorted[sorted.length - 1],
      durabilityHints: [...new Set(window.storageDurabilityHints)],
      everyGenerationInitiallyDirty: dirtyStates.every(
        (status) => status === 'saving',
      ),
      latestBodyMatchesDisk: stored?.body === repository.getNote(note.id)?.body,
      finalGeneration: stored?.generation,
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      durations,
    };
  });
  expect(evidence.everyGenerationInitiallyDirty).toBe(true);
  expect(evidence.latestBodyMatchesDisk).toBe(true);
  expect(evidence.finalGeneration).toBe(26);
  expect(evidence.durabilityHints).toEqual(['strict']);
  await testInfo.attach('local-journal-evidence.json', {
    body: JSON.stringify(
      {
        ...evidence,
        browserVersion: browser.version(),
        recordedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  console.log(
    `Local journal: Chromium ${browser.version()}, 100k characters, 25 samples, p50 ${evidence.p50Ms.toFixed(1)} ms, p95 ${evidence.p95Ms.toFixed(1)} ms, strict durability hint.`,
  );
});
