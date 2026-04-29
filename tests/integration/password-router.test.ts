import { describe, it, expect, beforeEach, vi } from 'vitest';

// Hoisted mock: prevents next-auth / next/server from being resolved when
// createContext is imported. All existing tests use buildCtx (bypasses
// session-bridge entirely); only the e2e test below calls createContext,
// and it models an unauthenticated request where null is the correct return.
vi.mock('@/server/auth/session-bridge', () => ({
  getCurrentSessionAndUser: vi.fn().mockResolvedValue(null),
}));

import { appRouter } from '@/server/trpc/routers/_app';
import { createContext } from '@/server/trpc/context';
import { getTestPrisma, truncateAll } from './setup/prisma';
import { hashPassword } from '@/lib/password';
import { hashIp } from '@/lib/crypto';
import { getRedis } from '@/lib/redis';

const prisma = getTestPrisma();

beforeEach(async () => {
  await truncateAll();
  const r = getRedis();
  for (const prefix of ['rl:reset', 'rl:reset_ip']) {
    const keys = await r.keys(`${prefix}:*`);
    if (keys.length) await r.del(...keys);
  }
});

async function buildCtx(opts: { user?: any; session?: any; ip?: string } = {}) {
  return { user: opts.user ?? null, session: opts.session ?? null, ip: opts.ip ?? '0.0.0.0' };
}

describe('password router', () => {
  it('requestReset returns ok=true for unknown email (no leak)', async () => {
    const caller = appRouter.createCaller(await buildCtx());
    const out = await caller.password.requestReset({ email: 'ghost@x.test' });
    expect(out.ok).toBe(true);
  });

  it('requestReset enqueues email for existing user', async () => {
    await prisma.user.create({
      data: { email: 'a@x.test', displayName: 'A', passwordHash: await hashPassword('x') },
    });
    const caller = appRouter.createCaller(await buildCtx());
    await caller.password.requestReset({ email: 'a@x.test' });
    const tokens = await prisma.passwordResetToken.findMany();
    expect(tokens).toHaveLength(1);
  });

  it('records audit with caller IP from x-forwarded-for', async () => {
    const user = await prisma.user.create({
      data: {
        email: 'ip-audit@e2e.test',
        passwordHash: await hashPassword('OldPassword123!'),
        displayName: 'Audit',
      },
    });
    const caller = appRouter.createCaller(await buildCtx({ ip: '203.0.113.99' }));
    await caller.password.requestReset({ email: user.email });
    const log = await prisma.auditLog.findFirst({
      where: { action: 'auth.password.reset_requested' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log?.ipHash).toBe(hashIp('203.0.113.99'));
  });

  it('end-to-end: x-forwarded-for header flows through createContext to audit ipHash', async () => {
    // createContext is called with real Headers; the session bridge is already
    // mocked at file scope (returning null = unauthenticated), so no Next.js
    // request scope is needed. This test proves the full chain:
    //   headers → createContext → extractIpFromHeaders → ctx.ip → recordAudit → ipHash
    const user = await prisma.user.create({
      data: {
        email: 'ip-e2e@e2e.test',
        passwordHash: await hashPassword('OldPassword123!'),
        displayName: 'E2E IP',
      },
    });

    const headers = new Headers({ 'x-forwarded-for': '198.51.100.77' });
    const ctx = await createContext({ headers });

    // Sanity: extractIpFromHeaders parsed the header correctly
    expect(ctx.ip).toBe('198.51.100.77');

    const caller = appRouter.createCaller(ctx);
    await caller.password.requestReset({ email: user.email });

    const log = await prisma.auditLog.findFirst({
      where: { action: 'auth.password.reset_requested' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log?.ipHash).toBe(hashIp('198.51.100.77'));
  });

  it('consumeReset rejects bad token with INVALID_TOKEN', async () => {
    const u = await prisma.user.create({
      data: { email: 'a@x.test', displayName: 'A', passwordHash: await hashPassword('old') },
    });
    await prisma.session.create({
      data: {
        userId: u.id,
        sessionToken: 'tok',
        expiresAt: new Date(Date.now() + 3600_000),
        pending2fa: false,
        lastActivityAt: new Date(),
        ipHash: 'x'.repeat(64),
        userAgentHash: 'x'.repeat(64),
      },
    });
    const caller = appRouter.createCaller(await buildCtx());
    await caller.password.requestReset({ email: 'a@x.test' });
    const tokRow = await prisma.passwordResetToken.findFirst({ where: { userId: u.id } });
    expect(tokRow).toBeTruthy();
    await expect(
      caller.password.consumeReset({ rawToken: 'bad'.repeat(10), newPassword: 'NewPass1234!' }),
    ).rejects.toThrow(/INVALID_TOKEN/);
  });
});
