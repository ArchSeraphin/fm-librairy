import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { t } from '../trpc';
import { publicProcedure } from '../procedures';
import {
  createPasswordResetToken,
  findResetTokenByRawToken,
  consumePasswordReset,
} from '@/lib/password-reset';
import { recordAudit } from '@/lib/audit-log';
import { resetRequestLimiter, resetIpOnlyLimiter } from '@/lib/rate-limit';
import { hashEmail, hashIp } from '@/lib/crypto';
import { getEnv } from '@/lib/env';
import { enqueueMail } from '@/lib/mail-queue';

const PAD_BUDGET_MS = 250;

async function constantTimeBudget<T>(fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  let result: T | undefined;
  let err: unknown;
  try {
    result = await fn();
  } catch (e) {
    err = e;
  }
  const elapsed = Date.now() - start;
  const remaining = PAD_BUDGET_MS - elapsed;
  if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
  if (err) throw err;
  return result as T;
}

const requestInput = z.object({ email: z.string().email().max(254) });
const consumeInput = z.object({
  rawToken: z.string().min(20).max(100),
  newPassword: z.string().min(12).max(200),
});
const validateInput = z.object({ rawToken: z.string().min(20).max(100) });

export const passwordRouter = t.router({
  requestReset: publicProcedure.input(requestInput).mutation(async ({ input, ctx }) => {
    return constantTimeBudget(async () => {
      const ip = (ctx as any)?.req?.ip ?? '0.0.0.0';
      let rateLimited = false;
      try {
        await resetIpOnlyLimiter.consume(hashIp(ip));
        await resetRequestLimiter.consume(hashEmail(input.email));
      } catch {
        rateLimited = true;
      }

      let userExists = false;
      if (!rateLimited) {
        const r = await createPasswordResetToken(input.email);
        userExists = r.userExists;
        if (r.userExists && r.rawToken && r.expiresAt) {
          const baseUrl = getEnv().APP_URL.replace(/\/$/, '');
          await enqueueMail('send-password-reset', {
            to: input.email.toLowerCase(),
            resetUrl: `${baseUrl}/password/reset/${r.rawToken}`,
            expiresAtIso: r.expiresAt.toISOString(),
          });
        }
      }

      await recordAudit({
        action: 'auth.password.reset_requested',
        metadata: { emailHash: hashEmail(input.email), userExists, rateLimited },
      });

      return { ok: true as const };
    });
  }),

  validateToken: publicProcedure.input(validateInput).query(async ({ input }) => {
    const tok = await findResetTokenByRawToken(input.rawToken);
    return { valid: tok !== null };
  }),

  consumeReset: publicProcedure.input(consumeInput).mutation(async ({ input }) => {
    try {
      const out = await consumePasswordReset(input.rawToken, input.newPassword);
      await recordAudit({
        action: 'auth.password.reset_consumed',
        actor: { id: out.userId },
        metadata: { userId: out.userId },
      });
      await enqueueMail('send-password-reset-confirmation', {
        to: out.email,
        userDisplayName: out.displayName,
        occurredAtIso: new Date().toISOString(),
      });
      return { ok: true as const };
    } catch (err) {
      if (err instanceof Error && err.message === 'INVALID_TOKEN') {
        await recordAudit({
          action: 'auth.password.reset_invalid_attempt',
          metadata: { reason: 'not_found_or_consumed_or_expired' },
        });
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'INVALID_TOKEN' });
      }
      throw err;
    }
  }),
});
