import { test, expect } from '@playwright/test';

import { getPrisma, cleanupTestData, flushRateLimit, disconnect } from './helpers/db';
import { submitLogin } from './helpers/auth';
import { submitOtpAndWait } from './helpers/2fa';
import { totpFor } from './helpers/totp';
import { hashPassword } from '../../src/lib/password';
import { encryptSecret } from '../../src/lib/crypto';
import { generateTotpSecret, generateBackupCodes, hashBackupCodes } from '../../src/lib/totp';

const PASSWORD = 'TestPass-123!';

const prisma = getPrisma();

test.beforeEach(async () => {
  await cleanupTestData();
  await flushRateLimit();
});

test.afterAll(async () => {
  await disconnect();
});

test('re-enroll 2FA via backup code → redirected to /2fa/setup', async ({ page }) => {
  // Pre-seed: USER (NOT GLOBAL_ADMIN — re-enroll dialog is disabled for admins),
  // 2FA enabled, with a known TOTP secret + 8 backup codes (raw + hashed).
  const secret = generateTotpSecret();
  const rawCodes = generateBackupCodes();
  const user = await prisma.user.create({
    data: {
      email: 'reenroll@e2e.test',
      displayName: 'Re-enroll User',
      passwordHash: await hashPassword(PASSWORD),
      role: 'USER',
      status: 'ACTIVE',
      twoFactorEnabled: true,
      emailVerifiedAt: new Date(),
    },
  });
  await prisma.twoFactorSecret.create({
    data: {
      userId: user.id,
      secretCipher: encryptSecret(secret),
      backupCodes: await hashBackupCodes(rawCodes),
      confirmedAt: new Date(),
    },
  });

  // Login → /login/2fa → submit OTP → land on / (USER lands on landing after 2FA).
  await submitLogin(page, 'reenroll@e2e.test', PASSWORD);
  await expect(page).toHaveURL(/\/login\/2fa$/);
  await submitOtpAndWait(page, totpFor(secret));

  // window.location.assign('/admin') runs after verify; for USER role, the
  // admin layout redirects to /. Wait until we've left /login/2fa before
  // navigating to /account/security to avoid racing the hard navigation.
  await page.waitForURL((url) => !url.pathname.startsWith('/login/2fa'), { timeout: 15_000 });

  // Navigate to /account/security (any non-public path is fine post-2FA).
  await page.goto('/account/security');
  await expect(page).toHaveURL(/\/account\/security/);

  // Click "Réinitialiser via backup code" → dialog opens.
  await page.getByRole('button', { name: 'Réinitialiser via backup code', exact: true }).click();
  await page.fill('#backup-code-input', rawCodes[0]!);

  const reenrollResponse = page.waitForResponse(
    (r) =>
      r.url().includes('/api/trpc/account.security.startReEnrollWithBackup') &&
      r.request().method() === 'POST',
    { timeout: 10_000 },
  );
  await page.getByRole('button', { name: 'Réinitialiser', exact: true }).click();
  const reenrolled = await reenrollResponse;
  expect(reenrolled.status()).toBe(200);

  // Server-side proofs.
  const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  expect(fresh.twoFactorEnabled).toBe(false);
  const sec = await prisma.twoFactorSecret.findUnique({ where: { userId: user.id } });
  expect(sec).toBeNull();
  const audit = await prisma.auditLog.findFirst({
    where: { action: 'auth.2fa.reset_via_backup', actorId: user.id },
  });
  expect(audit).not.toBeNull();

  // UI: redirected to /2fa/setup by the success handler.
  await expect(page).toHaveURL(/\/2fa\/setup/, { timeout: 10_000 });
});
