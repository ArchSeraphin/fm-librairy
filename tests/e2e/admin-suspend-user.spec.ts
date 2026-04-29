import { test, expect } from '@playwright/test';

import { getPrisma, cleanupTestData, flushRateLimit, disconnect } from './helpers/db';
import { submitLogin } from './helpers/auth';
import { hashPassword } from '../../src/lib/password';

const PASSWORD = 'TestPass-123!';

const prisma = getPrisma();

test.beforeEach(async () => {
  await cleanupTestData();
  await flushRateLimit();
});

test.afterAll(async () => {
  await disconnect();
});

test('admin suspends a user — DB + UI badge reflect SUSPENDED', async ({ page }) => {
  // Admin: GLOBAL_ADMIN, fresh (createdAt < 7 days), no 2FA → not forced to /2fa/setup.
  await prisma.user.create({
    data: {
      email: 'admin-susp@e2e.test',
      displayName: 'Admin Suspend',
      passwordHash: await hashPassword(PASSWORD),
      role: 'GLOBAL_ADMIN',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });

  const target = await prisma.user.create({
    data: {
      email: 'target-susp@e2e.test',
      displayName: 'Target User',
      passwordHash: await hashPassword(PASSWORD),
      role: 'USER',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });

  await submitLogin(page, 'admin-susp@e2e.test', PASSWORD);
  await expect(page).toHaveURL(/\/admin/);

  // Navigate directly to the user detail page (UsersTable list is debounced and
  // search-driven; direct nav is faster and unambiguous).
  await page.goto(`/admin/users/${target.id}`);
  await expect(page.getByRole('heading', { name: 'Target User' })).toBeVisible();

  // Click the "Suspendre" CTA in the actions card.
  await page.getByRole('button', { name: 'Suspendre', exact: true }).click();

  // Fill the Motif field (min 3 chars) and confirm.
  await page.fill('#suspend-reason', 'Test suspend reason');

  const suspendResponse = page.waitForResponse(
    (r) => r.url().includes('/api/trpc/admin.users.suspend') && r.request().method() === 'POST',
    { timeout: 10_000 },
  );
  await page.getByRole('button', { name: 'Confirmer', exact: true }).click();
  const response = await suspendResponse;
  expect(response.status()).toBe(200);

  // UI: SUSPENDED badge visible (the StatusBadge component renders the localized
  // label "Suspendu" once router.refresh() lands).
  await expect(page.getByText('Suspendu', { exact: true }).first()).toBeVisible({
    timeout: 10_000,
  });

  // DB: row reflects SUSPENDED.
  const fresh = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
  expect(fresh.status).toBe('SUSPENDED');

  // Audit row was written by the suspend mutation.
  const audit = await prisma.auditLog.findFirst({
    where: { action: 'admin.user.suspended', targetType: 'USER', targetId: target.id },
  });
  expect(audit).not.toBeNull();
});
