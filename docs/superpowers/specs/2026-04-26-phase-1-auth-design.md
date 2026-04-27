# Design — Phase 1 : Auth, 2FA, invitations, rôles

**Date** : 2026-04-26
**Statut** : Validé (pending user review)
**Réfère à** : `docs/superpowers/specs/2026-04-25-biblioshare-design.md` §5.3 Phase 1, ADR 0003

---

## 1. Vue d'ensemble & sous-phasage

Cette phase livre un système d'authentification multi-utilisateurs avec 2FA TOTP, invitations cryptographiques, reset password, sessions DB, rate limiting, et permissions à 3 couches branchées sur AuditLog. Elle implémente les risques A1-A8, B1, B3, et la partie auth de H3 du modèle de risque (Annexe A du design global).

**Critère de fin de Phase 1** (issu du design global) : _« flux invitation → création → 2FA → login fonctionnel ; toutes tentatives non autorisées renvoient 403 + AuditLog »_.

Phase 1 étant cotée `L`, elle est découpée en trois sous-phases livrables indépendamment, dans l'ordre suivant :

### 1A — Bootstrap, login, 2FA, permissions de base

Le compte Admin global existe et est protégé. Aucun autre user ne peut entrer.

- Migrations DB (`Session`, `AuditLog` nullables, ajouts `User`).
- Auth.js v5 + Credentials provider + Prisma adapter custom.
- Pattern 2FA two-step (cookie `pending2fa` 5 min → upgrade session full).
- Modules `lib/{crypto,tokens,password,totp,rate-limit,audit-log,permissions}.ts`.
- Middleware Next : enforcement auth + forçage 2FA Admin global après 7j.
- CLI `pnpm bootstrap:admin` (idempotent, lit env).
- AuditLog branché sur tous events `auth.*` Phase 1A + `permission.denied`.
- UI : `/login`, `/login/2fa`, `/login/2fa/backup`, `/2fa/setup`, `/2fa/setup/recovery-codes`, placeholder `/admin`.
- Tests : unit ≥ 90 % sur modules ; integration sur procedures auth ; 5 scénarios E2E ; 8 attack tests dédiés.

**Critère de sortie 1A** : un Admin global créé via CLI peut se logger en MdP+TOTP, accéder à `/admin` (placeholder), tout autre user n'a aucun accès. Smoke test Coolify staging vert.

### 1B — Invitations & reset password

Le système s'ouvre à d'autres utilisateurs.

- Service `lib/invitations.ts` : token 32 octets, hash, expiration 72h, single-use.
- Service `lib/password-reset.ts` : token 32 octets, expiration 1h.
- Worker BullMQ queue `mail` + abstraction `lib/email.ts` (Resend par défaut, fallback SMTP).
- Templates email : invitation, reset password.
- Procedures tRPC : `invitation.create`, `invitation.consume`, `password.requestReset`, `password.consumeReset`.
- UI : `/invitations/[token]`, `/password/forgot`, `/password/reset/[token]`.
- Rate limiters branchés (`resetRequestLimiter`, `invitationLimiter`).
- AuditLog : events `auth.invitation.*` et `auth.password.*`.
- Attack tests : replay magic link, replay reset token, énumération via timing reset, expirations.

**Critère de sortie 1B** : un Admin biblio invite un user, l'invité crée son compte, configure son 2FA (optionnel pour rôle ≠ Admin global), se connecte. Reset password fonctionne sans révéler l'existence d'un email.

### 1C — Panel Admin & matrice de permissions complète

Toutes les cellules de la matrice ADR 0003 §4.2 implémentées et testées.

- Procedures tRPC complètes : suspension/réactivation/suppression/changement de rôle user, création biblio, modification rôles biblio, flags `canRead/canUpload/canDownload`.
- UI `/account/security` : liste sessions, révocation, regen recovery codes, désactivation 2FA (re-auth requise), changement MdP.
- UI panel Admin : `/admin`, `/admin/users`, `/admin/invitations`, `/admin/audit-log`.
- Tests E2E couvrant la matrice rôles ligne par ligne (happy + unauthorized).

**Critère de sortie 1C = critère Phase 1 du design global**. Tag git `phase-1-complete` sur le commit qui clôture 1C.

---

## 2. Schéma de base de données

Migration `prisma/migrations/002_phase1_auth/` à créer en début de 1A.

### 2.1 Modifications de modèles existants

**`Invitation`** — retire `@unique` sur `consumedById` (un user existant doit pouvoir accepter plusieurs invitations dans le temps), ajoute index :

```prisma
model Invitation {
  // ... champs existants inchangés ...
  consumedById  String?      // @unique RETIRÉ
  consumedBy    User?        @relation("ConsumedBy", fields: [consumedById], references: [id])

  @@index([email])
  @@index([consumedById])    // ajouté
  @@index([expiresAt])       // ajouté pour cleanup job
}
```

