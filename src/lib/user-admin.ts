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

export async function revokeAllSessionsForUser(
  userId: string,
  exceptSessionId?: string,
): Promise<number> {
  const where = exceptSessionId ? { userId, NOT: { id: exceptSessionId } } : { userId };
  const result = await db.session.deleteMany({ where });
  return result.count;
}
