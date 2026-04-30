import { beforeEach, describe, expect, it } from 'vitest';
import { appRouter } from '@/server/trpc/routers/_app';
import type { TrpcContext } from '@/server/trpc/context';
import { getTestPrisma, truncateAll } from './setup/prisma';
import { makeCtxForRole } from './_helpers/auth-ctx';

const prisma = getTestPrisma();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('library.books.get', () => {
  beforeEach(truncateAll);

  // 1) MEMBER gets book; result.id and result.title match; no files and no physical copy
  it('MEMBER gets book with correct id, title, _count.files=0 and physicalCopy=null', async () => {
    const { session, user, libraryId } = await makeCtxForRole('MEMBER');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId } });

    const book = await prisma.book.create({
      data: {
        libraryId: libraryId!,
        title: 'Test Book One',
        authors: ['Author A'],
      },
    });

    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = appRouter.createCaller(ctx);
    const result = await caller.library.books.get({ slug: lib.slug, id: book.id });

    expect(result.id).toBe(book.id);
    expect(result.title).toBe('Test Book One');
    expect(result._count.files).toBe(0);
    expect(result.physicalCopy).toBeNull();
  });

  // 2) Cross-library id-guess returns NOT_FOUND
  it('cross-library id-guess returns NOT_FOUND', async () => {
    // Create the book in a different library
    const otherLib = await prisma.library.create({
      data: { name: 'Other Library', slug: 'other-lib-get' },
    });
    const bookInOtherLib = await prisma.book.create({
      data: {
        libraryId: otherLib.id,
        title: 'Foreign Book',
        authors: ['Author X'],
      },
    });

    // Our MEMBER belongs to a different library
    const { session, user, libraryId } = await makeCtxForRole('MEMBER');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId } });

    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = appRouter.createCaller(ctx);

    // Attempt to fetch a book from the other library via our library's slug
    await expect(
      caller.library.books.get({ slug: lib.slug, id: bookInOtherLib.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // 3) Non-member of slug gets NOT_FOUND on slug-membership check, not on book id
  it('non-member of library slug gets NOT_FOUND', async () => {
    // Create an unrelated library (user is not a member of it)
    const foreignLib = await prisma.library.create({
      data: { name: 'Foreign Lib', slug: 'foreign-lib-get' },
    });
    // Create a book in that library so the id is valid
    const book = await prisma.book.create({
      data: {
        libraryId: foreignLib.id,
        title: 'Book In Foreign Lib',
        authors: ['Author Y'],
      },
    });

    // This MEMBER belongs to a different library, not foreignLib
    const { session, user } = await makeCtxForRole('MEMBER');

    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = appRouter.createCaller(ctx);

    // The slug belongs to foreignLib, not the user's library — middleware denies access
    await expect(
      caller.library.books.get({ slug: foreignLib.slug, id: book.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // 4) Archived book returns NOT_FOUND for non-admin (MEMBER)
  it('archived book returns NOT_FOUND for MEMBER (looks like it does not exist)', async () => {
    const { session, user, libraryId } = await makeCtxForRole('MEMBER');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId } });

    const book = await prisma.book.create({
      data: {
        libraryId: libraryId!,
        title: 'Archived Book',
        authors: ['Author B'],
        archivedAt: new Date(),
      },
    });

    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.library.books.get({ slug: lib.slug, id: book.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // 5) Archived book IS visible to LIBRARY_ADMIN with archivedAt populated
  it('archived book is visible to LIBRARY_ADMIN with archivedAt populated', async () => {
    const { session, user, libraryId } = await makeCtxForRole('LIBRARY_ADMIN');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId } });

    const archivedAt = new Date();
    const book = await prisma.book.create({
      data: {
        libraryId: libraryId!,
        title: 'Archived Visible Book',
        authors: ['Author C'],
        archivedAt,
      },
    });

    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = appRouter.createCaller(ctx);
    const result = await caller.library.books.get({ slug: lib.slug, id: book.id });

    expect(result.id).toBe(book.id);
    expect(result.archivedAt).not.toBeNull();
  });
});
