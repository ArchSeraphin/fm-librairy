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

  it('archive: idempotent — emits exactly one audit row', async () => {
    const ctx = await makeAdminCtx();
    const lib = await prisma.library.create({ data: { name: 'L', slug: 'l' } });
    const caller = appRouter.createCaller(ctx);
    await caller.admin.libraries.archive({ id: lib.id, reason: 'cleanup' });
    await caller.admin.libraries.archive({ id: lib.id, reason: 'cleanup' });
    const fresh = await prisma.library.findUnique({ where: { id: lib.id } });
    expect(fresh?.archivedAt).toBeTruthy();
    expect(
      await prisma.auditLog.count({
        where: { action: 'admin.library.archived', targetId: lib.id },
      }),
    ).toBe(1);
  });

  it('unarchive: restores archived library', async () => {
    const ctx = await makeAdminCtx();
    const lib = await prisma.library.create({
      data: { name: 'L', slug: 'l', archivedAt: new Date() },
    });
    await appRouter.createCaller(ctx).admin.libraries.unarchive({ id: lib.id });
    expect((await prisma.library.findUnique({ where: { id: lib.id } }))?.archivedAt).toBeNull();
  });

  // --- new tests ---

  it('unarchive: idempotent — emits exactly one audit row', async () => {
    const ctx = await makeAdminCtx();
    const lib = await prisma.library.create({
      data: { name: 'L', slug: 'l', archivedAt: new Date() },
    });
    const caller = appRouter.createCaller(ctx);
    await caller.admin.libraries.unarchive({ id: lib.id });
    await caller.admin.libraries.unarchive({ id: lib.id });
    expect((await prisma.library.findUnique({ where: { id: lib.id } }))?.archivedAt).toBeNull();
    expect(
      await prisma.auditLog.count({
        where: { action: 'admin.library.unarchived', targetId: lib.id },
      }),
    ).toBe(1);
  });

  it('rename: happy path — updates DB and emits correct audit row', async () => {
    const ctx = await makeAdminCtx();
    const lib = await prisma.library.create({
      data: { name: 'Old', slug: 'old', description: 'Old desc' },
    });
    const caller = appRouter.createCaller(ctx);
    await caller.admin.libraries.rename({ id: lib.id, name: 'New', description: 'New desc' });

    const updated = await prisma.library.findUnique({ where: { id: lib.id } });
    expect(updated?.name).toBe('New');
    expect(updated?.description).toBe('New desc');

    const auditRows = await prisma.auditLog.findMany({
      where: { action: 'admin.library.renamed', targetId: lib.id },
    });
    expect(auditRows).toHaveLength(1);
    const meta = auditRows[0]!.metadata as Record<string, unknown>;
    expect(meta.before).toEqual({ name: 'Old', description: 'Old desc' });
    expect(meta.after).toEqual({ name: 'New', description: 'New desc' });
    expect(meta).not.toHaveProperty('ip');
  });

  it('rename: omitting description preserves existing description', async () => {
    const ctx = await makeAdminCtx();
    const lib = await prisma.library.create({
      data: { name: 'Old', slug: 'old', description: 'keep me' },
    });
    await appRouter.createCaller(ctx).admin.libraries.rename({ id: lib.id, name: 'New' });
    const updated = await prisma.library.findUnique({ where: { id: lib.id } });
    expect(updated?.description).toBe('keep me');
  });

  it('rename: explicit description: null clears description', async () => {
    const ctx = await makeAdminCtx();
    const lib = await prisma.library.create({
      data: { name: 'Old', slug: 'old', description: 'gone' },
    });
    await appRouter
      .createCaller(ctx)
      .admin.libraries.rename({ id: lib.id, name: 'New', description: null });
    const updated = await prisma.library.findUnique({ where: { id: lib.id } });
    expect(updated?.description).toBeNull();
  });

  it('get: returns NOT_FOUND for unknown id', async () => {
    const ctx = await makeAdminCtx();
    await expect(
      appRouter.createCaller(ctx).admin.libraries.get({ id: 'cmnonexistentcuid000000000' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('slug: third library named Foo gets foo-3', async () => {
    const ctx = await makeAdminCtx();
    const caller = appRouter.createCaller(ctx);
    const first = await caller.admin.libraries.create({ name: 'Foo' });
    const second = await caller.admin.libraries.create({ name: 'Foo' });
    const third = await caller.admin.libraries.create({ name: 'Foo' });
    expect(first.slug).toBe('foo');
    expect(second.slug).toBe('foo-2');
    expect(third.slug).toBe('foo-3');
  });
});
