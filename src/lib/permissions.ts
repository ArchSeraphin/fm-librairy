import type { User } from '@prisma/client';
import { recordAudit } from './audit-log';

export const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;

export class PermissionError extends Error {
  constructor(public readonly perm: string) {
    super(`permission denied: ${perm}`);
    this.name = 'PermissionError';
  }
}

export function assertIsGlobalAdmin(actor: Pick<User, 'id' | 'role'>): asserts actor is User & { role: 'GLOBAL_ADMIN' } {
  if (actor.role !== 'GLOBAL_ADMIN') {
    void recordAudit({
      action: 'permission.denied',
      actor: { id: actor.id },
      metadata: { required: 'GLOBAL_ADMIN' },
    });
    throw new PermissionError('global_admin_required');
  }
}

export async function assertGlobalAdmin2faTimerOk(
  actor: Pick<User, 'id' | 'role' | 'twoFactorEnabled' | 'createdAt'>,
): Promise<void> {
  if (actor.role !== 'GLOBAL_ADMIN') return;
  if (actor.twoFactorEnabled) return;
  const elapsed = Date.now() - actor.createdAt.getTime();
  if (elapsed <= SEVEN_DAYS_MS) return;
  await recordAudit({
    action: 'permission.denied',
    actor: { id: actor.id },
    metadata: { reason: 'global_admin_2fa_overdue' },
  });
  throw new PermissionError('global_admin_2fa_overdue');
}
