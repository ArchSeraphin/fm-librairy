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

const parsed = z
  .object({
    REDIS_URL: z.string().url(),
    DATABASE_URL: z.string().url(),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
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
  await queue.close();
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
