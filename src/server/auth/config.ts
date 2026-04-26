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
    async jwt({ token, user }) {
      if (user?.id) {
        token.uid = user.id;
        token.pending2fa = await needsTwoFactor(user.id);
      }
      return token;
    },
    async session({ session, token }) {
      if (token.uid) (session as { userId?: string }).userId = token.uid as string;
      (session as { pending2fa?: boolean }).pending2fa = !!token.pending2fa;
      return session;
    },
  },
};

async function needsTwoFactor(userId: string): Promise<boolean> {
  const { db } = await import('@/lib/db');
  const u = await db.user.findUnique({ where: { id: userId }, select: { twoFactorEnabled: true } });
  return !!u?.twoFactorEnabled;
}
