import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appRouter } from '@/server/trpc/routers/_app';
import type { TrpcContext } from '@/server/trpc/context';
import { metadataQueue } from '@/server/queues/metadata';
import { getTestPrisma, truncateAll } from './setup/prisma';
import { makeCtxForRole } from './_helpers/auth-ctx';

const prisma = getTestPrisma();

describe('library.books.create — metadata enqueue', () => {
  beforeEach(async () => {
    await truncateAll();
    vi.restoreAllMocks();
  });

  it('enqueues fetch-metadata in auto mode when ISBN provided', async () => {
    const addSpy = vi.spyOn(metadataQueue, 'add').mockResolvedValue(undefined as any);
    const { session, user, libraryId } = await makeCtxForRole('LIBRARY_ADMIN');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId! } });
    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = appRouter.createCaller(ctx);
    const book = await caller.library.books.create({
      slug: lib.slug,
      title: 'T',
      authors: ['A'],
      isbn13: '9782070612758',
    });
    expect(addSpy).toHaveBeenCalledWith('fetch-metadata', { bookId: book.id, mode: 'auto' });
  });

  it('does NOT enqueue when no ISBN provided', async () => {
    const addSpy = vi.spyOn(metadataQueue, 'add').mockResolvedValue(undefined as any);
    const { session, user, libraryId } = await makeCtxForRole('LIBRARY_ADMIN');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId! } });
    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = appRouter.createCaller(ctx);
    await caller.library.books.create({ slug: lib.slug, title: 'T', authors: ['A'] });
    expect(addSpy).not.toHaveBeenCalled();
  });

  it('does not fail the create if enqueue throws (best-effort)', async () => {
    vi.spyOn(metadataQueue, 'add').mockRejectedValue(new Error('redis down'));
    const { session, user, libraryId } = await makeCtxForRole('LIBRARY_ADMIN');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId! } });
    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = appRouter.createCaller(ctx);
    const book = await caller.library.books.create({
      slug: lib.slug,
      title: 'T',
      authors: ['A'],
      isbn13: '9782070612758',
    });
    expect(book.id).toBeTruthy();
  });
});
