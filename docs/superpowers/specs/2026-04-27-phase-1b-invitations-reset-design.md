# Design — Phase 1B : Invitations & Reset Password

**Date** : 2026-04-27
**Statut** : Validé (pending user review)
**Réfère à** :
- `docs/superpowers/specs/2026-04-25-biblioshare-design.md` §5.3 Phase 1
- `docs/superpowers/specs/2026-04-26-phase-1-auth-design.md` §1B, §7.2
- ADR `docs/adr/0003-roles.md`

Ce document complète et précise la sous-phase 1B esquissée dans le design auth global de Phase 1. Il sert de base au plan d'exécution `docs/superpowers/plans/2026-04-2X-phase-1b-invitations-reset.md`.

---

## 1. Vue d'ensemble & critères de sortie

### 1.1 Objectif fonctionnel

Un Admin biblio invite un user (par email), l'invité crée son compte ou rejoint la biblio s'il existe déjà, configure éventuellement sa 2FA, se logge. Indépendamment, n'importe quel user peut demander un reset password sans révéler l'existence de son email.

### 1.2 Critères de sortie 1B

Tag git : `phase-1b-complete`. Tous les critères suivants doivent être verts :

1. Flow invitation end-to-end fonctionnel : email envoyé → consume → login.
2. Flow reset password end-to-end fonctionnel : request → email → reset → login.
3. Auto-rattachement d'un email existant via consent flow (mode `join` distinct du mode `signup`).
4. Mini-formulaire `/admin/users/invite` opérationnel pour Admin biblio et Admin global.
5. Tous les rate-limits, audit events et attack tests verts.
6. Mailpit configuré en dev/CI, Resend câblé en prod (avec instructions DNS/SPF/DKIM/DMARC documentées).
7. Smoke test Coolify staging vert.

### 1.3 Hors scope 1B (reporté en 1C)

- Panel `/admin/users` complet (table users, suspension, suppression, changement de rôle).
- Page `/admin/invitations` (table de gestion : revoke UI, resend, voir statut).
- Page `/account/security` (sessions actives, regen recovery codes, désactiver 2FA, changer MdP).
- Geo-lookup IP pour `ipApprox` dans les emails (MaxMind GeoLite2). Si non trivial, omis.

### 1.4 Livrables techniques

| Catégorie | Livrable |
|---|---|
| **DB** | Aucune migration (modèles `Invitation` et `PasswordResetToken` déjà en place depuis Phase 0/1A). |
| **Lib** | `src/lib/email.ts` (transport abstrait), `src/lib/invitations.ts`, `src/lib/password-reset.ts` |
| **Templates** | `src/emails/_layout.tsx` + 4 templates react-email |
| **Worker** | Queue BullMQ `mail` dans `worker/index.ts` avec retry exp backoff |
| **tRPC** | Routeurs `invitation` (`create`, `revoke`, `consume`, `validate`) et `password` (`requestReset`, `consumeReset`, `validateToken`) |
| **UI** | `/admin/users/invite`, `/invitations/[token]`, `/password/forgot`, `/password/reset/[token]` |
| **Tests** | Unit ≥ 90 %, integration sur procedures, 9 attack tests, 4 scénarios E2E |
| **Doc** | Section `docs/deployment.md` Resend (DNS, SPF, DKIM, DMARC) |

---

## 2. Data flows

### 2.1 Flow invitation — nouveau user (mode `signup`)

