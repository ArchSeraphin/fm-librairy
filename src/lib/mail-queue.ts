import { Queue } from 'bullmq';
import { getRedis } from './redis';

export type MailJobName =
  | 'send-invitation-new-user'
  | 'send-invitation-join-library'
  | 'send-password-reset'
  | 'send-password-reset-confirmation';

export interface InvitationNewUserJob {
  to: string;
  inviterName: string;
  libraryName?: string | null;
  signupUrl: string;
  expiresAtIso: string;
}
export interface InvitationJoinLibraryJob {
  to: string;
  inviterName: string;
  libraryName: string;
  userDisplayName: string;
  joinUrl: string;
  expiresAtIso: string;
}
export interface PasswordResetJob {
  to: string;
  resetUrl: string;
  expiresAtIso: string;
}
export interface PasswordResetConfirmationJob {
  to: string;
  userDisplayName: string;
  occurredAtIso: string;
}
// 1C: producer in scope of `userId` (account.security.changePassword) — worker
// resolves email/displayName itself. `triggerSource` lets the worker (or future
// audit) distinguish reset-flow vs self-change without a payload-shape sniff.
export interface PasswordResetConfirmationByUserIdJob {
  userId: string;
  triggerSource?: 'reset' | 'self_change';
}

export type MailJobMap = {
  'send-invitation-new-user': InvitationNewUserJob;
  'send-invitation-join-library': InvitationJoinLibraryJob;
  'send-password-reset': PasswordResetJob;
  'send-password-reset-confirmation':
    | PasswordResetConfirmationJob
    | PasswordResetConfirmationByUserIdJob;
};

// Backward-compat alias — prefer `MailJobMap[N]` for new code.
export type MailJobData = MailJobMap[keyof MailJobMap];

const QUEUE_NAME = 'mail';

let queue: Queue | null = null;

export function getMailQueue(): Queue {
  if (queue) return queue;
  queue = new Queue(QUEUE_NAME, {
    connection: getRedis(),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: { count: 1000, age: 24 * 3600 },
      removeOnFail: { count: 5000 },
    },
  });
  return queue;
}

export async function enqueueMail<N extends keyof MailJobMap>(
  name: N,
  data: MailJobMap[N],
): Promise<void> {
  await getMailQueue().add(name, data);
}

export async function enqueuePasswordResetConfirmation(
  data: PasswordResetConfirmationByUserIdJob,
): Promise<void> {
  await getMailQueue().add('send-password-reset-confirmation', data);
}

export function __resetMailQueueForTest(): void {
  queue = null;
}
