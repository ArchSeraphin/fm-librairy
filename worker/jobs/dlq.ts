import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';

// Map BullMQ job names to audit action strings.
// These must stay in sync with the AuditAction union in src/lib/audit-log.ts.
// The worker writes directly to auditLog because it lives in a separate
// package and cannot import the frontend's `recordAudit` helper (@/ path
// mapping is not available here).
const DLQ_ACTION_BY_JOB: Record<string, string> = {
  'send-invitation-new-user': 'auth.invitation.send_failed',
  'send-invitation-join-library': 'auth.invitation.send_failed',
  'send-password-reset': 'auth.password.reset_send_failed',
  'send-password-reset-confirmation': 'auth.password.reset_confirmation_send_failed',
};

export async function recordAuditFromFailedJob(
  prisma: PrismaClient,
  input: {
    jobName: string;
    jobId: string | undefined;
    attemptsMade: number;
    maxAttempts: number;
    error: Error;
    data: Record<string, unknown>;
  },
  logger?: Logger,
): Promise<void> {
  if (input.attemptsMade < input.maxAttempts) return;

  const action = DLQ_ACTION_BY_JOB[input.jobName];
  if (!action) {
    logger?.warn({ jobName: input.jobName }, 'no DLQ audit action mapped');
    return;
  }

  const userId = typeof input.data.userId === 'string' ? input.data.userId : null;

  await prisma.auditLog.create({
    data: {
      action,
      actorId: userId,
      metadata: {
        jobId: input.jobId,
        attempts: input.attemptsMade,
        error: input.error.message.slice(0, 200),
      } as object,
    },
  });
}
