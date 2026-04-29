import { beforeEach, describe, expect, it } from 'vitest';
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
      displayName: 'A',
      role: 'GLOBAL_ADMIN',
      twoFactorEnabled: true,
    },
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

describe('admin.libraries — CRUD', () => {
  beforeEach(truncateAll);

  it('create: creates with auto-slug + audit', async () => {
    const ctx = await makeAdminCtx();
    const caller = appRouter.createCaller(ctx);
    const lib = await caller.admin.libraries.create({ name: 'My Library', description: 'desc' });
    expect(lib.slug).toBe('my-library');
    expect(lib.archivedAt).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: 'admin.library.created' } })).toBe(1);
  });

  it('create: appends -2 on slug collision', async () => {
    const ctx = await makeAdminCtx();
    const caller = appRouter.createCaller(ctx);
    await caller.admin.libraries.create({ name: 'Foo' });
    const second = await caller.admin.libraries.create({ name: 'Foo' });
    expect(second.slug).toBe('foo-2');
  });

  it('list: excludes archived by default, includes when flag set', async () => {
    const ctx = await makeAdminCtx();
    await prisma.library.createMany({
      data: [
        { name: 'Active', slug: 'active' },
        { name: 'Archived', slug: 'archived', archivedAt: new Date() },
      ],
    });
    const caller = appRouter.createCaller(ctx);
    const def = await caller.admin.libraries.list({ limit: 20 });
    expect(def.items.every((l) => l.archivedAt === null)).toBe(true);
    const all = await caller.admin.libraries.list({ limit: 20, includeArchived: true });
    expect(all.items.length).toBe(2);
  });

  it('rename: refuses if archived', async () => {
    const ctx = await makeAdminCtx();
    const lib = await prisma.library.create({
      data: { name: 'L', slug: 'l', archivedAt: new Date() },
    });
    await expect(
      appRouter.createCaller(ctx).admin.libraries.rename({ id: lib.id, name: 'New' }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('archive: idempotent', async () => {
    const ctx = await makeAdminCtx();
    const lib = await prisma.library.create({ data: { name: 'L', slug: 'l' } });
    const caller = appRouter.createCaller(ctx);
    await caller.admin.libraries.archive({ id: lib.id, reason: 'cleanup' });
    await caller.admin.libraries.archive({ id: lib.id, reason: 'cleanup' });
    const fresh = await prisma.library.findUnique({ where: { id: lib.id } });
    expect(fresh?.archivedAt).toBeTruthy();
  });

  it('unarchive: restores archived library', async () => {
    const ctx = await makeAdminCtx();
    const lib = await prisma.library.create({
      data: { name: 'L', slug: 'l', archivedAt: new Date() },
    });
    await appRouter.createCaller(ctx).admin.libraries.unarchive({ id: lib.id });
    expect((await prisma.library.findUnique({ where: { id: lib.id } }))?.archivedAt).toBeNull();
  });
});
