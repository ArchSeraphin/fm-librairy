import { describe, it, expect, beforeEach } from 'vitest';
import {
  assertIsGlobalAdmin,
  assertGlobalAdmin2faTimerOk,
  PermissionError,
} from '@/lib/permissions';
import { getTestPrisma, truncateAll } from './setup/prisma';
import { hashPassword } from '@/lib/password';

const prisma = getTestPrisma();

async function makeUser(
  opts: Partial<{ role: 'GLOBAL_ADMIN' | 'USER'; twoFactorEnabled: boolean; createdAt: Date }>,
) {
  return prisma.user.create({
    data: {
      email: `u-${Date.now()}-${Math.random()}@x.test`,
      displayName: 'X',
      passwordHash: await hashPassword('x'),
      role: opts.role ?? 'USER',
      twoFactorEnabled: opts.twoFactorEnabled ?? false,
      createdAt: opts.createdAt ?? new Date(),
    },
  });
}

beforeEach(async () => {
  await truncateAll();
});

describe('assertIsGlobalAdmin', () => {
  it('passe pour un GLOBAL_ADMIN', async () => {
    const u = await makeUser({ role: 'GLOBAL_ADMIN' });
    expect(() => assertIsGlobalAdmin(u)).not.toThrow();
  });

  it('jette PermissionError + log audit pour un USER', async () => {
    const u = await makeUser({ role: 'USER' });
    expect(() => assertIsGlobalAdmin(u)).toThrow(PermissionError);
    // Small delay to allow fire-and-forget recordAudit to complete
    await new Promise((resolve) => setTimeout(resolve, 50));
    const audit = await prisma.auditLog.findFirst({ where: { action: 'permission.denied' } });
    expect(audit).not.toBeNull();
    expect(audit?.actorId).toBe(u.id);
  });
});

describe('assertGlobalAdmin2faTimerOk', () => {
  it('passe si twoFactorEnabled', async () => {
    const u = await makeUser({ role: 'GLOBAL_ADMIN', twoFactorEnabled: true });
    await expect(assertGlobalAdmin2faTimerOk(u)).resolves.toBeUndefined();
  });

  it('passe si !twoFactorEnabled mais < 7j', async () => {
    const u = await makeUser({ role: 'GLOBAL_ADMIN', twoFactorEnabled: false });
    await expect(assertGlobalAdmin2faTimerOk(u)).resolves.toBeUndefined();
  });

  it('jette si !twoFactorEnabled et > 7j', async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 3600 * 1000);
    const u = await makeUser({
      role: 'GLOBAL_ADMIN',
      twoFactorEnabled: false,
      createdAt: eightDaysAgo,
    });
    await expect(assertGlobalAdmin2faTimerOk(u)).rejects.toThrow(PermissionError);
  });
});
