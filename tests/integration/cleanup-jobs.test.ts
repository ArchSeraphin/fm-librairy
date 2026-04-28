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
  const eightDaysAgo = () => new Date(Date.now() - 8 * 24 * 3600 * 1000);

  it('supprime invitations + reset tokens expirés depuis >7j et log un audit par item', async () => {
    const u = await prisma.user.create({
      data: { email: 'c2@x.test', displayName: 'X', passwordHash: await hashPassword('x') },
    });
    const inv = await prisma.invitation.create({
      data: {
        email: 'inv@x.test',
        invitedById: u.id,
        tokenHash: 'h-expired',
        expiresAt: eightDaysAgo(),
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
    const tok = await prisma.passwordResetToken.create({
      data: { userId: u.id, tokenHash: 'rh-expired', expiresAt: eightDaysAgo() },
    });
    await prisma.passwordResetToken.create({
      data: { userId: u.id, tokenHash: 'rh-fresh', expiresAt: new Date(Date.now() + 1e9) },
    });

    const r = await cleanupExpiredTokens(prisma);
    expect(r.invitationsDeleted).toBe(1);
    expect(r.resetsDeleted).toBe(1);
    expect(r.auditsLogged).toBe(2);

    const invAudit = await prisma.auditLog.findFirst({
      where: { action: 'auth.invitation.expired', targetId: inv.id },
    });
    expect(invAudit?.targetType).toBe('INVITATION');

    const resetAudit = await prisma.auditLog.findFirst({
      where: { action: 'auth.password.reset_expired', targetId: tok.id },
    });
    expect(resetAudit?.targetType).toBe('AUTH');

    const remainingInv = await prisma.invitation.findMany();
    expect(remainingInv).toHaveLength(1);
    expect(remainingInv[0]!.tokenHash).toBe('h-fresh');

    const remainingReset = await prisma.passwordResetToken.findMany();
    expect(remainingReset).toHaveLength(1);
    expect(remainingReset[0]!.tokenHash).toBe('rh-fresh');
  });

  it('garde invitations consommées même expirées (audit trail)', async () => {
    const u = await prisma.user.create({
      data: { email: 'c3@x.test', displayName: 'X', passwordHash: await hashPassword('x') },
    });
    await prisma.invitation.create({
      data: {
        email: 'consumed@x.test',
        invitedById: u.id,
        tokenHash: 'h-consumed',
        expiresAt: eightDaysAgo(),
        consumedAt: new Date(Date.now() - 7.5 * 24 * 3600 * 1000),
        consumedById: u.id,
      },
    });
    const r = await cleanupExpiredTokens(prisma);
    expect(r.invitationsDeleted).toBe(0);
    expect(r.auditsLogged).toBe(0);
    const remaining = await prisma.invitation.findMany();
    expect(remaining).toHaveLength(1);
  });

  it('garde tokens dans la fenêtre de rétention (expirés depuis <7j)', async () => {
    const u = await prisma.user.create({
      data: { email: 'c4@x.test', displayName: 'X', passwordHash: await hashPassword('x') },
    });
    await prisma.passwordResetToken.create({
      data: {
        userId: u.id,
        tokenHash: 'rh-recent',
        expiresAt: new Date(Date.now() - 3600 * 1000),
      },
    });
    const r = await cleanupExpiredTokens(prisma);
    expect(r.resetsDeleted).toBe(0);
    expect(r.auditsLogged).toBe(0);
  });
});
