import { describe, it, expect, beforeEach } from 'vitest';
import { createSessionAdapter } from '@/server/auth/adapter';
import { getTestPrisma, truncateAll } from './setup/prisma';
import { hashPassword } from '@/lib/password';

const prisma = getTestPrisma();
const adapter = createSessionAdapter(prisma);

async function mkUser(twoFactorEnabled = false) {
  return prisma.user.create({
    data: {
      email: `u-${Date.now()}-${Math.random()}@x.test`,
      displayName: 'X',
      passwordHash: await hashPassword('x'),
      twoFactorEnabled,
    },
  });
}

beforeEach(async () => {
  await truncateAll();
});

describe('createSession', () => {
  it('crée une session pending2fa=true si user a 2FA', async () => {
    const u = await mkUser(true);
    const s = await adapter.createSession({
      userId: u.id,
      ipHash: 'iphash',
      userAgentHash: 'uahash',
    });
    expect(s.pending2fa).toBe(true);
    expect(s.sessionToken).toMatch(/^[A-Za-z0-9_-]{43,}$/);
  });

  it('crée une session pending2fa=false si user sans 2FA', async () => {
    const u = await mkUser(false);
    const s = await adapter.createSession({ userId: u.id, ipHash: 'i', userAgentHash: 'u' });
    expect(s.pending2fa).toBe(false);
  });

  it('génère 1000 tokens uniques', async () => {
    const u = await mkUser();
    const tokens = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const s = await adapter.createSession({ userId: u.id, ipHash: 'i', userAgentHash: 'u' });
      tokens.add(s.sessionToken);
    }
    expect(tokens.size).toBe(1000);
  });
});

describe('getSession', () => {
  it('renvoie la session valide', async () => {
    const u = await mkUser();
    const s = await adapter.createSession({ userId: u.id, ipHash: 'i', userAgentHash: 'u' });
    const got = await adapter.getSession(s.sessionToken);
    expect(got?.userId).toBe(u.id);
  });

  it('renvoie null + supprime si expirée', async () => {
    const u = await mkUser();
    const s = await prisma.session.create({
      data: {
        sessionToken: 'tok-expired-test',
        userId: u.id,
        expiresAt: new Date(Date.now() - 1000),
        ipHash: 'i',
        userAgentHash: 'u',
      },
    });
    expect(await adapter.getSession(s.sessionToken)).toBeNull();
    expect(await prisma.session.findUnique({ where: { id: s.id } })).toBeNull();
  });

  it('renvoie null + supprime si inactive depuis > 7j', async () => {
    const u = await mkUser();
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 3600 * 1000);
    const s = await prisma.session.create({
      data: {
        sessionToken: 'tok-stale',
        userId: u.id,
        expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
        lastActivityAt: eightDaysAgo,
        ipHash: 'i',
        userAgentHash: 'u',
      },
    });
    expect(await adapter.getSession(s.sessionToken)).toBeNull();
    expect(await prisma.session.findUnique({ where: { id: s.id } })).toBeNull();
  });
});

describe('deleteSession', () => {
  it('supprime la session', async () => {
    const u = await mkUser();
    const s = await adapter.createSession({ userId: u.id, ipHash: 'i', userAgentHash: 'u' });
    await adapter.deleteSession(s.sessionToken);
    expect(await prisma.session.findUnique({ where: { id: s.id } })).toBeNull();
  });
});
