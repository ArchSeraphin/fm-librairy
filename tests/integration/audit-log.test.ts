import { describe, it, expect, beforeEach, vi } from 'vitest';
import { recordAudit } from '@/lib/audit-log';
import { getTestPrisma, truncateAll } from './setup/prisma';

const prisma = getTestPrisma();

beforeEach(async () => {
  await truncateAll();
});

describe('recordAudit', () => {
  it("insère une ligne avec action seule (pas d'actor, pas de target)", async () => {
    await recordAudit({ action: 'auth.login.failure', metadata: { reason: 'unknown' } });
    const rows = await prisma.auditLog.findMany({ where: { action: 'auth.login.failure' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorId).toBeNull();
    expect(rows[0]!.targetType).toBeNull();
    expect(rows[0]!.metadata).toEqual({ reason: 'unknown' });
  });

  it("hashe l'IP avant de stocker", async () => {
    await recordAudit({ action: 'auth.login.success', req: { ip: '1.2.3.4', userAgent: 'UA/1' } });
    const row = await prisma.auditLog.findFirst({ where: { action: 'auth.login.success' } });
    expect(row?.ipHash).toBeDefined();
    expect(row?.ipHash).not.toBe('1.2.3.4');
    expect(row?.userAgent).toBe('UA/1');
  });

  it('redacte les clés sensibles dans metadata', async () => {
    await recordAudit({
      action: 'auth.login.failure',
      metadata: { email: 'x@y.z', password: 'secret123', token: 'tok-abc' },
    });
    const row = await prisma.auditLog.findFirst({ where: { action: 'auth.login.failure' } });
    const meta = row?.metadata as Record<string, unknown>;
    expect(meta.email).toBe('x@y.z');
    expect(meta.password).toBe('[REDACTED]');
    expect(meta.token).toBe('[REDACTED]');
  });

  it("n'arrête pas l'action user en cas d'erreur DB (mode non-bloquant par défaut)", async () => {
    await expect(recordAudit({ action: 'auth.login.success' })).resolves.toBeUndefined();
  });

  it("mode bloquant : permission.denied propage l'erreur si la DB échoue", async () => {
    const { db } = await import('@/lib/db');
    const spy = vi.spyOn(db.auditLog, 'create').mockRejectedValueOnce(new Error('DB down'));
    await expect(
      recordAudit({ action: 'permission.denied', actor: { id: 'fake' } }),
    ).rejects.toThrow('DB down');
    spy.mockRestore();
  });

  it('redacte récursivement (profondeur 2) les clés sensibles imbriquées', async () => {
    await recordAudit({
      action: 'auth.login.failure',
      metadata: { context: { password: 'leaked', email: 'x@y.z' } },
    });
    const row = await prisma.auditLog.findFirst({ where: { action: 'auth.login.failure' } });
    const meta = row?.metadata as Record<string, Record<string, unknown>>;
    const ctx = meta.context!;
    expect(ctx.password).toBe('[REDACTED]');
    expect(ctx.email).toBe('x@y.z');
  });
});
