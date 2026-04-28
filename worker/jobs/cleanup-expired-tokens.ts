import type { PrismaClient } from '@prisma/client';

const RETENTION_MS = 7 * 24 * 3600 * 1000;

// The worker writes auditLog directly: it lives in a separate package and
// cannot import the frontend's `recordAudit` helper (path mapping `@/...`
// is not available here). The schema is shared, so direct writes are safe
// as long as we stay aligned with the same action taxonomy.
export async function cleanupExpiredTokens(
  prisma: PrismaClient,
): Promise<{ invitationsDeleted: number; resetsDeleted: number; auditsLogged: number }> {
  const cutoff = new Date(Date.now() - RETENTION_MS);

  const expiredInvitations = await prisma.invitation.findMany({
    where: { expiresAt: { lt: cutoff }, consumedAt: null },
    select: { id: true },
  });

  let auditsLogged = 0;
  if (expiredInvitations.length > 0) {
    await prisma.auditLog.createMany({
      data: expiredInvitations.map((inv) => ({
        action: 'auth.invitation.expired',
        targetType: 'INVITATION',
        targetId: inv.id,
        metadata: { invitationId: inv.id } as object,
      })),
    });
    auditsLogged += expiredInvitations.length;
  }

  const expiredResetTokens = await prisma.passwordResetToken.findMany({
    where: { expiresAt: { lt: cutoff } },
    select: { id: true },
  });
  if (expiredResetTokens.length > 0) {
    await prisma.auditLog.createMany({
      data: expiredResetTokens.map((t) => ({
        action: 'auth.password.reset_expired',
        targetType: 'AUTH',
        targetId: t.id,
        metadata: { tokenId: t.id } as object,
      })),
    });
    auditsLogged += expiredResetTokens.length;
  }

  const invDel = await prisma.invitation.deleteMany({
    where: { expiresAt: { lt: cutoff }, consumedAt: null },
  });
  const resetDel = await prisma.passwordResetToken.deleteMany({
    where: { expiresAt: { lt: cutoff } },
  });

  return {
    invitationsDeleted: invDel.count,
    resetsDeleted: resetDel.count,
    auditsLogged,
  };
}
