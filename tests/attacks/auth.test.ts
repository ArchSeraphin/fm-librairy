import { describe, it, expect, beforeEach } from 'vitest';
import { generateSync, NobleCryptoPlugin, ScureBase32Plugin } from 'otplib';
import { getTestPrisma, truncateAll } from '../integration/setup/prisma';
import { authorizeCredentials } from '@/server/auth/credentials-provider';
import { hashPassword } from '@/lib/password';
import { encryptSecret, hashEmail, hashIp } from '@/lib/crypto';
import { generateTotpSecret } from '@/lib/totp';
import { loginLimiter, loginIpOnlyLimiter, twoFactorLimiter } from '@/lib/rate-limit';
import { appRouter } from '@/server/trpc/routers/_app';

const prisma = getTestPrisma();

// otplib v13 adapter — matches the helper used in tests/integration/trpc-auth.test.ts
function genCode(secret: string): string {
  return generateSync({
    secret,
    crypto: new NobleCryptoPlugin(),
    base32: new ScureBase32Plugin(),
    period: 30,
  });
}

const REQ = { ip: '1.2.3.4', userAgent: 'UA' };
const ipH = hashIp(REQ.ip);

// Rate-limit key matches credentials-provider:36 → `${hashIp(ip)}:${hashEmail(email)}`
function loginKey(email: string): string {
  return `${ipH}:${hashEmail(email)}`;
}

beforeEach(async () => {
  await truncateAll();
  await loginIpOnlyLimiter.delete(ipH);
});

describe('A1 — Bruteforce login', () => {
  it('5 tentatives consommées → 6ᵉ rate limited (retourne null sans atteindre la DB)', async () => {
    const email = 'bf@x.test';
    await loginLimiter.delete(loginKey(email));
    await prisma.user.create({
      data: { email, displayName: 'X', passwordHash: await hashPassword('good') },
    });
    for (let i = 0; i < 5; i++) {
      await authorizeCredentials({ email, password: 'wrong' }, REQ);
    }
    // 6th attempt: even with correct password, rate limiter rejects before DB lookup
    const result = await authorizeCredentials({ email, password: 'good' }, REQ);
    expect(result).toBeNull();
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'auth.login.locked' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit?.metadata).toMatchObject({ reason: 'rate_limited' });
  });
});

describe('A1b — Bruteforce 2FA', () => {
  it('5 codes invalides sur même session pending → 6ᵉ TOO_MANY_REQUESTS', async () => {
    const u = await prisma.user.create({
      data: {
        email: 'bf2@x.test',
        displayName: 'X',
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
        sessionToken: 'tk-bf2',
        userId: u.id,
        expiresAt: new Date(Date.now() + 1e9),
        ipHash: 'i',
        userAgentHash: 'u',
        pending2fa: true,
      },
    });
    await twoFactorLimiter.delete(session.id);
    const caller = appRouter.createCaller({ user: u, session, ip: '0.0.0.0' });
    for (let i = 0; i < 5; i++) {
      await expect(caller.auth.verify2FA({ code: '000000' })).rejects.toThrow();
    }
    await expect(caller.auth.verify2FA({ code: '000000' })).rejects.toThrow(
      /TOO_MANY_REQUESTS|429/,
    );
  });
});

describe('A2 — Énumération via timing', () => {
  it('user inconnu vs user connu mauvais MdP : timing similaire (< 50ms)', async () => {
    await prisma.user.create({
      data: { email: 'real@x.test', displayName: 'X', passwordHash: await hashPassword('good') },
    });
    const N = 30;
    const tU: number[] = [];
    const tK: number[] = [];
    for (let i = 0; i < N; i++) {
      // Reset limiters each iteration so we measure the auth path, not rate-limit rejections
      await loginLimiter.delete(loginKey('real@x.test'));
      await loginLimiter.delete(loginKey('ghost@x.test'));
      const a = performance.now();
      await authorizeCredentials({ email: 'ghost@x.test', password: 'x' }, REQ);
      tU.push(performance.now() - a);
      const b = performance.now();
      await authorizeCredentials({ email: 'real@x.test', password: 'wrong' }, REQ);
      tK.push(performance.now() - b);
    }
    const avgU = tU.reduce((s, x) => s + x, 0) / N;
    const avgK = tK.reduce((s, x) => s + x, 0) / N;
    expect(Math.abs(avgU - avgK)).toBeLessThan(50);
  });
});

