import Redis from 'ioredis';
import { getEnv } from './env';

const globalForRedis = globalThis as unknown as { redis: Redis | undefined };

export function getRedis(): Redis {
  if (globalForRedis.redis) return globalForRedis.redis;
  const env = getEnv();
  const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  });
  if (process.env.NODE_ENV !== 'production') globalForRedis.redis = redis;
  return redis;
}
