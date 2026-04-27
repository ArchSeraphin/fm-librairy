import { describe, it, expect, beforeEach } from 'vitest';
import { generateSync, NobleCryptoPlugin, ScureBase32Plugin } from 'otplib';
import { appRouter } from '@/server/trpc/routers/_app';
import { getTestPrisma, truncateAll } from './setup/prisma';
import { hashPassword } from '@/lib/password';
import { encryptSecret } from '@/lib/crypto';
import { generateTotpSecret, hashBackupCodes, generateBackupCodes } from '@/lib/totp';

const prisma = getTestPrisma();

// otplib v13 adapter — replaces the v12 `authenticator.generate(secret)` singleton API
function genCode(secret: string): string {
  return generateSync({
    secret,
    crypto: new NobleCryptoPlugin(),
    base32: new ScureBase32Plugin(),
    period: 30,
  });
}

async function buildCtx(opts: { user?: any; session?: any } = {}) {
  return { user: opts.user ?? null, session: opts.session ?? null };
}

beforeEach(async () => {
  await truncateAll();
});

describe('auth.enroll2FA', () => {
  it('crée un TwoFactorSecret + retourne otpauth URI', async () => {
    const u = await prisma.user.create({
      data: { email: 'e@x.test', displayName: 'E', passwordHash: await hashPassword('x') },
    });
    const session = await prisma.session.create({
      data: {
        sessionToken: 't1',
        userId: u.id,
        expiresAt: new Date(Date.now() + 1e9),
        ipHash: 'i',
        userAgentHash: 'u',
        pending2fa: false,
      },
    });
    const caller = appRouter.createCaller(await buildCtx({ user: u, session }));
    const out = await caller.auth.enroll2FA();
    expect(out.uri).toMatch(/^otpauth:\/\//);
    const secret = await prisma.twoFactorSecret.findUnique({ where: { userId: u.id } });
    expect(secret).not.toBeNull();
    expect(secret?.confirmedAt).toBeNull();
  });
});

describe('auth.confirm2FA', () => {
  it('valide le code et active twoFactorEnabled + retourne backup codes', async () => {
    const u = await prisma.user.create({
      data: { email: 'c@x.test', displayName: 'C', passwordHash: await hashPassword('x') },
    });
    const rawSecret = generateTotpSecret();
    await prisma.twoFactorSecret.create({
      data: { userId: u.id, secretCipher: encryptSecret(rawSecret), backupCodes: [] },
    });
    const session = await prisma.session.create({
      data: {
        sessionToken: 't2',
        userId: u.id,
        expiresAt: new Date(Date.now() + 1e9),
        ipHash: 'i',
        userAgentHash: 'u',
        pending2fa: false,
      },
    });
    const caller = appRouter.createCaller(await buildCtx({ user: u, session }));
    const code = genCode(rawSecret);
    const out = await caller.auth.confirm2FA({ code });
    expect(out.backupCodes).toHaveLength(8);
    const fresh = await prisma.user.findUnique({ where: { id: u.id } });
    expect(fresh?.twoFactorEnabled).toBe(true);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'auth.2fa.enrolled' } });
    expect(audit).not.toBeNull();
  });

  it('refuse un code invalide', async () => {
    const u = await prisma.user.create({
      data: { email: 'bad@x.test', displayName: 'B', passwordHash: await hashPassword('x') },
    });
    const rawSecret = generateTotpSecret();
    await prisma.twoFactorSecret.create({
      data: { userId: u.id, secretCipher: encryptSecret(rawSecret), backupCodes: [] },
    });
    const session = await prisma.session.create({
      data: {
        sessionToken: 't3',
        userId: u.id,
        expiresAt: new Date(Date.now() + 1e9),
        ipHash: 'i',
        userAgentHash: 'u',
        pending2fa: false,
      },
    });
    const caller = appRouter.createCaller(await buildCtx({ user: u, session }));
    await expect(caller.auth.confirm2FA({ code: '000000' })).rejects.toThrow();
  });
});

