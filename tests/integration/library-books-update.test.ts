import { beforeEach, describe, expect, it } from 'vitest';
import { appRouter } from '@/server/trpc/routers/_app';
import type { TrpcContext } from '@/server/trpc/context';
import { getTestPrisma, truncateAll } from './setup/prisma';
import { makeCtxForRole } from './_helpers/auth-ctx';

const prisma = getTestPrisma();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('library.books.update', () => {
  beforeEach(truncateAll);

  // 1) Happy path — admin updates title, audit row recorded with diff
  it('LIBRARY_ADMIN updates title — returns updated book and audit row has correct diff', async () => {
    const { session, user, libraryId } = await makeCtxForRole('LIBRARY_ADMIN');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId } });

    // Create the book first
    const book = await prisma.book.create({
      data: {
        title: 'Original Title',
        authors: ['Some Author'],
        libraryId: lib.id,
        uploadedById: user!.id,
      },
    });

    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = appRouter.createCaller(ctx);

    const result = await caller.library.books.update({
      slug: lib.slug,
      id: book.id,
      expectedUpdatedAt: book.updatedAt,
      patch: { title: 'New Title' },
    });

    expect(result.title).toBe('New Title');
    expect(result.id).toBe(book.id);

    // Audit log row must exist with correct diff
    const auditRow = await prisma.auditLog.findFirst({
      where: { action: 'library.book.updated', targetId: book.id },
    });
    expect(auditRow).not.toBeNull();
    expect(auditRow!.targetType).toBe('BOOK');
    const metadata = auditRow!.metadata as Record<string, unknown>;
    expect(metadata.changes).toMatchObject({
      title: { from: 'Original Title', to: 'New Title' },
    });
  });

  // 2) Concurrency — second call with stale timestamp throws CONFLICT
  it('second update with stale expectedUpdatedAt throws CONFLICT; book stays at first update', async () => {
    const { session, user, libraryId } = await makeCtxForRole('LIBRARY_ADMIN');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId } });

    const book = await prisma.book.create({
      data: {
        title: 'Concurrency Book',
        authors: ['Author'],
        libraryId: lib.id,
        uploadedById: user!.id,
      },
    });

    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = appRouter.createCaller(ctx);

    // First update succeeds with original updatedAt
    const firstResult = await caller.library.books.update({
      slug: lib.slug,
      id: book.id,
      expectedUpdatedAt: book.updatedAt,
      patch: { title: 'First Update' },
    });
    expect(firstResult.title).toBe('First Update');

    // Second call with the SAME (now-stale) original timestamp → CONFLICT
    await expect(
      caller.library.books.update({
        slug: lib.slug,
        id: book.id,
        expectedUpdatedAt: book.updatedAt, // stale — book has been updated
        patch: { title: 'Second Update' },
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    // Book must still be at the first update value
    const current = await prisma.book.findUniqueOrThrow({ where: { id: book.id } });
    expect(current.title).toBe('First Update');
  });

  // 3) Archived book → BAD_REQUEST
  it('cannot update an archived book — BAD_REQUEST', async () => {
    const { session, user, libraryId } = await makeCtxForRole('LIBRARY_ADMIN');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId } });

    const book = await prisma.book.create({
      data: {
        title: 'Archived Book',
        authors: ['Author'],
        libraryId: lib.id,
        uploadedById: user!.id,
        archivedAt: new Date(),
      },
    });

    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.library.books.update({
        slug: lib.slug,
        id: book.id,
        expectedUpdatedAt: book.updatedAt,
        patch: { title: 'Should Not Work' },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  // 4) Cross-library id-guess → NOT_FOUND
  it('cross-library id-guess returns NOT_FOUND', async () => {
    const { session, user, libraryId } = await makeCtxForRole('LIBRARY_ADMIN');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId } });

    // Create a different library with a book
    const { user: otherUser, libraryId: otherLibraryId } = await makeCtxForRole('LIBRARY_ADMIN');
    const foreignBook = await prisma.book.create({
      data: {
        title: 'Foreign Book',
        authors: ['Author'],
        libraryId: otherLibraryId!,
        uploadedById: otherUser!.id,
      },
    });

    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = appRouter.createCaller(ctx);

    // Try to update the foreign book using the admin's library slug
    await expect(
      caller.library.books.update({
        slug: lib.slug,
        id: foreignBook.id,
        expectedUpdatedAt: foreignBook.updatedAt,
        patch: { title: 'Hijacked Title' },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // 5) MEMBER cannot update — FORBIDDEN
  it('MEMBER of the same library cannot update a book — FORBIDDEN', async () => {
    // Create admin and library
    const {
      session: adminSession,
      user: adminUser,
      libraryId,
    } = await makeCtxForRole('LIBRARY_ADMIN');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId } });

    // Create the book as admin
    const book = await prisma.book.create({
      data: {
        title: 'Admin Book',
        authors: ['Author'],
        libraryId: lib.id,
        uploadedById: adminUser!.id,
      },
    });

    // Create a MEMBER user
    const { session: memberSession, user: memberUser } = await makeCtxForRole('MEMBER');

    // Insert a libraryMember row so the member also belongs to the ADMIN's library
    // (so membership middleware passes — the FORBIDDEN must come from the role gate inside libraryAdminProcedure)
    await prisma.libraryMember.create({
      data: {
        userId: memberUser!.id,
        libraryId: lib.id,
        role: 'MEMBER',
      },
    });

    const memberCtx: TrpcContext = { session: memberSession, user: memberUser, ip: '203.0.113.1' };
    const memberCaller = appRouter.createCaller(memberCtx);

    await expect(
      memberCaller.library.books.update({
        slug: lib.slug,
        id: book.id,
        expectedUpdatedAt: book.updatedAt,
        patch: { title: 'Member Hijack' },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  // 6) Atomic concurrency — two concurrent updates with same expectedUpdatedAt; exactly one wins
  it('two concurrent updates with the same expectedUpdatedAt — exactly one wins (atomic)', async () => {
    const { session, user, libraryId } = await makeCtxForRole('LIBRARY_ADMIN');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId } });

    const book = await prisma.book.create({
      data: {
        title: 'Race Book',
        authors: ['Author'],
        libraryId: lib.id,
        uploadedById: user!.id,
      },
    });

    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = appRouter.createCaller(ctx);

    const baseInput = (title: string) => ({
      slug: lib.slug,
      id: book.id,
      expectedUpdatedAt: book.updatedAt,
      patch: { title },
    });

    const [a, b] = await Promise.allSettled([
      caller.library.books.update(baseInput('Concurrent A')),
      caller.library.books.update(baseInput('Concurrent B')),
    ]);

    const fulfilled = [a, b].filter((r) => r.status === 'fulfilled');
    const rejected = [a, b].filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'CONFLICT' });
  });
});
