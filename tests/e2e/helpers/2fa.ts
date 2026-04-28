import type { Page } from '@playwright/test';

/**
 * Type a 6-digit TOTP code into the OTP input. Targets the first numeric
 * input (the OTP component splits digits across inputs but accepts a single
 * focus + keystroke sequence).
 */
export async function fillOtp(page: Page, code: string): Promise<void> {
  const first = page.locator('input[inputmode="numeric"]').first();
  await first.click();
  await page.keyboard.type(code, { delay: 20 });
}

/**
 * Type the OTP and wait for both the verify/confirm tRPC response AND the
 * follow-up NextAuth `/api/auth/session` POST (best-effort — the session
 * refresh is observed but not required, hence the .catch swallow).
 */
export async function submitOtpAndWait(page: Page, code: string): Promise<void> {
  const verifyResponse = page.waitForResponse(
    (r) =>
      (r.url().includes('/api/trpc/auth.verify2FA') ||
        r.url().includes('/api/trpc/auth.confirm2FA')) &&
      r.request().method() === 'POST',
    { timeout: 10_000 },
  );
  await fillOtp(page, code);
  await verifyResponse;
  await page
    .waitForResponse(
      (r) => r.url().includes('/api/auth/session') && r.request().method() === 'POST',
      { timeout: 5_000 },
    )
    .catch(() => undefined);
}
