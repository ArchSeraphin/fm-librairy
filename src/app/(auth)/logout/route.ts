import { NextResponse } from 'next/server';
import { headers } from 'next/headers';

import { auth, signOut } from '@/server/auth';
import { db } from '@/lib/db';
import { recordAudit } from '@/lib/audit-log';

export async function POST(req: Request) {
  const session = await auth();
  const userId = session ? (session as { userId?: string }).userId : null;

  if (userId) {
    await db.session.deleteMany({ where: { userId } });
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
