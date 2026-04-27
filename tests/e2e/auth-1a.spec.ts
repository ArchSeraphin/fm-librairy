import { test, expect, type Page } from '@playwright/test';

import {
  getPrisma,
  cleanupTestData,
  flushRateLimit,
  disconnect,
  hashTestEmail,
} from './helpers/db';
import { totpFor } from './helpers/totp';
import { hashPassword } from '../../src/lib/password';
import { encryptSecret, decryptSecret as decryptSecretFn } from '../../src/lib/crypto';
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

// Type 6 digits into the OtpInput by focusing the first cell and typing
// digit by digit (handleChange auto-advances focus). Same UX as a real user.
// onComplete fires verify.mutate as soon as the 6th digit lands.
async function fillOtp(page: Page, code: string): Promise<void> {
  const first = page.locator('input[inputmode="numeric"]').first();
  await first.click();
  await page.keyboard.type(code, { delay: 20 });
}

// fillOtp + wait for the verify tRPC POST to fully resolve, then for the
// session to refresh (update() POSTs to /api/auth/session). Without this
// the test races middleware: the next URL probe can hit /admin BEFORE the
// fresh JWT cookie is in place, and middleware bounces back to /login/2fa.
async function submitOtpAndWait(page: Page, code: string): Promise<void> {
  const verifyResponse = page.waitForResponse(
    (r) =>
      (r.url().includes('/api/trpc/auth.verify2FA') ||
        r.url().includes('/api/trpc/auth.confirm2FA')) &&
      r.request().method() === 'POST',
    { timeout: 10_000 },
  );
  await fillOtp(page, code);
  await verifyResponse;
  // After verify, the client awaits update() before pushing — the session
  // POST guarantees the cookie has been replaced before navigation.
  await page
    .waitForResponse(
      (r) => r.url().includes('/api/auth/session') && r.request().method() === 'POST',
      { timeout: 5_000 },
    )
    .catch(() => undefined);
}

async function submitLogin(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  // signIn is async (router.push fires after the credentials POST resolves).
  // Wait until we've left /login so subsequent navigation runs with a session.
  // Pending-2FA users land on /login/2fa, which is fine — exclude only /login itself.
  await page.waitForURL((url) => url.pathname !== '/login', { timeout: 15_000 });
}

test('Scénario 1: global admin sans 2FA et > 7 jours → /2fa/setup forcé', async ({ page }) => {
  await prisma.user.create({
    data: {
      email: 'admin1@e2e.test',
      displayName: 'Admin Aged',
      passwordHash: await hashPassword(PASSWORD),
      role: 'GLOBAL_ADMIN',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      createdAt: new Date(Date.now() - 8 * 24 * 3600 * 1000),
    },
  });

  await submitLogin(page, 'admin1@e2e.test', PASSWORD);

  await expect(page).toHaveURL(/\/2fa\/setup$/);
});

