# Phase 1A — Auth Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer un système d'auth password+TOTP pour BiblioShare avec un Admin global créé via CLI, protégé par 2FA forcé après 7 jours, sessions DB hardenées, rate limiting, AuditLog branché, et permissions à 3 couches.

**Architecture:** Auth.js v5 + Credentials provider + adapter Prisma custom. Pattern two-step pour 2FA (cookie `pending2fa` 5 min → upgrade session full avec regen ID). Modules `lib/*` purs (testables sans DB) séparés du `server/*` (tRPC + Auth.js). Defense in depth : middleware Next + middlewares tRPC + assertCan* + lint rule Prisma scope.

**Tech Stack:** Next.js 15 + Auth.js v5 (next-auth@5) + Prisma 6 + Postgres 16 + Redis 7 + ioredis + Vitest 4 + testcontainers + Playwright + otplib + @node-rs/argon2 + rate-limiter-flexible + zod + pino.

**Spec source:** `docs/superpowers/specs/2026-04-26-phase-1-auth-design.md` — sous-phase 1A.

**Branch:** `feat/phase-1a-auth-core` (créée en Task 0).

**Scope :** uniquement la sous-phase 1A. Les sous-phases 1B (invitations + reset) et 1C (panel Admin + matrice complète) auront chacune leur propre plan.

---

## Task 0: Setup branche et dépendances

**Files:**
- Modify: `package.json` (deps + scripts)
- Modify: `vitest.config.ts` (ajout tier integration)
- Create: `vitest.integration.config.ts`
- Create: `tests/integration/setup/containers.ts`
- Create: `tests/integration/setup/prisma.ts`

- [ ] **Step 0.1: Créer la branche de travail**

```bash
git checkout -b feat/phase-1a-auth-core
git status
```

Expected: branche créée, working tree propre.

- [ ] **Step 0.2: Installer les dépendances runtime**

```bash
pnpm add next-auth@beta @node-rs/argon2 otplib qrcode rate-limiter-flexible
```

Expected: 5 packages ajoutés à `dependencies`. `next-auth` doit être `5.0.0-beta.x`.

- [ ] **Step 0.3: Installer les dépendances dev**

```bash
pnpm add -D tsx @types/qrcode @testcontainers/postgresql @testcontainers/redis testcontainers
```

Expected: 5 packages ajoutés à `devDependencies`.

- [ ] **Step 0.4: Ajouter les scripts npm**

Modifier `package.json` section `"scripts"` :

```json
"test:integration": "vitest run --config vitest.integration.config.ts",
"test:integration:watch": "vitest --config vitest.integration.config.ts",
"bootstrap:admin": "tsx scripts/bootstrap-admin.ts"
```

- [ ] **Step 0.5: Créer `vitest.integration.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/integration/**/*.test.ts', 'tests/attacks/**/*.test.ts'],
    setupFiles: ['./tests/integration/setup/containers.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
```

- [ ] **Step 0.6: Créer `tests/integration/setup/containers.ts`**

```ts
import { afterAll, beforeAll } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { execSync } from 'node:child_process';

let pg: StartedPostgreSqlContainer;
let redis: StartedRedisContainer;

beforeAll(async () => {
  pg = await new PostgreSqlContainer('postgres:16-alpine').start();
  redis = await new RedisContainer('redis:7-alpine').start();

  process.env.DATABASE_URL = pg.getConnectionUri();
  process.env.REDIS_URL = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
  process.env.SESSION_SECRET = 'test-session-secret-32-chars-min!';
  process.env.CRYPTO_MASTER_KEY = 'test-crypto-master-key-32-chars-min!';
  process.env.APP_URL = 'http://localhost:3000';
  process.env.MEILI_HOST = 'http://localhost:7700';
  process.env.MEILI_MASTER_KEY = 'test-meili-master-key-16chars';
  process.env.NODE_ENV = 'test';

  execSync('pnpm prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    stdio: 'inherit',
  });
});

afterAll(async () => {
  await pg?.stop();
  await redis?.stop();
});
```

- [ ] **Step 0.7: Créer `tests/integration/setup/prisma.ts` (helpers)**

```ts
import { PrismaClient } from '@prisma/client';

let _client: PrismaClient | undefined;

export function getTestPrisma(): PrismaClient {
  if (!_client) _client = new PrismaClient();
  return _client;
}

export async function truncateAll(): Promise<void> {
  const prisma = getTestPrisma();
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != '_prisma_migrations'
  `;
  if (tables.length === 0) return;
  const names = tables.map((t) => `"${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`);
}
```

- [ ] **Step 0.8: Vérifier que les tests existants passent**

```bash
pnpm test
pnpm typecheck
```

Expected: tests unit existants verts, types OK.

- [ ] **Step 0.9: Commit setup**

```bash
git add package.json pnpm-lock.yaml vitest.integration.config.ts tests/integration/
git commit -m "chore(phase-1a): add deps and integration test harness"
```

---

## Task 1: lib/crypto.ts — AES-256-GCM, HMAC, hash IP/UA salés

**Files:**
- Create: `src/lib/crypto.ts`
- Create: `tests/unit/crypto.test.ts`
- Modify: `src/lib/env.ts` (ajout `IP_HASH_SALT`, `UA_HASH_SALT`)

- [ ] **Step 1.1: Étendre `env.ts` avec les sels de hash**

Modifier `src/lib/env.ts`, ajouter dans `EnvSchema` :

```ts
// Sels rotatifs pour hash IP/UA (mitigation H2 RGPD). Statiques en Phase 1A,
// rotation = Phase 8.
IP_HASH_SALT: z.string().min(16),
UA_HASH_SALT: z.string().min(16),
```

- [ ] **Step 1.2: Mettre à jour `.env.example`**

Ajouter dans `.env.example` :

```
# Sels de hash pour anonymisation IP/UA (rotation manuelle 30j en Phase 1A)
IP_HASH_SALT=change-me-min-16-chars-random
UA_HASH_SALT=change-me-min-16-chars-random
```

Et dans `.env.local` (en local) :

```
IP_HASH_SALT=dev-ip-salt-do-not-use-in-prod
UA_HASH_SALT=dev-ua-salt-do-not-use-in-prod
```

- [ ] **Step 1.3: Écrire les tests unitaires**

Créer `tests/unit/crypto.test.ts` :

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { encryptSecret, decryptSecret, hashIp, hashUa, hmac, constantTimeEqual } from '@/lib/crypto';

beforeAll(() => {
  process.env.CRYPTO_MASTER_KEY = 'a'.repeat(32);
  process.env.IP_HASH_SALT = 'salt-for-ip-1234';
  process.env.UA_HASH_SALT = 'salt-for-ua-1234';
});

describe('AES-256-GCM round-trip', () => {
  it('chiffre puis déchiffre correctement', () => {
    const plain = 'JBSWY3DPEHPK3PXP'; // exemple secret TOTP
    const cipher = encryptSecret(plain);
    expect(cipher).not.toBe(plain);
    expect(cipher).toMatch(/^[A-Za-z0-9+/=:]+$/);
    expect(decryptSecret(cipher)).toBe(plain);
  });

  it('produit des chiffrés différents (nonce unique) pour la même entrée', () => {
    const a = encryptSecret('same-input');
    const b = encryptSecret('same-input');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe('same-input');
    expect(decryptSecret(b)).toBe('same-input');
  });

  it('refuse un chiffré altéré (auth tag check)', () => {
    const cipher = encryptSecret('payload');
    const tampered = cipher.slice(0, -2) + 'XX';
    expect(() => decryptSecret(tampered)).toThrow();
  });
});

describe('hashIp / hashUa', () => {
  it('hash IP déterministe avec le même sel', () => {
    expect(hashIp('192.168.1.1')).toBe(hashIp('192.168.1.1'));
  });

  it('hash IP différent pour des IPs différentes', () => {
    expect(hashIp('192.168.1.1')).not.toBe(hashIp('192.168.1.2'));
  });

  it('hash UA tronqué (collision-resistant mais non-réversible)', () => {
    const h = hashUa('Mozilla/5.0 (X11; Linux x86_64) ...');
    expect(h).toMatch(/^[a-f0-9]{32}$/);
  });
});

describe('hmac', () => {
  it('produit le même HMAC pour la même entrée + clé', () => {
    expect(hmac('msg', 'key')).toBe(hmac('msg', 'key'));
  });
  it('HMAC différent pour clés différentes', () => {
    expect(hmac('msg', 'k1')).not.toBe(hmac('msg', 'k2'));
  });
});

describe('constantTimeEqual', () => {
  it('renvoie true pour strings égales', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
  });
  it('renvoie false pour strings différentes', () => {
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
  });
  it('renvoie false pour longueurs différentes', () => {
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });
});
```

- [ ] **Step 1.4: Lancer les tests, vérifier qu'ils échouent**

```bash
pnpm test tests/unit/crypto.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/crypto'`.

- [ ] **Step 1.5: Implémenter `src/lib/crypto.ts`**

```ts
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getEnv } from './env';

const ALGO = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function deriveKey(): Buffer {
  const masterKey = getEnv().CRYPTO_MASTER_KEY;
  return createHash('sha256').update(masterKey).digest().subarray(0, KEY_LENGTH);
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, deriveKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':');
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(':');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Invalid cipher payload');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const decipher = createDecipheriv(ALGO, deriveKey(), iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
}

export function hashIp(ip: string): string {
  const salt = getEnv().IP_HASH_SALT;
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex');
}

export function hashUa(ua: string): string {
  const salt = getEnv().UA_HASH_SALT;
  return createHash('sha256').update(`${salt}:${ua}`).digest('hex').slice(0, 32);
}

export function hmac(message: string, key: string): string {
  return createHmac('sha256', key).update(message).digest('hex');
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return timingSafeEqual(ba, bb);
}
```

- [ ] **Step 1.6: Lancer les tests, vérifier qu'ils passent**

```bash
pnpm test tests/unit/crypto.test.ts
```

Expected: PASS — 11 tests verts.

- [ ] **Step 1.7: Commit**

```bash
git add src/lib/crypto.ts src/lib/env.ts tests/unit/crypto.test.ts .env.example .env.local
git commit -m "feat(crypto): add AES-256-GCM, HMAC, salted IP/UA hashing"
```

---

## Task 2: lib/tokens.ts — génération + hash + verify de tokens 32 octets

**Files:**
- Create: `src/lib/tokens.ts`
- Create: `tests/unit/tokens.test.ts`

- [ ] **Step 2.1: Écrire les tests**

Créer `tests/unit/tokens.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { generateRawToken, hashToken, verifyToken } from '@/lib/tokens';

describe('generateRawToken', () => {
  it('génère un token base64url 32 octets (≥ 43 chars)', () => {
    const t = generateRawToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(t.length).toBeGreaterThanOrEqual(43);
  });

  it('génère des tokens uniques sur 1000 itérations', () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) set.add(generateRawToken());
    expect(set.size).toBe(1000);
  });
});

describe('hashToken / verifyToken', () => {
  it('vérifie correctement un token valide', async () => {
    const raw = generateRawToken();
    const hash = await hashToken(raw);
    expect(hash).not.toBe(raw);
    await expect(verifyToken(raw, hash)).resolves.toBe(true);
  });

  it('rejette un token altéré', async () => {
    const raw = generateRawToken();
    const hash = await hashToken(raw);
    const tampered = raw.slice(0, -2) + 'XX';
    await expect(verifyToken(tampered, hash)).resolves.toBe(false);
  });

  it('rejette un hash altéré', async () => {
    const raw = generateRawToken();
    const hash = await hashToken(raw);
    const tampered = hash.slice(0, -2) + 'XX';
    await expect(verifyToken(raw, tampered)).resolves.toBe(false);
  });
});
```

- [ ] **Step 2.2: Vérifier l'échec**

```bash
pnpm test tests/unit/tokens.test.ts
```

Expected: FAIL — module manquant.

- [ ] **Step 2.3: Implémenter `src/lib/tokens.ts`**

```ts
import { randomBytes } from 'node:crypto';
import { hash, verify, Algorithm } from '@node-rs/argon2';

const ARGON_OPTS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export function generateRawToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(raw: string): Promise<string> {
  return hash(raw, ARGON_OPTS);
}

export async function verifyToken(raw: string, storedHash: string): Promise<boolean> {
  try {
    return await verify(storedHash, raw, ARGON_OPTS);
  } catch {
    return false;
  }
}
```

- [ ] **Step 2.4: Vérifier que les tests passent**

```bash
pnpm test tests/unit/tokens.test.ts
```

Expected: PASS — 5 tests verts.

- [ ] **Step 2.5: Commit**

```bash
git add src/lib/tokens.ts tests/unit/tokens.test.ts
git commit -m "feat(tokens): add 32-byte token gen + argon2id hash/verify"
```

---

## Task 3: lib/password.ts — wrapper argon2id

**Files:**
- Create: `src/lib/password.ts`
- Create: `tests/unit/password.test.ts`

- [ ] **Step 3.1: Écrire les tests**

Créer `tests/unit/password.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '@/lib/password';

describe('hashPassword / verifyPassword', () => {
  it('produit un hash argon2id (préfixe $argon2id$)', async () => {
    const h = await hashPassword('correct horse battery staple');
    expect(h).toMatch(/^\$argon2id\$/);
  });

  it('verify accepte le bon mot de passe', async () => {
    const h = await hashPassword('s3cret-passphrase!');
    await expect(verifyPassword(h, 's3cret-passphrase!')).resolves.toBe(true);
  });

  it('verify refuse un mauvais mot de passe', async () => {
    const h = await hashPassword('s3cret-passphrase!');
    await expect(verifyPassword(h, 'wrong')).resolves.toBe(false);
  });

  it('verify refuse un hash altéré sans throw', async () => {
    const h = await hashPassword('x');
    const tampered = h.slice(0, -2) + 'XX';
    await expect(verifyPassword(tampered, 'x')).resolves.toBe(false);
  });
});
```

- [ ] **Step 3.2: Vérifier l'échec**

```bash
pnpm test tests/unit/password.test.ts
```

Expected: FAIL.

- [ ] **Step 3.3: Implémenter `src/lib/password.ts`**

```ts
import { hash, verify, Algorithm } from '@node-rs/argon2';

const PARAMS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, PARAMS);
}

export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain, PARAMS);
  } catch {
    return false;
  }
}
```

- [ ] **Step 3.4: Vérifier que les tests passent**

```bash
pnpm test tests/unit/password.test.ts
```

Expected: PASS — 4 tests verts.

- [ ] **Step 3.5: Commit**

```bash
git add src/lib/password.ts tests/unit/password.test.ts
git commit -m "feat(password): add argon2id password hash + verify"
```

---

## Task 4: lib/totp.ts — TOTP enrolment + verify + backup codes

**Files:**
- Create: `src/lib/totp.ts`
- Create: `tests/unit/totp.test.ts`

- [ ] **Step 4.1: Écrire les tests**

Créer `tests/unit/totp.test.ts` :

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { authenticator } from 'otplib';
import {
  generateTotpSecret,
  buildTotpUri,
  verifyTotpCode,
  generateBackupCodes,
  hashBackupCodes,
  consumeBackupCode,
} from '@/lib/totp';

beforeAll(() => {
  process.env.CRYPTO_MASTER_KEY = 'a'.repeat(32);
  process.env.IP_HASH_SALT = 'b'.repeat(16);
  process.env.UA_HASH_SALT = 'c'.repeat(16);
});

