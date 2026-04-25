import Redis from 'ioredis';
import { getEnv } from './env';

const globalForRedis = globalThis as unknown as { redis: Redis | undefined };

export const redis =
  globalForRedis.redis ??
  new Redis(getEnv().REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  });

if (process.env.NODE_ENV !== 'production') globalForRedis.redis = redis;
