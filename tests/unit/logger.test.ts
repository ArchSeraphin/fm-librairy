import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('logger redaction', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NODE_ENV = 'production';
    process.env.LOG_LEVEL = 'info';
    process.env.APP_URL = 'http://localhost:3000';
    process.env.DATABASE_URL = 'postgresql://x:x@localhost:5432/x';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.MEILI_HOST = 'http://localhost:7700';
    process.env.MEILI_MASTER_KEY = 'abcdefghijklmnop';
    process.env.SESSION_SECRET = '0'.repeat(32);
    process.env.CRYPTO_MASTER_KEY = '1'.repeat(32);
  });

  it('redacte les champs sensibles dans les logs', async () => {
    const { logger } = await import('@/lib/logger');
    const captured: string[] = [];
    const stream = { write: (s: string) => captured.push(s) };
    const child = logger.child({}, { stream });
    child.info({ password: 'super-secret', other: 'visible' }, 'event');
    const out = captured.join('');
    expect(out).toContain('[REDACTED]');
    expect(out).not.toContain('super-secret');
    expect(out).toContain('visible');
  });
});
