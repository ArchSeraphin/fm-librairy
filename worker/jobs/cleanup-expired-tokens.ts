import type { PrismaClient } from '@prisma/client';

// The worker writes auditLog directly: it lives in a separate package and
// cannot import the frontend's `recordAudit` helper (path mapping `@/...`
// is not available here). The schema is shared, so direct writes are safe
// as long as we stay aligned with the same action taxonomy.
export async function cleanupExpiredTokens(
  prisma: PrismaClient,
): Promise<{ invitations: number; resets: number }> {
  const now = new Date();
  const expiredInvitations = await prisma.invitation.findMany({
    where: { expiresAt: { lt: now }, consumedAt: null },
    select: { id: true },
  });
  for (const inv of expiredInvitations) {
    await prisma.auditLog.create({
      data: {
        action: 'auth.invitation.expired',
        targetType: 'INVITATION',
        targetId: inv.id,
      },
    });
  }
  const invDel = await prisma.invitation.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  const resetDel = await prisma.passwordResetToken.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  return { invitations: invDel.count, resets: resetDel.count };
}
