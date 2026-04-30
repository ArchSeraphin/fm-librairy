import { beforeEach, describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import { appRouter } from '@/server/trpc/routers/_app';
import type { TrpcContext } from '@/server/trpc/context';
import { getTestPrisma, truncateAll } from './setup/prisma';
import { makeCtxForRole } from './_helpers/auth-ctx';

const prisma = getTestPrisma();

// ---------------------------------------------------------------------------
// Fixture factory
// ---------------------------------------------------------------------------

/**
 * Seed 5 books in the given library:
 *   - alternating language: fr (0,2,4), en (1,3)
 *   - hasDigital: true for i < 2, false otherwise
 *   - none archived (archivedAt null)
 */
async function seedBooks(libraryId: string) {
  const books = [];
  for (let i = 0; i < 5; i++) {
    const b = await prisma.book.create({
      data: {
        libraryId,
        title: `Book ${i}`,
        authors: [`Author ${i}`],
        language: i % 2 === 0 ? 'fr' : 'en',
        hasDigital: i < 2,
      },
    });
    books.push(b);
  }
  return books;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('library.books.list', () => {
  beforeEach(truncateAll);

  // 1) MEMBER sees all 5 non-archived books in their library
  it('MEMBER sees all 5 non-archived books in their library', async () => {
    const { session, user, libraryId } = await makeCtxForRole('MEMBER');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId } });
    await seedBooks(libraryId!);

    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = appRouter.createCaller(ctx);
    const result = await caller.library.books.list({ slug: lib.slug });

    expect(result.items.length).toBe(5);
    expect(result.nextCursor).toBeNull();
  });

  // 2) limit defaults to 24 and clamps at max 100 (>100 throws ZodError)
  it('limit >100 throws ZodError', async () => {
    const { session, user, libraryId } = await makeCtxForRole('MEMBER');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId } });

    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.library.books.list({ slug: lib.slug, limit: 101 }),
    ).rejects.toThrow();
  });

  // 3) language filter narrows results (fr only → 3 books: indices 0,2,4)
  it('language filter narrows results', async () => {
    const { session, user, libraryId } = await makeCtxForRole('MEMBER');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId } });
    await seedBooks(libraryId!);

    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = appRouter.createCaller(ctx);
    const result = await caller.library.books.list({ slug: lib.slug, language: 'fr' });

    expect(result.items.length).toBe(3);
    expect(result.items.every((b) => b.language === 'fr')).toBe(true);
  });

  // 4) hasDigital filter narrows results (true only → 2 books: indices 0,1)
  it('hasDigital filter narrows results', async () => {
    const { session, user, libraryId } = await makeCtxForRole('MEMBER');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId } });
    await seedBooks(libraryId!);

    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = appRouter.createCaller(ctx);
    const result = await caller.library.books.list({ slug: lib.slug, hasDigital: true });

    expect(result.items.length).toBe(2);
    expect(result.items.every((b) => b.hasDigital === true)).toBe(true);
  });

  // 5) q < 2 chars is silently ignored (returns full set)
  it('q < 2 chars is silently ignored and returns full set', async () => {
    const { session, user, libraryId } = await makeCtxForRole('MEMBER');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId } });
    await seedBooks(libraryId!);

    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = appRouter.createCaller(ctx);
    const result = await caller.library.books.list({ slug: lib.slug, q: 'x' });

    expect(result.items.length).toBe(5);
  });

  // 6) non-member of slug gets NOT_FOUND
  it('non-member of library gets NOT_FOUND', async () => {
    // Create an unrelated library
    const foreignLib = await prisma.library.create({
      data: { name: 'Foreign Lib', slug: 'foreign-lib-books' },
    });
    // Create a MEMBER user for a different library
    const { session, user } = await makeCtxForRole('MEMBER');

    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.library.books.list({ slug: foreignLib.slug }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // 7) ANON throws UNAUTHORIZED
  it('ANON throws UNAUTHORIZED', async () => {
    const ctx: TrpcContext = { session: null, user: null, ip: '203.0.113.1' };
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.library.books.list({ slug: 'any-slug' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  // 8) includeArchived=true is silently coerced to false for MEMBER
  it('includeArchived=true is silently coerced to false for MEMBER', async () => {
    const { session, user, libraryId } = await makeCtxForRole('MEMBER');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId } });
    const books = await seedBooks(libraryId!);

    // Archive one book
    await prisma.book.update({
      where: { id: books[0]!.id },
      data: { archivedAt: new Date() },
    });

    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = appRouter.createCaller(ctx);
    // Even though includeArchived=true is passed, MEMBER should not see archived books
    const result = await caller.library.books.list({
      slug: lib.slug,
      includeArchived: true,
    });

    // Should only see 4 books (1 archived, silently excluded)
    expect(result.items.length).toBe(4);
    expect(result.items.find((b) => b.id === books[0]!.id)).toBeUndefined();
  });

  // 9) includeArchived=true returns archived books for LIBRARY_ADMIN
  it('includeArchived=true returns archived books for LIBRARY_ADMIN', async () => {
    const { session, user, libraryId } = await makeCtxForRole('LIBRARY_ADMIN');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId } });
    const books = await seedBooks(libraryId!);

    // Archive one book
    await prisma.book.update({
      where: { id: books[0]!.id },
      data: { archivedAt: new Date() },
    });

    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = appRouter.createCaller(ctx);
    const result = await caller.library.books.list({
      slug: lib.slug,
      includeArchived: true,
    });

    // LIBRARY_ADMIN should see all 5 books including the archived one
    expect(result.items.length).toBe(5);
    expect(result.items.find((b) => b.id === books[0]!.id)).toBeDefined();
  });
});
