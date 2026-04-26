import { afterAll, beforeAll } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { execSync } from 'node:child_process';
import { teardownTestPrisma } from './prisma';

let pg: StartedPostgreSqlContainer;
let redis: StartedRedisContainer;

beforeAll(async () => {
  pg = await new PostgreSqlContainer('postgres:16-alpine').start();
  redis = await new RedisContainer('redis:7-alpine').start();

  process.env.DATABASE_URL = pg.getConnectionUri();
  process.env.REDIS_URL = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
  process.env.SESSION_SECRET = 'test-session-secret-32-chars-min!';
  process.env.CRYPTO_MASTER_KEY = 'test-crypto-master-key-32-chars-min!';
  process.env.APP_URL = 'http://localhost:3000';
  process.env.MEILI_HOST = 'http://localhost:7700';
  process.env.MEILI_MASTER_KEY = 'test-meili-master-key-16chars';
  (process.env as Record<string, string>)['NODE_ENV'] = 'test';

  execSync('pnpm prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    stdio: 'inherit',
  });
});

afterAll(async () => {
  await teardownTestPrisma();
  await pg?.stop();
  await redis?.stop();
});
