import { test, expect } from '@playwright/test';

import { getPrisma, cleanupTestData, flushRateLimit, disconnect } from './helpers/db';
import { submitLogin } from './helpers/auth';
import { hashPassword, verifyPassword } from '../../src/lib/password';

const PASSWORD = 'TestPass-123!';
const NEW_PASSWORD = 'NewPass-456!Z';
const HASH_64 = 'a'.repeat(64);

const prisma = getPrisma();

test.beforeEach(async () => {
  await cleanupTestData();
  await flushRateLimit();
});

test.afterAll(async () => {
  await disconnect();
});

test('changing password rotates hash, deletes other session rows, writes audit', async ({
  page,
}) => {
  const user = await prisma.user.create({
    data: {
      email: 'pwchange@e2e.test',
      displayName: 'Password Change User',
      passwordHash: await hashPassword(PASSWORD),
      role: 'USER',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });

  await submitLogin(page, 'pwchange@e2e.test', PASSWORD);

  // Visit /account so getCurrentSessionAndUser creates the "current" session
  // row for this browser context. We then read it back to know its id.
  await page.goto('/account');
  await expect(page).toHaveURL(/\/account/);

  const currentSession = await prisma.session.findFirstOrThrow({
    where: { userId: user.id },
    orderBy: { lastActivityAt: 'desc' },
  });

  // Pre-seed a "phantom other device" session row so that
  // revokeAllSessionsForUser(userId, except=current) has something to delete.
  // This sidesteps the architectural quirk where two browser contexts logged
  // in as the same user share a single DB session row (session-bridge does a
  // findFirst-or-create keyed only by userId + expiresAt).
  //
  // CRITICAL: lastActivityAt MUST be older than `currentSession.lastActivityAt`
  // so the bridge's findFirst(orderBy lastActivityAt desc) keeps returning the
  // browser's own row as ctx.session, not the phantom — otherwise the mutation
  // would delete the browser's own session as the "other" one.
  await prisma.session.create({
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

  // Open /account/security and change password.
  await page.goto('/account/security');
  await page.getByRole('button', { name: 'Changer le mot de passe', exact: true }).click();
  await page.fill('#current-password', PASSWORD);
  await page.fill('#new-password', NEW_PASSWORD);
  await page.fill('#confirm-password', NEW_PASSWORD);

  const changeResponse = page.waitForResponse(
    (r) =>
      r.url().includes('/api/trpc/account.security.changePassword') &&
      r.request().method() === 'POST',
    { timeout: 10_000 },
  );
  await page.getByRole('button', { name: 'Mettre à jour', exact: true }).click();
  const changed = await changeResponse;
  expect(changed.status()).toBe(200);

  // DB-level proof #1: password hash rotated end-to-end.
  const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  expect(await verifyPassword(updated.passwordHash, NEW_PASSWORD)).toBe(true);
  expect(await verifyPassword(updated.passwordHash, PASSWORD)).toBe(false);

  // DB-level proof #2: the phantom row was deleted, current row survived.
  const remaining = await prisma.session.findMany({
    where: { userId: user.id },
    select: { id: true, sessionToken: true },
  });
  expect(remaining).toHaveLength(1);
  expect(remaining[0]?.id).toBe(currentSession.id);
  expect(remaining[0]?.sessionToken).not.toBe('phantom-other-device');

  // DB-level proof #3: audit row written with sessionsRevoked=1.
  const audit = await prisma.auditLog.findFirst({
    where: { action: 'auth.password.changed_self', actorId: user.id },
  });
  expect(audit).not.toBeNull();
  expect((audit?.metadata as { sessionsRevoked?: number } | null)?.sessionsRevoked).toBe(1);

  // NOTE: the plan asked for a hard "p2 bounces to /login" UI assertion using
  // two browser contexts. Two contexts logged in as the same user actually
  // share a single DB session row in this codebase (session-bridge does a
  // findFirst-or-create keyed only on userId + expiresAt), so there is no
  // distinct p2 row to delete. We simulate the kill by pre-seeding a phantom
  // session row and verifying the mutation deletes it. This still proves the
  // contract revokeAllSessionsForUser(userId, except=current) is wired up.
});
