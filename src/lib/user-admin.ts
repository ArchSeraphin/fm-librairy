import { TRPCError } from '@trpc/server';
import { db } from './db';

export async function assertNotLastGlobalAdmin(
  userId: string,
  reason: 'remove' | 'demote' | 'suspend',
): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, status: true },
  });
  if (!user) return;
  if (user.role !== 'GLOBAL_ADMIN') return;
  // If the target is already SUSPENDED and reason isn't 'remove', no need to check
  // (a suspended admin doesn't count as "last active" since they're not active).
  if (user.status !== 'ACTIVE' && reason !== 'remove') return;
  const otherActive = await db.user.count({
    where: { role: 'GLOBAL_ADMIN', status: 'ACTIVE', NOT: { id: userId } },
  });
  if (otherActive === 0) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: `cannot ${reason} the last active global admin`,
    });
  }
}

// exceptSessionId is Session.id (cuid), not sessionToken.
//
// This is the "row-only" purge. It does NOT touch User.revokedSessionsAt, so
// any JWT cookie still in the wild can resurrect a Session via session-bridge's
// find-or-create path. Self-flows that need to keep the caller logged in
// (changePassword, revokeAllOtherSessions, startReEnrollWithBackup) use this
// helper because setting the watermark would invalidate the caller's own JWT
// (its `iat` is older than `new Date()`); fixing that requires re-issuing the
// JWT, which NextAuth doesn't expose cleanly here.
//
// For flows where the target should be killed everywhere (admin-on-other-user
// or self-logout), use `purgeAllUserSessionsAndJwts` instead.
export async function revokeAllSessionsForUser(
  userId: string,
  exceptSessionId?: string,
): Promise<number> {
  const where = exceptSessionId ? { userId, NOT: { id: exceptSessionId } } : { userId };
  const result = await db.session.deleteMany({ where });
  return result.count;
}

// Atomic full purge: sets `User.revokedSessionsAt = now` AND deletes every
// Session row for the user. The watermark causes session-bridge to reject any
// JWT cookie issued before this timestamp (see src/server/auth/session-bridge.ts)
// — without it, deleting Session rows is insufficient because the bridge would
// resurrect them on the next request from a leftover JWT cookie.
//
// Use for admin-driven flows targeting another user (suspend, 2FA reset) or
// for self-logout where the caller's own JWT cookie is being cleared anyway.
// Do NOT use for self-flows that intend to keep the caller logged in — see
// `revokeAllSessionsForUser`.
export async function purgeAllUserSessionsAndJwts(userId: string): Promise<number> {
  return db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { revokedSessionsAt: new Date() },
    });
    const result = await tx.session.deleteMany({ where: { userId } });
    return result.count;
  });
}
