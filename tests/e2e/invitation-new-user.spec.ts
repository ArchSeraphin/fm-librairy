import { test, expect, type Page } from '@playwright/test';

import { getPrisma, cleanupTestData, flushRateLimit, disconnect } from './helpers/db';
import {
  clearMailpit,
  extractFirstUrl,
  getAppUrl,
  getMessageBody,
  waitForEmail,
} from './helpers/mailpit';
import { submitOtpAndWait } from './helpers/2fa';
import { totpFor } from './helpers/totp';
import { hashPassword } from '../../src/lib/password';
import { encryptSecret } from '../../src/lib/crypto';
import { generateTotpSecret, generateBackupCodes, hashBackupCodes } from '../../src/lib/totp';

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

test('Invitation flow — new user signs up via emailed link', async ({ page }) => {
  // Seed admin avec 2FA confirmé (pattern Scénario 3 auth-1a.spec.ts).
  const secret = generateTotpSecret();
  const admin = await prisma.user.create({
    data: {
      email: 'inviter@e2e.test',
      displayName: 'Admin Inviter',
      passwordHash: await hashPassword(PASSWORD),
      role: 'GLOBAL_ADMIN',
      twoFactorEnabled: true,
      emailVerifiedAt: new Date(),
    },
  });
  await prisma.twoFactorSecret.create({
    data: {
      userId: admin.id,
      secretCipher: encryptSecret(secret),
      backupCodes: await hashBackupCodes(generateBackupCodes()),
      confirmedAt: new Date(),
    },
  });

  // Login admin → /login/2fa → /admin
  await submitLogin(page, 'inviter@e2e.test', PASSWORD);
  await expect(page).toHaveURL(/\/login\/2fa$/);
  await submitOtpAndWait(page, totpFor(secret));
  await expect(page).toHaveURL(/\/admin/, { timeout: 10_000 });

  // Mini-form invitation
  await page.goto('/admin/users/invite');
  await page.fill('input[name="email"]', 'newbie@e2e.test');

  const inviteResponse = page.waitForResponse(
    (r) => r.url().includes('/api/trpc/invitation.create') && r.request().method() === 'POST',
    { timeout: 10_000 },
  );
  await page.click('button[type="submit"]');
  await inviteResponse;
  await expect(page.getByText(/Invitation envoyée/i)).toBeVisible({ timeout: 5_000 });

  // Mailpit reçoit le mail (subject FR sans library = "Vous êtes invité·e sur BiblioShare")
  const msg = await waitForEmail(
    'newbie@e2e.test',
    (m) => m.Subject.includes('invité') && m.Subject.includes('BiblioShare'),
  );
  const body = await getMessageBody(msg.ID);
  const link = extractFirstUrl(body.HTML || body.Text, `${getAppUrl()}/invitations/`);

  // Newbie ouvre le lien (pas de session).
  await page.context().clearCookies();
  await page.goto(link);

  // Signup form
  await expect(page.locator('input[name="displayName"]')).toBeVisible();
  await page.fill('input[name="displayName"]', 'Newbie User');
  await page.fill('input[name="password"]', NEW_PASSWORD);
  await page.fill('input[name="confirmPassword"]', NEW_PASSWORD);

  await Promise.all([
    page.waitForURL(/^\/(\?.*)?$/, { timeout: 15_000 }),
    page.click('button[type="submit"]'),
  ]);

  // User créé en DB avec le bon email
  const created = await prisma.user.findUnique({ where: { email: 'newbie@e2e.test' } });
  expect(created).not.toBeNull();
  expect(created?.displayName).toBe('Newbie User');
});
