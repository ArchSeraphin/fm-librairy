import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import {
  createPasswordResetToken,
  findResetTokenByRawToken,
  consumePasswordReset,
} from '@/lib/password-reset';
import { hashPassword } from '@/lib/password';
import { truncateAll } from './setup/prisma';

async function seedUser(email: string) {
  return db.user.create({
    data: {
      email,
      displayName: 'U',
      passwordHash: await hashPassword('initial'),
    },
  });
}

beforeEach(async () => {
  await truncateAll();
});

describe('password-reset integration', () => {
  it('returns userExists=false for unknown email', async () => {
    const r = await createPasswordResetToken('ghost@x.test');
    expect(r.userExists).toBe(false);
    expect(r.rawToken).toBeUndefined();
  });

  it('creates a token for existing user', async () => {
    await seedUser('a@x.test');
    const r = await createPasswordResetToken('a@x.test');
    expect(r.userExists).toBe(true);
    expect(r.rawToken).toBeTruthy();
    const found = await findResetTokenByRawToken(r.rawToken!);
    expect(found?.consumedAt).toBeNull();
  });

  it('consume rotates password + clears sessions + drains other tokens', async () => {
    const u = await seedUser('a@x.test');
    await db.session.create({
      data: {
        userId: u.id,
        sessionToken: 'tok1',
        expiresAt: new Date(Date.now() + 3600_000),
        pending2fa: false,
        lastActivityAt: new Date(),
        ipHash: 'x'.repeat(64),
        userAgentHash: 'x'.repeat(64),
      },
    });
    const t1 = await createPasswordResetToken('a@x.test');
    const t2 = await createPasswordResetToken('a@x.test');
    expect(t1.rawToken && t2.rawToken).toBeTruthy();

    const out = await consumePasswordReset(t1.rawToken!, 'BrandNewPassword42!');
    expect(out.userId).toBe(u.id);

    expect(await db.session.count({ where: { userId: u.id } })).toBe(0);
    expect(await db.passwordResetToken.count({ where: { userId: u.id, consumedAt: null } })).toBe(0);
    expect(await findResetTokenByRawToken(t1.rawToken!)).toBeNull();
  });

  it('replay: second consume fails', async () => {
    await seedUser('a@x.test');
    const t = await createPasswordResetToken('a@x.test');
    await consumePasswordReset(t.rawToken!, 'BrandNewPassword42!');
    await expect(consumePasswordReset(t.rawToken!, 'AnotherPassword42!')).rejects.toThrow(
      'INVALID_TOKEN',
    );
  });

  it('expired token not findable', async () => {
    await seedUser('a@x.test');
    const t = await createPasswordResetToken('a@x.test');
    await db.passwordResetToken.updateMany({
      where: { userId: { not: '' } },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await findResetTokenByRawToken(t.rawToken!)).toBeNull();
  });
});