test('Scénario 2: enrolment 2FA complet → recovery codes → /admin', async ({ page }) => {
  await prisma.user.create({
    data: {
      email: 'admin2@e2e.test',
      displayName: 'Admin Fresh',
      passwordHash: await hashPassword(PASSWORD),
      role: 'GLOBAL_ADMIN',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });

  await submitLogin(page, 'admin2@e2e.test', PASSWORD);
  await expect(page).toHaveURL(/\/admin/);

  await page.goto('/2fa/setup');
  await page.waitForSelector('img[alt*="QR"]');

  // Read the encrypted secret stored by the auto-enroll mutation, decrypt it,
  // and generate a valid TOTP code from the same secret the server expects.
  const sec = await prisma.twoFactorSecret.findFirstOrThrow({
    where: { user: { email: 'admin2@e2e.test' } },
  });
  const rawSecret = decryptSecretFn(sec.secretCipher);

  await submitOtpAndWait(page, totpFor(rawSecret));

  await expect(page).toHaveURL(/\/2fa\/setup\/recovery-codes/);
  await page.locator('#recovery-confirm').check();
  await page.click('button:has-text("Continuer")');
  await expect(page).toHaveURL(/\/admin/);
});

test('Scénario 3: login complet avec 2FA TOTP', async ({ page }) => {
  const secret = generateTotpSecret();
  // Use GLOBAL_ADMIN role so the /admin page is accessible after 2FA verification
  // (AdminLayout redirects non-admin users to / before the URL assertion can pass).
  const u = await prisma.user.create({
    data: {
      email: 'user3@e2e.test',
      displayName: 'User TOTP',
      passwordHash: await hashPassword(PASSWORD),
      role: 'GLOBAL_ADMIN',
      twoFactorEnabled: true,
      emailVerifiedAt: new Date(),
    },
  });
  await prisma.twoFactorSecret.create({
    data: {
      userId: u.id,
      secretCipher: encryptSecret(secret),
      backupCodes: await hashBackupCodes(generateBackupCodes()),
      confirmedAt: new Date(),
    },
  });

  await submitLogin(page, 'user3@e2e.test', PASSWORD);
  await expect(page).toHaveURL(/\/login\/2fa$/);

  await submitOtpAndWait(page, totpFor(secret));

  // Both server-side (audit + session pending2fa=false) and client-side (URL = /admin)
  // are now asserted — gap #10 closed in hardening pass.
  const successAudit = await prisma.auditLog.findFirst({
    where: { action: 'auth.2fa.success', actorId: u.id },
  });
  expect(successAudit).not.toBeNull();
  const session = await prisma.session.findFirstOrThrow({
    where: { userId: u.id },
    orderBy: { lastActivityAt: 'desc' },
  });
  expect(session.pending2fa).toBe(false);
  await expect(page).toHaveURL(/\/admin/, { timeout: 10_000 });
});

test('Scénario 4: login + backup code consommé', async ({ page }) => {
  const codes = generateBackupCodes();
  // Use GLOBAL_ADMIN role so the /admin page is accessible after 2FA verification
  // (AdminLayout redirects non-admin users to / before the URL assertion can pass).
  const u = await prisma.user.create({
    data: {
      email: 'user4@e2e.test',
      displayName: 'User Backup',
      passwordHash: await hashPassword(PASSWORD),
      role: 'GLOBAL_ADMIN',
      twoFactorEnabled: true,
      emailVerifiedAt: new Date(),
    },
  });
  await prisma.twoFactorSecret.create({
    data: {
      userId: u.id,
      secretCipher: encryptSecret(generateTotpSecret()),
      backupCodes: await hashBackupCodes(codes),
      confirmedAt: new Date(),
    },
  });

  await submitLogin(page, 'user4@e2e.test', PASSWORD);
  await expect(page).toHaveURL(/\/login\/2fa$/);

  await page.click('a:has-text("Utiliser un code de récupération")');
  await expect(page).toHaveURL(/\/login\/2fa\/backup/);
  await page.fill('input[name="code"]', codes[0]!);
  const verifyBackupResponse = page.waitForResponse(
    (r) => r.url().includes('/api/trpc/auth.verifyBackupCode') && r.request().method() === 'POST',
    { timeout: 10_000 },
  );
  await page.click('button[type="submit"]');
  const response = await verifyBackupResponse;
  expect(response.status()).toBe(200);

  // Server-side proofs: backup_code_used audit + remaining hashes count.
  // URL assertion enabled — gap #10 closed.
  const usedAudit = await prisma.auditLog.findFirst({
    where: { action: 'auth.2fa.backup_code_used', actorId: u.id },
  });
  expect(usedAudit).not.toBeNull();
  const sec = await prisma.twoFactorSecret.findUniqueOrThrow({ where: { userId: u.id } });
  expect(sec.backupCodes).toHaveLength(7);
  await expect(page).toHaveURL(/\/admin/, { timeout: 10_000 });
});

test('Scénario 5: lockout après attempts répétés (rate-limit puis lockout)', async ({ page }) => {
  await prisma.user.create({
    data: {
      email: 'lockme@e2e.test',
      displayName: 'Lock Me',
      passwordHash: await hashPassword(PASSWORD),
      role: 'USER',
      emailVerifiedAt: new Date(),
    },
  });

  // loginLimiter = 5 points / 15 min ; 6e essai déclenche déjà le rate limit
  // avec audit auth.login.locked (reason=rate_limited). On en envoie 8 pour
  // garantir l'audit même si la première tentative échoue côté UI.
  // Important : il faut attendre la fin de chaque POST avant de re-naviguer,
  // sinon page.goto() suivant abort la requête et la DB n'est jamais mise à jour.
  await page.goto('/login');
  for (let i = 0; i < 8; i++) {
    await page.fill('input[name="email"]', 'lockme@e2e.test');
    await page.fill('input[name="password"]', `wrong-${i}`);
    const responsePromise = page.waitForResponse(
      (r) => r.url().includes('/api/auth/callback/credentials') && r.request().method() === 'POST',
      { timeout: 5000 },
    );
    await page.click('button[type="submit"]');
    await responsePromise;
    // Wait for the form to settle (pending state cleared) before next attempt.
    await expect(page.locator('button[type="submit"]')).toBeEnabled();
  }

  // Bonne password → toujours bloqué tant que rate-limit actif
  await page.fill('input[name="email"]', 'lockme@e2e.test');
  await page.fill('input[name="password"]', PASSWORD);
  const finalResponse = page.waitForResponse(
    (r) => r.url().includes('/api/auth/callback/credentials') && r.request().method() === 'POST',
    { timeout: 5000 },
  );
  await page.click('button[type="submit"]');
  await finalResponse;
  await expect(page.locator('button[type="submit"]')).toBeEnabled();
  await expect(page).toHaveURL(/\/login/);

  // Scope audit lookup to the test user's hashed email so a stale dev row
  // can't satisfy the assertion accidentally.
  const lockedTargetId = await hashTestEmail('lockme@e2e.test');
  const audit = await prisma.auditLog.findFirst({
    where: {
      action: 'auth.login.locked',
      targetType: 'EMAIL',
      targetId: lockedTargetId,
    },
  });
  expect(audit).not.toBeNull();
});
