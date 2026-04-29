import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { headers } from 'next/headers';
import { t } from '../trpc';
import { authedProcedure, pendingProcedure } from '../procedures';
import { db } from '@/lib/db';
import {
  generateTotpSecret,
  buildTotpUri,
  verifyTotpCode,
  generateBackupCodes,
  hashBackupCodes,
  consumeBackupCode,
} from '@/lib/totp';
import { encryptSecret, decryptSecret } from '@/lib/crypto';
import { recordAudit } from '@/lib/audit-log';
import { twoFactorLimiter } from '@/lib/rate-limit';
import { getRedis } from '@/lib/redis';
import { createSessionAdapter } from '@/server/auth/adapter';
import { parseUserAgentLabel } from '@/lib/user-agent';
import { getLogger } from '@/lib/logger';

const codeInput = z.object({ code: z.string().min(6).max(20) });

// RFC 6238 §5.2 : reject TOTP code replay within the validity window
// (period 30s + epochTolerance 30s = 90s effective). Atomic SET NX EX.
async function claimTotpCode(userId: string, code: string): Promise<boolean> {
  const set = await getRedis().set(`2fa-replay:${userId}:${code}`, '1', 'EX', 90, 'NX');
  return set === 'OK';
}

export const authRouter = t.router({
  enroll2FA: authedProcedure.mutation(async ({ ctx }) => {
    const secret = generateTotpSecret();
    await db.twoFactorSecret.upsert({
      where: { userId: ctx.user.id },
      update: { secretCipher: encryptSecret(secret), confirmedAt: null, backupCodes: [] },
      create: { userId: ctx.user.id, secretCipher: encryptSecret(secret), backupCodes: [] },
    });
    return {
      uri: buildTotpUri({ secret, accountName: ctx.user.email }),
      secret,
    };
  }),

  confirm2FA: authedProcedure.input(codeInput).mutation(async ({ ctx, input }) => {
    const sec = await db.twoFactorSecret.findUnique({ where: { userId: ctx.user.id } });
    if (!sec) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'no secret enrolled' });
    const ok = verifyTotpCode(decryptSecret(sec.secretCipher), input.code);
    if (!ok) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'bad code' });
    const codes = generateBackupCodes();
    const hashes = await hashBackupCodes(codes);
    await db.$transaction([
      db.twoFactorSecret.update({
        where: { userId: ctx.user.id },
        data: { confirmedAt: new Date(), backupCodes: hashes },
      }),
      db.user.update({ where: { id: ctx.user.id }, data: { twoFactorEnabled: true } }),
    ]);
    await recordAudit({ action: 'auth.2fa.enrolled', actor: { id: ctx.user.id } });
    return { backupCodes: codes };
  }),

  verify2FA: pendingProcedure.input(codeInput).mutation(async ({ ctx, input }) => {
    try {
      await twoFactorLimiter.consume(ctx.session.id);
    } catch {
      throw new TRPCError({ code: 'TOO_MANY_REQUESTS' });
    }
    const sec = await db.twoFactorSecret.findUnique({ where: { userId: ctx.user.id } });
    if (!sec || !sec.confirmedAt) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED' });
    }
    const ok = verifyTotpCode(decryptSecret(sec.secretCipher), input.code);
    if (!ok) {
      await recordAudit({
        action: 'auth.2fa.failure',
        actor: { id: ctx.user.id },
        metadata: { method: 'totp' },
      });
      throw new TRPCError({ code: 'UNAUTHORIZED' });
    }
    if (!(await claimTotpCode(ctx.user.id, input.code))) {
      await recordAudit({
        action: 'auth.2fa.failure',
        actor: { id: ctx.user.id },
        metadata: { method: 'totp', reason: 'replay' },
      });
      throw new TRPCError({ code: 'UNAUTHORIZED' });
    }
    const adapter = createSessionAdapter(db);
    let ua = '';
    try {
      const h = await headers();
      ua = h.get('user-agent') ?? '';
    } catch (err) {
      getLogger().debug({ err }, 'headers() unavailable, UA label skipped');
    }
    const fresh = await adapter.upgradePendingSession({
      oldSessionId: ctx.session.id,
      ipHash: ctx.session.ipHash,
      userAgentHash: ctx.session.userAgentHash,
      userAgentLabel: parseUserAgentLabel(ua),
    });
    await db.user.update({ where: { id: ctx.user.id }, data: { lastLoginAt: new Date() } });
    await recordAudit({ action: 'auth.2fa.success', actor: { id: ctx.user.id } });
    return { ok: true, sessionToken: fresh.sessionToken };
  }),

  verifyBackupCode: pendingProcedure
    .input(z.object({ code: z.string().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/) }))
    .mutation(async ({ ctx, input }) => {
      try {
        await twoFactorLimiter.consume(ctx.session.id);
      } catch {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS' });
      }
      const sec = await db.twoFactorSecret.findUnique({ where: { userId: ctx.user.id } });
      if (!sec || !sec.confirmedAt) throw new TRPCError({ code: 'PRECONDITION_FAILED' });
      const result = await consumeBackupCode(input.code, sec.backupCodes);
      if (!result) {
        await recordAudit({
          action: 'auth.2fa.failure',
          actor: { id: ctx.user.id },
          metadata: { method: 'backup_code' },
        });
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      // Optimistic concurrency : commit only if the codes array hasn't changed
      // since we read it. Otherwise a concurrent request consumed the same
      // code and we must reject this one to prevent double-spend.
      const updated = await db.twoFactorSecret.updateMany({
        where: { userId: ctx.user.id, backupCodes: { equals: sec.backupCodes } },
        data: { backupCodes: result.remainingHashes },
      });
      if (updated.count === 0) {
        await recordAudit({
          action: 'auth.2fa.failure',
          actor: { id: ctx.user.id },
          metadata: { method: 'backup_code', reason: 'race' },
        });
        throw new TRPCError({ code: 'CONFLICT' });
      }
      const adapter = createSessionAdapter(db);
      let ua2 = '';
      try {
        const h2 = await headers();
        ua2 = h2.get('user-agent') ?? '';
      } catch (err) {
        getLogger().debug({ err }, 'headers() unavailable, UA label skipped');
      }
      const fresh = await adapter.upgradePendingSession({
        oldSessionId: ctx.session.id,
        ipHash: ctx.session.ipHash,
        userAgentHash: ctx.session.userAgentHash,
        userAgentLabel: parseUserAgentLabel(ua2),
      });
      await db.user.update({ where: { id: ctx.user.id }, data: { lastLoginAt: new Date() } });
      await recordAudit({
        action: 'auth.2fa.backup_code_used',
        actor: { id: ctx.user.id },
        metadata: { remaining: result.remainingHashes.length },
      });
      return { ok: true, sessionToken: fresh.sessionToken };
    }),

  disable2FA: authedProcedure
    .input(z.object({ password: z.string(), code: z.string().min(6) }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role === 'GLOBAL_ADMIN') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'global admin cannot disable 2FA' });
      }
      const { verifyPassword } = await import('@/lib/password');
      const fullUser = await db.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
      const passwordOk = await verifyPassword(fullUser.passwordHash, input.password);
      if (!passwordOk) throw new TRPCError({ code: 'UNAUTHORIZED' });
      const sec = await db.twoFactorSecret.findUnique({ where: { userId: ctx.user.id } });
      if (!sec) throw new TRPCError({ code: 'PRECONDITION_FAILED' });
      const codeOk = verifyTotpCode(decryptSecret(sec.secretCipher), input.code);
      if (!codeOk) throw new TRPCError({ code: 'UNAUTHORIZED' });
      await db.$transaction([
        db.twoFactorSecret.delete({ where: { userId: ctx.user.id } }),
        db.user.update({ where: { id: ctx.user.id }, data: { twoFactorEnabled: false } }),
      ]);
      await recordAudit({ action: 'auth.2fa.disabled', actor: { id: ctx.user.id } });
      return { ok: true };
    }),
});
