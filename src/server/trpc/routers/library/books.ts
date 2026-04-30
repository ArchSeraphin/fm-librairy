import { TRPCError } from '@trpc/server';
import { t } from '../../trpc';
import { libraryMemberProcedure, libraryAdminProcedure } from '../../procedures-library';
import { libraryBookListLimiter, libraryBookCreateLimiter } from '@/lib/rate-limit';
import { buildSearchQuery } from '@/lib/book-search';
import { db } from '@/lib/db';
import { listBooksInput, getBookInput, createBookInput } from '../../schemas/book';
import { recordAudit } from '@/lib/audit-log';

export const libraryBooksRouter = t.router({
  list: libraryMemberProcedure
    .input(listBooksInput)
    .query(async ({ ctx, input }) => {
      try {
        await libraryBookListLimiter.consume(ctx.user.id);
      } catch {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS' });
      }

      const isAdmin =
        ctx.user.role === 'GLOBAL_ADMIN' || ctx.membership?.role === 'LIBRARY_ADMIN';

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

  get: libraryMemberProcedure
    .input(getBookInput)
    .query(async ({ ctx, input }) => {
      try {
        await libraryBookListLimiter.consume(ctx.user.id);
      } catch {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS' });
      }

      const isAdmin =
        ctx.user.role === 'GLOBAL_ADMIN' || ctx.membership?.role === 'LIBRARY_ADMIN';

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

  create: libraryAdminProcedure
    .input(createBookInput)
    .mutation(async ({ ctx, input }) => {
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
});
