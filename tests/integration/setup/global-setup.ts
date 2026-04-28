/**
 * Vitest globalSetup — runs in the MAIN process before any worker is spawned.
 *
 * Starting containers here ensures that DATABASE_URL (and related env vars) are
 * present in process.env BEFORE forks inherit the environment, so that Prisma's
 * native query-engine addon can resolve the connection string at first import.
 */
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { execSync } from 'node:child_process';

let pg: StartedPostgreSqlContainer;
let redis: StartedRedisContainer;

export async function setup(): Promise<void> {
  pg = await new PostgreSqlContainer('postgres:16-alpine').start();
  redis = await new RedisContainer('redis:7-alpine').start();

  process.env.DATABASE_URL = pg.getConnectionUri();
  process.env.REDIS_URL = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
  process.env.SESSION_SECRET = 'test-session-secret-32-chars-min!';
  process.env.CRYPTO_MASTER_KEY = 'test-crypto-master-key-32-chars-min!';
  process.env.APP_URL = 'http://localhost:3000';
  process.env.MEILI_HOST = 'http://localhost:7700';
  process.env.MEILI_MASTER_KEY = 'test-meili-master-key-16chars';
  process.env.IP_HASH_SALT = 'test-ip-hash-salt-16c';
  process.env.UA_HASH_SALT = 'test-ua-hash-salt-16c';
  process.env.EMAIL_TRANSPORT = 'smtp';
  process.env.EMAIL_FROM = 'BiblioShare <test@biblio.test>';
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = '1';
  process.env.EMAIL_LOG_SALT = 'test-email-log-salt-32-chars-min!';
  (process.env as Record<string, string>)['NODE_ENV'] = 'test';

  execSync('pnpm prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    stdio: 'inherit',
  });
}

export async function teardown(): Promise<void> {
  await pg?.stop();
  await redis?.stop();
}
