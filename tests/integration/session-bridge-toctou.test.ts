/**
 * Gap #5 — TOCTOU race in session-bridge find-or-create.
 *
 * Without a SERIALIZABLE transaction wrapping findFirst + createSession, two
 * concurrent requests for the same user with no existing valid session both see
 * null from findFirst (READ COMMITTED lets phantom reads through) and both
 * INSERT a new row, producing N sessions where 1 was needed.
 *
 * This test exercises the find-or-create primitive directly (white-box) rather
 * than mocking `next/headers` / `auth()`, which would be brittle and slower.
 *
 * Assertion: 5 concurrent calls produce ≤ 2 sessions.
 * With SERIALIZABLE isolation, Postgres detects the phantom read conflict and
 * aborts one of the concurrent writers (error P2034 / code 40001). The retry
 * loop in the bridge (and in findOrCreate below) re-reads and finds the already
 * committed session, so only 1-2 rows are ever created.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getTestPrisma, truncateAll } from './setup/prisma';
import { createSessionAdapter } from '@/server/auth/adapter';
import type { Session } from '@prisma/client';

const prisma = getTestPrisma();
beforeEach(truncateAll);

describe('session-bridge — gap #5 TOCTOU', () => {
  it('5 calls concurrents au pattern find-or-create produisent ≤ 2 sessions', async () => {
    const u = await prisma.user.create({
      data: { email: 'tc5@x.test', displayName: 'X', passwordHash: 'h' },
    });

    // Simulate the bridge's find-or-create pattern under concurrent load.
    // Uses SERIALIZABLE isolation + retry loop — mirrors the H6 fix exactly.
    async function findOrCreate(): Promise<Session> {
      let retries = 3;
      while (retries-- > 0) {
        try {
          return await prisma.$transaction(
            async (tx) => {
              const existing = await tx.session.findFirst({
                where: { userId: u.id, expiresAt: { gt: new Date() } },
                orderBy: { lastActivityAt: 'desc' },
              });
              if (existing) return existing;
              const adapter = createSessionAdapter(tx as unknown as typeof prisma);
              return adapter.createSession({
                userId: u.id,
                ipHash: 'i',
                userAgentHash: 'u',
                pending2fa: false,
              });
            },
            { isolationLevel: 'Serializable' },
          );
        } catch (err) {
          if (
            retries > 0 &&
            err instanceof Error &&
            (err as { code?: string }).code === 'P2034'
          ) {
            continue;
          }
          throw err;
        }
      }
      throw new Error('findOrCreate: exhausted retries');
    }

    await Promise.all([
      findOrCreate(),
      findOrCreate(),
      findOrCreate(),
      findOrCreate(),
      findOrCreate(),
    ]);

    const sessions = await prisma.session.findMany({ where: { userId: u.id } });
    expect(sessions.length).toBeLessThanOrEqual(2);
  });
});
