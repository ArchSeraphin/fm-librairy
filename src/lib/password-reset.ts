import { Prisma, type PasswordResetToken } from '@prisma/client';
import { db } from './db';
import { generateRawToken, hashToken, verifyToken } from './tokens';
import { hashPassword } from './password';

const RESET_TTL_MS = 60 * 60 * 1000;

export interface RequestResetResult {
  userExists: boolean;
  rawToken?: string;
  expiresAt?: Date;
}

export async function createPasswordResetToken(email: string): Promise<RequestResetResult> {
  const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) return { userExists: false };
  const rawToken = generateRawToken();
  const tokenHash = await hashToken(rawToken);
  const expiresAt = new Date(Date.now() + RESET_TTL_MS);
  await db.passwordResetToken.create({
    data: { userId: user.id, tokenHash, expiresAt },
  });
  return { userExists: true, rawToken, expiresAt };
}

export async function findResetTokenByRawToken(
  rawToken: string,
): Promise<PasswordResetToken | null> {
  const candidates = await db.passwordResetToken.findMany({
    where: { consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  for (const t of candidates) {
    if (await verifyToken(rawToken, t.tokenHash)) return t;
  }
  return null;
}

export interface ConsumeResetResult {
  userId: string;
  email: string;
  displayName: string;
}

export async function consumePasswordReset(
  rawToken: string,
  newPassword: string,
): Promise<ConsumeResetResult> {
  const tok = await findResetTokenByRawToken(rawToken);
  if (!tok) throw new Error('INVALID_TOKEN');
  const passwordHash = await hashPassword(newPassword);

  return db.$transaction(
    async (tx) => {
      const updated = await tx.passwordResetToken.updateMany({
        where: { id: tok.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      if (updated.count === 0) throw new Error('INVALID_TOKEN');
      const user = await tx.user.update({
        where: { id: tok.userId },
        data: {
          passwordHash,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });
      // invalide TOUTES les sessions actives du user (force re-login partout)
      await tx.session.deleteMany({ where: { userId: user.id } });
      // drain les autres reset tokens pending pour ce user
      await tx.passwordResetToken.deleteMany({
        where: { userId: user.id, consumedAt: null },
      });
      return {
        userId: user.id,
        email: user.email,
        displayName: user.displayName,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
