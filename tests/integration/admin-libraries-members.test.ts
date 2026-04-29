import { beforeEach, describe, expect, it } from 'vitest';
import { appRouter } from '@/server/trpc/routers/_app';
import { getTestPrisma, truncateAll } from './setup/prisma';

const prisma = getTestPrisma();
const HASH_64 = 'a'.repeat(64);

async function makeAdminCtx() {
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

describe('admin.libraries.members', () => {
  beforeEach(truncateAll);

  it('add: rejects if archived', async () => {
    const ctx = await makeAdminCtx();
    const lib = await prisma.library.create({
      data: { name: 'L', slug: 'l', archivedAt: new Date() },
    });
    const u = await prisma.user.create({
      data: { email: 'u@e2e.test', passwordHash: 'x', displayName: 'U' },
    });
    await expect(
      appRouter.createCaller(ctx).admin.libraries.members.add({
        libraryId: lib.id,
        userId: u.id,
        role: 'MEMBER',
        flags: { canRead: true, canUpload: false, canDownload: true },
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('add: rejects duplicate with CONFLICT', async () => {
    const ctx = await makeAdminCtx();
    const lib = await prisma.library.create({ data: { name: 'L', slug: 'l' } });
    const u = await prisma.user.create({
      data: { email: 'u@e2e.test', passwordHash: 'x', displayName: 'U' },
    });
    await prisma.libraryMember.create({
      data: { libraryId: lib.id, userId: u.id, role: 'MEMBER' },
    });
    await expect(
      appRouter.createCaller(ctx).admin.libraries.members.add({
        libraryId: lib.id,
        userId: u.id,
        role: 'MEMBER',
        flags: { canRead: true, canUpload: false, canDownload: true },
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('add: writes audit + creates row', async () => {
    const ctx = await makeAdminCtx();
    const lib = await prisma.library.create({ data: { name: 'L', slug: 'l' } });
    const u = await prisma.user.create({
      data: { email: 'u@e2e.test', passwordHash: 'x', displayName: 'U' },
    });
    await appRouter.createCaller(ctx).admin.libraries.members.add({
      libraryId: lib.id,
      userId: u.id,
      role: 'LIBRARY_ADMIN',
      flags: { canRead: true, canUpload: true, canDownload: true },
    });
    expect(await prisma.libraryMember.count({ where: { libraryId: lib.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'admin.member.added' } })).toBe(1);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'admin.member.added' },
    });
    expect(audit.metadata).toMatchObject({
      libraryId: lib.id,
      userId: u.id,
      role: 'LIBRARY_ADMIN',
      flags: { canRead: true, canUpload: true, canDownload: true },
    });
    expect(audit.metadata).not.toHaveProperty('ip');
    expect(audit.targetId).toBe(`${lib.id}:${u.id}`);
  });

  it('remove: refuses last LIBRARY_ADMIN', async () => {
    const ctx = await makeAdminCtx();
    const lib = await prisma.library.create({ data: { name: 'L', slug: 'l' } });
    const u = await prisma.user.create({
      data: { email: 'u@e2e.test', passwordHash: 'x', displayName: 'U' },
    });
    await prisma.libraryMember.create({
      data: { libraryId: lib.id, userId: u.id, role: 'LIBRARY_ADMIN' },
    });
    await expect(
      appRouter.createCaller(ctx).admin.libraries.members.remove({
        libraryId: lib.id,
        userId: u.id,
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('changeRole: refuses demoting last LIBRARY_ADMIN', async () => {
    const ctx = await makeAdminCtx();
    const lib = await prisma.library.create({ data: { name: 'L', slug: 'l' } });
    const u = await prisma.user.create({
      data: { email: 'u@e2e.test', passwordHash: 'x', displayName: 'U' },
    });
    await prisma.libraryMember.create({
      data: { libraryId: lib.id, userId: u.id, role: 'LIBRARY_ADMIN' },
    });
    await expect(
      appRouter.createCaller(ctx).admin.libraries.members.changeRole({
        libraryId: lib.id,
        userId: u.id,
        newRole: 'MEMBER',
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('updateFlags: rejects all-false', async () => {
    const ctx = await makeAdminCtx();
    const lib = await prisma.library.create({ data: { name: 'L', slug: 'l' } });
    const u = await prisma.user.create({
      data: { email: 'u@e2e.test', passwordHash: 'x', displayName: 'U' },
    });
    await prisma.libraryMember.create({
      data: { libraryId: lib.id, userId: u.id, role: 'MEMBER' },
    });
    await expect(
      appRouter.createCaller(ctx).admin.libraries.members.updateFlags({
        libraryId: lib.id,
        userId: u.id,
        flags: { canRead: false, canUpload: false, canDownload: false },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('remove: happy path emits audit', async () => {
    const ctx = await makeAdminCtx();
    const lib = await prisma.library.create({ data: { name: 'L', slug: 'l' } });
    const admin1 = await prisma.user.create({
      data: { email: 'admin1@e2e.test', passwordHash: 'x', displayName: 'Admin1' },
    });
    const admin2 = await prisma.user.create({
      data: { email: 'admin2@e2e.test', passwordHash: 'x', displayName: 'Admin2' },
    });
    const member = await prisma.user.create({
      data: { email: 'member@e2e.test', passwordHash: 'x', displayName: 'Member' },
    });
    await prisma.libraryMember.createMany({
      data: [
        { libraryId: lib.id, userId: admin1.id, role: 'LIBRARY_ADMIN' },
        { libraryId: lib.id, userId: admin2.id, role: 'LIBRARY_ADMIN' },
        { libraryId: lib.id, userId: member.id, role: 'MEMBER' },
      ],
    });
    await appRouter.createCaller(ctx).admin.libraries.members.remove({
      libraryId: lib.id,
      userId: member.id,
    });
    expect(await prisma.libraryMember.count({ where: { libraryId: lib.id } })).toBe(2);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'admin.member.removed' },
    });
    expect(audit.targetId).toBe(`${lib.id}:${member.id}`);
    expect(audit.metadata).not.toHaveProperty('ip');
  });

  it('changeRole: promote MEMBER to LIBRARY_ADMIN', async () => {
    const ctx = await makeAdminCtx();
    const lib = await prisma.library.create({ data: { name: 'L', slug: 'l' } });
    const u = await prisma.user.create({
      data: { email: 'u@e2e.test', passwordHash: 'x', displayName: 'U' },
    });
    await prisma.libraryMember.create({
      data: { libraryId: lib.id, userId: u.id, role: 'MEMBER' },
    });
    await appRouter.createCaller(ctx).admin.libraries.members.changeRole({
      libraryId: lib.id,
      userId: u.id,
      newRole: 'LIBRARY_ADMIN',
    });
    const updated = await prisma.libraryMember.findUniqueOrThrow({
      where: { userId_libraryId: { userId: u.id, libraryId: lib.id } },
      select: { role: true },
    });
    expect(updated.role).toBe('LIBRARY_ADMIN');
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'admin.member.role_changed' },
    });
    expect(audit.metadata).toMatchObject({ from: 'MEMBER', to: 'LIBRARY_ADMIN' });
    expect(audit.metadata).not.toHaveProperty('ip');
  });

  it('changeRole: no-op when role unchanged', async () => {
    const ctx = await makeAdminCtx();
    const lib = await prisma.library.create({ data: { name: 'L', slug: 'l' } });
    const u = await prisma.user.create({
      data: { email: 'u@e2e.test', passwordHash: 'x', displayName: 'U' },
    });
    await prisma.libraryMember.create({
      data: { libraryId: lib.id, userId: u.id, role: 'LIBRARY_ADMIN' },
    });
    await appRouter.createCaller(ctx).admin.libraries.members.changeRole({
      libraryId: lib.id,
      userId: u.id,
      newRole: 'LIBRARY_ADMIN',
    });
    expect(await prisma.auditLog.count({ where: { action: 'admin.member.role_changed' } })).toBe(0);
    const unchanged = await prisma.libraryMember.findUniqueOrThrow({
      where: { userId_libraryId: { userId: u.id, libraryId: lib.id } },
      select: { role: true },
    });
    expect(unchanged.role).toBe('LIBRARY_ADMIN');
  });

  it('updateFlags: happy path with at-least-one-true', async () => {
    const ctx = await makeAdminCtx();
    const lib = await prisma.library.create({ data: { name: 'L', slug: 'l' } });
    const u = await prisma.user.create({
      data: { email: 'u@e2e.test', passwordHash: 'x', displayName: 'U' },
    });
    await prisma.libraryMember.create({
      data: {
        libraryId: lib.id,
        userId: u.id,
        role: 'MEMBER',
        canRead: true,
        canUpload: false,
        canDownload: false,
      },
    });
    await appRouter.createCaller(ctx).admin.libraries.members.updateFlags({
      libraryId: lib.id,
      userId: u.id,
      flags: { canRead: true, canUpload: true, canDownload: false },
    });
    const updated = await prisma.libraryMember.findUniqueOrThrow({
      where: { userId_libraryId: { userId: u.id, libraryId: lib.id } },
      select: { canRead: true, canUpload: true, canDownload: true },
    });
    expect(updated).toEqual({ canRead: true, canUpload: true, canDownload: false });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'admin.member.flags_changed' },
    });
    expect(audit.metadata).toMatchObject({
      before: { canRead: true, canUpload: false, canDownload: false },
      after: { canRead: true, canUpload: true, canDownload: false },
    });
    expect(audit.metadata).not.toHaveProperty('ip');
  });

  it('list: filters by libraryId, supports q search, paginates', async () => {
    const ctx = await makeAdminCtx();
    const libA = await prisma.library.create({ data: { name: 'Lib A', slug: 'lib-a' } });
    const libB = await prisma.library.create({ data: { name: 'Lib B', slug: 'lib-b' } });
    const alice = await prisma.user.create({
      data: { email: 'alice@e2e.test', passwordHash: 'x', displayName: 'Alice' },
    });
    const bob = await prisma.user.create({
      data: { email: 'bob@e2e.test', passwordHash: 'x', displayName: 'Bob' },
    });
    const carol = await prisma.user.create({
      data: { email: 'carol@e2e.test', passwordHash: 'x', displayName: 'Carol' },
    });
    const dave = await prisma.user.create({
      data: { email: 'dave@e2e.test', passwordHash: 'x', displayName: 'Dave' },
    });
    await prisma.libraryMember.createMany({
      data: [
        { libraryId: libA.id, userId: alice.id, role: 'MEMBER' },
        { libraryId: libA.id, userId: bob.id, role: 'MEMBER' },
        { libraryId: libA.id, userId: carol.id, role: 'MEMBER' },
        { libraryId: libB.id, userId: dave.id, role: 'MEMBER' },
      ],
    });

    const caller = appRouter.createCaller(ctx);

    // All libA members
    const all = await caller.admin.libraries.members.list({ libraryId: libA.id, limit: 20 });
    expect(all.items).toHaveLength(3);
    expect(all.nextCursor).toBeNull();
    // Dave (libB) must not appear
    expect(all.items.map((i) => i.userId)).not.toContain(dave.id);

    // q search
    const searched = await caller.admin.libraries.members.list({
      libraryId: libA.id,
      q: 'alice',
      limit: 20,
    });
    expect(searched.items).toHaveLength(1);
    expect(searched.items[0]!.userId).toBe(alice.id);
    expect(searched.nextCursor).toBeNull();

    // Pagination: page 1
    const page1 = await caller.admin.libraries.members.list({ libraryId: libA.id, limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    // Pagination: page 2
    const page2 = await caller.admin.libraries.members.list({
      libraryId: libA.id,
      limit: 2,
      cursor: page1.nextCursor!,
    });
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();

    // Combined pages have all 3 libA members, no duplicates
    const allIds = [...page1.items.map((i) => i.userId), ...page2.items.map((i) => i.userId)];
    expect(new Set(allIds).size).toBe(3);
    expect(allIds).not.toContain(dave.id);
  });
});
