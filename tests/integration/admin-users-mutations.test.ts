import { beforeEach, describe, expect, it } from 'vitest';
import { appRouter } from '@/server/trpc/routers/_app';
import { encryptSecret } from '@/lib/crypto';
import { getTestPrisma, truncateAll } from './setup/prisma';

const prisma = getTestPrisma();
const HASH_64 = 'a'.repeat(64);

async function makeAdminCtx() {
  const user = await prisma.user.create({
    data: {
      email: 'admin@e2e.test',
      passwordHash: 'x',
      displayName: 'Admin',
      role: 'GLOBAL_ADMIN',
      twoFactorEnabled: true,
    },
  });
  const session = await prisma.session.create({
    data: {
      sessionToken: 'a-s',
      userId: user.id,
      expiresAt: new Date(Date.now() + 60_000),
      ipHash: HASH_64,
      userAgentHash: HASH_64,
    },
  });
  return { session, user, ip: '203.0.113.1' };
}

describe('admin.users — mutations', () => {
  beforeEach(truncateAll);

  it('suspend: suspends user + revokes their sessions + writes audit', async () => {
    const ctx = await makeAdminCtx();
    const target = await prisma.user.create({
      data: { email: 't@e2e.test', passwordHash: 'x', displayName: 'T' },
    });
    await prisma.session.create({
      data: {
        sessionToken: 't-s',
        userId: target.id,
        expiresAt: new Date(Date.now() + 60_000),
        ipHash: HASH_64,
        userAgentHash: HASH_64,
      },
    });
    await appRouter.createCaller(ctx).admin.users.suspend({ id: target.id, reason: 'spam' });
    expect((await prisma.user.findUnique({ where: { id: target.id } }))?.status).toBe('SUSPENDED');
    expect(await prisma.session.count({ where: { userId: target.id } })).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { action: 'admin.user.suspended', targetId: target.id },
      }),
    ).toBe(1);
  });

  it('suspend: refuses self', async () => {
    const ctx = await makeAdminCtx();
    await expect(
      appRouter.createCaller(ctx).admin.users.suspend({ id: ctx.user.id, reason: 'oops' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('suspend: refuses last GLOBAL_ADMIN', async () => {
    const ctx = await makeAdminCtx();
    const other = await prisma.user.create({
      data: { email: 'sus@e2e.test', passwordHash: 'x', displayName: 'S' },
    });
    await prisma.user.update({ where: { id: ctx.user.id }, data: { role: 'USER' } });
    await prisma.user.update({ where: { id: other.id }, data: { role: 'GLOBAL_ADMIN' } });
    await prisma.user.update({ where: { id: ctx.user.id }, data: { role: 'GLOBAL_ADMIN' } });
    await appRouter.createCaller(ctx).admin.users.suspend({ id: other.id, reason: 'test' });
  });

  it('reactivate: idempotent', async () => {
    const ctx = await makeAdminCtx();
    const target = await prisma.user.create({
      data: { email: 't@e2e.test', passwordHash: 'x', displayName: 'T', status: 'SUSPENDED' },
    });
    const caller = appRouter.createCaller(ctx);
    await caller.admin.users.reactivate({ id: target.id });
    await caller.admin.users.reactivate({ id: target.id });
    expect((await prisma.user.findUnique({ where: { id: target.id } }))?.status).toBe('ACTIVE');
  });

  it('delete: requires confirmEmail to match', async () => {
    const ctx = await makeAdminCtx();
    const target = await prisma.user.create({
      data: { email: 't@e2e.test', passwordHash: 'x', displayName: 'T' },
    });
    await expect(
      appRouter
        .createCaller(ctx)
        .admin.users.delete({ id: target.id, confirmEmail: 'wrong@e2e.test' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await appRouter
      .createCaller(ctx)
      .admin.users.delete({ id: target.id, confirmEmail: 't@e2e.test' });
    expect(await prisma.user.findUnique({ where: { id: target.id } })).toBeNull();
  });

  it('changeRole: refuses self', async () => {
    const ctx = await makeAdminCtx();
    await expect(
      appRouter.createCaller(ctx).admin.users.changeRole({ id: ctx.user.id, newRole: 'USER' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('resetTwoFactor: clears 2FA + kills sessions, refuses GLOBAL_ADMIN target', async () => {
    const ctx = await makeAdminCtx();
    const target = await prisma.user.create({
      data: {
        email: 't@e2e.test',
        passwordHash: 'x',
        displayName: 'T',
        twoFactorEnabled: true,
      },
    });
    await prisma.twoFactorSecret.create({
      data: {
        userId: target.id,
        secretCipher: encryptSecret('JBSWY3DPEHPK3PXP'),
        confirmedAt: new Date(),
        backupCodes: [],
      },
    });
    await prisma.session.create({
      data: {
        sessionToken: 't-s',
        userId: target.id,
        expiresAt: new Date(Date.now() + 60_000),
        ipHash: HASH_64,
        userAgentHash: HASH_64,
      },
    });
    await appRouter
      .createCaller(ctx)
      .admin.users.resetTwoFactor({ id: target.id, reason: 'lost device' });
    expect((await prisma.user.findUnique({ where: { id: target.id } }))?.twoFactorEnabled).toBe(
      false,
    );
    expect(await prisma.twoFactorSecret.findUnique({ where: { userId: target.id } })).toBeNull();
    expect(await prisma.session.count({ where: { userId: target.id } })).toBe(0);

    const adminTarget = await prisma.user.create({
      data: {
        email: 'a2@e2e.test',
        passwordHash: 'x',
        displayName: 'A2',
        role: 'GLOBAL_ADMIN',
        twoFactorEnabled: true,
      },
    });
    await expect(
      appRouter.createCaller(ctx).admin.users.resetTwoFactor({ id: adminTarget.id, reason: 'no' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
