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
      }
      // After verify2FA / verifyBackupCode, the client calls update() to
      // refresh the JWT so middleware stops redirecting to /login/2fa.
      // Re-read the user's most recent DB session to decide if 2FA is still
      // pending for this browser.
      if (trigger === 'update' && typeof token.uid === 'string') {
        token.pending2fa = await isStillPending(token.uid);
      }
      return token;
    },
    async session({ session, token }) {
      if (token.uid) {
        (session as { userId?: string }).userId = token.uid as string;
        (session as { pending2fa?: boolean }).pending2fa = !!token.pending2fa;
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
