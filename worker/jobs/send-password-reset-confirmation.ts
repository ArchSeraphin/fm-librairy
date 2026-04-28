import { db } from '../../src/lib/db.js';
import { renderEmail, sendEmail } from '../lib/email.js';
import PasswordResetConfirmation from '../emails/password-reset-confirmation.js';
import pino from 'pino';

export interface SendPasswordResetConfirmationJob {
  userId: string;
  triggerSource?: 'reset' | 'self_change';
}

function getWorkerLogger() {
  return pino({ level: process.env.LOG_LEVEL ?? 'info', base: { service: 'biblioshare-worker' } });
}

export async function sendPasswordResetConfirmation(
  data: SendPasswordResetConfirmationJob,
): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: data.userId },
    select: { id: true, email: true, displayName: true },
  });
  if (!user) throw new Error(`User ${data.userId} not found`);

  const occurredAt = new Date();
  const { html, text } = await renderEmail(PasswordResetConfirmation, {
    userDisplayName: user.displayName,
    occurredAt,
  });

  const logger = getWorkerLogger();
  await sendEmail(
    {
      to: user.email,
      subject: 'Votre mot de passe a été modifié',
      html,
      text,
    },
    logger,
  );
}
