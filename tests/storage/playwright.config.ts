import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'browser.spec.ts',
  fullyParallel: false,
  reporter: [
    ['list'],
    ['json', { outputFile: '../../test-results/storage/results.json' }],
  ],
  outputDir: '../../test-results/storage',
  use: { baseURL: 'http://127.0.0.1:5173', headless: true },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173/tests/storage/harness.html',
    reuseExistingServer: true,
  },
});
