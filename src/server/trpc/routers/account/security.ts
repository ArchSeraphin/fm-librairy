import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { t } from '../../trpc';
import { authedProcedure } from '../../procedures';
import { db } from '@/lib/db';
import { recordAudit } from '@/lib/audit-log';
import { hashPassword, verifyPassword } from '@/lib/password';
import { revokeAllSessionsForUser } from '@/lib/user-admin';
import {
  passwordChangeLimiter,
  backupCodesRegenLimiter,
  twoFactorReEnrollLimiter,
} from '@/lib/rate-limit';
import { enqueuePasswordResetConfirmation } from '@/lib/mail-queue';
import { getLogger } from '@/lib/logger';
import {
  generateBackupCodes,
  hashBackupCodes,
  consumeBackupCode,
  verifyTotpCode,
} from '@/lib/totp';
import { decryptSecret } from '@/lib/crypto';

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

  regenerateBackupCodes: authedProcedure
    .input(
      z.object({
        currentPassword: z.string().min(1).max(128),
        totpCode: z.string().min(6).max(20),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await backupCodesRegenLimiter.consume(ctx.user.id);
      } catch {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS' });
      }
      if (!ctx.user.twoFactorEnabled) throw new TRPCError({ code: 'PRECONDITION_FAILED' });
      const fullUser = await db.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
      const pwOk = await verifyPassword(fullUser.passwordHash, input.currentPassword);
      if (!pwOk) {
        getLogger().warn({ userId: ctx.user.id }, 'regenerateBackupCodes: wrong password');
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      const sec = await db.twoFactorSecret.findUnique({ where: { userId: ctx.user.id } });
      if (!sec || !sec.confirmedAt) throw new TRPCError({ code: 'PRECONDITION_FAILED' });
      const totpOk = verifyTotpCode(decryptSecret(sec.secretCipher), input.totpCode);
      if (!totpOk) {
        getLogger().warn({ userId: ctx.user.id }, 'regenerateBackupCodes: wrong TOTP');
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      const codes = generateBackupCodes();
      const hashes = await hashBackupCodes(codes);
      await db.twoFactorSecret.update({
        where: { userId: ctx.user.id },
        data: { backupCodes: hashes },
      });
      await recordAudit({
        action: 'auth.2fa.recovery_codes_regenerated_self',
        actor: { id: ctx.user.id },
        target: { type: 'USER', id: ctx.user.id },
        req: { ip: ctx.ip },
      });
      return { codes };
    }),

  startReEnrollWithBackup: authedProcedure
    .input(z.object({ backupCode: z.string().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/) }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role === 'GLOBAL_ADMIN') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'global admin must use DBA runbook' });
      }
      try {
        await twoFactorReEnrollLimiter.consume(ctx.user.id);
      } catch {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS' });
      }
      if (!ctx.user.twoFactorEnabled) throw new TRPCError({ code: 'PRECONDITION_FAILED' });
      const sec = await db.twoFactorSecret.findUnique({ where: { userId: ctx.user.id } });
      if (!sec) throw new TRPCError({ code: 'PRECONDITION_FAILED' });
      const result = await consumeBackupCode(input.backupCode, sec.backupCodes);
      if (!result) {
        getLogger().warn({ userId: ctx.user.id }, 'startReEnrollWithBackup: invalid backup code');
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      // Optimistic concurrency: commit only if the codes array hasn't changed.
      const updated = await db.twoFactorSecret.updateMany({
        where: { userId: ctx.user.id, backupCodes: { equals: sec.backupCodes } },
        data: { backupCodes: result.remainingHashes },
      });
      if (updated.count === 0) throw new TRPCError({ code: 'CONFLICT' });
      await db.$transaction([
        db.twoFactorSecret.delete({ where: { userId: ctx.user.id } }),
        db.user.update({ where: { id: ctx.user.id }, data: { twoFactorEnabled: false } }),
      ]);
      const sessionsRevoked = await revokeAllSessionsForUser(ctx.user.id, ctx.session.id);
      await recordAudit({
        action: 'auth.2fa.reset_via_backup',
        actor: { id: ctx.user.id },
        target: { type: 'USER', id: ctx.user.id },
        metadata: { sessionsRevoked },
        req: { ip: ctx.ip },
      });
      return { ok: true };
    }),
});
