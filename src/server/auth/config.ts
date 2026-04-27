import type { NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { authorizeCredentials } from './credentials-provider';
import { getEnv } from '@/lib/env';

export const authConfig: NextAuthConfig = {
  trustHost: true,
  secret: getEnv().SESSION_SECRET,
  session: { strategy: 'jwt' },
  pages: { signIn: '/login', error: '/login' },
  providers: [
    Credentials({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      authorize: async (raw, request) => {
        const email = String(raw?.email ?? '');
        const password = String(raw?.password ?? '');
        if (!email || !password) return null;
        const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '0.0.0.0';
        const userAgent = request.headers.get('user-agent') ?? '';
        const user = await authorizeCredentials({ email, password }, { ip, userAgent });
        return user;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user?.id) {
        token.uid = user.id;
        token.pending2fa = await needsTwoFactor(user.id);
        token.sid = undefined;
      }
      // After verify2FA / verifyBackupCode, the client calls update() to refresh
      // the JWT. Re-query the user's most recent DB session and use ITS id +
      // pending2fa flag. This way each JWT is anchored to a specific session,
      // and a verified device A cannot inadvertently mark device B as verified.
      //
      // Note: we use findFirst (most-recent) rather than isStillPendingForSession
      // because upgradePendingSession deletes the old session and creates a new one,
      // so any token.sid stored before upgrade would be stale. Re-anchoring on every
      // update() call is the simplest correct behaviour.
      if (trigger === 'update' && typeof token.uid === 'string') {
        const { db } = await import('@/lib/db');
        const s = await db.session.findFirst({
          where: { userId: token.uid, expiresAt: { gt: new Date() } },
          orderBy: { lastActivityAt: 'desc' },
          select: { id: true, pending2fa: true },
        });
        token.sid = s?.id;
        token.pending2fa = s ? s.pending2fa : await isStillPending(token.uid);
      }
      return token;
    },
    async session({ session, token }) {
      if (token.uid) {
        (session as { userId?: string }).userId = token.uid as string;
        (session as { pending2fa?: boolean }).pending2fa = !!token.pending2fa;
        (session as { sid?: string }).sid = (token.sid as string) ?? undefined;
      }
      return session;
    },
  },
};

async function needsTwoFactor(userId: string): Promise<boolean> {
  const { db } = await import('@/lib/db');
  const u = await db.user.findUnique({ where: { id: userId }, select: { twoFactorEnabled: true } });
  return !!u?.twoFactorEnabled;
}

// Fallback used by the JWT update callback if no DB session exists yet for the user.
async function isStillPending(userId: string): Promise<boolean> {
  const { db } = await import('@/lib/db');
  const u = await db.user.findUnique({
    where: { id: userId },
    select: { twoFactorEnabled: true },
  });
  if (!u?.twoFactorEnabled) return false;
  const session = await db.session.findFirst({
    where: { userId, expiresAt: { gt: new Date() } },
    orderBy: { lastActivityAt: 'desc' },
    select: { pending2fa: true },
  });
  return session?.pending2fa ?? true;
}

// Exported helper for direct session-id-based pending2fa queries (gap #7bis).
// Returns true (safe-side) when the session is missing or belongs to another user.
export async function isStillPendingForSession(
  userId: string,
  sessionId: string,
): Promise<boolean> {
  const { db } = await import('@/lib/db');
  const u = await db.user.findUnique({
    where: { id: userId },
    select: { twoFactorEnabled: true },
  });
  if (!u?.twoFactorEnabled) return false;
  const session = await db.session.findUnique({
    where: { id: sessionId },
    select: { pending2fa: true, userId: true },
  });
  if (!session || session.userId !== userId) return true;
  return session.pending2fa;
}