describe('generateTotpSecret', () => {
  it('produit un secret base32 ≥ 16 chars', () => {
    const s = generateTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]+$/);
    expect(s.length).toBeGreaterThanOrEqual(16);
  });

  it('produit des secrets uniques', () => {
    expect(generateTotpSecret()).not.toBe(generateTotpSecret());
  });
});

describe('buildTotpUri', () => {
  it('produit un otpauth:// URI valide', () => {
    const uri = buildTotpUri({ secret: 'JBSWY3DPEHPK3PXP', accountName: 'admin@x.test' });
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain('issuer=BiblioShare');
    expect(uri).toContain('admin%40x.test');
  });
});

describe('verifyTotpCode', () => {
  it('accepte un code généré pour le secret', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const code = authenticator.generate(secret);
    expect(verifyTotpCode(secret, code)).toBe(true);
  });

  it('refuse un code aléatoire', () => {
    expect(verifyTotpCode('JBSWY3DPEHPK3PXP', '000000')).toBe(false);
  });

  it('refuse un code de mauvaise longueur', () => {
    expect(verifyTotpCode('JBSWY3DPEHPK3PXP', '12345')).toBe(false);
  });
});

describe('backup codes', () => {
  it('génère 8 codes alphanumériques uniques', () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    codes.forEach((c) => expect(c).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/));
  });

  it('hashe les 8 codes', async () => {
    const codes = generateBackupCodes();
    const hashes = await hashBackupCodes(codes);
    expect(hashes).toHaveLength(8);
    hashes.forEach((h) => expect(h).toMatch(/^\$argon2id\$/));
  });

  it('consumeBackupCode retire le code consommé et renvoie les hashes restants', async () => {
    const codes = generateBackupCodes();
    const hashes = await hashBackupCodes(codes);
    const result = await consumeBackupCode(codes[0], hashes);
    expect(result).not.toBeNull();
    expect(result!.remainingHashes).toHaveLength(7);
  });

  it('consumeBackupCode renvoie null pour un code invalide', async () => {
    const codes = generateBackupCodes();
    const hashes = await hashBackupCodes(codes);
    const result = await consumeBackupCode('XXXX-XXXX', hashes);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 4.2: Vérifier l'échec**

```bash
pnpm test tests/unit/totp.test.ts
```

Expected: FAIL.

- [ ] **Step 4.3: Implémenter `src/lib/totp.ts`**

```ts
import { authenticator } from 'otplib';
import { randomBytes } from 'node:crypto';
import { hash as argonHash, verify as argonVerify, Algorithm } from '@node-rs/argon2';

authenticator.options = { window: 1, step: 30 };

const ARGON_OPTS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

const ISSUER = 'BiblioShare';

export function generateTotpSecret(): string {
  return authenticator.generateSecret(20);
}

export function buildTotpUri(input: { secret: string; accountName: string }): string {
  return authenticator.keyuri(input.accountName, ISSUER, input.secret);
}

export function verifyTotpCode(secret: string, code: string): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  try {
    return authenticator.verify({ token: code, secret });
  } catch {
    return false;
  }
}

function randomSegment(len: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export function generateBackupCodes(): string[] {
  const codes = new Set<string>();
  while (codes.size < 8) codes.add(`${randomSegment(4)}-${randomSegment(4)}`);
  return [...codes];
}

export async function hashBackupCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map((c) => argonHash(c, ARGON_OPTS)));
}

export async function consumeBackupCode(
  attempt: string,
  storedHashes: string[],
): Promise<{ remainingHashes: string[] } | null> {
  for (let i = 0; i < storedHashes.length; i++) {
    const ok = await argonVerify(storedHashes[i], attempt, ARGON_OPTS).catch(() => false);
    if (ok) {
      const remaining = [...storedHashes.slice(0, i), ...storedHashes.slice(i + 1)];
      return { remainingHashes: remaining };
    }
  }
  return null;
}
```

- [ ] **Step 4.4: Vérifier que les tests passent**

```bash
pnpm test tests/unit/totp.test.ts
```

Expected: PASS — 10 tests verts.

- [ ] **Step 4.5: Commit**

```bash
git add src/lib/totp.ts tests/unit/totp.test.ts
git commit -m "feat(totp): add TOTP secret/uri/verify + 8 backup codes lifecycle"
```

---

## Task 5: Migration Prisma 002_phase1_auth

**Files:**
- Modify: `prisma/schema.prisma` (Session, VerificationToken, modifs Invitation/AuditLog/User)
- Create: `prisma/migrations/<timestamp>_phase1_auth/migration.sql` (généré)

- [ ] **Step 5.1: Modifier `prisma/schema.prisma` — Invitation**

Trouver le modèle `Invitation`, modifier `consumedById` (retirer `@unique`) et ajouter 2 index :

```prisma
model Invitation {
  id            String       @id @default(cuid())
  email         String       @db.Citext
  invitedById   String
  invitedBy     User         @relation("InvitedBy", fields: [invitedById], references: [id])
  libraryId     String?
  library       Library?     @relation(fields: [libraryId], references: [id], onDelete: SetNull)
  proposedRole  LibraryRole?
  tokenHash     String       @unique
  expiresAt     DateTime
  consumedAt    DateTime?
  consumedById  String?
  consumedBy    User?        @relation("ConsumedBy", fields: [consumedById], references: [id])
  createdAt     DateTime     @default(now())

  @@index([email])
  @@index([consumedById])
  @@index([expiresAt])
}
```

Et dans `User`, retirer `@unique` sur la relation `invitationConsumed` :

```prisma
invitationConsumed Invitation[]      @relation("ConsumedBy")
```

(Note : ce passage de `Invitation?` à `Invitation[]` est nécessaire car un user peut maintenant consommer plusieurs invitations.)

- [ ] **Step 5.2: Modifier `prisma/schema.prisma` — AuditLog**

```prisma
model AuditLog {
  id         String   @id @default(cuid())
  actorId    String?
  actor      User?    @relation(fields: [actorId], references: [id], onDelete: SetNull)
  action     String
  targetType String?
  targetId   String?
  metadata   Json?
  ipHash     String?
  userAgent  String?
  createdAt  DateTime @default(now())

  @@index([actorId, createdAt])
  @@index([action, createdAt])
  @@index([targetType, targetId])
}
```

- [ ] **Step 5.3: Modifier `prisma/schema.prisma` — User**

Ajouter dans le modèle `User` (après `lastLoginAt`) :

```prisma
  failedLoginAttempts Int       @default(0)
  lockedUntil         DateTime?
  sessions            Session[]
```

- [ ] **Step 5.4: Ajouter les modèles `Session` et `VerificationToken`**

Après le modèle `User`, ajouter :

```prisma
model Session {
  id             String   @id @default(cuid())
  sessionToken   String   @unique
  userId         String
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt      DateTime
  lastActivityAt DateTime @default(now())
  ipHash         String
  userAgentHash  String
  pending2fa     Boolean  @default(false)
  createdAt      DateTime @default(now())

  @@index([userId])
  @@index([expiresAt])
}

model VerificationToken {
  identifier String
  tokenHash  String   @unique
  expiresAt  DateTime

  @@id([identifier, tokenHash])
}
```

- [ ] **Step 5.5: Générer la migration**

```bash
pnpm prisma migrate dev --name phase1_auth
```

Expected: nouvelle migration créée dans `prisma/migrations/<timestamp>_phase1_auth/`. Inspecter le SQL pour vérifier qu'il contient :
- `CREATE TABLE "Session"`, `CREATE TABLE "VerificationToken"`
- `ALTER TABLE "Invitation" DROP CONSTRAINT` (l'unique sur consumedById)
- `ALTER TABLE "AuditLog" ALTER COLUMN "targetType" DROP NOT NULL`
- `ALTER TABLE "User" ADD COLUMN "failedLoginAttempts"`, `ADD COLUMN "lockedUntil"`

- [ ] **Step 5.6: Vérifier la cohérence des types Prisma**

```bash
pnpm prisma generate
pnpm typecheck
```

Expected: types regénérés, aucune erreur TS.

- [ ] **Step 5.7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(db): add Session, VerificationToken, User lockout fields, AuditLog nullables"
```

---

## Task 6: lib/audit-log.ts — service writer typé (integration tests)

**Files:**
- Create: `src/lib/audit-log.ts`
- Create: `tests/integration/audit-log.test.ts`

- [ ] **Step 6.1: Écrire les tests d'intégration**

Créer `tests/integration/audit-log.test.ts` :

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { recordAudit } from '@/lib/audit-log';
import { getTestPrisma, truncateAll } from './setup/prisma';

const prisma = getTestPrisma();

beforeEach(async () => {
  await truncateAll();
});

describe('recordAudit', () => {
  it('insère une ligne avec action seule (pas d\'actor, pas de target)', async () => {
    await recordAudit({ action: 'auth.login.failure', metadata: { reason: 'unknown' } });
    const rows = await prisma.auditLog.findMany({ where: { action: 'auth.login.failure' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].actorId).toBeNull();
    expect(rows[0].targetType).toBeNull();
    expect(rows[0].metadata).toEqual({ reason: 'unknown' });
  });

  it('hashe l\'IP avant de stocker', async () => {
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

  it('n\'arrête pas l\'action user en cas d\'erreur DB (mode non-bloquant par défaut)', async () => {
    // Action inconnue → toujours acceptée car le type AuditAction est lâche au runtime
    // (la garantie est compile-time). Ce test vérifie qu'aucune exception ne remonte.
    await expect(recordAudit({ action: 'auth.login.success' })).resolves.toBeUndefined();
  });

  it('mode bloquant : permission.denied propage l\'erreur si la DB échoue', async () => {
    // On ferme la connexion à la DB pour simuler une panne
    const broken = getTestPrisma();
    await broken.$disconnect();
    await expect(
      recordAudit({ action: 'permission.denied', actor: { id: 'fake' } }),
    ).rejects.toThrow();
    await broken.$connect();
  });
});
```

- [ ] **Step 6.2: Vérifier l'échec**

```bash
pnpm test:integration tests/integration/audit-log.test.ts
```

Expected: FAIL.

- [ ] **Step 6.3: Implémenter `src/lib/audit-log.ts`**

```ts
import { db } from './db';
import { hashIp } from './crypto';
import { getLogger } from './logger';

export type AuditAction =
  // 1A
  | 'auth.login.success' | 'auth.login.failure' | 'auth.login.locked'
  | 'auth.session.created' | 'auth.session.revoked' | 'auth.session.expired'
  | 'auth.2fa.enrolled' | 'auth.2fa.disabled' | 'auth.2fa.success' | 'auth.2fa.failure'
  | 'auth.2fa.backup_code_used' | 'auth.2fa.recovery_codes_regenerated'
  | 'permission.denied'
  // 1B (déclarés ici dès maintenant pour éviter une migration d'union plus tard)
  | 'auth.password.reset_requested' | 'auth.password.reset_consumed' | 'auth.password.changed'
  | 'auth.invitation.created' | 'auth.invitation.consumed'
  | 'auth.invitation.expired' | 'auth.invitation.revoked'
  // 1C
  | 'admin.user.suspended' | 'admin.user.reactivated'
  | 'admin.user.deleted' | 'admin.user.role_changed';

export type AuditTargetType = 'USER' | 'LIBRARY' | 'INVITATION' | 'SESSION' | 'EMAIL' | 'AUTH';

const SENSITIVE_KEYS = new Set([
  'password', 'passwordHash', 'token', 'tokenHash', 'secret', 'secretCipher',
  'authorization', 'cookie', 'sessionToken',
]);

function redact(input: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!input) return input;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    out[k] = SENSITIVE_KEYS.has(k) ? '[REDACTED]' : v;
  }
  return out;
}

const BLOCKING_ACTIONS = new Set<AuditAction>(['permission.denied', 'auth.2fa.failure']);

export async function recordAudit(input: {
  action: AuditAction;
  actor?: { id: string };
  target?: { type: AuditTargetType; id: string };
  metadata?: Record<string, unknown>;
  req?: { ip?: string; userAgent?: string };
}): Promise<void> {
  const log = getLogger();
  const data = {
    action: input.action,
    actorId: input.actor?.id ?? null,
    targetType: input.target?.type ?? null,
    targetId: input.target?.id ?? null,
    metadata: redact(input.metadata) as object | undefined,
    ipHash: input.req?.ip ? hashIp(input.req.ip) : null,
    userAgent: input.req?.userAgent ?? null,
  };

  if (BLOCKING_ACTIONS.has(input.action)) {
    await db.auditLog.create({ data });
    return;
  }

  try {
    await db.auditLog.create({ data });
  } catch (err) {
    log.error({ err, action: input.action }, 'audit log write failed (non-blocking)');
  }
}
```

- [ ] **Step 6.4: Vérifier que les tests passent**

```bash
pnpm test:integration tests/integration/audit-log.test.ts
```

Expected: PASS — 5 tests verts.

- [ ] **Step 6.5: Commit**

```bash
git add src/lib/audit-log.ts tests/integration/audit-log.test.ts
git commit -m "feat(audit): add typed AuditLog writer with redact and blocking modes"
```

---

## Task 7: lib/rate-limit.ts — 4 limiteurs (login, 2fa, reset, invitation)

**Files:**
- Create: `src/lib/rate-limit.ts`
- Create: `tests/integration/rate-limit.test.ts`

- [ ] **Step 7.1: Écrire les tests d'intégration**

Créer `tests/integration/rate-limit.test.ts` :

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { loginLimiter, twoFactorLimiter, resetRequestLimiter, invitationLimiter } from '@/lib/rate-limit';

describe('loginLimiter', () => {
  beforeEach(async () => {
    await loginLimiter.delete('test:user@x.test');
  });

  it('autorise 5 tentatives sur 15 min', async () => {
    for (let i = 0; i < 5; i++) {
      await expect(loginLimiter.consume('test:user@x.test')).resolves.toBeDefined();
    }
  });

  it('refuse la 6ᵉ tentative', async () => {
    for (let i = 0; i < 5; i++) await loginLimiter.consume('test:user@x.test');
    await expect(loginLimiter.consume('test:user@x.test')).rejects.toBeDefined();
  });

  it('reset autorise à nouveau', async () => {
    for (let i = 0; i < 5; i++) await loginLimiter.consume('test:user@x.test');
    await loginLimiter.delete('test:user@x.test');
    await expect(loginLimiter.consume('test:user@x.test')).resolves.toBeDefined();
  });
});

describe('twoFactorLimiter', () => {
  beforeEach(async () => {
    await twoFactorLimiter.delete('session-id-test');
  });

  it('autorise 5 codes en 5 min', async () => {
    for (let i = 0; i < 5; i++) await twoFactorLimiter.consume('session-id-test');
    await expect(twoFactorLimiter.consume('session-id-test')).rejects.toBeDefined();
  });
});

describe('resetRequestLimiter', () => {
  beforeEach(async () => {
    await resetRequestLimiter.delete('reset@x.test');
  });

  it('autorise 3 demandes par heure', async () => {
    for (let i = 0; i < 3; i++) await resetRequestLimiter.consume('reset@x.test');
    await expect(resetRequestLimiter.consume('reset@x.test')).rejects.toBeDefined();
  });
});

describe('invitationLimiter', () => {
  beforeEach(async () => {
    await invitationLimiter.delete('user-id-1');
  });

  it('autorise 10 invitations par heure', async () => {
    for (let i = 0; i < 10; i++) await invitationLimiter.consume('user-id-1');
    await expect(invitationLimiter.consume('user-id-1')).rejects.toBeDefined();
  });
});
```

- [ ] **Step 7.2: Vérifier l'échec**

```bash
pnpm test:integration tests/integration/rate-limit.test.ts
```

Expected: FAIL.

- [ ] **Step 7.3: Implémenter `src/lib/rate-limit.ts`**

```ts
import { RateLimiterRedis, RateLimiterMemory } from 'rate-limiter-flexible';
import { getRedis } from './redis';

const memInsurance = (points: number, duration: number) =>
  new RateLimiterMemory({ points, duration });

const baseOpts = () => ({ storeClient: getRedis(), useRedisPackage: true });

export const loginLimiter = new RateLimiterRedis({
  ...baseOpts(),
  keyPrefix: 'rl:login',
  points: 5,
  duration: 15 * 60,
  blockDuration: 60 * 60,
  insuranceLimiter: memInsurance(5, 15 * 60),
});

export const twoFactorLimiter = new RateLimiterRedis({
  ...baseOpts(),
  keyPrefix: 'rl:2fa',
  points: 5,
  duration: 5 * 60,
  blockDuration: 15 * 60,
  insuranceLimiter: memInsurance(5, 5 * 60),
});

export const resetRequestLimiter = new RateLimiterRedis({
  ...baseOpts(),
  keyPrefix: 'rl:reset',
  points: 3,
  duration: 60 * 60,
  insuranceLimiter: memInsurance(3, 60 * 60),
});

export const invitationLimiter = new RateLimiterRedis({
  ...baseOpts(),
  keyPrefix: 'rl:invite',
  points: 10,
  duration: 60 * 60,
  insuranceLimiter: memInsurance(10, 60 * 60),
});
```

- [ ] **Step 7.4: Vérifier que les tests passent**

```bash
pnpm test:integration tests/integration/rate-limit.test.ts
```

Expected: PASS.

- [ ] **Step 7.5: Commit**

```bash
git add src/lib/rate-limit.ts tests/integration/rate-limit.test.ts
git commit -m "feat(rate-limit): add 4 limiters (login/2fa/reset/invite) with memory insurance"
```

---

## Task 8: lib/permissions.ts — assertCan* Phase 1A subset

**Files:**
- Create: `src/lib/permissions.ts`
- Create: `tests/integration/permissions.test.ts`

- [ ] **Step 8.1: Écrire les tests d'intégration**

Créer `tests/integration/permissions.test.ts` :

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { assertIsGlobalAdmin, assertGlobalAdmin2faTimerOk, PermissionError } from '@/lib/permissions';
import { getTestPrisma, truncateAll } from './setup/prisma';
import { hashPassword } from '@/lib/password';

const prisma = getTestPrisma();

async function makeUser(opts: Partial<{ role: 'GLOBAL_ADMIN' | 'USER'; twoFactorEnabled: boolean; createdAt: Date }>) {
  return prisma.user.create({
    data: {
      email: `u-${Date.now()}-${Math.random()}@x.test`,
      displayName: 'X',
      passwordHash: await hashPassword('x'),
      role: opts.role ?? 'USER',
      twoFactorEnabled: opts.twoFactorEnabled ?? false,
      createdAt: opts.createdAt ?? new Date(),
    },
  });
}

beforeEach(async () => {
  await truncateAll();
});

describe('assertIsGlobalAdmin', () => {
  it('passe pour un GLOBAL_ADMIN', async () => {
    const u = await makeUser({ role: 'GLOBAL_ADMIN' });
    expect(() => assertIsGlobalAdmin(u)).not.toThrow();
  });

  it('jette PermissionError + log audit pour un USER', async () => {
    const u = await makeUser({ role: 'USER' });
    expect(() => assertIsGlobalAdmin(u)).toThrow(PermissionError);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'permission.denied' } });
    expect(audit).not.toBeNull();
    expect(audit?.actorId).toBe(u.id);
  });
});

describe('assertGlobalAdmin2faTimerOk', () => {
  it('passe si twoFactorEnabled', async () => {
    const u = await makeUser({ role: 'GLOBAL_ADMIN', twoFactorEnabled: true });
    await expect(assertGlobalAdmin2faTimerOk(u)).resolves.toBeUndefined();
  });

  it('passe si !twoFactorEnabled mais < 7j', async () => {
    const u = await makeUser({ role: 'GLOBAL_ADMIN', twoFactorEnabled: false });
    await expect(assertGlobalAdmin2faTimerOk(u)).resolves.toBeUndefined();
  });

  it('jette si !twoFactorEnabled et > 7j', async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 3600 * 1000);
    const u = await makeUser({ role: 'GLOBAL_ADMIN', twoFactorEnabled: false, createdAt: eightDaysAgo });
    await expect(assertGlobalAdmin2faTimerOk(u)).rejects.toThrow(PermissionError);
  });
});
```

- [ ] **Step 8.2: Vérifier l'échec**

```bash
pnpm test:integration tests/integration/permissions.test.ts
```

Expected: FAIL.

- [ ] **Step 8.3: Implémenter `src/lib/permissions.ts`**

```ts
import type { User } from '@prisma/client';
import { recordAudit } from './audit-log';

export const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;

export class PermissionError extends Error {
  constructor(public readonly perm: string) {
    super(`permission denied: ${perm}`);
    this.name = 'PermissionError';
  }
}

export function assertIsGlobalAdmin(actor: Pick<User, 'id' | 'role'>): asserts actor is User & { role: 'GLOBAL_ADMIN' } {
  if (actor.role !== 'GLOBAL_ADMIN') {
    void recordAudit({
      action: 'permission.denied',
      actor: { id: actor.id },
      metadata: { required: 'GLOBAL_ADMIN' },
    });
    throw new PermissionError('global_admin_required');
  }
}

export async function assertGlobalAdmin2faTimerOk(
  actor: Pick<User, 'id' | 'role' | 'twoFactorEnabled' | 'createdAt'>,
): Promise<void> {
  if (actor.role !== 'GLOBAL_ADMIN') return;
  if (actor.twoFactorEnabled) return;
  const elapsed = Date.now() - actor.createdAt.getTime();
  if (elapsed <= SEVEN_DAYS_MS) return;
  await recordAudit({
    action: 'permission.denied',
    actor: { id: actor.id },
    metadata: { reason: 'global_admin_2fa_overdue' },
  });
  throw new PermissionError('global_admin_2fa_overdue');
}
```

Note : `recordAudit` est appelé sans `await` dans `assertIsGlobalAdmin` (pattern fire-and-forget), mais comme la fonction throw immédiatement après, le `void` garantit qu'aucune Promise n'est laissée dangling sans handler.

- [ ] **Step 8.4: Vérifier que les tests passent**

```bash
pnpm test:integration tests/integration/permissions.test.ts
```

Expected: PASS.

- [ ] **Step 8.5: Commit**

```bash
git add src/lib/permissions.ts tests/integration/permissions.test.ts
git commit -m "feat(permissions): add assertIsGlobalAdmin + 2FA timer assertion"
```

---

## Task 9: server/auth/adapter.ts — Prisma adapter custom

**Files:**
- Create: `src/server/auth/adapter.ts`
- Create: `tests/integration/auth-adapter.test.ts`

L'adapter custom diffère de `@auth/prisma-adapter` : il pose `pending2fa = true` à la création de session si l'user a `twoFactorEnabled`, stocke `ipHash`/`userAgentHash`, gère l'expiration absolue + inactivité 7j, et debounce `lastActivityAt` (1 minute).

- [ ] **Step 9.1: Écrire les tests d'intégration**

Créer `tests/integration/auth-adapter.test.ts` :

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createSessionAdapter } from '@/server/auth/adapter';
import { getTestPrisma, truncateAll } from './setup/prisma';
import { hashPassword } from '@/lib/password';

const prisma = getTestPrisma();
const adapter = createSessionAdapter(prisma);

async function mkUser(twoFactorEnabled = false) {
  return prisma.user.create({
    data: {
      email: `u-${Date.now()}-${Math.random()}@x.test`,
      displayName: 'X',
      passwordHash: await hashPassword('x'),
      twoFactorEnabled,
    },
  });
}

beforeEach(async () => {
  await truncateAll();
});

describe('createSession', () => {
  it('crée une session pending2fa=true si user a 2FA', async () => {
    const u = await mkUser(true);
    const s = await adapter.createSession({
      userId: u.id,
      ipHash: 'iphash', userAgentHash: 'uahash',
    });
    expect(s.pending2fa).toBe(true);
    expect(s.sessionToken).toMatch(/^[A-Za-z0-9_-]{43,}$/);
  });

  it('crée une session pending2fa=false si user sans 2FA', async () => {
    const u = await mkUser(false);
    const s = await adapter.createSession({ userId: u.id, ipHash: 'i', userAgentHash: 'u' });
    expect(s.pending2fa).toBe(false);
  });

  it('génère 1000 tokens uniques', async () => {
    const u = await mkUser();
    const tokens = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const s = await adapter.createSession({ userId: u.id, ipHash: 'i', userAgentHash: 'u' });
      tokens.add(s.sessionToken);
    }
    expect(tokens.size).toBe(1000);
  });
});

describe('getSession', () => {
  it('renvoie la session valide', async () => {
    const u = await mkUser();
    const s = await adapter.createSession({ userId: u.id, ipHash: 'i', userAgentHash: 'u' });
    const got = await adapter.getSession(s.sessionToken);
    expect(got?.userId).toBe(u.id);
  });

  it('renvoie null + supprime si expirée', async () => {
    const u = await mkUser();
    const s = await prisma.session.create({
      data: {
        sessionToken: 'tok-expired-test',
        userId: u.id,
        expiresAt: new Date(Date.now() - 1000),
        ipHash: 'i', userAgentHash: 'u',
      },
    });
    expect(await adapter.getSession(s.sessionToken)).toBeNull();
    expect(await prisma.session.findUnique({ where: { id: s.id } })).toBeNull();
  });

  it('renvoie null + supprime si inactive depuis > 7j', async () => {
    const u = await mkUser();
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 3600 * 1000);
    const s = await prisma.session.create({
      data: {
        sessionToken: 'tok-stale',
        userId: u.id,
        expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
        lastActivityAt: eightDaysAgo,
        ipHash: 'i', userAgentHash: 'u',
      },
    });
    expect(await adapter.getSession(s.sessionToken)).toBeNull();
    expect(await prisma.session.findUnique({ where: { id: s.id } })).toBeNull();
  });
});

