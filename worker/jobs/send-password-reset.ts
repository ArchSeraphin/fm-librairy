import type { Job } from 'bullmq';
import type { Logger } from 'pino';
import { sendEmail, renderEmail } from '../lib/email.js';
import PasswordReset from '../emails/password-reset.js';
import PasswordResetConfirmation from '../emails/password-reset-confirmation.js';

export async function handleSendPasswordReset(job: Job, logger: Logger): Promise<void> {
  const { to, resetUrl, expiresAtIso } = job.data as {
    to: string;
    resetUrl: string;
    expiresAtIso: string;
  };
  const { html, text } = await renderEmail(PasswordReset, {
    resetUrl,
    expiresAt: new Date(expiresAtIso),
  });
  await sendEmail({
    to,
    subject: 'Réinitialisation de votre mot de passe',
    html,
    text,
  });
  logger.info({ jobId: job.id }, 'password reset sent');
}

export async function handleSendPasswordResetConfirmation(
  job: Job,
  logger: Logger,
): Promise<void> {
  const { to, userDisplayName, occurredAtIso } = job.data as {
    to: string;
    userDisplayName: string;
    occurredAtIso: string;
  };
  const { html, text } = await renderEmail(PasswordResetConfirmation, {
    userDisplayName,
    occurredAt: new Date(occurredAtIso),
  });
  await sendEmail({
    to,
    subject: 'Votre mot de passe a été modifié',
    html,
    text,
  });
  logger.info({ jobId: job.id }, 'password reset confirmation sent');
}
