import { test, expect } from '@playwright/test';

import { getPrisma, cleanupTestData, flushRateLimit, disconnect } from './helpers/db';
import { submitLogin } from './helpers/auth';
import { hashPassword } from '../../src/lib/password';

const PASSWORD = 'TestPass-123!';
const HASH_64 = 'a'.repeat(64);

const prisma = getPrisma();

test.beforeEach(async () => {
  await cleanupTestData();
  await flushRateLimit();
});

test.afterAll(async () => {
  await disconnect();
});

test('user revokes a phantom "other device" session row from /account/security', async ({
  page,
}) => {
  const user = await prisma.user.create({
    data: {
      email: 'revoke@e2e.test',
      displayName: 'Revoke Other',
      passwordHash: await hashPassword(PASSWORD),
      role: 'USER',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });

  await submitLogin(page, 'revoke@e2e.test', PASSWORD);

  // Trigger session-row creation for this browser context.
  await page.goto('/account');
  await expect(page).toHaveURL(/\/account/);

  // Pre-seed a phantom "other device" session row so the SessionsCard renders
  // a row with the "Révoquer" button. Two browser contexts logged in as the
  // same user share a single DB row in this codebase, so we can't create a
  // genuine second session via login — pre-seeding is the closest proxy.
  //
  // CRITICAL: lastActivityAt is older than the browser's own session so the
  // bridge keeps returning the browser session as ctx.session, not the phantom.
  // Otherwise the SessionsCard would tag the phantom as "Cette session" and
  // hide the Révoquer button on it.
  const phantom = await prisma.session.create({
    data: {
      sessionToken: 'phantom-other-device',
      userId: user.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      lastActivityAt: new Date(Date.now() - 60 * 60 * 1000),
      ipHash: HASH_64,
      userAgentHash: HASH_64,
      userAgentLabel: 'Phantom Device',
    },
  });

  expect(await prisma.session.count({ where: { userId: user.id } })).toBe(2);

  await page.goto('/account/security');
  // Wait for the SessionsCard to load — the current-session badge proves the
  // listSessions tRPC query has resolved.
  await expect(page.getByText('Cette session', { exact: true })).toBeVisible({ timeout: 10_000 });
  // The "Phantom Device" label should be visible for the seeded row.
  await expect(page.getByText('Phantom Device', { exact: true })).toBeVisible();

  // Click the only "Révoquer" button on the page (the current session row uses
  // a "Cette session" badge instead — no Révoquer affordance).
  const revokeButton = page.getByRole('button', { name: 'Révoquer', exact: true }).first();
  await expect(revokeButton).toBeVisible();

  const revokeResponse = page.waitForResponse(
    (r) =>
      r.url().includes('/api/trpc/account.security.revokeSession') &&
      r.request().method() === 'POST',
    { timeout: 10_000 },
  );
  await revokeButton.click();
  const revoked = await revokeResponse;
  expect(revoked.status()).toBe(200);

  // DB-level proof: the phantom row is gone, the current row survives.
  const after = await prisma.session.findMany({
    where: { userId: user.id },
    select: { id: true },
  });
  expect(after).toHaveLength(1);
  expect(after[0]?.id).not.toBe(phantom.id);

  // Audit row: revokeSession writes auth.session.revoked_self with target=SESSION.
  const audit = await prisma.auditLog.findFirst({
    where: {
      action: 'auth.session.revoked_self',
      actorId: user.id,
      targetType: 'SESSION',
      targetId: phantom.id,
    },
  });
  expect(audit).not.toBeNull();

  // UI: after the mutation, the "Phantom Device" row is no longer rendered.
  await expect(page.getByText('Phantom Device', { exact: true })).toHaveCount(0, {
    timeout: 5_000,
  });
});
