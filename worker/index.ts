import Redis from 'ioredis';
import pino from 'pino';
import { z } from 'zod';

// Validation de l'environnement (REDIS_URL obligatoire, LOG_LEVEL optionnel)
const env = z
  .object({
    REDIS_URL: z.string().url(),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  })
  .parse(process.env);

const logger = pino({ level: env.LOG_LEVEL, base: { service: 'biblioshare-worker' } });

// Connexion Redis (pas de limite de retries pour rester résilient)
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

redis.on('connect', () => logger.info('redis connected'));
redis.on('error', (e) => logger.error({ err: e }, 'redis error'));

logger.info('worker started, idle (no queues registered yet)');

// Heartbeat de débogage toutes les 60 secondes
const HEARTBEAT_MS = 60_000;
setInterval(() => {
  logger.debug('heartbeat');
}, HEARTBEAT_MS);

// Arrêt propre sur SIGTERM / SIGINT
const shutdown = async () => {
  logger.info('shutting down');
  await redis.quit();
  process.exit(0);
};
// Wrapper void car process.on attend () => void et shutdown renvoie une Promise
process.on('SIGTERM', () => {
  void shutdown();
});
process.on('SIGINT', () => {
  void shutdown();
});
