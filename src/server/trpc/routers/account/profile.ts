import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { t } from '../../trpc';
import { authedProcedure } from '../../procedures';
import { db } from '@/lib/db';
import { recordAudit } from '@/lib/audit-log';
import { accountProfileUpdateLimiter } from '@/lib/rate-limit';

export const accountProfileRouter = t.router({
  get: authedProcedure.query(async ({ ctx }) => {
    const u = await db.user.findUnique({
      where: { id: ctx.user.id },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        status: true,
        locale: true,
        twoFactorEnabled: true,
        createdAt: true,
      },
    });
    if (!u) throw new TRPCError({ code: 'NOT_FOUND' });
    return u;
  }),

  update: authedProcedure
    .input(
      z.object({
        displayName: z.string().trim().min(1).max(120),
        locale: z.enum(['fr', 'en']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await accountProfileUpdateLimiter.consume(ctx.user.id);
      } catch {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS' });
      }
      const before = await db.user.findUniqueOrThrow({
        where: { id: ctx.user.id },
        select: { displayName: true, locale: true },
      });
      await db.user.update({
        where: { id: ctx.user.id },
        data: { displayName: input.displayName, locale: input.locale },
      });
      await recordAudit({
        action: 'account.profile.updated',
        actor: { id: ctx.user.id },
        target: { type: 'USER', id: ctx.user.id },
        metadata: {
          before,
          after: { displayName: input.displayName, locale: input.locale },
        },
        req: { ip: ctx.ip },
      });
      return { ok: true };
    }),
});
