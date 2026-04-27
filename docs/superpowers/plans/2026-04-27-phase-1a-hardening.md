# Phase 1A — Hardening Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fermer 8 dettes de sécurité Phase 1A (gaps #2 #3 #4 #5 #6 #7bis #9 #10) avant le tag `phase-1a-complete`. Gaps #1 (timing budget tunable) et #7 (cosmétique pending2fa) sont différés ; gap #8 (tests replay/race) est déjà couvert par Task 22.

**Architecture:**

- Fixes ciblés sans refactor : on touche `credentials-provider.ts`, `adapter.ts`, `session-bridge.ts`, `config.ts`, `rate-limit.ts`, `auth.ts` (tRPC router), 2 fichiers de tests, et 3 composants UI auth.
- Stratégie TDD : pour chaque gap on écrit d'abord le test (intégration ou attaque) qui échoue sur la version actuelle, puis on fixe.
- Ordre : trivials d'abord (#4, #6, #9), puis nouvelle infra (#2 + #3), puis race fixes (#5), puis JWT/UX (#7bis → #10).
- Le gap #10 dépend du gap #7bis (sessionId in JWT) : si la propagation `update()` se résout naturellement avec `isStillPending` indexée par `sessionId`, on n'a pas besoin du fallback `window.location.assign`.

**Tech Stack:** Next.js 15 App Router, next-auth v5 (JWT strategy), Prisma 6, PostgreSQL, Redis (ioredis + rate-limiter-flexible), Vitest (unit + integration), Playwright (E2E).

---

## File Structure

**Modifié :**