describe('deleteSession', () => {
  it('supprime la session', async () => {
    const u = await mkUser();
    const s = await adapter.createSession({ userId: u.id, ipHash: 'i', userAgentHash: 'u' });
    await adapter.deleteSession(s.sessionToken);
    expect(await prisma.session.findUnique({ where: { id: s.id } })).toBeNull();
  });
});
```

- [ ] **Step 9.2: Vérifier l'échec**

```bash
pnpm test:integration tests/integration/auth-adapter.test.ts
```

Expected: FAIL.

- [ ] **Step 9.3: Implémenter `src/server/auth/adapter.ts`**

```ts
import type { PrismaClient, Session } from '@prisma/client';
import { randomBytes } from 'node:crypto';

const SESSION_TTL_MS = 30 * 24 * 3600 * 1000; // 30j absolu
const INACTIVITY_TTL_MS = 7 * 24 * 3600 * 1000; // 7j inactif
const TOUCH_DEBOUNCE_MS = 60 * 1000; // 1 min

const lastTouchByToken = new Map<string, number>();

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export interface CreateSessionInput {
  userId: string;
  ipHash: string;
  userAgentHash: string;
  pending2fa?: boolean;
}

export function createSessionAdapter(prisma: PrismaClient) {
  return {
    async createSession(input: CreateSessionInput): Promise<Session> {
      const user = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { twoFactorEnabled: true },
      });
      const pending = input.pending2fa ?? !!user?.twoFactorEnabled;
      return prisma.session.create({
        data: {
          sessionToken: generateSessionToken(),
          userId: input.userId,
          expiresAt: new Date(Date.now() + SESSION_TTL_MS),
          ipHash: input.ipHash,
          userAgentHash: input.userAgentHash,
          pending2fa: pending,
        },
      });
    },

    async getSession(sessionToken: string): Promise<Session | null> {
      const s = await prisma.session.findUnique({ where: { sessionToken } });
      if (!s) return null;
      const now = Date.now();
      const isExpired = s.expiresAt.getTime() < now;
      const isInactive = now - s.lastActivityAt.getTime() > INACTIVITY_TTL_MS;
      if (isExpired || isInactive) {
        await prisma.session.delete({ where: { id: s.id } }).catch(() => undefined);
        return null;
      }
      const lastTouch = lastTouchByToken.get(sessionToken) ?? 0;
      if (now - lastTouch > TOUCH_DEBOUNCE_MS) {
        lastTouchByToken.set(sessionToken, now);
        await prisma.session.update({
          where: { id: s.id },
          data: { lastActivityAt: new Date(now) },
        }).catch(() => undefined);
      }
      return s;
    },

    async deleteSession(sessionToken: string): Promise<void> {
      await prisma.session.delete({ where: { sessionToken } }).catch(() => undefined);
      lastTouchByToken.delete(sessionToken);
    },

    async upgradePendingSession(input: {
      oldSessionId: string;
      ipHash: string;
      userAgentHash: string;
    }): Promise<Session> {
      const old = await prisma.session.findUnique({ where: { id: input.oldSessionId } });
      if (!old) throw new Error('Session pending introuvable');
      const [, fresh] = await prisma.$transaction([
        prisma.session.delete({ where: { id: old.id } }),
        prisma.session.create({
          data: {
            sessionToken: generateSessionToken(),
            userId: old.userId,
            expiresAt: new Date(Date.now() + SESSION_TTL_MS),
            ipHash: input.ipHash,
            userAgentHash: input.userAgentHash,
            pending2fa: false,
          },
        }),
      ]);
      lastTouchByToken.delete(old.sessionToken);
      return fresh;
    },
  };
}

export type SessionAdapter = ReturnType<typeof createSessionAdapter>;
```

- [ ] **Step 9.4: Vérifier que les tests passent**

```bash
pnpm test:integration tests/integration/auth-adapter.test.ts
```

Expected: PASS — 7 tests verts.

- [ ] **Step 9.5: Commit**

```bash
git add src/server/auth/adapter.ts tests/integration/auth-adapter.test.ts
git commit -m "feat(auth): add custom Prisma session adapter with pending2fa + fingerprint"
```

---

## Task 10: server/auth/credentials-provider.ts — étape 1 du login

**Files:**
- Create: `src/server/auth/credentials-provider.ts`
- Create: `tests/integration/credentials-provider.test.ts`
- Modify: `src/lib/audit-log.ts` si besoin (ajouter helpers email-hash)

Le credentials provider implémente l'étape 1 du pattern two-step : valide email+password, retourne l'`User` à Auth.js qui crée la session via l'adapter (qui pose `pending2fa` selon `user.twoFactorEnabled`).

- [ ] **Step 10.1: Ajouter un helper `hashEmail` dans `src/lib/crypto.ts`**

Ajouter au bas de `src/lib/crypto.ts` :

```ts
export function hashEmail(email: string): string {
  const salt = getEnv().IP_HASH_SALT; // réutilisé volontairement, c'est juste un anti-leak
  return createHash('sha256').update(`email:${salt}:${email.toLowerCase()}`).digest('hex').slice(0, 32);
}
```

- [ ] **Step 10.2: Écrire les tests d'intégration**

Créer `tests/integration/credentials-provider.test.ts` :

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { authorizeCredentials } from '@/server/auth/credentials-provider';
import { getTestPrisma, truncateAll } from './setup/prisma';
import { hashPassword } from '@/lib/password';
import { loginLimiter } from '@/lib/rate-limit';

const prisma = getTestPrisma();

async function mkUser(opts: { email: string; password: string; status?: 'ACTIVE' | 'SUSPENDED'; lockedUntil?: Date }) {
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
  it('happy path : retourne l\'user', async () => {
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
    const audit = await prisma.auditLog.findFirst({ where: { action: 'auth.login.failure', actorId: u.id } });
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
    const audit = await prisma.auditLog.findFirst({ where: { action: 'auth.login.locked', actorId: u.id } });
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
```

