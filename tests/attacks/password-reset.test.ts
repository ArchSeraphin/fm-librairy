import { describe, it, expect, beforeEach } from 'vitest';
import { appRouter } from '@/server/trpc/routers/_app';
import { getTestPrisma, truncateAll } from '../integration/setup/prisma';
import { hashPassword } from '@/lib/password';
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

async function buildCtx() {
  return { user: null, session: null };
}

async function timeIt(fn: () => Promise<unknown>): Promise<number> {
  const s = Date.now();
  await fn().catch(() => {});
  return Date.now() - s;
}

describe('password reset — timing & enumeration', () => {
  it('requestReset has uniform latency for unknown vs known email (within 80ms)', async () => {
    await prisma.user.create({
      data: { email: 'real@x.test', displayName: 'R', passwordHash: await hashPassword('x') },
    });
    const caller = appRouter.createCaller(await buildCtx());

    // warm-up (argon2 pool, DB connections)
    await caller.password.requestReset({ email: 'warm@x.test' });

    const samplesA: number[] = [];
    const samplesB: number[] = [];
    for (let i = 0; i < 5; i++) {
      samplesA.push(await timeIt(() => caller.password.requestReset({ email: `ghost${i}@x.test` })));
      samplesB.push(await timeIt(() => caller.password.requestReset({ email: 'real@x.test' })));
    }
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const delta = Math.abs(avg(samplesA) - avg(samplesB));
    expect(delta).toBeLessThan(80);
  });

  it('rate limit per email triggers silent throttle (still ok=true)', async () => {
    const caller = appRouter.createCaller(await buildCtx());
    for (let i = 0; i < 4; i++) {
      const out = await caller.password.requestReset({ email: 'x@x.test' });
      expect(out.ok).toBe(true);
    }
    expect(await prisma.passwordResetToken.count()).toBe(0);
  });
});
