import { describe, it, expect, beforeEach } from 'vitest';
import { getTestPrisma, truncateAll } from './setup/prisma';

const prisma = getTestPrisma();
beforeEach(truncateAll);

describe('isStillPendingForSession — gap #7bis', () => {
  it("un device pending NE doit PAS hériter du pending2fa=false d'un autre device verified", async () => {
    const u = await prisma.user.create({
      data: { email: 'sid7@x.test', displayName: 'X', passwordHash: 'h', twoFactorEnabled: true },
    });
    // Device A : déjà 2FA verified (pending=false), lastActivityAt récent
    const verified = await prisma.session.create({
      data: {
        sessionToken: 'tk-A',
        userId: u.id,
        expiresAt: new Date(Date.now() + 1e9),
        lastActivityAt: new Date(),
        ipHash: 'A',
        userAgentHash: 'A',
        pending2fa: false,
      },
    });
    // Device B : encore pending, lastActivityAt plus ancien
    const pending = await prisma.session.create({
      data: {
        sessionToken: 'tk-B',
        userId: u.id,
        expiresAt: new Date(Date.now() + 1e9),
        lastActivityAt: new Date(Date.now() - 60_000),
        ipHash: 'B',
        userAgentHash: 'B',
        pending2fa: true,
      },
    });
    const { isStillPendingForSession } = await import('@/server/auth/config');
    expect(await isStillPendingForSession(u.id, pending.id)).toBe(true);
    expect(await isStillPendingForSession(u.id, verified.id)).toBe(false);
  });

  it('renvoie true si la session a été supprimée (safe-side default)', async () => {
    const u = await prisma.user.create({
      data: { email: 'sid7b@x.test', displayName: 'X', passwordHash: 'h', twoFactorEnabled: true },
    });
    const { isStillPendingForSession } = await import('@/server/auth/config');
    // Session id qui n'existe pas → safe-side: pending=true
    expect(await isStillPendingForSession(u.id, 'nonexistent-session-id')).toBe(true);
  });

  it('renvoie false si user.twoFactorEnabled === false (peu importe la session)', async () => {
    const u = await prisma.user.create({
      data: { email: 'sid7c@x.test', displayName: 'X', passwordHash: 'h', twoFactorEnabled: false },
    });
    const s = await prisma.session.create({
      data: {
        sessionToken: 'tk-C',
        userId: u.id,
        expiresAt: new Date(Date.now() + 1e9),
        ipHash: 'C',
        userAgentHash: 'C',
        pending2fa: true, // even if pending, twoFactorEnabled=false means no 2FA requirement
      },
    });
    const { isStillPendingForSession } = await import('@/server/auth/config');
    expect(await isStillPendingForSession(u.id, s.id)).toBe(false);
  });

  it('renvoie true si la session appartient à un autre user (rejet hijack)', async () => {
    const u1 = await prisma.user.create({
      data: { email: 'sid7d-u1@x.test', displayName: 'X', passwordHash: 'h', twoFactorEnabled: true },
    });
    const u2 = await prisma.user.create({
      data: { email: 'sid7d-u2@x.test', displayName: 'Y', passwordHash: 'h', twoFactorEnabled: true },
    });
    const s = await prisma.session.create({
      data: {
        sessionToken: 'tk-D',
        userId: u2.id,  // belongs to u2
        expiresAt: new Date(Date.now() + 1e9),
        ipHash: 'D',
        userAgentHash: 'D',
        pending2fa: false,
      },
    });
    const { isStillPendingForSession } = await import('@/server/auth/config');
    // Trying to use u2's session id with u1 → safe-side: pending=true
    expect(await isStillPendingForSession(u1.id, s.id)).toBe(true);
  });
});