- [ ] **Step 10.3: Vérifier l'échec**

```bash
pnpm test:integration tests/integration/credentials-provider.test.ts
```

Expected: FAIL.

- [ ] **Step 10.4: Implémenter `src/server/auth/credentials-provider.ts`**

```ts
import { db } from '@/lib/db';
import { verifyPassword } from '@/lib/password';
import { hashIp, hashEmail } from '@/lib/crypto';
import { recordAudit } from '@/lib/audit-log';
import { loginLimiter } from '@/lib/rate-limit';

const CONSTANT_DELAY_MS = 150;
const LOCKOUT_THRESHOLD = 20;
const LOCKOUT_DURATION_MS = 60 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function constantTimeBudget<T>(fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  const out = await fn();
  const elapsed = Date.now() - start;
  if (elapsed < CONSTANT_DELAY_MS) await sleep(CONSTANT_DELAY_MS - elapsed);
  return out;
}

export interface AuthorizedUser {
  id: string;
  email: string;
  name: string;
}

export async function authorizeCredentials(
  creds: { email: string; password: string },
  req: { ip: string; userAgent: string },
): Promise<AuthorizedUser | null> {
  const email = creds.email.trim().toLowerCase();
  const ipH = hashIp(req.ip);
  const emailH = hashEmail(email);

  try {
    await loginLimiter.consume(`${ipH}:${email}`);
  } catch {
    await recordAudit({
      action: 'auth.login.locked',
      target: { type: 'EMAIL', id: emailH },
      metadata: { reason: 'rate_limited' },
      req,
    });
    return null;
  }

  return constantTimeBudget(async () => {
    const user = await db.user.findUnique({ where: { email } });

    if (!user || user.status !== 'ACTIVE') {
      await recordAudit({
        action: 'auth.login.failure',
        target: { type: 'EMAIL', id: emailH },
        metadata: { reason: user ? 'suspended' : 'unknown_email' },
        req,
      });
      return null;
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      await recordAudit({
        action: 'auth.login.locked',
        actor: { id: user.id },
        metadata: { lockedUntil: user.lockedUntil.toISOString() },
        req,
      });
      return null;
    }

    const valid = await verifyPassword(user.passwordHash, creds.password);
    if (!valid) {
      const next = user.failedLoginAttempts + 1;
      const shouldLock = next >= LOCKOUT_THRESHOLD;
      await db.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: next,
          lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_DURATION_MS) : user.lockedUntil,
        },
      });
      await recordAudit({
        action: 'auth.login.failure',
        actor: { id: user.id },
        metadata: { reason: 'bad_password', attempts: next, locked: shouldLock },
        req,
      });
      return null;
    }

    await db.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });

    return { id: user.id, email: user.email, name: user.displayName };
  });
}
```

- [ ] **Step 10.5: Vérifier que les tests passent**

```bash
pnpm test:integration tests/integration/credentials-provider.test.ts
```

Expected: PASS — 8 tests verts.

- [ ] **Step 10.6: Commit**

```bash
git add src/server/auth/credentials-provider.ts src/lib/crypto.ts tests/integration/credentials-provider.test.ts
git commit -m "feat(auth): add credentials authorize step-1 with lockout + constant timing"
```

---

## Task 11: Auth.js v5 config + handler route

**Files:**
- Create: `src/server/auth/config.ts`
- Create: `src/server/auth/index.ts` (export `auth`, `signIn`, `signOut`, `handlers`)
- Create: `src/app/api/auth/[...nextauth]/route.ts`

- [ ] **Step 11.1: Créer `src/server/auth/config.ts`**

```ts
import type { NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { authorizeCredentials } from './credentials-provider';
import { getEnv } from '@/lib/env';

export const authConfig: NextAuthConfig = {
  trustHost: true,
  secret: getEnv().SESSION_SECRET,
  session: { strategy: 'jwt' },
  pages: { signIn: '/login', error: '/login' },
  providers: [
    Credentials({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      authorize: async (raw, request) => {
        const email = String(raw?.email ?? '');
        const password = String(raw?.password ?? '');
        if (!email || !password) return null;
        const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '0.0.0.0';
        const userAgent = request.headers.get('user-agent') ?? '';
        const user = await authorizeCredentials({ email, password }, { ip, userAgent });
        return user;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.pending2fa = await needsTwoFactor(user.id);
      }
      return token;
    },
    async session({ session, token }) {
      if (token.uid) (session as { userId?: string }).userId = token.uid as string;
      (session as { pending2fa?: boolean }).pending2fa = !!token.pending2fa;
      return session;
    },
  },
};

async function needsTwoFactor(userId: string): Promise<boolean> {
  const { db } = await import('@/lib/db');
  const u = await db.user.findUnique({ where: { id: userId }, select: { twoFactorEnabled: true } });
  return !!u?.twoFactorEnabled;
}
```

**Note** : on utilise `session: { strategy: 'jwt' }` ici car l'adapter custom fonctionne en parallèle (pour les sessions DB hardenées dont nous avons besoin). Le JWT Auth.js sert de cookie de session léger ; les state-changing operations (2FA verify, logout) passent par l'adapter DB explicitement. Le pattern hybride est volontaire : JWT pour la lecture rapide en middleware Next, adapter DB pour la rotation/révocation. La session DB est créée à la première requête authentifiée par un helper applicatif (Step 11.4).

- [ ] **Step 11.2: Créer `src/server/auth/index.ts`**

```ts
import NextAuth from 'next-auth';
import { authConfig } from './config';

export const { auth, signIn, signOut, handlers } = NextAuth(authConfig);
```

- [ ] **Step 11.3: Créer `src/app/api/auth/[...nextauth]/route.ts`**

```ts
export { GET, POST } from '@/server/auth';
```

- [ ] **Step 11.4: Créer un helper `src/server/auth/session-bridge.ts`**

Ce helper synchronise la session JWT (Auth.js) avec une session DB hardenée :

```ts
import { headers } from 'next/headers';
import { auth } from '.';
import { db } from '@/lib/db';
import { createSessionAdapter } from './adapter';
import { hashIp, hashUa } from '@/lib/crypto';
import type { Session, User } from '@prisma/client';

export async function getCurrentSessionAndUser(): Promise<{ session: Session; user: User } | null> {
  const jwt = await auth();
  if (!jwt) return null;
  const userId = (jwt as { userId?: string }).userId;
  if (!userId) return null;

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || user.status !== 'ACTIVE') return null;

  // Cherche une session DB existante pour ce user, sinon en crée une
  const adapter = createSessionAdapter(db);
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '0.0.0.0';
  const ua = h.get('user-agent') ?? '';
  let session = await db.session.findFirst({
    where: { userId, expiresAt: { gt: new Date() } },
    orderBy: { lastActivityAt: 'desc' },
  });
  if (!session) {
    session = await adapter.createSession({
      userId,
      ipHash: hashIp(ip),
      userAgentHash: hashUa(ua),
      pending2fa: !!user.twoFactorEnabled,
    });
  } else {
    // Touch (debounced dans l'adapter via getSession)
    await adapter.getSession(session.sessionToken);
  }
  return { session, user };
}
```

- [ ] **Step 11.5: Vérifier le typecheck**

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 11.6: Commit**

```bash
git add src/server/auth/ src/app/api/auth/
git commit -m "feat(auth): wire Auth.js v5 with credentials provider + session bridge"
```

---

## Task 12: tRPC infra (init, context, procedures)

**Files:**
- Create: `src/server/trpc/trpc.ts`
- Create: `src/server/trpc/context.ts`
- Create: `src/server/trpc/procedures.ts`
- Create: `src/server/trpc/routers/_app.ts`

- [ ] **Step 12.1: Installer tRPC**

```bash
pnpm add @trpc/server@next @trpc/client@next @trpc/react-query@next @trpc/next@next @tanstack/react-query@^5
pnpm add -D superjson
```

- [ ] **Step 12.2: Créer `src/server/trpc/context.ts`**

```ts
import { getCurrentSessionAndUser } from '@/server/auth/session-bridge';
import type { Session, User } from '@prisma/client';

export interface TrpcContext {
  session: Session | null;
  user: User | null;
}

export async function createContext(): Promise<TrpcContext> {
  const result = await getCurrentSessionAndUser();
  return { session: result?.session ?? null, user: result?.user ?? null };
}
```

- [ ] **Step 12.3: Créer `src/server/trpc/trpc.ts`**

```ts
import { initTRPC } from '@trpc/server';
import superjson from 'superjson';
import type { TrpcContext } from './context';

export const t = initTRPC.context<TrpcContext>().create({ transformer: superjson });
```

- [ ] **Step 12.4: Créer `src/server/trpc/procedures.ts`**

```ts
import { TRPCError } from '@trpc/server';
import { t } from './trpc';
import { recordAudit } from '@/lib/audit-log';
import { SEVEN_DAYS_MS } from '@/lib/permissions';

export const publicProcedure = t.procedure;

export const pendingProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.session || !ctx.session.pending2fa || !ctx.user) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'pending session required' });
  }
  return next({ ctx: { ...ctx, session: ctx.session, user: ctx.user } });
});

export const authedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.session || ctx.session.pending2fa || !ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  return next({ ctx: { ...ctx, session: ctx.session, user: ctx.user } });
});

export const globalAdminProcedure = authedProcedure.use(async ({ ctx, next }) => {
  if (ctx.user.role !== 'GLOBAL_ADMIN') {
    await recordAudit({
      action: 'permission.denied',
      actor: { id: ctx.user.id },
      metadata: { required: 'GLOBAL_ADMIN' },
    });
    throw new TRPCError({ code: 'FORBIDDEN' });
  }
  const elapsed = Date.now() - ctx.user.createdAt.getTime();
  if (!ctx.user.twoFactorEnabled && elapsed > SEVEN_DAYS_MS) {
    await recordAudit({
      action: 'permission.denied',
      actor: { id: ctx.user.id },
      metadata: { reason: 'global_admin_2fa_overdue' },
    });
    throw new TRPCError({ code: 'FORBIDDEN' });
  }
  return next({ ctx });
});
```

- [ ] **Step 12.5: Créer `src/server/trpc/routers/_app.ts`**

```ts
import { t } from '../trpc';
import { authRouter } from './auth';

export const appRouter = t.router({
  auth: authRouter,
});

export type AppRouter = typeof appRouter;
```

- [ ] **Step 12.6: Créer le route handler tRPC `src/app/api/trpc/[trpc]/route.ts`**

```ts
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter } from '@/server/trpc/routers/_app';
import { createContext } from '@/server/trpc/context';

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext,
  });

export { handler as GET, handler as POST };
```

- [ ] **Step 12.7: Typecheck**

```bash
pnpm typecheck
```

Expected: PASS (auth.ts router doit être créé en Task 13, donc temporairement importé comme stub).

- [ ] **Step 12.8: Stub temporaire `src/server/trpc/routers/auth.ts`**

```ts
import { t } from '../trpc';
export const authRouter = t.router({});
```

- [ ] **Step 12.9: Commit**

```bash
git add src/server/trpc/ src/app/api/trpc/ package.json pnpm-lock.yaml
git commit -m "feat(trpc): add tRPC infra with public/pending/authed/globalAdmin procedures"
```

---

## Task 13: server/trpc/routers/auth.ts — procedures 2FA et enrolment

**Files:**
- Modify: `src/server/trpc/routers/auth.ts` (remplacer le stub)
- Create: `tests/integration/trpc-auth.test.ts`

- [ ] **Step 13.1: Écrire les tests d'intégration**

Créer `tests/integration/trpc-auth.test.ts` :

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { authenticator } from 'otplib';
import { appRouter } from '@/server/trpc/routers/_app';
import { getTestPrisma, truncateAll } from './setup/prisma';
import { hashPassword } from '@/lib/password';
import { encryptSecret } from '@/lib/crypto';
import { generateTotpSecret, hashBackupCodes, generateBackupCodes } from '@/lib/totp';

const prisma = getTestPrisma();

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
        sessionToken: 't1', userId: u.id, expiresAt: new Date(Date.now() + 1e9),
        ipHash: 'i', userAgentHash: 'u', pending2fa: false,
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
        sessionToken: 't2', userId: u.id, expiresAt: new Date(Date.now() + 1e9),
        ipHash: 'i', userAgentHash: 'u', pending2fa: false,
      },
    });
    const caller = appRouter.createCaller(await buildCtx({ user: u, session }));
    const code = authenticator.generate(rawSecret);
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
        sessionToken: 't3', userId: u.id, expiresAt: new Date(Date.now() + 1e9),
        ipHash: 'i', userAgentHash: 'u', pending2fa: false,
      },
    });
    const caller = appRouter.createCaller(await buildCtx({ user: u, session }));
    await expect(caller.auth.confirm2FA({ code: '000000' })).rejects.toThrow();
  });
});

describe('auth.verify2FA', () => {
  it('upgrade la session pending → full + log success', async () => {
    const u = await prisma.user.create({
      data: { email: 'v@x.test', displayName: 'V', passwordHash: await hashPassword('x'), twoFactorEnabled: true },
    });
    const rawSecret = generateTotpSecret();
    const codes = generateBackupCodes();
    await prisma.twoFactorSecret.create({
      data: { userId: u.id, secretCipher: encryptSecret(rawSecret), backupCodes: await hashBackupCodes(codes), confirmedAt: new Date() },
    });
    const session = await prisma.session.create({
      data: {
        sessionToken: 'pending-tok', userId: u.id, expiresAt: new Date(Date.now() + 1e9),
        ipHash: 'i', userAgentHash: 'u', pending2fa: true,
      },
    });
    const caller = appRouter.createCaller(await buildCtx({ user: u, session }));
    const code = authenticator.generate(rawSecret);
    const out = await caller.auth.verify2FA({ code });
    expect(out.ok).toBe(true);
    expect(out.sessionToken).not.toBe('pending-tok');
    const old = await prisma.session.findUnique({ where: { sessionToken: 'pending-tok' } });
    expect(old).toBeNull();
    const fresh = await prisma.session.findUnique({ where: { sessionToken: out.sessionToken } });
    expect(fresh?.pending2fa).toBe(false);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'auth.2fa.success', actorId: u.id } });
    expect(audit).not.toBeNull();
  });

  it('refuse code invalide + log failure', async () => {
    const u = await prisma.user.create({
      data: { email: 'vf@x.test', displayName: 'VF', passwordHash: await hashPassword('x'), twoFactorEnabled: true },
    });
    await prisma.twoFactorSecret.create({
      data: { userId: u.id, secretCipher: encryptSecret(generateTotpSecret()), backupCodes: [], confirmedAt: new Date() },
    });
    const session = await prisma.session.create({
      data: {
        sessionToken: 'pending-tok-2', userId: u.id, expiresAt: new Date(Date.now() + 1e9),
        ipHash: 'i', userAgentHash: 'u', pending2fa: true,
      },
    });
    const caller = appRouter.createCaller(await buildCtx({ user: u, session }));
    await expect(caller.auth.verify2FA({ code: '000000' })).rejects.toThrow();
    const audit = await prisma.auditLog.findFirst({ where: { action: 'auth.2fa.failure', actorId: u.id } });
    expect(audit).not.toBeNull();
  });
});

