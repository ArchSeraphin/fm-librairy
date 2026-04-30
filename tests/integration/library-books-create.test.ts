import { beforeEach, describe, expect, it } from 'vitest';
import { appRouter } from '@/server/trpc/routers/_app';
import type { TrpcContext } from '@/server/trpc/context';
import { getTestPrisma, truncateAll } from './setup/prisma';
import { makeCtxForRole } from './_helpers/auth-ctx';

const prisma = getTestPrisma();

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const VALID_INPUT = {
  title: 'La Disparition',
  authors: ['Georges Perec'] as string[],
  isbn13: '9782070285228',
  publisher: 'Gallimard',
  publishedYear: 1969,
  language: 'fr',
  description: 'A lipogram novel.',
  coverPath: 'https://example.com/covers/la-disparition.jpg',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('library.books.create', () => {
  beforeEach(truncateAll);

  // 1) LIBRARY_ADMIN creates book in their library
  it('LIBRARY_ADMIN creates book — returns id/libraryId/title/coverPath and audit row exists', async () => {
    const { session, user, libraryId } = await makeCtxForRole('LIBRARY_ADMIN');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId } });

    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = appRouter.createCaller(ctx);

    const result = await caller.library.books.create({
      slug: lib.slug,
      ...VALID_INPUT,
    });

    expect(result.id).toBeTruthy();
    expect(result.libraryId).toBe(lib.id);
    expect(result.title).toBe(VALID_INPUT.title);
    expect(result.coverPath).toBe(VALID_INPUT.coverPath);

    // Audit log row must exist
    const auditRow = await prisma.auditLog.findFirst({
      where: { action: 'library.book.created', targetId: result.id },
    });
    expect(auditRow).not.toBeNull();
    expect(auditRow!.targetType).toBe('BOOK');
  });

  // 2) MEMBER cannot create — FORBIDDEN
  it('MEMBER cannot create a book — FORBIDDEN', async () => {
    const { session, user, libraryId } = await makeCtxForRole('MEMBER');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId } });

    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.library.books.create({ slug: lib.slug, ...VALID_INPUT }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  // 3) LIBRARY_ADMIN of another lib gets NOT_FOUND when targeting a slug they don't belong to
  it('LIBRARY_ADMIN of another lib gets NOT_FOUND on a foreign slug', async () => {
    // Create the admin (owns lib A)
    const { session, user } = await makeCtxForRole('LIBRARY_ADMIN');

    // Create a foreign library (user is not a member)
    const foreignLib = await prisma.library.create({
      data: { name: 'Foreign Library', slug: 'foreign-lib-create' },
    });

    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.library.books.create({ slug: foreignLib.slug, ...VALID_INPUT }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // 4) GLOBAL_ADMIN can create in any library
  it('GLOBAL_ADMIN can create a book in any library', async () => {
    const { session, user } = await makeCtxForRole('GLOBAL_ADMIN');

    // Create an arbitrary library (admin is not a member)
    const lib = await prisma.library.create({
      data: { name: 'Any Library', slug: 'any-lib-for-global-admin' },
    });

    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = appRouter.createCaller(ctx);

    const result = await caller.library.books.create({
      slug: lib.slug,
      ...VALID_INPUT,
    });

    expect(result.libraryId).toBe(lib.id);
    expect(result.title).toBe(VALID_INPUT.title);
  });

  // 5) coverPath must be HTTPS — http:// rejects (Zod)
  it('rejects coverPath with http:// (must be HTTPS)', async () => {
    const { session, user, libraryId } = await makeCtxForRole('LIBRARY_ADMIN');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId } });

    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.library.books.create({
        slug: lib.slug,
        title: 'Test Book',
        authors: ['Author'],
        coverPath: 'http://example.com/cover.jpg',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  // 6) Rejects invalid ISBN13
  it('rejects invalid isbn13 (e.g. "12345")', async () => {
    const { session, user, libraryId } = await makeCtxForRole('LIBRARY_ADMIN');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId } });

    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.library.books.create({
        slug: lib.slug,
        title: 'Test Book',
        authors: ['Author'],
        isbn13: '12345',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  // 7) Rate limiter caps at 5/min — 5 succeed, 6th throws TOO_MANY_REQUESTS
  it('rate limiter allows 5 creates then blocks on 6th with TOO_MANY_REQUESTS', async () => {
    const { session, user, libraryId } = await makeCtxForRole('LIBRARY_ADMIN');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId } });

    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = appRouter.createCaller(ctx);

    // 5 successive creates must succeed
    for (let i = 0; i < 5; i++) {
      await caller.library.books.create({
        slug: lib.slug,
        title: `Rate Limit Book ${i}`,
        authors: ['Author'],
      });
    }

    // 6th must be rate-limited
    await expect(
      caller.library.books.create({
        slug: lib.slug,
        title: 'Rate Limit Book 5',
        authors: ['Author'],
      }),
    ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
  });
});
