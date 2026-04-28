import { beforeEach, describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import { assertLibraryNotArchived, assertNotLastLibraryAdmin, slugifyUnique } from '@/lib/library-admin';
import { getTestPrisma, truncateAll } from './setup/prisma';

const prisma = getTestPrisma();

async function makeUser(email: string) {
  return prisma.user.create({ data: { email, passwordHash: 'x', displayName: email } });
}

describe('slugifyUnique', () => {
  beforeEach(truncateAll);

  it('returns simple slug when no collision', async () => {
    expect(await slugifyUnique('My Library', prisma)).toBe('my-library');
  });

  it('appends -2 on collision', async () => {
    await prisma.library.create({ data: { name: 'Foo', slug: 'foo' } });
    expect(await slugifyUnique('Foo', prisma)).toBe('foo-2');
  });

  it('appends -3 on double collision', async () => {
    await prisma.library.create({ data: { name: 'Foo', slug: 'foo' } });
    await prisma.library.create({ data: { name: 'Foo 2', slug: 'foo-2' } });
    expect(await slugifyUnique('Foo', prisma)).toBe('foo-3');
  });
});

describe('assertLibraryNotArchived', () => {
  beforeEach(truncateAll);

  it('passes for active library', async () => {
    const lib = await prisma.library.create({ data: { name: 'Active', slug: 'active' } });
    await expect(assertLibraryNotArchived(lib.id)).resolves.toBeUndefined();
  });

  it('throws for archived library', async () => {
    const lib = await prisma.library.create({
      data: { name: 'Archived', slug: 'archived', archivedAt: new Date() },
    });
    await expect(assertLibraryNotArchived(lib.id)).rejects.toBeInstanceOf(TRPCError);
  });

  it('throws NOT_FOUND for missing library', async () => {
    await expect(assertLibraryNotArchived('cln00000000000000000000')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('assertNotLastLibraryAdmin', () => {
  beforeEach(truncateAll);

  it('throws when removing the last LIBRARY_ADMIN', async () => {
    const lib = await prisma.library.create({ data: { name: 'L', slug: 'l' } });
    const u = await makeUser('admin@e2e.test');
    await prisma.libraryMember.create({
      data: { userId: u.id, libraryId: lib.id, role: 'LIBRARY_ADMIN' },
    });
    await expect(
      assertNotLastLibraryAdmin({ libraryId: lib.id, userId: u.id }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it('passes when another LIBRARY_ADMIN exists', async () => {
    const lib = await prisma.library.create({ data: { name: 'L', slug: 'l' } });
    const u1 = await makeUser('a1@e2e.test');
    const u2 = await makeUser('a2@e2e.test');
    await prisma.libraryMember.createMany({
      data: [
        { userId: u1.id, libraryId: lib.id, role: 'LIBRARY_ADMIN' },
        { userId: u2.id, libraryId: lib.id, role: 'LIBRARY_ADMIN' },
      ],
    });
    await expect(
      assertNotLastLibraryAdmin({ libraryId: lib.id, userId: u1.id }),
    ).resolves.toBeUndefined();
  });

  it('passes when target is not LIBRARY_ADMIN', async () => {
    const lib = await prisma.library.create({ data: { name: 'L', slug: 'l' } });
    const admin = await makeUser('admin@e2e.test');
    const member = await makeUser('member@e2e.test');
    await prisma.libraryMember.createMany({
      data: [
        { userId: admin.id, libraryId: lib.id, role: 'LIBRARY_ADMIN' },
        { userId: member.id, libraryId: lib.id, role: 'MEMBER' },
      ],
    });
    await expect(
      assertNotLastLibraryAdmin({ libraryId: lib.id, userId: member.id }),
    ).resolves.toBeUndefined();
  });
});
