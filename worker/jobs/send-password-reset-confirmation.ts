/**
 * `{ userId }`-based handler. Used by Phase 1C account self-service
 * (Task 14/15) when the user has just changed their own password — the producer
 * has the userId in scope and does not need to pre-resolve display data.
 *
 * The Phase 1B reset flow still uses `handleSendPasswordResetConfirmation` in
 * `send-password-reset.ts` (different payload shape `{ to, userDisplayName, occurredAtIso }`).
 */
import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import pino from 'pino';
import { renderEmail, sendEmail } from '../lib/email.js';
import PasswordResetConfirmation from '../emails/password-reset-confirmation.js';

export interface SendPasswordResetConfirmationJob {
  userId: string;
  // 1C: producer-side discriminator. The worker accepts either `'reset'`
  // (Phase 1B reset flow, future migration) or `'self_change'`
  // (account.security.changePassword). Currently does not affect the rendered
  // email — audit/metadata is captured by the producer, not the worker.
  triggerSource?: 'reset' | 'self_change';
}

function getWorkerLogger() {
  return pino({ level: process.env.LOG_LEVEL ?? 'info', base: { service: 'biblioshare-worker' } });
}

export async function sendPasswordResetConfirmation(
  prisma: PrismaClient,
  data: SendPasswordResetConfirmationJob,
  logger?: Logger,
): Promise<void> {
  const log = logger ?? getWorkerLogger();

  const user = await prisma.user.findUnique({
    where: { id: data.userId },
    select: { id: true, email: true, displayName: true },
  });
  if (!user) throw new Error(`User ${data.userId} not found`);

  const occurredAt = new Date();
  const { html, text } = await renderEmail(PasswordResetConfirmation, {
    userDisplayName: user.displayName,
    occurredAt,
  });

  await sendEmail(
    {
      to: user.email,
      subject: 'Votre mot de passe a été modifié',
      html,
      text,
    },
    log,
  );
}
