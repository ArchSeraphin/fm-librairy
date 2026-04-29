import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { t } from '../../trpc';
import { authedProcedure } from '../../procedures';
import { db } from '@/lib/db';
import { recordAudit } from '@/lib/audit-log';
import { hashPassword, verifyPassword } from '@/lib/password';
import { revokeAllSessionsForUser } from '@/lib/user-admin';
import { passwordChangeLimiter } from '@/lib/rate-limit';
import { enqueuePasswordResetConfirmation } from '@/lib/mail-queue';
import { getLogger } from '@/lib/logger';

const passwordSchema = z
  .string()
  .min(12)
  .max(128)
  .refine((v) => /[A-Z]/.test(v), { message: 'must contain an uppercase letter' })
  .refine((v) => /[a-z]/.test(v), { message: 'must contain a lowercase letter' })
  .refine((v) => /\d/.test(v), { message: 'must contain a digit' });

const cuid = z.string().min(20).max(40);

export const accountSecurityRouter = t.router({
  changePassword: authedProcedure
    .input(
      z.object({
        currentPassword: z.string().min(1).max(128),
        newPassword: passwordSchema,
        confirmPassword: z.string().min(1).max(128),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await passwordChangeLimiter.consume(ctx.user.id);
      } catch {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS' });
      }

      if (input.newPassword !== input.confirmPassword) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'confirm password mismatch' });
      }
      if (input.newPassword === input.currentPassword) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'new password must differ from current',
        });
      }

      const fresh = await db.user.findUnique({
        where: { id: ctx.user.id },
        select: { passwordHash: true },
      });
      if (!fresh?.passwordHash) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      const ok = await verifyPassword(fresh.passwordHash, input.currentPassword);
      if (!ok) {
        getLogger().warn({ userId: ctx.user.id }, 'changePassword: wrong current');
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }

      const newHash = await hashPassword(input.newPassword);
      await db.user.update({
        where: { id: ctx.user.id },
        data: { passwordHash: newHash },
      });

      const sessionsRevoked = await revokeAllSessionsForUser(ctx.user.id, ctx.session.id);

      await recordAudit({
        action: 'auth.password.changed_self',
        actor: { id: ctx.user.id },
        target: { type: 'USER', id: ctx.user.id },
        metadata: { sessionsRevoked },
        req: { ip: ctx.ip },
      });

      await enqueuePasswordResetConfirmation({
        userId: ctx.user.id,
        triggerSource: 'self_change',
      });

      return { ok: true, sessionsRevoked };
    }),

  listSessions: authedProcedure.query(async ({ ctx }) => {
    const items = await db.session.findMany({
      where: { userId: ctx.user.id },
      orderBy: { lastActivityAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        lastActivityAt: true,
        userAgentLabel: true,
      },
    });
    return {
      items: items.map((s) => ({
        id: s.id,
        createdAt: s.createdAt,
        lastSeenAt: s.lastActivityAt,
        userAgentLabel: s.userAgentLabel,
        isCurrent: s.id === ctx.session.id,
      })),
    };
  }),

  revokeSession: authedProcedure
    .input(z.object({ sessionId: cuid }))
    .mutation(async ({ ctx, input }) => {
      if (input.sessionId === ctx.session.id) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'cannot revoke current session — use sign out',
        });
      }
      const target = await db.session.findFirst({
        where: { id: input.sessionId, userId: ctx.user.id },
        select: { id: true, userAgentLabel: true },
      });
      if (!target) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      await db.session.delete({ where: { id: target.id } });

      await recordAudit({
        action: 'auth.session.revoked_self',
        actor: { id: ctx.user.id },
        target: { type: 'SESSION', id: target.id },
        metadata: { userAgentLabel: target.userAgentLabel },
        req: { ip: ctx.ip },
      });

      return { ok: true };
    }),

  revokeAllOtherSessions: authedProcedure.mutation(async ({ ctx }) => {
    const revokedCount = await revokeAllSessionsForUser(ctx.user.id, ctx.session.id);

    await recordAudit({
      action: 'auth.session.revoked_all_others',
      actor: { id: ctx.user.id },
      target: { type: 'USER', id: ctx.user.id },
      metadata: { revokedCount },
      req: { ip: ctx.ip },
    });

    return { revokedCount };
  }),
});
