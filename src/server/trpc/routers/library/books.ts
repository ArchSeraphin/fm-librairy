import { TRPCError } from '@trpc/server';
import { t } from '../../trpc';
import { libraryMemberProcedure, libraryAdminProcedure } from '../../procedures-library';
import { globalAdminProcedure } from '../../procedures';
import {
  libraryBookListLimiter,
  libraryBookCreateLimiter,
  libraryBookUpdateLimiter,
  libraryBookDeleteLimiter,
} from '@/lib/rate-limit';
import { buildSearchQuery } from '@/lib/book-search';
import { db } from '@/lib/db';
import {
  listBooksInput,
  getBookInput,
  createBookInput,
  updateBookInput,
  archiveBookInput,
  unarchiveBookInput,
  deleteBookInput,
} from '../../schemas/book';
import { recordAudit } from '@/lib/audit-log';
import { assertBookInLibrary, assertNotArchived, assertNoBookDependencies } from '@/lib/book-admin';

export const libraryBooksRouter = t.router({
  list: libraryMemberProcedure.input(listBooksInput).query(async ({ ctx, input }) => {
    try {
      await libraryBookListLimiter.consume(ctx.user.id);
    } catch {
      throw new TRPCError({ code: 'TOO_MANY_REQUESTS' });
    }

    const isAdmin = ctx.user.role === 'GLOBAL_ADMIN' || ctx.membership?.role === 'LIBRARY_ADMIN';

    // Silently coerce includeArchived to false for non-admins
    const includeArchived = isAdmin ? input.includeArchived : false;

    return buildSearchQuery({
      libraryId: ctx.library.id,
      q: input.q,
      hasDigital: input.hasDigital,
      hasPhysical: input.hasPhysical,
      language: input.language,
      sort: input.sort,
      cursor: input.cursor,
      limit: input.limit,
      includeArchived,
    });
  }),

  get: libraryMemberProcedure.input(getBookInput).query(async ({ ctx, input }) => {
    try {
      await libraryBookListLimiter.consume(ctx.user.id);
    } catch {
      throw new TRPCError({ code: 'TOO_MANY_REQUESTS' });
    }

    const isAdmin = ctx.user.role === 'GLOBAL_ADMIN' || ctx.membership?.role === 'LIBRARY_ADMIN';

    const book = await db.book.findUnique({
      where: { id: input.id },
      include: {
        _count: { select: { files: true } },
        physicalCopy: true,
      },
    });

    if (!book || book.libraryId !== ctx.library.id) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }

    if (!isAdmin && book.archivedAt !== null) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }

    return book;
  }),

  create: libraryAdminProcedure.input(createBookInput).mutation(async ({ ctx, input }) => {
    try {
      await libraryBookCreateLimiter.consume(ctx.user.id);
    } catch {
      throw new TRPCError({ code: 'TOO_MANY_REQUESTS' });
    }

    // slug is consumed by the middleware to resolve ctx.library; not stored on the book
    const book = await db.book.create({
      data: {
        title: input.title,
        authors: input.authors,
        isbn10: input.isbn10,
        isbn13: input.isbn13,
        publisher: input.publisher,
        publishedYear: input.publishedYear,
        language: input.language,
        description: input.description,
        coverPath: input.coverPath,
        libraryId: ctx.library.id,
        uploadedById: ctx.user.id,
      },
    });

    await recordAudit({
      action: 'library.book.created',
      actor: { id: ctx.user.id },
      target: { type: 'BOOK', id: book.id },
      metadata: { libraryId: ctx.library.id, title: book.title },
      req: { ip: ctx.ip },
    });

    return book;
  }),

  update: libraryAdminProcedure.input(updateBookInput).mutation(async ({ ctx, input }) => {
    try {
      await libraryBookUpdateLimiter.consume(ctx.user.id);
    } catch {
      throw new TRPCError({ code: 'TOO_MANY_REQUESTS' });
    }

    // Read existing for diff computation (acceptable read; concurrency check is below)
    const existing = await assertBookInLibrary(input.id, ctx.library.id);

    assertNotArchived(existing);

    // Atomic optimistic concurrency: the WHERE clause includes updatedAt so a concurrent
    // writer that has already changed the row will see updateMany.count === 0.
    // archivedAt: null is also in WHERE to close the archive-between-check-and-update window.
    const result = await db.book.updateMany({
      where: {
        id: input.id,
        libraryId: ctx.library.id,
        archivedAt: null,
        updatedAt: input.expectedUpdatedAt,
      },
      data: input.patch,
    });

    if (result.count === 0) {
      // Disambiguate WHY the row didn't match — single re-read.
      const current = await db.book.findUnique({ where: { id: input.id } });
      if (!current || current.libraryId !== ctx.library.id) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      if (current.archivedAt) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'book is archived' });
      }
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'book was modified by someone else; reload and retry',
      });
    }

    // updateMany doesn't return the row; re-read for the response and audit
    const updated = await db.book.findUniqueOrThrow({ where: { id: input.id } });

    // Compute field-level diff
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const [k, v] of Object.entries(input.patch)) {
      if ((existing as Record<string, unknown>)[k] !== v) {
        changes[k] = { from: (existing as Record<string, unknown>)[k], to: v };
      }
    }

    await recordAudit({
      action: 'library.book.updated',
      actor: { id: ctx.user.id },
      target: { type: 'BOOK', id: updated.id },
      metadata: { libraryId: ctx.library.id, changes },
      req: { ip: ctx.ip },
    });

    return updated;
  }),

  archive: libraryAdminProcedure.input(archiveBookInput).mutation(async ({ ctx, input }) => {
    try {
      await libraryBookUpdateLimiter.consume(ctx.user.id);
    } catch {
      throw new TRPCError({ code: 'TOO_MANY_REQUESTS' });
    }

    // Atomic: PG row-lock on UPDATE WHERE rechecks the guard predicate; concurrent writers see count=0.
    const result = await db.book.updateMany({
      where: {
        id: input.id,
        libraryId: ctx.library.id,
        archivedAt: null, // only update if currently not archived
      },
      data: { archivedAt: new Date() },
    });

    if (result.count === 0) {
      // Single re-read to disambiguate NOT_FOUND vs already-archived
      const current = await db.book.findUnique({ where: { id: input.id } });
      if (!current || current.libraryId !== ctx.library.id) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      // current.archivedAt is non-null (otherwise updateMany would have matched)
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'already archived' });
    }

    const updated = await db.book.findUniqueOrThrow({ where: { id: input.id } });

    await recordAudit({
      action: 'library.book.archived',
      actor: { id: ctx.user.id },
      target: { type: 'BOOK', id: updated.id },
      metadata: { libraryId: ctx.library.id },
      req: { ip: ctx.ip },
    });

    return updated;
  }),

  unarchive: libraryAdminProcedure.input(unarchiveBookInput).mutation(async ({ ctx, input }) => {
    try {
      await libraryBookUpdateLimiter.consume(ctx.user.id);
    } catch {
      throw new TRPCError({ code: 'TOO_MANY_REQUESTS' });
    }

    // Atomic: PG row-lock on UPDATE WHERE rechecks the guard predicate; concurrent writers see count=0.
    const result = await db.book.updateMany({
      where: {
        id: input.id,
        libraryId: ctx.library.id,
        archivedAt: { not: null }, // only update if currently archived
      },
      data: { archivedAt: null },
    });

    if (result.count === 0) {
      const current = await db.book.findUnique({ where: { id: input.id } });
      if (!current || current.libraryId !== ctx.library.id) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'not archived' });
    }

    const updated = await db.book.findUniqueOrThrow({ where: { id: input.id } });

    await recordAudit({
      action: 'library.book.unarchived',
      actor: { id: ctx.user.id },
      target: { type: 'BOOK', id: updated.id },
      metadata: { libraryId: ctx.library.id },
      req: { ip: ctx.ip },
    });

    return updated;
  }),

  delete: globalAdminProcedure.input(deleteBookInput).mutation(async ({ ctx, input }) => {
    try {
      await libraryBookDeleteLimiter.consume(ctx.user.id);
    } catch {
      throw new TRPCError({ code: 'TOO_MANY_REQUESTS' });
    }

    // Validate slug → library (GA bypasses membership middleware so must resolve manually)
    const lib = await db.library.findUnique({ where: { slug: input.slug } });
    if (!lib) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }

    // Throws NOT_FOUND on cross-library id-guess
    const book = await assertBookInLibrary(input.id, lib.id);

    // Throws BAD_REQUEST listing dependency field names if any dependent rows exist
    await assertNoBookDependencies(book.id);

    // Snapshot before delete (legal hold)
    const snapshot = { ...book };

    await db.book.delete({ where: { id: book.id } });

    await recordAudit({
      action: 'library.book.deleted',
      actor: { id: ctx.user.id },
      target: { type: 'BOOK', id: book.id },
      metadata: { libraryId: lib.id, snapshot },
      req: { ip: ctx.ip },
    });

    return { ok: true };
  }),
});
