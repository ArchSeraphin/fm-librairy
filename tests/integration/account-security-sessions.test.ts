import { beforeEach, describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import { appRouter } from '@/server/trpc/routers/_app';
import { getTestPrisma, truncateAll } from './setup/prisma';

const prisma = getTestPrisma();
const HASH_64 = 'a'.repeat(64);

async function makeUserCtx() {
  const user = await prisma.user.create({
    data: {
      email: 'me@e2e.test',
      passwordHash: 'x',
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
      userAgentLabel: 'Chrome on macOS',
    },
  });
  return { session, user, ip: '203.0.113.1' };
}

describe('account.security sessions', () => {
  beforeEach(truncateAll);

  it('listSessions returns sessions with isCurrent flag', async () => {
    const ctx = await makeUserCtx();
    await prisma.session.create({
      data: {
        sessionToken: 'other-1',
        userId: ctx.user.id,
        expiresAt: new Date(Date.now() + 60_000),
        ipHash: HASH_64,
        userAgentHash: HASH_64,
        userAgentLabel: 'Firefox on Linux',
      },
    });

    const result = await appRouter.createCaller(ctx).account.security.listSessions();
    expect(result.items).toHaveLength(2);
    const current = result.items.find((s) => s.id === ctx.session.id);
    const other = result.items.find((s) => s.id !== ctx.session.id);
    expect(current?.isCurrent).toBe(true);
    expect(current?.userAgentLabel).toBe('Chrome on macOS');
    expect(other?.isCurrent).toBe(false);
    expect(other?.userAgentLabel).toBe('Firefox on Linux');
  });

  it('revokeSession refuses current with BAD_REQUEST', async () => {
    const ctx = await makeUserCtx();
    await expect(
      appRouter.createCaller(ctx).account.security.revokeSession({ sessionId: ctx.session.id }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' } satisfies Partial<TRPCError>);
  });

  it('revokeSession returns NOT_FOUND on cross-user session (anti-IDOR)', async () => {
    const ctx = await makeUserCtx();
    const otherUser = await prisma.user.create({
      data: {
        email: 'other@e2e.test',
        passwordHash: 'x',
        displayName: 'Other',
        locale: 'fr',
      },
    });
    const otherSession = await prisma.session.create({
      data: {
        sessionToken: 'foreign-session',
        userId: otherUser.id,
        expiresAt: new Date(Date.now() + 60_000),
        ipHash: HASH_64,
        userAgentHash: HASH_64,
      },
    });
    await expect(
      appRouter.createCaller(ctx).account.security.revokeSession({ sessionId: otherSession.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' } satisfies Partial<TRPCError>);
  });

  it('revokeAllOtherSessions deletes others and preserves current', async () => {
    const ctx = await makeUserCtx();
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

    const result = await appRouter.createCaller(ctx).account.security.revokeAllOtherSessions();
    expect(result.revokedCount).toBe(2);

    const remaining = await prisma.session.findMany({ where: { userId: ctx.user.id } });
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(ctx.session.id);
  });
});