describe('A6 — TOTP secret en DB non exploitable sans clé', () => {
  it('secretCipher en DB est différent du secret raw et porte le format chiffré', async () => {
    const u = await prisma.user.create({
      data: { email: 'totp@x.test', displayName: 'X', passwordHash: await hashPassword('x') },
    });
    const raw = generateTotpSecret();
    await prisma.twoFactorSecret.create({
      data: { userId: u.id, secretCipher: encryptSecret(raw), backupCodes: [] },
    });
    const stored = await prisma.twoFactorSecret.findUnique({ where: { userId: u.id } });
    expect(stored?.secretCipher).not.toBe(raw);
    // AES-GCM payload format from crypto.ts:27 → "iv:tag:data"
    expect(stored?.secretCipher).toContain(':');
  });
});

describe('A7 — Session fixation', () => {
  it("après upgrade 2FA, le sessionToken change et l'ancienne session est supprimée", async () => {
    const u = await prisma.user.create({
      data: {
        email: 'fix@x.test',
        displayName: 'X',
        passwordHash: await hashPassword('x'),
        twoFactorEnabled: true,
      },
    });
    const raw = generateTotpSecret();
    await prisma.twoFactorSecret.create({
      data: {
        userId: u.id,
        secretCipher: encryptSecret(raw),
        backupCodes: [],
        confirmedAt: new Date(),
      },
    });
    const session = await prisma.session.create({
      data: {
        sessionToken: 'old-tok-fixation',
        userId: u.id,
        expiresAt: new Date(Date.now() + 1e9),
        ipHash: 'i',
        userAgentHash: 'u',
        pending2fa: true,
      },
    });
    await twoFactorLimiter.delete(session.id);
    const caller = appRouter.createCaller({ user: u, session, ip: '0.0.0.0' });
    const out = await caller.auth.verify2FA({ code: genCode(raw) });
    expect(out.sessionToken).not.toBe('old-tok-fixation');
    const old = await prisma.session.findUnique({ where: { sessionToken: 'old-tok-fixation' } });
    expect(old).toBeNull();
  });
});

describe('A5 — 2FA downgrade impossible sans re-auth', () => {
  it('disable2FA refuse sans password valide', async () => {
    const u = await prisma.user.create({
      data: {
        email: 'dis@x.test',
        displayName: 'X',
        passwordHash: await hashPassword('correct'),
        twoFactorEnabled: true,
        role: 'USER',
      },
    });
    const raw = generateTotpSecret();
    await prisma.twoFactorSecret.create({
      data: {
        userId: u.id,
        secretCipher: encryptSecret(raw),
        backupCodes: [],
        confirmedAt: new Date(),
      },
    });
    const session = await prisma.session.create({
      data: {
        sessionToken: 'tk-dis',
        userId: u.id,
        expiresAt: new Date(Date.now() + 1e9),
        ipHash: 'i',
        userAgentHash: 'u',
        pending2fa: false,
      },
    });
    const caller = appRouter.createCaller({ user: u, session, ip: '0.0.0.0' });
    await expect(
      caller.auth.disable2FA({ password: 'wrong', code: genCode(raw) }),
    ).rejects.toThrow();
    // Verify state untouched
    const fresh = await prisma.user.findUnique({ where: { id: u.id } });
    expect(fresh?.twoFactorEnabled).toBe(true);
  });

  it('disable2FA refuse pour Global Admin (même avec credentials valides)', async () => {
    const u = await prisma.user.create({
      data: {
        email: 'admdis@x.test',
        displayName: 'X',
        passwordHash: await hashPassword('p'),
        twoFactorEnabled: true,
        role: 'GLOBAL_ADMIN',
      },
    });
    const raw = generateTotpSecret();
    await prisma.twoFactorSecret.create({
      data: {
        userId: u.id,
        secretCipher: encryptSecret(raw),
        backupCodes: [],
        confirmedAt: new Date(),
      },
    });
    const session = await prisma.session.create({
      data: {
        sessionToken: 'tk-admdis',
        userId: u.id,
        expiresAt: new Date(Date.now() + 1e9),
        ipHash: 'i',
        userAgentHash: 'u',
        pending2fa: false,
      },
    });
    const caller = appRouter.createCaller({ user: u, session, ip: '0.0.0.0' });
    await expect(caller.auth.disable2FA({ password: 'p', code: genCode(raw) })).rejects.toThrow(
      /global admin/i,
    );
  });
});
