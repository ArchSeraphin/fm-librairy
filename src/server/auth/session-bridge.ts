import { headers } from 'next/headers';
import { auth } from '.';
import { db } from '@/lib/db';
import { createSessionAdapter } from './adapter';
import { hashIp, hashUa } from '@/lib/crypto';
import type { Session, User } from '@prisma/client';

export async function getCurrentSessionAndUser(): Promise<{ session: Session; user: User } | null> {
  const jwt = await auth();
  if (!jwt) return null;
  const userId = (jwt as { userId?: string }).userId;
  if (!userId) return null;

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || user.status !== 'ACTIVE') return null;

  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '0.0.0.0';
  const ua = h.get('user-agent') ?? '';

  // Find-or-create wrapped in a SERIALIZABLE transaction. Without this, two
  // concurrent requests for the same user with no existing valid session both
  // see null from findFirst (READ COMMITTED lets phantom reads through) and both
  // INSERT, producing redundant rows. SERIALIZABLE forces one transaction to
  // retry after the other commits, so only 1 session is created. (gap #5)
  let session!: Session;
  let retries = 3;
  while (retries-- > 0) {
    try {
      session = await db.$transaction(
        async (tx) => {
          const existing = await tx.session.findFirst({
            where: { userId, expiresAt: { gt: new Date() } },
            orderBy: { lastActivityAt: 'desc' },
          });
          if (existing) return existing;
          const txAdapter = createSessionAdapter(tx as unknown as typeof db);
          return txAdapter.createSession({
            userId,
            ipHash: hashIp(ip),
            userAgentHash: hashUa(ua),
            pending2fa: !!user.twoFactorEnabled,
          });
        },
        { isolationLevel: 'Serializable' },
      );
      break;
    } catch (err) {
      // Postgres error 40001 = serialization failure; retry up to 3 times.
      if (retries > 0 && err instanceof Error && (err as { code?: string }).code === 'P2034') {
        continue;
      }
      throw err;
    }
  }

  // Touch (debounced) outside the transaction to keep the lock window short.
  // If the transaction just created the session it's already fresh; if it
  // found an existing one, this updates lastActivityAt via the debounce.
  const adapter = createSessionAdapter(db);
  await adapter.getSession(session.sessionToken);

  return { session, user };
}
