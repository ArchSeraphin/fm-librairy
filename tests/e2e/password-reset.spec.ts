import { test, expect, type Page } from '@playwright/test';

import { getPrisma, cleanupTestData, flushRateLimit, disconnect } from './helpers/db';
import {
  clearMailpit,
  extractFirstUrl,
  getAppUrl,
  getMessageBody,
  waitForEmail,
} from './helpers/mailpit';
import { hashPassword, verifyPassword } from '../../src/lib/password';

const PASSWORD = 'TestPass-123!';
const NEW_PASSWORD = 'NewPass-456!';

const prisma = getPrisma();

test.beforeEach(async () => {
  await cleanupTestData();
  await flushRateLimit();
  await clearMailpit();
});

test.afterAll(async () => {
  await disconnect();
});

async function submitLogin(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => url.pathname !== '/login', { timeout: 15_000 });
}

test('Password reset flow — request, consume, login with new password', async ({ page }) => {
  await prisma.user.create({
    data: {
      email: 'reset@e2e.test',
      displayName: 'Reset User',
      passwordHash: await hashPassword(PASSWORD),
      role: 'USER',
      emailVerifiedAt: new Date(),
    },
  });

  // /password/forgot
  await page.goto('/password/forgot');
  await page.fill('input[name="email"]', 'reset@e2e.test');
  const reqResponse = page.waitForResponse(
    (r) => r.url().includes('/api/trpc/password.requestReset') && r.request().method() === 'POST',
    { timeout: 10_000 },
  );
  await page.click('button[type="submit"]');
  await reqResponse;
  await expect(page.getByText(/lien de réinitialisation/i)).toBeVisible({ timeout: 5_000 });

  // Mailpit — subject "Réinitialisation de votre mot de passe"
  const msg = await waitForEmail('reset@e2e.test', (m) =>
    m.Subject.toLowerCase().includes('réinitialisation'),
  );
  const body = await getMessageBody(msg.ID);
  const link = extractFirstUrl(body.HTML || body.Text, `${getAppUrl()}/password/reset/`);

  // Reset page
  await page.goto(link);
  await page.fill('input[name="newPassword"]', NEW_PASSWORD);
  await page.fill('input[name="confirmPassword"]', NEW_PASSWORD);
  await Promise.all([
    page.waitForURL(/\/login\?reset=1/, { timeout: 15_000 }),
    page.click('button[type="submit"]'),
  ]);

  // Hash mis à jour côté DB (assertion serveur, indépendante de l'UI)
  const updated = await prisma.user.findUniqueOrThrow({ where: { email: 'reset@e2e.test' } });
  expect(await verifyPassword(updated.passwordHash, NEW_PASSWORD)).toBe(true);
  expect(await verifyPassword(updated.passwordHash, PASSWORD)).toBe(false);

  // Re-login avec le nouveau mot de passe
  await submitLogin(page, 'reset@e2e.test', NEW_PASSWORD);
  // USER → /
  await expect(async () => {
    expect(new URL(page.url()).pathname).toBe('/');
  }).toPass({ timeout: 10_000 });
});
