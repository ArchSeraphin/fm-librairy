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

  // Cherche une session DB existante pour ce user, sinon en crée une
  const adapter = createSessionAdapter(db);
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '0.0.0.0';
  const ua = h.get('user-agent') ?? '';
  let session = await db.session.findFirst({
    where: { userId, expiresAt: { gt: new Date() } },
    orderBy: { lastActivityAt: 'desc' },
  });
  if (!session) {
    session = await adapter.createSession({
      userId,
      ipHash: hashIp(ip),
      userAgentHash: hashUa(ua),
      pending2fa: !!user.twoFactorEnabled,
    });
  } else {
    // Touch (debounced dans l'adapter via getSession)
    await adapter.getSession(session.sessionToken);
  }
  return { session, user };
}