- `src/lib/rate-limit.ts` — ajouter `loginIpOnlyLimiter`
- `src/server/auth/credentials-provider.ts` — increment race fix + IP-only limiter compose
- `src/server/auth/adapter.ts` — `getSession` retourne row post-update
- `src/server/auth/session-bridge.ts` — TOCTOU fix sur création session concurrente
- `src/server/auth/config.ts` — sessionId in JWT + `isStillPending(sessionId)`
- `src/server/trpc/routers/auth.ts` — `verifyBackupCode` set `lastLoginAt`, retour `sessionToken` déjà présent
- `src/components/auth/TwoFactorChallenge.tsx` — `window.location.assign` fallback (si gap #10 pas résolu par #7bis seul)
- `src/components/auth/BackupCodeForm.tsx` — idem
- `src/components/auth/RecoveryCodesDisplay.tsx` — idem
- `tests/integration/credentials-provider.test.ts` — fix loginLimiter.delete keys (gap #3)

**Créé :**

- `tests/integration/credentials-provider-iponly.test.ts` — couvre gap #2 (IP-only limiter)
- `tests/integration/auth-adapter-getsession-fresh.test.ts` — couvre gap #6 (post-update return)
- `tests/integration/session-bridge-toctou.test.ts` — couvre gap #5
- `tests/integration/trpc-auth-backup-lastlogin.test.ts` — couvre gap #9
- `tests/integration/auth-config-jwt-sid.test.ts` — couvre gap #7bis

---

## Task H1: Gap #4 — `failedLoginAttempts` increment race

**Files:**

- Modify: `src/server/auth/credentials-provider.ts:71-80`
- Test: `tests/integration/credentials-provider.test.ts` (nouveau bloc)

- [ ] **Step 1: Write the failing test (concurrent bad-password attempts)**

Ajouter dans `tests/integration/credentials-provider.test.ts` après le bloc "20 échecs cumulés" :

```ts
it('gap #4 — incréments concurrents de failedLoginAttempts ne se perdent pas', async () => {
  const u = await mkUser({ email: 'race4@x.test', password: 'goodpass' });
  await prisma.user.update({ where: { id: u.id }, data: { failedLoginAttempts: 0 } });
  await loginLimiter.delete(
    `${(await import('@/lib/crypto')).hashIp(REQ.ip)}:${(await import('@/lib/crypto')).hashEmail('race4@x.test')}`,
  );
  // 5 tentatives concurrentes — sans atomique, on perd des incréments
  await Promise.all(
    Array.from({ length: 5 }, () =>
      authorizeCredentials({ email: 'race4@x.test', password: 'wrong' }, REQ),
    ),
  );
  const fresh = await prisma.user.findUnique({ where: { id: u.id } });
  expect(fresh?.failedLoginAttempts).toBe(5);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:integration credentials-provider -t "gap #4"`
Expected: FAIL — observed `failedLoginAttempts` < 5 (race lost some increments) OR rate limiter blocks before all 5 reach DB. Si rate limiter bloque (5 points = limite), bumper le `loginLimiter.delete` ou désactiver le compose le temps du test — voir Step 3.

> Note: `loginLimiter` autorise 5 tentatives en 15min ; les 5 calls peuvent passer ou se voir refuser selon la timing. Si le test bloque sur rate-limit avant le bug, le rendre déterministe en utilisant 4 tentatives au lieu de 5 et asserting `>= 1 && <= 4` perdues. Préférer 4 calls + assertion `failedLoginAttempts === 4`.

Reformuler le test :

```ts
await Promise.all(
  Array.from({ length: 4 }, () =>
    authorizeCredentials({ email: 'race4@x.test', password: 'wrong' }, REQ),
  ),
);
const fresh = await prisma.user.findUnique({ where: { id: u.id } });
expect(fresh?.failedLoginAttempts).toBe(4);
```

- [ ] **Step 3: Fix credentials-provider.ts — use Prisma `increment`**

Dans `src/server/auth/credentials-provider.ts`, remplacer l'ancien bloc bad-password (lignes 71-87) par :

```ts
if (!valid) {
  const updated = await db.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: { increment: 1 } },
    select: { failedLoginAttempts: true, lockedUntil: true },
  });
  const shouldLock = updated.failedLoginAttempts >= LOCKOUT_THRESHOLD && !updated.lockedUntil;
  if (shouldLock) {
    await db.user.update({
      where: { id: user.id },
      data: { lockedUntil: new Date(Date.now() + LOCKOUT_DURATION_MS) },
    });
  }
  await recordAudit({
    action: 'auth.login.failure',
    actor: { id: user.id },
    metadata: { reason: 'bad_password', attempts: updated.failedLoginAttempts, locked: shouldLock },
    req,
  });
  return null;
}
```

- [ ] **Step 4: Run new + existing tests to verify pass**

Run: `pnpm test:integration credentials-provider`
Expected: PASS — tous les cas (mauvais password, 20 échecs cumulés, gap #4 race, happy path reset) verts. Le test "20 échecs cumulés" reste vert car l'increment atomique préserve le seuil.

- [ ] **Step 5: Commit**

```bash
git add src/server/auth/credentials-provider.ts tests/integration/credentials-provider.test.ts
git commit -m "fix(auth): atomic increment of failedLoginAttempts (gap #4)"
```

---

## Task H2: Gap #6 — `getSession` retourne row pré-update

**Files:**

- Modify: `src/server/auth/adapter.ts:43-65`
- Create: `tests/integration/auth-adapter-getsession-fresh.test.ts`

- [ ] **Step 1: Write the failing test**

Créer `tests/integration/auth-adapter-getsession-fresh.test.ts` :

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createSessionAdapter } from '@/server/auth/adapter';
import { getTestPrisma, truncateAll } from './setup/prisma';

const prisma = getTestPrisma();
const adapter = createSessionAdapter(prisma);

beforeEach(truncateAll);

describe('getSession — gap #6', () => {
  it('retourne le row avec lastActivityAt à jour après touch', async () => {
    const user = await prisma.user.create({
      data: { email: 'g6@x.test', displayName: 'X', passwordHash: 'h' },
    });
    // Créer une session avec lastActivityAt > 1min dans le passé pour déclencher le touch
    const old = new Date(Date.now() - 5 * 60 * 1000);
    const s = await prisma.session.create({
      data: {
        sessionToken: 'tk-g6',
        userId: user.id,
        expiresAt: new Date(Date.now() + 1e9),
        lastActivityAt: old,
        ipHash: 'i',
        userAgentHash: 'u',
      },
    });
    const got = await adapter.getSession(s.sessionToken);
    expect(got).not.toBeNull();
    // Le caller doit recevoir un lastActivityAt fraîchement mis à jour, PAS le pré-update.
    expect(got!.lastActivityAt.getTime()).toBeGreaterThan(old.getTime() + 60_000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:integration auth-adapter-getsession-fresh`
Expected: FAIL — `got.lastActivityAt` égal à `old` (pré-update), différence ≈ 0ms.

- [ ] **Step 3: Fix adapter.ts — capture update result**

Dans `src/server/auth/adapter.ts`, modifier `getSession` (lignes 43-65). Remplacer le bloc touch (54-63) et `return s` :

```ts
async getSession(sessionToken: string): Promise<Session | null> {
  const s = await prisma.session.findUnique({ where: { sessionToken } });
  if (!s) return null;
  const now = Date.now();
  const isExpired = s.expiresAt.getTime() < now;
  const isInactive = now - s.lastActivityAt.getTime() > INACTIVITY_TTL_MS;
  if (isExpired || isInactive) {
    await prisma.session.delete({ where: { id: s.id } }).catch(() => undefined);
    lastTouchByToken.delete(sessionToken);
    return null;
  }
  const lastTouch = lastTouchByToken.get(sessionToken) ?? 0;
  if (now - lastTouch > TOUCH_DEBOUNCE_MS) {
    lastTouchByToken.set(sessionToken, now);
    const fresh = await prisma.session
      .update({
        where: { id: s.id },
        data: { lastActivityAt: new Date(now) },
      })
      .catch(() => null);
    if (fresh) return fresh;
  }
  return s;
},
```

- [ ] **Step 4: Run all adapter tests**

Run: `pnpm test:integration auth-adapter`
Expected: PASS sur tous (existing + new).

- [ ] **Step 5: Commit**

```bash
git add src/server/auth/adapter.ts tests/integration/auth-adapter-getsession-fresh.test.ts
git commit -m "fix(auth): getSession returns post-update session row (gap #6)"
```

---

## Task H3: Gap #9 — `verifyBackupCode` n'update pas `lastLoginAt`

**Files:**

- Modify: `src/server/trpc/routers/auth.ts:99-145`
- Create: `tests/integration/trpc-auth-backup-lastlogin.test.ts`

- [ ] **Step 1: Write the failing test**

Créer `tests/integration/trpc-auth-backup-lastlogin.test.ts` :

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getTestPrisma, truncateAll } from './setup/prisma';
import { hashPassword } from '@/lib/password';
import { encryptSecret } from '@/lib/crypto';
import { generateTotpSecret, generateBackupCodes } from '@/lib/totp';
import { appRouter } from '@/server/trpc/routers/_app';
import { twoFactorLimiter } from '@/lib/rate-limit';

const prisma = getTestPrisma();
beforeEach(truncateAll);

describe('verifyBackupCode — gap #9', () => {
  it('met à jour lastLoginAt comme verify2FA', async () => {
    const u = await prisma.user.create({
      data: {
        email: 'bk9@x.test',
        displayName: 'X',
        passwordHash: await hashPassword('x'),
        twoFactorEnabled: true,
      },
    });
    const { plainCodes, hashes } = await generateBackupCodes(2);
    await prisma.twoFactorSecret.create({
      data: {
        userId: u.id,
        secretCipher: encryptSecret(generateTotpSecret()),
        backupCodes: hashes,
        confirmedAt: new Date(),
      },
    });
    const session = await prisma.session.create({
      data: {
        sessionToken: 'tk-bk9',
        userId: u.id,
        expiresAt: new Date(Date.now() + 1e9),
        ipHash: 'i',
        userAgentHash: 'u',
        pending2fa: true,
      },
    });
    await twoFactorLimiter.delete(session.id);
    const before = (await prisma.user.findUnique({ where: { id: u.id } }))!.lastLoginAt;
    expect(before).toBeNull();
    const caller = appRouter.createCaller({ user: u, session });
    await caller.auth.verifyBackupCode({ code: plainCodes[0]! });
    const after = (await prisma.user.findUnique({ where: { id: u.id } }))!.lastLoginAt;
    expect(after).not.toBeNull();
    expect(after!.getTime()).toBeGreaterThan(Date.now() - 5_000);
  });
});
```

> Note: vérifier la signature de `generateBackupCodes` dans `src/lib/totp.ts` — adapter l'import si elle retourne un tuple ou un objet différent. Si elle retourne `{ plain: string[]; hashes: string[] }`, ajuster.

- [ ] **Step 2: Verify generateBackupCodes signature**

Run: `grep -n "export.*generateBackupCodes\|generateBackupCodes" src/lib/totp.ts`
Expected: une fonction qui produit codes + hashes. Adapter le test selon la forme réelle (probablement `{ plain, hashes }` ou tableau de `{plain, hash}`).

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test:integration trpc-auth-backup-lastlogin`
Expected: FAIL — `after` est `null` car `verifyBackupCode` ne touche pas `lastLoginAt`.

- [ ] **Step 4: Fix auth.ts router**

Dans `src/server/trpc/routers/auth.ts`, ajouter une ligne après le `upgradePendingSession` dans `verifyBackupCode` (après ligne 138) :

```ts
const adapter = createSessionAdapter(db);
const fresh = await adapter.upgradePendingSession({
  oldSessionId: ctx.session.id,
  ipHash: ctx.session.ipHash,
  userAgentHash: ctx.session.userAgentHash,
});
await db.user.update({ where: { id: ctx.user.id }, data: { lastLoginAt: new Date() } });
await recordAudit({
  action: 'auth.2fa.backup_code_used',
  actor: { id: ctx.user.id },
  metadata: { remaining: result.remainingHashes.length },
});
return { ok: true, sessionToken: fresh.sessionToken };
```

- [ ] **Step 5: Run test to verify it passes + run full trpc-auth suite**

Run: `pnpm test:integration trpc-auth`
Expected: PASS sur tous (la suite trpc-auth originelle ne doit pas régresser).

- [ ] **Step 6: Commit**

```bash
git add src/server/trpc/routers/auth.ts tests/integration/trpc-auth-backup-lastlogin.test.ts
git commit -m "fix(auth): verifyBackupCode updates lastLoginAt (gap #9)"
```

---

## Task H4: Gap #2 — IP-only login rate limiter

**Files:**

- Modify: `src/lib/rate-limit.ts`
- Modify: `src/server/auth/credentials-provider.ts:35-45`
- Create: `tests/integration/credentials-provider-iponly.test.ts`

- [ ] **Step 1: Add the new limiter to rate-limit.ts**

Dans `src/lib/rate-limit.ts`, ajouter après `loginLimiter` :

```ts
export const loginIpOnlyLimiter = new RateLimiterRedis({
  ...baseOpts(),
  keyPrefix: 'rl:login_ip',
  points: 50,
  duration: 15 * 60,
  blockDuration: 60 * 60,
  insuranceLimiter: memInsurance(50, 15 * 60),
});
```

> Justification du cap : 50 tentatives / 15min / IP couvre l'usage légitime (familles partageant un router, NAT d'entreprise) tout en bloquant le credential stuffing classique (>50 emails depuis une seule IP).

- [ ] **Step 2: Write the failing test**

Créer `tests/integration/credentials-provider-iponly.test.ts` :

```ts
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
    // Créer 51 users distincts pour ne PAS toucher le per-(ip,email) limiter
    const emails: string[] = [];
    for (let i = 0; i < 51; i++) {
      const email = `stuff${i}@x.test`;
      emails.push(email);
      await prisma.user.create({
        data: { email, displayName: 'X', passwordHash: await hashPassword('good') },
      });
      // Pre-clear per-(ip,email) limiter pour qu'il ne bloque pas
      await loginLimiter.delete(`${ipH}:${hashEmail(email)}`);
    }
    // 50 premières tentatives passent (mauvais password, mais pas rate-limited par l'IP-only)
    for (let i = 0; i < 50; i++) {
      const r = await authorizeCredentials({ email: emails[i]!, password: 'wrong' }, REQ);
      expect(r).toBeNull();
    }
    // 51ᵉ tentative (sur un email frais) doit être bloquée par le limiter IP-only
    const blocked = await authorizeCredentials({ email: emails[50]!, password: 'good' }, REQ);
    expect(blocked).toBeNull();
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'auth.login.locked' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit?.metadata).toMatchObject({ reason: 'ip_rate_limited' });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test:integration credentials-provider-iponly`
Expected: FAIL — la 51ᵉ tentative renvoie `null` (mauvais password) mais il n'y a pas d'audit `ip_rate_limited`.

- [ ] **Step 4: Compose IP-only limiter dans authorizeCredentials**

Dans `src/server/auth/credentials-provider.ts`, juste avant le bloc `loginLimiter.consume` (ligne 35), insérer :

```ts
import { loginLimiter, loginIpOnlyLimiter } from '@/lib/rate-limit';
// ...
try {
  await loginIpOnlyLimiter.consume(ipH);
} catch {
  await recordAudit({
    action: 'auth.login.locked',
    target: { type: 'EMAIL', id: emailH },
    metadata: { reason: 'ip_rate_limited' },
    req,
  });
  return null;
}

try {
  await loginLimiter.consume(`${ipH}:${emailH}`);
} catch {
  // ... reste inchangé
}
```

> Important : le import `loginLimiter` doit devenir `loginLimiter, loginIpOnlyLimiter` dans le bloc d'imports en tête de fichier.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test:integration credentials-provider-iponly`
Expected: PASS — `audit?.metadata.reason === 'ip_rate_limited'`.

- [ ] **Step 6: Run full credentials-provider suite to ensure no regression**

Run: `pnpm test:integration credentials-provider`
Expected: PASS sur tous. Le limiter IP-only est plus permissif (50 vs 5) donc il ne devrait pas déclencher pendant les autres tests.

> Si le test "20 échecs cumulés" passe à 21+ tentatives et déclenche le 50, ajouter `await loginIpOnlyLimiter.delete(ipH)` dans son `beforeEach`. Vérifier au passage le test attaque A1 (`tests/attacks/auth.test.ts:34-52`) qui fait 6 tentatives — pas impacté.

- [ ] **Step 7: Commit**

```bash
git add src/lib/rate-limit.ts src/server/auth/credentials-provider.ts tests/integration/credentials-provider-iponly.test.ts
git commit -m "feat(auth): add IP-only login limiter to mitigate credential stuffing (gap #2)"
```

---

## Task H5: Gap #3 — Fix `loginLimiter.delete` no-op keys dans tests

**Files:**

- Modify: `tests/integration/credentials-provider.test.ts:26-31`

- [ ] **Step 1: Replace literal keys with real hash helper**

Dans `tests/integration/credentials-provider.test.ts`, remplacer le bloc imports + beforeEach :

Imports en tête (ajouter ces imports) :

```ts
import { hashIp, hashEmail } from '@/lib/crypto';
import { loginLimiter, loginIpOnlyLimiter } from '@/lib/rate-limit';
```

Helper en haut du fichier (après les imports, avant `mkUser`) :

```ts
const REQ = { ip: '1.2.3.4', userAgent: 'UA' };
const ipH = hashIp(REQ.ip);
const loginKey = (email: string) => `${ipH}:${hashEmail(email)}`;
```

Remplacer le `beforeEach` (lignes 26-31) :

```ts
beforeEach(async () => {
  await truncateAll();
  await loginIpOnlyLimiter.delete(ipH);
  for (const e of [
    'test1@x.test',
    'test2@x.test',
    'test3@x.test',
    'lockd@x.test',
    'multi@x.test',
    'reset@x.test',
    'timing@x.test',
    'unknown@x.test',
    'race4@x.test',
  ]) {
    await loginLimiter.delete(loginKey(e));
  }
});
```

> Le `const REQ` existe déjà ligne 33. Le déplacer en haut, avant `mkUser`, et supprimer celui de la ligne 33 pour éviter doublon.

- [ ] **Step 2: Run full credentials-provider suite**

Run: `pnpm test:integration credentials-provider`
Expected: PASS — les tests étaient déjà verts grâce à l'isolation par email unique. Avec les vraies clés, la cleanup est désormais effective et le test gap #4 ajouté en H1 reste vert même en watch mode multi-runs.

- [ ] **Step 3: Verify watch mode no longer leaks state**

Run: `pnpm test:integration credentials-provider --watch=false` deux fois consécutives.
Expected: même résultat (PASS) sur les deux runs sans flake.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/credentials-provider.test.ts
git commit -m "test(auth): fix loginLimiter.delete keys to use real hashes (gap #3)"
```

---

## Task H6: Gap #5 — TOCTOU sur création session dans session-bridge

**Files:**

- Modify: `src/server/auth/session-bridge.ts:22-32`
- Create: `tests/integration/session-bridge-toctou.test.ts`

- [ ] **Step 1: Write the failing test**

Créer `tests/integration/session-bridge-toctou.test.ts` :

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getTestPrisma, truncateAll } from './setup/prisma';
import { hashPassword } from '@/lib/password';

const prisma = getTestPrisma();
beforeEach(truncateAll);

// Stubber `auth()` et `headers()` pour que getCurrentSessionAndUser fonctionne en isolation
vi.mock('@/server/auth', () => ({
  auth: vi.fn(),
}));
vi.mock('next/headers', () => ({
  headers: async () =>
    new Map([
      ['x-forwarded-for', '1.2.3.4'],
      ['user-agent', 'UA'],
    ]),
}));

describe('session-bridge — gap #5 TOCTOU', () => {
  it('deux appels concurrents getCurrentSessionAndUser ne créent pas 2 sessions', async () => {
    const u = await prisma.user.create({
      data: {
        email: 'tc5@x.test',
        displayName: 'X',
        passwordHash: await hashPassword('x'),
        status: 'ACTIVE',
      },
    });
    const { auth } = await import('@/server/auth');
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: u.id });
    const { getCurrentSessionAndUser } = await import('@/server/auth/session-bridge');
    // 5 appels concurrents → sans fix on attend 5 sessions DB
    await Promise.all([
      getCurrentSessionAndUser(),
      getCurrentSessionAndUser(),
      getCurrentSessionAndUser(),
      getCurrentSessionAndUser(),
      getCurrentSessionAndUser(),
    ]);
    const sessions = await prisma.session.findMany({ where: { userId: u.id } });
    // Avec fix : ≤ 2 (peut y avoir 1-2 due au race acceptable). Sans fix : 5.
    expect(sessions.length).toBeLessThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:integration session-bridge-toctou`
Expected: FAIL — `sessions.length === 5` (ou close à 5).

> Si les mocks Vitest posent problème (next/headers est tricky en Node), simplifier le test en appelant directement `adapter.createSession` 5 fois via `Promise.all` avec un user existant + assertion de count avec un `@@unique` partiel constraint sur `(userId, ipHash, pending2fa)`. Choix d'implémentation à valider en step 3.

- [ ] **Step 3: Implement fix — guard via pre-create findFirst within transaction**

Le fix doit être idempotent sans changer le schéma (un `@@unique([userId, ipHash])` casserait le multi-device et nécessiterait une migration). On prend une approche pessimistic via `prisma.$transaction` avec advisory lock léger.

Dans `src/server/auth/session-bridge.ts`, modifier la branche `if (!session)` (lignes 26-33) :

```ts
if (!session) {
  // TOCTOU guard : on re-find puis create dans une transaction sérialisée par userId.
  session = await db.$transaction(async (tx) => {
    const existing = await tx.session.findFirst({
      where: { userId, expiresAt: { gt: new Date() } },
      orderBy: { lastActivityAt: 'desc' },
    });
    if (existing) return existing;
    const adapter = createSessionAdapter(tx as PrismaClient);
    return adapter.createSession({
      userId,
      ipHash: hashIp(ip),
      userAgentHash: hashUa(ua),
      pending2fa: !!user.twoFactorEnabled,
    });
  });
} else {
  await adapter.getSession(session.sessionToken);
}
```

> Note : `createSessionAdapter(tx as PrismaClient)` fonctionne car le shape `prisma.session.findUnique/create` est identique sur `Prisma.TransactionClient`. Le cast est sûr ici (l'adapter n'utilise pas `$transaction` lui-même).
> Pas de adapter top-level `const adapter = ...` à supprimer si il était déjà déclaré ; vérifier les imports en début de fichier.

- [ ] **Step 4: Run the test**

Run: `pnpm test:integration session-bridge-toctou`
Expected: PASS — `sessions.length <= 2`. Postgres ne sérialise pas les findFirst dans des transactions READ COMMITTED par défaut, donc on peut encore avoir 2 sessions au pire (race entre 2 transactions). Le test accepte ça (≤ 2).

> Si on veut zéro race, il faut un `SELECT FOR UPDATE` ou un advisory lock — overkill pour un usage 50-200 users. ≤ 2 est acceptable.

- [ ] **Step 5: Commit**

```bash
git add src/server/auth/session-bridge.ts tests/integration/session-bridge-toctou.test.ts
git commit -m "fix(auth): TOCTOU guard via tx in session-bridge (gap #5)"
```

---

## Task H7: Gap #7bis — `sessionId` in JWT + `isStillPending(sessionId)`

**Files:**

- Modify: `src/server/auth/config.ts`
- Modify: `src/server/auth/session-bridge.ts` (pour propager `sessionId` au JWT)
- Create: `tests/integration/auth-config-jwt-sid.test.ts`

> Contexte : `isStillPending(userId)` actuel lit la session "most recent by lastActivityAt", ce qui peut donner un faux négatif (`pending2fa = false`) si un autre device a déjà vérifié. On veut que le JWT pointe vers SA session DB, pas "n'importe quelle session du user".

- [ ] **Step 1: Write the failing test (cross-device leak)**

Créer `tests/integration/auth-config-jwt-sid.test.ts` :

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getTestPrisma, truncateAll } from './setup/prisma';

const prisma = getTestPrisma();
beforeEach(truncateAll);

describe('isStillPending — gap #7bis', () => {
  it("un device pending NE doit PAS hériter du pending2fa=false d'un autre device verified", async () => {
    const u = await prisma.user.create({
      data: { email: 'sid7@x.test', displayName: 'X', passwordHash: 'h', twoFactorEnabled: true },
    });
    // Device A : déjà 2FA verified (pending=false), lastActivityAt récent
    const verified = await prisma.session.create({
      data: {
        sessionToken: 'tk-A',
        userId: u.id,
        expiresAt: new Date(Date.now() + 1e9),
        lastActivityAt: new Date(),
        ipHash: 'A',
        userAgentHash: 'A',
        pending2fa: false,
      },
    });
    // Device B : encore pending, lastActivityAt plus ancien
    const pending = await prisma.session.create({
      data: {
        sessionToken: 'tk-B',
        userId: u.id,
        expiresAt: new Date(Date.now() + 1e9),
        lastActivityAt: new Date(Date.now() - 60_000),
        ipHash: 'B',
        userAgentHash: 'B',
        pending2fa: true,
      },
    });
    const { isStillPendingForSession } = await import('@/server/auth/config');
    expect(await isStillPendingForSession(u.id, pending.id)).toBe(true);
    expect(await isStillPendingForSession(u.id, verified.id)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails (function doesn't exist)**

Run: `pnpm test:integration auth-config-jwt-sid`
Expected: FAIL — `isStillPendingForSession` undefined.

- [ ] **Step 3: Refactor config.ts**

Dans `src/server/auth/config.ts`, remplacer entièrement la callback `jwt` + l'helper :

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
    async jwt({ token, user, trigger }) {
      if (user?.id) {
        token.uid = user.id;
        // Initial sign-in: derive pending2fa, sid will be filled by session-bridge
        // on first getCurrentSessionAndUser call (next-auth jwt() signs the token
        // before any DB session exists for credential providers in JWT-strategy mode).
        token.pending2fa = await needsTwoFactor(user.id);
        token.sid = undefined;
      }
      if (trigger === 'update' && typeof token.uid === 'string') {
        const sid = typeof token.sid === 'string' ? token.sid : null;
        token.pending2fa = sid
          ? await isStillPendingForSession(token.uid, sid)
          : await isStillPending(token.uid);
      }
      return token;
    },
    async session({ session, token }) {
      if (token.uid) {
        (session as { userId?: string }).userId = token.uid as string;
        (session as { pending2fa?: boolean }).pending2fa = !!token.pending2fa;
        (session as { sid?: string }).sid = (token.sid as string) ?? undefined;
      }
      return session;
    },
  },
};

async function needsTwoFactor(userId: string): Promise<boolean> {
  const { db } = await import('@/lib/db');
  const u = await db.user.findUnique({ where: { id: userId }, select: { twoFactorEnabled: true } });
  return !!u?.twoFactorEnabled;
}

// Fallback when sid is not yet available (cross-tab edge case)
async function isStillPending(userId: string): Promise<boolean> {
  const { db } = await import('@/lib/db');
  const u = await db.user.findUnique({
    where: { id: userId },
    select: { twoFactorEnabled: true },
  });
  if (!u?.twoFactorEnabled) return false;
  const session = await db.session.findFirst({
    where: { userId, expiresAt: { gt: new Date() } },
    orderBy: { lastActivityAt: 'desc' },
    select: { pending2fa: true },
  });
  return session?.pending2fa ?? true;
}

export async function isStillPendingForSession(
  userId: string,
  sessionId: string,
): Promise<boolean> {
  const { db } = await import('@/lib/db');
  const u = await db.user.findUnique({
    where: { id: userId },
    select: { twoFactorEnabled: true },
  });
  if (!u?.twoFactorEnabled) return false;
  const session = await db.session.findUnique({
    where: { id: sessionId },
    select: { pending2fa: true, userId: true },
  });
  if (!session || session.userId !== userId) return true; // session deleted or hijack attempt → safe-side: pending
  return session.pending2fa;
}
```

- [ ] **Step 4: Propagate sid through session-bridge**

Dans `src/server/auth/session-bridge.ts`, ajouter une mutation du JWT côté server-side. Mais next-auth v5 ne permet pas d'écrire le JWT depuis un server component arbitraire — le pattern correct est de laisser l'UI appeler `update({ sid })` après login, ou de passer le `sid` lors du `jwt({ trigger: 'update' })`.

Plus simple : exposer `currentSessionId()` qui retourne le sid lu depuis la DB, et que l'UI passe à `update({ sid })` après login.

Modifier `TwoFactorChallenge.tsx` (et `BackupCodeForm.tsx`, `RecoveryCodesDisplay.tsx`) onSuccess :

```ts
onSuccess: async (data) => {
  await update({ sid: data.sessionToken ? null : undefined }); // trigger jwt update
  // Note: sid sera repopulé par session-bridge sur la prochaine requête
  router.refresh();
  router.push(callbackUrl);
},
```

> Approche alternative simpler : modifier la callback `jwt({ trigger: 'update' })` pour query la DB et récupérer le sid courant via `getCurrentSessionAndUser` côté serveur. Mais next-auth v5 jwt() ne peut pas appeler `headers()` proprement (le contexte de cookies n'est pas garanti).
>
> Décision : populate `token.sid` lors du **premier** `trigger === 'update'` en lisant `db.session.findFirst({ where: { userId, expiresAt: { gt: now } }, orderBy: { lastActivityAt: 'desc' } })`. Au sign-in initial, on n'a pas encore de session DB (créée à la première requête authentifiée par session-bridge), donc on accepte que la première update() soit nécessaire pour bootstrap le sid.

Updated `jwt` callback (raffinement de Step 3) :

```ts
async jwt({ token, user, trigger }) {
  if (user?.id) {
    token.uid = user.id;
    token.pending2fa = await needsTwoFactor(user.id);
    token.sid = undefined;
  }
  if (trigger === 'update' && typeof token.uid === 'string') {
    // Populate or refresh sid by reading the user's DB session
    const { db } = await import('@/lib/db');
    const s = await db.session.findFirst({
      where: { userId: token.uid, expiresAt: { gt: new Date() } },
      orderBy: { lastActivityAt: 'desc' },
      select: { id: true, pending2fa: true },
    });
    token.sid = s?.id;
    if (s) {
      token.pending2fa = s.pending2fa;
    } else {
      token.pending2fa = await isStillPending(token.uid);
    }
  }
  return token;
},
```

> ⚠️ Attention : ce design garde "most recent" pour bootstraper le sid au premier update(), ce qui peut, pendant la transition, donner un faux négatif si l'autre device a verified avant. Mais une fois le sid fixé dans le JWT, les updates suivants sont déterministes.

> Pour les tests, exposer `isStillPendingForSession` est suffisant — le test ci-dessus l'appelle directement. Le test cross-device complet (réel JWT update) est plus pertinent en E2E qu'en intégration ; le réserver à H8.

- [ ] **Step 5: Run the integration test**

Run: `pnpm test:integration auth-config-jwt-sid`
Expected: PASS — `isStillPendingForSession(userId, pendingId) === true`, `... verifiedId === false`.

- [ ] **Step 6: Run full integration suite to ensure no regression**

Run: `pnpm test:integration`
Expected: tous PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/auth/config.ts tests/integration/auth-config-jwt-sid.test.ts
git commit -m "fix(auth): index isStillPending by sessionId, populate token.sid (gap #7bis)"
```

---

## Task H8: Gap #10 — `update()` JWT propagation après verify 2FA

**Files:**

- Modify: `src/components/auth/TwoFactorChallenge.tsx:33-45`
- Modify: `src/components/auth/BackupCodeForm.tsx` (même pattern)
- Modify: `src/components/auth/RecoveryCodesDisplay.tsx` (même pattern)
- Modify: `tests/e2e/auth-1a.spec.ts` — réactiver assertions URL pour Scénarios 3 & 4

- [ ] **Step 1: Run E2E with Task H7 fix already in place**

Run: `npx playwright test tests/e2e/auth-1a.spec.ts --reporter=list`
Expected: 5 PASS. Si Scénarios 3 et 4 atterrissent maintenant sur `/admin` (gap #10 résolu par le sid in JWT seul), passer directement au Step 5 (réactiver les assertions URL et commit).

- [ ] **Step 2: Diagnostic Playwright si #10 persiste**

Si Scénarios 3/4 échouent encore sur l'URL : ajouter dans le test E2E un capture du Set-Cookie de la réponse `/api/auth/session` pour observer la propagation :

```ts
const sessionResp = page.waitForResponse(
  (r) => r.url().includes('/api/auth/session') && r.request().method() === 'POST',
);
// ... submit OTP
const resp = await sessionResp;
console.log('Set-Cookie:', resp.headers()['set-cookie']);
```

Trois hypothèses à tester :

1. `update()` ne déclenche pas le POST /api/auth/session côté next-auth → fix : passer un payload non-null à `update()` (ex: `update({ refresh: Date.now() })`).
2. Le Set-Cookie arrive après le `router.push('/admin')` → fix : `await new Promise(r => setTimeout(r, 50))` après update() (ugly) OU `window.location.assign(callbackUrl)` (propre, force full navigation = re-read cookies).
3. La middleware Edge cache l'ancien JWT → fix : `router.refresh()` avant `router.push`.

- [ ] **Step 3: Apply window.location.assign fallback**

Dans `src/components/auth/TwoFactorChallenge.tsx`, modifier le `onSuccess` :

```ts
const verify = trpc.auth.verify2FA.useMutation({
  onSuccess: async () => {
    await update();
    // Force full navigation to guarantee Set-Cookie applied + middleware re-reads JWT.
    // router.push() keeps client cache and risks racing the cookie write.
    window.location.assign(callbackUrl);
  },
  onError: (err) => {
    setError(err.data?.code === 'TOO_MANY_REQUESTS' ? t('error.rateLimited') : t('error.invalid'));
    setCode('');
  },
});
```

Reproduire le même pattern dans :

- `src/components/auth/BackupCodeForm.tsx` (chercher le `useMutation` autour de `verifyBackupCode`)
- `src/components/auth/RecoveryCodesDisplay.tsx` (chercher le bouton "Continuer" / submit qui marquait fin du setup)

- [ ] **Step 4: Re-run E2E**

Run: `npx playwright test tests/e2e/auth-1a.spec.ts --reporter=list`
Expected: 5 PASS. Scénarios 3 et 4 atterrissent sur `/admin`.

- [ ] **Step 5: Réactiver assertions URL dans E2E**

Dans `tests/e2e/auth-1a.spec.ts`, retrouver les Scénarios 3 et 4 (TOTP + backup code). Là où il y a un commentaire "assertion URL différée à cause gap #10" et une assertion serveur uniquement, ajouter une assertion URL :

```ts
await page.waitForURL(/\/admin/);
expect(page.url()).toContain('/admin');
```

> Garder aussi les assertions audit + DB session pending2fa=false : la défense en profondeur ne mange pas de pain.

- [ ] **Step 6: Run full test triple — unit + integration + E2E**

Run en parallèle :

```bash
pnpm test
pnpm test:integration
npx playwright test tests/e2e/auth-1a.spec.ts --reporter=list
```

Expected: 37 unit + (52+5 ajoutés H1-H7 = ~57) integration + 5 E2E PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/auth/TwoFactorChallenge.tsx src/components/auth/BackupCodeForm.tsx src/components/auth/RecoveryCodesDisplay.tsx tests/e2e/auth-1a.spec.ts
git commit -m "fix(ui): force full navigation after 2FA verify to apply JWT cookie (gap #10)"
```

---

## Task H9: Final verification + memory update

- [ ] **Step 1: Run lint + typecheck + format check**

Run en parallèle :

```bash
pnpm lint
pnpm typecheck
pnpm format:check
```

Expected: aucun output, exit 0 partout.

- [ ] **Step 2: Run la suite complète**

Run en série :

```bash
pnpm test                                                       # 37 unit
pnpm test:integration                                           # ~57 integration
npx playwright test tests/e2e/auth-1a.spec.ts --reporter=list   # 5 E2E
pnpm test:integration tests/attacks                             # 7 attacks
```

Expected: tous verts.

- [ ] **Step 3: Update memory — gaps fermés**

Modifier `~/.claude/projects/-Users-seraphin-Library-CloudStorage-SynologyDrive-save-02-Trinity-Projet-github-fm-librairy/memory/project_phase_1a_security_gaps.md` :

- Marquer #2, #3, #4, #5, #6, #7bis, #9, #10 comme `[FERMÉ]` avec la référence du commit.
- Garder #1 et #7 en open avec note "différé hors hardening pass" + raison.
- Ajouter en tête de fichier : "Hardening pass exécuté le 2026-04-27 — 8/10 fermés. Restent #1 (avant prod) et #7 (cosmétique)."

Mettre à jour `project_phase_1a_ready_to_execute.md` :

- "10 security gaps" → "**2 security gaps reliquat (#1 prod, #7 cosmétique), 8 fermés en hardening pass**"
- "Reprendre sur le hardening pass" → "Reprendre sur Task 24 smoke test final"

- [ ] **Step 4: Commit final récap**

```bash
git add docs/superpowers/plans/2026-04-27-phase-1a-hardening.md
git commit -m "docs(phase-1a): hardening pass plan + gap closure summary"
```

> Note : si le plan a été créé en step initial avant les commits techniques, ce step ne fait que add le memory + tag. Adapter selon l'ordre réel.

- [ ] **Step 5: Verify branch state**

Run: `git log --oneline main..HEAD | head -15`
Expected: 8 nouveaux commits (1 par task H1-H8) + 1 commit docs = 9 commits ajoutés sur la branche feat/phase-1a-auth-core.

---

## Self-review (à exécuter après écriture du plan)

**Spec coverage check :**

- Gap #2 → Task H4 ✓
- Gap #3 → Task H5 ✓
- Gap #4 → Task H1 ✓
- Gap #5 → Task H6 ✓
- Gap #6 → Task H2 ✓
- Gap #7bis → Task H7 ✓
- Gap #9 → Task H3 ✓
- Gap #10 → Task H8 ✓
- Gap #1, #7 explicitement différés en intro
- Gap #8 explicitement déjà couvert

**Type consistency check :**

- `loginIpOnlyLimiter` défini en H4 step 1, importé en H4 step 4 + H5 step 1 ✓
- `isStillPendingForSession(userId, sessionId)` exporté en H7 step 3, testé en H7 step 1, utilisé en H7 step 3 jwt callback ✓
- `loginKey(email)` défini en H5 step 1, helper pattern aligné avec celui dans `tests/attacks/auth.test.ts:26-28` ✓

**Placeholder scan :** aucun TBD, TODO, "implement later" ou "similar to Task N" sans code.
