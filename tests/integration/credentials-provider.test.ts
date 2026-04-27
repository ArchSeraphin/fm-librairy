import { describe, it, expect, beforeEach } from 'vitest';
import { authorizeCredentials } from '@/server/auth/credentials-provider';
import { getTestPrisma, truncateAll } from './setup/prisma';
import { hashPassword } from '@/lib/password';
import { loginLimiter } from '@/lib/rate-limit';

const prisma = getTestPrisma();

async function mkUser(opts: {
  email: string;
  password: string;
  status?: 'ACTIVE' | 'SUSPENDED';
  lockedUntil?: Date;
}) {
  return prisma.user.create({
    data: {
      email: opts.email,
      displayName: 'Test',
      passwordHash: await hashPassword(opts.password),
      status: opts.status ?? 'ACTIVE',
      lockedUntil: opts.lockedUntil,
    },
  });
}

beforeEach(async () => {
  await truncateAll();
  await loginLimiter.delete('iphash:test1@x.test');
  await loginLimiter.delete('iphash:test2@x.test');
  await loginLimiter.delete('iphash:test3@x.test');
});

const REQ = { ip: '1.2.3.4', userAgent: 'UA' };

describe('authorizeCredentials', () => {
  it("happy path : retourne l'user", async () => {
    const u = await mkUser({ email: 'test1@x.test', password: 'goodpass' });
    const result = await authorizeCredentials({ email: 'test1@x.test', password: 'goodpass' }, REQ);
    expect(result?.id).toBe(u.id);
  });

  it('mauvais password : null + audit failure + incrément failedLoginAttempts', async () => {
    const u = await mkUser({ email: 'test2@x.test', password: 'goodpass' });
    const result = await authorizeCredentials({ email: 'test2@x.test', password: 'wrong' }, REQ);
    expect(result).toBeNull();
    const fresh = await prisma.user.findUnique({ where: { id: u.id } });
    expect(fresh?.failedLoginAttempts).toBe(1);
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'auth.login.failure', actorId: u.id },
    });
    expect(audit).not.toBeNull();
  });

  it('user inconnu : null + audit failure (pas de leak)', async () => {
    const result = await authorizeCredentials({ email: 'noone@x.test', password: 'x' }, REQ);
    expect(result).toBeNull();
    const audit = await prisma.auditLog.findFirst({ where: { action: 'auth.login.failure' } });
    expect(audit).not.toBeNull();
    expect(audit?.actorId).toBeNull();
  });

  it('user suspendu : null + audit', async () => {
    await mkUser({ email: 'test3@x.test', password: 'goodpass', status: 'SUSPENDED' });
    const result = await authorizeCredentials({ email: 'test3@x.test', password: 'goodpass' }, REQ);
    expect(result).toBeNull();
  });

  it('user locked : null + audit', async () => {
    const future = new Date(Date.now() + 60 * 1000);
    const u = await mkUser({ email: 'lockd@x.test', password: 'goodpass', lockedUntil: future });
    const result = await authorizeCredentials({ email: 'lockd@x.test', password: 'goodpass' }, REQ);
    expect(result).toBeNull();
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'auth.login.locked', actorId: u.id },
    });
    expect(audit).not.toBeNull();
  });

  it('20 échecs cumulés : pose lockedUntil = +1h', async () => {
    const u = await mkUser({ email: 'multi@x.test', password: 'goodpass' });
    await prisma.user.update({ where: { id: u.id }, data: { failedLoginAttempts: 19 } });
    // 20ᵉ échec → doit poser lockedUntil
    await authorizeCredentials({ email: 'multi@x.test', password: 'wrong' }, REQ);
    const fresh = await prisma.user.findUnique({ where: { id: u.id } });
    expect(fresh?.failedLoginAttempts).toBe(20);
    expect(fresh?.lockedUntil).not.toBeNull();
    expect(fresh!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it('gap #4 — incréments concurrents de failedLoginAttempts ne se perdent pas', async () => {
    const u = await mkUser({ email: 'race4@x.test', password: 'goodpass' });
    await prisma.user.update({ where: { id: u.id }, data: { failedLoginAttempts: 0 } });
    await Promise.all(
      Array.from({ length: 4 }, () =>
        authorizeCredentials({ email: 'race4@x.test', password: 'wrong' }, REQ),
      ),
    );
    const fresh = await prisma.user.findUnique({ where: { id: u.id } });
    expect(fresh?.failedLoginAttempts).toBe(4);
  });

  it('happy path : reset failedLoginAttempts à 0', async () => {
    const u = await mkUser({ email: 'reset@x.test', password: 'goodpass' });
    await prisma.user.update({ where: { id: u.id }, data: { failedLoginAttempts: 5 } });
    await authorizeCredentials({ email: 'reset@x.test', password: 'goodpass' }, REQ);
    const fresh = await prisma.user.findUnique({ where: { id: u.id } });
    expect(fresh?.failedLoginAttempts).toBe(0);
  });

  it('timing constant : user inconnu vs user connu mauvais MdP (±50ms sur 50 itérations)', async () => {
    await mkUser({ email: 'timing@x.test', password: 'goodpass' });
    const N = 50;
    const tUnknown: number[] = [];
    const tKnown: number[] = [];
    for (let i = 0; i < N; i++) {
      const a = performance.now();
      await authorizeCredentials({ email: 'unknown@x.test', password: 'x' }, REQ);
      tUnknown.push(performance.now() - a);
      const b = performance.now();
      await authorizeCredentials({ email: 'timing@x.test', password: 'wrong' }, REQ);
      tKnown.push(performance.now() - b);
    }
    const avgU = tUnknown.reduce((s, x) => s + x, 0) / N;
    const avgK = tKnown.reduce((s, x) => s + x, 0) / N;
    expect(Math.abs(avgU - avgK)).toBeLessThan(50);
  });
});
