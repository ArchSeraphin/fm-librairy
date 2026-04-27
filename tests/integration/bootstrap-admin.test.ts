import { describe, it, expect, beforeEach } from 'vitest';
import { runBootstrap } from '../../scripts/bootstrap-admin';
import { getTestPrisma, truncateAll } from './setup/prisma';

const prisma = getTestPrisma();

beforeEach(async () => {
  await truncateAll();
});

describe('bootstrap-admin', () => {
  it("crée un GLOBAL_ADMIN si aucun n'existe", async () => {
    const out = await runBootstrap({
      email: 'ops@x.test',
      password: 'pass-32-chars-min-for-security!',
    });
    expect(out.created).toBe(true);
    expect(out.promoted).toBe(false);
    const u = await prisma.user.findUnique({ where: { email: 'ops@x.test' } });
    expect(u?.role).toBe('GLOBAL_ADMIN');
    expect(u?.emailVerifiedAt).not.toBeNull();
  });

  it('refuse un second run si un admin existe (sans --force)', async () => {
    await runBootstrap({ email: 'first@x.test', password: 'pass-32-chars-min-for-security!' });
    await expect(
      runBootstrap({ email: 'second@x.test', password: 'pass-32-chars-min-for-security!' }),
    ).rejects.toThrow(/admin global existe/i);
  });

  it('--force promeut un user existant', async () => {
    await runBootstrap({ email: 'first@x.test', password: 'pass-32-chars-min-for-security!' });
    await prisma.user.create({
      data: { email: 'tobepromote@x.test', displayName: 'X', passwordHash: 'unused', role: 'USER' },
    });
    const out = await runBootstrap({ email: 'tobepromote@x.test', force: true });
    expect(out.created).toBe(false);
    expect(out.promoted).toBe(true);
    const u = await prisma.user.findUnique({ where: { email: 'tobepromote@x.test' } });
    expect(u?.role).toBe('GLOBAL_ADMIN');
    const audit = await prisma.auditLog.findFirst({ where: { action: 'admin.user.role_changed' } });
    expect(audit).not.toBeNull();
  });

  it("--force échoue si l'user n'existe pas", async () => {
    await runBootstrap({ email: 'first@x.test', password: 'pass-32-chars-min-for-security!' });
    await expect(runBootstrap({ email: 'ghost@x.test', force: true })).rejects.toThrow(
      /aucun user/i,
    );
  });
});
