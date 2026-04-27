import { describe, it, expect, beforeEach } from 'vitest';
import { createSessionAdapter } from '@/server/auth/adapter';
import { getTestPrisma, truncateAll } from './setup/prisma';

const prisma = getTestPrisma();
const adapter = createSessionAdapter(prisma);

beforeEach(truncateAll);

describe('getSession — gap #6', () => {
  it('retourne le row avec lastActivityAt à jour après touch', async () => {
    const user = await prisma.user.create({
      data: { email: 'g6@x.test', displayName: 'X', passwordHash: 'h' },
    });
    // Créer une session avec lastActivityAt > 1min dans le passé pour déclencher le touch
    const old = new Date(Date.now() - 5 * 60 * 1000);
    const s = await prisma.session.create({
      data: {
        sessionToken: 'tk-g6',
        userId: user.id,
        expiresAt: new Date(Date.now() + 1e9),
        lastActivityAt: old,
        ipHash: 'i',
        userAgentHash: 'u',
      },
    });
    const got = await adapter.getSession(s.sessionToken);
    expect(got).not.toBeNull();
    // Le caller doit recevoir un lastActivityAt fraîchement mis à jour, PAS le pré-update.
    expect(got!.lastActivityAt.getTime()).toBeGreaterThan(old.getTime() + 60_000);
  });
});
