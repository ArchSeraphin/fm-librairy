import { test, expect, type Page } from '@playwright/test';

import { getPrisma, cleanupTestData, cleanupE2ELibrary, flushRateLimit, disconnect } from './helpers/db';
import { clearMailpit, extractFirstUrl, getAppUrl, getMessageBody, waitForEmail } from './helpers/mailpit';
import { submitOtpAndWait } from './helpers/2fa';
import { totpFor } from './helpers/totp';
import { hashPassword } from '../../src/lib/password';
import { encryptSecret } from '../../src/lib/crypto';
import { generateTotpSecret, generateBackupCodes, hashBackupCodes } from '../../src/lib/totp';

const PASSWORD = 'TestPass-123!';

const prisma = getPrisma();

// E2E-scoped library slug + name so we can cleanup deterministically without
// risk of nuking dev libraries the developer might have seeded manually.
// If another library-using spec is added later, namespace this slug.
const LIB_SLUG = 'e2e-test-library';

test.beforeEach(async () => {
  await cleanupTestData();
  await cleanupE2ELibrary(LIB_SLUG);
  await flushRateLimit();
  await clearMailpit();
});

test.afterAll(async () => {
  await cleanupE2ELibrary(LIB_SLUG);
  await disconnect();
});

async function submitLogin(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => url.pathname !== '/login', { timeout: 15_000 });
}

test('Invitation flow — existing user joins library via emailed link', async ({ page }) => {
  // Library
  const lib = await prisma.library.create({
    data: { name: 'Bibliothèque E2E', slug: LIB_SLUG },
  });

  // Admin avec 2FA confirmé
  const secret = generateTotpSecret();
  const admin = await prisma.user.create({
    data: {
      email: 'admin-join@e2e.test',
      displayName: 'Admin Join',
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

  // User existant (no 2FA)
  const existing = await prisma.user.create({
    data: {
      email: 'existing@e2e.test',
      displayName: 'Existing User',
      passwordHash: await hashPassword(PASSWORD),
      role: 'USER',
      emailVerifiedAt: new Date(),
    },
  });

  // Login admin
  await submitLogin(page, 'admin-join@e2e.test', PASSWORD);
  await expect(page).toHaveURL(/\/login\/2fa$/);
  await submitOtpAndWait(page, totpFor(secret));
  await expect(page).toHaveURL(/\/admin/, { timeout: 10_000 });

  // Invite existing user dans la bibliothèque
  await page.goto('/admin/users/invite');
  await page.fill('input[name="email"]', 'existing@e2e.test');
  await page.selectOption('select[name="libraryId"]', lib.id);
  const inviteResponse = page.waitForResponse(
    (r) => r.url().includes('/api/trpc/invitation.create') && r.request().method() === 'POST',
    { timeout: 10_000 },
  );
  await page.click('button[type="submit"]');
  await inviteResponse;
  await expect(page.getByText(/Invitation envoyée/i)).toBeVisible({ timeout: 5_000 });

  // Mailpit — subject FR mode "join" (`X vous invite à rejoindre <libname>`)
  const msg = await waitForEmail('existing@e2e.test', (m) =>
    m.Subject.includes('invite') && m.Subject.includes(lib.name),
  );
  const body = await getMessageBody(msg.ID);
  const link = extractFirstUrl(body.HTML || body.Text, `${getAppUrl()}/invitations/`);

  // Switch to existing user identity
  await page.context().clearCookies();
  await submitLogin(page, 'existing@e2e.test', PASSWORD);
  // USER role lands on `/` (admin layout would redirect non-admins).
  await expect(page).toHaveURL(/^\/(\?.*)?$/, { timeout: 10_000 });

  // Open invitation link → JoinForm CTA
  await page.goto(link);
  const joinBtn = page.getByRole('button', { name: /Rejoindre la bibliothèque/i });
  await expect(joinBtn).toBeVisible({ timeout: 5_000 });

  await Promise.all([
    page.waitForURL(/\/$/, { timeout: 15_000 }),
    joinBtn.click(),
  ]);

  // Membership créée
  const membership = await prisma.libraryMember.findUnique({
    where: { userId_libraryId: { userId: existing.id, libraryId: lib.id } },
  });
  expect(membership).not.toBeNull();
});
