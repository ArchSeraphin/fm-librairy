import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/server/auth';
import { db } from '@/lib/db';
import { SEVEN_DAYS_MS } from '@/lib/permissions';

// '/' is matched only via the `path === p` clause of startsWithAny; it does
// not act as a catch-all because `path.startsWith('//')` is false for any
// normal path. Keeps the landing page public (Phase 0 placeholder, future
// marketing surface) while still guarding everything else.
const PUBLIC_PATHS = [
  '/',
  '/login',
  '/api/auth',
  // Healthcheck endpoint — intentionally unauthenticated, called by orchestrators.
  '/api/health',
  '/_next',
  '/favicon.ico',
  '/fonts',
  '/invitations',
  '/password',
];

const PENDING_ALLOWED = [
  '/login/2fa',
  '/login/2fa/backup',
  '/api/auth',
  '/api/trpc/auth.verify2FA',
  '/api/trpc/auth.verifyBackupCode',
];

const ADMIN_2FA_ALLOWED = [
  '/2fa/setup',
  '/2fa/setup/recovery-codes',
  '/api/auth',
  '/api/trpc/auth.enroll2FA',
  '/api/trpc/auth.confirm2FA',
  '/logout',
];

function startsWithAny(path: string, list: string[]): boolean {
  return list.some((p) => path === p || path.startsWith(p + '/') || path.startsWith(p + '?'));
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  if (startsWithAny(path, PUBLIC_PATHS)) return NextResponse.next();

  const session = await auth();
  if (!session) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  const userId = (session as { userId?: string }).userId;
  const pending2fa = (session as { pending2fa?: boolean }).pending2fa;

  if (pending2fa && !startsWithAny(path, PENDING_ALLOWED)) {
    return NextResponse.redirect(new URL('/login/2fa', req.url));
  }

  if (userId && !pending2fa) {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { role: true, twoFactorEnabled: true, createdAt: true },
    });
    if (
      user?.role === 'GLOBAL_ADMIN' &&
      !user.twoFactorEnabled &&
      Date.now() - user.createdAt.getTime() > SEVEN_DAYS_MS &&
      !startsWithAny(path, ADMIN_2FA_ALLOWED)
    ) {
      return NextResponse.redirect(new URL('/2fa/setup', req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  runtime: 'nodejs',
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
