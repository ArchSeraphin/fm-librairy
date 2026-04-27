import type { PrismaClient } from '@prisma/client';

const INACTIVITY_TTL_MS = 7 * 24 * 3600 * 1000;

export async function cleanupExpiredSessions(prisma: PrismaClient): Promise<{ deleted: number }> {
  const cutoffActivity = new Date(Date.now() - INACTIVITY_TTL_MS);
  const r = await prisma.session.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: new Date() } }, { lastActivityAt: { lt: cutoffActivity } }],
    },
  });
  return { deleted: r.count };
}