```
[Admin biblio]                    [Server]                          [Email]            [Invité]
     │                               │                                 │                  │
     │ POST /admin/users/invite      │                                 │                  │
     │ {email, libraryId, role}      │                                 │                  │
     ├──────────────────────────────►│                                 │                  │
     │                               │ permissions.assert(actor,       │                  │
     │                               │   'manage_members', libraryId)  │                  │
     │                               │ invitationLimiter.consume(uid)  │                  │
     │                               │ branch = User.findUnique({email})                  │
     │                               │   ? 'join' : 'signup'           │                  │
     │                               │ rawToken = generateRawToken()   │                  │
     │                               │ hash = hashToken(rawToken)      │                  │
     │                               │ Invitation.create({hash, 72h})  │                  │
     │                               │ recordAudit(invitation.created, │                  │
     │                               │   {invitationId, emailHash,     │                  │
     │                               │    libraryId, role, mode})      │                  │
     │                               │ mailQueue.add('invitation', {   │                  │
     │                               │   template: branch, to,         │                  │
     │                               │   rawToken, libraryName})       │                  │
     │ 200 {invitationId}            │                                 │                  │
     │◄──────────────────────────────┤                                 │                  │
     │                               │              [worker pulls job] │                  │
     │                               │              renderEmail(...)   │                  │
     │                               │              transport.send()   │                  │
     │                               │                                 ├─────────────────►│
     │                                                                                    │
     │                                                                       click link   │
     │                               GET /invitations/[rawToken]                          │
     │                               ◄────────────────────────────────────────────────────┤
     │                               server: invitations.findByRawToken(rawToken)         │
     │                               render signup form (email read-only)                 │
     │                               ────────────────────────────────────────────────────►│
     │                                                                                    │
     │                               POST tRPC invitation.consume                         │
     │                               {rawToken, displayName, password}                    │
     │                               ◄────────────────────────────────────────────────────┤
     │                               TRANSACTION (Serializable):                          │
     │                                  Invitation.findUnique({tokenHash})                │
     │                                  guard: !consumedAt && expiresAt > now             │
     │                                  User.create({email, password=argon2})             │
     │                                  LibraryMember.create({userId, libraryId, role})   │
     │                                  Invitation.update({consumedAt, consumedById})     │
     │                                  recordAudit(invitation.consumed, mode='signup')   │
     │                               sign-in via credentials → session pending2fa OFF     │
     │                                  (2FA optionnel pour rôle ≠ GLOBAL_ADMIN)          │
     │                               redirect → / (ou /2fa/setup si admin global)         │
```

### 2.2 Flow invitation — email d'un user existant (mode `join`)

À la `invitation.create`, on stocke l'invitation normalement (sans pré-remplir `consumedById`). À la consume :

- Si `User` existe et user est logué et `session.userId === existingUser.id` :
  - Bouton unique « Rejoindre {libraryName} ».
  - `LibraryMember.create({ userId, libraryId, role })`.
  - `Invitation.update({ consumedAt, consumedById = existingUser.id })`.
  - `recordAudit('auth.invitation.consumed', { mode: 'join', userId })`.
- Si `User` existe et user n'est pas logué :
  - Redirect vers `/login?callbackUrl=/invitations/[token]` (callback validé par `safeCallbackUrl`).
- Si `User` existe et user logué mais email ne match pas :
  - Erreur `EMAIL_MISMATCH`. Pas de leak : on dit « cette invitation ne vous est pas adressée ».

### 2.3 Flow reset password

```
[User]                            [Server]                          [Email]
  │                                  │                                 │
  │ POST /password/forgot {email}    │                                 │
  ├─────────────────────────────────►│                                 │
  │                                  │ resetIpOnlyLimiter.consume(ipH) │
  │                                  │ resetRequestLimiter.consume(    │
  │                                  │   hashEmail(email))             │
  │                                  │ user = User.findUnique({email}) │
  │                                  │ if user:                        │
  │                                  │   rawToken = generateRawToken() │
  │                                  │   hash = hashToken(rawToken)    │
  │                                  │   PasswordResetToken.create(    │
  │                                  │     {userId, hash, 1h})         │
  │                                  │   mailQueue.add('reset', {to})  │
  │                                  │ recordAudit(reset_requested,    │
  │                                  │   {emailHash, userExists,       │
  │                                  │    rateLimited})                │
  │                                  │ TIMING: pad to ~250ms always    │
  │ 200 {message: "if exists..."}    │                                 │
  │◄─────────────────────────────────┤                                 │
  │                                                                    │
  │ click link /password/reset/[token]                                  │
  │ GET — server-side validateToken (does NOT consume)                  │
  │ → render form si valid, sinon → page « lien expiré »                │
  │                                                                     │
  │ POST tRPC password.consumeReset {rawToken, newPassword}             │
  │ TRANSACTION (Serializable):                                         │
  │    findUnique({tokenHash}), guard !consumedAt && expiresAt > now    │
  │    User.update({passwordHash, failedLoginAttempts: 0,               │
  │                 lockedUntil: null})                                 │
  │    Session.deleteMany({userId})  ← invalide TOUTES les sessions     │
  │    PasswordResetToken.update({consumedAt})                          │
  │    PasswordResetToken.deleteMany({userId, consumedAt: null}) ← drain│
  │    recordAudit(reset_consumed, {userId})                            │
  │    mailQueue.add('reset_confirmation', {to})                        │
  │ redirect → /login?reset=ok                                          │
```

