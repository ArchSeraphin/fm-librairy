import { db } from '@/lib/db';
import { verifyPassword } from '@/lib/password';
import { hashIp, hashEmail } from '@/lib/crypto';
import { recordAudit } from '@/lib/audit-log';
import { loginLimiter } from '@/lib/rate-limit';

const CONSTANT_DELAY_MS = 150;
const LOCKOUT_THRESHOLD = 20;
const LOCKOUT_DURATION_MS = 60 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function constantTimeBudget<T>(fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  const out = await fn();
  const elapsed = Date.now() - start;
  if (elapsed < CONSTANT_DELAY_MS) await sleep(CONSTANT_DELAY_MS - elapsed);
  return out;
}

export interface AuthorizedUser {
  id: string;
  email: string;
  name: string;
}

export async function authorizeCredentials(
  creds: { email: string; password: string },
  req: { ip: string; userAgent: string },
): Promise<AuthorizedUser | null> {
  const email = creds.email.trim().toLowerCase();
  const ipH = hashIp(req.ip);
  const emailH = hashEmail(email);

  try {
    await loginLimiter.consume(`${ipH}:${emailH}`);
  } catch {
    await recordAudit({
      action: 'auth.login.locked',
      target: { type: 'EMAIL', id: emailH },
      metadata: { reason: 'rate_limited' },
      req,
    });
    return null;
  }

  return constantTimeBudget(async () => {
    const user = await db.user.findUnique({ where: { email } });

    if (!user || user.status !== 'ACTIVE') {
      await recordAudit({
        action: 'auth.login.failure',
        target: { type: 'EMAIL', id: emailH },
        metadata: { reason: user ? 'suspended' : 'unknown_email' },
        req,
      });
      return null;
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      await recordAudit({
        action: 'auth.login.locked',
        actor: { id: user.id },
        metadata: { lockedUntil: user.lockedUntil.toISOString() },
        req,
      });
      return null;
    }

    const valid = await verifyPassword(user.passwordHash, creds.password);
    if (!valid) {
      const updated = await db.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: { increment: 1 } },
        select: { failedLoginAttempts: true, lockedUntil: true },
      });
      const shouldLock = updated.failedLoginAttempts >= LOCKOUT_THRESHOLD && !updated.lockedUntil;
      if (shouldLock) {
        await db.user.update({
          where: { id: user.id },
          data: { lockedUntil: new Date(Date.now() + LOCKOUT_DURATION_MS) },
        });
      }
      await recordAudit({
        action: 'auth.login.failure',
        actor: { id: user.id },
        metadata: { reason: 'bad_password', attempts: updated.failedLoginAttempts, locked: shouldLock },
        req,
      });
      return null;
    }

    await db.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });

    return { id: user.id, email: user.email, name: user.displayName };
  });
}
