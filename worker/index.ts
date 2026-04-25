// Worker BullMQ minimal : se connecte à Redis et reste idle (aucune queue
// enregistrée pour le moment). Sert de squelette validé pour Task 18.
//
// TODO(task-18): ajouter un .eslintrc minimal au worker quand le premier
// job BullMQ sera implémenté. Aujourd'hui le worker n'est validé que par
// `tsc --strict` ; suffisant pour 41 lignes mais insuffisant à l'échelle.

import Redis from 'ioredis';
import pino from 'pino';
import { z } from 'zod';

// Validation de l'environnement (REDIS_URL obligatoire, LOG_LEVEL optionnel).
// Mirror du pattern src/lib/env.ts : safeParse + log structuré + fail-fast.
// On utilise console.error car pino n'est pas encore initialisé à ce stade
// (son level est lu depuis env.LOG_LEVEL).
const parsed = z
  .object({
    REDIS_URL: z.string().url(),
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
