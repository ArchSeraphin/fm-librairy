import { beforeEach, describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import {
  assertNotLastGlobalAdmin,
  purgeAllUserSessionsAndJwts,
  revokeAllSessionsForUser,
} from '@/lib/user-admin';
import { getTestPrisma, truncateAll } from './setup/prisma';

const prisma = getTestPrisma();
const HASH_64 = 'a'.repeat(64);

async function createUser(opts: {
  role?: 'GLOBAL_ADMIN' | 'USER';
  status?: 'ACTIVE' | 'SUSPENDED';
  email: string;
}) {
  return prisma.user.create({
    data: {
      email: opts.email,
      passwordHash: 'x',
      displayName: 'T',
      role: opts.role ?? 'USER',
      status: opts.status ?? 'ACTIVE',
    },
  });
}

describe('assertNotLastGlobalAdmin', () => {
  beforeEach(truncateAll);

  it('throws when removing the last active GLOBAL_ADMIN', async () => {
    const admin = await createUser({ role: 'GLOBAL_ADMIN', email: 'a1@e2e.test' });
    await expect(assertNotLastGlobalAdmin(admin.id, 'remove')).rejects.toBeInstanceOf(TRPCError);
  });

  it('passes when another active GLOBAL_ADMIN exists', async () => {
    await createUser({ role: 'GLOBAL_ADMIN', email: 'a1@e2e.test' });
    const second = await createUser({ role: 'GLOBAL_ADMIN', email: 'a2@e2e.test' });
    await expect(assertNotLastGlobalAdmin(second.id, 'remove')).resolves.toBeUndefined();
  });

  it('treats SUSPENDED admins as not counting', async () => {
    const active = await createUser({ role: 'GLOBAL_ADMIN', email: 'a1@e2e.test' });
    await createUser({ role: 'GLOBAL_ADMIN', status: 'SUSPENDED', email: 'a2@e2e.test' });
    await expect(assertNotLastGlobalAdmin(active.id, 'remove')).rejects.toBeInstanceOf(TRPCError);
  });

  it('passes when target is not GLOBAL_ADMIN', async () => {
    await createUser({ role: 'GLOBAL_ADMIN', email: 'a1@e2e.test' });
    const u = await createUser({ role: 'USER', email: 'u1@e2e.test' });
    await expect(assertNotLastGlobalAdmin(u.id, 'remove')).resolves.toBeUndefined();
  });

  it('throws when suspending the last active GLOBAL_ADMIN', async () => {
    const admin = await createUser({ role: 'GLOBAL_ADMIN', email: 'a1@e2e.test' });
    await expect(assertNotLastGlobalAdmin(admin.id, 'suspend')).rejects.toBeInstanceOf(TRPCError);
  });

  it('passes when demoting an already SUSPENDED admin (no-op branch)', async () => {
    await createUser({ role: 'GLOBAL_ADMIN', email: 'a1@e2e.test' });
    const suspended = await createUser({
      role: 'GLOBAL_ADMIN',
      status: 'SUSPENDED',
      email: 'a2@e2e.test',
    });
    await expect(assertNotLastGlobalAdmin(suspended.id, 'demote')).resolves.toBeUndefined();
  });
});

describe('revokeAllSessionsForUser', () => {
  beforeEach(truncateAll);

  it('deletes all sessions for given user', async () => {
    const u = await createUser({ email: 'u1@e2e.test' });
    await prisma.session.createMany({
      data: [
        {
          sessionToken: 's1',
          userId: u.id,
          expiresAt: new Date(Date.now() + 60_000),
          ipHash: HASH_64,
          userAgentHash: HASH_64,
        },
        {
          sessionToken: 's2',
          userId: u.id,
          expiresAt: new Date(Date.now() + 60_000),
          ipHash: HASH_64,
          userAgentHash: HASH_64,
        },
      ],
    });
    const count = await revokeAllSessionsForUser(u.id);
    expect(count).toBe(2);
    expect(await prisma.session.count({ where: { userId: u.id } })).toBe(0);
  });

  it('preserves the excepted session', async () => {
    const u = await createUser({ email: 'u1@e2e.test' });
    const keep = await prisma.session.create({
      data: {
        sessionToken: 'keep',
        userId: u.id,
        expiresAt: new Date(Date.now() + 60_000),
        ipHash: HASH_64,
        userAgentHash: HASH_64,
      },
    });
    await prisma.session.create({
      data: {
        sessionToken: 'kill',
        userId: u.id,
        expiresAt: new Date(Date.now() + 60_000),
        ipHash: HASH_64,
        userAgentHash: HASH_64,
      },
    });
    const count = await revokeAllSessionsForUser(u.id, keep.id);
    expect(count).toBe(1);
    expect(await prisma.session.findUnique({ where: { id: keep.id } })).not.toBeNull();
  });

  it('does not touch other users sessions', async () => {
    const a = await createUser({ email: 'a@e2e.test' });
    const b = await createUser({ email: 'b@e2e.test' });
    await prisma.session.create({
      data: {
        sessionToken: 'a',
        userId: a.id,
        expiresAt: new Date(Date.now() + 60_000),
        ipHash: HASH_64,
        userAgentHash: HASH_64,
      },
    });
    await prisma.session.create({
      data: {
        sessionToken: 'b',
        userId: b.id,
        expiresAt: new Date(Date.now() + 60_000),
        ipHash: HASH_64,
        userAgentHash: HASH_64,
      },
    });
    await revokeAllSessionsForUser(a.id);
    expect(await prisma.session.count({ where: { userId: b.id } })).toBe(1);
  });
});

describe('purgeAllUserSessionsAndJwts', () => {
  beforeEach(truncateAll);

  it('sets revokedSessionsAt and deletes all sessions atomically', async () => {
    const u = await createUser({ email: 'p1@e2e.test' });
    expect(u.revokedSessionsAt).toBeNull();
    await prisma.session.createMany({
      data: [
        {
          sessionToken: 'p1',
          userId: u.id,
          expiresAt: new Date(Date.now() + 60_000),
          ipHash: HASH_64,
          userAgentHash: HASH_64,
        },
        {
          sessionToken: 'p2',
          userId: u.id,
          expiresAt: new Date(Date.now() + 60_000),
          ipHash: HASH_64,
          userAgentHash: HASH_64,
        },
      ],
    });

    const before = Date.now();
    const count = await purgeAllUserSessionsAndJwts(u.id);
    const after = Date.now();

    expect(count).toBe(2);
    expect(await prisma.session.count({ where: { userId: u.id } })).toBe(0);

    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(fresh.revokedSessionsAt).toBeInstanceOf(Date);
    const ts = fresh.revokedSessionsAt!.getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('does not affect other users sessions or watermark', async () => {
    const a = await createUser({ email: 'pa@e2e.test' });
    const b = await createUser({ email: 'pb@e2e.test' });
    await prisma.session.create({
      data: {
        sessionToken: 'sa',
        userId: a.id,
        expiresAt: new Date(Date.now() + 60_000),
        ipHash: HASH_64,
        userAgentHash: HASH_64,
      },
    });
    await prisma.session.create({
      data: {
        sessionToken: 'sb',
        userId: b.id,
        expiresAt: new Date(Date.now() + 60_000),
        ipHash: HASH_64,
        userAgentHash: HASH_64,
      },
    });

    await purgeAllUserSessionsAndJwts(a.id);

    expect(await prisma.session.count({ where: { userId: b.id } })).toBe(1);
    const freshB = await prisma.user.findUniqueOrThrow({ where: { id: b.id } });
    expect(freshB.revokedSessionsAt).toBeNull();
  });

  it('moves watermark forward on repeated calls', async () => {
    const u = await createUser({ email: 'pm@e2e.test' });
    await purgeAllUserSessionsAndJwts(u.id);
    const first = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    const t1 = first.revokedSessionsAt!.getTime();

    await new Promise((r) => setTimeout(r, 5));
    await purgeAllUserSessionsAndJwts(u.id);
    const second = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    const t2 = second.revokedSessionsAt!.getTime();

    expect(t2).toBeGreaterThan(t1);
  });
});
