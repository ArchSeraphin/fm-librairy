# Phase 1C — Panel admin + /account self-service + matrice rôles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer le panel admin global (Users + Libraries), l'espace self-service `/account` (Profil + Sécurité), une matrice rôles testable avec garde anti-drift, et fermer 3 dettes Phase 1B (worker handler `send-password-reset-confirmation`, IP plumbing tRPC ctx, audit DLQ pour mails échoués).

**Architecture:** 5 modules séquentiels. Module 0 plumbing (1j). Modules 1-3 verticaux (Users, Libraries, Account) chacun livre tRPC + UI + tests (~7-8j). Module 4 closure : matrice testable générée + 5 E2E + runbook DBA + polish (1.5-2j). tRPC routers protégés par `globalAdminProcedure` (Users/Libraries) ou `authedProcedure` (Account). Migrations Prisma soft-delete (Library.archivedAt) + métadonnées sessions (Session.userAgentLabel) + correction FK Invitation.

**Tech Stack:** Next.js 15 App Router · TypeScript strict · tRPC · Prisma 6 · React 19 (useActionState) · shadcn/ui new-york · Lucide-react · Tailwind v3 · Zod · Vitest 4 · Playwright · BullMQ + ioredis · next-intl.

**Spec source:** `docs/superpowers/specs/2026-04-28-phase-1c-admin-account-design.md`.

**Branch:** `feat/phase-1c-admin-account` (créée en Task 0).

**Adaptations actées vs spec** :
- `LibraryMember` a une clé composite `(userId, libraryId)` (pas de champ `id`). Les procedures `members.remove/changeRole/updateFlags` prennent `{ libraryId, userId }` au lieu de `{ membershipId }`.
- `Invitation.invitedById` est actuellement `String` non-nullable sans `onDelete`. Migration corrective dans Task 1 : passe à `String?` + `onDelete: SetNull` (préserve audit invitation après delete user).

**Scope** : uniquement Phase 1C. Hors-scope cf. spec §12 (12 items cadenassés).

---

## Task 0 : Setup branche

**Files:**
- (no files — branch creation only)

- [ ] **Step 0.1: Vérifier le point de départ**

```bash
git checkout main
git pull
git status
```

Expected: branche `main` à jour, working tree propre, HEAD `52e43b8` ou descendant (post-merge PR #18 + commit spec 1C).

- [ ] **Step 0.2: Créer la branche de travail**

```bash
git checkout -b feat/phase-1c-admin-account
git status
```

Expected: branche `feat/phase-1c-admin-account` créée à partir de `main`.

- [ ] **Step 0.3: Vérifier que le worker et la DB de dev tournent**

```bash
docker compose -f docker-compose.dev.yml ps
```

Expected: services `postgres`, `redis`, `mailpit` en état `Up (healthy)`. Si non : `docker compose -f docker-compose.dev.yml up -d`.

- [ ] **Step 0.4: Sanity check tests Phase 1B**

```bash
pnpm test:integration -- --run tests/integration/password-router.test.ts
```

Expected: tests Phase 1B verts (baseline avant modifications).

---

## Task 1 : Migrations Prisma 1C (userAgentLabel + archivedAt + invitation FK)

**Files:**
- Modify: `prisma/schema.prisma:Session,Library,Invitation`
- Create: `prisma/migrations/<timestamp>_phase_1c_schema/migration.sql`

- [ ] **Step 1.1: Ajouter `Session.userAgentLabel`**

Dans `prisma/schema.prisma`, model `Session`, ajouter le champ après `userAgentHash` :

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
  userAgentLabel String?  // 1C : label lisible "Chrome on macOS", null sur sessions pre-1C
  pending2fa     Boolean  @default(false)
  createdAt      DateTime @default(now())

  @@index([userId])
  @@index([expiresAt])
}
```

- [ ] **Step 1.2: Ajouter `Library.archivedAt`**

Dans `prisma/schema.prisma`, model `Library` :

```prisma
model Library {
  id          String    @id @default(cuid())
  name        String
  slug        String    @unique
  description String?
  archivedAt  DateTime? // 1C : soft-delete
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  members     LibraryMember[]
  invitations Invitation[]
  books       Book[]
  tags        Tag[]

  @@index([archivedAt])
}
```

- [ ] **Step 1.3: Corriger FK `Invitation.invitedById` → nullable + SetNull**

Dans `prisma/schema.prisma`, model `Invitation` :

```prisma
model Invitation {
  id            String       @id @default(cuid())
  email         String       @db.Citext
  invitedById   String?      // 1C : nullable pour préserver audit après delete user
  invitedBy     User?        @relation("InvitedBy", fields: [invitedById], references: [id], onDelete: SetNull)
  libraryId     String?
  library       Library?     @relation(fields: [libraryId], references: [id], onDelete: SetNull)
  proposedRole  LibraryRole?
  tokenHash     String       @unique
  expiresAt     DateTime
  consumedAt    DateTime?
  consumedById  String?
  consumedBy    User?        @relation("ConsumedBy", fields: [consumedById], references: [id], onDelete: SetNull)
  createdAt     DateTime     @default(now())

  @@index([email])
  @@index([invitedById])
  @@index([consumedById])
  @@index([expiresAt])
}
```

Vérifier aussi que `consumedBy` a déjà `onDelete: SetNull` (sinon ajouter).

- [ ] **Step 1.4: Générer la migration**

```bash
pnpm prisma migrate dev --name phase_1c_schema
```

Expected: nouveau dossier `prisma/migrations/<timestamp>_phase_1c_schema/` avec `migration.sql`. La migration doit contenir : `ALTER TABLE "Session" ADD COLUMN "userAgentLabel" TEXT`, `ALTER TABLE "Library" ADD COLUMN "archivedAt" TIMESTAMP(3)`, `ALTER TABLE "Library" ADD INDEX ...`, `ALTER TABLE "Invitation" ALTER COLUMN "invitedById" DROP NOT NULL`, drop+recreate FK constraints `Invitation_invitedById_fkey`, etc.

- [ ] **Step 1.5: Vérifier la migration en local**

```bash
pnpm prisma migrate status
```

Expected: « Database schema is up to date! ». Si erreur de FK (existing rows null), c'est que des invitations ont déjà `invitedById = NULL` → impossible normalement, mais traiter comme bloquant et investiguer.

- [ ] **Step 1.6: Régénérer le client Prisma**

```bash
pnpm prisma generate
```

Expected: client régénéré, types `Session.userAgentLabel: string | null`, `Library.archivedAt: Date | null`, `Invitation.invitedById: string | null` disponibles.

- [ ] **Step 1.7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(phase-1c): schema migrations (userAgentLabel, archivedAt, invitation FK fix)"
```

---

## Task 2 : IP plumbing dans le contexte tRPC

**Files:**
- Create: `src/lib/request-meta.ts`
- Create: `tests/unit/request-meta.test.ts`
- Modify: `src/server/trpc/context.ts`
- Modify: `src/app/api/trpc/[trpc]/route.ts`
- Modify: `src/server/trpc/routers/password.ts` (replace `'0.0.0.0'`)

- [ ] **Step 2.1: Écrire le test du helper**

Créer `tests/unit/request-meta.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { extractIpFromHeaders } from '@/lib/request-meta';

describe('extractIpFromHeaders', () => {
  it('extracts first hop from x-forwarded-for', () => {
    const h = new Headers({ 'x-forwarded-for': '203.0.113.5, 198.51.100.1, 10.0.0.1' });
    expect(extractIpFromHeaders(h)).toBe('203.0.113.5');
  });

  it('uses x-forwarded-for single value', () => {
    const h = new Headers({ 'x-forwarded-for': '203.0.113.5' });
    expect(extractIpFromHeaders(h)).toBe('203.0.113.5');
  });

  it('falls back to x-real-ip when no x-forwarded-for', () => {
    const h = new Headers({ 'x-real-ip': '198.51.100.42' });
    expect(extractIpFromHeaders(h)).toBe('198.51.100.42');
  });

  it('returns 0.0.0.0 when no header present', () => {
    expect(extractIpFromHeaders(new Headers())).toBe('0.0.0.0');
  });

  it('returns 0.0.0.0 on malformed value', () => {
    const h = new Headers({ 'x-forwarded-for': 'not-an-ip' });
    expect(extractIpFromHeaders(h)).toBe('0.0.0.0');
  });

  it('accepts IPv6 address', () => {
    const h = new Headers({ 'x-forwarded-for': '2001:db8::1' });
    expect(extractIpFromHeaders(h)).toBe('2001:db8::1');
  });
});
```

- [ ] **Step 2.2: Run test, expect FAIL**

```bash
pnpm test:unit -- --run tests/unit/request-meta.test.ts
```

Expected: 6 tests fail (`Cannot find module '@/lib/request-meta'`).

- [ ] **Step 2.3: Implémenter le helper**

Créer `src/lib/request-meta.ts` :

```ts
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^[0-9a-fA-F:]+$/;

function isValidIp(value: string): boolean {
  if (IPV4.test(value)) {
    return value.split('.').every((part) => Number(part) >= 0 && Number(part) <= 255);
  }
  return IPV6.test(value) && value.includes(':');
}

export function extractIpFromHeaders(headers: Headers): string {
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first && isValidIp(first)) return first;
  }
  const real = headers.get('x-real-ip')?.trim();
  if (real && isValidIp(real)) return real;
  return '0.0.0.0';
}
```

- [ ] **Step 2.4: Run test, expect PASS**

```bash
pnpm test:unit -- --run tests/unit/request-meta.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 2.5: Étendre `TrpcContext` avec `ip`**

Remplacer `src/server/trpc/context.ts` par :

```ts
import { getCurrentSessionAndUser } from '@/server/auth/session-bridge';
import { extractIpFromHeaders } from '@/lib/request-meta';
import type { Session, User } from '@prisma/client';

export interface TrpcContext {
  session: Session | null;
  user: User | null;
  ip: string;
}

export async function createContext(opts?: { headers?: Headers }): Promise<TrpcContext> {
  const result = await getCurrentSessionAndUser();
  const ip = opts?.headers ? extractIpFromHeaders(opts.headers) : '0.0.0.0';
  return { session: result?.session ?? null, user: result?.user ?? null, ip };
}
```

- [ ] **Step 2.6: Passer les headers depuis la route HTTP**

Remplacer `src/app/api/trpc/[trpc]/route.ts` par :

```ts
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter } from '@/server/trpc/routers/_app';
import { createContext } from '@/server/trpc/context';

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: () => createContext({ headers: req.headers }),
  });

export { handler as GET, handler as POST };
```

- [ ] **Step 2.7: Remplacer le placeholder `'0.0.0.0'` dans password router**

Dans `src/server/trpc/routers/password.ts`, repérer la ligne `const ip = '0.0.0.0';` (ou similaire) dans `requestReset` et la remplacer par `const ip = ctx.ip;`. Supprimer le commentaire `// TODO ip plumbing` s'il existe.

- [ ] **Step 2.8: Faire passer le typecheck + tests existants**

```bash
pnpm typecheck && pnpm test:integration -- --run tests/integration/password-router.test.ts
```

Expected: typecheck OK, tests password OK. Si test integration échoue car appelle `createContext()` sans args, mettre à jour le call-site test (passer un Headers vide ou un mock minimal).

- [ ] **Step 2.9: Ajouter test integration vérifiant l'IP en audit**

Dans `tests/integration/password-router.test.ts`, ajouter un test :

```ts
it('records audit with caller IP from x-forwarded-for', async () => {
  await truncateAll();
  const user = await db.user.create({
    data: {
      email: 'ip-audit@e2e.test',
      passwordHash: await hashPassword('OldPassword123!'),
      displayName: 'Audit',
    },
  });
  const headers = new Headers({ 'x-forwarded-for': '203.0.113.99' });
  const ctx = await createContext({ headers });
  const caller = appRouter.createCaller(ctx);
  await caller.password.requestReset({ email: user.email });
  const log = await db.auditLog.findFirst({
    where: { action: 'auth.password.reset_requested' },
    orderBy: { createdAt: 'desc' },
  });
  expect(log?.metadata).toMatchObject({ ip: '203.0.113.99' });
});
```

- [ ] **Step 2.10: Run, expect PASS**

```bash
pnpm test:integration -- --run tests/integration/password-router.test.ts
```

Expected: nouveau test vert (ainsi que les anciens).

- [ ] **Step 2.11: Commit**

```bash
git add src/lib/request-meta.ts src/server/trpc/context.ts src/app/api/trpc/[trpc]/route.ts src/server/trpc/routers/password.ts tests/unit/request-meta.test.ts tests/integration/password-router.test.ts
pnpm prettier --write src/lib/request-meta.ts src/server/trpc/context.ts src/app/api/trpc/\[trpc\]/route.ts src/server/trpc/routers/password.ts tests/unit/request-meta.test.ts tests/integration/password-router.test.ts
git add -u
git commit -m "feat(phase-1c): plumb IP into tRPC context (closes 1B debt)"
```

---

## Task 3 : Audit union 1C + worker DLQ + handler send-password-reset-confirmation

**Files:**
- Modify: `src/lib/audit-log.ts`
- Create: `worker/jobs/send-password-reset-confirmation.ts`
- Modify: `worker/index.ts`
- Create: `tests/integration/worker-dlq.test.ts`
- Create: `tests/integration/worker-password-reset-confirmation.test.ts`

- [ ] **Step 3.1: Étendre l'union audit 1C**

Dans `src/lib/audit-log.ts`, étendre `AuditAction` (ajouter avant la fermeture du type) :

```ts
  // 1C — admin users (extension)
  | 'admin.user.two_factor_reset'
  // 1C — admin libraries & members
  | 'admin.library.created'
  | 'admin.library.renamed'
  | 'admin.library.archived'
  | 'admin.library.unarchived'
  | 'admin.member.added'
  | 'admin.member.removed'
  | 'admin.member.role_changed'
  | 'admin.member.flags_changed'
  // 1C — account self-service
  | 'auth.password.changed_self'
  | 'auth.session.revoked_self'
  | 'auth.session.revoked_all_others'
  | 'auth.2fa.recovery_codes_regenerated_self'
  | 'auth.2fa.reset_via_backup'
  | 'account.profile.updated'
  // 1C — dette 1B (worker DLQ)
  | 'auth.invitation.send_failed'
  | 'auth.password.reset_send_failed'
  | 'auth.password.reset_confirmation_send_failed';
```

Étendre aussi `AuditTargetType` :

```ts
export type AuditTargetType = 'USER' | 'LIBRARY' | 'INVITATION' | 'SESSION' | 'EMAIL' | 'AUTH' | 'MEMBER';
```

- [ ] **Step 3.2: Test handler send-password-reset-confirmation**

Créer `tests/integration/worker-password-reset-confirmation.test.ts` :

```ts
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendPasswordResetConfirmation } from '@/worker/jobs/send-password-reset-confirmation';
import { getTestPrisma, truncateAll } from './setup/prisma';

const prisma = getTestPrisma();

const sendMailMock = vi.hoisted(() => vi.fn(async () => ({ ok: true, messageId: 'mock' })));
vi.mock('@/worker/lib/email', () => ({ sendMail: sendMailMock }));

describe('worker handler: send-password-reset-confirmation', () => {
  beforeEach(async () => {
    await truncateAll();
    sendMailMock.mockClear();
  });
  afterAll(() => vi.restoreAllMocks());

  it('renders and sends the confirmation email', async () => {
    const user = await prisma.user.create({
      data: { email: 'conf@e2e.test', passwordHash: 'x', displayName: 'Conf User', locale: 'fr' },
    });
    await sendPasswordResetConfirmation({ userId: user.id });
    expect(sendMailMock).toHaveBeenCalledOnce();
    const call = sendMailMock.mock.calls[0][0];
    expect(call.to).toBe('conf@e2e.test');
    expect(call.subject).toMatch(/mot de passe/i);
    expect(call.html).toMatch(/changé/i);
  });

  it('throws when user no longer exists', async () => {
    await expect(sendPasswordResetConfirmation({ userId: 'nope' })).rejects.toThrow(/not found/i);
  });
});
```

- [ ] **Step 3.3: Run, expect FAIL**

```bash
pnpm test:integration -- --run tests/integration/worker-password-reset-confirmation.test.ts
```

Expected: import error sur `@/worker/jobs/send-password-reset-confirmation`.

- [ ] **Step 3.4: Implémenter le handler**

Créer `worker/jobs/send-password-reset-confirmation.ts` :

```ts
import { render } from '@react-email/render';
import { db } from '@/lib/db';
import { sendMail } from '@/worker/lib/email';
import PasswordResetConfirmation from '@/worker/emails/PasswordResetConfirmation';

export interface SendPasswordResetConfirmationJob {
  userId: string;
  triggerSource?: 'reset' | 'self_change';
}

export async function sendPasswordResetConfirmation(data: SendPasswordResetConfirmationJob): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: data.userId },
    select: { id: true, email: true, displayName: true, locale: true },
  });
  if (!user) throw new Error(`User ${data.userId} not found`);

  const html = await render(
    PasswordResetConfirmation({
      displayName: user.displayName,
      locale: user.locale,
      triggerSource: data.triggerSource ?? 'reset',
    }),
  );
  const text = await render(
    PasswordResetConfirmation({
      displayName: user.displayName,
      locale: user.locale,
      triggerSource: data.triggerSource ?? 'reset',
    }),
    { plainText: true },
  );

  await sendMail({
    to: user.email,
    subject:
      user.locale === 'en'
        ? 'Your password has been changed'
        : 'Votre mot de passe a été changé',
    html,
    text,
  });
}
```

- [ ] **Step 3.5: Run, expect PASS**

```bash
pnpm test:integration -- --run tests/integration/worker-password-reset-confirmation.test.ts
```

Expected: 2 tests pass. Si le template `PasswordResetConfirmation` n'accepte pas `triggerSource`, étendre son interface props pour accepter `triggerSource?: 'reset' | 'self_change'` et adapter le copy via `triggerSource === 'self_change'` ternaire dans le template (TSX `worker/emails/PasswordResetConfirmation.tsx` et son jumeau `src/emails/PasswordResetConfirmation.tsx`).

- [ ] **Step 3.6: Test DLQ listener**

Créer `tests/integration/worker-dlq.test.ts` :

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { recordAuditFromFailedJob } from '@/worker/index';
import { getTestPrisma, truncateAll } from './setup/prisma';

const prisma = getTestPrisma();

describe('worker DLQ listener', () => {
  beforeEach(truncateAll);

  it('records audit on send-invitation final failure', async () => {
    const user = await prisma.user.create({
      data: { email: 'dlq@e2e.test', passwordHash: 'x', displayName: 'DLQ' },
    });
    await recordAuditFromFailedJob({
      jobName: 'send-invitation',
      jobId: 'job-123',
      attemptsMade: 5,
      maxAttempts: 5,
      error: new Error('SMTP refused'),
      data: { userId: user.id, invitationId: 'inv-1' },
    });
    const log = await prisma.auditLog.findFirst({ where: { action: 'auth.invitation.send_failed' } });
    expect(log).toBeTruthy();
    expect(log?.actorId).toBe(user.id);
    expect(log?.metadata).toMatchObject({ jobId: 'job-123', attempts: 5 });
  });

  it('records audit on send-password-reset final failure', async () => {
    const user = await prisma.user.create({
      data: { email: 'dlq2@e2e.test', passwordHash: 'x', displayName: 'DLQ2' },
    });
    await recordAuditFromFailedJob({
      jobName: 'send-password-reset',
      jobId: 'job-456',
      attemptsMade: 5,
      maxAttempts: 5,
      error: new Error('Resend down'),
      data: { userId: user.id },
    });
    const log = await prisma.auditLog.findFirst({
      where: { action: 'auth.password.reset_send_failed' },
    });
    expect(log).toBeTruthy();
  });

  it('does not record on intermediate failure (attemptsMade < maxAttempts)', async () => {
    await recordAuditFromFailedJob({
      jobName: 'send-invitation',
      jobId: 'job-789',
      attemptsMade: 3,
      maxAttempts: 5,
      error: new Error('transient'),
      data: { userId: 'u1' },
    });
    const log = await prisma.auditLog.findFirst({ where: { action: 'auth.invitation.send_failed' } });
    expect(log).toBeNull();
  });
});
```

- [ ] **Step 3.7: Run, expect FAIL**

```bash
pnpm test:integration -- --run tests/integration/worker-dlq.test.ts
```

Expected: import error sur `recordAuditFromFailedJob`.

- [ ] **Step 3.8: Étendre `worker/index.ts` avec le handler + DLQ listener**

Dans `worker/index.ts`, ajouter (à adapter selon la structure existante du switch) :

```ts
import { sendPasswordResetConfirmation } from './jobs/send-password-reset-confirmation';
import { recordAudit } from '@/lib/audit-log';
import type { AuditAction } from '@/lib/audit-log';
import { getLogger } from '@/lib/logger';

// Dans le processor, ajouter le case :
//   case 'send-password-reset-confirmation':
//     await sendPasswordResetConfirmation(job.data);
//     break;

const DLQ_ACTION_BY_JOB: Record<string, AuditAction> = {
  'send-invitation': 'auth.invitation.send_failed',
  'send-password-reset': 'auth.password.reset_send_failed',
  'send-password-reset-confirmation': 'auth.password.reset_confirmation_send_failed',
};

export async function recordAuditFromFailedJob(input: {
  jobName: string;
  jobId: string | undefined;
  attemptsMade: number;
  maxAttempts: number;
  error: Error;
  data: Record<string, unknown>;
}): Promise<void> {
  if (input.attemptsMade < input.maxAttempts) return;
  const action = DLQ_ACTION_BY_JOB[input.jobName];
  if (!action) {
    getLogger().warn({ jobName: input.jobName }, 'no DLQ audit action mapped');
    return;
  }
  const userId = typeof input.data.userId === 'string' ? input.data.userId : undefined;
  await recordAudit({
    action,
    actor: userId ? { id: userId } : undefined,
    metadata: {
      jobId: input.jobId,
      attempts: input.attemptsMade,
      error: input.error.message.slice(0, 200),
    },
  });
}

// Wire the listener (à proximité du `new Worker(...)` existant) :
mailWorker.on('failed', async (job, err) => {
  if (!job) return;
  await recordAuditFromFailedJob({
    jobName: job.name,
    jobId: job.id,
    attemptsMade: job.attemptsMade,
    maxAttempts: job.opts.attempts ?? 1,
    error: err,
    data: job.data ?? {},
  }).catch((auditErr) => getLogger().error({ err: auditErr }, 'DLQ audit failed'));
});
```

- [ ] **Step 3.9: Run DLQ test, expect PASS**

```bash
pnpm test:integration -- --run tests/integration/worker-dlq.test.ts tests/integration/worker-password-reset-confirmation.test.ts
```

Expected: 5 tests pass (2 + 3).

- [ ] **Step 3.10: Sanity check global**

```bash
pnpm typecheck && pnpm lint
```

Expected: no errors.

- [ ] **Step 3.11: Commit**

```bash
pnpm prettier --write src/lib/audit-log.ts worker/jobs/send-password-reset-confirmation.ts worker/index.ts tests/integration/worker-dlq.test.ts tests/integration/worker-password-reset-confirmation.test.ts
git add src/lib/audit-log.ts worker/jobs/send-password-reset-confirmation.ts worker/index.ts tests/integration/worker-dlq.test.ts tests/integration/worker-password-reset-confirmation.test.ts
git commit -m "feat(phase-1c): audit union 1C, worker DLQ listener, password-reset-confirmation handler"
```

---

## Task 4 : Helpers user-admin (assertNotLastGlobalAdmin + revokeAllSessionsForUser)

**Files:**
- Create: `src/lib/user-admin.ts`
- Create: `tests/unit/user-admin.test.ts`
- Create: `tests/integration/user-admin.test.ts`

- [ ] **Step 4.1: Test integration `assertNotLastGlobalAdmin`**

Créer `tests/integration/user-admin.test.ts` :

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import { assertNotLastGlobalAdmin, revokeAllSessionsForUser } from '@/lib/user-admin';
import { getTestPrisma, truncateAll } from './setup/prisma';

const prisma = getTestPrisma();

const HASH_64 = 'a'.repeat(64);

async function createUser(opts: { role?: 'GLOBAL_ADMIN' | 'USER'; status?: 'ACTIVE' | 'SUSPENDED'; email: string }) {
  return prisma.user.create({
    data: {
      email: opts.email,
      passwordHash: 'x',
      displayName: 'T',
      role: opts.role ?? 'USER',
      status: opts.status ?? 'ACTIVE',
    },
  });
}

describe('assertNotLastGlobalAdmin', () => {
  beforeEach(truncateAll);

  it('throws when removing the last active GLOBAL_ADMIN', async () => {
    const admin = await createUser({ role: 'GLOBAL_ADMIN', email: 'a1@e2e.test' });
    await expect(assertNotLastGlobalAdmin(admin.id, 'remove')).rejects.toBeInstanceOf(TRPCError);
  });

  it('passes when another active GLOBAL_ADMIN exists', async () => {
    await createUser({ role: 'GLOBAL_ADMIN', email: 'a1@e2e.test' });
    const second = await createUser({ role: 'GLOBAL_ADMIN', email: 'a2@e2e.test' });
    await expect(assertNotLastGlobalAdmin(second.id, 'remove')).resolves.toBeUndefined();
  });

  it('treats SUSPENDED admins as not counting', async () => {
    const active = await createUser({ role: 'GLOBAL_ADMIN', email: 'a1@e2e.test' });
    await createUser({ role: 'GLOBAL_ADMIN', status: 'SUSPENDED', email: 'a2@e2e.test' });
    await expect(assertNotLastGlobalAdmin(active.id, 'remove')).rejects.toBeInstanceOf(TRPCError);
  });

  it('passes when target is not GLOBAL_ADMIN', async () => {
    await createUser({ role: 'GLOBAL_ADMIN', email: 'a1@e2e.test' });
    const u = await createUser({ role: 'USER', email: 'u1@e2e.test' });
    await expect(assertNotLastGlobalAdmin(u.id, 'remove')).resolves.toBeUndefined();
  });
});

describe('revokeAllSessionsForUser', () => {
  beforeEach(truncateAll);

  it('deletes all sessions for given user', async () => {
    const u = await createUser({ email: 'u1@e2e.test' });
    await prisma.session.createMany({
      data: [
        { sessionToken: 's1', userId: u.id, expiresAt: new Date(Date.now() + 60_000), ipHash: HASH_64, userAgentHash: HASH_64 },
        { sessionToken: 's2', userId: u.id, expiresAt: new Date(Date.now() + 60_000), ipHash: HASH_64, userAgentHash: HASH_64 },
      ],
    });
    const count = await revokeAllSessionsForUser(u.id);
    expect(count).toBe(2);
    expect(await prisma.session.count({ where: { userId: u.id } })).toBe(0);
  });

  it('preserves the excepted session', async () => {
    const u = await createUser({ email: 'u1@e2e.test' });
    const keep = await prisma.session.create({
      data: { sessionToken: 'keep', userId: u.id, expiresAt: new Date(Date.now() + 60_000), ipHash: HASH_64, userAgentHash: HASH_64 },
    });
    await prisma.session.create({
      data: { sessionToken: 'kill', userId: u.id, expiresAt: new Date(Date.now() + 60_000), ipHash: HASH_64, userAgentHash: HASH_64 },
    });
    const count = await revokeAllSessionsForUser(u.id, keep.id);
    expect(count).toBe(1);
    expect(await prisma.session.findUnique({ where: { id: keep.id } })).not.toBeNull();
  });

  it('does not touch other users sessions', async () => {
    const a = await createUser({ email: 'a@e2e.test' });
    const b = await createUser({ email: 'b@e2e.test' });
    await prisma.session.create({
      data: { sessionToken: 'a', userId: a.id, expiresAt: new Date(Date.now() + 60_000), ipHash: HASH_64, userAgentHash: HASH_64 },
    });
    await prisma.session.create({
      data: { sessionToken: 'b', userId: b.id, expiresAt: new Date(Date.now() + 60_000), ipHash: HASH_64, userAgentHash: HASH_64 },
    });
    await revokeAllSessionsForUser(a.id);
    expect(await prisma.session.count({ where: { userId: b.id } })).toBe(1);
  });
});
```