describe('auth.verifyBackupCode', () => {
  it('consomme un code de secours valide', async () => {
    const u = await prisma.user.create({
      data: { email: 'bk@x.test', displayName: 'BK', passwordHash: await hashPassword('x'), twoFactorEnabled: true },
    });
    const codes = generateBackupCodes();
    await prisma.twoFactorSecret.create({
      data: { userId: u.id, secretCipher: encryptSecret('x'), backupCodes: await hashBackupCodes(codes), confirmedAt: new Date() },
    });
    const session = await prisma.session.create({
      data: {
        sessionToken: 'pending-bk', userId: u.id, expiresAt: new Date(Date.now() + 1e9),
        ipHash: 'i', userAgentHash: 'u', pending2fa: true,
      },
    });
    const caller = appRouter.createCaller(await buildCtx({ user: u, session }));
    const out = await caller.auth.verifyBackupCode({ code: codes[0] });
    expect(out.ok).toBe(true);
    const sec = await prisma.twoFactorSecret.findUnique({ where: { userId: u.id } });
    expect(sec?.backupCodes).toHaveLength(7);
  });
});
```

- [ ] **Step 13.2: Vérifier l'échec**

```bash
pnpm test:integration tests/integration/trpc-auth.test.ts
```

Expected: FAIL.

- [ ] **Step 13.3: Implémenter `src/server/trpc/routers/auth.ts`**

```ts
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { t } from '../trpc';
import { authedProcedure, pendingProcedure } from '../procedures';
import { db } from '@/lib/db';
import {
  generateTotpSecret, buildTotpUri, verifyTotpCode,
  generateBackupCodes, hashBackupCodes, consumeBackupCode,
} from '@/lib/totp';
import { encryptSecret, decryptSecret } from '@/lib/crypto';
import { recordAudit } from '@/lib/audit-log';
import { twoFactorLimiter } from '@/lib/rate-limit';
import { createSessionAdapter } from '@/server/auth/adapter';

const codeInput = z.object({ code: z.string().min(6).max(20) });

export const authRouter = t.router({
  enroll2FA: authedProcedure.mutation(async ({ ctx }) => {
    const secret = generateTotpSecret();
    await db.twoFactorSecret.upsert({
      where: { userId: ctx.user.id },
      update: { secretCipher: encryptSecret(secret), confirmedAt: null, backupCodes: [] },
      create: { userId: ctx.user.id, secretCipher: encryptSecret(secret), backupCodes: [] },
    });
    return {
      uri: buildTotpUri({ secret, accountName: ctx.user.email }),
      secret,
    };
  }),

  confirm2FA: authedProcedure
    .input(codeInput)
    .mutation(async ({ ctx, input }) => {
      const sec = await db.twoFactorSecret.findUnique({ where: { userId: ctx.user.id } });
      if (!sec) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'no secret enrolled' });
      const ok = verifyTotpCode(decryptSecret(sec.secretCipher), input.code);
      if (!ok) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'bad code' });
      const codes = generateBackupCodes();
      const hashes = await hashBackupCodes(codes);
      await db.$transaction([
        db.twoFactorSecret.update({
          where: { userId: ctx.user.id },
          data: { confirmedAt: new Date(), backupCodes: hashes },
        }),
        db.user.update({ where: { id: ctx.user.id }, data: { twoFactorEnabled: true } }),
      ]);
      await recordAudit({ action: 'auth.2fa.enrolled', actor: { id: ctx.user.id } });
      return { backupCodes: codes };
    }),

  verify2FA: pendingProcedure
    .input(codeInput)
    .mutation(async ({ ctx, input }) => {
      try {
        await twoFactorLimiter.consume(ctx.session.id);
      } catch {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS' });
      }
      const sec = await db.twoFactorSecret.findUnique({ where: { userId: ctx.user.id } });
      if (!sec || !sec.confirmedAt) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED' });
      }
      const ok = verifyTotpCode(decryptSecret(sec.secretCipher), input.code);
      if (!ok) {
        await recordAudit({
          action: 'auth.2fa.failure',
          actor: { id: ctx.user.id },
          metadata: { method: 'totp' },
        });
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      const adapter = createSessionAdapter(db);
      const fresh = await adapter.upgradePendingSession({
        oldSessionId: ctx.session.id,
        ipHash: ctx.session.ipHash,
        userAgentHash: ctx.session.userAgentHash,
      });
      await db.user.update({ where: { id: ctx.user.id }, data: { lastLoginAt: new Date() } });
      await recordAudit({ action: 'auth.2fa.success', actor: { id: ctx.user.id } });
      return { ok: true, sessionToken: fresh.sessionToken };
    }),

  verifyBackupCode: pendingProcedure
    .input(z.object({ code: z.string().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/) }))
    .mutation(async ({ ctx, input }) => {
      try {
        await twoFactorLimiter.consume(ctx.session.id);
      } catch {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS' });
      }
      const sec = await db.twoFactorSecret.findUnique({ where: { userId: ctx.user.id } });
      if (!sec || !sec.confirmedAt) throw new TRPCError({ code: 'PRECONDITION_FAILED' });
      const result = await consumeBackupCode(input.code, sec.backupCodes);
      if (!result) {
        await recordAudit({
          action: 'auth.2fa.failure',
          actor: { id: ctx.user.id },
          metadata: { method: 'backup_code' },
        });
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      await db.twoFactorSecret.update({
        where: { userId: ctx.user.id },
        data: { backupCodes: result.remainingHashes },
      });
      const adapter = createSessionAdapter(db);
      const fresh = await adapter.upgradePendingSession({
        oldSessionId: ctx.session.id,
        ipHash: ctx.session.ipHash,
        userAgentHash: ctx.session.userAgentHash,
      });
      await recordAudit({
        action: 'auth.2fa.backup_code_used',
        actor: { id: ctx.user.id },
        metadata: { remaining: result.remainingHashes.length },
      });
      return { ok: true, sessionToken: fresh.sessionToken };
    }),

  disable2FA: authedProcedure
    .input(z.object({ password: z.string(), code: z.string().min(6) }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role === 'GLOBAL_ADMIN') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'global admin cannot disable 2FA' });
      }
      const { verifyPassword } = await import('@/lib/password');
      const fullUser = await db.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
      const passwordOk = await verifyPassword(fullUser.passwordHash, input.password);
      if (!passwordOk) throw new TRPCError({ code: 'UNAUTHORIZED' });
      const sec = await db.twoFactorSecret.findUnique({ where: { userId: ctx.user.id } });
      if (!sec) throw new TRPCError({ code: 'PRECONDITION_FAILED' });
      const codeOk = verifyTotpCode(decryptSecret(sec.secretCipher), input.code);
      if (!codeOk) throw new TRPCError({ code: 'UNAUTHORIZED' });
      await db.$transaction([
        db.twoFactorSecret.delete({ where: { userId: ctx.user.id } }),
        db.user.update({ where: { id: ctx.user.id }, data: { twoFactorEnabled: false } }),
      ]);
      await recordAudit({ action: 'auth.2fa.disabled', actor: { id: ctx.user.id } });
      return { ok: true };
    }),
});
```

- [ ] **Step 13.4: Vérifier que les tests passent**

```bash
pnpm test:integration tests/integration/trpc-auth.test.ts
```

Expected: PASS — 5 tests verts.

- [ ] **Step 13.5: Commit**

```bash
git add src/server/trpc/routers/auth.ts tests/integration/trpc-auth.test.ts
git commit -m "feat(trpc): add auth router (enroll/confirm/verify 2FA + backup + disable)"
```

---

## Task 14: middleware.ts — enforcement Next

**Files:**
- Create: `src/middleware.ts`

- [ ] **Step 14.1: Implémenter `src/middleware.ts`**

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/server/auth';
import { db } from '@/lib/db';
import { SEVEN_DAYS_MS } from '@/lib/permissions';

const PUBLIC_PATHS = [
  '/login', '/api/auth', '/_next', '/favicon.ico', '/fonts',
];

const PENDING_ALLOWED = ['/login/2fa', '/login/2fa/backup', '/api/auth', '/api/trpc/auth.verify2FA', '/api/trpc/auth.verifyBackupCode'];

const ADMIN_2FA_ALLOWED = ['/2fa/setup', '/2fa/setup/recovery-codes', '/api/auth', '/api/trpc/auth.enroll2FA', '/api/trpc/auth.confirm2FA', '/logout'];

function startsWithAny(path: string, list: string[]): boolean {
  return list.some((p) => path === p || path.startsWith(p + '/') || path.startsWith(p + '?'));
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  if (startsWithAny(path, PUBLIC_PATHS)) return NextResponse.next();

  const session = await auth();
  if (!session) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  const userId = (session as { userId?: string }).userId;
  const pending2fa = (session as { pending2fa?: boolean }).pending2fa;

  if (pending2fa && !startsWithAny(path, PENDING_ALLOWED)) {
    return NextResponse.redirect(new URL('/login/2fa', req.url));
  }

  if (userId && !pending2fa) {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { role: true, twoFactorEnabled: true, createdAt: true },
    });
    if (
      user?.role === 'GLOBAL_ADMIN' &&
      !user.twoFactorEnabled &&
      Date.now() - user.createdAt.getTime() > SEVEN_DAYS_MS &&
      !startsWithAny(path, ADMIN_2FA_ALLOWED)
    ) {
      return NextResponse.redirect(new URL('/2fa/setup', req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

- [ ] **Step 14.2: Vérifier le typecheck**

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 14.3: Commit**

```bash
git add src/middleware.ts
git commit -m "feat(middleware): enforce auth, pending 2FA redirect, global admin 2FA timer"
```

---

## Task 15: Lint rules custom (no-bare-trpc-procedure, no-direct-audit-write)

**Files:**
- Create: `eslint-rules/no-bare-trpc-procedure.js`
- Create: `eslint-rules/no-direct-audit-write.js`
- Modify: `eslint-rules/index.js`
- Modify: `.eslintrc.json`

- [ ] **Step 15.1: Créer `eslint-rules/no-bare-trpc-procedure.js`**

```js
'use strict';

/**
 * Interdit `t.procedure.query/.mutation` direct — force le passage par
 * un wrapper d'auth (publicProcedure, authedProcedure, pendingProcedure,
 * globalAdminProcedure).
 *
 * publicProcedure est explicitement allowlisté pour les rares cas légitimes.
 */
module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Force l\'utilisation de procedures wrappers (anti-IDOR)' },
    schema: [],
    messages: {
      bareT:
        '`t.procedure.{{method}}` direct interdit. Utilisez publicProcedure (avec justification), authedProcedure, pendingProcedure ou globalAdminProcedure.',
    },
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (
          node.object.type === 'MemberExpression' &&
          node.object.object.type === 'Identifier' &&
          node.object.object.name === 't' &&
          node.object.property.type === 'Identifier' &&
          node.object.property.name === 'procedure' &&
          node.property.type === 'Identifier' &&
          (node.property.name === 'query' || node.property.name === 'mutation')
        ) {
          context.report({ node, messageId: 'bareT', data: { method: node.property.name } });
        }
      },
    };
  },
};
```

- [ ] **Step 15.2: Créer `eslint-rules/no-direct-audit-write.js`**

```js
'use strict';

/**
 * Interdit `db.auditLog.create` ou `prisma.auditLog.create` direct.
 * Force le passage par `recordAudit` de `src/lib/audit-log.ts`.
 */
module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Force le passage par recordAudit (typage + redact + hash IP)' },
    schema: [],
    messages: {
      direct: 'Écriture directe sur auditLog interdite. Utilisez `recordAudit` de @/lib/audit-log.',
    },
  },
  create(context) {
    const filename = context.getFilename();
    if (filename.includes('lib/audit-log')) return {};
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type === 'MemberExpression' &&
          callee.object.type === 'MemberExpression' &&
          callee.object.property.type === 'Identifier' &&
          callee.object.property.name === 'auditLog' &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'create'
        ) {
          context.report({ node, messageId: 'direct' });
        }
      },
    };
  },
};
```

- [ ] **Step 15.3: Mettre à jour `eslint-rules/index.js`**

```js
'use strict';
module.exports = {
  rules: {
    'no-unscoped-prisma': require('./no-unscoped-prisma'),
    'no-bare-trpc-procedure': require('./no-bare-trpc-procedure'),
    'no-direct-audit-write': require('./no-direct-audit-write'),
  },
};
```

- [ ] **Step 15.4: Activer dans `.eslintrc.json`**

Lire le fichier puis ajouter les nouvelles règles dans la section `rules`.

```json
{
  "rules": {
    "local/no-unscoped-prisma": "error",
    "local/no-bare-trpc-procedure": "error",
    "local/no-direct-audit-write": "error"
  }
}
```

- [ ] **Step 15.5: Lancer lint**

```bash
pnpm lint
```

Expected: PASS (ou seuls les fichiers existants violent les nouvelles règles, à corriger).

- [ ] **Step 15.6: Écrire un test rapide pour les lint rules (optionnel mais recommandé)**

Étendre `tests/unit/eslint-rule.test.ts` pour tester les deux nouvelles règles. Suivre le pattern du test existant pour `no-unscoped-prisma`.

- [ ] **Step 15.7: Commit**

```bash
git add eslint-rules/ .eslintrc.json tests/unit/eslint-rule.test.ts
git commit -m "feat(lint): add no-bare-trpc-procedure and no-direct-audit-write rules"
```

---

## Task 16: scripts/bootstrap-admin.ts — CLI idempotent

**Files:**
- Create: `scripts/bootstrap-admin.ts`
- Create: `tests/integration/bootstrap-admin.test.ts`

- [ ] **Step 16.1: Écrire les tests**

Créer `tests/integration/bootstrap-admin.test.ts` :

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { runBootstrap } from '@/../scripts/bootstrap-admin';
import { getTestPrisma, truncateAll } from './setup/prisma';

const prisma = getTestPrisma();

beforeEach(async () => {
  await truncateAll();
});

describe('bootstrap-admin', () => {
  it('crée un GLOBAL_ADMIN si aucun n\'existe', async () => {
    const out = await runBootstrap({ email: 'ops@x.test', password: 'pass-32-chars-min-for-security!' });
    expect(out.created).toBe(true);
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

  it('--force échoue si l\'user n\'existe pas', async () => {
    await runBootstrap({ email: 'first@x.test', password: 'pass-32-chars-min-for-security!' });
    await expect(
      runBootstrap({ email: 'ghost@x.test', force: true }),
    ).rejects.toThrow(/aucun user/i);
  });
});
```

