import { beforeEach, describe, expect, it } from 'vitest';
import { appRouter } from '@/server/trpc/routers/_app';
import type { TrpcContext } from '@/server/trpc/context';
import { getTestPrisma, truncateAll } from './setup/prisma';
import { makeCtxForRole } from './_helpers/auth-ctx';

const prisma = getTestPrisma();

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------

async function seedAdminAndBook() {
  const { session, user, libraryId } = await makeCtxForRole('LIBRARY_ADMIN');
  const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId } });

  const book = await prisma.book.create({
    data: {
      title: 'Archive Test Book',
      authors: ['Test Author'],
      libraryId: lib.id,
      uploadedById: user!.id,
    },
  });

  const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
  return { ctx, lib, book, user };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('library.books.archive + unarchive', () => {
  beforeEach(truncateAll);

  // 1) archives a book — sets archivedAt non-null, audit log row with action='library.book.archived'
  it('archives a book — archivedAt non-null, audit row with action=library.book.archived', async () => {
    const { ctx, lib, book } = await seedAdminAndBook();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.library.books.archive({ slug: lib.slug, id: book.id });

    expect(result).toEqual({ ok: true });

    const updated = await prisma.book.findUniqueOrThrow({ where: { id: book.id } });
    expect(updated.archivedAt).not.toBeNull();

    const auditRow = await prisma.auditLog.findFirst({
      where: { action: 'library.book.archived', targetId: book.id },
    });
    expect(auditRow).not.toBeNull();
    expect(auditRow!.targetType).toBe('BOOK');
  });

  // 2) archiving an already-archived book → BAD_REQUEST
  it('archiving an already-archived book returns BAD_REQUEST', async () => {
    const { ctx, lib, book } = await seedAdminAndBook();
    const caller = appRouter.createCaller(ctx);

    // Archive first time
    await caller.library.books.archive({ slug: lib.slug, id: book.id });

    // Archive again → should fail
    await expect(
      caller.library.books.archive({ slug: lib.slug, id: book.id }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  // 3) MEMBER cannot archive — FORBIDDEN
  it('MEMBER cannot archive a book — FORBIDDEN', async () => {
    const { lib, book, user: adminUser } = await seedAdminAndBook();

    // Create a MEMBER user
    const { session: memberSession, user: memberUser } = await makeCtxForRole('MEMBER');

    // Add member to admin's library
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
      memberCaller.library.books.archive({ slug: lib.slug, id: book.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  // 4) unarchives a previously-archived book — archivedAt becomes null, audit log 'library.book.unarchived'
  it('unarchives a previously-archived book — archivedAt null, audit row with action=library.book.unarchived', async () => {
    const { ctx, lib, book } = await seedAdminAndBook();
    const caller = appRouter.createCaller(ctx);

    // Archive first
    await caller.library.books.archive({ slug: lib.slug, id: book.id });

    // Then unarchive
    const result = await caller.library.books.unarchive({ slug: lib.slug, id: book.id });

    expect(result).toEqual({ ok: true });

    const updated = await prisma.book.findUniqueOrThrow({ where: { id: book.id } });
    expect(updated.archivedAt).toBeNull();

    const auditRow = await prisma.auditLog.findFirst({
      where: { action: 'library.book.unarchived', targetId: book.id },
    });
    expect(auditRow).not.toBeNull();
    expect(auditRow!.targetType).toBe('BOOK');
  });

  // 5) unarchiving a non-archived book → BAD_REQUEST
  it('unarchiving a non-archived book returns BAD_REQUEST', async () => {
    const { ctx, lib, book } = await seedAdminAndBook();
    const caller = appRouter.createCaller(ctx);

    // book is not archived yet
    await expect(
      caller.library.books.unarchive({ slug: lib.slug, id: book.id }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  // 6) Atomic concurrency — two concurrent archive calls; exactly one wins
  it('two concurrent archive calls — exactly one wins (atomic)', async () => {
    const { ctx, lib, book } = await seedAdminAndBook();
    const caller = appRouter.createCaller(ctx);
    const input = { slug: lib.slug, id: book.id };

    const [a, b] = await Promise.allSettled([
      caller.library.books.archive(input),
      caller.library.books.archive(input),
    ]);

    const fulfilled = [a, b].filter((r) => r.status === 'fulfilled');
    const rejected = [a, b].filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'BAD_REQUEST' });
  });
});
