import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TRPCError } from '@trpc/server';
import { appRouter } from '@/server/trpc/routers/_app';
import { hashPassword } from '@/lib/password';
import { getTestPrisma, truncateAll } from './setup/prisma';

const mocks = vi.hoisted(() => ({
  enqueuePasswordResetConfirmation: vi.fn().mockResolvedValue(undefined),
  enqueueMail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/mail-queue', () => ({
  enqueuePasswordResetConfirmation: mocks.enqueuePasswordResetConfirmation,
  enqueueMail: mocks.enqueueMail,
}));

const prisma = getTestPrisma();
const HASH_64 = 'a'.repeat(64);

async function makeUserCtx(password = 'CurrentPass123!') {
  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      email: 'me@e2e.test',
      passwordHash,
      displayName: 'Me',
      locale: 'fr',
    },
  });
  const session = await prisma.session.create({
    data: {
      sessionToken: 'current-session-token',
      userId: user.id,
      expiresAt: new Date(Date.now() + 60_000),
      ipHash: HASH_64,
      userAgentHash: HASH_64,
    },
  });
  return { session, user, ip: '203.0.113.1' };
}

describe('account.security.changePassword', () => {
  beforeEach(async () => {
    await truncateAll();
    mocks.enqueuePasswordResetConfirmation.mockClear();
    mocks.enqueueMail.mockClear();
  });

  it('rejects with UNAUTHORIZED when current password wrong', async () => {
    const ctx = await makeUserCtx();
    await expect(
      appRouter.createCaller(ctx).account.security.changePassword({
        currentPassword: 'WrongPass123!',
        newPassword: 'BrandNewPass123!',
        confirmPassword: 'BrandNewPass123!',
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' } satisfies Partial<TRPCError>);
    const audits = await prisma.auditLog.count({
      where: { action: 'auth.password.changed_self' },
    });
    expect(audits).toBe(0);
  });

  it('rejects with BAD_REQUEST when new === current', async () => {
    const ctx = await makeUserCtx();
    await expect(
      appRouter.createCaller(ctx).account.security.changePassword({
        currentPassword: 'CurrentPass123!',
        newPassword: 'CurrentPass123!',
        confirmPassword: 'CurrentPass123!',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' } satisfies Partial<TRPCError>);
  });

  it('rejects with BAD_REQUEST when confirm mismatch', async () => {
    const ctx = await makeUserCtx();
    await expect(
      appRouter.createCaller(ctx).account.security.changePassword({
        currentPassword: 'CurrentPass123!',
        newPassword: 'BrandNewPass123!',
        confirmPassword: 'OtherNewPass123!',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' } satisfies Partial<TRPCError>);
  });

  it('on success: kills other sessions, writes audit, enqueues confirmation', async () => {
    const ctx = await makeUserCtx();
    // create 2 other sessions on same user
    await prisma.session.create({
      data: {
        sessionToken: 'other-1',
        userId: ctx.user.id,
        expiresAt: new Date(Date.now() + 60_000),
        ipHash: HASH_64,
        userAgentHash: HASH_64,
      },
    });
    await prisma.session.create({
      data: {
        sessionToken: 'other-2',
        userId: ctx.user.id,
        expiresAt: new Date(Date.now() + 60_000),
        ipHash: HASH_64,
        userAgentHash: HASH_64,
      },
    });

    await appRouter.createCaller(ctx).account.security.changePassword({
      currentPassword: 'CurrentPass123!',
      newPassword: 'BrandNewPass123!',
      confirmPassword: 'BrandNewPass123!',
    });

    const remaining = await prisma.session.findMany({ where: { userId: ctx.user.id } });
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(ctx.session.id);

    const audits = await prisma.auditLog.findMany({
      where: { action: 'auth.password.changed_self', actorId: ctx.user.id },
    });
    expect(audits).toHaveLength(1);

    expect(mocks.enqueuePasswordResetConfirmation).toHaveBeenCalledTimes(1);
    expect(mocks.enqueuePasswordResetConfirmation).toHaveBeenCalledWith({
      userId: ctx.user.id,
      triggerSource: 'self_change',
    });
  });
});
