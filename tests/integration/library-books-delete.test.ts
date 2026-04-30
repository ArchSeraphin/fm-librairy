import { beforeEach, describe, expect, it } from 'vitest';
import { appRouter } from '@/server/trpc/routers/_app';
import type { TrpcContext } from '@/server/trpc/context';
import { getTestPrisma, truncateAll } from './setup/prisma';
import { makeCtxForRole } from './_helpers/auth-ctx';

const prisma = getTestPrisma();

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------

async function seedGlobalAdminAndBook(title = 'To Delete') {
  // Create a library (via LIBRARY_ADMIN helper which creates a library)
  const { session: _s, user: _u, libraryId } = await makeCtxForRole('LIBRARY_ADMIN');
  const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId } });

  // Create a GLOBAL_ADMIN user
  const { session: gaSession, user: gaUser } = await makeCtxForRole('GLOBAL_ADMIN');

  const book = await prisma.book.create({
    data: {
      title,
      authors: ['Test Author'],
      libraryId: lib.id,
      uploadedById: gaUser!.id,
    },
  });

  const ctx: TrpcContext = { session: gaSession, user: gaUser, ip: '203.0.113.1' };
  return { ctx, lib, book, gaUser };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('library.books.delete', () => {
  beforeEach(truncateAll);

  // 1) GLOBAL_ADMIN deletes book with no dependencies — book row gone, audit row
  it('GLOBAL_ADMIN deletes book with no dependencies — book gone, audit row library.book.deleted with snapshot.title', async () => {
    const { ctx, lib, book } = await seedGlobalAdminAndBook('To Delete');
    const caller = appRouter.createCaller(ctx);

    const result = await caller.library.books.delete({ slug: lib.slug, id: book.id });

    expect(result).toEqual({ ok: true });

    // Book row should be gone
    const deleted = await prisma.book.findUnique({ where: { id: book.id } });
    expect(deleted).toBeNull();

    // Audit row should exist with action 'library.book.deleted'
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'library.book.deleted', targetId: book.id },
    });
    expect(audit).not.toBeNull();
    expect(audit!.targetType).toBe('BOOK');
    expect((audit!.metadata as any).snapshot).toMatchObject({ title: 'To Delete' });
  });

  // 2) LIBRARY_ADMIN cannot delete — FORBIDDEN (role gate from globalAdminProcedure)
  it('LIBRARY_ADMIN cannot delete a book — FORBIDDEN', async () => {
    const { session: laSession, user: laUser, libraryId } = await makeCtxForRole('LIBRARY_ADMIN');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId } });

    const book = await prisma.book.create({
      data: {
        title: 'Admin Book',
        authors: ['Author'],
        libraryId: lib.id,
        uploadedById: laUser!.id,
      },
    });

    const laCtx: TrpcContext = { session: laSession, user: laUser, ip: '203.0.113.1' };
    const caller = appRouter.createCaller(laCtx);

    await expect(
      caller.library.books.delete({ slug: lib.slug, id: book.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  // 3) Refuses delete when book has BookFile — BAD_REQUEST with message containing 'files'; book still present
  it('refuses delete when book has a BookFile — BAD_REQUEST containing "files", book still present', async () => {
    const { ctx, lib, book } = await seedGlobalAdminAndBook('Book With Files');
    const caller = appRouter.createCaller(ctx);

    // Create a BookFile dependency
    await prisma.bookFile.create({
      data: {
        bookId: book.id,
        format: 'EPUB',
        isOriginal: true,
        storagePath: '/storage/test.epub',
        fileSizeBytes: BigInt(1024),
        sha256: 'a'.repeat(64),
        mimeType: 'application/epub+zip',
      },
    });

    await expect(
      caller.library.books.delete({ slug: lib.slug, id: book.id }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('files') });

    // Book should still be present
    const still = await prisma.book.findUnique({ where: { id: book.id } });
    expect(still).not.toBeNull();
  });

  // 4) Cross-library id-guess — GA targets slug=lib1 but id=book in lib2 → NOT_FOUND
  it('cross-library id-guess — NOT_FOUND when book belongs to a different library', async () => {
    // Create lib1 (via LIBRARY_ADMIN) and lib2 (via another LIBRARY_ADMIN)
    const { session: gaSession, user: gaUser } = await makeCtxForRole('GLOBAL_ADMIN');

    const lib1 = await prisma.library.create({
      data: { name: 'Library 1', slug: 'lib-cross-1' },
    });
    const lib2 = await prisma.library.create({
      data: { name: 'Library 2', slug: 'lib-cross-2' },
    });

    // Book is in lib2, but we call with lib1's slug
    const book = await prisma.book.create({
      data: {
        title: 'Book In Lib2',
        authors: ['Author'],
        libraryId: lib2.id,
        uploadedById: gaUser!.id,
      },
    });

    const ctx: TrpcContext = { session: gaSession, user: gaUser, ip: '203.0.113.1' };
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.library.books.delete({ slug: lib1.slug, id: book.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
