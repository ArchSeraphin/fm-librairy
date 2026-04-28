// BullMQ worker for BiblioShare cleanup jobs.
//
// Registers two hourly cron jobs against Redis:
//   - cleanup-expired-sessions  (hh:00) → purge expired or 7d-inactive sessions
//   - cleanup-expired-tokens    (hh:05) → purge expired invitations + reset tokens, audit invitations

import Redis from 'ioredis';
import pino from 'pino';
import { z } from 'zod';
import { Queue, Worker } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { cleanupExpiredSessions } from './jobs/cleanup-expired-sessions.js';
import { cleanupExpiredTokens } from './jobs/cleanup-expired-tokens.js';
import {
  handleSendInvitationNewUser,
  handleSendInvitationJoinLibrary,
} from './jobs/send-invitation.js';
import {
  handleSendPasswordReset,
  handleSendPasswordResetConfirmation,
} from './jobs/send-password-reset.js';

const parsed = z
  .object({
    REDIS_URL: z.string().url(),
    DATABASE_URL: z.string().url(),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    EMAIL_TRANSPORT: z.enum(['resend', 'smtp']).default('smtp'),
    EMAIL_FROM: z.string().min(3),
    RESEND_API_KEY: z.string().optional(),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().default(1025),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    EMAIL_LOG_SALT: z.string().min(32),
    APP_URL: z.string().url(),
    IP_HASH_SALT: z.string().min(16),
    UA_HASH_SALT: z.string().min(16),
    CRYPTO_MASTER_KEY: z.string().min(32),
  })
  .superRefine((v, ctx) => {
    if (v.EMAIL_TRANSPORT === 'resend' && !v.RESEND_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['RESEND_API_KEY'],
        message: 'required when EMAIL_TRANSPORT=resend',
      });
    }
    if (v.EMAIL_TRANSPORT === 'smtp' && !v.SMTP_HOST) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_HOST'],
        message: 'required when EMAIL_TRANSPORT=smtp',
      });
    }
  })
  .safeParse(process.env);

if (!parsed.success) {
  console.error(
    "[worker] Variables d'environnement invalides :",
    parsed.error.flatten().fieldErrors,
  );
  process.exit(1);
}

const env = parsed.data;

const logger = pino({ level: env.LOG_LEVEL, base: { service: 'biblioshare-worker' } });

// BullMQ requires { maxRetriesPerRequest: null } for the long-running blocking commands
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
redis.on('connect', () => logger.info('redis connected'));
redis.on('error', (e) => logger.error({ err: e }, 'redis error'));

const prisma = new PrismaClient();

const QUEUE_NAME = 'cleanup';

const queue = new Queue(QUEUE_NAME, { connection: redis });

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    if (job.name === 'cleanup-expired-sessions') {
      const r = await cleanupExpiredSessions(prisma);
      logger.info({ ...r }, 'cleanup-expired-sessions done');
      return r;
    }
    if (job.name === 'cleanup-expired-tokens') {
      const r = await cleanupExpiredTokens(prisma);
      logger.info({ ...r }, 'cleanup-expired-tokens done');
      return r;
    }
    logger.warn({ name: job.name }, 'unknown job');
  },
  { connection: redis },
);

worker.on('failed', (job, err) => {
  logger.error({ err, jobName: job?.name }, 'job failed');
});

const MAIL_QUEUE = 'mail';
const mailQueue = new Queue(MAIL_QUEUE, {
  connection: redis,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { count: 1000, age: 24 * 3600 },
    removeOnFail: { count: 5000 },
  },
});

const mailWorker = new Worker(
  MAIL_QUEUE,
  async (job) => {
    switch (job.name) {
      case 'send-invitation-new-user':
        return handleSendInvitationNewUser(job, logger);
      case 'send-invitation-join-library':
        return handleSendInvitationJoinLibrary(job, logger);
      case 'send-password-reset':
        return handleSendPasswordReset(job, logger);
      case 'send-password-reset-confirmation':
        return handleSendPasswordResetConfirmation(job, logger);
      default:
        logger.warn({ name: job.name }, 'unknown mail job');
    }
  },
  { connection: redis, concurrency: 4 },
);

mailWorker.on('failed', (job, err) => {
  if (job?.attemptsMade && job.opts.attempts && job.attemptsMade >= job.opts.attempts) {
    logger.error(
      { err, jobName: job.name, jobId: job.id, attempts: job.attemptsMade },
      'email.failed_permanent',
    );
  } else {
    logger.warn({ err, jobName: job?.name, jobId: job?.id }, 'mail job retrying');
  }
});

async function scheduleCleanup(): Promise<void> {
  await queue.upsertJobScheduler(
    'cleanup-sessions-hourly',
    { pattern: '0 * * * *' },
    { name: 'cleanup-expired-sessions', data: {} },
  );
  await queue.upsertJobScheduler(
    'cleanup-tokens-hourly',
    { pattern: '5 * * * *' },
    { name: 'cleanup-expired-tokens', data: {} },
  );
  logger.info('cleanup schedulers registered (hh:00 sessions, hh:05 tokens)');
}

void scheduleCleanup();

logger.info('worker started');

const HEARTBEAT_MS = 60_000;
setInterval(() => {
  logger.debug('heartbeat');
}, HEARTBEAT_MS);

const shutdown = async (): Promise<void> => {
  logger.info('shutting down');
  await worker.close();
  await mailWorker.close();
  await queue.close();
  await mailQueue.close();
  await prisma.$disconnect();
  await redis.quit();
  process.exit(0);
};
process.on('SIGTERM', () => {
  void shutdown();
});
process.on('SIGINT', () => {
  void shutdown();
});
