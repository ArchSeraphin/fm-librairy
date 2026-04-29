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
});
