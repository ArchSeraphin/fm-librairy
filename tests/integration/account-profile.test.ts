import { beforeEach, describe, expect, it } from 'vitest';
import { appRouter } from '@/server/trpc/routers/_app';
import { getTestPrisma, truncateAll } from './setup/prisma';

const prisma = getTestPrisma();
const HASH_64 = 'a'.repeat(64);

async function makeUserCtx() {
  const user = await prisma.user.create({
    data: { email: 'me@e2e.test', passwordHash: 'x', displayName: 'Me', locale: 'fr' },
  });
  const session = await prisma.session.create({
    data: {
      sessionToken: 's',
      userId: user.id,
      expiresAt: new Date(Date.now() + 60_000),
      ipHash: HASH_64,
      userAgentHash: HASH_64,
    },
  });
  return { session, user, ip: '203.0.113.1' };
}

describe('account.profile', () => {
  beforeEach(truncateAll);

  it('get: returns own profile', async () => {
    const ctx = await makeUserCtx();
    const result = await appRouter.createCaller(ctx).account.profile.get();
    expect(result.email).toBe('me@e2e.test');
    expect(result.displayName).toBe('Me');
  });

  it('update: changes displayName + locale, writes audit', async () => {
    const ctx = await makeUserCtx();
    await appRouter.createCaller(ctx).account.profile.update({
      displayName: 'New Name',
      locale: 'en',
    });
    const fresh = await prisma.user.findUnique({ where: { id: ctx.user.id } });
    expect(fresh?.displayName).toBe('New Name');
    expect(fresh?.locale).toBe('en');
    expect(await prisma.auditLog.count({ where: { action: 'account.profile.updated' } })).toBe(1);
  });
});
