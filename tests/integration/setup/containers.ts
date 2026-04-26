/**
 * Vitest setupFiles — runs in each worker process (fork) after env vars are
 * already present thanks to global-setup.ts.
 *
 * Responsibilities:
 * - Re-initialise the Prisma singleton after the env is confirmed ready.
 * - Disconnect the test Prisma client after all tests in the file finish.
 */
import { afterAll } from 'vitest';
import { teardownTestPrisma, resetTestPrisma } from './prisma';

// Env vars (DATABASE_URL etc.) are inherited from the main process via globalSetup.
// Re-create the Prisma singleton now so the query-engine binary is spawned with
// the correct connection string (it was first created at module-import time, before
// env vars were available in older setups — resetTestPrisma() ensures it's fresh).
resetTestPrisma();

afterAll(async () => {
  await teardownTestPrisma();
});