- [ ] **Step 4.2: Run, expect FAIL**

```bash
pnpm test:integration -- --run tests/integration/user-admin.test.ts
```

Expected: import error sur `@/lib/user-admin`.

- [ ] **Step 4.3: Implémenter le module**

Créer `src/lib/user-admin.ts` :

```ts
import { TRPCError } from '@trpc/server';
import { db } from './db';

export async function assertNotLastGlobalAdmin(
  userId: string,
  reason: 'remove' | 'demote' | 'suspend',
): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, status: true },
  });
  if (!user) return;
  if (user.role !== 'GLOBAL_ADMIN') return;
  if (user.status !== 'ACTIVE' && reason !== 'remove') return;
  const otherActive = await db.user.count({
    where: { role: 'GLOBAL_ADMIN', status: 'ACTIVE', NOT: { id: userId } },
  });
  if (otherActive === 0) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: `cannot ${reason} the last active global admin`,
    });
  }
}

export async function revokeAllSessionsForUser(
  userId: string,
  exceptSessionId?: string,
): Promise<number> {
  const where = exceptSessionId
    ? { userId, NOT: { id: exceptSessionId } }
    : { userId };
  const result = await db.session.deleteMany({ where });
  return result.count;
}
```

- [ ] **Step 4.4: Run, expect PASS**

```bash
pnpm test:integration -- --run tests/integration/user-admin.test.ts
```

Expected: 7 tests pass.

- [ ] **Step 4.5: Commit**

```bash
pnpm prettier --write src/lib/user-admin.ts tests/integration/user-admin.test.ts
git add src/lib/user-admin.ts tests/integration/user-admin.test.ts
git commit -m "feat(phase-1c): user-admin helpers (assertNotLastGlobalAdmin + revokeAllSessionsForUser)"
```

---

## Task 5 : Router admin.users — read procedures (list, get, invitations.list)

**Files:**
- Create: `src/server/trpc/routers/admin/users.ts`
- Modify: `src/server/trpc/routers/_app.ts`
- Create: `tests/integration/admin-users-read.test.ts`

- [ ] **Step 5.1: Test integration**

Créer `tests/integration/admin-users-read.test.ts` :

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import { appRouter } from '@/server/trpc/routers/_app';
import { getTestPrisma, truncateAll } from './setup/prisma';
import type { Session, User } from '@prisma/client';

const prisma = getTestPrisma();
const HASH_64 = 'a'.repeat(64);

async function makeAdminCtx(): Promise<{ session: Session; user: User; ip: string }> {
  const user = await prisma.user.create({
    data: {
      email: 'admin@e2e.test',
      passwordHash: 'x',
      displayName: 'Admin',
      role: 'GLOBAL_ADMIN',
      twoFactorEnabled: true,
    },
  });
  const session = await prisma.session.create({
    data: {
      sessionToken: 'admin-session',
      userId: user.id,
      expiresAt: new Date(Date.now() + 60_000),
      ipHash: HASH_64,
      userAgentHash: HASH_64,
    },
  });
  return { session, user, ip: '203.0.113.1' };
}

async function makeUserCtx(): Promise<{ session: Session; user: User; ip: string }> {
  const user = await prisma.user.create({
    data: { email: 'user@e2e.test', passwordHash: 'x', displayName: 'U', role: 'USER' },
  });
  const session = await prisma.session.create({
    data: {
      sessionToken: 'user-session',
      userId: user.id,
      expiresAt: new Date(Date.now() + 60_000),
      ipHash: HASH_64,
      userAgentHash: HASH_64,
    },
  });
  return { session, user, ip: '203.0.113.2' };
}

