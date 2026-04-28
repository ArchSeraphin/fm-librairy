import { beforeEach, describe, expect, it } from 'vitest';
import { recordAuditFromFailedJob } from '../../worker/jobs/dlq';
import { getTestPrisma, truncateAll } from './setup/prisma';

const prisma = getTestPrisma();

describe('worker DLQ listener', () => {
  beforeEach(truncateAll);

  it('records audit on send-invitation final failure', async () => {
    const user = await prisma.user.create({
      data: { email: 'dlq@e2e.test', passwordHash: 'x', displayName: 'DLQ' },
    });
    await recordAuditFromFailedJob(prisma, {
      jobName: 'send-invitation',
      jobId: 'job-123',
      attemptsMade: 5,
      maxAttempts: 5,
      error: new Error('SMTP refused'),
      data: { userId: user.id, invitationId: 'inv-1' },
    });
    const log = await prisma.auditLog.findFirst({
      where: { action: 'auth.invitation.send_failed' },
    });
    expect(log).toBeTruthy();
    expect(log?.actorId).toBe(user.id);
    expect(log?.metadata).toMatchObject({ jobId: 'job-123', attempts: 5 });
  });

  it('records audit on send-password-reset final failure', async () => {
    const user = await prisma.user.create({
      data: { email: 'dlq2@e2e.test', passwordHash: 'x', displayName: 'DLQ2' },
    });
    await recordAuditFromFailedJob(prisma, {
      jobName: 'send-password-reset',
      jobId: 'job-456',
      attemptsMade: 5,
      maxAttempts: 5,
      error: new Error('Resend down'),
      data: { userId: user.id },
    });
    const log = await prisma.auditLog.findFirst({
      where: { action: 'auth.password.reset_send_failed' },
    });
    expect(log).toBeTruthy();
  });

  it('does not record on intermediate failure (attemptsMade < maxAttempts)', async () => {
    await recordAuditFromFailedJob(prisma, {
      jobName: 'send-invitation',
      jobId: 'job-789',
      attemptsMade: 3,
      maxAttempts: 5,
      error: new Error('transient'),
      data: { userId: 'u1' },
    });
    const log = await prisma.auditLog.findFirst({
      where: { action: 'auth.invitation.send_failed' },
    });
    expect(log).toBeNull();
  });
});
