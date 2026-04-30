import { NextResponse } from 'next/server';
import { headers } from 'next/headers';

import { auth, signOut } from '@/server/auth';
import { recordAudit } from '@/lib/audit-log';
import { purgeAllUserSessionsAndJwts } from '@/lib/user-admin';

export async function POST(req: Request) {
  const session = await auth();
  const userId = session ? (session as { userId?: string }).userId : null;

  if (userId) {
    // Purge all Session rows AND set the JWT-revocation watermark so that
    // leftover JWT cookies on other devices cannot resurrect a session via
    // session-bridge's find-or-create. The current device's cookie is cleared
    // below by signOut().
    await purgeAllUserSessionsAndJwts(userId);
    const h = await headers();
    const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined;
    const userAgent = h.get('user-agent') ?? undefined;
    await recordAudit({
      action: 'auth.session.revoked',
      actor: { id: userId },
      req: { ip, userAgent },
      metadata: { reason: 'user_logout' },
    });
  }

  await signOut({ redirect: false });
  return NextResponse.redirect(new URL('/login', req.url), { status: 303 });
}
