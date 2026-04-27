import { describe, it, expect, beforeEach } from 'vitest';
import { authorizeCredentials } from '@/server/auth/credentials-provider';
import { getTestPrisma, truncateAll } from './setup/prisma';
import { hashPassword } from '@/lib/password';
import { hashIp, hashEmail } from '@/lib/crypto';
import { loginLimiter, loginIpOnlyLimiter } from '@/lib/rate-limit';

const prisma = getTestPrisma();
const REQ = { ip: '9.9.9.9', userAgent: 'UA' };
const ipH = hashIp(REQ.ip);

beforeEach(async () => {
  await truncateAll();
  await loginIpOnlyLimiter.delete(ipH);
});

describe('IP-only login limiter — gap #2', () => {
  it('bloque après 50 tentatives sur N emails différents depuis la même IP', async () => {
    const emails: string[] = [];
    for (let i = 0; i < 51; i++) {
      const email = `stuff${i}@x.test`;
      emails.push(email);
      await prisma.user.create({
        data: { email, displayName: 'X', passwordHash: await hashPassword('good') },
      });
      // Pre-clear per-(ip,email) limiter so it doesn't fire (each email is unique → wouldn't fire anyway)
      await loginLimiter.delete(`${ipH}:${hashEmail(email)}`);
    }
    // First 50 attempts go through (bad password, but not IP-rate-limited)
    for (let i = 0; i < 50; i++) {
      const r = await authorizeCredentials({ email: emails[i]!, password: 'wrong' }, REQ);
      expect(r).toBeNull();
    }
    // 51st attempt (on a fresh email) is blocked by the IP-only limiter
    const blocked = await authorizeCredentials({ email: emails[50]!, password: 'good' }, REQ);
    expect(blocked).toBeNull();
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'auth.login.locked' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit?.metadata).toMatchObject({ reason: 'ip_rate_limited' });
  }, 30_000);
});
