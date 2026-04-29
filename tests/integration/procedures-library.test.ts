import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { t } from '@/server/trpc/trpc';
import { libraryMemberProcedure, libraryAdminProcedure } from '@/server/trpc/procedures-library';
import { getTestPrisma, truncateAll } from './setup/prisma';
import { makeCtxForRole } from './_helpers/auth-ctx';
import type { TrpcContext } from '@/server/trpc/context';

const prisma = getTestPrisma();

// Tiny test router exercising both procedure factories
const router = t.router({
  memberPing: libraryMemberProcedure
    .input(z.object({ slug: z.string() }))
    .query(({ ctx }) => ({ ok: true, libraryId: (ctx as any).library.id })),
  adminPing: libraryAdminProcedure
    .input(z.object({ slug: z.string() }))
    .mutation(({ ctx }) => ({ ok: true, libraryId: (ctx as any).library.id })),
});

describe('libraryMemberProcedure', () => {
  beforeEach(truncateAll);

  it('MEMBER: passes and injects ctx.library', async () => {
    const { session, user, libraryId } = await makeCtxForRole('MEMBER');
    const lib = await prisma.library.findUnique({ where: { id: libraryId } });

    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = router.createCaller(ctx);
    const result = await caller.memberPing({ slug: lib!.slug });

    expect(result.ok).toBe(true);
    expect(result.libraryId).toBe(libraryId);
  });

  it('non-member: throws NOT_FOUND (slug opacity)', async () => {
    // Create a library the caller is NOT a member of
    const lib = await prisma.library.create({ data: { name: 'Foreign Lib', slug: 'foreign-lib' } });
    // Use a LIBRARY_ADMIN user but for a different library — they won't be member of 'foreign-lib'
    const { session, user } = await makeCtxForRole('LIBRARY_ADMIN');

    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = router.createCaller(ctx);

    await expect(caller.memberPing({ slug: lib.slug })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('ANON: throws UNAUTHORIZED (authedProcedure gate)', async () => {
    const ctx: TrpcContext = { session: null, user: null, ip: '203.0.113.1' };
    const caller = router.createCaller(ctx);

    await expect(caller.memberPing({ slug: 'any-slug' })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('PENDING_2FA: throws UNAUTHORIZED (authedProcedure gate)', async () => {
    const { session, user } = await makeCtxForRole('PENDING_2FA');

    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = router.createCaller(ctx);

    await expect(caller.memberPing({ slug: 'any-slug' })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});

describe('libraryAdminProcedure', () => {
  beforeEach(truncateAll);

  it('LIBRARY_ADMIN: passes and injects ctx.library', async () => {
    const { session, user, libraryId } = await makeCtxForRole('LIBRARY_ADMIN');
    const lib = await prisma.library.findUnique({ where: { id: libraryId } });

    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = router.createCaller(ctx);
    const result = await caller.adminPing({ slug: lib!.slug });

    expect(result.ok).toBe(true);
    expect(result.libraryId).toBe(libraryId);
  });

  it('MEMBER: throws FORBIDDEN (insufficient role)', async () => {
    const { session, user, libraryId } = await makeCtxForRole('MEMBER');
    const lib = await prisma.library.findUnique({ where: { id: libraryId } });

    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = router.createCaller(ctx);

    await expect(caller.adminPing({ slug: lib!.slug })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('GLOBAL_ADMIN: passes on a library they are not a member of', async () => {
    // Create a fresh library; GA has no LibraryMember row
    const lib = await prisma.library.create({
      data: { name: 'GA Lib', slug: 'ga-lib' },
    });
    const { session, user } = await makeCtxForRole('GLOBAL_ADMIN');

    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = router.createCaller(ctx);
    const result = await caller.adminPing({ slug: lib.slug });

    expect(result.ok).toBe(true);
    expect(result.libraryId).toBe(lib.id);
  });
});
