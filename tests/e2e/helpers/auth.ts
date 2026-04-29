import type { Page } from '@playwright/test';

/**
 * Submit the credentials login form and wait until the URL leaves /login.
 * Pending-2FA users land on /login/2fa, which is fine — we exclude only
 * /login itself. Mirrors the inline copy used by Phase 1A/1B specs so
 * existing patterns stay aligned.
 */
export async function submitLogin(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => url.pathname !== '/login', { timeout: 15_000 });
}