**`AuditLog`** — `targetType` et `targetId` deviennent nullable (events comme `auth.login.failure` n'ont pas de target), ajoute `userAgent` et un index sur `action` :

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

**`User`** — ajoute compteurs lockout (mitigation A1 phase longue) :

```prisma
model User {
  // ... champs existants inchangés ...
  failedLoginAttempts Int       @default(0)
  lockedUntil         DateTime?
}
```

### 2.2 Modèles nouveaux

**`Session`** — table standard Auth.js v5 enrichie pour le pattern two-step et le hardening :

```prisma
model Session {
  id               String   @id @default(cuid())
  sessionToken     String   @unique
  userId           String
  user             User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt        DateTime
  lastActivityAt   DateTime @default(now())
  ipHash           String
  userAgentHash    String
  pending2fa       Boolean  @default(false)
  createdAt        DateTime @default(now())

  @@index([userId])
  @@index([expiresAt])
}
```

`sessionToken` : 32 octets `crypto.randomBytes` base64url. `pending2fa` : marqueur du pattern two-step (cf. §4.5). `ipHash`/`userAgentHash` : fingerprint pour mitigation A3, hashés avec sels rotatifs 30j.

**`VerificationToken`** — table standard Auth.js, conservée même si non utilisée en 1A (extension future) :

```prisma
model VerificationToken {
  identifier String
  tokenHash  String   @unique
  expiresAt  DateTime

  @@id([identifier, tokenHash])
}
```

### 2.3 Pas de seed Prisma

Le bootstrap admin se fait via CLI `pnpm bootstrap:admin` (cf. §6.2). Aucun seed automatique n'est branché en Phase 1.

---

## 3. Arborescence des modules

Organisation cible côté `src/` après Phase 1, en respectant les conventions Phase 0.

### 3.1 Structure

```
src/
├── app/
│   ├── (auth)/                          # group route, layout d'auth dédié
│   │   ├── login/
│   │   │   ├── page.tsx                 # 1A
│   │   │   └── 2fa/
│   │   │       ├── page.tsx             # 1A
│   │   │       └── backup/page.tsx      # 1A
│   │   ├── 2fa/setup/
│   │   │   ├── page.tsx                 # 1A
│   │   │   └── recovery-codes/page.tsx  # 1A
│   │   ├── invitations/[token]/page.tsx # 1B
│   │   ├── password/
│   │   │   ├── forgot/page.tsx          # 1B
│   │   │   └── reset/[token]/page.tsx   # 1B
│   │   └── layout.tsx
│   │
│   ├── account/security/page.tsx        # 1C
│   │
│   ├── admin/
│   │   ├── page.tsx                     # 1A placeholder, 1C dashboard
│   │   ├── users/page.tsx               # 1C
│   │   ├── invitations/page.tsx         # 1C
│   │   ├── audit-log/page.tsx           # 1C
│   │   └── layout.tsx
│   │
│   ├── api/auth/[...nextauth]/route.ts  # 1A
│   ├── layout.tsx                       # existant
│   └── page.tsx                         # existant
│
├── server/                              # nouveau dossier (Phase 1)
│   ├── trpc/
│   │   ├── trpc.ts                      # init tRPC + procedures wrappers
│   │   ├── context.ts
│   │   ├── procedures.ts
│   │   └── routers/
│   │       ├── _app.ts
│   │       ├── auth.ts                  # 1A + 1B
│   │       └── admin.ts                 # 1C
│   └── auth/
│       ├── config.ts                    # Auth.js v5 NextAuthConfig
│       ├── adapter.ts                   # Prisma adapter custom
│       └── credentials-provider.ts      # étape 1 du two-step
│
├── lib/
│   ├── (existants : db, env, logger, meili, redis, security-headers, utils, private-scope)
│   ├── crypto.ts                        # 1A — AES-256-GCM, HMAC, hash IP/UA salés
│   ├── tokens.ts                        # 1A — gen 32 octets, hash argon2, verify
│   ├── password.ts                      # 1A — wrapper @node-rs/argon2 (params 19MB/2/1)
│   ├── totp.ts                          # 1A — wrap otplib + backup codes
│   ├── rate-limit.ts                    # 1A — 4 limiteurs (login, 2fa, reset, invitation)
│   ├── audit-log.ts                     # 1A — service writer typed
│   ├── permissions.ts                   # 1A — assertCan*, requirePermission
│   ├── invitations.ts                   # 1B
│   ├── password-reset.ts                # 1B
│   └── email.ts                         # 1B — abstraction Resend + SMTP fallback
│
├── components/
│   ├── (existants shadcn/ui)
│   ├── auth/                            # 1A + 1B
│   └── admin/                           # 1C
│
├── middleware.ts                        # 1A — enforcement auth + 2FA forcé
│
├── hooks/                               # existant
└── i18n/messages/fr/
    └── auth.json                        # 1A — labels, errors, banners

scripts/
└── bootstrap-admin.ts                   # 1A
```

### 3.2 Décisions notables

1. **Dossier `server/` distinct de `lib/`** — `lib/` reste pur (testable sans DB ni framework), `server/` contient tRPC/Auth.js (deps Next/Prisma/req/res). Cette séparation est essentielle pour la maintenabilité des unit tests.
2. **Adapter Auth.js custom** plutôt que `@auth/prisma-adapter` officiel — on a besoin de `pending2fa` sur Session, de hash IP/UA fingerprint, et d'une création explicite incompatible avec l'adapter standard. Le custom adapter est ~80 lignes, on le maintient.
3. **`lib/audit-log.ts` typed** — `AuditAction` est une union string TS exhaustive, exporte `recordAudit({ action, actor, target?, metadata?, req })`. Toute écriture passe par cette fonction (pas de `prisma.auditLog.create` direct, vérifié par lint rule).
4. **`scripts/bootstrap-admin.ts`** plutôt que `prisma/seed.ts` — un seed est destiné aux dev/staging, le bootstrap est destiné à la prod et doit être idempotent et refuser si déjà fait.
5. **Pas de tRPC pour le login lui-même** — Auth.js gère `/api/auth/*`, et le formulaire login utilise un Server Action ou la route Auth.js native. tRPC sert pour les actions post-auth (`verify2FA`, `enroll2FA`, etc.).

---

## 4. Auth.js v5 + flow 2FA two-step

Cœur technique de la Phase 1.

### 4.1 Configuration Auth.js

```ts
// src/server/auth/config.ts
export const authConfig: NextAuthConfig = {
  adapter: PrismaSessionAdapter(prisma),
  session: { strategy: 'database' },
  pages: { signIn: '/login', error: '/login' },
  cookies: {
    sessionToken: {
      name: 'biblioshare.session',
      options: {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
      },
    },
  },
  callbacks: { session: attachContext },
  events: {
    signIn: ({ user }) => recordAudit({ action: 'auth.login.success', actor: { id: user.id } }),
    signOut: ({ session }) =>
      recordAudit({ action: 'auth.session.revoked', actor: { id: session.userId } }),
  },
  providers: [credentialsProvider],
};
```

`session.strategy = "database"` est impératif pour rotation/révocation/inactivité 7j (mitigation A3, A7).

### 4.2 Adapter Prisma custom

Différences vs `@auth/prisma-adapter` officiel :

- **Création de session** : pose `pending2fa = true` si l'utilisateur a `twoFactorEnabled = true`.
- **Pose fingerprint** `ipHash` + `userAgentHash` à la création.
- **Lecture session** : si `expiresAt < now` OU `now - lastActivityAt > 7d` → supprime + retourne null.
- **Touch session** : update `lastActivityAt` à chaque getSession (debounce 60 s en mémoire pour éviter writes excessifs).
- **`generateSessionToken`** : 32 octets `crypto.randomBytes` base64url.
- Méthodes `createUser`/`updateUser`/`linkAccount` : stubs vides (Auth.js tolère avec credentials provider, on n'utilise ni magic-link login ni OAuth).

### 4.3 Credentials provider — étape 1 du two-step

```ts
// src/server/auth/credentials-provider.ts
authorize: async (creds, req) => {
  const { email, password } = parseCreds(creds);
  const ipHash = hashIp(getIp(req));

  await loginLimiter.consume(`${ipHash}:${email.toLowerCase()}`);

  const user = await prisma.user.findUnique({ where: { email } });
  await constantTimeDelay(150); // mitigation A2

  if (!user || user.status !== 'ACTIVE') {
    await recordAudit({
      action: 'auth.login.failure',
      target: { type: 'EMAIL', id: hashEmail(email) },
      metadata: { reason: 'unknown_or_suspended' },
    });
    return null;
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await recordAudit({ action: 'auth.login.locked', actor: { id: user.id } });
    return null;
  }

  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) {
    await incrementFailedAttempts(user.id); // 20 → lockedUntil = now + 1h
    await recordAudit({
      action: 'auth.login.failure',
      actor: { id: user.id },
      metadata: { reason: 'bad_password' },
    });
    return null;
  }

  await resetFailedAttempts(user.id);
  return { id: user.id, email: user.email, name: user.displayName };
};
```

Garanties : timing uniforme user-existe vs user-inconnu (A2), échecs comptés en DB pour lockout long (A1), rate limit Redis pour lockout court (A1), AuditLog systématique.

### 4.4 Étape 2 — vérification 2FA (procedure tRPC)

```ts
// src/server/trpc/routers/auth.ts
verify2FA: pendingProcedure
  .input(z.object({ code: z.string().regex(/^\d{6}$/) }))
  .mutation(async ({ ctx, input }) => {
    await twoFactorLimiter.consume(ctx.session.id);

    const ok = await verifyTotp(ctx.session.userId, input.code);
    if (!ok) {
      await recordAudit({
        action: 'auth.2fa.failure',
        actor: { id: ctx.session.userId },
        metadata: { method: 'totp' },
      });
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Code invalide' });
    }

    // Upgrade session (regen ID = mitigation A7)
    const newToken = generateSessionToken();
    await prisma.$transaction([
      prisma.session.delete({ where: { id: ctx.session.id } }),
      prisma.session.create({
        data: {
          sessionToken: newToken,
          userId: ctx.session.userId,
          expiresAt: addDays(new Date(), 30),
          ipHash: ctx.session.ipHash,
          userAgentHash: ctx.session.userAgentHash,
          pending2fa: false,
        },
      }),
    ]);
    setSessionCookie(ctx.res, newToken);

    await recordAudit({ action: 'auth.2fa.success', actor: { id: ctx.session.userId } });
    await prisma.user.update({
      where: { id: ctx.session.userId },
      data: { lastLoginAt: new Date() },
    });
    return { ok: true };
  });
```

`verifyBackupCode` est symétrique : compare argon2 contre les 8 hashes en DB, retire le code consommé à succès, log `auth.2fa.backup_code_used`.

### 4.5 États de session — state machine

| État              | `pending2fa` | Routes/procedures autorisées                                                                       |
| ----------------- | ------------ | -------------------------------------------------------------------------------------------------- |
| **none**          | —            | Routes publiques, `/login`, `/api/auth/*`, `/invitations/[token]`, `/password/*` (1B+)             |
| **pending**       | `true`       | `/login/2fa`, `/login/2fa/backup`, `/logout`, procedures `auth.verify2FA`, `auth.verifyBackupCode` |
| **authenticated** | `false`      | Tout ce que les permissions du user autorisent                                                     |

Enforcement :

- Middleware Next : redirect `/login/2fa` si pending sur URL non allowlistée.
- tRPC `pendingProcedure` n'accepte que pending=true ; `authedProcedure` n'accepte que pending=false.

### 4.6 Désactivation 2FA — re-auth obligatoire (mitigation A5)

`auth.disable2FA` exige password + code TOTP courant simultanément. À succès : supprime `TwoFactorSecret`, met `User.twoFactorEnabled = false`, log `auth.2fa.disabled`. **Refus inconditionnel pour les Admin global** — il faut d'abord rétrograder (et seul un autre Admin global peut le faire, ADR 0003).

### 4.7 Forçage 2FA Admin global après 7j

Dans `middleware.ts` :

```ts
const elapsed = Date.now() - user.createdAt.getTime();
const SEVEN_DAYS = 7 * 24 * 3600 * 1000;
if (user.role === 'GLOBAL_ADMIN' && !user.twoFactorEnabled && elapsed > SEVEN_DAYS) {
  if (!isAllowlistPath(req.nextUrl.pathname)) {
    return NextResponse.redirect(new URL('/2fa/setup', req.url));
  }
}
```

Allowlist : `/2fa/setup`, `/2fa/setup/recovery-codes`, `/api/auth/*`, `/logout`. La banner UI affiche un countdown si `elapsed < 7d`. Double-rideau côté tRPC : `globalAdminProcedure` rejette aussi.

---

## 5. Permissions 3 couches + AuditLog

Implémentation de l'ADR 0003 — defense in depth pour empêcher qu'un oubli à une couche n'expose des données.

### 5.1 Couche 1 — middlewares tRPC

```ts
// src/server/trpc/procedures.ts
export const publicProcedure = t.procedure;

export const authedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.session || ctx.session.pending2fa) throw new TRPCError({ code: 'UNAUTHORIZED' });
  return next({ ctx: { ...ctx, session: ctx.session, user: ctx.user! } });
});

export const pendingProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.session || !ctx.session.pending2fa) throw new TRPCError({ code: 'FORBIDDEN' });
  return next({ ctx });
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
  // Double-rideau forçage 2FA (cf. §4.7) — cohérent avec le middleware Next
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

**Lint rule custom à ajouter dans `eslint-rules/`** :

- `no-bare-trpc-procedure` : refuse `t.procedure.query/.mutation` sans wrapper d'auth (sauf allowlist : `/api/auth/*`, procedures `health`).
- `no-direct-audit-write` : refuse `prisma.auditLog.create` direct, force le passage par `recordAudit`.

### 5.2 Couche 2 — services `assertCan*`

```ts
// src/lib/permissions.ts
export async function assertCanInviteToLibrary(actor: User, libraryId: string) {
  if (actor.role === 'GLOBAL_ADMIN') return;
  const member = await prisma.libraryMember.findUnique({
    where: { userId_libraryId: { userId: actor.id, libraryId } },
  });
  if (!member || member.role !== 'LIBRARY_ADMIN') {
    await recordAudit({
      action: 'permission.denied',
      actor: { id: actor.id },
      target: { type: 'LIBRARY', id: libraryId },
      metadata: { perm: 'invite' },
    });
    throw new PermissionError('invite_to_library');
  }
}
// + un assertCan* par cellule de la matrice ADR 0003 §4.2
```

Règle : tout service métier qui change un état persistant **commence** par un `assertCan*`. Aucune logique de permission dans les routers — uniquement délégation.

### 5.3 Couche 3 — Prisma scope obligatoire

Lint rule custom (déjà présente depuis Phase 0, à vérifier en 1A) interdisant `findMany`/`findFirst` sans `where` sur les modèles scopés. Pour les annotations privées, le type Brand `PrivateScope` (déjà dans `lib/private-scope.ts`) sera branché concrètement en Phase 3.

### 5.4 AuditLog — service writer typé

```ts
// src/lib/audit-log.ts
export type AuditAction =
  // 1A
  | 'auth.login.success'
  | 'auth.login.failure'
  | 'auth.login.locked'
  | 'auth.session.created'
  | 'auth.session.revoked'
  | 'auth.session.expired'
  | 'auth.2fa.enrolled'
  | 'auth.2fa.disabled'
  | 'auth.2fa.success'
  | 'auth.2fa.failure'
  | 'auth.2fa.backup_code_used'
  | 'auth.2fa.recovery_codes_regenerated'
  | 'permission.denied'
  // 1B
  | 'auth.password.reset_requested'
  | 'auth.password.reset_consumed'
  | 'auth.password.changed'
  | 'auth.invitation.created'
  | 'auth.invitation.consumed'
  | 'auth.invitation.expired'
  | 'auth.invitation.revoked'
  // 1C
  | 'admin.user.suspended'
  | 'admin.user.reactivated'
  | 'admin.user.deleted'
  | 'admin.user.role_changed';

export type AuditTargetType = 'USER' | 'LIBRARY' | 'INVITATION' | 'SESSION' | 'EMAIL' | 'AUTH';

export async function recordAudit(input: {
  action: AuditAction;
  actor?: { id: string };
  target?: { type: AuditTargetType; id: string };
  metadata?: Record<string, unknown>;
  req?: { ip?: string; userAgent?: string };
}): Promise<void>;
```

Garanties :

- Hash IP+UA avec sels rotatifs (`lib/crypto.ts`).
- **Insertion non bloquante par défaut** (fire-and-forget avec `await`, erreur loggée pino, jamais propagée — un fail audit ne casse pas l'action user).
- **Exception synchrone bloquante** : `permission.denied` et `auth.2fa.failure` — si l'écriture échoue, on renvoie 503 (pas de zone aveugle sur les tentatives).
- Lint rule : interdit `prisma.auditLog.create` direct, force le passage par `recordAudit`.

### 5.5 Cleanup jobs (BullMQ, worker existant)

| Job                        | Cadence   | Action                                                                                                                            |
| -------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `cleanup-expired-sessions` | toutes 1h | Supprime `Session` où `expiresAt < now` ou `lastActivityAt < now - 7d`                                                            |
| `cleanup-expired-tokens`   | toutes 1h | Supprime `Invitation` et `PasswordResetToken` expirés ; log `auth.invitation.expired` pour chaque invitation expirée non consumée |
| `rotate-hash-salts`        | mensuel   | Phase 1A : warning si TTL > 30j. Implémentation rotation = Phase 8.                                                               |

---

## 6. Rate limiting + bootstrap admin CLI

### 6.1 Rate limiters

`src/lib/rate-limit.ts`. Backend Redis (déjà présent depuis Phase 0). Lib : `rate-limiter-flexible`.

```ts
import { RateLimiterRedis, RateLimiterMemory } from 'rate-limiter-flexible';
import { redis } from './redis';

// Insurance fallback : si Redis tombe, on continue à limiter en mémoire locale.
// Évite le mode "fail open" (laisser tout passer en cas de panne = trou de sécu).
const memInsurance = (points: number, duration: number) =>
  new RateLimiterMemory({ points, duration });

const baseOpts = { storeClient: redis, useRedisPackage: true };

export const loginLimiter = new RateLimiterRedis({
  ...baseOpts,
  keyPrefix: 'rl:login',
  points: 5,
  duration: 15 * 60,
  blockDuration: 60 * 60,
  insuranceLimiter: memInsurance(5, 15 * 60),
});

export const twoFactorLimiter = new RateLimiterRedis({
  ...baseOpts,
  keyPrefix: 'rl:2fa',
  points: 5,
  duration: 5 * 60,
  blockDuration: 15 * 60,
  insuranceLimiter: memInsurance(5, 5 * 60),
});

export const resetRequestLimiter = new RateLimiterRedis({
  ...baseOpts,
  keyPrefix: 'rl:reset',
  points: 3,
  duration: 60 * 60,
  insuranceLimiter: memInsurance(3, 60 * 60),
});

export const invitationLimiter = new RateLimiterRedis({
  ...baseOpts,
  keyPrefix: 'rl:invite',
  points: 10,
  duration: 60 * 60,
  insuranceLimiter: memInsurance(10, 60 * 60),
});
```

**Stratégie de clé** :

| Limiteur   | Clé                                | Raison                                                    |
| ---------- | ---------------------------------- | --------------------------------------------------------- |
| login      | `${ipHash}:${email.toLowerCase()}` | Bruteforce d'un compte ET d'une IP qui scanne des emails  |
| 2fa        | `${sessionId}`                     | Session pending unique par tentative, lié à l'utilisateur |
| reset      | `${email.toLowerCase()}`           | Réponse uniforme 200 toujours, quota silencieux           |
| invitation | `${userId}`                        | Compte propre à l'inviteur, indépendant de l'IP           |

**Comportement quota atteint** :

- login : `auth.login.locked` audit, retour `null` dans `authorize` (= échec uniforme).
- 2fa : 429 dans la procedure tRPC, message générique.
- reset : `auth.password.reset_requested` toujours loggué avec metadata `rate_limited: true`, **réponse HTTP 200 toujours** (mitigation A2).
- invitation : 429 explicite à l'admin (acceptable, user authentifié).

**Échec Redis (panne)** : `RateLimiterRedis.insuranceLimiter` configuré avec un `RateLimiterMemory` fallback strict (mêmes points, mémoire locale par instance Next). Évite le mode "fail open".

### 6.2 Bootstrap admin — CLI

`scripts/bootstrap-admin.ts`, exécuté via `pnpm bootstrap:admin`.

**Comportement** :

- **Idempotent par défaut** : refuse si un GLOBAL_ADMIN existe.
- **`--force` = mode récupération** : promeut un user existant (par email) ; ne crée pas. Trace dans AuditLog avec `metadata.source = "bootstrap_force"`.
- Mot de passe **affiché une seule fois** dans stdout. Loggé pino avec `redact` actif.
- Pas de log fichier du password.

**Variables d'env** :

- `BOOTSTRAP_ADMIN_EMAIL` (requis)
- `BOOTSTRAP_ADMIN_PASSWORD` (optionnel, généré aléatoire 24 chars si absent)
- `BOOTSTRAP_ADMIN_NAME` (optionnel, défaut `"Admin"`)

**`package.json`** :

```json
"scripts": {
  "bootstrap:admin": "tsx scripts/bootstrap-admin.ts"
}
```

**`docs/deployment.md` — section ajoutée** :

```bash
# Une seule fois après le premier déploiement Coolify
docker exec -it biblioshare-app sh -c \
  "BOOTSTRAP_ADMIN_EMAIL=ops@example.com pnpm bootstrap:admin"

# Mode récupération si l'unique admin a perdu son 2FA
docker exec -it biblioshare-app sh -c \
  "BOOTSTRAP_ADMIN_EMAIL=other@example.com pnpm bootstrap:admin --force"
```

---

## 7. Inventaire UX — routes et flows

Aucun mockup dans ce document. Les wireframes sont produits en début de chaque sous-phase via `frontend-design` (ou `ui-ux-pro-max`), s'appuyant sur le design system Phase 0.

### 7.1 Sous-phase 1A — pages auth de base

| Route                       | Sujet             | Contenu informationnel                                                  | Sortie                         |
| --------------------------- | ----------------- | ----------------------------------------------------------------------- | ------------------------------ |
| `/login`                    | Login étape 1     | Email + password + lien « Mot de passe oublié ? » (1B)                  | OK→`/login/2fa` ou `/`         |
| `/login/2fa`                | Challenge TOTP    | Champ 6 chiffres, lien « Utiliser un code de secours »                  | OK→`/`                         |
| `/login/2fa/backup`         | Code de secours   | Champ alphanumérique, warning « ce code sera invalidé »                 | OK→`/`                         |
| `/2fa/setup`                | Enrolment         | QR code + champ confirmation + secret en texte (fallback)               | OK→`/2fa/setup/recovery-codes` |
| `/2fa/setup/recovery-codes` | 8 codes           | Liste copiable + bouton télécharger .txt + checkbox « j'ai sauvegardé » | OK→`/`                         |
| `/admin` (placeholder)      | Page Admin global | Stub minimal en 1A — « Bienvenue ». Étoffé en 1C.                       | —                              |
| `/logout`                   | Déconnexion       | Server Action POST, supprime session, redirect `/login`                 | →`/login`                      |

**Transitions enforcement** :

- Pas de session → `/login`
- Session pending2fa → `/login/2fa` (sauf si déjà sur la page)
- Session full + Admin global + pas de 2FA + > 7j → `/2fa/setup`
- Session full + Admin global + pas de 2FA + ≤ 7j → banner countdown sur toutes les pages

### 7.2 Sous-phase 1B — invitations & reset

| Route                     | Sujet              | Contenu informationnel                                                               | Sortie                 |
| ------------------------- | ------------------ | ------------------------------------------------------------------------------------ | ---------------------- |
| `/invitations/[token]`    | Création de compte | Email pré-rempli read-only + champs displayName/password/confirm. Texte invitation.  | OK→`/2fa/setup` ou `/` |
| `/password/forgot`        | Demande reset      | Champ email + bouton. Réponse uniforme « Si l'email existe, vous recevrez un lien. » | →message statique      |
| `/password/reset/[token]` | Saisie nouveau MdP | Champs new+confirm avec règles (12 chars min, classes mixtes ou passphrase).         | OK→`/login`            |

**Cas d'erreur explicites** :

- Token invitation expiré/consommé → page « Lien expiré ou déjà utilisé. Demandez à l'inviteur. »
- Token reset expiré/consommé → idem.
- Pas de leak d'info sur `/password/forgot`.

### 7.3 Sous-phase 1C — panel Admin & gestion compte

| Route                | Sujet                                                                                |
| -------------------- | ------------------------------------------------------------------------------------ |
| `/account/security`  | Liste sessions actives (révoquer), regen recovery codes, désactiver 2FA, changer MdP |
| `/admin`             | Dashboard : nb users, nb invitations actives, derniers events audit                  |
| `/admin/users`       | Table users : suspendre/réactiver/supprimer/changer rôle, créer invitation directe   |
| `/admin/invitations` | Table invitations : revoke, voir statut, renvoyer email                              |
| `/admin/audit-log`   | Table paginée filtrable par action/actor/target/date                                 |

### 7.4 Conventions UI Phase 1

- **Aucun emoji** (mémoire feedback). Icônes Lucide exclusivement (déjà installé).
- **Pas de placeholder lorem ipsum** : copies finales fixées dans `i18n/messages/fr/auth.json`.
- **Réponses HTTP uniformes** : 401/403/404 sans détails côté prod (B5 risk map). Stack traces uniquement en logs serveur.
- **Server Actions** pour mutations sans retour structuré (login, logout, request reset, consume reset, accept invitation). **tRPC** pour celles avec retour typé (verify 2FA, list sessions, admin actions).
- **CSRF** : Server Actions natifs Next 15 + double-submit cookie pour endpoints sensibles non-Server-Action. Token CSRF lié à la session.

---

## 8. Stratégie de tests

TDD obligatoire (ADR + conventions Phase 0).

### 8.1 Pyramide

| Niveau          | Outil                                                                           | Cible                                                                | Coverage cible       |
| --------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------- |
| **Unit**        | Vitest                                                                          | Modules `src/lib/*` purs (pas de DB, pas de Next)                    | ≥ 90 %               |
| **Integration** | Vitest + testcontainers (`@testcontainers/postgresql`, `@testcontainers/redis`) | Procedures tRPC, middlewares, Auth.js, AuditLog, rate limiters réels | ≥ 80 %               |
| **E2E**         | Playwright                                                                      | Flux utilisateur de bout en bout                                     | scénarios listés 8.4 |

**Setup testcontainers** : `tests/setup/containers.ts` démarre PG + Redis isolés par worker Vitest. Migrations Prisma rejouées par worker. Cleanup truncate entre tests. Pas de mocks Prisma — la matrice de permissions doit être testée contre la vraie DB.

### 8.2 Modules unit-testés (Phase 1A)

| Module               | Tests clés                                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `lib/crypto.ts`      | AES-256-GCM round-trip, HMAC déterministe, hash IP avec sel constant déterministe, hash IP différent entre deux sels    |
| `lib/tokens.ts`      | Génération 32 octets random unique sur 10k itérations, hash argon2 vérifie correctement, token tampered rejette         |
| `lib/password.ts`    | Hash argon2id avec params spec (19 MB / 2 / 1), verify pass valide, verify fail sur tamper                              |
| `lib/totp.ts`        | Gen secret 20 octets, verify code valide ±1 step, code expiré refusé, backup codes : gen 8, hash, verify retire le code |
| `lib/rate-limit.ts`  | Sliding window correct, lockout après 20, fallback memory en panne Redis, clé composite IP+email                        |
| `lib/audit-log.ts`   | Action typée enforcée, redact metadata sensibles (password, secret, token), hash IP avec sel courant                    |
| `lib/permissions.ts` | `assertCan*` pour chaque cellule de la matrice §4.2 ADR 0003 Phase 1A (auth+invitations only)                           |

### 8.3 Tests d'intégration (Phase 1A)

| Cible                                | Test                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `auth.login` (Credentials authorize) | Happy path, bad password, user suspendu, user inconnu, timing constant ±20 ms                    |
| Session creation (adapter)           | User avec 2FA → `pending2fa=true`. Sans 2FA → `pending2fa=false`. Token unique sur 1000 sessions |
| `auth.verify2FA` procedure           | Code valide → upgrade session. Code invalide → 401 + audit. Backup code valide → retiré          |
| `requireAuth` middleware tRPC        | Pas de session → 401. Pending → 401. Full → pass. Expirée → 401                                  |
| `requireGlobalAdmin`                 | User normal → 403 + `permission.denied` audit. Admin global sans 2FA après 7j → 403              |
| Bootstrap CLI                        | Premier run → user créé. Second run → refus. `--force` sur user existant → promotion + audit     |
| Lockout                              | 20 échecs login → `lockedUntil` posé. 21ᵉ tentative refusée même avec bon password               |

### 8.4 E2E Playwright (Phase 1A) — 5 scénarios

1. **Bootstrap → premier login** : CLI crée admin, user navigue `/login`, atterrit sur `/2fa/setup` (timer mocké à >7j) ou banner.
2. **Enrolment 2FA** : `/2fa/setup` → scan QR (code généré côté otplib avec secret connu) → confirm → recovery codes affichés → checkbox → `/admin`.
3. **Login complet avec 2FA** : `/login` → password → `/login/2fa` → code TOTP (calculé) → `/admin`. Vérifie cookie session changé.
4. **Backup code** : `/login` → password → `/login/2fa` → lien backup → code valide consommé → vérifie qu'il ne fonctionne plus.
5. **Lockout login** : 20 tentatives échouées → 21ᵉ avec bon password refusée → ligne `auth.login.locked` en DB.

### 8.5 Attack tests dédiés (Phase 1A)

`tests/attacks/auth.test.ts`, exécuté dans la suite intégration.

| #   | Risque mappé     | Test                                                                                            |
| --- | ---------------- | ----------------------------------------------------------------------------------------------- |
| A1  | Bruteforce login | 5 tentatives < 15 min → 6ᵉ rate limited. Reset après TTL. 20 cumulés → `lockedUntil` 1h         |
| A1b | Bruteforce 2FA   | 5 codes invalides en 5 min sur même session pending → block. Sessions différentes → indépendant |
| A2  | Énumération      | Login user inconnu vs user connu mauvais MdP : timing identique ±20 ms (1000 itérations)        |
| A3  | Cookie hijack    | Modifier cookie session → rejette. UA hash différent → log + rejette                            |
| A5  | 2FA downgrade    | Désactivation sans MdP → refuse. Sans code TOTP → refuse. Admin global → refuse même avec creds |
| A6  | TOTP DB leak     | DB read direct du `secretCipher` → pas exploitable sans `MASTER_ENCRYPTION_KEY` en env          |
| A7  | Session fixation | Cookie session pré-existant avant login → après login, ID différent. Vieille session supprimée  |
| A8  | CSRF             | POST `/api/auth/callback/credentials` sans token → refuse. Server Action sans token → refuse    |

### 8.6 Ordre d'attaque TDD pour 1A

Séquence stricte (chaque étape = test rouge → impl → vert) :

```
Étape 1 — modules cryptographiques purs
  1.1  lib/crypto.ts        (AES-GCM, HMAC, hash salé)
  1.2  lib/tokens.ts        (gen + hash + verify 32-byte tokens)
  1.3  lib/password.ts      (argon2id wrap)
  1.4  lib/totp.ts          (otplib wrap + backup codes)

Étape 2 — migration DB
  2.1  Migration 002_phase1_auth (Session, AuditLog nullables, ajouts User, Invitation)
  2.2  Test : `pnpm prisma migrate diff --exit-code` propre

Étape 3 — services persistants (testcontainers)
  3.1  lib/audit-log.ts     (recordAudit + redact + hash IP)
  3.2  lib/rate-limit.ts    (4 limiteurs + fallback memory)
  3.3  lib/permissions.ts   (assertCan* Phase 1A subset)

Étape 4 — Auth.js infrastructure
  4.1  server/auth/adapter.ts            (custom Prisma adapter)
  4.2  server/auth/credentials-provider.ts (étape 1 login)
  4.3  server/auth/config.ts             (NextAuthConfig)
  4.4  app/api/auth/[...nextauth]/route.ts (handler)

Étape 5 — tRPC infra
  5.1  server/trpc/trpc.ts   (procedures wrappers)
  5.2  server/trpc/context.ts
  5.3  server/trpc/routers/auth.ts (verify2FA, verifyBackupCode, enroll2FA, confirm2FA)

Étape 6 — middleware Next
  6.1  middleware.ts (enforcement auth + 2FA forcé Admin global)

Étape 7 — UI
  7.1  Wireframing via frontend-design : /login, /login/2fa, /2fa/setup
  7.2  Implémentation pages + components/auth/*
  7.3  Server Actions login + logout

Étape 8 — Bootstrap CLI
  8.1  scripts/bootstrap-admin.ts + tests integration

Étape 9 — Tests E2E + attack suite
  9.1  tests/e2e/auth-1a.spec.ts (5 scénarios)
  9.2  tests/attacks/auth.test.ts (8 attacks)

Étape 10 — Cleanup jobs (worker)
  10.1 worker/jobs/cleanup-expired-sessions.ts
  10.2 worker/jobs/cleanup-expired-tokens.ts
  10.3 Inscription dans la queue BullMQ existante
```

**Critère de bascule 1A → 1B** : tous les tests verts, 5 scénarios E2E verts, 8 attack tests verts, smoke test Coolify staging avec login complet.

---

## 9. Risques sécurité — checklist Phase 1

Mapping vers Annexe A du design global.

| #   | Risque                                 | Phase 1 | Statut design                     |
| --- | -------------------------------------- | ------- | --------------------------------- |
| A1  | Bruteforce login / 2FA                 | 1A      | §4.3, §6.1, §8.5                  |
| A2  | Énumération d'emails                   | 1A+1B   | §4.3 (timing), §6.1 (reset), §8.5 |
| A3  | Vol de session (cookie hijack)         | 1A      | §2.2, §4.1, §4.2                  |
| A4  | Réutilisation magic link / reset token | 1B      | §1.B (single-use, hashé)          |
| A5  | Contournement 2FA (downgrade)          | 1A+1C   | §4.6, §8.5                        |
| A6  | Vol secret TOTP en DB                  | 1A      | §3.1 (`lib/crypto.ts`), §8.5      |
| A7  | Session fixation                       | 1A      | §4.4 (regen ID), §8.5             |
| A8  | CSRF                                   | 1A      | §7.4, §8.5                        |
| B1  | Accès cross-bibliothèque (IDOR)        | 1+2     | §5.3, lint rule Phase 0           |
| B3  | Escalade via Admin Biblio              | 1C      | §5.2, ADR 0003                    |
| H3  | Droit à l'effacement                   | 1+8     | À cabler en 1C (cascade endpoint) |

---

## 10. Hors scope Phase 1

Explicitement exclus de cette phase, à traiter ailleurs :

- **Vérification email post-inscription** par lien magique : la table `VerificationToken` est créée mais le flow n'est pas activé. Décision : un user créé via invitation a son email implicitement vérifié (l'email a reçu le lien d'invitation), donc `emailVerifiedAt = now` à la consommation. Pas de vérif additionnelle requise en Phase 1.
- **Login via magic link** (passwordless) : non implémenté. Login = password obligatoire.
- **OAuth providers** (Google, GitHub) : non implémenté.
- **WebAuthn/Passkeys** : hors scope Phase 1, possible évolution future.
- **Rotation des sels IP/UA** : implémentation = Phase 8. En Phase 1, sels statiques en env, warning logged si TTL > 30j.
- **Branchement concret du type Brand `PrivateScope`** : implémenté en Phase 3 lors de l'arrivée des routes annotations.
- **Cellules de matrice non liées à auth** (livres, social, physical, collections) : leurs `assertCan*` arriveront avec leurs phases respectives (2, 3, 6, 7).

---

## 11. Mise à jour des artefacts

À produire en fin de Phase 1C (= fin Phase 1) :

- ADR 0005 — `Choix Auth.js v5 + 2FA TOTP custom` (formalisation des décisions de §4 ci-dessus).
- ADR 0006 — `Pattern de session two-step pour 2FA` (formalisation §4.5).
- Mise à jour `docs/security/owasp-mapping.md` pour A1-A8.
- Mise à jour `docs/deployment.md` (section bootstrap admin §6.2).
- Mise à jour `README.md` — section auth.
- Tag git `phase-1-complete` sur le commit qui clôture 1C.
- Update mémoire utilisateur (entrée projet « Phase 1 — clôture »).
