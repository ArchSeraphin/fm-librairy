import { TRPCError } from '@trpc/server';
import { t } from './trpc';
import { recordAudit } from '@/lib/audit-log';
import { SEVEN_DAYS_MS } from '@/lib/permissions';

export const publicProcedure = t.procedure;

export const pendingProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.session || !ctx.session.pending2fa || !ctx.user) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'pending session required' });
  }
  return next({ ctx: { ...ctx, session: ctx.session, user: ctx.user } });
});

export const authedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.session || ctx.session.pending2fa || !ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  return next({ ctx: { ...ctx, session: ctx.session, user: ctx.user } });
});

export const globalAdminProcedure = authedProcedure.use(async ({ ctx, next }) => {
  if (ctx.user.role !== 'GLOBAL_ADMIN') {
    await recordAudit({
      action: 'permission.denied',
      actor: { id: ctx.user.id },
      metadata: { required: 'GLOBAL_ADMIN' },
    });
    throw new TRPCError({ code: 'FORBIDDEN' });
  }
  const elapsed = Date.now() - ctx.user.createdAt.getTime();
  if (!ctx.user.twoFactorEnabled && elapsed > SEVEN_DAYS_MS) {
    await recordAudit({
      action: 'permission.denied',
      actor: { id: ctx.user.id },
      metadata: { reason: 'global_admin_2fa_overdue' },
    });
    throw new TRPCError({ code: 'FORBIDDEN' });
  }
  return next({ ctx });
});
