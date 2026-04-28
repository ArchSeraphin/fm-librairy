import type { Job } from 'bullmq';
import type { Logger } from 'pino';
import { sendEmail, renderEmail } from '../lib/email.js';
import InvitationNewUser from '../emails/invitation-new-user.js';
import InvitationJoinLibrary from '../emails/invitation-join-library.js';

export async function handleSendInvitationNewUser(job: Job, logger: Logger): Promise<void> {
  const { to, inviterName, libraryName, signupUrl, expiresAtIso } = job.data as {
    to: string;
    inviterName: string;
    libraryName?: string | null;
    signupUrl: string;
    expiresAtIso: string;
  };
  const expiresAt = new Date(expiresAtIso);
  const { html, text } = await renderEmail(InvitationNewUser, {
    inviterName,
    libraryName: libraryName ?? null,
    signupUrl,
    expiresAt,
  });
  await sendEmail({
    to,
    subject: libraryName
      ? `Vous êtes invité·e à rejoindre ${libraryName}`
      : 'Vous êtes invité·e sur BiblioShare',
    html,
    text,
  });
  logger.info({ jobId: job.id }, 'invitation new user sent');
}

export async function handleSendInvitationJoinLibrary(job: Job, logger: Logger): Promise<void> {
  const { to, inviterName, libraryName, userDisplayName, joinUrl, expiresAtIso } = job.data as {
    to: string;
    inviterName: string;
    libraryName: string;
    userDisplayName: string;
    joinUrl: string;
    expiresAtIso: string;
  };
  const { html, text } = await renderEmail(InvitationJoinLibrary, {
    inviterName,
    libraryName,
    userDisplayName,
    joinUrl,
    expiresAt: new Date(expiresAtIso),
  });
  await sendEmail({
    to,
    subject: `${inviterName} vous invite à rejoindre ${libraryName}`,
    html,
    text,
  });
  logger.info({ jobId: job.id }, 'invitation join sent');
}
