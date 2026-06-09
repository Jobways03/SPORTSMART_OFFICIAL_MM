import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the storefront UI E2E suite.
 *
 * Assumes the dev stack is already running (API :8000 + storefront :4005 via
 * `turbo run dev`). It does NOT start them itself — the storefront alone can't
 * serve without the API. See e2e/README.md for the one-time preconditions.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:4005',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