- [ ] **Step 16.2: Vérifier l'échec**

```bash
pnpm test:integration tests/integration/bootstrap-admin.test.ts
```

Expected: FAIL.

- [ ] **Step 16.3: Implémenter `scripts/bootstrap-admin.ts`**

```ts
import { db } from '../src/lib/db';
import { hashPassword } from '../src/lib/password';
import { recordAudit } from '../src/lib/audit-log';
import { randomBytes } from 'node:crypto';

export interface BootstrapInput {
  email: string;
  password?: string;
  displayName?: string;
  force?: boolean;
}

export interface BootstrapOutput {
  created: boolean;
  promoted: boolean;
  passwordGenerated: string | null;
}

export async function runBootstrap(input: BootstrapInput): Promise<BootstrapOutput> {
  const existing = await db.user.findFirst({ where: { role: 'GLOBAL_ADMIN' } });

  if (existing && !input.force) {
    throw new Error(
      `Un Admin global existe déjà (${existing.email}). Utilisez --force pour promouvoir un user existant.`,
    );
  }

  if (input.force) {
    const target = await db.user.findUnique({ where: { email: input.email } });
    if (!target) {
      throw new Error(`Aucun user avec l'email ${input.email}.`);
    }
    if (target.role === 'GLOBAL_ADMIN') {
      return { created: false, promoted: false, passwordGenerated: null };
    }
    await db.user.update({ where: { id: target.id }, data: { role: 'GLOBAL_ADMIN' } });
    await recordAudit({
      action: 'admin.user.role_changed',
      target: { type: 'USER', id: target.id },
      metadata: { from: target.role, to: 'GLOBAL_ADMIN', source: 'bootstrap_force' },
    });
    return { created: false, promoted: true, passwordGenerated: null };
  }

  const passwordGenerated = input.password ? null : randomBytes(18).toString('base64');
  const password = input.password ?? passwordGenerated!;

  await db.user.create({
    data: {
      email: input.email,
      displayName: input.displayName ?? 'Admin',
      passwordHash: await hashPassword(password),
      role: 'GLOBAL_ADMIN',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });

  return { created: true, promoted: false, passwordGenerated };
}

async function main() {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
  if (!email) {
    console.error('BOOTSTRAP_ADMIN_EMAIL requis');
    process.exit(1);
  }
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const displayName = process.env.BOOTSTRAP_ADMIN_NAME;
  const force = process.argv.includes('--force');

  try {
    const out = await runBootstrap({ email, password, displayName, force });
    console.log('═══════════════════════════════════════════════');
    if (out.created) {
      console.log('  Compte Admin global créé');
      console.log(`  Email      : ${email}`);
      if (out.passwordGenerated) {
        console.log(`  Password   : ${out.passwordGenerated}`);
        console.log('  ⚠  À COPIER MAINTENANT — ne sera plus affiché.');
      }
      const deadline = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
      console.log(`  2FA        : à activer obligatoirement avant ${deadline}`);
    } else if (out.promoted) {
      console.log(`  User ${email} promu GLOBAL_ADMIN`);
    } else {
      console.log(`  User ${email} était déjà GLOBAL_ADMIN — aucun changement`);
    }
    console.log('═══════════════════════════════════════════════');
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module) {
  void main();
}
```

- [ ] **Step 16.4: Vérifier que les tests passent**

```bash
pnpm test:integration tests/integration/bootstrap-admin.test.ts
```

Expected: PASS — 4 tests verts.

- [ ] **Step 16.5: Mettre à jour `docs/deployment.md`**

Ajouter une section « Initialisation post-déploiement » :

```markdown
## Initialisation post-déploiement

Après le premier déploiement Coolify, créer le compte Admin global initial :

```bash
docker exec -it biblioshare-app sh -c \
  "BOOTSTRAP_ADMIN_EMAIL=ops@example.com pnpm bootstrap:admin"
```

Le mot de passe est affiché une seule fois — copier immédiatement.

### Mode récupération

Si l'unique Admin global a perdu son 2FA et son mot de passe, promouvoir un autre user existant :

```bash
docker exec -it biblioshare-app sh -c \
  "BOOTSTRAP_ADMIN_EMAIL=other@example.com pnpm bootstrap:admin --force"
```

Cette opération est tracée dans `AuditLog`.
```

- [ ] **Step 16.6: Commit**

```bash
git add scripts/bootstrap-admin.ts tests/integration/bootstrap-admin.test.ts docs/deployment.md
git commit -m "feat(bootstrap): add idempotent admin bootstrap CLI with --force recovery mode"
```

---

## Task 17: UI Wireframing — handoff à frontend-design

**Note pour l'exécutant** : ne PAS implémenter l'UI sans avoir d'abord produit les wireframes. Utiliser la skill `frontend-design` (ou `ui-ux-pro-max`) pour designer les écrans avant Task 18.

- [ ] **Step 17.1: Invoquer la skill frontend-design**

Demander la skill via Skill tool :

```
skill: frontend-design
```

Briefer la skill avec le contexte :
- Design system Phase 0 (Tailwind tokens, palette, typo, shadcn/ui).
- Pas d'emojis, icônes Lucide exclusivement.
- Routes à designer pour 1A : `/login`, `/login/2fa`, `/login/2fa/backup`, `/2fa/setup`, `/2fa/setup/recovery-codes`.
- Banner forçage 2FA pour Admin global pré-J7 (countdown).
- Page `/admin` minimale (placeholder « Bienvenue »).
- Layout d'auth dédié (pas de chrome app principal).

- [ ] **Step 17.2: Produire les mockups**

La skill produit les 5 mockups + le composant banner. Sauvegarder les concepts dans `docs/superpowers/specs/2026-04-26-phase-1a-ui-wireframes.md`.

- [ ] **Step 17.3: Commit les wireframes**

```bash
git add docs/superpowers/specs/2026-04-26-phase-1a-ui-wireframes.md
git commit -m "docs(phase-1a): add UI wireframes for auth pages"
```

---

## Task 18: Implémentation UI — pages + composants

**Files:**
- Create: `src/app/(auth)/layout.tsx`
- Create: `src/app/(auth)/login/page.tsx`
- Create: `src/app/(auth)/login/2fa/page.tsx`
- Create: `src/app/(auth)/login/2fa/backup/page.tsx`
- Create: `src/app/(auth)/2fa/setup/page.tsx`
- Create: `src/app/(auth)/2fa/setup/recovery-codes/page.tsx`
- Create: `src/app/admin/page.tsx`
- Create: `src/app/admin/layout.tsx`
- Create: `src/components/auth/LoginForm.tsx`
- Create: `src/components/auth/TwoFactorChallenge.tsx`
- Create: `src/components/auth/BackupCodeForm.tsx`
- Create: `src/components/auth/TwoFactorSetup.tsx`
- Create: `src/components/auth/RecoveryCodesDisplay.tsx`
- Create: `src/components/auth/TwoFactorBanner.tsx`
- Create: `src/lib/trpc/client.ts` (tRPC React client)
- Create: `src/app/providers.tsx` (TanStack Query provider)
- Modify: `src/app/layout.tsx` (wrap providers)

L'implémentation suit les wireframes de Task 17. Voici les snippets clés de chaque composant. Chaque sous-step est : créer le fichier avec le code montré → vérifier visuellement dans `pnpm dev`.

- [ ] **Step 18.1: Setup tRPC client + providers**

`src/lib/trpc/client.ts` :

```ts
import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '@/server/trpc/routers/_app';

export const trpc = createTRPCReact<AppRouter>();
```

`src/app/providers.tsx` :

```tsx
'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [httpBatchLink({ url: '/api/trpc', transformer: superjson })],
    }),
  );
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
```

Modifier `src/app/layout.tsx` pour wrapper `<Providers>` autour de `{children}`.

- [ ] **Step 18.2: Layout auth dédié**

`src/app/(auth)/layout.tsx` :

```tsx
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
```

- [ ] **Step 18.3: Page /login (Server Action)**

`src/app/(auth)/login/page.tsx` :

```tsx
import { LoginForm } from '@/components/auth/LoginForm';

export default function LoginPage() {
  return <LoginForm />;
}
```

`src/components/auth/LoginForm.tsx` :

```tsx
'use client';
import { signIn } from 'next-auth/react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handle(formData: FormData) {
    setPending(true);
    setError(null);
    const result = await signIn('credentials', {
      email: formData.get('email'),
      password: formData.get('password'),
      redirect: false,
    });
    setPending(false);
    if (result?.error) {
      setError('Identifiants incorrects ou compte verrouillé.');
      return;
    }
    router.refresh();
    router.push('/');
  }

  return (
    <form action={handle} className="space-y-4">
      <h1 className="text-2xl font-semibold">Connexion</h1>
      <Input name="email" type="email" required placeholder="email@exemple.fr" />
      <Input name="password" type="password" required placeholder="Mot de passe" />
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Connexion…' : 'Se connecter'}
      </Button>
      <a href="/password/forgot" className="block text-center text-sm text-slate-600 hover:underline">
        Mot de passe oublié ?
      </a>
    </form>
  );
}
```

- [ ] **Step 18.4: Page /login/2fa**

`src/app/(auth)/login/2fa/page.tsx` :

```tsx
import { TwoFactorChallenge } from '@/components/auth/TwoFactorChallenge';
export default function Page() { return <TwoFactorChallenge />; }
```

`src/components/auth/TwoFactorChallenge.tsx` :

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function TwoFactorChallenge() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const verify = trpc.auth.verify2FA.useMutation({
    onSuccess: () => router.push('/'),
    onError: (e) => setError(e.message),
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const code = String(new FormData(e.currentTarget).get('code'));
        verify.mutate({ code });
      }}
      className="space-y-4"
    >
      <h1 className="text-2xl font-semibold">Vérification 2FA</h1>
      <p className="text-sm text-slate-600">
        Saisissez le code à 6 chiffres depuis votre application d'authentification.
      </p>
      <Input name="code" required pattern="[0-9]{6}" inputMode="numeric" placeholder="000000" autoFocus />
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={verify.isPending} className="w-full">
        Valider
      </Button>
      <a href="/login/2fa/backup" className="block text-center text-sm text-slate-600 hover:underline">
        Utiliser un code de secours
      </a>
    </form>
  );
}
```

- [ ] **Step 18.5: Page /login/2fa/backup**

`src/components/auth/BackupCodeForm.tsx` (similar pattern, mutation `verifyBackupCode`, regex `XXXX-XXXX`).

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function BackupCodeForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const verify = trpc.auth.verifyBackupCode.useMutation({
    onSuccess: () => router.push('/'),
    onError: (e) => setError(e.message),
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const code = String(new FormData(e.currentTarget).get('code')).toUpperCase();
        verify.mutate({ code });
      }}
      className="space-y-4"
    >
      <h1 className="text-2xl font-semibold">Code de secours</h1>
      <p className="text-sm text-amber-700">
        Ce code sera invalidé après usage. Pensez à régénérer vos codes après connexion.
      </p>
      <Input name="code" required pattern="[A-Z0-9]{4}-[A-Z0-9]{4}" placeholder="XXXX-XXXX" autoFocus />
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={verify.isPending} className="w-full">Valider</Button>
    </form>
  );
}
```

`src/app/(auth)/login/2fa/backup/page.tsx` :

```tsx
import { BackupCodeForm } from '@/components/auth/BackupCodeForm';
export default function Page() { return <BackupCodeForm />; }
```

- [ ] **Step 18.6: Page /2fa/setup**

`src/components/auth/TwoFactorSetup.tsx` :

```tsx
'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function TwoFactorSetup() {
  const router = useRouter();
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const enroll = trpc.auth.enroll2FA.useMutation({
    onSuccess: async (data) => {
      setQr(await QRCode.toDataURL(data.uri));
      setSecret(data.secret);
    },
  });

  const confirm = trpc.auth.confirm2FA.useMutation({
    onSuccess: (data) => {
      sessionStorage.setItem('biblio.recoveryCodes', JSON.stringify(data.backupCodes));
      router.push('/2fa/setup/recovery-codes');
    },
    onError: (e) => setError(e.message),
  });

  useEffect(() => { if (!qr) enroll.mutate(); }, []); // eslint-disable-line

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Configuration 2FA</h1>
      {!qr && <p>Génération du secret…</p>}
      {qr && (
        <>
          <img src={qr} alt="QR code à scanner" className="mx-auto" />
          {secret && (
            <details className="text-sm">
              <summary className="cursor-pointer">Saisir manuellement</summary>
              <code className="mt-2 block break-all rounded bg-slate-100 p-2 text-xs">{secret}</code>
            </details>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const code = String(new FormData(e.currentTarget).get('code'));
              confirm.mutate({ code });
            }}
            className="space-y-3"
          >
            <Input name="code" required pattern="[0-9]{6}" placeholder="Code de l'app" />
            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
            <Button type="submit" disabled={confirm.isPending} className="w-full">
              Activer
            </Button>
          </form>
        </>
      )}
    </div>
  );
}
```

`src/app/(auth)/2fa/setup/page.tsx` :

```tsx
import { TwoFactorSetup } from '@/components/auth/TwoFactorSetup';
export default function Page() { return <TwoFactorSetup />; }
```

- [ ] **Step 18.7: Page /2fa/setup/recovery-codes**

`src/components/auth/RecoveryCodesDisplay.tsx` :

```tsx
'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export function RecoveryCodesDisplay() {
  const router = useRouter();
  const [codes, setCodes] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    const raw = sessionStorage.getItem('biblio.recoveryCodes');
    if (!raw) { router.push('/2fa/setup'); return; }
    setCodes(JSON.parse(raw));
  }, [router]);

  function download() {
    const blob = new Blob([codes.join('\n')], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'biblioshare-recovery-codes.txt';
    a.click();
  }

  function done() {
    sessionStorage.removeItem('biblio.recoveryCodes');
    router.push('/');
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Codes de secours</h1>
      <p className="text-sm text-slate-600">
        Sauvegardez ces 8 codes. Chacun peut être utilisé une fois si vous perdez l'accès à votre app.
      </p>
      <ul className="grid grid-cols-2 gap-2 rounded bg-slate-100 p-4 font-mono text-sm">
        {codes.map((c) => <li key={c}>{c}</li>)}
      </ul>
      <Button type="button" onClick={download} variant="outline" className="w-full">
        Télécharger en .txt
      </Button>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        J'ai sauvegardé ces codes en lieu sûr.
      </label>
      <Button onClick={done} disabled={!confirmed} className="w-full">Continuer</Button>
    </div>
  );
}
```

`src/app/(auth)/2fa/setup/recovery-codes/page.tsx` :

```tsx
import { RecoveryCodesDisplay } from '@/components/auth/RecoveryCodesDisplay';
export default function Page() { return <RecoveryCodesDisplay />; }
```

- [ ] **Step 18.8: Banner forçage 2FA**

`src/components/auth/TwoFactorBanner.tsx` :

```tsx
'use client';
import { useEffect, useState } from 'react';

interface Props { createdAt: string; twoFactorEnabled: boolean; role: string; }

