import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appRouter } from '@/server/trpc/routers/_app';
import type { TrpcContext } from '@/server/trpc/context';
import { metadataQueue } from '@/server/queues/metadata';
import { getTestPrisma, truncateAll } from './setup/prisma';
import { makeCtxForRole } from './_helpers/auth-ctx';

const prisma = getTestPrisma();

describe('library.books.refreshMetadata', () => {
  beforeEach(async () => {
    await truncateAll();
    vi.restoreAllMocks();
  });

  it('LIBRARY_ADMIN can refresh — book → PENDING + audit recorded + queue.add called with mode "manual"', async () => {
    const addSpy = vi.spyOn(metadataQueue, 'add').mockResolvedValue(undefined as any);
    const { session, user, libraryId } = await makeCtxForRole('LIBRARY_ADMIN');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId! } });
    const book = await prisma.book.create({
      data: { libraryId: lib.id, title: 'X', authors: ['A'], isbn13: '9782070612758' },
    });

    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = appRouter.createCaller(ctx);
    await caller.library.books.refreshMetadata({ slug: lib.slug, id: book.id });

    const updated = await prisma.book.findUniqueOrThrow({ where: { id: book.id } });
    expect(updated.metadataFetchStatus).toBe('PENDING');

    expect(addSpy).toHaveBeenCalledWith('fetch-metadata', { bookId: book.id, mode: 'manual' });

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'library.book.metadata_refresh_requested', targetId: book.id },
    });
    expect(audit).not.toBeNull();
    expect(audit!.actorId).toBe(user!.id);
  });

  it('returns BAD_REQUEST when book has no ISBN', async () => {
    vi.spyOn(metadataQueue, 'add').mockResolvedValue(undefined as any);
    const { session, user, libraryId } = await makeCtxForRole('LIBRARY_ADMIN');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId! } });
    const book = await prisma.book.create({
      data: { libraryId: lib.id, title: 'No ISBN', authors: ['A'] },
    });
    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.library.books.refreshMetadata({ slug: lib.slug, id: book.id }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('MEMBER cannot refresh — FORBIDDEN', async () => {
    const { session, user, libraryId } = await makeCtxForRole('MEMBER');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId! } });
    const book = await prisma.book.create({
      data: { libraryId: lib.id, title: 'X', authors: ['A'], isbn13: '9782070612758' },
    });
    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.library.books.refreshMetadata({ slug: lib.slug, id: book.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('per-book rate limit → TOO_MANY_REQUESTS on second call', async () => {
    vi.spyOn(metadataQueue, 'add').mockResolvedValue(undefined as any);
    const { session, user, libraryId } = await makeCtxForRole('LIBRARY_ADMIN');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId! } });
    const book = await prisma.book.create({
      data: { libraryId: lib.id, title: 'X', authors: ['A'], isbn13: '9782070612758' },
    });
    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = appRouter.createCaller(ctx);
    await caller.library.books.refreshMetadata({ slug: lib.slug, id: book.id });
    await expect(
      caller.library.books.refreshMetadata({ slug: lib.slug, id: book.id }),
    ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
  });
});
