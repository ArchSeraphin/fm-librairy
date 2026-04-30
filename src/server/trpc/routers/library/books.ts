import { TRPCError } from '@trpc/server';
import { t } from '../../trpc';
import { libraryMemberProcedure } from '../../procedures-library';
import { libraryBookListLimiter } from '@/lib/rate-limit';
import { buildSearchQuery } from '@/lib/book-search';
import { db } from '@/lib/db';
import { listBooksInput, getBookInput } from '../../schemas/book';

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
});
