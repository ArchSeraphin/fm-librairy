import { beforeEach, describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import { appRouter } from '@/server/trpc/routers/_app';
import { getTestPrisma, truncateAll } from './setup/prisma';
import type { Session, User } from '@prisma/client';

const prisma = getTestPrisma();
const HASH_64 = 'a'.repeat(64);

async function makeAdminCtx(): Promise<{ session: Session; user: User; ip: string }> {
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
      sessionToken: 'admin-session',
      userId: user.id,
      expiresAt: new Date(Date.now() + 60_000),
      ipHash: HASH_64,
      userAgentHash: HASH_64,
    },
  });
  return { session, user, ip: '203.0.113.1' };
}

async function makeUserCtx(): Promise<{ session: Session; user: User; ip: string }> {
  const user = await prisma.user.create({
    data: { email: 'user@e2e.test', passwordHash: 'x', displayName: 'U', role: 'USER' },
  });
  const session = await prisma.session.create({
    data: {
      sessionToken: 'user-session',
      userId: user.id,
      expiresAt: new Date(Date.now() + 60_000),
      ipHash: HASH_64,
      userAgentHash: HASH_64,
    },
  });
  return { session, user, ip: '203.0.113.2' };
}

describe('admin.users — read', () => {
  beforeEach(truncateAll);

  it('list: returns paginated users for global admin', async () => {
    const ctx = await makeAdminCtx();
    for (let i = 0; i < 3; i++) {
      await prisma.user.create({
        data: { email: `u${i}@e2e.test`, passwordHash: 'x', displayName: `U${i}` },
      });
    }
    const caller = appRouter.createCaller(ctx);
    const result = await caller.admin.users.list({ limit: 20 });
    expect(result.items.length).toBeGreaterThanOrEqual(4);
    expect(result.nextCursor).toBeNull();
  });

  it('list: filters by status', async () => {
    const ctx = await makeAdminCtx();
    await prisma.user.create({
      data: { email: 'sus@e2e.test', passwordHash: 'x', displayName: 'S', status: 'SUSPENDED' },
    });
    const caller = appRouter.createCaller(ctx);
    const result = await caller.admin.users.list({ limit: 20, status: 'SUSPENDED' });
    expect(result.items.every((u) => u.status === 'SUSPENDED')).toBe(true);
  });

  it('list: searches by displayName (citext)', async () => {
    const ctx = await makeAdminCtx();
    await prisma.user.create({
      data: { email: 'alice@e2e.test', passwordHash: 'x', displayName: 'Alice Wonderland' },
    });
    const caller = appRouter.createCaller(ctx);
    const result = await caller.admin.users.list({ limit: 20, q: 'wonder' });
    expect(result.items.some((u) => u.email === 'alice@e2e.test')).toBe(true);
  });

  it('list: filters by role', async () => {
    const ctx = await makeAdminCtx();
    await prisma.user.create({
      data: {
        email: 'admin2@e2e.test',
        passwordHash: 'x',
        displayName: 'A2',
        role: 'GLOBAL_ADMIN',
      },
    });
    await prisma.user.create({
      data: { email: 'plain@e2e.test', passwordHash: 'x', displayName: 'P', role: 'USER' },
    });
    const caller = appRouter.createCaller(ctx);
    const result = await caller.admin.users.list({ limit: 20, role: 'GLOBAL_ADMIN' });
    expect(result.items.every((u) => u.role === 'GLOBAL_ADMIN')).toBe(true);
    expect(result.items.some((u) => u.email === 'admin2@e2e.test')).toBe(true);
  });

  it('list: rejects non-admin with FORBIDDEN', async () => {
    const ctx = await makeUserCtx();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.admin.users.list({ limit: 20 })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('get: returns user with counts', async () => {
    const ctx = await makeAdminCtx();
    const target = await prisma.user.create({
      data: { email: 't@e2e.test', passwordHash: 'x', displayName: 'T' },
    });
    const caller = appRouter.createCaller(ctx);
    const got = await caller.admin.users.get({ id: target.id });
    expect(got.id).toBe(target.id);
    expect(got.counts).toEqual({ sessions: 0, invitationsCreated: 0, libraryMembers: 0 });
  });

  it('get: throws NOT_FOUND on missing', async () => {
    const ctx = await makeAdminCtx();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.admin.users.get({ id: 'cln00000000000000000000' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('invitations.list: returns invitations created by target user', async () => {
    const ctx = await makeAdminCtx();
    await prisma.invitation.create({
      data: {
        email: 'invitee@e2e.test',
        invitedById: ctx.user.id,
        tokenHash: 'h1',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const caller = appRouter.createCaller(ctx);
    const result = await caller.admin.users.invitations.list({ userId: ctx.user.id });
    expect(result.items.length).toBe(1);
  });
});
