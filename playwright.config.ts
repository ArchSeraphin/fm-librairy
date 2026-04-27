import { defineConfig, devices } from '@playwright/test';

// Configuration Playwright pour les tests E2E BiblioShare.
// En local, réutilise un dev server déjà démarré (port 3000) ; sinon Playwright
// le lance via `pnpm dev`. En CI on suppose un serveur joignable via APP_URL.
//
// globalSetup charge .env.local dans process.env du runner pour que les helpers
// E2E (encryptSecret, hashPassword…) utilisent les mêmes clés crypto que le
// serveur. Les tests partagent la DB dev locale ; isolation par préfixe d'email
// (@e2e.test) — pas de testcontainers (cf. note dans global-setup.ts).
const PORT = 3000;
const BASE_URL = process.env.APP_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: require.resolve('./tests/e2e/setup/global-setup.ts'),
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.CI
    ? undefined
    : {
        // Force NODE_ENV=development so Next.js loads .env.local. By default
        // Playwright sets NODE_ENV=test in the parent, which makes next dev
        // skip .env.local and fall back to .env (different CRYPTO_MASTER_KEY
        // → encrypt/decrypt mismatch with the test process).
        command: 'NODE_ENV=development pnpm dev',
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 180_000,
      },
});
