import '@testing-library/jest-dom/vitest';

// Variables d'env minimales pour les tests qui chargent src/lib/env.ts.
// On caste process.env en Record mutable car les types Next.js marquent
// NODE_ENV comme readonly — ce qui est correct en runtime app, mais inutile
// dans le harnais de tests.
const env = process.env as Record<string, string | undefined>;
env['NODE_ENV'] ??= 'test';
env['APP_URL'] ??= 'http://localhost:3000';
env['DATABASE_URL'] ??= 'postgresql://test:test@localhost:5432/test';
env['REDIS_URL'] ??= 'redis://localhost:6379';
env['MEILI_HOST'] ??= 'http://localhost:7700';
env['MEILI_MASTER_KEY'] ??= '0'.repeat(32);
env['SESSION_SECRET'] ??= '0'.repeat(32);
env['CRYPTO_MASTER_KEY'] ??= '1'.repeat(32);
env['EMAIL_TRANSPORT'] ??= 'smtp';
env['EMAIL_FROM'] ??= 'BiblioShare <test@biblio.test>';
env['SMTP_HOST'] ??= '127.0.0.1';
env['SMTP_PORT'] ??= '1';
env['EMAIL_LOG_SALT'] ??= 'test-email-log-salt-32-chars-min!';
