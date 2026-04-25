import { describe, it, expect, beforeEach, vi } from 'vitest';
import pino from 'pino';

describe('logger redaction', () => {
  beforeEach(() => {
    vi.resetModules();
    // process.env est typé readonly par Next.js — cast pour le harnais tests.
    const env = process.env as Record<string, string | undefined>;
    env['NODE_ENV'] = 'production';
    env['LOG_LEVEL'] = 'info';
    env['APP_URL'] = 'http://localhost:3000';
    env['DATABASE_URL'] = 'postgresql://x:x@localhost:5432/x';
    env['REDIS_URL'] = 'redis://localhost:6379';
    env['MEILI_HOST'] = 'http://localhost:7700';
    env['MEILI_MASTER_KEY'] = 'abcdefghijklmnop';
    env['SESSION_SECRET'] = '0'.repeat(32);
    env['CRYPTO_MASTER_KEY'] = '1'.repeat(32);
  });

  it('redacte les champs sensibles dans les logs', async () => {
    // Pino v10 : logger.child() ne permet plus d'injecter un stream custom.
    // On reconstruit donc une instance pino avec la même configuration de
    // redaction (importée depuis la source de production) et on la branche
    // sur un stream capturant — cela vérifie l'invariant réel.
    const { LOGGER_REDACT } = await import('@/lib/logger');
    const captured: string[] = [];
    const stream = { write: (s: string) => captured.push(s) };
    const testLogger = pino({ level: 'info', redact: LOGGER_REDACT }, stream);
    testLogger.info({ password: 'super-secret', other: 'visible' }, 'event');
    const out = captured.join('');
    expect(out).toContain('[REDACTED]');
    expect(out).not.toContain('super-secret');
    expect(out).toContain('visible');
  });
});
