import { beforeEach, describe, expect, it } from 'vitest';
import { generateSync, NobleCryptoPlugin, ScureBase32Plugin } from 'otplib';
import { appRouter } from '@/server/trpc/routers/_app';
import { hashPassword } from '@/lib/password';
import { encryptSecret } from '@/lib/crypto';
import { generateBackupCodes, hashBackupCodes, generateTotpSecret } from '@/lib/totp';
import { getTestPrisma, truncateAll } from './setup/prisma';

// otplib v13 adapter — replaces the v12 `authenticator.generate(secret)` singleton API
function genCode(secret: string): string {
  return generateSync({
    secret,
    crypto: new NobleCryptoPlugin(),
    base32: new ScureBase32Plugin(),
    period: 30,
  });
}

const prisma = getTestPrisma();
const HASH_64 = 'a'.repeat(64);

async function makeUserWith2fa() {
  const user = await prisma.user.create({
    data: {
      email: '2fa@e2e.test',
      passwordHash: await hashPassword('Pwd12345!XYZ'),
      displayName: 'F',
      twoFactorEnabled: true,
    },
  });
  const secret = generateTotpSecret();
  const codes = generateBackupCodes();
  const hashes = await hashBackupCodes(codes);
  await prisma.twoFactorSecret.create({
    data: {
      userId: user.id,
      secretCipher: encryptSecret(secret),
      confirmedAt: new Date(),
      backupCodes: hashes,
    },
  });
  const session = await prisma.session.create({
    data: {
      sessionToken: 's',
      userId: user.id,
      expiresAt: new Date(Date.now() + 60_000),
      ipHash: HASH_64,
      userAgentHash: HASH_64,
    },
  });
  return { user, session, secret, codes };
}

describe('account.security — 2FA', () => {
  beforeEach(truncateAll);

  it('regenerateBackupCodes: requires 2FA enabled', async () => {
    const user = await prisma.user.create({
      data: {
        email: 'no2fa@e2e.test',
        passwordHash: await hashPassword('Pwd12345!XYZ'),
        displayName: 'N',
      },
    });
    const session = await prisma.session.create({
      data: {
        sessionToken: 's',
        userId: user.id,
        expiresAt: new Date(Date.now() + 60_000),
        ipHash: HASH_64,
        userAgentHash: HASH_64,
      },
    });
    const ctx = { user, session, ip: '203.0.113.1' };
    await expect(
      appRouter.createCaller(ctx).account.security.regenerateBackupCodes({
        currentPassword: 'Pwd12345!XYZ',
        totpCode: '000000',
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('regenerateBackupCodes: returns 8 fresh codes one-time', async () => {
    const { user, session, secret } = await makeUserWith2fa();
    const ctx = { user, session, ip: '203.0.113.1' };
    const validCode = genCode(secret);
    const result = await appRouter.createCaller(ctx).account.security.regenerateBackupCodes({
      currentPassword: 'Pwd12345!XYZ',
      totpCode: validCode,
    });
    expect(result.codes.length).toBe(8);
    expect(
      await prisma.auditLog.count({
        where: { action: 'auth.2fa.recovery_codes_regenerated_self' },
      }),
    ).toBe(1);
  });

  it('startReEnrollWithBackup: refuses GLOBAL_ADMIN', async () => {
    const { user, session, codes } = await makeUserWith2fa();
    await prisma.user.update({ where: { id: user.id }, data: { role: 'GLOBAL_ADMIN' } });
    const refreshed = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const ctx = { user: refreshed, session, ip: '203.0.113.1' };
    await expect(
      appRouter
        .createCaller(ctx)
        .account.security.startReEnrollWithBackup({ backupCode: codes[0]! }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('startReEnrollWithBackup: clears 2FA, kills other sessions, audit', async () => {
    const { user, session, codes } = await makeUserWith2fa();
    await prisma.session.create({
      data: {
        sessionToken: 'other',
        userId: user.id,
        expiresAt: new Date(Date.now() + 60_000),
        ipHash: HASH_64,
        userAgentHash: HASH_64,
      },
    });
    const ctx = { user, session, ip: '203.0.113.1' };
    await appRouter
      .createCaller(ctx)
      .account.security.startReEnrollWithBackup({ backupCode: codes[0]! });
    expect((await prisma.user.findUnique({ where: { id: user.id } }))?.twoFactorEnabled).toBe(
      false,
    );
    expect(await prisma.twoFactorSecret.findUnique({ where: { userId: user.id } })).toBeNull();
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1); // current preserved
    expect(await prisma.auditLog.count({ where: { action: 'auth.2fa.reset_via_backup' } })).toBe(1);
  });
});