export function TwoFactorBanner({ createdAt, twoFactorEnabled, role }: Props) {
  const [remainingDays, setRemainingDays] = useState<number | null>(null);

  useEffect(() => {
    if (twoFactorEnabled || role !== 'GLOBAL_ADMIN') return;
    const elapsed = Date.now() - new Date(createdAt).getTime();
    const remaining = 7 * 24 * 3600 * 1000 - elapsed;
    if (remaining > 0) setRemainingDays(Math.ceil(remaining / (24 * 3600 * 1000)));
  }, [createdAt, twoFactorEnabled, role]);

  if (remainingDays === null) return null;

  return (
    <div role="alert" className="border-l-4 border-amber-500 bg-amber-50 p-4 text-amber-900">
      <p className="font-medium">2FA obligatoire dans {remainingDays} jour{remainingDays > 1 ? 's' : ''}.</p>
      <a href="/2fa/setup" className="text-sm underline">Configurer maintenant</a>
    </div>
  );
}
```

- [ ] **Step 18.9: Page /admin placeholder + layout**

`src/app/admin/layout.tsx` :

```tsx
import { redirect } from 'next/navigation';
import { getCurrentSessionAndUser } from '@/server/auth/session-bridge';
import { TwoFactorBanner } from '@/components/auth/TwoFactorBanner';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const result = await getCurrentSessionAndUser();
  if (!result || result.user.role !== 'GLOBAL_ADMIN') redirect('/');
  return (
    <div className="min-h-dvh bg-white">
      <TwoFactorBanner
        createdAt={result.user.createdAt.toISOString()}
        twoFactorEnabled={result.user.twoFactorEnabled}
        role={result.user.role}
      />
      <main className="mx-auto max-w-5xl p-6">{children}</main>
    </div>
  );
}
```

`src/app/admin/page.tsx` :

```tsx
export default function AdminPage() {
  return (
    <div>
      <h1 className="text-3xl font-semibold">Administration</h1>
      <p className="mt-2 text-slate-600">Bienvenue. Le panel complet arrive en sous-phase 1C.</p>
    </div>
  );
}
```

- [ ] **Step 18.10: Lancer dev, tester manuellement**

```bash
pnpm dev
```

Naviguer vers `http://localhost:3000/login`, vérifier que toutes les pages chargent sans erreur 500. Pas encore de session → tests E2E couvrent le flow complet en Task 21.

- [ ] **Step 18.11: Commit**

```bash
git add src/app/ src/components/auth/ src/lib/trpc/
git commit -m "feat(ui): add login + 2FA pages, components, banner, admin placeholder"
```

---

## Task 19: i18n auth keys

**Files:**
- Create: `src/i18n/messages/fr/auth.json`

- [ ] **Step 19.1: Créer le fichier i18n**

```json
{
  "login.title": "Connexion",
  "login.email": "Adresse email",
  "login.password": "Mot de passe",
  "login.submit": "Se connecter",
  "login.error.generic": "Identifiants incorrects ou compte verrouillé.",
  "login.forgotPassword": "Mot de passe oublié ?",
  "twoFactor.challenge.title": "Vérification 2FA",
  "twoFactor.challenge.help": "Saisissez le code à 6 chiffres depuis votre application d'authentification.",
  "twoFactor.challenge.useBackup": "Utiliser un code de secours",
  "twoFactor.backup.title": "Code de secours",
  "twoFactor.backup.warning": "Ce code sera invalidé après usage. Pensez à régénérer vos codes après connexion.",
  "twoFactor.setup.title": "Configuration 2FA",
  "twoFactor.setup.manualEntry": "Saisir manuellement",
  "twoFactor.setup.activate": "Activer",
  "twoFactor.recoveryCodes.title": "Codes de secours",
  "twoFactor.recoveryCodes.help": "Sauvegardez ces 8 codes. Chacun peut être utilisé une fois si vous perdez l'accès à votre app.",
  "twoFactor.recoveryCodes.download": "Télécharger en .txt",
  "twoFactor.recoveryCodes.confirm": "J'ai sauvegardé ces codes en lieu sûr.",
  "twoFactor.recoveryCodes.continue": "Continuer",
  "twoFactor.banner.title": "2FA obligatoire dans {{days}} jour{{plural}}.",
  "twoFactor.banner.cta": "Configurer maintenant"
}
```

- [ ] **Step 19.2: Itérer plus tard pour brancher next-intl si besoin**

Pour Phase 1A, les copies sont en dur dans les composants (rapide). Le branchement next-intl complet est différé en 1C ou plus tard. Cette task documente les clés pour cohérence.

- [ ] **Step 19.3: Commit**

```bash
git add src/i18n/messages/fr/auth.json
git commit -m "docs(i18n): add fr auth labels reference"
```

---

## Task 20: Server Action logout

**Files:**
- Create: `src/app/(auth)/logout/route.ts` (route handler POST)
- Modify: `src/components/auth/LogoutButton.tsx`

- [ ] **Step 20.1: Route handler logout**

`src/app/(auth)/logout/route.ts` :

```ts
import { NextResponse } from 'next/server';
import { auth, signOut } from '@/server/auth';
import { db } from '@/lib/db';
import { recordAudit } from '@/lib/audit-log';

export async function POST(req: Request) {
  const jwt = await auth();
  const userId = jwt ? (jwt as { userId?: string }).userId : null;
  if (userId) {
    // Supprime toutes les sessions DB de ce user (rotation au logout)
    await db.session.deleteMany({ where: { userId } });
    await recordAudit({ action: 'auth.session.revoked', actor: { id: userId } });
  }
  await signOut({ redirect: false });
  return NextResponse.redirect(new URL('/login', req.url));
}

export async function GET(req: Request) { return POST(req); }
```

- [ ] **Step 20.2: Composant bouton logout (utilisé sur /admin et plus tard)**

`src/components/auth/LogoutButton.tsx` :

```tsx
'use client';
import { Button } from '@/components/ui/button';

export function LogoutButton() {
  return (
    <form action="/logout" method="post">
      <Button type="submit" variant="ghost">Se déconnecter</Button>
    </form>
  );
}
```

Inclure dans `src/app/admin/page.tsx` (en haut à droite ou en bas).

- [ ] **Step 20.3: Commit**

```bash
git add src/app/\(auth\)/logout/ src/components/auth/LogoutButton.tsx src/app/admin/page.tsx
git commit -m "feat(auth): add logout route + button (revokes all DB sessions)"
```

---

## Task 21: E2E tests (5 scénarios Playwright)

**Files:**
- Create: `tests/e2e/auth-1a.spec.ts`
- Create: `tests/e2e/helpers/totp.ts`
- Create: `tests/e2e/helpers/db.ts`

- [ ] **Step 21.1: Helpers E2E**

`tests/e2e/helpers/totp.ts` :

```ts
import { authenticator } from 'otplib';
export function totpFor(secret: string): string {
  return authenticator.generate(secret);
}
```

`tests/e2e/helpers/db.ts` :

```ts
import { PrismaClient } from '@prisma/client';
export function getPrisma(): PrismaClient {
  return new PrismaClient();
}
```

- [ ] **Step 21.2: Créer le spec E2E**

`tests/e2e/auth-1a.spec.ts` :

```ts
import { test, expect } from '@playwright/test';
import { getPrisma } from './helpers/db';
import { totpFor } from './helpers/totp';
import { runBootstrap } from '../../scripts/bootstrap-admin';
import { hashPassword } from '../../src/lib/password';

const prisma = getPrisma();

test.beforeEach(async () => {
  // Truncate (test DB only — pas en CI prod)
  await prisma.session.deleteMany();
  await prisma.twoFactorSecret.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.user.deleteMany();
});

test('Scénario 1: bootstrap → login → atterrit sur /2fa/setup (timer >7j)', async ({ page }) => {
  // Bootstrap admin avec date créée il y a 8 jours
  const u = await prisma.user.create({
    data: {
      email: 'admin@x.test',
      displayName: 'Admin',
      passwordHash: await hashPassword('TestPass-123!'),
      role: 'GLOBAL_ADMIN',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      createdAt: new Date(Date.now() - 8 * 24 * 3600 * 1000),
    },
  });

  await page.goto('/login');
  await page.fill('input[name="email"]', 'admin@x.test');
  await page.fill('input[name="password"]', 'TestPass-123!');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/2fa\/setup/);
});

test('Scénario 2: enrolment 2FA → recovery codes → /admin', async ({ page }) => {
  await prisma.user.create({
    data: {
      email: 'admin2@x.test',
      displayName: 'Admin',
      passwordHash: await hashPassword('TestPass-123!'),
      role: 'GLOBAL_ADMIN',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });

  await page.goto('/login');
  await page.fill('input[name="email"]', 'admin2@x.test');
  await page.fill('input[name="password"]', 'TestPass-123!');
  await page.click('button[type="submit"]');
  await page.goto('/2fa/setup');

  // Lire le secret stocké en DB après l'auto-enroll
  await page.waitForSelector('img[alt*="QR"]');
  const sec = await prisma.twoFactorSecret.findFirstOrThrow({ where: { user: { email: 'admin2@x.test' } } });
  const { decryptSecret } = await import('../../src/lib/crypto');
  const rawSecret = decryptSecret(sec.secretCipher);

  await page.fill('input[name="code"]', totpFor(rawSecret));
  await page.click('button[type="submit"]');

  await expect(page).toHaveURL(/\/2fa\/setup\/recovery-codes/);
  await page.check('input[type="checkbox"]');
  await page.click('button:has-text("Continuer")');
  await expect(page).toHaveURL('/');
});

test('Scénario 3: login complet avec 2FA actif', async ({ page }) => {
  const { generateTotpSecret, generateBackupCodes, hashBackupCodes } = await import('../../src/lib/totp');
  const { encryptSecret } = await import('../../src/lib/crypto');
  const secret = generateTotpSecret();
  const u = await prisma.user.create({
    data: {
      email: 'user3@x.test',
      displayName: 'U',
      passwordHash: await hashPassword('TestPass-123!'),
      twoFactorEnabled: true,
      emailVerifiedAt: new Date(),
    },
  });
  await prisma.twoFactorSecret.create({
    data: {
      userId: u.id,
      secretCipher: encryptSecret(secret),
      backupCodes: await hashBackupCodes(generateBackupCodes()),
      confirmedAt: new Date(),
    },
  });

  await page.goto('/login');
  await page.fill('input[name="email"]', 'user3@x.test');
  await page.fill('input[name="password"]', 'TestPass-123!');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/login\/2fa/);
  await page.fill('input[name="code"]', totpFor(secret));
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL('/');
});

test('Scénario 4: login + backup code consommé', async ({ page }) => {
  const { generateTotpSecret, generateBackupCodes, hashBackupCodes } = await import('../../src/lib/totp');
  const { encryptSecret } = await import('../../src/lib/crypto');
  const codes = generateBackupCodes();
  const u = await prisma.user.create({
    data: {
      email: 'user4@x.test',
      displayName: 'U',
      passwordHash: await hashPassword('TestPass-123!'),
      twoFactorEnabled: true,
      emailVerifiedAt: new Date(),
    },
  });
  await prisma.twoFactorSecret.create({
    data: {
      userId: u.id,
      secretCipher: encryptSecret(generateTotpSecret()),
      backupCodes: await hashBackupCodes(codes),
      confirmedAt: new Date(),
    },
  });

  await page.goto('/login');
  await page.fill('input[name="email"]', 'user4@x.test');
  await page.fill('input[name="password"]', 'TestPass-123!');
  await page.click('button[type="submit"]');
  await page.click('a:has-text("code de secours")');
  await page.fill('input[name="code"]', codes[0]);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL('/');

  const sec = await prisma.twoFactorSecret.findUniqueOrThrow({ where: { userId: u.id } });
  expect(sec.backupCodes).toHaveLength(7);
});

test('Scénario 5: lockout après 20 échecs', async ({ page }) => {
  await prisma.user.create({
    data: {
      email: 'lockme@x.test',
      displayName: 'L',
      passwordHash: await hashPassword('GoodPass-123!'),
      emailVerifiedAt: new Date(),
    },
  });

  for (let i = 0; i < 20; i++) {
    await page.goto('/login');
    await page.fill('input[name="email"]', 'lockme@x.test');
    await page.fill('input[name="password"]', 'wrong');
    await page.click('button[type="submit"]');
  }

  await page.goto('/login');
  await page.fill('input[name="email"]', 'lockme@x.test');
  await page.fill('input[name="password"]', 'GoodPass-123!');
  await page.click('button[type="submit"]');
  // Reste sur /login avec erreur (lockout actif)
  await expect(page).toHaveURL(/\/login/);

  const audit = await prisma.auditLog.findFirst({ where: { action: 'auth.login.locked' } });
  expect(audit).not.toBeNull();
});
```

- [ ] **Step 21.3: Lancer les E2E**

```bash
pnpm e2e tests/e2e/auth-1a.spec.ts
```

Expected: 5 scénarios verts.

- [ ] **Step 21.4: Commit**

```bash
git add tests/e2e/
git commit -m "test(e2e): add 5 auth scenarios for phase 1A"
```

---

## Task 22: Attack tests dédiés

**Files:**
- Create: `tests/attacks/auth.test.ts`

- [ ] **Step 22.1: Créer le spec attack**

`tests/attacks/auth.test.ts` :

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getTestPrisma, truncateAll } from '../integration/setup/prisma';
import { authorizeCredentials } from '@/server/auth/credentials-provider';
import { hashPassword } from '@/lib/password';
import { encryptSecret } from '@/lib/crypto';
import { generateTotpSecret } from '@/lib/totp';
import { loginLimiter, twoFactorLimiter } from '@/lib/rate-limit';
import { appRouter } from '@/server/trpc/routers/_app';

const prisma = getTestPrisma();

beforeEach(async () => {
  await truncateAll();
});

describe('A1 — Bruteforce login', () => {
  it('5 tentatives < 15 min puis 6ᵉ rate limited', async () => {
    await prisma.user.create({
      data: { email: 'bf@x.test', displayName: 'X', passwordHash: await hashPassword('good') },
    });
    await loginLimiter.delete('iphash:bf@x.test');
    for (let i = 0; i < 5; i++) {
      await authorizeCredentials({ email: 'bf@x.test', password: 'wrong' }, { ip: '1.2.3.4', userAgent: 'UA' });
    }
    const result = await authorizeCredentials({ email: 'bf@x.test', password: 'good' }, { ip: '1.2.3.4', userAgent: 'UA' });
    expect(result).toBeNull();
  });
});

describe('A1b — Bruteforce 2FA', () => {
  it('5 codes invalides sur même session pending → block', async () => {
    const u = await prisma.user.create({
      data: { email: 'bf2@x.test', displayName: 'X', passwordHash: await hashPassword('x'), twoFactorEnabled: true },
    });
    await prisma.twoFactorSecret.create({
      data: { userId: u.id, secretCipher: encryptSecret(generateTotpSecret()), backupCodes: [], confirmedAt: new Date() },
    });
    const session = await prisma.session.create({
      data: { sessionToken: 'tk-bf2', userId: u.id, expiresAt: new Date(Date.now() + 1e9), ipHash: 'i', userAgentHash: 'u', pending2fa: true },
    });
    await twoFactorLimiter.delete(session.id);
    const caller = appRouter.createCaller({ user: u, session });
    for (let i = 0; i < 5; i++) {
      await expect(caller.auth.verify2FA({ code: '000000' })).rejects.toThrow();
    }
    await expect(caller.auth.verify2FA({ code: '000000' })).rejects.toThrow(/TOO_MANY_REQUESTS|429/);
  });
});

