import { db } from './db';
import { hashIp } from './crypto';
import { getLogger } from './logger';

export type AuditAction =
  // 1A
  | 'auth.login.success'
  | 'auth.login.failure'
  | 'auth.login.locked'
  | 'auth.session.created'
  | 'auth.session.revoked'
  | 'auth.session.expired'
  | 'auth.2fa.enrolled'
  | 'auth.2fa.disabled'
  | 'auth.2fa.success'
  | 'auth.2fa.failure'
  | 'auth.2fa.backup_code_used'
  | 'auth.2fa.recovery_codes_regenerated'
  | 'permission.denied'
  // 1B (declared early to avoid migrating the union later)
  | 'auth.password.reset_requested'
  | 'auth.password.reset_consumed'
  | 'auth.password.changed'
  | 'auth.invitation.created'
  | 'auth.invitation.consumed'
  | 'auth.invitation.expired'
  | 'auth.invitation.revoked'
  // 1C
  | 'admin.user.suspended'
  | 'admin.user.reactivated'
  | 'admin.user.deleted'
  | 'admin.user.role_changed';

export type AuditTargetType =
  | 'USER'
  | 'LIBRARY'
  | 'INVITATION'
  | 'SESSION'
  | 'EMAIL'
  | 'AUTH';

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordHash',
  'token',
  'tokenHash',
  'secret',
  'secretCipher',
  'authorization',
  'cookie',
  'sessionToken',
]);

function redact(input: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!input) return input;
  return redactDepth(input, 2) as Record<string, unknown>;
}

function redactDepth(value: unknown, depth: number): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (depth <= 0) return value;
  if (Array.isArray(value)) return value.map((v) => redactDepth(v, depth - 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEYS.has(k) ? '[REDACTED]' : redactDepth(v, depth - 1);
  }
  return out;
}

const BLOCKING_ACTIONS = new Set<AuditAction>(['permission.denied', 'auth.2fa.failure']);

export async function recordAudit(input: {
  action: AuditAction;
  actor?: { id: string };
  target?: { type: AuditTargetType; id: string };
  metadata?: Record<string, unknown>;
  req?: { ip?: string; userAgent?: string };
}): Promise<void> {
  const log = getLogger();
  const data = {
    action: input.action,
    actorId: input.actor?.id ?? null,
    targetType: input.target?.type ?? null,
    targetId: input.target?.id ?? null,
    metadata: redact(input.metadata) as object | undefined,
    ipHash: input.req?.ip ? hashIp(input.req.ip) : null,
    // AuditLog stores raw UA (forensics value > anonymisation value for admin audit trail).
    // Session stores userAgentHash for fingerprint continuity without long-lived raw UA retention.
    userAgent: input.req?.userAgent ?? null,
  };

  if (BLOCKING_ACTIONS.has(input.action)) {
    await db.auditLog.create({ data });
    return;
  }

  try {
    await db.auditLog.create({ data });
  } catch (err) {
    log.error({ err, action: input.action }, 'audit log write failed (non-blocking)');
  }
}
