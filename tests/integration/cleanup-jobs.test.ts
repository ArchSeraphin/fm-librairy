import { describe, it, expect, beforeEach } from 'vitest';
import { cleanupExpiredSessions } from '../../worker/jobs/cleanup-expired-sessions';
import { cleanupExpiredTokens } from '../../worker/jobs/cleanup-expired-tokens';
import { getTestPrisma, truncateAll } from './setup/prisma';
import { hashPassword } from '@/lib/password';

const prisma = getTestPrisma();

beforeEach(async () => {
  await truncateAll();
});

describe('cleanupExpiredSessions', () => {
  it('supprime sessions expirées et inactives, conserve les actives', async () => {
    const u = await prisma.user.create({
      data: { email: 'c1@x.test', displayName: 'X', passwordHash: await hashPassword('x') },
    });
    await prisma.session.createMany({
      data: [
        {
          sessionToken: 's1-expired',
          userId: u.id,
          expiresAt: new Date(Date.now() - 1000),
          ipHash: 'i',
          userAgentHash: 'u',
        },
        {
          sessionToken: 's2-inactive',
          userId: u.id,
          expiresAt: new Date(Date.now() + 1e9),
          lastActivityAt: new Date(Date.now() - 8 * 24 * 3600 * 1000),
          ipHash: 'i',
          userAgentHash: 'u',
        },
        {
          sessionToken: 's3-active',
          userId: u.id,
          expiresAt: new Date(Date.now() + 1e9),
          lastActivityAt: new Date(),
          ipHash: 'i',
          userAgentHash: 'u',
        },
      ],
    });
    const r = await cleanupExpiredSessions(prisma);
    expect(r.deleted).toBe(2);
    const remaining = await prisma.session.findMany({ where: { userId: u.id } });
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.sessionToken).toBe('s3-active');
  });
});

describe('cleanupExpiredTokens', () => {
  it('supprime invitations + reset tokens expirés et log les invitations expirées', async () => {
    const u = await prisma.user.create({
      data: { email: 'c2@x.test', displayName: 'X', passwordHash: await hashPassword('x') },
    });
    const inv = await prisma.invitation.create({
      data: {
        email: 'inv@x.test',
        invitedById: u.id,
        tokenHash: 'h-expired',
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    await prisma.invitation.create({
      data: {
        email: 'inv2@x.test',
        invitedById: u.id,
        tokenHash: 'h-fresh',
        expiresAt: new Date(Date.now() + 1e9),
      },
    });
    await prisma.passwordResetToken.create({
      data: { userId: u.id, tokenHash: 'rh-expired', expiresAt: new Date(Date.now() - 1000) },
    });
    await prisma.passwordResetToken.create({
      data: { userId: u.id, tokenHash: 'rh-fresh', expiresAt: new Date(Date.now() + 1e9) },
    });

    const r = await cleanupExpiredTokens(prisma);
    expect(r.invitations).toBe(1);
    expect(r.resets).toBe(1);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'auth.invitation.expired', targetId: inv.id },
    });
    expect(audit).not.toBeNull();
    expect(audit?.targetType).toBe('INVITATION');

    const remainingInv = await prisma.invitation.findMany();
    expect(remainingInv).toHaveLength(1);
    expect(remainingInv[0]!.tokenHash).toBe('h-fresh');

    const remainingReset = await prisma.passwordResetToken.findMany();
    expect(remainingReset).toHaveLength(1);
    expect(remainingReset[0]!.tokenHash).toBe('rh-fresh');
  });

  it('ne log pas les invitations déjà consommées même si expirées', async () => {
    const u = await prisma.user.create({
      data: { email: 'c3@x.test', displayName: 'X', passwordHash: await hashPassword('x') },
    });
    await prisma.invitation.create({
      data: {
        email: 'consumed@x.test',
        invitedById: u.id,
        tokenHash: 'h-consumed',
        expiresAt: new Date(Date.now() - 1000),
        consumedAt: new Date(Date.now() - 500),
        consumedById: u.id,
      },
    });
    const r = await cleanupExpiredTokens(prisma);
    expect(r.invitations).toBe(1);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'auth.invitation.expired' } });
    expect(audit).toBeNull();
  });
});