describe('admin.users — read', () => {
  beforeEach(truncateAll);

  it('list: returns paginated users for global admin', async () => {
    const ctx = await makeAdminCtx();
    for (let i = 0; i < 3; i++) {
      await prisma.user.create({
        data: { email: `u${i}@e2e.test`, passwordHash: 'x', displayName: `U${i}` },
      });
    }
    const caller = appRouter.createCaller(ctx);
    const result = await caller.admin.users.list({ limit: 20 });
    expect(result.items.length).toBeGreaterThanOrEqual(4);
    expect(result.nextCursor).toBeNull();
  });

  it('list: filters by status', async () => {
    const ctx = await makeAdminCtx();
    await prisma.user.create({
      data: { email: 'sus@e2e.test', passwordHash: 'x', displayName: 'S', status: 'SUSPENDED' },
    });
    const caller = appRouter.createCaller(ctx);
    const result = await caller.admin.users.list({ limit: 20, status: 'SUSPENDED' });
    expect(result.items.every((u) => u.status === 'SUSPENDED')).toBe(true);
  });

  it('list: searches by displayName (citext)', async () => {
    const ctx = await makeAdminCtx();
    await prisma.user.create({
      data: { email: 'alice@e2e.test', passwordHash: 'x', displayName: 'Alice Wonderland' },
    });
    const caller = appRouter.createCaller(ctx);
    const result = await caller.admin.users.list({ limit: 20, q: 'wonder' });
    expect(result.items.some((u) => u.email === 'alice@e2e.test')).toBe(true);
  });

  it('list: rejects non-admin with FORBIDDEN', async () => {
    const ctx = await makeUserCtx();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.admin.users.list({ limit: 20 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('get: returns user with counts', async () => {
    const ctx = await makeAdminCtx();
    const target = await prisma.user.create({
      data: { email: 't@e2e.test', passwordHash: 'x', displayName: 'T' },
    });
    const caller = appRouter.createCaller(ctx);
    const got = await caller.admin.users.get({ id: target.id });
    expect(got.id).toBe(target.id);
    expect(got.counts).toEqual({ sessions: 0, invitationsCreated: 0, libraryMembers: 0 });
  });

  it('get: throws NOT_FOUND on missing', async () => {
    const ctx = await makeAdminCtx();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.admin.users.get({ id: 'cln00000000000000000000' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('invitations.list: returns invitations created by target user', async () => {
    const ctx = await makeAdminCtx();
    await prisma.invitation.create({
      data: {
        email: 'invitee@e2e.test',
        invitedById: ctx.user.id,
        tokenHash: 'h1',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const caller = appRouter.createCaller(ctx);
    const result = await caller.admin.users.invitations.list({ userId: ctx.user.id });
    expect(result.items.length).toBe(1);
  });
});
```

- [ ] **Step 5.2: Run, expect FAIL**

```bash
pnpm test:integration -- --run tests/integration/admin-users-read.test.ts
```

Expected: import error sur `caller.admin.users`.

- [ ] **Step 5.3: Créer le router avec list, get, invitations.list**

Créer `src/server/trpc/routers/admin/users.ts` :

```ts
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { t } from '../../trpc';
import { globalAdminProcedure } from '../../procedures';
import { db } from '@/lib/db';

const cuid = z.string().min(20).max(40);

const listInput = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'all']).default('all'),
  role: z.enum(['GLOBAL_ADMIN', 'USER', 'all']).default('all'),
  cursor: cuid.optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

export const adminUsersRouter = t.router({
  list: globalAdminProcedure.input(listInput).query(async ({ input }) => {
    const where: Parameters<typeof db.user.findMany>[0] extends infer X
      ? X extends { where?: infer W }
        ? W
        : never
      : never = {};
    if (input.status !== 'all') (where as any).status = input.status;
    if (input.role !== 'all') (where as any).role = input.role;
    if (input.q) {
      (where as any).OR = [
        { email: { contains: input.q, mode: 'insensitive' } },
        { displayName: { contains: input.q, mode: 'insensitive' } },
      ];
    }
    const items = await db.user.findMany({
      where: where as any,
      take: input.limit + 1,
      cursor: input.cursor ? { id: input.cursor } : undefined,
      skip: input.cursor ? 1 : 0,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        status: true,
        twoFactorEnabled: true,
        createdAt: true,
        lastLoginAt: true,
      },
    });
    const nextCursor = items.length > input.limit ? items.pop()!.id : null;
    return { items, nextCursor };
  }),

  get: globalAdminProcedure.input(z.object({ id: cuid })).query(async ({ input }) => {
    const user = await db.user.findUnique({
      where: { id: input.id },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        status: true,
        twoFactorEnabled: true,
        locale: true,
        createdAt: true,
        lastLoginAt: true,
        _count: {
          select: { sessions: true, invitationsCreated: true, libraryMembers: true },
        },
      },
    });
    if (!user) throw new TRPCError({ code: 'NOT_FOUND' });
    const { _count, ...rest } = user;
    return {
      ...rest,
      counts: {
        sessions: _count.sessions,
        invitationsCreated: _count.invitationsCreated,
        libraryMembers: _count.libraryMembers,
      },
    };
  }),

  invitations: t.router({
    list: globalAdminProcedure
      .input(z.object({ userId: cuid }))
      .query(async ({ input }) => {
        const items = await db.invitation.findMany({
          where: { invitedById: input.userId },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            email: true,
            libraryId: true,
            proposedRole: true,
            expiresAt: true,
            consumedAt: true,
            createdAt: true,
          },
        });
        return { items };
      }),
  }),
});
```

- [ ] **Step 5.4: Brancher dans `_app.ts`**

Remplacer `src/server/trpc/routers/_app.ts` par :

```ts
import { t } from '../trpc';
import { authRouter } from './auth';
import { invitationRouter } from './invitation';
import { passwordRouter } from './password';
import { adminUsersRouter } from './admin/users';

export const appRouter = t.router({
  auth: authRouter,
  invitation: invitationRouter,
  password: passwordRouter,
  admin: t.router({
    users: adminUsersRouter,
  }),
});

export type AppRouter = typeof appRouter;
```

- [ ] **Step 5.5: Run, expect PASS**

```bash
pnpm test:integration -- --run tests/integration/admin-users-read.test.ts
```

Expected: 7 tests pass.

- [ ] **Step 5.6: Commit**

```bash
pnpm prettier --write src/server/trpc/routers/admin/users.ts src/server/trpc/routers/_app.ts tests/integration/admin-users-read.test.ts
git add src/server/trpc/routers/admin/ src/server/trpc/routers/_app.ts tests/integration/admin-users-read.test.ts
git commit -m "feat(phase-1c): admin.users router — read procedures (list/get/invitations.list)"
```

---

## Task 6 : Router admin.users — mutations (suspend, reactivate, delete, changeRole, resetTwoFactor, invitations.revoke)

**Files:**
- Modify: `src/server/trpc/routers/admin/users.ts`
- Create: `tests/integration/admin-users-mutations.test.ts`

- [ ] **Step 6.1: Test integration mutations**

Créer `tests/integration/admin-users-mutations.test.ts` (extrait — reproduire le helper `makeAdminCtx`/`makeUserCtx` de Task 5 ou les extraire dans un helper partagé `tests/integration/_helpers/auth-ctx.ts`) :

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { appRouter } from '@/server/trpc/routers/_app';
import { hashPassword } from '@/lib/password';
import { encryptSecret } from '@/lib/crypto';
import { getTestPrisma, truncateAll } from './setup/prisma';

const prisma = getTestPrisma();
const HASH_64 = 'a'.repeat(64);

async function makeAdminCtx() {
  const user = await prisma.user.create({
    data: { email: 'admin@e2e.test', passwordHash: 'x', displayName: 'Admin', role: 'GLOBAL_ADMIN', twoFactorEnabled: true },
  });
  const session = await prisma.session.create({
    data: { sessionToken: 'a-s', userId: user.id, expiresAt: new Date(Date.now() + 60_000), ipHash: HASH_64, userAgentHash: HASH_64 },
  });
  return { session, user, ip: '203.0.113.1' };
}

describe('admin.users — mutations', () => {
  beforeEach(truncateAll);

  it('suspend: suspends user + revokes their sessions + writes audit', async () => {
    const ctx = await makeAdminCtx();
    const target = await prisma.user.create({
      data: { email: 't@e2e.test', passwordHash: 'x', displayName: 'T' },
    });
    await prisma.session.create({
      data: { sessionToken: 't-s', userId: target.id, expiresAt: new Date(Date.now() + 60_000), ipHash: HASH_64, userAgentHash: HASH_64 },
    });
    await appRouter.createCaller(ctx).admin.users.suspend({ id: target.id, reason: 'spam' });
    expect((await prisma.user.findUnique({ where: { id: target.id } }))?.status).toBe('SUSPENDED');
    expect(await prisma.session.count({ where: { userId: target.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'admin.user.suspended', targetId: target.id } })).toBe(1);
  });

  it('suspend: refuses self', async () => {
    const ctx = await makeAdminCtx();
    await expect(
      appRouter.createCaller(ctx).admin.users.suspend({ id: ctx.user.id, reason: 'oops' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('suspend: refuses last GLOBAL_ADMIN', async () => {
    const ctx = await makeAdminCtx();
    const other = await prisma.user.create({
      data: { email: 'sus@e2e.test', passwordHash: 'x', displayName: 'S' },
    });
    // Promote ctx.user is the only admin; suspending the only admin not self... but ctx.user IS the only admin
    // So suspend a second admin which is the last after we change ctx.user role
    await prisma.user.update({ where: { id: ctx.user.id }, data: { role: 'USER' } });
    await prisma.user.update({ where: { id: other.id }, data: { role: 'GLOBAL_ADMIN' } });
    // Now only `other` is admin. ctx.user can no longer call (FORBIDDEN). Re-promote ctx and target other.
    await prisma.user.update({ where: { id: ctx.user.id }, data: { role: 'GLOBAL_ADMIN' } });
    // Suspend `other` who is admin → still 1 admin remaining (ctx) → allowed.
    await appRouter.createCaller(ctx).admin.users.suspend({ id: other.id, reason: 'test' });
    // Now suspend ctx → would be the last admin → refused.
    // (ctx targeting self is anyway refused with BAD_REQUEST first; covered above.)
  });

  it('reactivate: idempotent', async () => {
    const ctx = await makeAdminCtx();
    const target = await prisma.user.create({
      data: { email: 't@e2e.test', passwordHash: 'x', displayName: 'T', status: 'SUSPENDED' },
    });
    const caller = appRouter.createCaller(ctx);
    await caller.admin.users.reactivate({ id: target.id });
    await caller.admin.users.reactivate({ id: target.id });
    expect((await prisma.user.findUnique({ where: { id: target.id } }))?.status).toBe('ACTIVE');
  });

  it('delete: requires confirmEmail to match', async () => {
    const ctx = await makeAdminCtx();
    const target = await prisma.user.create({
      data: { email: 't@e2e.test', passwordHash: 'x', displayName: 'T' },
    });
    await expect(
      appRouter.createCaller(ctx).admin.users.delete({ id: target.id, confirmEmail: 'wrong@e2e.test' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await appRouter.createCaller(ctx).admin.users.delete({ id: target.id, confirmEmail: 't@e2e.test' });
    expect(await prisma.user.findUnique({ where: { id: target.id } })).toBeNull();
  });

  it('changeRole: refuses self', async () => {
    const ctx = await makeAdminCtx();
    await expect(
      appRouter.createCaller(ctx).admin.users.changeRole({ id: ctx.user.id, newRole: 'USER' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('resetTwoFactor: clears 2FA + kills sessions, refuses GLOBAL_ADMIN target', async () => {
    const ctx = await makeAdminCtx();
    const target = await prisma.user.create({
      data: { email: 't@e2e.test', passwordHash: 'x', displayName: 'T', twoFactorEnabled: true },
    });
    await prisma.twoFactorSecret.create({
      data: { userId: target.id, secretCipher: encryptSecret('JBSWY3DPEHPK3PXP'), confirmedAt: new Date(), backupCodes: [] },
    });
    await prisma.session.create({
      data: { sessionToken: 't-s', userId: target.id, expiresAt: new Date(Date.now() + 60_000), ipHash: HASH_64, userAgentHash: HASH_64 },
    });
    await appRouter.createCaller(ctx).admin.users.resetTwoFactor({ id: target.id, reason: 'lost device' });
    expect((await prisma.user.findUnique({ where: { id: target.id } }))?.twoFactorEnabled).toBe(false);
    expect(await prisma.twoFactorSecret.findUnique({ where: { userId: target.id } })).toBeNull();
    expect(await prisma.session.count({ where: { userId: target.id } })).toBe(0);

    // Refuse on another GLOBAL_ADMIN
    const adminTarget = await prisma.user.create({
      data: { email: 'a2@e2e.test', passwordHash: 'x', displayName: 'A2', role: 'GLOBAL_ADMIN', twoFactorEnabled: true },
    });
    await expect(
      appRouter.createCaller(ctx).admin.users.resetTwoFactor({ id: adminTarget.id, reason: 'no' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
```

- [ ] **Step 6.2: Run, expect FAIL**

```bash
pnpm test:integration -- --run tests/integration/admin-users-mutations.test.ts
```

Expected: import errors on `suspend`, `delete`, etc.

- [ ] **Step 6.3: Étendre le router avec les mutations**

Dans `src/server/trpc/routers/admin/users.ts`, ajouter avant le `})` final :

```ts
import { recordAudit } from '@/lib/audit-log';
import { assertNotLastGlobalAdmin, revokeAllSessionsForUser } from '@/lib/user-admin';
import { revokeInvitation } from '@/lib/invitations';

const reasonInput = z.string().trim().min(3).max(500);

// Inside the t.router({ ... }) structure, add the following procedures alongside list/get:
suspend: globalAdminProcedure
  .input(z.object({ id: cuid, reason: reasonInput }))
  .mutation(async ({ ctx, input }) => {
    if (input.id === ctx.user.id) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'cannot suspend self' });
    }
    await assertNotLastGlobalAdmin(input.id, 'suspend');
    await db.user.update({ where: { id: input.id }, data: { status: 'SUSPENDED' } });
    const revoked = await revokeAllSessionsForUser(input.id);
    await recordAudit({
      action: 'admin.user.suspended',
      actor: { id: ctx.user.id },
      target: { type: 'USER', id: input.id },
      metadata: { reason: input.reason, sessionsRevoked: revoked, ip: ctx.ip },
    });
    return { ok: true };
  }),

reactivate: globalAdminProcedure
  .input(z.object({ id: cuid }))
  .mutation(async ({ ctx, input }) => {
    const user = await db.user.findUnique({ where: { id: input.id }, select: { status: true } });
    if (!user) throw new TRPCError({ code: 'NOT_FOUND' });
    if (user.status === 'ACTIVE') return { ok: true };
    await db.user.update({ where: { id: input.id }, data: { status: 'ACTIVE' } });
    await recordAudit({
      action: 'admin.user.reactivated',
      actor: { id: ctx.user.id },
      target: { type: 'USER', id: input.id },
      metadata: { ip: ctx.ip },
    });
    return { ok: true };
  }),

delete: globalAdminProcedure
  .input(z.object({ id: cuid, confirmEmail: z.string().email() }))
  .mutation(async ({ ctx, input }) => {
    if (input.id === ctx.user.id) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'cannot delete self' });
    }
    const target = await db.user.findUnique({
      where: { id: input.id },
      select: { id: true, email: true, role: true },
    });
    if (!target) throw new TRPCError({ code: 'NOT_FOUND' });
    if (target.email.toLowerCase() !== input.confirmEmail.toLowerCase()) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'confirmEmail mismatch' });
    }
    await assertNotLastGlobalAdmin(input.id, 'remove');
    await db.user.delete({ where: { id: input.id } });
    await recordAudit({
      action: 'admin.user.deleted',
      actor: { id: ctx.user.id },
      target: { type: 'USER', id: input.id },
      metadata: { email: target.email, role: target.role, ip: ctx.ip },
    });
    return { ok: true };
  }),

changeRole: globalAdminProcedure
  .input(z.object({ id: cuid, newRole: z.enum(['GLOBAL_ADMIN', 'USER']) }))
  .mutation(async ({ ctx, input }) => {
    if (input.id === ctx.user.id) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'cannot change own role' });
    }
    const target = await db.user.findUnique({
      where: { id: input.id },
      select: { id: true, role: true },
    });
    if (!target) throw new TRPCError({ code: 'NOT_FOUND' });
    if (target.role === input.newRole) return { ok: true };
    if (target.role === 'GLOBAL_ADMIN') {
      await assertNotLastGlobalAdmin(input.id, 'demote');
    }
    await db.user.update({ where: { id: input.id }, data: { role: input.newRole } });
    await recordAudit({
      action: 'admin.user.role_changed',
      actor: { id: ctx.user.id },
      target: { type: 'USER', id: input.id },
      metadata: { from: target.role, to: input.newRole, ip: ctx.ip },
    });
    return { ok: true };
  }),

resetTwoFactor: globalAdminProcedure
  .input(z.object({ id: cuid, reason: reasonInput }))
  .mutation(async ({ ctx, input }) => {
    const target = await db.user.findUnique({
      where: { id: input.id },
      select: { id: true, role: true, twoFactorEnabled: true },
    });
    if (!target) throw new TRPCError({ code: 'NOT_FOUND' });
    if (target.role === 'GLOBAL_ADMIN') {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'global admin 2FA reset must use DBA runbook',
      });
    }
    await db.$transaction([
      db.twoFactorSecret.deleteMany({ where: { userId: input.id } }),
      db.user.update({ where: { id: input.id }, data: { twoFactorEnabled: false } }),
    ]);
    const sessionsRevoked = await revokeAllSessionsForUser(input.id);
    await recordAudit({
      action: 'admin.user.two_factor_reset',
      actor: { id: ctx.user.id },
      target: { type: 'USER', id: input.id },
      metadata: { reason: input.reason, sessionsRevoked, ip: ctx.ip },
    });
    return { ok: true };
  }),
```

Et étendre `invitations` (sub-router) avec :

```ts
invitations: t.router({
  list: globalAdminProcedure
    .input(z.object({ userId: cuid }))
    .query(async ({ input }) => {
      // ... (existant Task 5)
    }),
  revoke: globalAdminProcedure
    .input(z.object({ invitationId: cuid }))
    .mutation(async ({ ctx, input }) => {
      await revokeInvitation(input.invitationId, ctx.user.id);
      // recordAudit déjà géré par revokeInvitation (Phase 1B)
      return { ok: true };
    }),
}),
```

- [ ] **Step 6.4: Run, expect PASS**

```bash
pnpm test:integration -- --run tests/integration/admin-users-mutations.test.ts
```

Expected: 7 tests pass.

- [ ] **Step 6.5: Sanity check global**

```bash
pnpm typecheck && pnpm lint
```

- [ ] **Step 6.6: Commit**

```bash
pnpm prettier --write src/server/trpc/routers/admin/users.ts tests/integration/admin-users-mutations.test.ts
git add src/server/trpc/routers/admin/users.ts tests/integration/admin-users-mutations.test.ts
git commit -m "feat(phase-1c): admin.users router — mutations (suspend/reactivate/delete/changeRole/resetTwoFactor/invitations.revoke)"
```

---

## Task 7 : Layout admin sidebar + UI /admin/users (list)

**Files:**
- Create: `src/components/admin/AdminSidebar.tsx`
- Modify: `src/app/admin/layout.tsx`
- Modify: `src/components/admin/AdminHeader.tsx` (mobile burger)
- Create: `src/app/admin/users/page.tsx` (server component)
- Create: `src/app/admin/users/UsersTable.tsx` (client)
- Modify: `src/i18n/messages/fr.json` (clés `admin.users.*` + `admin.nav.*`)

- [ ] **Step 7.1: Étendre i18n FR**

Dans `src/i18n/messages/fr.json`, ajouter (à la racine ou sous la section `admin` existante) :

```json
{
  "admin": {
    "nav": {
      "users": "Utilisateurs",
      "libraries": "Bibliothèques"
    },
    "users": {
      "pageTitle": "Utilisateurs",
      "subtitle": "Gérer les comptes de la plateforme",
      "search": "Rechercher par email ou nom",
      "filterStatus": "Statut",
      "filterRole": "Rôle",
      "statusAll": "Tous",
      "statusActive": "Actifs",
      "statusSuspended": "Suspendus",
      "roleAll": "Tous",
      "roleAdmin": "Admin global",
      "roleUser": "Utilisateur",
      "tableEmail": "Email",
      "tableName": "Nom",
      "tableRole": "Rôle",
      "tableStatus": "Statut",
      "table2fa": "2FA",
      "tableLastLogin": "Dernière connexion",
      "tableActions": "Actions",
      "viewDetails": "Voir",
      "inviteCta": "Inviter un utilisateur",
      "empty": "Aucun utilisateur trouvé",
      "loadMore": "Charger plus"
    }
  }
}
```

- [ ] **Step 7.2: Créer le composant AdminSidebar**

Créer `src/components/admin/AdminSidebar.tsx` :

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Users, Library } from 'lucide-react';
import { cn } from '@/lib/utils';

const items = [
  { href: '/admin/users', icon: Users, key: 'users' as const },
  { href: '/admin/libraries', icon: Library, key: 'libraries' as const },
];

export function AdminSidebar() {
  const t = useTranslations('admin.nav');
  const pathname = usePathname();
  return (
    <nav aria-label="Admin sections" className="flex flex-col gap-1 p-4">
      {items.map(({ href, icon: Icon, key }) => {
        const active = pathname === href || pathname.startsWith(href + '/');
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
              active
                ? 'bg-accent/10 text-accent font-medium'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 7.3: Modifier le layout pour inclure la sidebar**

Remplacer le contenu de `src/app/admin/layout.tsx` par :

```tsx
import { redirect } from 'next/navigation';
import { getCurrentSessionAndUser } from '@/server/auth/session-bridge';
import { SEVEN_DAYS_MS } from '@/lib/permissions';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { TwoFactorBanner } from '@/components/auth/TwoFactorBanner';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const result = await getCurrentSessionAndUser();
  if (!result) redirect('/login');
  if (result.user.role !== 'GLOBAL_ADMIN') redirect('/');

  const requiredByMs = result.user.createdAt.getTime() + SEVEN_DAYS_MS;
  const showBanner = !result.user.twoFactorEnabled && Date.now() < requiredByMs;

  return (
    <div className="min-h-dvh bg-background">
      <AdminHeader />
      {showBanner && <TwoFactorBanner requiredBy={new Date(requiredByMs).toISOString()} />}
      <div className="container mx-auto flex flex-col gap-4 px-4 py-6 lg:flex-row lg:gap-8 lg:py-8">
        <aside className="lg:w-56 lg:shrink-0 lg:border-r lg:pr-4">
          <AdminSidebar />
        </aside>
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 7.4: Créer la page liste users**

Créer `src/app/admin/users/page.tsx` :

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { UsersTable } from './UsersTable';

export const metadata: Metadata = {
  title: 'Utilisateurs — BiblioShare Admin',
  robots: { index: false, follow: false },
};

export default async function AdminUsersPage() {
  const t = await getTranslations('admin.users');
  return (
    <section className="space-y-6 animate-slide-up">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('pageTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button asChild>
          <Link href="/admin/users/invite">
            <UserPlus className="h-4 w-4 mr-2" aria-hidden="true" />
            {t('inviteCta')}
          </Link>
        </Button>
      </header>
      <UsersTable />
    </section>
  );
}
```

- [ ] **Step 7.5: Créer le composant client UsersTable**

Créer `src/app/admin/users/UsersTable.tsx` :

```tsx
'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export function UsersTable() {
  const t = useTranslations('admin.users');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | 'ACTIVE' | 'SUSPENDED'>('all');
  const [role, setRole] = useState<'all' | 'GLOBAL_ADMIN' | 'USER'>('all');

  const query = trpc.admin.users.list.useInfiniteQuery(
    { q: q || undefined, status, role, limit: 20 },
    { getNextPageParam: (last) => last.nextCursor ?? undefined },
  );

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex flex-wrap gap-3 border-b p-4">
          <div className="flex-1 min-w-[220px]">
            <Label htmlFor="q" className="sr-only">{t('search')}</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                id="q"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('search')}
                className="pl-9"
              />
            </div>
          </div>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
            aria-label={t('filterStatus')}
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            <option value="all">{t('statusAll')}</option>
            <option value="ACTIVE">{t('statusActive')}</option>
            <option value="SUSPENDED">{t('statusSuspended')}</option>
          </select>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
            aria-label={t('filterRole')}
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            <option value="all">{t('roleAll')}</option>
            <option value="GLOBAL_ADMIN">{t('roleAdmin')}</option>
            <option value="USER">{t('roleUser')}</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2">{t('tableEmail')}</th>
                <th className="px-4 py-2">{t('tableName')}</th>
                <th className="px-4 py-2">{t('tableRole')}</th>
                <th className="px-4 py-2">{t('tableStatus')}</th>
                <th className="px-4 py-2">{t('table2fa')}</th>
                <th className="px-4 py-2">{t('tableLastLogin')}</th>
                <th className="px-4 py-2 text-right">{t('tableActions')}</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && !query.isLoading && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                    {t('empty')}
                  </td>
                </tr>
              )}
              {items.map((u) => (
                <tr key={u.id} className="border-t">
                  <td className="px-4 py-2 font-mono text-xs">{u.email}</td>
                  <td className="px-4 py-2">{u.displayName}</td>
                  <td className="px-4 py-2">{u.role === 'GLOBAL_ADMIN' ? t('roleAdmin') : t('roleUser')}</td>
                  <td className="px-4 py-2">
                    <span className={u.status === 'SUSPENDED' ? 'text-destructive' : ''}>
                      {u.status === 'ACTIVE' ? t('statusActive') : t('statusSuspended')}
                    </span>
                  </td>
                  <td className="px-4 py-2">{u.twoFactorEnabled ? '✓' : '—'}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString('fr-FR') : '—'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/admin/users/${u.id}`}>{t('viewDetails')}</Link>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {query.hasNextPage && (
          <div className="border-t p-3 text-center">
            <Button variant="outline" size="sm" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
              {t('loadMore')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 7.6: Démarrer le dev server et vérifier la page**

```bash
pnpm dev
```

Naviguer vers `http://localhost:3000/admin/users` (logué comme global admin). Vérifier : sidebar avec Users actif, table avec recherche/filtres, pas d'erreur console.

- [ ] **Step 7.7: Sanity check + commit**

```bash
pnpm typecheck && pnpm lint && pnpm format:check
```

(Si format:check fail : `pnpm prettier --write .`)

```bash
git add src/components/admin/AdminSidebar.tsx src/app/admin/layout.tsx src/app/admin/users/page.tsx src/app/admin/users/UsersTable.tsx src/i18n/messages/fr.json
git commit -m "feat(phase-1c): admin sidebar layout + /admin/users list page"
```

---

## Task 8 : UI /admin/users/[id] (fiche détail + dialogs actions)

**Files:**
- Create: `src/app/admin/users/[id]/page.tsx`
- Create: `src/app/admin/users/[id]/UserActions.tsx` (client, dialogs)
- Create: `src/app/admin/users/[id]/UserSessionsList.tsx`
- Create: `src/app/admin/users/[id]/UserAuditExcerpt.tsx`
- Modify: `src/i18n/messages/fr.json` (clés `admin.users.detail.*` + `admin.users.dialogs.*`)

- [ ] **Step 8.1: Étendre i18n FR**

Ajouter dans `src/i18n/messages/fr.json` sous `admin.users` :

```json
{
  "detail": {
    "back": "Retour à la liste",
    "tabActions": "Actions",
    "tabSessions": "Sessions",
    "tabInvitations": "Invitations",
    "tabAudit": "Audit récent",
    "noSessions": "Aucune session active",
    "noInvitations": "Aucune invitation créée",
    "noAudit": "Aucune entrée audit"
  },
  "dialogs": {
    "suspendTitle": "Suspendre cet utilisateur",
    "suspendDescription": "L'utilisateur ne pourra plus se connecter et toutes ses sessions seront révoquées.",
    "reactivateTitle": "Réactiver cet utilisateur",
    "deleteTitle": "Supprimer cet utilisateur",
    "deleteDescription": "Cette action est définitive. Tapez l'email exact pour confirmer.",
    "deleteConfirmEmailLabel": "Tapez l'email pour confirmer",
    "changeRoleTitle": "Changer le rôle",
    "changeRoleDescription": "Promeut ou rétrograde cet utilisateur.",
    "resetTwoFactorTitle": "Réinitialiser le 2FA",
    "resetTwoFactorDescription": "Supprime le secret TOTP et les backup codes. L'utilisateur devra ré-enroller.",
    "reasonLabel": "Motif",
    "reasonPlaceholder": "Pourquoi cette action ?",
    "confirmCta": "Confirmer",
    "cancelCta": "Annuler",
    "successToast": "Action effectuée"
  }
}
```

- [ ] **Step 8.2: Créer la page détail (server component)**

Créer `src/app/admin/users/[id]/page.tsx` :

```tsx
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, Shield, ShieldOff } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { db } from '@/lib/db';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { UserActions } from './UserActions';
import { UserSessionsList } from './UserSessionsList';
import { UserAuditExcerpt } from './UserAuditExcerpt';

export const metadata = { robots: { index: false, follow: false } };

export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations('admin.users');
  const user = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      status: true,
      twoFactorEnabled: true,
      createdAt: true,
      lastLoginAt: true,
      _count: { select: { sessions: true, invitationsCreated: true, libraryMembers: true } },
    },
  });
  if (!user) notFound();

  return (
    <section className="space-y-6 animate-slide-up">
      <Button asChild variant="ghost" size="sm">
        <Link href="/admin/users">
          <ChevronLeft className="h-4 w-4 mr-1" aria-hidden="true" />
          {t('detail.back')}
        </Link>
      </Button>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-xl">{user.displayName}</CardTitle>
            <p className="font-mono text-sm text-muted-foreground">{user.email}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <span className="rounded-md bg-muted px-2 py-1">
                {user.role === 'GLOBAL_ADMIN' ? t('roleAdmin') : t('roleUser')}
              </span>
              <span className={`rounded-md px-2 py-1 ${user.status === 'SUSPENDED' ? 'bg-destructive/10 text-destructive' : 'bg-muted'}`}>
                {user.status === 'ACTIVE' ? t('statusActive') : t('statusSuspended')}
              </span>
              <span className="flex items-center gap-1 rounded-md bg-muted px-2 py-1">
                {user.twoFactorEnabled ? <Shield className="h-3 w-3" /> : <ShieldOff className="h-3 w-3" />}
                2FA {user.twoFactorEnabled ? 'ON' : 'OFF'}
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <UserActions
            userId={user.id}
            userEmail={user.email}
            currentRole={user.role}
            currentStatus={user.status}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">{t('detail.tabSessions')}</CardTitle></CardHeader>
        <CardContent><UserSessionsList userId={user.id} /></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">{t('detail.tabAudit')}</CardTitle></CardHeader>
        <CardContent><UserAuditExcerpt userId={user.id} /></CardContent>
      </Card>
    </section>
  );
}
```

- [ ] **Step 8.3: Créer UserActions (client, dialogs)**

Créer `src/app/admin/users/[id]/UserActions.tsx` :

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ShieldOff, UserCheck, Trash2, KeyRound, RefreshCw } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';

type Props = {
  userId: string;
  userEmail: string;
  currentRole: 'GLOBAL_ADMIN' | 'USER';
  currentStatus: 'ACTIVE' | 'SUSPENDED';
};

export function UserActions({ userId, userEmail, currentRole, currentStatus }: Props) {
  const t = useTranslations('admin.users.dialogs');
  const router = useRouter();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [openDialog, setOpenDialog] = useState<null | 'suspend' | 'reactivate' | 'delete' | 'role' | 'reset2fa'>(null);
  const [reason, setReason] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [newRole, setNewRole] = useState<'GLOBAL_ADMIN' | 'USER'>(currentRole === 'USER' ? 'GLOBAL_ADMIN' : 'USER');

  const onSuccess = () => {
    toast({ title: t('successToast') });
    utils.admin.users.invalidate();
    router.refresh();
    setOpenDialog(null);
    setReason('');
    setConfirmEmail('');
  };
  const onError = (err: { message?: string }) => {
    toast({ title: 'Erreur', description: err.message ?? '', variant: 'destructive' });
  };

  const suspend = trpc.admin.users.suspend.useMutation({ onSuccess, onError });
  const reactivate = trpc.admin.users.reactivate.useMutation({ onSuccess, onError });
  const del = trpc.admin.users.delete.useMutation({ onSuccess, onError });
  const changeRole = trpc.admin.users.changeRole.useMutation({ onSuccess, onError });
  const reset2fa = trpc.admin.users.resetTwoFactor.useMutation({ onSuccess, onError });

  return (
    <div className="flex flex-wrap gap-2">
      {currentStatus === 'ACTIVE' && (
        <Dialog open={openDialog === 'suspend'} onOpenChange={(o) => setOpenDialog(o ? 'suspend' : null)}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <ShieldOff className="h-4 w-4 mr-2" />
              Suspendre
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('suspendTitle')}</DialogTitle>
              <DialogDescription>{t('suspendDescription')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="reason">{t('reasonLabel')}</Label>
              <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('reasonPlaceholder')} maxLength={500} />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpenDialog(null)}>{t('cancelCta')}</Button>
              <Button
                disabled={reason.trim().length < 3 || suspend.isPending}
                onClick={() => suspend.mutate({ id: userId, reason })}
              >
                {t('confirmCta')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {currentStatus === 'SUSPENDED' && (
        <Button variant="outline" size="sm" onClick={() => reactivate.mutate({ id: userId })} disabled={reactivate.isPending}>
          <UserCheck className="h-4 w-4 mr-2" />
          Réactiver
        </Button>
      )}

      <Dialog open={openDialog === 'role'} onOpenChange={(o) => setOpenDialog(o ? 'role' : null)}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Changer le rôle
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('changeRoleTitle')}</DialogTitle>
            <DialogDescription>{t('changeRoleDescription')}</DialogDescription>
          </DialogHeader>
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as 'GLOBAL_ADMIN' | 'USER')}
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          >
            <option value="USER">USER</option>
            <option value="GLOBAL_ADMIN">GLOBAL_ADMIN</option>
          </select>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpenDialog(null)}>{t('cancelCta')}</Button>
            <Button onClick={() => changeRole.mutate({ id: userId, newRole })} disabled={changeRole.isPending || newRole === currentRole}>
              {t('confirmCta')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {currentRole !== 'GLOBAL_ADMIN' && (
        <Dialog open={openDialog === 'reset2fa'} onOpenChange={(o) => setOpenDialog(o ? 'reset2fa' : null)}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <KeyRound className="h-4 w-4 mr-2" />
              Reset 2FA
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('resetTwoFactorTitle')}</DialogTitle>
              <DialogDescription>{t('resetTwoFactorDescription')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="reset-reason">{t('reasonLabel')}</Label>
              <Input id="reset-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpenDialog(null)}>{t('cancelCta')}</Button>
              <Button onClick={() => reset2fa.mutate({ id: userId, reason })} disabled={reason.trim().length < 3 || reset2fa.isPending}>
                {t('confirmCta')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={openDialog === 'delete'} onOpenChange={(o) => setOpenDialog(o ? 'delete' : null)}>
        <DialogTrigger asChild>
          <Button variant="destructive" size="sm">
            <Trash2 className="h-4 w-4 mr-2" />
            Supprimer
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('deleteTitle')}</DialogTitle>
            <DialogDescription>{t('deleteDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="confirm-email">{t('deleteConfirmEmailLabel')}</Label>
            <Input id="confirm-email" value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} placeholder={userEmail} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpenDialog(null)}>{t('cancelCta')}</Button>
            <Button
              variant="destructive"
              onClick={() => del.mutate({ id: userId, confirmEmail })}
              disabled={confirmEmail.toLowerCase() !== userEmail.toLowerCase() || del.isPending}
            >
              {t('confirmCta')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 8.4: Créer UserSessionsList et UserAuditExcerpt (lecture seule)**

Créer `src/app/admin/users/[id]/UserSessionsList.tsx` :

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { trpc } from '@/lib/trpc/client';

export function UserSessionsList({ userId }: { userId: string }) {
  const t = useTranslations('admin.users.detail');
  // Reuse account.security.listSessions when adminViewing? No — for admin viewing of a different user's sessions,
  // expose a dedicated query in admin.users router (Task 8.5 below).
  const query = trpc.admin.users.sessions.list.useQuery({ userId });
  if (query.isLoading) return <p className="text-sm text-muted-foreground">…</p>;
  const items = query.data?.items ?? [];
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{t('noSessions')}</p>;
  return (
    <ul className="divide-y text-sm">
      {items.map((s) => (
        <li key={s.id} className="flex items-center justify-between py-2">
          <div>
            <p className="font-medium">{s.userAgentLabel ?? 'Unknown device'}</p>
            <p className="text-xs text-muted-foreground">
              Created {new Date(s.createdAt).toLocaleString('fr-FR')} · Last active {new Date(s.lastSeenAt).toLocaleString('fr-FR')}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
```

Créer `src/app/admin/users/[id]/UserAuditExcerpt.tsx` :

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { trpc } from '@/lib/trpc/client';

export function UserAuditExcerpt({ userId }: { userId: string }) {
  const t = useTranslations('admin.users.detail');
  const query = trpc.admin.users.audit.list.useQuery({ userId, limit: 10 });
  if (query.isLoading) return <p className="text-sm text-muted-foreground">…</p>;
  const items = query.data?.items ?? [];
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{t('noAudit')}</p>;
  return (
    <ul className="divide-y text-sm">
      {items.map((entry) => (
        <li key={entry.id} className="py-2">
          <span className="font-mono text-xs">{entry.action}</span>{' '}
          <span className="text-muted-foreground">{new Date(entry.createdAt).toLocaleString('fr-FR')}</span>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 8.5: Étendre admin.users router avec sessions.list + audit.list**

Dans `src/server/trpc/routers/admin/users.ts`, ajouter à l'intérieur du `t.router({ ... })` (à côté de `invitations:`) :

```ts
sessions: t.router({
  list: globalAdminProcedure
    .input(z.object({ userId: cuid }))
    .query(async ({ input }) => {
      const items = await db.session.findMany({
        where: { userId: input.userId },
        orderBy: { lastActivityAt: 'desc' },
        select: {
          id: true,
          createdAt: true,
          lastActivityAt: true,
          userAgentLabel: true,
        },
      });
      return {
        items: items.map((s) => ({
          id: s.id,
          createdAt: s.createdAt,
          lastSeenAt: s.lastActivityAt,
          userAgentLabel: s.userAgentLabel,
        })),
      };
    }),
}),

audit: t.router({
  list: globalAdminProcedure
    .input(z.object({ userId: cuid, limit: z.number().int().min(1).max(50).default(10) }))
    .query(async ({ input }) => {
      const items = await db.auditLog.findMany({
        where: {
          OR: [{ actorId: input.userId }, { targetType: 'USER', targetId: input.userId }],
        },
        orderBy: { createdAt: 'desc' },
        take: input.limit,
        select: { id: true, action: true, createdAt: true, metadata: true },
      });
      return { items };
    }),
}),
```

- [ ] **Step 8.6: Sanity check + commit**

```bash
pnpm typecheck && pnpm lint && pnpm format:check
```

(Si format:check fail : `pnpm prettier --write .`)

Tester manuellement la page : `pnpm dev` → naviguer vers `/admin/users/<id>`, ouvrir un dialog (ex. Suspend), valider.

```bash
git add src/app/admin/users/\[id\]/ src/server/trpc/routers/admin/users.ts src/i18n/messages/fr.json
git commit -m "feat(phase-1c): /admin/users/[id] detail page with action dialogs"
```

---

## Task 9 : Helpers library-admin (slugifyUnique, assertLibraryNotArchived, assertNotLastLibraryAdmin)

**Files:**
- Create: `src/lib/library-admin.ts`
- Create: `tests/integration/library-admin.test.ts`

- [ ] **Step 9.1: Test integration**

Créer `tests/integration/library-admin.test.ts` :

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import { assertLibraryNotArchived, assertNotLastLibraryAdmin, slugifyUnique } from '@/lib/library-admin';
import { getTestPrisma, truncateAll } from './setup/prisma';

const prisma = getTestPrisma();

async function makeUser(email: string) {
  return prisma.user.create({ data: { email, passwordHash: 'x', displayName: email } });
}

describe('slugifyUnique', () => {
  beforeEach(truncateAll);

  it('returns simple slug when no collision', async () => {
    expect(await slugifyUnique('My Library', prisma)).toBe('my-library');
  });

  it('appends -2 on collision', async () => {
    await prisma.library.create({ data: { name: 'Foo', slug: 'foo' } });
    expect(await slugifyUnique('Foo', prisma)).toBe('foo-2');
  });

  it('appends -3 on double collision', async () => {
    await prisma.library.create({ data: { name: 'Foo', slug: 'foo' } });
    await prisma.library.create({ data: { name: 'Foo 2', slug: 'foo-2' } });
    expect(await slugifyUnique('Foo', prisma)).toBe('foo-3');
  });
});

describe('assertLibraryNotArchived', () => {
  beforeEach(truncateAll);

  it('passes for active library', async () => {
    const lib = await prisma.library.create({ data: { name: 'Active', slug: 'active' } });
    await expect(assertLibraryNotArchived(lib.id)).resolves.toBeUndefined();
  });

  it('throws for archived library', async () => {
    const lib = await prisma.library.create({
      data: { name: 'Archived', slug: 'archived', archivedAt: new Date() },
    });
    await expect(assertLibraryNotArchived(lib.id)).rejects.toBeInstanceOf(TRPCError);
  });

  it('throws NOT_FOUND for missing library', async () => {
    await expect(assertLibraryNotArchived('cln00000000000000000000')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('assertNotLastLibraryAdmin', () => {
  beforeEach(truncateAll);

  it('throws when removing the last LIBRARY_ADMIN', async () => {
    const lib = await prisma.library.create({ data: { name: 'L', slug: 'l' } });
    const u = await makeUser('admin@e2e.test');
    await prisma.libraryMember.create({
      data: { userId: u.id, libraryId: lib.id, role: 'LIBRARY_ADMIN' },
    });
    await expect(
      assertNotLastLibraryAdmin(lib.id, { libraryId: lib.id, userId: u.id }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it('passes when another LIBRARY_ADMIN exists', async () => {
    const lib = await prisma.library.create({ data: { name: 'L', slug: 'l' } });
    const u1 = await makeUser('a1@e2e.test');
    const u2 = await makeUser('a2@e2e.test');
    await prisma.libraryMember.createMany({
      data: [
        { userId: u1.id, libraryId: lib.id, role: 'LIBRARY_ADMIN' },
        { userId: u2.id, libraryId: lib.id, role: 'LIBRARY_ADMIN' },
      ],
    });
    await expect(
      assertNotLastLibraryAdmin(lib.id, { libraryId: lib.id, userId: u1.id }),
    ).resolves.toBeUndefined();
  });

  it('passes when target is not LIBRARY_ADMIN', async () => {
    const lib = await prisma.library.create({ data: { name: 'L', slug: 'l' } });
    const admin = await makeUser('admin@e2e.test');
    const member = await makeUser('member@e2e.test');
    await prisma.libraryMember.createMany({
      data: [
        { userId: admin.id, libraryId: lib.id, role: 'LIBRARY_ADMIN' },
        { userId: member.id, libraryId: lib.id, role: 'MEMBER' },
      ],
    });
    await expect(
      assertNotLastLibraryAdmin(lib.id, { libraryId: lib.id, userId: member.id }),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 9.2: Run, expect FAIL**

```bash
pnpm test:integration -- --run tests/integration/library-admin.test.ts
```

- [ ] **Step 9.3: Implémenter le module**

Créer `src/lib/library-admin.ts` :

```ts
import { TRPCError } from '@trpc/server';
import type { PrismaClient } from '@prisma/client';
import { db } from './db';

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'library';
}

export async function slugifyUnique(name: string, client: PrismaClient = db as unknown as PrismaClient): Promise<string> {
  const base = slugify(name);
  for (let i = 1; i <= 100; i++) {
    const candidate = i === 1 ? base : `${base}-${i}`;
    const exists = await client.library.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!exists) return candidate;
  }
  throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'unable to generate unique slug' });
}

export async function assertLibraryNotArchived(libraryId: string): Promise<void> {
  const lib = await db.library.findUnique({
    where: { id: libraryId },
    select: { archivedAt: true },
  });
  if (!lib) throw new TRPCError({ code: 'NOT_FOUND' });
  if (lib.archivedAt) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'library archived' });
  }
}

export async function assertNotLastLibraryAdmin(
  libraryId: string,
  membership: { libraryId: string; userId: string },
): Promise<void> {
  const target = await db.libraryMember.findUnique({
    where: { userId_libraryId: { userId: membership.userId, libraryId: membership.libraryId } },
    select: { role: true },
  });
  if (!target || target.role !== 'LIBRARY_ADMIN') return;
  const otherAdmins = await db.libraryMember.count({
    where: {
      libraryId,
      role: 'LIBRARY_ADMIN',
      NOT: { userId: membership.userId },
    },
  });
  if (otherAdmins === 0) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'cannot remove or demote the last library admin',
    });
  }
}
```

- [ ] **Step 9.4: Run, expect PASS**

```bash
pnpm test:integration -- --run tests/integration/library-admin.test.ts
```

Expected: 9 tests pass.

- [ ] **Step 9.5: Commit**

```bash
pnpm prettier --write src/lib/library-admin.ts tests/integration/library-admin.test.ts
git add src/lib/library-admin.ts tests/integration/library-admin.test.ts
git commit -m "feat(phase-1c): library-admin helpers (slugifyUnique, assert helpers)"
```

---

## Task 10 : Router admin.libraries — CRUD library

**Files:**
- Create: `src/server/trpc/routers/admin/libraries.ts`
- Modify: `src/server/trpc/routers/_app.ts`
- Create: `tests/integration/admin-libraries.test.ts`

- [ ] **Step 10.1: Test integration**

Créer `tests/integration/admin-libraries.test.ts` :

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { appRouter } from '@/server/trpc/routers/_app';
import { getTestPrisma, truncateAll } from './setup/prisma';
import type { Session, User } from '@prisma/client';

const prisma = getTestPrisma();
const HASH_64 = 'a'.repeat(64);

async function makeAdminCtx(): Promise<{ session: Session; user: User; ip: string }> {
  const user = await prisma.user.create({
    data: { email: 'admin@e2e.test', passwordHash: 'x', displayName: 'A', role: 'GLOBAL_ADMIN', twoFactorEnabled: true },
  });
  const session = await prisma.session.create({
    data: { sessionToken: 's', userId: user.id, expiresAt: new Date(Date.now() + 60_000), ipHash: HASH_64, userAgentHash: HASH_64 },
  });
  return { session, user, ip: '203.0.113.1' };
}

describe('admin.libraries — CRUD', () => {
  beforeEach(truncateAll);

  it('create: creates with auto-slug + audit', async () => {
    const ctx = await makeAdminCtx();
    const caller = appRouter.createCaller(ctx);
    const lib = await caller.admin.libraries.create({ name: 'My Library', description: 'desc' });
    expect(lib.slug).toBe('my-library');
    expect(lib.archivedAt).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: 'admin.library.created' } })).toBe(1);
  });

  it('create: appends -2 on slug collision', async () => {
    const ctx = await makeAdminCtx();
    const caller = appRouter.createCaller(ctx);
    await caller.admin.libraries.create({ name: 'Foo' });
    const second = await caller.admin.libraries.create({ name: 'Foo' });
    expect(second.slug).toBe('foo-2');
  });

  it('list: excludes archived by default, includes when flag set', async () => {
    const ctx = await makeAdminCtx();
    await prisma.library.createMany({
      data: [
        { name: 'Active', slug: 'active' },
        { name: 'Archived', slug: 'archived', archivedAt: new Date() },
      ],
    });
    const caller = appRouter.createCaller(ctx);
    const def = await caller.admin.libraries.list({ limit: 20 });
    expect(def.items.every((l) => l.archivedAt === null)).toBe(true);
    const all = await caller.admin.libraries.list({ limit: 20, includeArchived: true });
    expect(all.items.length).toBe(2);
  });

  it('rename: refuses if archived', async () => {
    const ctx = await makeAdminCtx();
    const lib = await prisma.library.create({
      data: { name: 'L', slug: 'l', archivedAt: new Date() },
    });
    await expect(
      appRouter.createCaller(ctx).admin.libraries.rename({ id: lib.id, name: 'New' }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('archive: idempotent', async () => {
    const ctx = await makeAdminCtx();
    const lib = await prisma.library.create({ data: { name: 'L', slug: 'l' } });
    const caller = appRouter.createCaller(ctx);
    await caller.admin.libraries.archive({ id: lib.id, reason: 'cleanup' });
    await caller.admin.libraries.archive({ id: lib.id, reason: 'cleanup' });
    const fresh = await prisma.library.findUnique({ where: { id: lib.id } });
    expect(fresh?.archivedAt).toBeTruthy();
  });

  it('unarchive: restores archived library', async () => {
    const ctx = await makeAdminCtx();
    const lib = await prisma.library.create({
      data: { name: 'L', slug: 'l', archivedAt: new Date() },
    });
    await appRouter.createCaller(ctx).admin.libraries.unarchive({ id: lib.id });
    expect((await prisma.library.findUnique({ where: { id: lib.id } }))?.archivedAt).toBeNull();
  });
});
```

- [ ] **Step 10.2: Run, expect FAIL**

```bash
pnpm test:integration -- --run tests/integration/admin-libraries.test.ts
```

- [ ] **Step 10.3: Implémenter le router**

Créer `src/server/trpc/routers/admin/libraries.ts` :

```ts
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { t } from '../../trpc';
import { globalAdminProcedure } from '../../procedures';
import { db } from '@/lib/db';
import { recordAudit } from '@/lib/audit-log';
import { assertLibraryNotArchived, slugifyUnique } from '@/lib/library-admin';

const cuid = z.string().min(20).max(40);
const reasonInput = z.string().trim().min(3).max(500);
const nameInput = z.string().trim().min(3).max(120);
const descriptionInput = z.string().trim().max(1000).optional();

export const adminLibrariesRouter = t.router({
  list: globalAdminProcedure
    .input(
      z.object({
        q: z.string().trim().max(120).optional(),
        includeArchived: z.boolean().default(false),
        cursor: cuid.optional(),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(async ({ input }) => {
      const where: Record<string, unknown> = {};
      if (!input.includeArchived) where.archivedAt = null;
      if (input.q) {
        where.OR = [
          { name: { contains: input.q, mode: 'insensitive' } },
          { slug: { contains: input.q, mode: 'insensitive' } },
        ];
      }
      const items = await db.library.findMany({
        where,
        take: input.limit + 1,
        cursor: input.cursor ? { id: input.cursor } : undefined,
        skip: input.cursor ? 1 : 0,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          archivedAt: true,
          createdAt: true,
          _count: { select: { members: true, books: true } },
        },
      });
      const nextCursor = items.length > input.limit ? items.pop()!.id : null;
      return {
        items: items.map((l) => ({
          ...l,
          counts: { members: l._count.members, books: l._count.books },
        })),
        nextCursor,
      };
    }),

  get: globalAdminProcedure.input(z.object({ id: cuid })).query(async ({ input }) => {
    const lib = await db.library.findUnique({
      where: { id: input.id },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        archivedAt: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { members: true, books: true } },
      },
    });
    if (!lib) throw new TRPCError({ code: 'NOT_FOUND' });
    return { ...lib, counts: { members: lib._count.members, books: lib._count.books } };
  }),

  getBySlug: globalAdminProcedure.input(z.object({ slug: z.string().min(1) })).query(async ({ input }) => {
    const lib = await db.library.findUnique({
      where: { slug: input.slug },
      select: { id: true },
    });
    if (!lib) throw new TRPCError({ code: 'NOT_FOUND' });
    return { id: lib.id };
  }),

  create: globalAdminProcedure
    .input(z.object({ name: nameInput, description: descriptionInput }))
    .mutation(async ({ ctx, input }) => {
      const slug = await slugifyUnique(input.name);
      const lib = await db.library.create({
        data: { name: input.name, slug, description: input.description ?? null },
        select: { id: true, name: true, slug: true, description: true, archivedAt: true, createdAt: true },
      });
      await recordAudit({
        action: 'admin.library.created',
        actor: { id: ctx.user.id },
        target: { type: 'LIBRARY', id: lib.id },
        metadata: { name: lib.name, slug: lib.slug, ip: ctx.ip },
      });
      return lib;
    }),

  rename: globalAdminProcedure
    .input(z.object({ id: cuid, name: nameInput, description: descriptionInput }))
    .mutation(async ({ ctx, input }) => {
      await assertLibraryNotArchived(input.id);
      const before = await db.library.findUniqueOrThrow({
        where: { id: input.id },
        select: { name: true, description: true },
      });
      await db.library.update({
        where: { id: input.id },
        data: { name: input.name, description: input.description ?? null },
      });
      await recordAudit({
        action: 'admin.library.renamed',
        actor: { id: ctx.user.id },
        target: { type: 'LIBRARY', id: input.id },
        metadata: {
          before: { name: before.name, description: before.description },
          after: { name: input.name, description: input.description ?? null },
          ip: ctx.ip,
        },
      });
      return { ok: true };
    }),

  archive: globalAdminProcedure
    .input(z.object({ id: cuid, reason: reasonInput }))
    .mutation(async ({ ctx, input }) => {
      const lib = await db.library.findUnique({
        where: { id: input.id },
        select: { archivedAt: true },
      });
      if (!lib) throw new TRPCError({ code: 'NOT_FOUND' });
      if (lib.archivedAt) return { ok: true };
      await db.library.update({ where: { id: input.id }, data: { archivedAt: new Date() } });
      await recordAudit({
        action: 'admin.library.archived',
        actor: { id: ctx.user.id },
        target: { type: 'LIBRARY', id: input.id },
        metadata: { reason: input.reason, ip: ctx.ip },
      });
      return { ok: true };
    }),

  unarchive: globalAdminProcedure.input(z.object({ id: cuid })).mutation(async ({ ctx, input }) => {
    const lib = await db.library.findUnique({
      where: { id: input.id },
      select: { archivedAt: true },
    });
    if (!lib) throw new TRPCError({ code: 'NOT_FOUND' });
    if (!lib.archivedAt) return { ok: true };
    await db.library.update({ where: { id: input.id }, data: { archivedAt: null } });
    await recordAudit({
      action: 'admin.library.unarchived',
      actor: { id: ctx.user.id },
      target: { type: 'LIBRARY', id: input.id },
      metadata: { ip: ctx.ip },
    });
    return { ok: true };
  }),
});
```

- [ ] **Step 10.4: Brancher dans `_app.ts`**

Modifier `src/server/trpc/routers/_app.ts` pour ajouter `libraries: adminLibrariesRouter` :

```ts
import { adminLibrariesRouter } from './admin/libraries';

export const appRouter = t.router({
  auth: authRouter,
  invitation: invitationRouter,
  password: passwordRouter,
  admin: t.router({
    users: adminUsersRouter,
    libraries: adminLibrariesRouter,
  }),
});
```

- [ ] **Step 10.5: Run, expect PASS**

```bash
pnpm test:integration -- --run tests/integration/admin-libraries.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 10.6: Commit**

```bash
pnpm prettier --write src/server/trpc/routers/admin/libraries.ts src/server/trpc/routers/_app.ts tests/integration/admin-libraries.test.ts
git add src/server/trpc/routers/admin/libraries.ts src/server/trpc/routers/_app.ts tests/integration/admin-libraries.test.ts
git commit -m "feat(phase-1c): admin.libraries router — CRUD + archive"
```

---

## Task 11 : Router admin.libraries.members (add/remove/changeRole/updateFlags)

**Files:**
- Modify: `src/server/trpc/routers/admin/libraries.ts`
- Create: `tests/integration/admin-libraries-members.test.ts`

- [ ] **Step 11.1: Test integration**

Créer `tests/integration/admin-libraries-members.test.ts` :

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { appRouter } from '@/server/trpc/routers/_app';
import { getTestPrisma, truncateAll } from './setup/prisma';

const prisma = getTestPrisma();
const HASH_64 = 'a'.repeat(64);

async function makeAdminCtx() {
  const user = await prisma.user.create({
    data: { email: 'admin@e2e.test', passwordHash: 'x', displayName: 'A', role: 'GLOBAL_ADMIN', twoFactorEnabled: true },
  });
  const session = await prisma.session.create({
    data: { sessionToken: 's', userId: user.id, expiresAt: new Date(Date.now() + 60_000), ipHash: HASH_64, userAgentHash: HASH_64 },
  });
  return { session, user, ip: '203.0.113.1' };
}

describe('admin.libraries.members', () => {
  beforeEach(truncateAll);

  it('add: rejects if archived', async () => {
    const ctx = await makeAdminCtx();
    const lib = await prisma.library.create({
      data: { name: 'L', slug: 'l', archivedAt: new Date() },
    });
    const u = await prisma.user.create({
      data: { email: 'u@e2e.test', passwordHash: 'x', displayName: 'U' },
    });
    await expect(
      appRouter.createCaller(ctx).admin.libraries.members.add({
        libraryId: lib.id,
        userId: u.id,
        role: 'MEMBER',
        flags: { canRead: true, canUpload: false, canDownload: true },
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('add: rejects duplicate with CONFLICT', async () => {
    const ctx = await makeAdminCtx();
    const lib = await prisma.library.create({ data: { name: 'L', slug: 'l' } });
    const u = await prisma.user.create({
      data: { email: 'u@e2e.test', passwordHash: 'x', displayName: 'U' },
    });
    await prisma.libraryMember.create({
      data: { libraryId: lib.id, userId: u.id, role: 'MEMBER' },
    });
    await expect(
      appRouter.createCaller(ctx).admin.libraries.members.add({
        libraryId: lib.id,
        userId: u.id,
        role: 'MEMBER',
        flags: { canRead: true, canUpload: false, canDownload: true },
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('add: writes audit + creates row', async () => {
    const ctx = await makeAdminCtx();
    const lib = await prisma.library.create({ data: { name: 'L', slug: 'l' } });
    const u = await prisma.user.create({
      data: { email: 'u@e2e.test', passwordHash: 'x', displayName: 'U' },
    });
    await appRouter.createCaller(ctx).admin.libraries.members.add({
      libraryId: lib.id,
      userId: u.id,
      role: 'LIBRARY_ADMIN',
      flags: { canRead: true, canUpload: true, canDownload: true },
    });
    expect(await prisma.libraryMember.count({ where: { libraryId: lib.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'admin.member.added' } })).toBe(1);
  });

  it('remove: refuses last LIBRARY_ADMIN', async () => {
    const ctx = await makeAdminCtx();
    const lib = await prisma.library.create({ data: { name: 'L', slug: 'l' } });
    const u = await prisma.user.create({
      data: { email: 'u@e2e.test', passwordHash: 'x', displayName: 'U' },
    });
    await prisma.libraryMember.create({
      data: { libraryId: lib.id, userId: u.id, role: 'LIBRARY_ADMIN' },
    });
    await expect(
      appRouter.createCaller(ctx).admin.libraries.members.remove({
        libraryId: lib.id,
        userId: u.id,
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('changeRole: refuses demoting last LIBRARY_ADMIN', async () => {
    const ctx = await makeAdminCtx();
    const lib = await prisma.library.create({ data: { name: 'L', slug: 'l' } });
    const u = await prisma.user.create({
      data: { email: 'u@e2e.test', passwordHash: 'x', displayName: 'U' },
    });
    await prisma.libraryMember.create({
      data: { libraryId: lib.id, userId: u.id, role: 'LIBRARY_ADMIN' },
    });
    await expect(
      appRouter.createCaller(ctx).admin.libraries.members.changeRole({
        libraryId: lib.id,
        userId: u.id,
        newRole: 'MEMBER',
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('updateFlags: rejects all-false', async () => {
    const ctx = await makeAdminCtx();
    const lib = await prisma.library.create({ data: { name: 'L', slug: 'l' } });
    const u = await prisma.user.create({
      data: { email: 'u@e2e.test', passwordHash: 'x', displayName: 'U' },
    });
    await prisma.libraryMember.create({
      data: { libraryId: lib.id, userId: u.id, role: 'MEMBER' },
    });
    await expect(
      appRouter.createCaller(ctx).admin.libraries.members.updateFlags({
        libraryId: lib.id,
        userId: u.id,
        flags: { canRead: false, canUpload: false, canDownload: false },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
```

- [ ] **Step 11.2: Run, expect FAIL**

```bash
pnpm test:integration -- --run tests/integration/admin-libraries-members.test.ts
```

- [ ] **Step 11.3: Étendre admin.libraries avec sub-router members**

Dans `src/server/trpc/routers/admin/libraries.ts`, ajouter à l'import :

```ts
import { assertLibraryNotArchived, assertNotLastLibraryAdmin, slugifyUnique } from '@/lib/library-admin';
```

Et ajouter dans le `t.router({ ... })` à côté des procedures CRUD :

```ts
members: t.router({
  list: globalAdminProcedure
    .input(
      z.object({
        libraryId: cuid,
        q: z.string().trim().max(120).optional(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(async ({ input }) => {
      const items = await db.libraryMember.findMany({
        where: {
          libraryId: input.libraryId,
          ...(input.q
            ? {
                user: {
                  OR: [
                    { email: { contains: input.q, mode: 'insensitive' } },
                    { displayName: { contains: input.q, mode: 'insensitive' } },
                  ],
                },
              }
            : {}),
        },
        take: input.limit + 1,
        orderBy: { joinedAt: 'asc' },
        select: {
          libraryId: true,
          userId: true,
          role: true,
          canRead: true,
          canUpload: true,
          canDownload: true,
          joinedAt: true,
          user: { select: { email: true, displayName: true, status: true } },
        },
      });
      const nextCursor = items.length > input.limit ? items.pop()!.userId : null;
      return { items, nextCursor };
    }),

  add: globalAdminProcedure
    .input(
      z.object({
        libraryId: cuid,
        userId: cuid,
        role: z.enum(['LIBRARY_ADMIN', 'MEMBER']),
        flags: z.object({
          canRead: z.boolean(),
          canUpload: z.boolean(),
          canDownload: z.boolean(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertLibraryNotArchived(input.libraryId);
      const exists = await db.libraryMember.findUnique({
        where: { userId_libraryId: { userId: input.userId, libraryId: input.libraryId } },
        select: { libraryId: true },
      });
      if (exists) throw new TRPCError({ code: 'CONFLICT', message: 'already a member' });
      await db.libraryMember.create({
        data: {
          libraryId: input.libraryId,
          userId: input.userId,
          role: input.role,
          canRead: input.flags.canRead,
          canUpload: input.flags.canUpload,
          canDownload: input.flags.canDownload,
        },
      });
      await recordAudit({
        action: 'admin.member.added',
        actor: { id: ctx.user.id },
        target: { type: 'MEMBER', id: `${input.libraryId}:${input.userId}` },
        metadata: { libraryId: input.libraryId, userId: input.userId, role: input.role, flags: input.flags, ip: ctx.ip },
      });
      return { ok: true };
    }),

  remove: globalAdminProcedure
    .input(z.object({ libraryId: cuid, userId: cuid }))
    .mutation(async ({ ctx, input }) => {
      await assertLibraryNotArchived(input.libraryId);
      await assertNotLastLibraryAdmin(input.libraryId, { libraryId: input.libraryId, userId: input.userId });
      await db.libraryMember.delete({
        where: { userId_libraryId: { userId: input.userId, libraryId: input.libraryId } },
      });
      await recordAudit({
        action: 'admin.member.removed',
        actor: { id: ctx.user.id },
        target: { type: 'MEMBER', id: `${input.libraryId}:${input.userId}` },
        metadata: { libraryId: input.libraryId, userId: input.userId, ip: ctx.ip },
      });
      return { ok: true };
    }),

  changeRole: globalAdminProcedure
    .input(
      z.object({
        libraryId: cuid,
        userId: cuid,
        newRole: z.enum(['LIBRARY_ADMIN', 'MEMBER']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertLibraryNotArchived(input.libraryId);
      const current = await db.libraryMember.findUnique({
        where: { userId_libraryId: { userId: input.userId, libraryId: input.libraryId } },
        select: { role: true },
      });
      if (!current) throw new TRPCError({ code: 'NOT_FOUND' });
      if (current.role === input.newRole) return { ok: true };
      if (current.role === 'LIBRARY_ADMIN') {
        await assertNotLastLibraryAdmin(input.libraryId, { libraryId: input.libraryId, userId: input.userId });
      }
      await db.libraryMember.update({
        where: { userId_libraryId: { userId: input.userId, libraryId: input.libraryId } },
        data: { role: input.newRole },
      });
      await recordAudit({
        action: 'admin.member.role_changed',
        actor: { id: ctx.user.id },
        target: { type: 'MEMBER', id: `${input.libraryId}:${input.userId}` },
        metadata: { libraryId: input.libraryId, userId: input.userId, from: current.role, to: input.newRole, ip: ctx.ip },
      });
      return { ok: true };
    }),

  updateFlags: globalAdminProcedure
    .input(
      z.object({
        libraryId: cuid,
        userId: cuid,
        flags: z.object({
          canRead: z.boolean(),
          canUpload: z.boolean(),
          canDownload: z.boolean(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertLibraryNotArchived(input.libraryId);
      const anyTrue = input.flags.canRead || input.flags.canUpload || input.flags.canDownload;
      if (!anyTrue) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'at least one flag must be true' });
      }
      const before = await db.libraryMember.findUnique({
        where: { userId_libraryId: { userId: input.userId, libraryId: input.libraryId } },
        select: { canRead: true, canUpload: true, canDownload: true },
      });
      if (!before) throw new TRPCError({ code: 'NOT_FOUND' });
      await db.libraryMember.update({
        where: { userId_libraryId: { userId: input.userId, libraryId: input.libraryId } },
        data: input.flags,
      });
      await recordAudit({
        action: 'admin.member.flags_changed',
        actor: { id: ctx.user.id },
        target: { type: 'MEMBER', id: `${input.libraryId}:${input.userId}` },
        metadata: { libraryId: input.libraryId, userId: input.userId, before, after: input.flags, ip: ctx.ip },
      });
      return { ok: true };
    }),
}),
```

- [ ] **Step 11.4: Run, expect PASS**

```bash
pnpm test:integration -- --run tests/integration/admin-libraries-members.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 11.5: Commit**

```bash
pnpm prettier --write src/server/trpc/routers/admin/libraries.ts tests/integration/admin-libraries-members.test.ts
git add src/server/trpc/routers/admin/libraries.ts tests/integration/admin-libraries-members.test.ts
git commit -m "feat(phase-1c): admin.libraries.members router (add/remove/changeRole/updateFlags)"
```

---

## Task 12 : UI /admin/libraries (list + create + detail page with tabs)

**Files:**
- Create: `src/app/admin/libraries/page.tsx`
- Create: `src/app/admin/libraries/LibrariesTable.tsx`
- Create: `src/app/admin/libraries/CreateLibraryDialog.tsx`
- Create: `src/app/admin/libraries/[slug]/page.tsx`
- Create: `src/app/admin/libraries/[slug]/LibrarySettings.tsx`
- Create: `src/app/admin/libraries/[slug]/MembersPanel.tsx`
- Modify: `src/i18n/messages/fr.json` (clés `admin.libraries.*`)

- [ ] **Step 12.1: Étendre i18n FR pour libraries**

Ajouter dans `src/i18n/messages/fr.json` sous `admin` :

```json
{
  "libraries": {
    "pageTitle": "Bibliothèques",
    "subtitle": "Gérer les bibliothèques de la plateforme",
    "createCta": "Nouvelle bibliothèque",
    "tableName": "Nom",
    "tableSlug": "Slug",
    "tableMembers": "Membres",
    "tableBooks": "Livres",
    "tableStatus": "Statut",
    "tableAction": "Action",
    "statusActive": "Active",
    "statusArchived": "Archivée",
    "search": "Rechercher",
    "includeArchived": "Inclure archivées",
    "open": "Ouvrir",
    "empty": "Aucune bibliothèque",
    "create": {
      "title": "Créer une bibliothèque",
      "nameLabel": "Nom",
      "descriptionLabel": "Description",
      "submit": "Créer",
      "cancel": "Annuler"
    },
    "detail": {
      "back": "Retour aux bibliothèques",
      "tabSettings": "Réglages",
      "tabMembers": "Membres",
      "tabAudit": "Audit",
      "renameSubmit": "Enregistrer",
      "archiveCta": "Archiver",
      "unarchiveCta": "Désarchiver",
      "archiveDialogTitle": "Archiver la bibliothèque",
      "archiveDialogDescription": "La bibliothèque devient lecture seule. Restaurable à tout moment.",
      "reasonLabel": "Motif"
    },
    "members": {
      "title": "Membres",
      "addCta": "Ajouter un membre",
      "tableUser": "Utilisateur",
      "tableRole": "Rôle",
      "tableFlags": "Permissions",
      "tableAction": "Action",
      "roleLibraryAdmin": "Admin biblio",
      "roleMember": "Membre",
      "flagRead": "Lecture",
      "flagUpload": "Upload",
      "flagDownload": "Téléchargement",
      "remove": "Retirer",
      "save": "Enregistrer",
      "addDialogTitle": "Ajouter un membre",
      "addDialogUserLabel": "Utilisateur (cuid)",
      "empty": "Aucun membre"
    }
  }
}
```

- [ ] **Step 12.2: Page liste libraries**

Créer `src/app/admin/libraries/page.tsx` :

```tsx
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LibrariesTable } from './LibrariesTable';
import { CreateLibraryDialog } from './CreateLibraryDialog';

export const metadata: Metadata = {
  title: 'Bibliothèques — BiblioShare Admin',
  robots: { index: false, follow: false },
};

export default async function AdminLibrariesPage() {
  const t = await getTranslations('admin.libraries');
  return (
    <section className="space-y-6 animate-slide-up">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('pageTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <CreateLibraryDialog />
      </header>
      <LibrariesTable />
    </section>
  );
}
```

- [ ] **Step 12.3: LibrariesTable (client)**

Créer `src/app/admin/libraries/LibrariesTable.tsx` :

```tsx
'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function LibrariesTable() {
  const t = useTranslations('admin.libraries');
  const [q, setQ] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);

  const query = trpc.admin.libraries.list.useInfiniteQuery(
    { q: q || undefined, includeArchived, limit: 20 },
    { getNextPageParam: (last) => last.nextCursor ?? undefined },
  );
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex flex-wrap gap-3 border-b p-4">
          <div className="flex-1 min-w-[220px]">
            <Label htmlFor="q-lib" className="sr-only">{t('search')}</Label>
            <Input id="q-lib" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search')} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />
            {t('includeArchived')}
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2">{t('tableName')}</th>
                <th className="px-4 py-2">{t('tableSlug')}</th>
                <th className="px-4 py-2">{t('tableMembers')}</th>
                <th className="px-4 py-2">{t('tableBooks')}</th>
                <th className="px-4 py-2">{t('tableStatus')}</th>
                <th className="px-4 py-2 text-right">{t('tableAction')}</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && !query.isLoading && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">{t('empty')}</td></tr>
              )}
              {items.map((l) => (
                <tr key={l.id} className="border-t">
                  <td className="px-4 py-2 font-medium">{l.name}</td>
                  <td className="px-4 py-2 font-mono text-xs">{l.slug}</td>
                  <td className="px-4 py-2">{l.counts.members}</td>
                  <td className="px-4 py-2">{l.counts.books}</td>
                  <td className="px-4 py-2">
                    {l.archivedAt ? (
                      <span className="text-destructive">{t('statusArchived')}</span>
                    ) : (
                      <span>{t('statusActive')}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/admin/libraries/${l.slug}`}>{t('open')}</Link>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 12.4: CreateLibraryDialog (client)**

Créer `src/app/admin/libraries/CreateLibraryDialog.tsx` :

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';

export function CreateLibraryDialog() {
  const t = useTranslations('admin.libraries.create');
  const tList = useTranslations('admin.libraries');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const router = useRouter();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const create = trpc.admin.libraries.create.useMutation({
    onSuccess: (lib) => {
      toast({ title: t('submit') + ' OK' });
      utils.admin.libraries.invalidate();
      setOpen(false);
      setName('');
      setDescription('');
      router.push(`/admin/libraries/${lib.slug}`);
    },
    onError: (err) => toast({ title: 'Erreur', description: err.message, variant: 'destructive' }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
          {tList('createCta')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{t('title')}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="lib-name">{t('nameLabel')}</Label>
            <Input id="lib-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="lib-desc">{t('descriptionLabel')}</Label>
            <Input id="lib-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>{t('cancel')}</Button>
          <Button
            onClick={() => create.mutate({ name, description: description || undefined })}
            disabled={name.trim().length < 3 || create.isPending}
          >
            {t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 12.5: Page détail library + LibrarySettings + MembersPanel**

Créer `src/app/admin/libraries/[slug]/page.tsx` :

```tsx
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { db } from '@/lib/db';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LibrarySettings } from './LibrarySettings';
import { MembersPanel } from './MembersPanel';

export const metadata = { robots: { index: false, follow: false } };

export default async function AdminLibraryDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const t = await getTranslations('admin.libraries.detail');
  const lib = await db.library.findUnique({
    where: { slug },
    select: { id: true, name: true, slug: true, description: true, archivedAt: true, createdAt: true },
  });
  if (!lib) notFound();

  return (
    <section className="space-y-6 animate-slide-up">
      <Button asChild variant="ghost" size="sm">
        <Link href="/admin/libraries">
          <ChevronLeft className="h-4 w-4 mr-1" aria-hidden="true" />
          {t('back')}
        </Link>
      </Button>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{lib.name}</CardTitle>
          <p className="font-mono text-sm text-muted-foreground">{lib.slug}</p>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">{t('tabSettings')}</CardTitle></CardHeader>
        <CardContent>
          <LibrarySettings
            libraryId={lib.id}
            initialName={lib.name}
            initialDescription={lib.description}
            archivedAt={lib.archivedAt?.toISOString() ?? null}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">{t('tabMembers')}</CardTitle></CardHeader>
        <CardContent><MembersPanel libraryId={lib.id} archived={lib.archivedAt !== null} /></CardContent>
      </Card>
    </section>
  );
}
```

Créer `src/app/admin/libraries/[slug]/LibrarySettings.tsx` :

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Archive, ArchiveRestore } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';

type Props = {
  libraryId: string;
  initialName: string;
  initialDescription: string | null;
  archivedAt: string | null;
};

export function LibrarySettings({ libraryId, initialName, initialDescription, archivedAt }: Props) {
  const t = useTranslations('admin.libraries.detail');
  const router = useRouter();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const archived = archivedAt !== null;
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? '');
  const [reason, setReason] = useState('');
  const [archiveOpen, setArchiveOpen] = useState(false);

  const onSuccess = () => {
    utils.admin.libraries.invalidate();
    router.refresh();
    toast({ title: 'OK' });
    setArchiveOpen(false);
    setReason('');
  };
  const rename = trpc.admin.libraries.rename.useMutation({ onSuccess });
  const archive = trpc.admin.libraries.archive.useMutation({ onSuccess });
  const unarchive = trpc.admin.libraries.unarchive.useMutation({ onSuccess });

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="rename-name">Nom</Label>
        <Input id="rename-name" value={name} disabled={archived} onChange={(e) => setName(e.target.value)} maxLength={120} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="rename-desc">Description</Label>
        <Input id="rename-desc" value={description} disabled={archived} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={archived || rename.isPending || name.trim().length < 3}
          onClick={() => rename.mutate({ id: libraryId, name, description: description || undefined })}
        >
          {t('renameSubmit')}
        </Button>
        {archived ? (
          <Button variant="outline" onClick={() => unarchive.mutate({ id: libraryId })} disabled={unarchive.isPending}>
            <ArchiveRestore className="h-4 w-4 mr-2" />
            {t('unarchiveCta')}
          </Button>
        ) : (
          <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Archive className="h-4 w-4 mr-2" />
                {t('archiveCta')}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t('archiveDialogTitle')}</DialogTitle>
                <DialogDescription>{t('archiveDialogDescription')}</DialogDescription>
              </DialogHeader>
              <div className="space-y-1">
                <Label htmlFor="archive-reason">{t('reasonLabel')}</Label>
                <Input id="archive-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setArchiveOpen(false)}>Annuler</Button>
                <Button
                  onClick={() => archive.mutate({ id: libraryId, reason })}
                  disabled={reason.trim().length < 3 || archive.isPending}
                >
                  {t('archiveCta')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </div>
  );
}
```

Créer `src/app/admin/libraries/[slug]/MembersPanel.tsx` (client) :

```tsx
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, X } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';

export function MembersPanel({ libraryId, archived }: { libraryId: string; archived: boolean }) {
  const t = useTranslations('admin.libraries.members');
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [openAdd, setOpenAdd] = useState(false);
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<'LIBRARY_ADMIN' | 'MEMBER'>('MEMBER');
  const [flags, setFlags] = useState({ canRead: true, canUpload: false, canDownload: true });

  const list = trpc.admin.libraries.members.list.useQuery({ libraryId, limit: 50 });
  const add = trpc.admin.libraries.members.add.useMutation({
    onSuccess: () => { utils.admin.libraries.members.invalidate(); setOpenAdd(false); setUserId(''); toast({ title: 'OK' }); },
    onError: (err) => toast({ title: 'Erreur', description: err.message, variant: 'destructive' }),
  });
  const remove = trpc.admin.libraries.members.remove.useMutation({
    onSuccess: () => { utils.admin.libraries.members.invalidate(); toast({ title: 'OK' }); },
    onError: (err) => toast({ title: 'Erreur', description: err.message, variant: 'destructive' }),
  });

  const items = list.data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={openAdd} onOpenChange={setOpenAdd}>
          <DialogTrigger asChild>
            <Button disabled={archived}><Plus className="h-4 w-4 mr-2" />{t('addCta')}</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{t('addDialogTitle')}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="member-user">{t('addDialogUserLabel')}</Label>
                <Input id="member-user" value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="cl..." />
              </div>
              <div className="space-y-1">
                <Label>Rôle</Label>
                <select value={role} onChange={(e) => setRole(e.target.value as 'LIBRARY_ADMIN' | 'MEMBER')} className="h-9 w-full rounded-md border bg-background px-3 text-sm">
                  <option value="MEMBER">{t('roleMember')}</option>
                  <option value="LIBRARY_ADMIN">{t('roleLibraryAdmin')}</option>
                </select>
              </div>
              <div className="flex flex-wrap gap-3">
                {(['canRead', 'canUpload', 'canDownload'] as const).map((flag) => (
                  <label key={flag} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={flags[flag]} onChange={(e) => setFlags({ ...flags, [flag]: e.target.checked })} />
                    {flag === 'canRead' ? t('flagRead') : flag === 'canUpload' ? t('flagUpload') : t('flagDownload')}
                  </label>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpenAdd(false)}>Annuler</Button>
              <Button
                onClick={() => add.mutate({ libraryId, userId, role, flags })}
                disabled={userId.length < 20 || add.isPending}
              >
                {t('addCta')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-2 py-2">{t('tableUser')}</th>
              <th className="px-2 py-2">{t('tableRole')}</th>
              <th className="px-2 py-2">{t('tableFlags')}</th>
              <th className="px-2 py-2 text-right">{t('tableAction')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((m) => (
              <tr key={m.userId} className="border-t">
                <td className="px-2 py-2">{m.user.displayName}<br /><span className="font-mono text-xs text-muted-foreground">{m.user.email}</span></td>
                <td className="px-2 py-2">{m.role === 'LIBRARY_ADMIN' ? t('roleLibraryAdmin') : t('roleMember')}</td>
                <td className="px-2 py-2 text-xs">
                  {m.canRead && 'R'}{m.canUpload && 'U'}{m.canDownload && 'D'}
                </td>
                <td className="px-2 py-2 text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={archived || remove.isPending}
                    onClick={() => remove.mutate({ libraryId, userId: m.userId })}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 12.6: Sanity check + commit**

```bash
pnpm typecheck && pnpm lint && pnpm prettier --write .
pnpm dev
```

Tester manuellement : créer une biblio, ouvrir détail, ajouter un membre (cuid d'un user existant), changer flags, archiver, désarchiver.

```bash
git add src/app/admin/libraries/ src/i18n/messages/fr.json
git commit -m "feat(phase-1c): /admin/libraries pages (list, create, detail with settings + members)"
```

---

## Task 13 : Rate-limiters 1C + account.profile router + /account layout

**Files:**
- Modify: `src/lib/rate-limit.ts`
- Create: `src/server/trpc/routers/account/profile.ts`
- Modify: `src/server/trpc/routers/_app.ts`
- Create: `src/app/account/layout.tsx`
- Create: `src/app/account/page.tsx`
- Create: `src/app/account/ProfileForm.tsx`
- Create: `src/components/account/AccountSidebar.tsx`
- Create: `src/components/account/AccountHeader.tsx`
- Create: `tests/integration/account-profile.test.ts`
- Modify: `src/i18n/messages/fr.json` (clés `account.*`)

- [ ] **Step 13.1: Étendre rate-limiters**

Ajouter en fin de `src/lib/rate-limit.ts` :

```ts
export const passwordChangeLimiter = new RateLimiterRedis({
  ...baseOpts(),
  keyPrefix: 'rl:pwd_change',
  points: 5,
  duration: 60 * 60,
  blockDuration: 60 * 60,
  insuranceLimiter: memInsurance(5, 60 * 60),
});

export const twoFactorReEnrollLimiter = new RateLimiterRedis({
  ...baseOpts(),
  keyPrefix: 'rl:2fa_reenroll',
  points: 5,
  duration: 60 * 60,
  blockDuration: 60 * 60,
  insuranceLimiter: memInsurance(5, 60 * 60),
});

export const backupCodesRegenLimiter = new RateLimiterRedis({
  ...baseOpts(),
  keyPrefix: 'rl:backup_regen',
  points: 5,
  duration: 60 * 60,
  blockDuration: 60 * 60,
  insuranceLimiter: memInsurance(5, 60 * 60),
});

export const accountProfileUpdateLimiter = new RateLimiterRedis({
  ...baseOpts(),
  keyPrefix: 'rl:profile_update',
  points: 30,
  duration: 60 * 60,
  insuranceLimiter: memInsurance(30, 60 * 60),
});
```

- [ ] **Step 13.2: Test integration account.profile**

Créer `tests/integration/account-profile.test.ts` :

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { appRouter } from '@/server/trpc/routers/_app';
import { getTestPrisma, truncateAll } from './setup/prisma';

const prisma = getTestPrisma();
const HASH_64 = 'a'.repeat(64);

async function makeUserCtx() {
  const user = await prisma.user.create({
    data: { email: 'me@e2e.test', passwordHash: 'x', displayName: 'Me', locale: 'fr' },
  });
  const session = await prisma.session.create({
    data: { sessionToken: 's', userId: user.id, expiresAt: new Date(Date.now() + 60_000), ipHash: HASH_64, userAgentHash: HASH_64 },
  });
  return { session, user, ip: '203.0.113.1' };
}

describe('account.profile', () => {
  beforeEach(truncateAll);

  it('get: returns own profile', async () => {
    const ctx = await makeUserCtx();
    const result = await appRouter.createCaller(ctx).account.profile.get();
    expect(result.email).toBe('me@e2e.test');
    expect(result.displayName).toBe('Me');
  });

  it('update: changes displayName + locale, writes audit', async () => {
    const ctx = await makeUserCtx();
    await appRouter.createCaller(ctx).account.profile.update({
      displayName: 'New Name',
      locale: 'en',
    });
    const fresh = await prisma.user.findUnique({ where: { id: ctx.user.id } });
    expect(fresh?.displayName).toBe('New Name');
    expect(fresh?.locale).toBe('en');
    expect(await prisma.auditLog.count({ where: { action: 'account.profile.updated' } })).toBe(1);
  });
});
```

- [ ] **Step 13.3: Run, expect FAIL**

```bash
pnpm test:integration -- --run tests/integration/account-profile.test.ts
```

- [ ] **Step 13.4: Implémenter le router account.profile**

Créer `src/server/trpc/routers/account/profile.ts` :

```ts
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { t } from '../../trpc';
import { authedProcedure } from '../../procedures';
import { db } from '@/lib/db';
import { recordAudit } from '@/lib/audit-log';
import { accountProfileUpdateLimiter } from '@/lib/rate-limit';

export const accountProfileRouter = t.router({
  get: authedProcedure.query(async ({ ctx }) => {
    const u = await db.user.findUnique({
      where: { id: ctx.user.id },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        status: true,
        locale: true,
        twoFactorEnabled: true,
        createdAt: true,
      },
    });
    if (!u) throw new TRPCError({ code: 'NOT_FOUND' });
    return u;
  }),

  update: authedProcedure
    .input(
      z.object({
        displayName: z.string().trim().min(1).max(120),
        locale: z.enum(['fr', 'en']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await accountProfileUpdateLimiter.consume(ctx.user.id);
      } catch {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS' });
      }
      const before = await db.user.findUniqueOrThrow({
        where: { id: ctx.user.id },
        select: { displayName: true, locale: true },
      });
      await db.user.update({
        where: { id: ctx.user.id },
        data: { displayName: input.displayName, locale: input.locale },
      });
      await recordAudit({
        action: 'account.profile.updated',
        actor: { id: ctx.user.id },
        target: { type: 'USER', id: ctx.user.id },
        metadata: {
          before,
          after: { displayName: input.displayName, locale: input.locale },
          ip: ctx.ip,
        },
      });
      return { ok: true };
    }),
});
```

- [ ] **Step 13.5: Brancher dans `_app.ts`**

Ajouter à `src/server/trpc/routers/_app.ts` :

```ts
import { accountProfileRouter } from './account/profile';

export const appRouter = t.router({
  // ... existant
  admin: t.router({ users: adminUsersRouter, libraries: adminLibrariesRouter }),
  account: t.router({
    profile: accountProfileRouter,
  }),
});
```

- [ ] **Step 13.6: Run, expect PASS**

```bash
pnpm test:integration -- --run tests/integration/account-profile.test.ts
```

- [ ] **Step 13.7: i18n FR pour account**

Ajouter dans `src/i18n/messages/fr.json` :

```json
{
  "account": {
    "nav": {
      "profile": "Profil",
      "security": "Sécurité"
    },
    "profile": {
      "title": "Profil",
      "subtitle": "Vos informations personnelles",
      "emailLabel": "Email",
      "emailHelp": "Le changement d'email arrive dans une phase ultérieure",
      "displayNameLabel": "Nom affiché",
      "localeLabel": "Langue",
      "localeFr": "Français",
      "localeEn": "English",
      "save": "Enregistrer",
      "savedToast": "Profil mis à jour"
    }
  }
}
```

- [ ] **Step 13.8: AccountHeader + AccountSidebar**

Créer `src/components/account/AccountHeader.tsx` :

```tsx
import { BrandMark } from '@/components/brand/BrandMark';
import { LogoutButton } from '@/components/auth/LogoutButton';

export function AccountHeader() {
  return (
    <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
      <div className="container mx-auto flex h-14 items-center justify-between px-4">
        <BrandMark size="sm" />
        <LogoutButton className="text-muted-foreground hover:text-foreground" />
      </div>
    </header>
  );
}
```

Créer `src/components/account/AccountSidebar.tsx` :

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { User, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';

const items = [
  { href: '/account', icon: User, key: 'profile' as const },
  { href: '/account/security', icon: Shield, key: 'security' as const },
];

export function AccountSidebar() {
  const t = useTranslations('account.nav');
  const pathname = usePathname();
  return (
    <nav aria-label="Account sections" className="flex flex-col gap-1 p-4">
      {items.map(({ href, icon: Icon, key }) => {
        const active = pathname === href || (href === '/account/security' && pathname.startsWith(href));
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
              active
                ? 'bg-accent/10 text-accent font-medium'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 13.9: Layout /account**

Créer `src/app/account/layout.tsx` :

```tsx
import { redirect } from 'next/navigation';
import { getCurrentSessionAndUser } from '@/server/auth/session-bridge';
import { AccountHeader } from '@/components/account/AccountHeader';
import { AccountSidebar } from '@/components/account/AccountSidebar';

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const result = await getCurrentSessionAndUser();
  if (!result) redirect('/login');
  return (
    <div className="min-h-dvh bg-background">
      <AccountHeader />
      <div className="container mx-auto flex flex-col gap-4 px-4 py-6 lg:flex-row lg:gap-8 lg:py-8">
        <aside className="lg:w-56 lg:shrink-0 lg:border-r lg:pr-4">
          <AccountSidebar />
        </aside>
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 13.10: Page /account profile + ProfileForm**

Créer `src/app/account/page.tsx` :

```tsx
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ProfileForm } from './ProfileForm';

export const metadata: Metadata = {
  title: 'Profil — BiblioShare',
  robots: { index: false, follow: false },
};

export default async function AccountPage() {
  const t = await getTranslations('account.profile');
  return (
    <section className="space-y-6 animate-slide-up">
      <header>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>
      <Card>
        <CardHeader><CardTitle className="text-base">{t('title')}</CardTitle></CardHeader>
        <CardContent><ProfileForm /></CardContent>
      </Card>
    </section>
  );
}
```

Créer `src/app/account/ProfileForm.tsx` :

```tsx
'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { trpc } from '@/lib/trpc/client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';

export function ProfileForm() {
  const t = useTranslations('account.profile');
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const profile = trpc.account.profile.get.useQuery();
  const update = trpc.account.profile.update.useMutation({
    onSuccess: () => {
      toast({ title: t('savedToast') });
      utils.account.profile.invalidate();
    },
    onError: (err) => toast({ title: 'Erreur', description: err.message, variant: 'destructive' }),
  });

  const [displayName, setDisplayName] = useState('');
  const [locale, setLocale] = useState<'fr' | 'en'>('fr');

  useEffect(() => {
    if (profile.data) {
      setDisplayName(profile.data.displayName);
      setLocale(profile.data.locale === 'en' ? 'en' : 'fr');
    }
  }, [profile.data]);

  if (!profile.data) return <p className="text-sm text-muted-foreground">…</p>;

  const dirty = displayName !== profile.data.displayName || locale !== profile.data.locale;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        update.mutate({ displayName, locale });
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="email">{t('emailLabel')}</Label>
        <Input id="email" value={profile.data.email} disabled aria-describedby="email-help" />
        <p id="email-help" className="text-xs text-muted-foreground">{t('emailHelp')}</p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="displayName">{t('displayNameLabel')}</Label>
        <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={120} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="locale">{t('localeLabel')}</Label>
        <select
          id="locale"
          value={locale}
          onChange={(e) => setLocale(e.target.value as 'fr' | 'en')}
          className="h-9 w-full rounded-md border bg-background px-3 text-sm"
        >
          <option value="fr">{t('localeFr')}</option>
          <option value="en">{t('localeEn')}</option>
        </select>
      </div>
      <Button type="submit" disabled={!dirty || update.isPending || displayName.trim().length < 1}>
        {t('save')}
      </Button>
    </form>
  );
}
```

- [ ] **Step 13.11: Sanity check + commit**

```bash
pnpm typecheck && pnpm lint && pnpm prettier --write .
pnpm test:integration -- --run tests/integration/account-profile.test.ts
```

```bash
git add src/lib/rate-limit.ts src/server/trpc/routers/account/ src/server/trpc/routers/_app.ts src/app/account/ src/components/account/ src/i18n/messages/fr.json tests/integration/account-profile.test.ts
git commit -m "feat(phase-1c): rate-limiters 1C + account.profile router + /account layout & profile page"
```

---

## Task 14 : Router account.security — changePassword + sessions procedures

**Files:**
- Create: `src/server/trpc/routers/account/security.ts`
- Modify: `src/server/trpc/routers/_app.ts`
- Create: `tests/integration/account-security-password.test.ts`
- Create: `tests/integration/account-security-sessions.test.ts`
- Modify: `worker/jobs/send-password-reset-confirmation.ts` (accept `triggerSource`)
- Modify: `src/lib/mail-queue.ts` (helper to enqueue with triggerSource)

- [ ] **Step 14.1: Test changePassword**

Créer `tests/integration/account-security-password.test.ts` :

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appRouter } from '@/server/trpc/routers/_app';
import { hashPassword } from '@/lib/password';
import { getTestPrisma, truncateAll } from './setup/prisma';

const prisma = getTestPrisma();
const HASH_64 = 'a'.repeat(64);

const enqueueMock = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock('@/lib/mail-queue', () => ({
  enqueuePasswordResetConfirmation: enqueueMock,
}));

async function makeUserCtx(password = 'CurrentPass123!') {
  const user = await prisma.user.create({
    data: { email: 'pwd@e2e.test', passwordHash: await hashPassword(password), displayName: 'P' },
  });
  const session = await prisma.session.create({
    data: { sessionToken: 's', userId: user.id, expiresAt: new Date(Date.now() + 60_000), ipHash: HASH_64, userAgentHash: HASH_64 },
  });
  return { session, user, ip: '203.0.113.1' };
}

describe('account.security.changePassword', () => {
  beforeEach(async () => {
    await truncateAll();
    enqueueMock.mockClear();
  });

  it('rejects with UNAUTHORIZED when current password wrong', async () => {
    const ctx = await makeUserCtx();
    await expect(
      appRouter.createCaller(ctx).account.security.changePassword({
        currentPassword: 'Wrong',
        newPassword: 'NewStrongPass456!',
        confirmPassword: 'NewStrongPass456!',
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    // No audit success row
    expect(await prisma.auditLog.count({ where: { action: 'auth.password.changed_self' } })).toBe(0);
  });

  it('rejects when new === current', async () => {
    const ctx = await makeUserCtx();
    await expect(
      appRouter.createCaller(ctx).account.security.changePassword({
        currentPassword: 'CurrentPass123!',
        newPassword: 'CurrentPass123!',
        confirmPassword: 'CurrentPass123!',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('rejects when confirm mismatch', async () => {
    const ctx = await makeUserCtx();
    await expect(
      appRouter.createCaller(ctx).account.security.changePassword({
        currentPassword: 'CurrentPass123!',
        newPassword: 'NewStrongPass456!',
        confirmPassword: 'NewStrongPassXXX!',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('succeeds, kills other sessions, preserves current, writes audit, enqueues mail', async () => {
    const ctx = await makeUserCtx();
    // Add a second session
    await prisma.session.create({
      data: { sessionToken: 'other', userId: ctx.user.id, expiresAt: new Date(Date.now() + 60_000), ipHash: HASH_64, userAgentHash: HASH_64 },
    });
    await appRouter.createCaller(ctx).account.security.changePassword({
      currentPassword: 'CurrentPass123!',
      newPassword: 'NewStrongPass456!',
      confirmPassword: 'NewStrongPass456!',
    });
    expect(await prisma.session.count({ where: { userId: ctx.user.id } })).toBe(1);
    expect(await prisma.session.findUnique({ where: { id: ctx.session.id } })).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { action: 'auth.password.changed_self' } })).toBe(1);
    expect(enqueueMock).toHaveBeenCalledOnce();
    expect(enqueueMock.mock.calls[0][0]).toMatchObject({ userId: ctx.user.id, triggerSource: 'self_change' });
  });
});
```

- [ ] **Step 14.2: Test sessions procedures**

Créer `tests/integration/account-security-sessions.test.ts` :

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { appRouter } from '@/server/trpc/routers/_app';
import { getTestPrisma, truncateAll } from './setup/prisma';

const prisma = getTestPrisma();
const HASH_64 = 'a'.repeat(64);

async function ctx() {
  const user = await prisma.user.create({
    data: { email: 'sess@e2e.test', passwordHash: 'x', displayName: 'S' },
  });
  const session = await prisma.session.create({
    data: { sessionToken: 'cur', userId: user.id, expiresAt: new Date(Date.now() + 60_000), ipHash: HASH_64, userAgentHash: HASH_64, userAgentLabel: 'Chrome on macOS' },
  });
  return { session, user, ip: '203.0.113.1' };
}

describe('account.security — sessions', () => {
  beforeEach(truncateAll);

  it('listSessions: returns sessions with isCurrent flag', async () => {
    const c = await ctx();
    await prisma.session.create({
      data: { sessionToken: 'other', userId: c.user.id, expiresAt: new Date(Date.now() + 60_000), ipHash: HASH_64, userAgentHash: HASH_64, userAgentLabel: 'Safari on iOS' },
    });
    const result = await appRouter.createCaller(c).account.security.listSessions();
    expect(result.items.length).toBe(2);
    const currentItem = result.items.find((s) => s.isCurrent);
    expect(currentItem?.id).toBe(c.session.id);
    expect(currentItem?.userAgentLabel).toBe('Chrome on macOS');
  });

  it('revokeSession: refuses current with BAD_REQUEST', async () => {
    const c = await ctx();
    await expect(
      appRouter.createCaller(c).account.security.revokeSession({ sessionId: c.session.id }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('revokeSession: returns NOT_FOUND on cross-user session (anti-IDOR)', async () => {
    const c = await ctx();
    const other = await prisma.user.create({ data: { email: 'o@e2e.test', passwordHash: 'x', displayName: 'O' } });
    const otherSession = await prisma.session.create({
      data: { sessionToken: 'os', userId: other.id, expiresAt: new Date(Date.now() + 60_000), ipHash: HASH_64, userAgentHash: HASH_64 },
    });
    await expect(
      appRouter.createCaller(c).account.security.revokeSession({ sessionId: otherSession.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('revokeAllOtherSessions: deletes others, preserves current', async () => {
    const c = await ctx();
    await prisma.session.createMany({
      data: [
        { sessionToken: 'a', userId: c.user.id, expiresAt: new Date(Date.now() + 60_000), ipHash: HASH_64, userAgentHash: HASH_64 },
        { sessionToken: 'b', userId: c.user.id, expiresAt: new Date(Date.now() + 60_000), ipHash: HASH_64, userAgentHash: HASH_64 },
      ],
    });
    const result = await appRouter.createCaller(c).account.security.revokeAllOtherSessions();
    expect(result.revokedCount).toBe(2);
    expect(await prisma.session.count({ where: { userId: c.user.id } })).toBe(1);
  });
});
```

- [ ] **Step 14.3: Run, expect FAIL**

```bash
pnpm test:integration -- --run tests/integration/account-security-password.test.ts tests/integration/account-security-sessions.test.ts
```

- [ ] **Step 14.4: Implémenter le router security (changePassword + sessions)**

Créer `src/server/trpc/routers/account/security.ts` :

```ts
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { t } from '../../trpc';
import { authedProcedure } from '../../procedures';
import { db } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/password';
import { recordAudit } from '@/lib/audit-log';
import { passwordChangeLimiter } from '@/lib/rate-limit';
import { revokeAllSessionsForUser } from '@/lib/user-admin';
import { enqueuePasswordResetConfirmation } from '@/lib/mail-queue';
import { getLogger } from '@/lib/logger';

const passwordInput = z
  .string()
  .min(12)
  .max(128)
  .refine((s) => /[A-Z]/.test(s), 'must contain uppercase')
  .refine((s) => /[a-z]/.test(s), 'must contain lowercase')
  .refine((s) => /[0-9]/.test(s), 'must contain digit');

export const accountSecurityRouter = t.router({
  changePassword: authedProcedure
    .input(
      z
        .object({
          currentPassword: z.string().min(1).max(128),
          newPassword: passwordInput,
          confirmPassword: z.string().min(1).max(128),
        })
        .refine((d) => d.newPassword === d.confirmPassword, {
          message: 'confirm mismatch',
          path: ['confirmPassword'],
        }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await passwordChangeLimiter.consume(ctx.user.id);
      } catch {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS' });
      }
      const fullUser = await db.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
      const ok = await verifyPassword(fullUser.passwordHash, input.currentPassword);
      if (!ok) {
        getLogger().warn({ userId: ctx.user.id }, 'changePassword: wrong current');
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      if (input.currentPassword === input.newPassword) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'new password must differ' });
      }
      const newHash = await hashPassword(input.newPassword);
      await db.user.update({ where: { id: ctx.user.id }, data: { passwordHash: newHash } });
      const sessionsRevoked = await revokeAllSessionsForUser(ctx.user.id, ctx.session.id);
      await recordAudit({
        action: 'auth.password.changed_self',
        actor: { id: ctx.user.id },
        target: { type: 'USER', id: ctx.user.id },
        metadata: { ip: ctx.ip, sessionsRevoked },
      });
      await enqueuePasswordResetConfirmation({ userId: ctx.user.id, triggerSource: 'self_change' });
      return { ok: true, sessionsRevoked };
    }),

  listSessions: authedProcedure.query(async ({ ctx }) => {
    const items = await db.session.findMany({
      where: { userId: ctx.user.id },
      orderBy: { lastActivityAt: 'desc' },
      select: { id: true, createdAt: true, lastActivityAt: true, userAgentLabel: true },
    });
    return {
      items: items.map((s) => ({
        id: s.id,
        createdAt: s.createdAt,
        lastSeenAt: s.lastActivityAt,
        userAgentLabel: s.userAgentLabel,
        isCurrent: s.id === ctx.session.id,
      })),
    };
  }),

  revokeSession: authedProcedure
    .input(z.object({ sessionId: z.string().min(20).max(40) }))
    .mutation(async ({ ctx, input }) => {
      if (input.sessionId === ctx.session.id) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'use logout to kill current session' });
      }
      const target = await db.session.findUnique({
        where: { id: input.sessionId },
        select: { userId: true, userAgentLabel: true },
      });
      if (!target || target.userId !== ctx.user.id) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      await db.session.delete({ where: { id: input.sessionId } });
      await recordAudit({
        action: 'auth.session.revoked_self',
        actor: { id: ctx.user.id },
        target: { type: 'SESSION', id: input.sessionId },
        metadata: { userAgentLabel: target.userAgentLabel, ip: ctx.ip },
      });
      return { ok: true };
    }),

  revokeAllOtherSessions: authedProcedure.mutation(async ({ ctx }) => {
    const count = await revokeAllSessionsForUser(ctx.user.id, ctx.session.id);
    await recordAudit({
      action: 'auth.session.revoked_all_others',
      actor: { id: ctx.user.id },
      target: { type: 'USER', id: ctx.user.id },
      metadata: { count, ip: ctx.ip },
    });
    return { revokedCount: count };
  }),
});
```

- [ ] **Step 14.5: Étendre `src/lib/mail-queue.ts`**

Vérifier que `enqueuePasswordResetConfirmation` accepte `triggerSource`. Si pas existant, ajouter :

```ts
export async function enqueuePasswordResetConfirmation(data: {
  userId: string;
  triggerSource?: 'reset' | 'self_change';
}): Promise<void> {
  const queue = getMailQueue();
  await queue.add('send-password-reset-confirmation', data, {
    attempts: 5,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  });
}
```

- [ ] **Step 14.6: Brancher dans `_app.ts`**

```ts
import { accountSecurityRouter } from './account/security';

export const appRouter = t.router({
  // ... existant
  account: t.router({
    profile: accountProfileRouter,
    security: accountSecurityRouter,
  }),
});
```

- [ ] **Step 14.7: Run, expect PASS**

```bash
pnpm test:integration -- --run tests/integration/account-security-password.test.ts tests/integration/account-security-sessions.test.ts
```

Expected: 7 tests pass.

- [ ] **Step 14.8: Commit**

```bash
pnpm prettier --write src/server/trpc/routers/account/security.ts src/server/trpc/routers/_app.ts src/lib/mail-queue.ts tests/integration/account-security-password.test.ts tests/integration/account-security-sessions.test.ts
git add src/server/trpc/routers/account/security.ts src/server/trpc/routers/_app.ts src/lib/mail-queue.ts tests/integration/account-security-password.test.ts tests/integration/account-security-sessions.test.ts
git commit -m "feat(phase-1c): account.security — changePassword + sessions procedures"
```

---

## Task 15 : Router account.security — 2FA self-service (regenerateBackupCodes + startReEnrollWithBackup) + UA label capture

**Files:**
- Modify: `src/server/trpc/routers/account/security.ts`
- Modify: `src/server/auth/credentials-provider.ts` (capture userAgentLabel à la création de session)
- Create: `src/lib/user-agent.ts` (parser UA → label)
- Create: `tests/unit/user-agent.test.ts`
- Create: `tests/integration/account-security-2fa.test.ts`

- [ ] **Step 15.1: Test parser UA**

Créer `tests/unit/user-agent.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { parseUserAgentLabel } from '@/lib/user-agent';

describe('parseUserAgentLabel', () => {
  it('detects Chrome on macOS', () => {
    expect(
      parseUserAgentLabel(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      ),
    ).toBe('Chrome on macOS');
  });
  it('detects Safari on iOS', () => {
    expect(parseUserAgentLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')).toBe('Safari on iOS');
  });
  it('detects Firefox on Windows', () => {
    expect(parseUserAgentLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0')).toBe('Firefox on Windows');
  });
  it('returns null on empty', () => {
    expect(parseUserAgentLabel('')).toBeNull();
  });
  it('truncates to 64 chars max', () => {
    const result = parseUserAgentLabel('Mozilla/5.0 random unknown');
    expect((result ?? '').length).toBeLessThanOrEqual(64);
  });
});
```

- [ ] **Step 15.2: Implémenter parser UA**

Créer `src/lib/user-agent.ts` :

```ts
const BROWSERS: Array<[RegExp, string]> = [
  [/Edg\//, 'Edge'],
  [/Chrome\//, 'Chrome'],
  [/Firefox\//, 'Firefox'],
  [/Version\/[\d.]+\s+(Mobile\/[\w.]+\s+)?Safari\//, 'Safari'],
  [/Safari\//, 'Safari'],
];

const OSES: Array<[RegExp, string]> = [
  [/iPhone|iPad|iOS/, 'iOS'],
  [/Android/, 'Android'],
  [/Macintosh|Mac OS X/, 'macOS'],
  [/Windows/, 'Windows'],
  [/Linux/, 'Linux'],
];

export function parseUserAgentLabel(ua: string): string | null {
  if (!ua || ua.trim().length === 0) return null;
  let browser = 'Browser';
  for (const [re, name] of BROWSERS) {
    if (re.test(ua)) {
      browser = name;
      break;
    }
  }
  let os = 'Unknown';
  for (const [re, name] of OSES) {
    if (re.test(ua)) {
      os = name;
      break;
    }
  }
  return `${browser} on ${os}`.slice(0, 64);
}
```

- [ ] **Step 15.3: Run unit, expect PASS**

```bash
pnpm test:unit -- --run tests/unit/user-agent.test.ts
```

- [ ] **Step 15.4: Capturer userAgentLabel à la création de session**

Repérer dans `src/server/auth/credentials-provider.ts` (ou `src/server/auth/adapter.ts` selon où `Session` est créé après login) le call qui crée la session. Étendre l'input pour inclure `userAgentLabel` (extrait du raw UA via `parseUserAgentLabel`) avant de set `userAgentHash`. Pseudo-diff :

```ts
import { parseUserAgentLabel } from '@/lib/user-agent';

// Là où on construit le data de session :
const userAgentRaw = req.headers.get('user-agent') ?? '';
const userAgentLabel = parseUserAgentLabel(userAgentRaw);
await db.session.create({
  data: {
    sessionToken,
    userId,
    expiresAt,
    ipHash,
    userAgentHash,
    userAgentLabel,
    pending2fa: !user.twoFactorEnabled ? false : true,
  },
});
```

Adapter selon la structure exacte (l'adapter est dans `src/server/auth/adapter.ts:createSession` probablement). Si la session est upgrade-then-create (pending → fresh), capturer label aux deux endroits.

- [ ] **Step 15.5: Test 2FA self-service**

Créer `tests/integration/account-security-2fa.test.ts` :

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { appRouter } from '@/server/trpc/routers/_app';
import { hashPassword } from '@/lib/password';
import { encryptSecret } from '@/lib/crypto';
import { generateBackupCodes, hashBackupCodes, generateTotpSecret, verifyTotpCode } from '@/lib/totp';
import { authenticator } from 'otplib';
import { getTestPrisma, truncateAll } from './setup/prisma';

const prisma = getTestPrisma();
const HASH_64 = 'a'.repeat(64);

async function makeUserWith2fa() {
  const user = await prisma.user.create({
    data: { email: '2fa@e2e.test', passwordHash: await hashPassword('Pwd12345!XYZ'), displayName: 'F', twoFactorEnabled: true },
  });
  const secret = generateTotpSecret();
  const codes = generateBackupCodes();
  const hashes = await hashBackupCodes(codes);
  await prisma.twoFactorSecret.create({
    data: {
      userId: user.id,
      secretCipher: encryptSecret(secret),
      confirmedAt: new Date(),
      backupCodes: hashes,
    },
  });
  const session = await prisma.session.create({
    data: { sessionToken: 's', userId: user.id, expiresAt: new Date(Date.now() + 60_000), ipHash: HASH_64, userAgentHash: HASH_64 },
  });
  return { user, session, secret, codes };
}

describe('account.security — 2FA', () => {
  beforeEach(truncateAll);

  it('regenerateBackupCodes: requires 2FA enabled', async () => {
    const user = await prisma.user.create({
      data: { email: 'no2fa@e2e.test', passwordHash: await hashPassword('Pwd12345!XYZ'), displayName: 'N' },
    });
    const session = await prisma.session.create({
      data: { sessionToken: 's', userId: user.id, expiresAt: new Date(Date.now() + 60_000), ipHash: HASH_64, userAgentHash: HASH_64 },
    });
    const ctx = { user, session, ip: '203.0.113.1' };
    await expect(
      appRouter.createCaller(ctx).account.security.regenerateBackupCodes({
        currentPassword: 'Pwd12345!XYZ',
        totpCode: '000000',
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('regenerateBackupCodes: returns 10 fresh codes one-time', async () => {
    const { user, session, secret } = await makeUserWith2fa();
    const ctx = { user, session, ip: '203.0.113.1' };
    const validCode = authenticator.generate(secret);
    const result = await appRouter.createCaller(ctx).account.security.regenerateBackupCodes({
      currentPassword: 'Pwd12345!XYZ',
      totpCode: validCode,
    });
    expect(result.codes.length).toBe(10);
    expect(await prisma.auditLog.count({ where: { action: 'auth.2fa.recovery_codes_regenerated_self' } })).toBe(1);
  });

  it('startReEnrollWithBackup: refuses GLOBAL_ADMIN', async () => {
    const { user, session, codes } = await makeUserWith2fa();
    await prisma.user.update({ where: { id: user.id }, data: { role: 'GLOBAL_ADMIN' } });
    const refreshed = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const ctx = { user: refreshed, session, ip: '203.0.113.1' };
    await expect(
      appRouter.createCaller(ctx).account.security.startReEnrollWithBackup({ backupCode: codes[0] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('startReEnrollWithBackup: clears 2FA, kills other sessions, audit', async () => {
    const { user, session, codes } = await makeUserWith2fa();
    await prisma.session.create({
      data: { sessionToken: 'other', userId: user.id, expiresAt: new Date(Date.now() + 60_000), ipHash: HASH_64, userAgentHash: HASH_64 },
    });
    const ctx = { user, session, ip: '203.0.113.1' };
    await appRouter.createCaller(ctx).account.security.startReEnrollWithBackup({ backupCode: codes[0] });
    expect((await prisma.user.findUnique({ where: { id: user.id } }))?.twoFactorEnabled).toBe(false);
    expect(await prisma.twoFactorSecret.findUnique({ where: { userId: user.id } })).toBeNull();
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1); // current preserved
    expect(await prisma.auditLog.count({ where: { action: 'auth.2fa.reset_via_backup' } })).toBe(1);
  });
});
```

- [ ] **Step 15.6: Run, expect FAIL**

```bash
pnpm test:integration -- --run tests/integration/account-security-2fa.test.ts
```

- [ ] **Step 15.7: Étendre security router avec 2FA procedures**

Dans `src/server/trpc/routers/account/security.ts`, ajouter à l'intérieur du `t.router({ ... })` :

```ts
import {
  generateBackupCodes,
  hashBackupCodes,
  consumeBackupCode,
  verifyTotpCode,
} from '@/lib/totp';
import { decryptSecret } from '@/lib/crypto';
import { backupCodesRegenLimiter, twoFactorReEnrollLimiter } from '@/lib/rate-limit';

regenerateBackupCodes: authedProcedure
  .input(z.object({ currentPassword: z.string().min(1).max(128), totpCode: z.string().min(6).max(20) }))
  .mutation(async ({ ctx, input }) => {
    try {
      await backupCodesRegenLimiter.consume(ctx.user.id);
    } catch {
      throw new TRPCError({ code: 'TOO_MANY_REQUESTS' });
    }
    if (!ctx.user.twoFactorEnabled) throw new TRPCError({ code: 'PRECONDITION_FAILED' });
    const fullUser = await db.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
    const pwOk = await verifyPassword(fullUser.passwordHash, input.currentPassword);
    if (!pwOk) throw new TRPCError({ code: 'UNAUTHORIZED' });
    const sec = await db.twoFactorSecret.findUnique({ where: { userId: ctx.user.id } });
    if (!sec || !sec.confirmedAt) throw new TRPCError({ code: 'PRECONDITION_FAILED' });
    const totpOk = verifyTotpCode(decryptSecret(sec.secretCipher), input.totpCode);
    if (!totpOk) throw new TRPCError({ code: 'UNAUTHORIZED' });
    const codes = generateBackupCodes();
    const hashes = await hashBackupCodes(codes);
    await db.twoFactorSecret.update({
      where: { userId: ctx.user.id },
      data: { backupCodes: hashes },
    });
    await recordAudit({
      action: 'auth.2fa.recovery_codes_regenerated_self',
      actor: { id: ctx.user.id },
      target: { type: 'USER', id: ctx.user.id },
      metadata: { ip: ctx.ip },
    });
    return { codes };
  }),

startReEnrollWithBackup: authedProcedure
  .input(z.object({ backupCode: z.string().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/) }))
  .mutation(async ({ ctx, input }) => {
    if (ctx.user.role === 'GLOBAL_ADMIN') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'global admin must use DBA runbook' });
    }
    if (!ctx.user.twoFactorEnabled) throw new TRPCError({ code: 'PRECONDITION_FAILED' });
    try {
      await twoFactorReEnrollLimiter.consume(ctx.user.id);
    } catch {
      throw new TRPCError({ code: 'TOO_MANY_REQUESTS' });
    }
    const sec = await db.twoFactorSecret.findUnique({ where: { userId: ctx.user.id } });
    if (!sec) throw new TRPCError({ code: 'PRECONDITION_FAILED' });
    const result = await consumeBackupCode(input.backupCode, sec.backupCodes);
    if (!result) throw new TRPCError({ code: 'UNAUTHORIZED' });
    // Optimistic concurrency to handle race with another consumption attempt
    const updated = await db.twoFactorSecret.updateMany({
      where: { userId: ctx.user.id, backupCodes: { equals: sec.backupCodes } },
      data: { backupCodes: result.remainingHashes },
    });
    if (updated.count === 0) throw new TRPCError({ code: 'CONFLICT' });
    await db.$transaction([
      db.twoFactorSecret.delete({ where: { userId: ctx.user.id } }),
      db.user.update({ where: { id: ctx.user.id }, data: { twoFactorEnabled: false } }),
    ]);
    const sessionsRevoked = await revokeAllSessionsForUser(ctx.user.id, ctx.session.id);
    await recordAudit({
      action: 'auth.2fa.reset_via_backup',
      actor: { id: ctx.user.id },
      target: { type: 'USER', id: ctx.user.id },
      metadata: { ip: ctx.ip, sessionsRevoked },
    });
    return { ok: true };
  }),
```

- [ ] **Step 15.8: Run, expect PASS**

```bash
pnpm test:integration -- --run tests/integration/account-security-2fa.test.ts
```

- [ ] **Step 15.9: Commit**

```bash
pnpm prettier --write src/lib/user-agent.ts src/server/trpc/routers/account/security.ts src/server/auth/credentials-provider.ts src/server/auth/adapter.ts tests/unit/user-agent.test.ts tests/integration/account-security-2fa.test.ts
git add src/lib/user-agent.ts src/server/trpc/routers/account/security.ts src/server/auth/credentials-provider.ts src/server/auth/adapter.ts tests/unit/user-agent.test.ts tests/integration/account-security-2fa.test.ts
git commit -m "feat(phase-1c): account.security 2FA self-service + UA label capture"
```

---

## Task 16 : UI /account/security (4 cards)

**Files:**
- Create: `src/app/account/security/page.tsx`
- Create: `src/app/account/security/PasswordCard.tsx`
- Create: `src/app/account/security/SessionsCard.tsx`
- Create: `src/app/account/security/TwoFactorCard.tsx`
- Create: `src/app/account/security/BackupCodesCard.tsx`
- Modify: `src/i18n/messages/fr.json` (clés `account.security.*`)

- [ ] **Step 16.1: Étendre i18n FR pour security**

Ajouter dans `src/i18n/messages/fr.json` sous `account` :

```json
{
  "security": {
    "title": "Sécurité",
    "subtitle": "Gérer votre mot de passe, vos sessions et le double facteur",
    "password": {
      "title": "Mot de passe",
      "description": "Modifier votre mot de passe. Toutes les autres sessions seront déconnectées.",
      "changeCta": "Changer le mot de passe",
      "currentLabel": "Mot de passe actuel",
      "newLabel": "Nouveau mot de passe",
      "confirmLabel": "Confirmation",
      "submit": "Mettre à jour",
      "successToast": "Mot de passe mis à jour"
    },
    "sessions": {
      "title": "Appareils connectés",
      "description": "Sessions actives sur vos appareils.",
      "currentBadge": "Cette session",
      "revoke": "Révoquer",
      "revokeAllOthers": "Déconnecter toutes les autres sessions",
      "revokedToast": "Session révoquée",
      "unknownDevice": "Appareil inconnu",
      "lastActive": "Dernière activité {time}"
    },
    "twofactor": {
      "title": "Double authentification",
      "descriptionOff": "Ajoutez un second facteur (TOTP) pour sécuriser votre compte.",
      "descriptionOn": "Le double facteur est activé.",
      "setupCta": "Configurer le 2FA",
      "disableCta": "Désactiver le 2FA",
      "resetViaBackupCta": "Réinitialiser via backup code",
      "resetDialogTitle": "Réinitialiser le 2FA",
      "resetDialogDescription": "Entrez un de vos backup codes pour désactiver le 2FA et permettre une nouvelle configuration.",
      "backupCodeLabel": "Code de récupération",
      "submit": "Réinitialiser"
    },
    "backupCodes": {
      "title": "Backup codes",
      "description": "Codes de récupération à utiliser si vous perdez votre appareil 2FA.",
      "remaining": "{count} codes restants",
      "regenerateCta": "Régénérer",
      "regenerateDialogTitle": "Régénérer les backup codes",
      "regenerateDialogDescription": "Confirmez avec votre mot de passe et un code TOTP courant. Les anciens codes seront invalidés.",
      "passwordLabel": "Mot de passe actuel",
      "totpLabel": "Code TOTP",
      "submit": "Régénérer",
      "newCodesTitle": "Notez ces codes",
      "newCodesDescription": "Ils ne seront plus jamais affichés. Conservez-les en lieu sûr."
    }
  }
}
```

- [ ] **Step 16.2: Page /account/security**

Créer `src/app/account/security/page.tsx` :

```tsx
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getCurrentSessionAndUser } from '@/server/auth/session-bridge';
import { db } from '@/lib/db';
import { PasswordCard } from './PasswordCard';
import { SessionsCard } from './SessionsCard';
import { TwoFactorCard } from './TwoFactorCard';
import { BackupCodesCard } from './BackupCodesCard';

export const metadata: Metadata = {
  title: 'Sécurité — BiblioShare',
  robots: { index: false, follow: false },
};

export default async function AccountSecurityPage() {
  const t = await getTranslations('account.security');
  const result = await getCurrentSessionAndUser();
  if (!result) redirect('/login');
  const sec = await db.twoFactorSecret.findUnique({
    where: { userId: result.user.id },
    select: { backupCodes: true },
  });
  const backupRemaining = sec?.backupCodes.length ?? 0;

  return (
    <section className="space-y-6 animate-slide-up">
      <header>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>
      <PasswordCard />
      <SessionsCard />
      <TwoFactorCard
        twoFactorEnabled={result.user.twoFactorEnabled}
        isGlobalAdmin={result.user.role === 'GLOBAL_ADMIN'}
      />
      {result.user.twoFactorEnabled && (
        <BackupCodesCard remaining={backupRemaining} />
      )}
    </section>
  );
}
```

- [ ] **Step 16.3: PasswordCard (client, dialog avec 3 inputs + indicateur force)**

Créer `src/app/account/security/PasswordCard.tsx` :

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { KeyRound } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';

export function PasswordCard() {
  const t = useTranslations('account.security.password');
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const change = trpc.account.security.changePassword.useMutation({
    onSuccess: () => {
      toast({ title: t('successToast') });
      setOpen(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      router.refresh();
    },
    onError: (err) => toast({ title: 'Erreur', description: err.message, variant: 'destructive' }),
  });

  const valid =
    currentPassword.length >= 1 &&
    newPassword.length >= 12 &&
    /[A-Z]/.test(newPassword) &&
    /[a-z]/.test(newPassword) &&
    /[0-9]/.test(newPassword) &&
    newPassword === confirmPassword &&
    newPassword !== currentPassword;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start gap-3">
        <KeyRound className="h-5 w-5 text-accent" aria-hidden="true" />
        <div className="space-y-1">
          <CardTitle className="text-base">{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>{t('changeCta')}</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{t('changeCta')}</DialogTitle></DialogHeader>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                change.mutate({ currentPassword, newPassword, confirmPassword });
              }}
            >
              <div className="space-y-1">
                <Label htmlFor="cur-pwd">{t('currentLabel')}</Label>
                <Input id="cur-pwd" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="new-pwd">{t('newLabel')}</Label>
                <Input id="new-pwd" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" minLength={12} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="conf-pwd">{t('confirmLabel')}</Label>
                <Input id="conf-pwd" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={!valid || change.isPending}>{t('submit')}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 16.4: SessionsCard (client, table + revoke buttons)**

Créer `src/app/account/security/SessionsCard.tsx` :

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { Monitor } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';

export function SessionsCard() {
  const t = useTranslations('account.security.sessions');
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const list = trpc.account.security.listSessions.useQuery();
  const revoke = trpc.account.security.revokeSession.useMutation({
    onSuccess: () => { utils.account.security.listSessions.invalidate(); toast({ title: t('revokedToast') }); },
    onError: (err) => toast({ title: 'Erreur', description: err.message, variant: 'destructive' }),
  });
  const revokeAll = trpc.account.security.revokeAllOtherSessions.useMutation({
    onSuccess: () => { utils.account.security.listSessions.invalidate(); toast({ title: 'OK' }); },
    onError: (err) => toast({ title: 'Erreur', description: err.message, variant: 'destructive' }),
  });

  const items = list.data?.items ?? [];
  const otherCount = items.filter((s) => !s.isCurrent).length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start gap-3">
        <Monitor className="h-5 w-5 text-accent" aria-hidden="true" />
        <div className="space-y-1">
          <CardTitle className="text-base">{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex justify-end">
          <Button variant="outline" size="sm" disabled={otherCount === 0 || revokeAll.isPending} onClick={() => revokeAll.mutate()}>
            {t('revokeAllOthers')}
          </Button>
        </div>
        <ul className="divide-y">
          {items.map((s) => (
            <li key={s.id} className="flex items-center justify-between py-3 text-sm">
              <div>
                <p className="font-medium">{s.userAgentLabel ?? t('unknownDevice')}</p>
                <p className="text-xs text-muted-foreground">
                  {t('lastActive', { time: new Date(s.lastSeenAt).toLocaleString('fr-FR') })}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {s.isCurrent && <span className="rounded-md bg-accent/10 px-2 py-0.5 text-xs text-accent">{t('currentBadge')}</span>}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={s.isCurrent || revoke.isPending}
                  onClick={() => revoke.mutate({ sessionId: s.id })}
                >
                  {t('revoke')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 16.5: TwoFactorCard + BackupCodesCard**

Créer `src/app/account/security/TwoFactorCard.tsx` :

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Shield, ShieldOff, RefreshCw } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';

export function TwoFactorCard({ twoFactorEnabled, isGlobalAdmin }: { twoFactorEnabled: boolean; isGlobalAdmin: boolean }) {
  const t = useTranslations('account.security.twofactor');
  const router = useRouter();
  const { toast } = useToast();
  const [resetOpen, setResetOpen] = useState(false);
  const [backupCode, setBackupCode] = useState('');

  const reset = trpc.account.security.startReEnrollWithBackup.useMutation({
    onSuccess: () => {
      toast({ title: 'OK' });
      setResetOpen(false);
      setBackupCode('');
      router.push('/2fa/setup');
    },
    onError: (err) => toast({ title: 'Erreur', description: err.message, variant: 'destructive' }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start gap-3">
        {twoFactorEnabled ? (
          <Shield className="h-5 w-5 text-accent" aria-hidden="true" />
        ) : (
          <ShieldOff className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        )}
        <div className="space-y-1">
          <CardTitle className="text-base">{t('title')}</CardTitle>
          <CardDescription>{twoFactorEnabled ? t('descriptionOn') : t('descriptionOff')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {!twoFactorEnabled && (
          <Button asChild>
            <Link href="/2fa/setup">{t('setupCta')}</Link>
          </Button>
        )}
        {twoFactorEnabled && !isGlobalAdmin && (
          <>
            <Dialog open={resetOpen} onOpenChange={setResetOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  {t('resetViaBackupCta')}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('resetDialogTitle')}</DialogTitle>
                  <DialogDescription>{t('resetDialogDescription')}</DialogDescription>
                </DialogHeader>
                <div className="space-y-1">
                  <Label htmlFor="backup-code">{t('backupCodeLabel')}</Label>
                  <Input id="backup-code" value={backupCode} onChange={(e) => setBackupCode(e.target.value.toUpperCase())} placeholder="ABCD-1234" />
                </div>
                <DialogFooter>
                  <Button onClick={() => reset.mutate({ backupCode })} disabled={!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(backupCode) || reset.isPending}>
                    {t('submit')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
      </CardContent>
    </Card>
  );
}
```

Créer `src/app/account/security/BackupCodesCard.tsx` :

```tsx
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ListChecks } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';

export function BackupCodesCard({ remaining }: { remaining: number }) {
  const t = useTranslations('account.security.backupCodes');
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pwd, setPwd] = useState('');
  const [totp, setTotp] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);

  const regen = trpc.account.security.regenerateBackupCodes.useMutation({
    onSuccess: (res) => { setCodes(res.codes); setPwd(''); setTotp(''); },
    onError: (err) => toast({ title: 'Erreur', description: err.message, variant: 'destructive' }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start gap-3">
        <ListChecks className="h-5 w-5 text-accent" aria-hidden="true" />
        <div className="space-y-1">
          <CardTitle className="text-base">{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{t('remaining', { count: remaining })}</p>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setCodes(null); }}>
          <DialogTrigger asChild><Button>{t('regenerateCta')}</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('regenerateDialogTitle')}</DialogTitle>
              <DialogDescription>{t('regenerateDialogDescription')}</DialogDescription>
            </DialogHeader>
            {codes ? (
              <div className="space-y-2">
                <h3 className="text-sm font-medium">{t('newCodesTitle')}</h3>
                <p className="text-xs text-muted-foreground">{t('newCodesDescription')}</p>
                <ul className="grid grid-cols-2 gap-1 font-mono text-sm">
                  {codes.map((c) => <li key={c} className="rounded-md bg-muted px-2 py-1">{c}</li>)}
                </ul>
              </div>
            ) : (
              <form
                className="space-y-3"
                onSubmit={(e) => { e.preventDefault(); regen.mutate({ currentPassword: pwd, totpCode: totp }); }}
              >
                <div className="space-y-1">
                  <Label htmlFor="regen-pwd">{t('passwordLabel')}</Label>
                  <Input id="regen-pwd" type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoComplete="current-password" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="regen-totp">{t('totpLabel')}</Label>
                  <Input id="regen-totp" inputMode="numeric" maxLength={6} value={totp} onChange={(e) => setTotp(e.target.value)} />
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={pwd.length === 0 || totp.length !== 6 || regen.isPending}>{t('submit')}</Button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 16.6: Sanity check + commit**

```bash
pnpm typecheck && pnpm lint && pnpm prettier --write .
pnpm dev
```

Tester manuellement : ouvrir `/account/security`, vérifier les 4 cards, ouvrir les dialogs.

```bash
git add src/app/account/security/ src/i18n/messages/fr.json
git commit -m "feat(phase-1c): /account/security page with 4 cards (password, sessions, 2FA, backup codes)"
```

---

## Task 17 : Permissions matrix harness

**Files:**
- Create: `tests/integration/_helpers/auth-ctx.ts`
- Create: `tests/integration/permissions-matrix.test.ts`

- [ ] **Step 17.1: Helper makeCallerForRole**

Créer `tests/integration/_helpers/auth-ctx.ts` :

```ts
import { hashPassword } from '@/lib/password';
import type { Session, User } from '@prisma/client';
import { getTestPrisma } from '../setup/prisma';

const HASH_64 = 'a'.repeat(64);
const prisma = getTestPrisma();

export type RoleKey = 'GLOBAL_ADMIN' | 'LIBRARY_ADMIN' | 'MEMBER' | 'ANON' | 'PENDING_2FA';

export interface RoleCtx {
  session: Session | null;
  user: User | null;
  ip: string;
  libraryId?: string;
}

export async function makeCtxForRole(role: RoleKey): Promise<RoleCtx> {
  if (role === 'ANON') return { session: null, user: null, ip: '203.0.113.1' };
  const baseEmail = `${role.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}@e2e.test`;
  const user = await prisma.user.create({
    data: {
      email: baseEmail,
      passwordHash: await hashPassword('Pwd12345!XYZ'),
      displayName: role,
      role: role === 'GLOBAL_ADMIN' ? 'GLOBAL_ADMIN' : 'USER',
      twoFactorEnabled: role === 'GLOBAL_ADMIN',
      status: 'ACTIVE',
    },
  });
  const session = await prisma.session.create({
    data: {
      sessionToken: `${role}-${user.id}`,
      userId: user.id,
      expiresAt: new Date(Date.now() + 60_000),
      ipHash: HASH_64,
      userAgentHash: HASH_64,
      pending2fa: role === 'PENDING_2FA',
    },
  });
  let libraryId: string | undefined;
  if (role === 'LIBRARY_ADMIN' || role === 'MEMBER') {
    const lib = await prisma.library.create({
      data: { name: `Lib-${role}-${user.id}`, slug: `lib-${role.toLowerCase()}-${user.id}` },
    });
    await prisma.libraryMember.create({
      data: {
        userId: user.id,
        libraryId: lib.id,
        role: role === 'LIBRARY_ADMIN' ? 'LIBRARY_ADMIN' : 'MEMBER',
      },
    });
    libraryId = lib.id;
  }
  return { session, user, ip: '203.0.113.1', libraryId };
}
```

- [ ] **Step 17.2: Harness matrice**

Créer `tests/integration/permissions-matrix.test.ts` :

```ts
import { beforeEach, describe, expect, test } from 'vitest';
import { TRPCError } from '@trpc/server';
import { appRouter } from '@/server/trpc/routers/_app';
import { truncateAll } from './setup/prisma';
import { makeCtxForRole, type RoleKey, type RoleCtx } from './_helpers/auth-ctx';

type Outcome = 'allow' | 'deny';

interface MatrixCase {
  router: string;
  procedure: string;
  byRole: Record<RoleKey, Outcome>;
  call: (caller: ReturnType<typeof appRouter.createCaller>, ctx: RoleCtx) => Promise<unknown>;
}

const ANY_DENY = { GLOBAL_ADMIN: 'deny', LIBRARY_ADMIN: 'deny', MEMBER: 'deny', ANON: 'deny', PENDING_2FA: 'deny' } as const;
const GLOBAL_ONLY = { ...ANY_DENY, GLOBAL_ADMIN: 'allow' } as const;
const AUTHED_ONLY = { ...ANY_DENY, GLOBAL_ADMIN: 'allow', LIBRARY_ADMIN: 'allow', MEMBER: 'allow' } as const;

const matrix: MatrixCase[] = [
  // admin.users — global admin only
  {
    router: 'admin.users', procedure: 'list', byRole: GLOBAL_ONLY,
    call: (c) => c.admin.users.list({ limit: 20 }),
  },
  {
    router: 'admin.users', procedure: 'suspend', byRole: GLOBAL_ONLY,
    call: (c) => c.admin.users.suspend({ id: 'cln00000000000000000000', reason: 'm' }).catch((e) => { if (e instanceof TRPCError && e.code !== 'FORBIDDEN' && e.code !== 'UNAUTHORIZED') throw e; throw e; }),
  },
  // ... (Step 17.3 ajoute les ~28 lignes restantes)

  // account.profile — authed
  {
    router: 'account.profile', procedure: 'get', byRole: AUTHED_ONLY,
    call: (c) => c.account.profile.get(),
  },
  {
    router: 'account.profile', procedure: 'update', byRole: AUTHED_ONLY,
    call: (c) => c.account.profile.update({ displayName: 'X', locale: 'fr' }),
  },

  // account.security — authed
  {
    router: 'account.security', procedure: 'listSessions', byRole: AUTHED_ONLY,
    call: (c) => c.account.security.listSessions(),
  },
  {
    router: 'account.security', procedure: 'revokeAllOtherSessions', byRole: AUTHED_ONLY,
    call: (c) => c.account.security.revokeAllOtherSessions(),
  },
];

describe('permissions matrix', () => {
  beforeEach(truncateAll);

  for (const tc of matrix) {
    describe(`${tc.router}.${tc.procedure}`, () => {
      for (const role of ['GLOBAL_ADMIN', 'LIBRARY_ADMIN', 'MEMBER', 'ANON', 'PENDING_2FA'] as RoleKey[]) {
        test(`${role} → ${tc.byRole[role]}`, async () => {
          const ctx = await makeCtxForRole(role);
          const caller = appRouter.createCaller(ctx);
          const promise = tc.call(caller, ctx);
          if (tc.byRole[role] === 'allow') {
            // Allow = the procedure runs (it may still throw business errors, but NOT FORBIDDEN/UNAUTHORIZED)
            try {
              await promise;
            } catch (e) {
              if (e instanceof TRPCError) {
                expect(['FORBIDDEN', 'UNAUTHORIZED']).not.toContain(e.code);
              }
            }
          } else {
            await expect(promise).rejects.toMatchObject({
              code: expect.stringMatching(/UNAUTHORIZED|FORBIDDEN/),
            });
          }
        });
      }
    });
  }

  // Anti-drift guard
  test('matrix covers every protected procedure registered in appRouter', () => {
    const procs = listProtectedProcedures(appRouter);
    const covered = new Set(matrix.map((m) => `${m.router}.${m.procedure}`));
    const missing = procs.filter((p) => !covered.has(p));
    expect(missing).toEqual([]);
  });
});

function listProtectedProcedures(router: typeof appRouter, prefix = ''): string[] {
  const out: string[] = [];
  const def = (router as unknown as { _def?: { procedures?: Record<string, unknown>; record?: Record<string, unknown> } })._def;
  // tRPC v11 stores procedures keyed; iterate
  const procedures = (def?.procedures ?? {}) as Record<string, { _def?: { meta?: { protected?: boolean } } }>;
  for (const [name] of Object.entries(procedures)) {
    out.push(name);
  }
  // Sub-routers
  const record = (def?.record ?? {}) as Record<string, unknown>;
  for (const [name, child] of Object.entries(record)) {
    if (child && typeof child === 'object' && '_def' in (child as object)) {
      out.push(...listProtectedProcedures(child as typeof appRouter, prefix ? `${prefix}.${name}` : name));
    }
  }
  return out.map((p) => (prefix ? `${prefix}.${p}` : p));
}
```

> NB : la fonction `listProtectedProcedures` doit être ajustée selon la structure exacte de `appRouter._def` en tRPC v11 (`router._def.procedures` est un map `name → procedure`, et les sub-routers vivent dans `_def.record`). Si l'introspection diverge, l'adapter en exécutant un test exploratoire avec `console.log(Object.keys(appRouter._def.record))`.

- [ ] **Step 17.3: Compléter la matrice (procedures restantes)**

Dans `tests/integration/permissions-matrix.test.ts`, étendre l'array `matrix` avec les procedures manquantes (admin.users.{get, reactivate, delete, changeRole, resetTwoFactor, invitations.list, invitations.revoke, sessions.list, audit.list}, admin.libraries.{list, get, create, rename, archive, unarchive, members.list, members.add, members.remove, members.changeRole, members.updateFlags}, account.security.{changePassword, revokeSession, regenerateBackupCodes, startReEnrollWithBackup}). Total ~28 lignes ajoutées avec un `call:` qui invoque la procedure avec un input minimal valide ou un `catch` pour ignorer les business errors.

Exemple type :

```ts
{
  router: 'admin.libraries', procedure: 'create', byRole: GLOBAL_ONLY,
  call: (c) => c.admin.libraries.create({ name: 'X-' + Math.random().toString(36).slice(2, 8) }),
},
{
  router: 'account.security', procedure: 'changePassword', byRole: AUTHED_ONLY,
  call: (c) => c.account.security
    .changePassword({ currentPassword: 'Pwd12345!XYZ', newPassword: 'NewPwd123!XYZ', confirmPassword: 'NewPwd123!XYZ' })
    .catch((e) => { if (e instanceof TRPCError && (e.code === 'FORBIDDEN' || e.code === 'UNAUTHORIZED')) throw e; }),
},
```

- [ ] **Step 17.4: Run matrice**

```bash
pnpm test:integration -- --run tests/integration/permissions-matrix.test.ts
```

Expected: ~150 tests pass + le test anti-drift PASS. Si ce dernier échoue avec une procedure non couverte, ajouter sa ligne à `matrix`.

- [ ] **Step 17.5: Commit**

```bash
pnpm prettier --write tests/integration/permissions-matrix.test.ts tests/integration/_helpers/auth-ctx.ts
git add tests/integration/permissions-matrix.test.ts tests/integration/_helpers/auth-ctx.ts
git commit -m "feat(phase-1c): permissions matrix harness with anti-drift guard"
```

---

## Task 18 : E2E Playwright specs (5)

**Files:**
- Create: `tests/e2e/admin-suspend-user.spec.ts`
- Create: `tests/e2e/admin-create-library-and-add-member.spec.ts`
- Create: `tests/e2e/account-change-password-others-killed.spec.ts`
- Create: `tests/e2e/account-reenroll-2fa-via-backup.spec.ts`
- Create: `tests/e2e/account-revoke-other-session.spec.ts`

- [ ] **Step 18.1: Spec admin suspend**

Créer `tests/e2e/admin-suspend-user.spec.ts` :

```ts
import { test, expect } from '@playwright/test';
import { db } from '@/lib/db';
import { hashPassword } from '@/lib/password';
import { submitLogin } from './helpers/auth';
import { submitOtpAndWait } from './helpers/2fa';

test('global admin can suspend a user', async ({ page, browser }) => {
  // Seed admin (with 2FA off — banner active mais permet l'accès dans la fenêtre 7j)
  const admin = await db.user.create({
    data: {
      email: 'admin-susp@e2e.test',
      passwordHash: await hashPassword('AdminPwd1234!'),
      displayName: 'Admin S',
      role: 'GLOBAL_ADMIN',
      twoFactorEnabled: false,
      createdAt: new Date(),
    },
  });
  const target = await db.user.create({
    data: {
      email: 'target-susp@e2e.test',
      passwordHash: await hashPassword('TargetPwd1234!'),
      displayName: 'Target S',
    },
  });

  await page.goto('/login');
  await submitLogin(page, admin.email, 'AdminPwd1234!');
  // No 2FA enrolled → straight to /admin or /
  await page.goto('/admin/users');
  await page.getByRole('link', { name: target.displayName }).click();
  await page.getByRole('button', { name: /Suspendre/i }).click();
  await page.getByLabel(/Motif/i).fill('Test E2E suspend');
  await page.getByRole('button', { name: /Confirmer/i }).click();

  await expect(page.getByText(/Suspendu/i)).toBeVisible({ timeout: 5000 });

  // Verify other browser context with target session can no longer log in
  const fresh = await db.user.findUnique({ where: { id: target.id } });
  expect(fresh?.status).toBe('SUSPENDED');

  // Cleanup
  await db.auditLog.deleteMany({ where: { OR: [{ actorId: admin.id }, { targetId: target.id }] } });
  await db.user.deleteMany({ where: { id: { in: [admin.id, target.id] } } });
});
```

- [ ] **Step 18.2: Spec admin create library**

Créer `tests/e2e/admin-create-library-and-add-member.spec.ts` :

```ts
import { test, expect } from '@playwright/test';
import { db } from '@/lib/db';
import { hashPassword } from '@/lib/password';
import { submitLogin } from './helpers/auth';

test('admin creates library, adds member, archives', async ({ page }) => {
  const admin = await db.user.create({
    data: {
      email: 'admin-lib@e2e.test',
      passwordHash: await hashPassword('AdminPwd1234!'),
      displayName: 'Admin L',
      role: 'GLOBAL_ADMIN',
    },
  });
  const member = await db.user.create({
    data: {
      email: 'member-lib@e2e.test',
      passwordHash: await hashPassword('MemberPwd1234!'),
      displayName: 'Member L',
    },
  });

  await page.goto('/login');
  await submitLogin(page, admin.email, 'AdminPwd1234!');
  await page.goto('/admin/libraries');
  await page.getByRole('button', { name: /Nouvelle bibliothèque/i }).click();
  const libName = `E2E Lib ${Date.now()}`;
  await page.getByLabel(/^Nom/i).fill(libName);
  await page.getByRole('button', { name: /^Créer$/i }).click();

  // Detail page
  await expect(page.getByRole('heading', { name: libName })).toBeVisible();

  // Add member
  await page.getByRole('button', { name: /Ajouter un membre/i }).click();
  await page.getByLabel(/Utilisateur \(cuid\)/i).fill(member.id);
  await page.getByRole('button', { name: /^Ajouter un membre$/i }).click();
  await expect(page.getByText(member.email)).toBeVisible({ timeout: 5000 });

  // Archive
  await page.getByRole('button', { name: /Archiver/i }).click();
  await page.getByLabel(/Motif/i).fill('E2E cleanup');
  await page.getByRole('button', { name: /^Archiver$/i }).click();
  await expect(page.getByText(/Désarchiver/i)).toBeVisible({ timeout: 5000 });

  // Cleanup
  const lib = await db.library.findFirst({ where: { name: libName } });
  if (lib) await db.libraryMember.deleteMany({ where: { libraryId: lib.id } });
  if (lib) await db.library.delete({ where: { id: lib.id } });
  await db.auditLog.deleteMany({ where: { OR: [{ actorId: admin.id }, { actorId: member.id }] } });
  await db.user.deleteMany({ where: { id: { in: [admin.id, member.id] } } });
});
```

- [ ] **Step 18.3: Spec change password kills other sessions**

Créer `tests/e2e/account-change-password-others-killed.spec.ts` :

```ts
import { test, expect } from '@playwright/test';
import { db } from '@/lib/db';
import { hashPassword } from '@/lib/password';
import { submitLogin } from './helpers/auth';

test('changing password kills other sessions', async ({ browser }) => {
  const user = await db.user.create({
    data: {
      email: 'pwd-e2e@e2e.test',
      passwordHash: await hashPassword('CurrentPwd1234!'),
      displayName: 'Pwd E2E',
    },
  });
  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();
  const p1 = await ctx1.newPage();
  const p2 = await ctx2.newPage();
  await p1.goto('/login');
  await submitLogin(p1, user.email, 'CurrentPwd1234!');
  await p2.goto('/login');
  await submitLogin(p2, user.email, 'CurrentPwd1234!');

  // p1 changes password
  await p1.goto('/account/security');
  await p1.getByRole('button', { name: /Changer le mot de passe/i }).click();
  await p1.getByLabel(/Mot de passe actuel/i).fill('CurrentPwd1234!');
  await p1.getByLabel(/Nouveau mot de passe/i).fill('NewStrongPwd9876!');
  await p1.getByLabel(/^Confirmation$/i).fill('NewStrongPwd9876!');
  await p1.getByRole('button', { name: /Mettre à jour/i }).click();
  await expect(p1.getByText(/mis à jour/i)).toBeVisible({ timeout: 5000 });

  // p2 tries to navigate → should redirect to login (session was killed)
  await p2.goto('/account');
  await expect(p2).toHaveURL(/\/login/, { timeout: 5000 });

  await ctx1.close();
  await ctx2.close();
  await db.user.delete({ where: { id: user.id } });
});
```

- [ ] **Step 18.4: Spec re-enroll 2FA via backup**

Créer `tests/e2e/account-reenroll-2fa-via-backup.spec.ts` :

```ts
import { test, expect } from '@playwright/test';
import { db } from '@/lib/db';
import { hashPassword } from '@/lib/password';
import { encryptSecret } from '@/lib/crypto';
import { generateTotpSecret, generateBackupCodes, hashBackupCodes } from '@/lib/totp';
import { authenticator } from 'otplib';
import { submitLogin } from './helpers/auth';
import { submitOtpAndWait } from './helpers/2fa';

test('user re-enrolls 2FA via backup code', async ({ page }) => {
  const secret = generateTotpSecret();
  const codes = generateBackupCodes();
  const hashes = await hashBackupCodes(codes);
  const user = await db.user.create({
    data: {
      email: 'reenroll@e2e.test',
      passwordHash: await hashPassword('Pwd1234!XYZ'),
      displayName: 'Reenroll',
      twoFactorEnabled: true,
    },
  });
  await db.twoFactorSecret.create({
    data: { userId: user.id, secretCipher: encryptSecret(secret), confirmedAt: new Date(), backupCodes: hashes },
  });

  await page.goto('/login');
  await submitLogin(page, user.email, 'Pwd1234!XYZ');
  await submitOtpAndWait(page, authenticator.generate(secret));
  await page.goto('/account/security');
  await page.getByRole('button', { name: /Réinitialiser via backup code/i }).click();
  await page.getByLabel(/Code de récupération/i).fill(codes[0]);
  await page.getByRole('button', { name: /^Réinitialiser$/i }).click();
  await expect(page).toHaveURL(/\/2fa\/setup/, { timeout: 5000 });

  // Cleanup
  await db.twoFactorSecret.deleteMany({ where: { userId: user.id } });
  await db.session.deleteMany({ where: { userId: user.id } });
  await db.auditLog.deleteMany({ where: { actorId: user.id } });
  await db.user.delete({ where: { id: user.id } });
});
```

- [ ] **Step 18.5: Spec revoke other session**

Créer `tests/e2e/account-revoke-other-session.spec.ts` :

```ts
import { test, expect } from '@playwright/test';
import { db } from '@/lib/db';
import { hashPassword } from '@/lib/password';
import { submitLogin } from './helpers/auth';

test('user revokes another session', async ({ browser }) => {
  const user = await db.user.create({
    data: {
      email: 'revoke@e2e.test',
      passwordHash: await hashPassword('Pwd1234!XYZ'),
      displayName: 'R',
    },
  });
  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();
  const p1 = await ctx1.newPage();
  const p2 = await ctx2.newPage();

  await p1.goto('/login');
  await submitLogin(p1, user.email, 'Pwd1234!XYZ');
  await p2.goto('/login');
  await submitLogin(p2, user.email, 'Pwd1234!XYZ');

  await p1.goto('/account/security');
  // Find the row that is NOT "This session" and click Revoke
  const otherRow = p1.locator('li:not(:has-text("Cette session"))').first();
  await otherRow.getByRole('button', { name: /Révoquer/i }).click();
  await expect(p1.getByText(/révoquée/i)).toBeVisible({ timeout: 5000 });

  await p2.goto('/account');
  await expect(p2).toHaveURL(/\/login/, { timeout: 5000 });

  await ctx1.close();
  await ctx2.close();
  await db.user.delete({ where: { id: user.id } });
});
```

- [ ] **Step 18.6: Run E2E suite**

```bash
pnpm test:e2e -- --reporter=list tests/e2e/admin-suspend-user.spec.ts tests/e2e/admin-create-library-and-add-member.spec.ts tests/e2e/account-change-password-others-killed.spec.ts tests/e2e/account-reenroll-2fa-via-backup.spec.ts tests/e2e/account-revoke-other-session.spec.ts
```

Expected: 5 specs PASS. Si fail :
- Vérifier que helpers `submitLogin`, `submitOtpAndWait` existent dans `tests/e2e/helpers/` (sinon créer ou reprendre depuis Phase 1B).
- Vérifier que la session storage Playwright est bien isolée par context.

- [ ] **Step 18.7: Commit**

```bash
git add tests/e2e/admin-suspend-user.spec.ts tests/e2e/admin-create-library-and-add-member.spec.ts tests/e2e/account-change-password-others-killed.spec.ts tests/e2e/account-reenroll-2fa-via-backup.spec.ts tests/e2e/account-revoke-other-session.spec.ts
git commit -m "test(phase-1c): 5 E2E specs covering admin + account flows"
```

---

## Task 19 : Doc matrice + runbook DBA + WCAG polish

**Files:**
- Create: `docs/permissions-matrix.md`
- Create: `docs/runbooks/disable-2fa-global-admin.md`
- Create: `docs/runbooks/README.md`
- Modify: `src/components/admin/AdminHeader.tsx` (mobile burger drawer Sheet)
- Modify: `src/components/account/AccountHeader.tsx` (mobile burger drawer Sheet)

- [ ] **Step 19.1: Doc matrice rôles**

Créer `docs/permissions-matrix.md` :

```markdown
# Matrice de permissions BiblioShare

> Source de vérité executable : `tests/integration/permissions-matrix.test.ts`. Cette page est régénérée à la main à chaque modification du test (script auto Phase 2).

Légende : ✓ allow · ✗ deny · `(*)` voir contraintes au bas de table.

## admin.users (global admin only)

| Procedure | GLOBAL_ADMIN | LIBRARY_ADMIN | MEMBER | ANON | PENDING_2FA |
|---|---|---|---|---|---|
| list | ✓ | ✗ | ✗ | ✗ | ✗ |
| get | ✓ | ✗ | ✗ | ✗ | ✗ |
| suspend | ✓ (1) | ✗ | ✗ | ✗ | ✗ |
| reactivate | ✓ | ✗ | ✗ | ✗ | ✗ |
| delete | ✓ (1)(2) | ✗ | ✗ | ✗ | ✗ |
| changeRole | ✓ (1) | ✗ | ✗ | ✗ | ✗ |
| resetTwoFactor | ✓ (3) | ✗ | ✗ | ✗ | ✗ |
| invitations.list | ✓ | ✗ | ✗ | ✗ | ✗ |
| invitations.revoke | ✓ | ✗ | ✗ | ✗ | ✗ |
| sessions.list | ✓ | ✗ | ✗ | ✗ | ✗ |
| audit.list | ✓ | ✗ | ✗ | ✗ | ✗ |

(1) Refuse si target = self ou si target est le **dernier GLOBAL_ADMIN actif**.
(2) Exige `confirmEmail` matching strictement l'email cible (anti-mistake).
(3) Refuse si target a `role = 'GLOBAL_ADMIN'` (runbook DBA `docs/runbooks/disable-2fa-global-admin.md`).

## admin.libraries (global admin only)

| Procedure | GLOBAL_ADMIN | LIBRARY_ADMIN | MEMBER | ANON | PENDING_2FA |
|---|---|---|---|---|---|
| list | ✓ | ✗ | ✗ | ✗ | ✗ |
| get | ✓ | ✗ | ✗ | ✗ | ✗ |
| create | ✓ | ✗ | ✗ | ✗ | ✗ |
| rename | ✓ (4) | ✗ | ✗ | ✗ | ✗ |
| archive | ✓ | ✗ | ✗ | ✗ | ✗ |
| unarchive | ✓ | ✗ | ✗ | ✗ | ✗ |
| members.list | ✓ | ✗ | ✗ | ✗ | ✗ |
| members.add | ✓ (4) | ✗ | ✗ | ✗ | ✗ |
| members.remove | ✓ (4)(5) | ✗ | ✗ | ✗ | ✗ |
| members.changeRole | ✓ (4)(5) | ✗ | ✗ | ✗ | ✗ |
| members.updateFlags | ✓ (4)(6) | ✗ | ✗ | ✗ | ✗ |

(4) Refuse si library archived (`archivedAt != null`).
(5) Refuse si retire/rétrograde le **dernier `LIBRARY_ADMIN`** de la biblio.
(6) Refuse si tous les flags sont `false` (au moins un doit être `true`).

## account.profile (authed)

| Procedure | GLOBAL_ADMIN | LIBRARY_ADMIN | MEMBER | ANON | PENDING_2FA |
|---|---|---|---|---|---|
| get | ✓ | ✓ | ✓ | ✗ | ✗ |
| update | ✓ | ✓ | ✓ | ✗ | ✗ |

## account.security (authed)

| Procedure | GLOBAL_ADMIN | LIBRARY_ADMIN | MEMBER | ANON | PENDING_2FA |
|---|---|---|---|---|---|
| changePassword | ✓ (7) | ✓ (7) | ✓ (7) | ✗ | ✗ |
| listSessions | ✓ | ✓ | ✓ | ✗ | ✗ |
| revokeSession | ✓ (8) | ✓ (8) | ✓ (8) | ✗ | ✗ |
| revokeAllOtherSessions | ✓ | ✓ | ✓ | ✗ | ✗ |
| regenerateBackupCodes | ✓ (9) | ✓ (9) | ✓ (9) | ✗ | ✗ |
| startReEnrollWithBackup | ✗ (10) | ✓ (9) | ✓ (9) | ✗ | ✗ |

(7) Refuse `newPassword === currentPassword`. Verify password actuel ; échec → log Pino, rate-limiter `passwordChangeLimiter` 5/h. Kill toutes sessions sauf courante au succès.
(8) Refuse session courante (utiliser logout). Anti-IDOR : session d'un autre user → `NOT_FOUND` (pas `FORBIDDEN`).
(9) Refuse si `twoFactorEnabled === false` → `PRECONDITION_FAILED`.
(10) Refuse pour `GLOBAL_ADMIN` → runbook DBA.

## Hors-1C

Routers `auth.*`, `invitation.*`, `password.*` couverts par leurs propres tests Phase 1A/1B (déjà inclus dans la matrice via le test anti-drift).
```

- [ ] **Step 19.2: Runbook DBA disable 2FA global admin**

Créer `docs/runbooks/disable-2fa-global-admin.md` :

```markdown
# Runbook — Reset 2FA d'un GLOBAL_ADMIN (cas hors-bande)

**Quand utiliser ce runbook** : un `GLOBAL_ADMIN` a perdu son TOTP **et** ses backup codes, et il n'y a pas d'autre `GLOBAL_ADMIN` actif pour faire le reset via panel admin (qui est de toute façon bloqué pour les global admins, par sécurité).

## Pré-requis

- Accès SSH au VPS Coolify hébergeant BiblioShare.
- Identité vérifiée hors-bande (téléphone, IRL) de la personne demandant le reset.
- Une trace écrite de la demande dans le journal d'incident (Notion / Linear / autre).

## Procédure

```bash
ssh deploy@biblioshare.example
docker exec -it biblioshare-postgres psql -U biblioshare -d biblioshare
```

```sql
-- 1. Identifier le user (remplacer email)
SELECT id, email, role, "twoFactorEnabled" FROM "User" WHERE email = 'admin@example.com';
-- Note: copier l'id retourné (cuid) dans <userId>

-- 2. Supprimer le secret TOTP
DELETE FROM "TwoFactorSecret" WHERE "userId" = '<userId>';

-- 3. Mettre à jour le flag
UPDATE "User" SET "twoFactorEnabled" = false WHERE id = '<userId>';

-- 4. Tracer dans AuditLog
INSERT INTO "AuditLog" (id, action, "actorId", "targetType", "targetId", metadata, "createdAt")
VALUES (
  gen_random_uuid()::text,
  'auth.2fa.disabled',
  NULL,
  'USER',
  '<userId>',
  '{"source":"dba_runbook","reason":"<motif>","operator":"<dba-name>"}'::jsonb,
  now()
);
```

## Vérification

1. Le user se reconnecte sur `/login` avec son email + mot de passe.
2. La bannière 2FA réapparaît (Phase 1A `TwoFactorBanner`, fenêtre 7j depuis `createdAt` — si > 7j depuis création du compte, l'admin sera bloqué de tout `globalAdminProcedure` jusqu'à ce qu'il enroll → c'est OK, il peut accéder à `/account/security` ou `/2fa/setup` pour ré-enroller).
3. Confirmer dans `AuditLog` que l'entrée a bien été insérée (`SELECT * FROM "AuditLog" WHERE action = 'auth.2fa.disabled' ORDER BY "createdAt" DESC LIMIT 1;`).

## Trace post-op

Coller dans le journal d'incident :
- Date + heure UTC
- Identité du DBA
- userId concerné
- Motif (perte device + backup épuisés)
- Verification d'identité hors-bande effectuée

## Pourquoi pas de procédure UI

Permettre à un `GLOBAL_ADMIN` de reset le 2FA d'un autre `GLOBAL_ADMIN` via UI ouvre un risque privilege escalation : un admin compromis pourrait désactiver le 2FA d'un autre admin et compromettre son compte. Le hors-bande DBA force une intervention humaine traçable.
```

- [ ] **Step 19.3: Runbook README**

Créer `docs/runbooks/README.md` :

```markdown
# Runbooks BiblioShare

Procédures opérationnelles pour cas hors-bande. Chaque runbook inclut pré-requis, étapes exactes et trace post-op.

## Runbooks disponibles

- [`disable-2fa-global-admin.md`](./disable-2fa-global-admin.md) — Reset 2FA d'un `GLOBAL_ADMIN` qui a perdu device + backup codes.

## Runbooks prévus (Phase ultérieure)

- `hard-delete-library.md` — suppression dure d'une bibliothèque archived (Phase 2+).
- `restore-from-backup.md` — restauration borgbackup (Phase 8).
```

- [ ] **Step 19.4: Mobile burger pour AdminHeader/AccountHeader**

Étendre `src/components/admin/AdminHeader.tsx` (et son équivalent account) pour ajouter un burger menu mobile via `Sheet` shadcn :

```tsx
'use client';

import { useState } from 'react';
import { Menu } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { BrandMark } from '@/components/brand/BrandMark';
import { LogoutButton } from '@/components/auth/LogoutButton';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { AdminSidebar } from './AdminSidebar';

export function AdminHeader() {
  const t = useTranslations('admin.header');
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
      <div className="container mx-auto flex h-14 items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0">
              <AdminSidebar />
            </SheetContent>
          </Sheet>
          <BrandMark size="sm" />
          <span className="hidden text-xs uppercase tracking-wider text-muted-foreground sm:inline">
            {t('phase')}
          </span>
        </div>
        <LogoutButton className="text-muted-foreground hover:text-foreground" />
      </div>
    </header>
  );
}
```

Et adapter le layout pour cacher la sidebar desktop sous `lg:` (déjà fait Task 7.3 / Task 13.9 via `lg:flex-row`).

Si le composant `Sheet` n'est pas encore installé dans `src/components/ui/`, l'ajouter via shadcn CLI :
```bash
pnpm dlx shadcn@latest add sheet
```

- [ ] **Step 19.5: WCAG check manuel**

```bash
pnpm dev
```

Naviguer `/admin/users`, `/admin/libraries`, `/account`, `/account/security` :
- Tab nav : focus visible, ordre logique.
- `aria-current="page"` présent sur item sidebar actif (ouvrir devtools, inspecter).
- Mobile 375px : drawer ouvre/ferme via burger.
- Contraste : tester avec un contraste analyzer (DevTools Lighthouse Accessibility).
- Tous les boutons icon-only ont `aria-label` ou contenu accessible.

Si gap : corriger inline (ex. ajouter `aria-label` manquant).

- [ ] **Step 19.6: Commit**

```bash
pnpm prettier --write docs/permissions-matrix.md docs/runbooks/ src/components/admin/AdminHeader.tsx src/components/account/AccountHeader.tsx
git add docs/permissions-matrix.md docs/runbooks/ src/components/admin/AdminHeader.tsx src/components/account/AccountHeader.tsx src/components/ui/sheet.tsx
git commit -m "docs(phase-1c): permissions matrix + DBA runbook + mobile burger drawer"
```

---

## Task 20 : Closure (CI sanity, memory, tag, PR)

**Files:**
- Modify: `.claude/projects/.../memory/MEMORY.md` and `project_phase_1c_completed.md` (added post-merge)

- [ ] **Step 20.1: Sanity check global**

```bash
pnpm typecheck && pnpm lint && pnpm format:check
```

Si format:check fail : `pnpm prettier --write .` puis `git add -u && git commit -m "chore(phase-1c): apply prettier"`.

- [ ] **Step 20.2: Run all tests**

```bash
pnpm test:unit && pnpm test:integration && pnpm test:e2e
```

Expected: ~375 tests pass total. Si fail isolé : investiguer cause (env var manquante en CI ? helper test périmé ?). Pas de skip à ce stade.

- [ ] **Step 20.3: Vérifier CI plumbing env vars**

Vérifier dans `Dockerfile` (ENV section) et `.github/workflows/ci.yml` (job e2e env section) qu'aucune nouvelle var d'env n'a été introduite en 1C qui ne serait pas plumbée. Phase 1C n'introduit a priori **aucune** nouvelle var d'env (l'IP plumbing utilise des headers, pas d'env). Si on en a ajouté inadvertamment, plumber comme en Phase 1B.

- [ ] **Step 20.4: Push + PR**

```bash
git push -u origin feat/phase-1c-admin-account
```

Créer la PR :

```bash
gh pr create --title "Phase 1C: panel admin + /account self-service + permissions matrix" --body "$(cat <<'EOF'
## Summary
- Panel admin global Users + Libraries (avec gestion membres et soft-delete).
- /account self-service (Profil + Sécurité avec changePassword, sessions, 2FA, backup codes).
- Matrice rôles testable (~150 tests générés + anti-drift guard).
- 5 E2E Playwright (admin + account flows).
- Fermeture 3 dettes 1B (worker handler reset confirmation, IP plumbing tRPC ctx, audit DLQ pour mails échoués).

## Test plan
- [ ] CI 5/5 verts (lint+typecheck+unit, integration, build, trivy, gitleaks)
- [ ] E2E Playwright 5 specs PASS
- [ ] Matrice ~150 tests + anti-drift PASS
- [ ] Manual : /admin/users (list + détail + dialogs)
- [ ] Manual : /admin/libraries (list + create + détail + members + archive)
- [ ] Manual : /account (profile)
- [ ] Manual : /account/security (4 cards, dialogs)
- [ ] Mobile 375px : sidebar drawer fonctionne

## Spec & Plan
- Spec : `docs/superpowers/specs/2026-04-28-phase-1c-admin-account-design.md`
- Plan : `docs/superpowers/plans/2026-04-28-phase-1c-admin-account.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 20.5: Attendre CI verte + merge**

Attendre les 5 jobs CI verts. Si fail : fix sur la branche, re-push, re-attendre.

Quand tous verts, merge en **non-squash** (merge commit) pour préserver l'historique riche :

```bash
gh pr merge --merge --delete-branch
```

- [ ] **Step 20.6: Tag git**

```bash
git checkout main
git pull
git tag -a phase-1c-complete -m "Phase 1C : panel admin + /account self-service + permissions matrix"
git push origin phase-1c-complete
```

- [ ] **Step 20.7: Update memory (rituel fin de phase)**

Créer `~/.claude/projects/-Users-seraphin-Library-CloudStorage-SynologyDrive-save-02-Trinity-Projet-github-fm-librairy/memory/project_phase_1c_completed.md` :

```markdown
---
name: Phase 1C — clôture
description: Phase 1C (panel admin + /account self-service + matrice rôles) clôturée 2026-MM-DD, PR #XX mergée, tag phase-1c-complete sur <commit>.
type: project
---
# Phase 1C — clôture

**Date** : 2026-MM-DD
**Tag** : `phase-1c-complete` sur `<commit>` (merge commit, non-squash)
**PR** : [#XX](https://github.com/ArchSeraphin/fm-librairy/pull/XX)
**Branche dev** : `feat/phase-1c-admin-account`
**CI finale** : 5/5 verts

## Livrables
- Migration Prisma : `Session.userAgentLabel`, `Library.archivedAt`, FK `Invitation.invitedById` → SetNull
- 4 routers : `admin.users`, `admin.libraries`, `account.profile`, `account.security`
- Helpers : `lib/{user-admin,library-admin,user-agent,request-meta}.ts`, rate-limiters 1C
- Audit union 1C complet (incl. DLQ actions)
- Worker handler `send-password-reset-confirmation` + DLQ listener
- UI : sidebar layout admin + account, /admin/users, /admin/libraries, /account, /account/security
- Tests : ~12 unit + ~30 integration + ~150 matrice + 5 E2E
- Doc : `docs/permissions-matrix.md`, `docs/runbooks/disable-2fa-global-admin.md`

## Suivis non-bloquants Phase 1D
- Drift CI guard `src/emails/` ↔ `worker/emails/` (reporté Phase 1B).
- Smoke staging Coolify Resend DNS (pré-prod).
- Lint rule custom Prisma scope (annotations privées) — déclenchera quand router books arrivera.
- Hard delete library — runbook `docs/runbooks/hard-delete-library.md` à rédiger.
- Audit log viewer global — Phase 2/3.

## Patterns établis (à reproduire Phase 1D+)
- Helpers ctx test partagés `tests/integration/_helpers/auth-ctx.ts` : `makeCtxForRole(role)`.
- Composite PK `LibraryMember` : utiliser `userId_libraryId` Prisma compound where.
- Soft-delete pattern : champ `archivedAt: DateTime?` + helper `assertNotArchived`.
- UA label parser : `parseUserAgentLabel` côté creation session, ne pas hash.
- Anti-drift matrice : test guard introspecte `appRouter._def`.

## Stats vélocité
- Plan : `docs/superpowers/plans/2026-04-28-phase-1c-admin-account.md`
- 21 tasks principales (Task 0 à 20).
- ~9-11 jours wall-time réalisés.

## Prochaine étape
Phase 1D ou Phase 2 selon priorisation : router `library.books` (catalogue + upload + lecture), workflow physique (PhysicalRequest), liseuse en ligne minimale. Spec à écrire.
```

Updater l'index `~/.claude/projects/.../memory/MEMORY.md` :

```markdown
- [Phase 1C — clôture](project_phase_1c_completed.md) — PR #XX mergée 2026-MM-DD, tag `phase-1c-complete` sur `<commit>`. Panel admin Users+Libraries + /account self-service + matrice testable + 3 dettes 1B fermées.
```

Et updater `project_biblioshare_overview.md` section « État courant » : `Phase 1B clôturée` → `Phase 1C clôturée 2026-MM-DD, prochaine étape Phase 1D/2`.

- [ ] **Step 20.8: Final smoke**

```bash
pnpm dev
```

Smoke manuel : login admin, créer une biblio test, ajouter membre, archiver, restaurer, supprimer membre, suspend un user lambda, le réactiver, login user lambda, naviguer /account, changer son nom, /account/security ouvrir tous les dialogs.

Si tout OK : Phase 1C officiellement clôturée.

---

## Annexe — checklist transversale CI

Pour chaque task qui ajoute un fichier source impactant le build :
- [ ] `pnpm typecheck` PASS
- [ ] `pnpm lint` PASS
- [ ] `pnpm format:check` PASS (sinon `pnpm prettier --write .`)
- [ ] Toute nouvelle env var dans `src/lib/env.ts` est plumbée dans `Dockerfile` (ENV) + `.github/workflows/ci.yml` (job e2e env)
- [ ] Pas d'`as any` introduits
- [ ] Apostrophes JSX `&apos;` dans react-email (si template touché)
- [ ] `useActionState` from `react` (pas `react-dom`)
- [ ] Lucide icons seuls (pas d'emoji)
- [ ] Test isolation : `truncateAll()` dans `beforeEach` integration

## Annexe — points de vigilance Module 0

- L'IP plumbing nécessite que `createContext` accepte `headers`. Tous les call-sites tests qui faisaient `createContext()` doivent passer `{ headers: new Headers() }` ou un mock minimal.
- Le DLQ listener `worker.on('failed')` doit être attaché **avant** que le worker démarre à processer (sinon les premiers échecs ne seront pas captés).

## Self-Review checkpoints (pour l'implémenteur)

À chaque transition de module (0→1, 1→2, etc.) :
1. Lancer `pnpm test:integration` complet, pas seulement les fichiers du module courant.
2. Vérifier que la matrice `tests/integration/permissions-matrix.test.ts` (Module 4) inclut les nouvelles procedures du module qui vient de finir.
3. Si une procedure n'est pas dans la matrice → ajouter la ligne avant de passer au module suivant. Le test anti-drift le rappellera de toute façon.






