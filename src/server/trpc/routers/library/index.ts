import { t } from '../../trpc';
import { authedProcedure } from '../../procedures';
import { db } from '@/lib/db';
import { libraryBooksRouter } from './books';

export const libraryRouter = t.router({
  books: libraryBooksRouter,
  libraries: t.router({
    listAccessible: authedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role === 'GLOBAL_ADMIN') {
        return db.library.findMany({
          where: { archivedAt: null },
          orderBy: { name: 'asc' },
          select: { id: true, name: true, slug: true },
        });
      }
      const memberships = await db.libraryMember.findMany({
        where: { userId: ctx.user.id, library: { archivedAt: null } },
        include: { library: { select: { id: true, name: true, slug: true } } },
        orderBy: { library: { name: 'asc' } },
      });
      return memberships.map((m) => m.library);
    }),
  }),
});
