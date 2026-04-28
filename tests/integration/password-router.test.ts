import { describe, it, expect, beforeEach } from 'vitest';
import { appRouter } from '@/server/trpc/routers/_app';
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