describe('auth.verify2FA', () => {
  it('upgrade la session pending → full + log success', async () => {
    const u = await prisma.user.create({
      data: {
        email: 'v@x.test',
        displayName: 'V',
        passwordHash: await hashPassword('x'),
        twoFactorEnabled: true,
      },
    });
    const rawSecret = generateTotpSecret();
    const codes = generateBackupCodes();
    await prisma.twoFactorSecret.create({
      data: {
        userId: u.id,
        secretCipher: encryptSecret(rawSecret),
        backupCodes: await hashBackupCodes(codes),
        confirmedAt: new Date(),
      },
    });
    const session = await prisma.session.create({
      data: {
        sessionToken: 'pending-tok',
        userId: u.id,
        expiresAt: new Date(Date.now() + 1e9),
        ipHash: 'i',
        userAgentHash: 'u',
        pending2fa: true,
      },
    });
    const caller = appRouter.createCaller(await buildCtx({ user: u, session }));
    const code = genCode(rawSecret);
    const out = await caller.auth.verify2FA({ code });
    expect(out.ok).toBe(true);
    expect(out.sessionToken).not.toBe('pending-tok');
    const old = await prisma.session.findUnique({ where: { sessionToken: 'pending-tok' } });
    expect(old).toBeNull();
    const fresh = await prisma.session.findUnique({ where: { sessionToken: out.sessionToken } });
    expect(fresh?.pending2fa).toBe(false);
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'auth.2fa.success', actorId: u.id },
    });
    expect(audit).not.toBeNull();
  });

  it('refuse code invalide + log failure', async () => {
    const u = await prisma.user.create({
      data: {
        email: 'vf@x.test',
        displayName: 'VF',
        passwordHash: await hashPassword('x'),
        twoFactorEnabled: true,
      },
    });
    await prisma.twoFactorSecret.create({
      data: {
        userId: u.id,
        secretCipher: encryptSecret(generateTotpSecret()),
        backupCodes: [],
        confirmedAt: new Date(),
      },
    });
    const session = await prisma.session.create({
      data: {
        sessionToken: 'pending-tok-2',
        userId: u.id,
        expiresAt: new Date(Date.now() + 1e9),
        ipHash: 'i',
        userAgentHash: 'u',
        pending2fa: true,
      },
    });
    const caller = appRouter.createCaller(await buildCtx({ user: u, session }));
    await expect(caller.auth.verify2FA({ code: '000000' })).rejects.toThrow();
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'auth.2fa.failure', actorId: u.id },
    });
    expect(audit).not.toBeNull();
  });
});

describe('auth.verifyBackupCode', () => {
  it('consomme un code de secours valide', async () => {
    const u = await prisma.user.create({
      data: {
        email: 'bk@x.test',
        displayName: 'BK',
        passwordHash: await hashPassword('x'),
        twoFactorEnabled: true,
      },
    });
    const codes = generateBackupCodes();
    await prisma.twoFactorSecret.create({
      data: {
        userId: u.id,
        secretCipher: encryptSecret('x'),
        backupCodes: await hashBackupCodes(codes),
        confirmedAt: new Date(),
      },
    });
    const session = await prisma.session.create({
      data: {
        sessionToken: 'pending-bk',
        userId: u.id,
        expiresAt: new Date(Date.now() + 1e9),
        ipHash: 'i',
        userAgentHash: 'u',
        pending2fa: true,
      },
    });
    const caller = appRouter.createCaller(await buildCtx({ user: u, session }));
    const out = await caller.auth.verifyBackupCode({ code: codes[0]! });
    expect(out.ok).toBe(true);
    const sec = await prisma.twoFactorSecret.findUnique({ where: { userId: u.id } });
    expect(sec?.backupCodes).toHaveLength(7);
  });
});
