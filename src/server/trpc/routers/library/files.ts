import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { rm } from 'node:fs/promises';
import { t } from '../../trpc';
import { libraryMemberProcedure, libraryAdminProcedure } from '../../procedures-library';
import { libraryFileDeleteLimiter } from '@/lib/rate-limit';
import { recordAudit } from '@/lib/audit-log';
import { db } from '@/lib/db';

const cuid = z.string().cuid();

export const filesRouter = t.router({
  get: libraryMemberProcedure
    .input(z.object({ slug: z.string(), bookId: cuid }))
    .query(async ({ ctx, input }) => {
      const book = await db.book.findUnique({ where: { id: input.bookId } });
      if (!book || book.libraryId !== ctx.library.id) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      return db.bookFile.findMany({
        where: { bookId: input.bookId, libraryId: ctx.library.id },
        orderBy: { createdAt: 'asc' },
      });
    }),

  delete: libraryAdminProcedure
    .input(z.object({ slug: z.string(), id: cuid }))
    .mutation(async ({ ctx, input }) => {
      try {
        await libraryFileDeleteLimiter.consume(`${ctx.user.id}:${ctx.library.id}`);
      } catch {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS' });
      }

      const bf = await db.bookFile.findUnique({ where: { id: input.id } });
      if (!bf || bf.libraryId !== ctx.library.id) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }

      await rm(bf.storagePath, { force: true });
      await db.bookFile.delete({ where: { id: input.id } });
      await recordAudit({
        action: 'library.book_file.deleted',
        actor: { id: ctx.user.id },
        target: { type: 'BOOK_FILE', id: input.id },
        metadata: { libraryId: bf.libraryId, bookId: bf.bookId, sha256: bf.sha256 },
      });
      return { ok: true };
    }),
});