### 2.4 Décisions intégrées

- **Reset invalide toutes les sessions actives** + drain les autres reset tokens pending → force re-login partout.
- **Email de confirmation post-reset** envoyé (sécurité : alerte un user dont le compte aurait été compromis).
- **Timing uniforme** sur `/password/forgot` (~250ms padding) pour empêcher l'énumération par mesure du temps de réponse (mitigation A2).
- **Rate-limit reset double** : `resetRequestLimiter` (3/h par hashEmail) + `resetIpOnlyLimiter` (30/h par hashIp) — symétrie avec login.
- **2FA optionnelle pour invités non-Admin global** : la session post-consume est créée directement avec `pending2fa=false` si rôle ≠ `GLOBAL_ADMIN`.
- **Admin global invite un autre admin global** : flow signup classique, mais la session post-consume est `pending2fa=true` et le user est redirigé vers `/2fa/setup` (cohérent avec la politique 1A).

---

## 3. Architecture & modules

### 3.1 Découpage en fichiers

```
src/
├── lib/
│   ├── email.ts                      # transport abstrait (Resend prod / SMTP Mailpit dev)
│   ├── invitations.ts                # service métier : create/find/consume/revoke
│   ├── password-reset.ts             # service métier : request/validate/consume
│   └── rate-limit.ts                 # +resetIpOnlyLimiter (30/h par ipHash)
├── emails/                           # nouveau dossier
│   ├── _layout.tsx                   # wrapper react-email (header + footer + tokens)
│   ├── invitation-new-user.tsx
│   ├── invitation-join-library.tsx
│   ├── password-reset.tsx
│   └── password-reset-confirmation.tsx
├── server/
│   └── trpc/
│       └── routers/
│           ├── invitation.ts         # nouveau routeur
│           └── password.ts           # nouveau routeur
└── app/
    ├── admin/
    │   └── users/
    │       └── invite/page.tsx       # mini-form
    ├── (auth)/
    │   └── password/
    │       ├── forgot/page.tsx
    │       └── reset/[token]/page.tsx
    └── invitations/[token]/page.tsx  # public (groupe non-auth)

worker/
├── jobs/
│   ├── send-invitation.ts
│   ├── send-password-reset.ts
│   └── send-reset-confirmation.ts
└── index.ts                          # +Worker('mail') + scheduler retry
```

### 3.2 Responsabilités par module

#### `src/lib/email.ts` — interface unique

```ts
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

export interface EmailTransport {
  send(msg: EmailMessage): Promise<{ id: string }>;
}

export function getTransport(): EmailTransport; // resend | smtp selon env

export async function renderEmail<P>(
  Component: React.FC<P>,
  props: P
): Promise<{ html: string; text: string }>;
```

- Sélection transport via `EMAIL_TRANSPORT` env (`resend` | `smtp`).
- Resend via `RESEND_API_KEY`.
- SMTP via `SMTP_*` (host/port/user/pass/from), implémentation `nodemailer`.
- Mailpit en dev = SMTP transport sans auth, port 1025, capture web 8025.
- `renderEmail` rend HTML via `@react-email/render` + extrait le texte via la même lib (option `plainText: true`).

#### `src/lib/invitations.ts` — service pur (sans tRPC)

```ts
type CreateInput = {
  invitedById: string;
  email: string;
  libraryId?: string;
  proposedRole?: LibraryRole;
};
type CreateResult = {
  invitationId: string;
  rawToken: string;
  mode: 'signup' | 'join';
};

createInvitation(input: CreateInput): Promise<CreateResult>;
findInvitationByRawToken(rawToken: string): Promise<Invitation | null>;
consumeInvitationNewUser(rawToken: string, signup: { displayName: string; password: string }): Promise<{ userId: string }>;
consumeInvitationJoinLibrary(rawToken: string, userId: string): Promise<void>;
revokeInvitation(invitationId: string, actorId: string): Promise<void>;
```

- Tous les chemins d'écriture enrobés dans une transaction Prisma `Serializable`.
- `findInvitationByRawToken` : SELECT non-consumed/non-expired puis `verifyToken(raw, row.tokenHash)` argon2id en boucle. Linéaire en nb d'invitations actives — acceptable (≤ qq centaines en pratique).

#### `src/lib/password-reset.ts` — service pur, structure miroir

