import { defineConfig } from '@playwright/test';
import notebookConfig from './playwright.config';

// Exercise the compiled production bundle, not Vite's development module server.
export default defineConfig({
  ...notebookConfig,
  outputDir: '../../test-results/production',
  use: { ...notebookConfig.use, baseURL: 'http://127.0.0.1:4178' },
  webServer: {
    command: 'npm run preview -- --port 4178 --strictPort',
    url: 'http://127.0.0.1:4178',
    reuseExistingServer: false,
  },
});
