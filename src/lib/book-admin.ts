import { TRPCError } from '@trpc/server';
import type { Book } from '@prisma/client';
import { db } from './db';

/**
 * Look up a book and verify it belongs to a specific library.
 *
 * Returns the Book on success. Throws TRPCError NOT_FOUND otherwise — using
 * the same error whether the bookId is invalid OR the book belongs to a
 * different library, to prevent enumeration of book IDs across libraries.
 */
export async function assertBookInLibrary(bookId: string, libraryId: string): Promise<Book> {
  const book = await db.book.findUnique({ where: { id: bookId } });
  if (!book || book.libraryId !== libraryId) {
    throw new TRPCError({ code: 'NOT_FOUND' });
  }
  return book;
}

/**
 * Synchronous guard: throws TRPCError BAD_REQUEST when book.archivedAt is set.
 *
 * Used to gate mutations (update, archive) that should not run on soft-archived
 * books. For unarchive, callers branch on archivedAt directly.
 */
export function assertNotArchived(book: Pick<Book, 'archivedAt'>): void {
  if (book.archivedAt) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'book is archived' });
  }
}

/**
 * Pre-flight check before hard-delete.
 *
 * Counts all dependent rows using _count for array relations and a separate
 * select for the physicalCopy 1-to-1 optional relation (Prisma _count does not
 * support optional 1-to-1 relations). If any dependency is >0 or non-null,
 * throws TRPCError BAD_REQUEST whose message lists the dependency field names
 * so the DBA runbook knows what to clean up.
 *
 * Throws NOT_FOUND if the bookId itself does not resolve.
 */
export async function assertNoBookDependencies(bookId: string): Promise<void> {
  const book = await db.book.findUnique({
    where: { id: bookId },
    select: {
      id: true,
      physicalCopy: { select: { bookId: true } },
      _count: {
        select: {
          files: true,
          tags: true,
          annotations: true,
          bookmarks: true,
          readingProgress: true,
          readingSessions: true,
          ratings: true,
          reviews: true,
          inCollections: true,
          downloadLogs: true,
        },
      },
    },
  });

  if (!book) {
    throw new TRPCError({ code: 'NOT_FOUND' });
  }

  const blocking: string[] = [];

  const counts = book._count;
  if (counts.files > 0) blocking.push('files');
  if (counts.tags > 0) blocking.push('tags');
  if (counts.annotations > 0) blocking.push('annotations');
  if (counts.bookmarks > 0) blocking.push('bookmarks');
  if (counts.readingProgress > 0) blocking.push('readingProgress');
  if (counts.readingSessions > 0) blocking.push('readingSessions');
  if (counts.ratings > 0) blocking.push('ratings');
  if (counts.reviews > 0) blocking.push('reviews');
  if (counts.inCollections > 0) blocking.push('inCollections');
  if (counts.downloadLogs > 0) blocking.push('downloadLogs');
  if (book.physicalCopy != null) blocking.push('physicalCopy');

  if (blocking.length > 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `book has dependent rows: ${blocking.join(', ')}`,
    });
  }
}