```ts
requestPasswordReset(email: string, ip: string): Promise<void>;          // 200 toujours, padding timing
findResetTokenByRawToken(rawToken: string): Promise<PasswordResetToken | null>;
consumePasswordReset(rawToken: string, newPassword: string): Promise<{ userId: string }>;
```

#### Routeurs tRPC

= juste validation Zod + appel service + `recordAudit`. Pas de logique métier dans les routes.

### 3.3 Configuration & env vars

Nouvelles variables (à ajouter dans `src/lib/env.ts` schéma Zod) :

| Variable | Type | Required | Notes |
|---|---|---|---|
| `EMAIL_TRANSPORT` | enum `'resend' \| 'smtp'` | non, default `'smtp'` (dev) | en prod Coolify : `'resend'` |
| `EMAIL_FROM` | string | oui | ex: `"BiblioShare <noreply@biblio.test>"` |
| `RESEND_API_KEY` | string | si `transport=resend` | secret Coolify |
| `SMTP_HOST` | string | si `transport=smtp` | en dev : `mailpit` |
| `SMTP_PORT` | number | non, default `1025` | |
| `SMTP_USER` | string? | non | optional auth |
| `SMTP_PASS` | string? | non | optional auth |
| `APP_BASE_URL` | string (URL) | oui | pour links absolus dans emails |
| `EMAIL_LOG_SALT` | string ≥ 32 chars | oui | hash des `to` dans les logs pino |

`docker-compose.dev.yml` : ajout service `mailpit` (image `axllent/mailpit:latest`, ports 1025+8025, healthcheck).
`docker-compose.ci.yml` : idem pour les E2E Playwright.

---

## 4. Sécurité, rate-limits, audit log

### 4.1 Tokens

| Token | Format | Hash | Expiration | Single-use | Index |
|---|---|---|---|---|---|
| Invitation | `randomBytes(32).toString('base64url')` (43 chars) | argon2id (réutilise `tokens.ts`) | **72h** | oui (`consumedAt` non-null) | `tokenHash @unique` |
| Password reset | idem | idem | **1h** | oui | `tokenHash @unique` + drain pending |

**Pourquoi argon2id pour des tokens random** : cohérence avec 1A. Coût par lookup acceptable (≤ qq centaines de tokens actifs simultanément, lookup à la consume seulement). Empêche un timing attack côté DB si le hash leak.

### 4.2 Rate-limits

Ajout d'un nouveau limiteur dans `src/lib/rate-limit.ts` :

```ts
export const resetIpOnlyLimiter = new RateLimiterRedis({
  ...baseOpts(),
  keyPrefix: 'rl:reset_ip',
  points: 30,
  duration: 60 * 60,
  blockDuration: 60 * 60,
  insuranceLimiter: memInsurance(30, 60 * 60),
});
```

Composition des limiteurs :

| Procédure | Clé(s) | Comportement quota |
|---|---|---|
| `invitation.create` | `invitationLimiter` keyé `${userId}` (10/h) | **429** explicite à l'admin (auth requis, message OK) |
| `password.requestReset` | `resetRequestLimiter` keyé `${hashEmail(email)}` (3/h) **+** `resetIpOnlyLimiter` keyé `${hashIp(ip)}` (30/h) | **200 toujours**, audit `rateLimited: true`, **pas d'email envoyé** |
| `password.consumeReset` | (pas de limiteur dédié — single-use + 1h expiry) | — |
| `invitation.consume` | (pas de limiteur — token argon2id + single-use + 72h expiry) | — |

**Mitigation A2 (énumération emails sur `/password/forgot`)** :

