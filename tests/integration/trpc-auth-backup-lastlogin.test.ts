import { describe, it, expect, beforeEach } from 'vitest';
import { getTestPrisma, truncateAll } from './setup/prisma';
import { hashPassword } from '@/lib/password';
import { encryptSecret } from '@/lib/crypto';
import { generateTotpSecret, generateBackupCodes, hashBackupCodes } from '@/lib/totp';
import { appRouter } from '@/server/trpc/routers/_app';
import { twoFactorLimiter } from '@/lib/rate-limit';

const prisma = getTestPrisma();
beforeEach(truncateAll);

describe('verifyBackupCode — gap #9', () => {
  it('met à jour lastLoginAt comme verify2FA', async () => {
    const u = await prisma.user.create({
      data: {
        email: 'bk9@x.test',
        displayName: 'X',
        passwordHash: await hashPassword('x'),
        twoFactorEnabled: true,
      },
    });
    const plain = generateBackupCodes();
    const hashes = await hashBackupCodes(plain);
    await prisma.twoFactorSecret.create({
      data: {
        userId: u.id,
        secretCipher: encryptSecret(generateTotpSecret()),
        backupCodes: hashes,
        confirmedAt: new Date(),
      },
    });
    const session = await prisma.session.create({
      data: {
        sessionToken: 'tk-bk9',
        userId: u.id,
        expiresAt: new Date(Date.now() + 1e9),
        ipHash: 'i',
        userAgentHash: 'u',
        pending2fa: true,
      },
    });
    await twoFactorLimiter.delete(session.id);
    const before = (await prisma.user.findUnique({ where: { id: u.id } }))!.lastLoginAt;
    expect(before).toBeNull();
    const caller = appRouter.createCaller({ user: u, session });
    await caller.auth.verifyBackupCode({ code: plain[0]! });
    const after = (await prisma.user.findUnique({ where: { id: u.id } }))!.lastLoginAt;
    expect(after).not.toBeNull();
    expect(after!.getTime()).toBeGreaterThan(Date.now() - 5_000);
  });
});