describe('A2 — Énumération via timing', () => {
  it('user inconnu vs user connu mauvais MdP : timing similaire', async () => {
    await prisma.user.create({
      data: { email: 'real@x.test', displayName: 'X', passwordHash: await hashPassword('good') },
    });
    const N = 30;
    const tU: number[] = [];
    const tK: number[] = [];
    for (let i = 0; i < N; i++) {
      await loginLimiter.delete(`iphash:real@x.test`);
      await loginLimiter.delete(`iphash:ghost@x.test`);
      const a = performance.now();
      await authorizeCredentials({ email: 'ghost@x.test', password: 'x' }, { ip: '1.2.3.4', userAgent: 'UA' });
      tU.push(performance.now() - a);
      const b = performance.now();
      await authorizeCredentials({ email: 'real@x.test', password: 'wrong' }, { ip: '1.2.3.4', userAgent: 'UA' });
      tK.push(performance.now() - b);
    }
    const avgU = tU.reduce((s, x) => s + x, 0) / N;
    const avgK = tK.reduce((s, x) => s + x, 0) / N;
    expect(Math.abs(avgU - avgK)).toBeLessThan(50);
  });
});

describe('A6 — TOTP secret en DB non exploitable sans clé', () => {
  it('secretCipher en DB est différent du secret raw', async () => {
    const u = await prisma.user.create({
      data: { email: 'totp@x.test', displayName: 'X', passwordHash: await hashPassword('x') },
    });
    const raw = generateTotpSecret();
    await prisma.twoFactorSecret.create({
      data: { userId: u.id, secretCipher: encryptSecret(raw), backupCodes: [] },
    });
    const stored = await prisma.twoFactorSecret.findUnique({ where: { userId: u.id } });
    expect(stored?.secretCipher).not.toBe(raw);
    expect(stored?.secretCipher).toContain(':');
  });
});

describe('A7 — Session fixation', () => {
  it('après upgrade 2FA, le session token change', async () => {
    const u = await prisma.user.create({
      data: { email: 'fix@x.test', displayName: 'X', passwordHash: await hashPassword('x'), twoFactorEnabled: true },
    });
    const raw = generateTotpSecret();
    await prisma.twoFactorSecret.create({
      data: { userId: u.id, secretCipher: encryptSecret(raw), backupCodes: [], confirmedAt: new Date() },
    });
    const session = await prisma.session.create({
      data: { sessionToken: 'old-tok-fixation', userId: u.id, expiresAt: new Date(Date.now() + 1e9), ipHash: 'i', userAgentHash: 'u', pending2fa: true },
    });
    await twoFactorLimiter.delete(session.id);
    const caller = appRouter.createCaller({ user: u, session });
    const { authenticator } = await import('otplib');
    const out = await caller.auth.verify2FA({ code: authenticator.generate(raw) });
    expect(out.sessionToken).not.toBe('old-tok-fixation');
    const old = await prisma.session.findUnique({ where: { sessionToken: 'old-tok-fixation' } });
    expect(old).toBeNull();
  });
});

describe('A5 — 2FA downgrade impossible sans re-auth', () => {
  it('disable2FA refuse sans password', async () => {
    const u = await prisma.user.create({
      data: { email: 'dis@x.test', displayName: 'X', passwordHash: await hashPassword('correct'), twoFactorEnabled: true, role: 'USER' },
    });
    await prisma.twoFactorSecret.create({
      data: { userId: u.id, secretCipher: encryptSecret('x'), backupCodes: [], confirmedAt: new Date() },
    });
    const session = await prisma.session.create({
      data: { sessionToken: 'tk-dis', userId: u.id, expiresAt: new Date(Date.now() + 1e9), ipHash: 'i', userAgentHash: 'u', pending2fa: false },
    });
    const caller = appRouter.createCaller({ user: u, session });
    await expect(caller.auth.disable2FA({ password: 'wrong', code: '000000' })).rejects.toThrow();
  });

  it('disable2FA refuse pour Admin global', async () => {
    const u = await prisma.user.create({
      data: { email: 'admdis@x.test', displayName: 'X', passwordHash: await hashPassword('p'), twoFactorEnabled: true, role: 'GLOBAL_ADMIN' },
    });
    const session = await prisma.session.create({
      data: { sessionToken: 'tk-admdis', userId: u.id, expiresAt: new Date(Date.now() + 1e9), ipHash: 'i', userAgentHash: 'u', pending2fa: false },
    });
    const caller = appRouter.createCaller({ user: u, session });
    await expect(caller.auth.disable2FA({ password: 'p', code: '000000' })).rejects.toThrow(/global admin/i);
  });
});
```

- [ ] **Step 22.2: Lancer les attack tests**

```bash
pnpm test:integration tests/attacks/auth.test.ts
```

Expected: tous verts.

- [ ] **Step 22.3: Commit**

```bash
git add tests/attacks/
git commit -m "test(attacks): add A1, A1b, A2, A5, A6, A7 dedicated attack tests"
```

---

## Task 23: Cleanup jobs (worker BullMQ)

**Files:**
- Create: `worker/jobs/cleanup-expired-sessions.ts`
- Create: `worker/jobs/cleanup-expired-tokens.ts`
- Modify: `worker/index.ts` (enregistrer les jobs)
- Modify: `worker/package.json` (deps si besoin : bullmq, @prisma/client)
- Create: `tests/integration/cleanup-jobs.test.ts`

- [ ] **Step 23.1: Installer bullmq côté worker**

```bash
cd worker && pnpm add bullmq @prisma/client && cd ..
```

- [ ] **Step 23.2: Créer `worker/jobs/cleanup-expired-sessions.ts`**

```ts
import { PrismaClient } from '@prisma/client';

const INACTIVITY_TTL_MS = 7 * 24 * 3600 * 1000;

export async function cleanupExpiredSessions(prisma: PrismaClient): Promise<{ deleted: number }> {
  const cutoffActivity = new Date(Date.now() - INACTIVITY_TTL_MS);
  const r = await prisma.session.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date() } },
        { lastActivityAt: { lt: cutoffActivity } },
      ],
    },
  });
  return { deleted: r.count };
}
```

- [ ] **Step 23.3: Créer `worker/jobs/cleanup-expired-tokens.ts`**

```ts
import { PrismaClient } from '@prisma/client';

export async function cleanupExpiredTokens(prisma: PrismaClient): Promise<{ invitations: number; resets: number }> {
  const now = new Date();
  // Log expired invitations before deleting
  const expiredInvitations = await prisma.invitation.findMany({
    where: { expiresAt: { lt: now }, consumedAt: null },
    select: { id: true },
  });
  for (const inv of expiredInvitations) {
    await prisma.auditLog.create({
      data: {
        action: 'auth.invitation.expired',
        targetType: 'INVITATION',
        targetId: inv.id,
      },
    });
  }
  const invDel = await prisma.invitation.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  const resetDel = await prisma.passwordResetToken.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  return { invitations: invDel.count, resets: resetDel.count };
}
```

Note : ce job écrit directement dans `auditLog` car le worker ne peut pas importer `recordAudit` du frontend (path mapping `@/`). Cette exception est tolérée pour le worker uniquement et documentée par un commentaire ESLint disable si nécessaire.

- [ ] **Step 23.4: Enregistrer les jobs dans `worker/index.ts`**

Étendre le fichier existant pour ajouter une queue BullMQ qui exécute les deux jobs sur cron toutes les heures :

```ts
// ... imports existants ...
import { Queue, Worker } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { cleanupExpiredSessions } from './jobs/cleanup-expired-sessions';
import { cleanupExpiredTokens } from './jobs/cleanup-expired-tokens';

const prisma = new PrismaClient();
const QUEUE_NAME = 'cleanup';

const queue = new Queue(QUEUE_NAME, { connection: redis });

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    if (job.name === 'cleanup-expired-sessions') {
      const r = await cleanupExpiredSessions(prisma);
      logger.info({ ...r }, 'cleanup-expired-sessions done');
    } else if (job.name === 'cleanup-expired-tokens') {
      const r = await cleanupExpiredTokens(prisma);
      logger.info({ ...r }, 'cleanup-expired-tokens done');
    }
  },
  { connection: redis },
);

// Ajout cron : toutes les heures à hh:00 et hh:05
async function scheduleCleanup() {
  await queue.upsertJobScheduler('cleanup-sessions-hourly', { pattern: '0 * * * *' }, {
    name: 'cleanup-expired-sessions',
    data: {},
  });
  await queue.upsertJobScheduler('cleanup-tokens-hourly', { pattern: '5 * * * *' }, {
    name: 'cleanup-expired-tokens',
    data: {},
  });
}

void scheduleCleanup();

// shutdown: étendre l'existant
const shutdown = async () => {
  logger.info('shutting down');
  await worker.close();
  await queue.close();
  await prisma.$disconnect();
  await redis.quit();
  process.exit(0);
};
```

- [ ] **Step 23.5: Test integration cleanup**

`tests/integration/cleanup-jobs.test.ts` :

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { cleanupExpiredSessions } from '../../worker/jobs/cleanup-expired-sessions';
import { cleanupExpiredTokens } from '../../worker/jobs/cleanup-expired-tokens';
import { getTestPrisma, truncateAll } from './setup/prisma';
import { hashPassword } from '@/lib/password';

const prisma = getTestPrisma();

beforeEach(async () => {
  await truncateAll();
});

describe('cleanupExpiredSessions', () => {
  it('supprime sessions expirées et inactives', async () => {
    const u = await prisma.user.create({
      data: { email: 'c1@x.test', displayName: 'X', passwordHash: await hashPassword('x') },
    });
    await prisma.session.createMany({
      data: [
        { sessionToken: 's1', userId: u.id, expiresAt: new Date(Date.now() - 1000), ipHash: 'i', userAgentHash: 'u' },
        { sessionToken: 's2', userId: u.id, expiresAt: new Date(Date.now() + 1e9), lastActivityAt: new Date(Date.now() - 8 * 24 * 3600 * 1000), ipHash: 'i', userAgentHash: 'u' },
        { sessionToken: 's3', userId: u.id, expiresAt: new Date(Date.now() + 1e9), lastActivityAt: new Date(), ipHash: 'i', userAgentHash: 'u' },
      ],
    });
    const r = await cleanupExpiredSessions(prisma);
    expect(r.deleted).toBe(2);
    const remaining = await prisma.session.findMany({ where: { userId: u.id } });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].sessionToken).toBe('s3');
  });
});

describe('cleanupExpiredTokens', () => {
  it('supprime invitations + reset tokens expirés et log les invitations expirées', async () => {
    const u = await prisma.user.create({
      data: { email: 'c2@x.test', displayName: 'X', passwordHash: await hashPassword('x') },
    });
    await prisma.invitation.create({
      data: { email: 'inv@x.test', invitedById: u.id, tokenHash: 'h-old', expiresAt: new Date(Date.now() - 1000) },
    });
    await prisma.passwordResetToken.create({
      data: { userId: u.id, tokenHash: 'rh-old', expiresAt: new Date(Date.now() - 1000) },
    });
    const r = await cleanupExpiredTokens(prisma);
    expect(r.invitations).toBe(1);
    expect(r.resets).toBe(1);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'auth.invitation.expired' } });
    expect(audit).not.toBeNull();
  });
});
```

- [ ] **Step 23.6: Lancer les tests**

```bash
pnpm test:integration tests/integration/cleanup-jobs.test.ts
```

Expected: 2 tests verts.

- [ ] **Step 23.7: Commit**

```bash
git add worker/ tests/integration/cleanup-jobs.test.ts
git commit -m "feat(worker): add hourly cleanup jobs for sessions and expired tokens"
```

---

## Task 24: Smoke test final + tag

**Files:**
- Modify: `README.md` (section auth ajoutée)

- [ ] **Step 24.1: Lancer toute la suite de tests**

```bash
pnpm test
pnpm test:integration
pnpm e2e
```

Expected: tout vert. Si une suite échoue, fix et re-commit avant de continuer.

- [ ] **Step 24.2: Lancer le typecheck + lint**

```bash
pnpm typecheck
pnpm lint
pnpm format:check
```

Expected: tout vert.

- [ ] **Step 24.3: Build production**

```bash
pnpm build
```

Expected: build sans erreur.

- [ ] **Step 24.4: Smoke test docker-compose local**

```bash
docker compose up -d --build
docker compose exec app pnpm prisma migrate deploy
docker compose exec -e BOOTSTRAP_ADMIN_EMAIL=ops@x.test app pnpm bootstrap:admin
```

Vérifier sortie : email + password + countdown affichés. Naviguer manuellement vers l'IP du container, login, atterrir sur `/2fa/setup`, scanner avec une app TOTP, valider, voir recovery codes, continuer, atterrir sur `/admin`.

- [ ] **Step 24.5: Mise à jour `README.md` (section Auth)**

Ajouter une section :

```markdown
## Authentification (Phase 1A)

BiblioShare utilise Auth.js v5 avec un Credentials provider, des sessions DB hardenées (rotation, expiration absolue 30j / inactive 7j, fingerprint UA+IP), un 2FA TOTP obligatoire pour les Admin globaux après 7 jours.

### Bootstrap initial

Voir `docs/deployment.md` section « Initialisation post-déploiement ».

### Architecture

- Spec design : `docs/superpowers/specs/2026-04-26-phase-1-auth-design.md`
- Plan d'implémentation : `docs/superpowers/plans/2026-04-26-phase-1a-auth-core.md`
```

- [ ] **Step 24.6: Préparer la PR**

```bash
git push -u origin feat/phase-1a-auth-core
gh pr create --title "Phase 1A: auth core (login + 2FA + admin protection)" --body "$(cat <<'EOF'
## Summary

Sub-phase 1A delivers password+TOTP authentication for BiblioShare with a global admin created via CLI, protected by enforced 2FA after 7 days, hardened DB sessions, rate limiting, AuditLog, and three-layer permissions.

See `docs/superpowers/specs/2026-04-26-phase-1-auth-design.md` and `docs/superpowers/plans/2026-04-26-phase-1a-auth-core.md`.

## Test plan

- [ ] `pnpm test` — unit tests green
- [ ] `pnpm test:integration` — integration tests green (incl. attack suite)
- [ ] `pnpm e2e` — 5 E2E scenarios green
- [ ] `pnpm typecheck && pnpm lint && pnpm format:check` clean
- [ ] `pnpm build` clean
- [ ] Manual smoke test on Coolify staging: bootstrap admin → login → 2FA enrol → recovery codes → admin page

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 24.7: Une fois la PR mergée — taguer la fin de 1A**

(À faire manuellement après merge sur main.)

```bash
git checkout main
git pull
git tag -a phase-1a-complete -m "Phase 1A — auth core complete"
git push origin phase-1a-complete
```

- [ ] **Step 24.8: Mémoire — mise à jour fin de 1A**

Mettre à jour `MEMORY.md` du projet (auto-mémoire) avec une nouvelle entrée :
- Titre : « Phase 1A — clôture »
- Description : auth core livrée, tag `phase-1a-complete`, prochaine étape = 1B (invitations + reset)

---

## Critères de complétion 1A

- [ ] Tous les tests verts (unit + integration + E2E + attacks).
- [ ] `pnpm build` produit sans erreur.
- [ ] Bootstrap admin fonctionnel en local docker-compose.
- [ ] Login + 2FA enrolment + 2FA challenge + backup code testés manuellement sur staging.
- [ ] Tag `phase-1a-complete` posé sur main.
- [ ] Mémoire utilisateur mise à jour.