1. Réponse 200 uniforme (jamais 404, jamais 429 visible côté client).
2. Body uniforme : `"Si un compte existe pour cet email, un lien de réinitialisation lui a été envoyé."`
3. **Padding timing** à ~250ms (cible empirique : > durée moyenne d'un succès `User.findUnique + token create + queue add`). Implémenté via le helper `constantTimeBudget` (déjà disponible Phase 1A).
4. Audit log toujours écrit, avec `metadata.userExists: boolean` (pour observabilité interne, jamais exposé côté client).

### 4.3 Audit log events

Ajouts à l'union `AuditAction` (cf. design global §5.2) :

```ts
type AuditAction =
  | ...
  | 'auth.invitation.created'             // metadata: { invitationId, emailHash, libraryId?, role?, mode }
  | 'auth.invitation.consumed'            // metadata: { invitationId, mode: 'signup' | 'join', userId }
  | 'auth.invitation.expired'             // metadata: { invitationId } (job cleanup)
  | 'auth.invitation.revoked'             // metadata: { invitationId, revokedBy }
  | 'auth.invitation.invalid_attempt'     // metadata: { reason: 'expired' | 'consumed' | 'not_found' | 'email_mismatch' }
  | 'auth.invitation.send_failed'         // metadata: { invitationId, attempts, lastError } (DLQ)
  | 'auth.password.reset_requested'       // metadata: { emailHash, userExists, rateLimited }
  | 'auth.password.reset_consumed'        // metadata: { userId }
  | 'auth.password.reset_invalid_attempt' // metadata: { reason }
  | 'auth.password.reset_expired';        // metadata: { tokenId } (job cleanup)
```

### 4.4 Cleanup job

Étendre le job `cleanup-expired-tokens` (déjà documenté Phase 0/1A mais non implémenté) :

```
Toutes les heures :
  Invitation.deleteMany({ expiresAt < now - 7j, consumedAt: null })
    → pour chaque, audit auth.invitation.expired
  PasswordResetToken.deleteMany({ expiresAt < now - 7j })
    → pour chaque, audit auth.password.reset_expired
```

Marge de 7 jours après expiration avant suppression : conserve une trace pour investigation forensic.

### 4.5 Open redirect & callback URL

Réutilise le helper `safeCallbackUrl` (introduit en Phase 1A hardening) sur :
- `/invitations/[token]?callbackUrl=…` post-consume.
- `/password/reset/[token]?callbackUrl=…` post-reset (en pratique on force `/login?reset=ok`, mais le helper est appelé par défense en profondeur).

### 4.6 Attack tests dédiés (Vitest integration)

| Test | Scénario |
|---|---|
| `invitation.replay` | Consume valide → 2ᵉ consume avec même rawToken → `INVALID_TOKEN` |
| `invitation.expired` | Stub `Date.now()` à T+72h → consume → `INVALID_TOKEN` |
| `invitation.tamper` | Consume avec rawToken altéré (1 char swap) → `INVALID_TOKEN` (verify argon2id échoue) |
| `invitation.crossuser_join` | User A reçoit invite, User B logué tente le consume → erreur `EMAIL_MISMATCH` |
| `reset.replay` | Consume valide → 2ᵉ consume → `INVALID_TOKEN` |
| `reset.expired` | T+1h → `INVALID_TOKEN` |
| `reset.timing` | Mesurer `requestReset` pour email existant vs inexistant, asserter `\|Δ\| < 50ms` |
| `reset.session_invalidation` | Reset → vérifier `Session.findMany({userId})` est vide |
| `reset.drain_other_pending` | Reset consumed → autres `PasswordResetToken` pending du même userId sont deleted |

---

## 5. UI & emails

### 5.1 Pages UI

#### `/admin/users/invite` (mini-form)

**Gating** : `LIBRARY_ADMIN` sur la libraryId choisie OU `GLOBAL_ADMIN`. Server component + form action.

```
┌─────────────────────────────────────────┐
│  Inviter un membre                      │
├─────────────────────────────────────────┤
│  Email      [________________________]  │
│  Bibliothèque ▾ (filtré aux biblios     │
│                  où je suis admin)      │
│  Rôle ▾   ⦿ Membre  ○ Admin biblio      │
│                                         │
│         [Annuler]    [Envoyer]          │
└─────────────────────────────────────────┘

Après succès : toast vert "Invitation envoyée à {email}"
                + redirect /admin (placeholder 1A)
```

#### `/invitations/[token]` (publique, hors auth)

Flow conditionnel selon présence du User et état session :

- **Mode signup** (email pas dans User) : form `{ displayName, password, confirmPassword }` + bouton « Créer mon compte ».
- **Mode join** (email correspond à un User existant) :
  - Si user déjà logué et match → bouton unique « Rejoindre {libraryName} ».
  - Si pas logué → redirect vers `/login?callbackUrl=/invitations/[token]`.
  - Si logué avec un autre user → erreur `EMAIL_MISMATCH` (cf. §2.2).
- États d'erreur dédiés : « Lien expiré ou déjà utilisé » (page minimale, pas de form).

#### `/password/forgot`

Form `{ email }` → toujours message uniforme « Si un compte existe… ». Lien retour `/login`.

#### `/password/reset/[token]`

Form `{ newPassword, confirm }` avec règles affichées (12+ chars, classes mixtes ou passphrase). Validation côté serveur identique à 1A. État erreur « Lien expiré ou déjà utilisé ».

### 5.2 i18n

Ajouts à `messages/fr.json` (déjà présent depuis 1A) — voir bloc complet en annexe A du plan d'exécution.

### 5.3 Emails (react-email)

Tous les emails partagent un layout `_layout.tsx` qui :
- Utilise les tokens HSL de Phase 0 (palette claire uniquement — pas de dark mode email, support faible).
- Header : logo SVG (text mark `BiblioShare` en Lucide-style, sans emoji).
- Footer : « Vous recevez cet email parce que… » + lien « Centre d'aide » placeholder + mention légale courte.
- Boutons : composant `<EmailButton>` avec couleur primary, fallback texte si client email no-CSS.
- Versions HTML + texte plain générées par `@react-email/render`.

**Templates** :

1. **`invitation-new-user.tsx`** — props `{ inviterName, libraryName?, signupUrl, expiresAt }`.
   - Sujet : « Vous êtes invité·e sur BiblioShare »
   - CTA : « Créer mon compte » → `signupUrl` (= `${APP_BASE_URL}/invitations/${rawToken}`)
   - Mention expiration : « Lien valable jusqu'au {date FR} »

2. **`invitation-join-library.tsx`** — props `{ inviterName, libraryName, joinUrl, userDisplayName, expiresAt }`.
   - Sujet : « {inviterName} vous invite à rejoindre {libraryName} »
   - CTA : « Rejoindre la bibliothèque »

3. **`password-reset.tsx`** — props `{ resetUrl, expiresAt, ipApprox? }`.
   - Sujet : « Réinitialisation de votre mot de passe »
   - CTA : « Choisir un nouveau mot de passe » (1h)
   - Note : « Si vous n'avez pas demandé cette réinitialisation, ignorez cet email. »

4. **`password-reset-confirmation.tsx`** — props `{ userDisplayName, ipApprox?, occurredAt }`.
   - Sujet : « Votre mot de passe a été modifié »
   - Pas de CTA. Texte : « Si ce n'était pas vous, contactez l'administrateur de votre bibliothèque immédiatement. »

**`ipApprox`** : pas l'IP brute (RGPD) — un libellé large type « Connexion depuis France » (via geo-lookup MaxMind GeoLite2 si déjà disponible, sinon omis en 1B et tracké pour 1C/Phase 8).

**Preview dev** : `pnpm email:dev` lance `react-email dev` sur port 3001, navigateur affiche tous les templates avec props mockées.

---

## 6. Tests, observabilité, ordre d'exécution

### 6.1 Stratégie de tests

| Type | Couverture cible | Outils |
|---|---|---|
| **Unit** | `lib/email.ts`, `lib/invitations.ts`, `lib/password-reset.ts` ≥ **90 %** lignes | Vitest + mocks Prisma (`vitest-mock-extended`) + transport mock |
| **Integration** | Routeurs tRPC `invitation.*` + `password.*` contre Postgres + Redis Testcontainers (déjà branchés Phase 1A) | Vitest + `createCallerFactory` |
| **Attack tests** | 9 scénarios listés §4.6 | Vitest integration |
| **E2E** | 4 scénarios Playwright | Playwright + Mailpit API |

#### Scénarios E2E (Playwright)

1. **invite-new-user** : admin → `/admin/users/invite` → Mailpit `GET /api/v1/messages` → extract link → `/invitations/[token]` → signup → `/admin` (admin biblio = pas de 2FA forcée).
2. **invite-existing-user** : seed user existe → admin invite cet email → user logué clique link → bouton « Rejoindre » → vérifier `LibraryMember` créé.
3. **password-reset** : user → `/password/forgot` → Mailpit GET email → `/password/reset/[token]` → submit → `/login` → login avec nouveau MdP OK.
4. **reset-invalidates-sessions** : user logué dans browser context A → reset password depuis browser context B → assert browser A redirected to `/login` au prochain navigation.

**Mailpit en CI** : ajouté à `docker-compose.ci.yml`, healthcheck sur `:8025/api/v1/info`. E2E lit les emails via API REST `GET /api/v1/messages` (pas de scraping web).

### 6.2 Observabilité

- **Pino logs** : chaque envoi email logué avec `{event: 'email.sent', template, toHash, transportId, durationMs}`. `to` jamais en clair (hash SHA-256 préfixé du salt `EMAIL_LOG_SALT` env).
- **BullMQ retry** : queue `mail` avec `attempts: 5`, `backoff: { type: 'exponential', delay: 30_000 }`. Jobs failed après 5 tries → DLQ `mail-failed`, log `email.failed_permanent` + audit log `auth.invitation.send_failed`.
- **Health check** étendu (`/api/health`) : ping Resend (`HEAD /domains` avec API key) si `EMAIL_TRANSPORT=resend`. Mailpit ping en dev.

### 6.3 Risques & mitigations

| Risque | Mitigation 1B |
|---|---|
| Email Resend down → invitations bloquées | BullMQ retry 5x exp backoff (~30s, 1min, 2min, 4min, 8min). Au-delà, DLQ + alert Pino. Manuel : admin doit recréer l'invitation. Pas de fallback SMTP en 1B (YAGNI). |
| Phishing imitant le template | `EMAIL_FROM` configurable, SPF/DKIM/DMARC à configurer côté Resend (instructions dans `docs/deployment.md`). Pas une mitigation produit pure. |
| Token leaké dans logs serveur | `redact: ['*.rawToken', '*.token']` dans config pino. Logs HTTP body capturés ne contiennent jamais le rawToken. |
| Race sur consume (deux clics rapides) | Transaction `Serializable` + WHERE `consumedAt: null` dans l'UPDATE. Le 2ᵉ clic perd la course → erreur cohérente. |
| Admin biblio invite à une biblio qui n'est pas la sienne | Procedure `invitation.create` vérifie via `permissions` helper que `actor` a `manage_members` sur `libraryId`. Refus 403 + audit `permission.denied`. |

### 6.4 Ordre d'exécution proposé (high-level)

| # | Bloc | Output attendu |
|---|---|---|
| 1 | Env vars + Mailpit dans `docker-compose.dev.yml` + script `email:dev` | `pnpm email:dev` ouvre la preview |
| 2 | `src/lib/email.ts` + transports Resend + SMTP + `renderEmail` helper | unit tests verts |
| 3 | Templates react-email (4 fichiers) + i18n strings | preview navigable |
| 4 | Worker BullMQ : queue `mail` + 3 jobs senders + retry config | jobs visibles dans Mailpit lors d'un dispatch manuel |
| 5 | `src/lib/invitations.ts` (service) + tests unit | unit verts |
| 6 | `src/lib/password-reset.ts` (service) + tests unit | unit verts |
| 7 | Routeur tRPC `invitation.*` + audit log + rate-limit | integration verts |
| 8 | Routeur tRPC `password.*` + audit log + rate-limit + timing pad | integration + attack tests verts |
| 9 | Page `/admin/users/invite` (server component + form action) | manuel dev OK |
| 10 | Pages `/invitations/[token]`, `/password/forgot`, `/password/reset/[token]` | manuel dev OK |
| 11 | Cleanup job `cleanup-expired-tokens` (extension) | unit + integration verts |
| 12 | E2E Playwright 4 scénarios | E2E verts |
| 13 | `docs/deployment.md` : section Resend (DNS, SPF/DKIM/DMARC) | doc à jour |
| 14 | Smoke staging Coolify + tag `phase-1b-complete` | Phase 1B clôturée |

---

## 7. Décisions prises pendant le brainstorming

| # | Question | Choix |
|---|---|---|
| Q1 | Scope création invitations 1B | (b) endpoint tRPC + mini-form `/admin/users/invite`. Panel `/admin/invitations` repoussé en 1C. |
| Q2 | Infrastructure email | Resend prod uniquement (pas de fallback SMTP en 1B), Mailpit dev/CI, react-email pour templates. |
| Q3 | Email d'invitation déjà existant | (c) consent flow avec branche `join` distincte de `signup`. |
| — | Reset & sessions | Reset invalide toutes les sessions actives + drain les autres reset tokens pending. |
| — | Email confirmation post-reset | Envoyé. |
| — | Rate-limit reset | Double : per-email (3/h) + per-IP (30/h). |
| — | Timing pad `/password/forgot` | ~250ms via `constantTimeBudget`. |
| — | 2FA invité | Optionnel pour rôle ≠ `GLOBAL_ADMIN`. Forcée pour `GLOBAL_ADMIN` (cohérence Phase 1A). |
