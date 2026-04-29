import { beforeEach, describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import type { UserRole } from '@prisma/client';
import { assertMembership } from '@/lib/library-membership';
import { getTestPrisma, truncateAll } from './setup/prisma';
import { makeCtxForRole } from './_helpers/auth-ctx';

const prisma = getTestPrisma();

describe('assertMembership', () => {
  beforeEach(truncateAll);

  // 1. GLOBAL_ADMIN bypass: returns library + membership null, even without a LibraryMember row
  it('GLOBAL_ADMIN bypass: returns library and null membership', async () => {
    const lib = await prisma.library.create({ data: { name: 'Test Lib', slug: 'test-lib' } });
    const { user } = await makeCtxForRole('GLOBAL_ADMIN');
    const actor = { id: user!.id, role: user!.role as UserRole };

    const result = await assertMembership(actor, 'test-lib');

    expect(result.library.id).toBe(lib.id);
    expect(result.membership).toBeNull();
  });

  // 2. LIBRARY_ADMIN of this lib passes
  it('LIBRARY_ADMIN of the library passes without requiredRole', async () => {
    const { user, libraryId } = await makeCtxForRole('LIBRARY_ADMIN');
    const actor = { id: user!.id, role: user!.role as UserRole };

    const lib = await prisma.library.findUnique({ where: { id: libraryId } });
    const result = await assertMembership(actor, lib!.slug);

    expect(result.library.id).toBe(libraryId);
    expect(result.membership?.role).toBe('LIBRARY_ADMIN');
  });

  // 3. MEMBER passes when no requiredRole
  it('MEMBER passes when no requiredRole specified', async () => {
    const { user, libraryId } = await makeCtxForRole('MEMBER');
    const actor = { id: user!.id, role: user!.role as UserRole };

    const lib = await prisma.library.findUnique({ where: { id: libraryId } });
    const result = await assertMembership(actor, lib!.slug);

    expect(result.library.id).toBe(libraryId);
    expect(result.membership?.role).toBe('MEMBER');
  });

  // 4. MEMBER fails with FORBIDDEN when LIBRARY_ADMIN required
  it('MEMBER throws FORBIDDEN when LIBRARY_ADMIN requiredRole', async () => {
    const { user, libraryId } = await makeCtxForRole('MEMBER');
    const actor = { id: user!.id, role: user!.role as UserRole };

    const lib = await prisma.library.findUnique({ where: { id: libraryId } });

    await expect(assertMembership(actor, lib!.slug, 'LIBRARY_ADMIN')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  // 5. Non-member of existing lib gets NOT_FOUND (no slug enumeration)
  it('non-member of existing library gets NOT_FOUND (no slug enumeration)', async () => {
    // Create a library that the user is NOT a member of
    await prisma.library.create({ data: { name: 'Other Lib', slug: 'other-lib' } });
    const { user } = await makeCtxForRole('GLOBAL_ADMIN'); // create a plain USER via LIBRARY_ADMIN then detach... actually create directly
    const plainUser = await prisma.user.create({
      data: {
        email: 'nonmember@e2e.test',
        passwordHash: 'x',
        displayName: 'Non Member',
        role: 'USER',
        status: 'ACTIVE',
      },
    });
    const actor = { id: plainUser.id, role: 'USER' as UserRole };

    await expect(assertMembership(actor, 'other-lib')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  // 6. Non-existent slug → NOT_FOUND
  it('non-existent slug returns NOT_FOUND', async () => {
    const { user } = await makeCtxForRole('GLOBAL_ADMIN');
    const plainUser = await prisma.user.create({
      data: {
        email: 'user2@e2e.test',
        passwordHash: 'x',
        displayName: 'User 2',
        role: 'USER',
        status: 'ACTIVE',
      },
    });
    const actor = { id: plainUser.id, role: 'USER' as UserRole };

    await expect(assertMembership(actor, 'no-such-slug')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  // 7. Archived library treated as NOT_FOUND for non-admin
  it('archived library is NOT_FOUND for non-admin member', async () => {
    const { user, libraryId } = await makeCtxForRole('MEMBER');
    const actor = { id: user!.id, role: user!.role as UserRole };

    // Archive the library
    const lib = await prisma.library.update({
      where: { id: libraryId },
      data: { archivedAt: new Date() },
    });

    await expect(assertMembership(actor, lib.slug)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  // 8. GLOBAL_ADMIN sees archived library (returns it instead of NOT_FOUND)
  it('GLOBAL_ADMIN sees archived library', async () => {
    const lib = await prisma.library.create({
      data: { name: 'Archived Lib', slug: 'archived-lib', archivedAt: new Date() },
    });
    const { user } = await makeCtxForRole('GLOBAL_ADMIN');
    const actor = { id: user!.id, role: user!.role as UserRole };

    const result = await assertMembership(actor, 'archived-lib');

    expect(result.library.id).toBe(lib.id);
    expect(result.library.archivedAt).not.toBeNull();
    expect(result.membership).toBeNull();
  });
});
