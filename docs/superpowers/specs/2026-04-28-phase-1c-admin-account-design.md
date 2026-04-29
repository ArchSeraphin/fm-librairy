# Phase 1C — Panel admin + /account self-service + matrice rôles

**Date** : 2026-04-28
**Statut** : Design validé, plan à rédiger
**Phase précédente** : Phase 1B (clôturée le 2026-04-28, PR #18, tag `phase-1b-complete` sur `52e43b8`)
**Approche retenue** : Hybride par modules (cf. § Architecture)

## 1. Contexte & objectif

Phase 1B a livré l'authentification, les invitations admin et le password reset self-service. Phase 1C ferme la boucle « plateforme » en ajoutant :

1. Le **panel admin global** pour piloter Users et Libraries.
2. L'**espace `/account`** self-service (Profil + Sécurité) pour que chaque user gère son compte sans solliciter un admin.
3. Une **matrice rôles testable** qui vérifie systématiquement « qui peut faire quoi », avec garde anti-drift sur les futures procedures tRPC.
4. La fermeture de trois dettes Phase 1B (worker handler `send-password-reset-confirmation`, IP plumbing tRPC ctx, audit DLQ pour mails échoués).

Les utilisateurs cibles 1C sont les mêmes que Phase 1A/1B (50-200 users an 1, scaling ~500). L'audit doit rester immuable, les sessions hardenées, le 2FA forcé pour les `GLOBAL_ADMIN`.

## 2. Architecture & data model

### 2.1 Découpage modulaire

Cinq modules séquentiels, chaque module produit un incrément utilisateur testable :

```
Module 0 (plumbing) ──────────────── 1 jour
   ├── createContext étend req → ip
   ├── worker handler send-password-reset-confirmation
   ├── audit listener DLQ (mail send failed)
   └── audit union 1C complète

Module 1 (Users admin) ────────────── 2-2.5 jours
Module 2 (Libraries admin) ────────── 2-2.5 jours
Module 3 (Account self-service) ───── 2.5-3 jours
Module 4 (Matrice + closure) ──────── 1.5-2 jours
```

**Total estimé** : 9-11 jours wall-time, ~23 tasks de plan (vélocité Phase 1B = référence).

### 2.2 Modifications schéma Prisma

| Model     | Champ            | Type                                            | Migration                      |
| --------- | ---------------- | ----------------------------------------------- | ------------------------------ |
| `Session` | `userAgentLabel` | `String?` (max 64 chars, nullable, no backfill) | `add_session_user_agent_label` |
| `Library` | `archivedAt`     | `DateTime?` (nullable)                          | `add_library_archived_at`      |

**Rationale `userAgentLabel`** : permet l'UX « Chrome on macOS » sans toucher au hash IP/UA (RGPD). Sessions pré-1C affichent `Unknown device`, acceptable.

**Rationale `archivedAt`** : decision soft-delete. Une biblio peut contenir Books, Members, DownloadLogs → cascade hard = perte audit. Archive = read-only, restaurable, sans cascade. Suppression dure éventuelle = runbook DBA Phase 2+.

**Migration corrective conditionnelle** (Module 1) : audit des FK `onDelete` du model `User` :

- `Invitation.invitedById` / `consumedById` doivent être `SetNull` (préserver audit invitation).
- `Book.uploadedById` doit être `SetNull` (livres restent).
- `AuditLog.actorId` doit être `SetNull` (immutabilité audit).
- `Annotation.userId`, `Bookmark.userId`, `ReadingProgress.userId`, `ReadingSession.userId`, `Rating.userId` doivent être `Cascade` (données strictement personnelles, ADR 0003).
- `Session.userId`, `LibraryMember.userId` doivent être `Cascade`.

Si l'état actuel ne correspond pas, migration `fix_fk_on_delete_for_user_deletion` ajoutée à Module 1.

### 2.3 Audit union 1C — extension complète

À ajouter dans `src/lib/audit-log.ts` (`AuditAction` type union) :

```ts
// 1C — admin users (déjà déclarés Phase 1B)
| 'admin.user.suspended'
| 'admin.user.reactivated'
| 'admin.user.deleted'
| 'admin.user.role_changed'
// 1C — admin users (nouveau)
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
| 'auth.password.reset_confirmation_send_failed'
```

`AuditTargetType` étendu : ajouter `'MEMBER'` (target = `LibraryMember.id`).

### 2.4 Routers tRPC

| Router             | Procedures                                                                                                                                              | Protection                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `admin.users`      | `list`, `get`, `suspend`, `reactivate`, `delete`, `changeRole`, `invitations.list`, `invitations.revoke`, `resetTwoFactor`                              | `globalAdminProcedure` (existant) |
| `admin.libraries`  | `list`, `get`, `create`, `rename`, `archive`, `unarchive`, `members.list`, `members.add`, `members.remove`, `members.changeRole`, `members.updateFlags` | `globalAdminProcedure`            |
| `account.profile`  | `get`, `update`                                                                                                                                         | `authedProcedure` (existant)      |
| `account.security` | `changePassword`, `listSessions`, `revokeSession`, `revokeAllOtherSessions`, `regenerateBackupCodes`, `startReEnrollWithBackup`                         | `authedProcedure`                 |

Enregistrement dans `src/server/trpc/routers/_app.ts` à côté de `auth`, `invitation`, `password`.

## 3. Module 0 — Plumbing & dette 1B

### 3.1 IP plumbing dans le contexte tRPC

- `createTRPCContext()` reçoit `{ headers: Headers }` (Next.js App Router).
- Helper `extractIpFromHeaders(headers: Headers): string` exporté depuis `src/lib/request-meta.ts`. Priorité : `x-forwarded-for` (premier segment) → `x-real-ip` → fallback `'0.0.0.0'`. Validation IPv4/IPv6 par regex.
- `TrpcContext.ip: string` injecté.
- `src/app/api/trpc/[trpc]/route.ts` passe `headers: req.headers` à `createContext`.
- Migration call-sites : `password.requestReset` remplace son placeholder ; `auth.verify2FA`/`verifyBackupCode`/`disable2FA` enrichissent leurs `metadata` avec `ip: ctx.ip`.

**Tests** : 5 unit tests sur `extractIpFromHeaders` (XFF simple, multi-hop, X-Real-IP, aucun, malformé) + 1 integration test sur `password.requestReset` qui vérifie l'IP en audit.

### 3.2 Worker handler `send-password-reset-confirmation`

- Nouveau fichier `worker/jobs/send-password-reset-confirmation.ts`. Pattern identique à `send-password-reset.ts`.
- Enregistrement dans `worker/index.ts` (switch case).
- Idempotence : retry renvoie le même mail (acceptable). Pas de dédup nécessaire.
- Pas d'audit succès (l'audit `auth.password.changed` est déjà loggué côté `password.consume`).

**Tests** : 1 unit (handler appelé → email envoyé) + 1 integration (job enqueué → consommé → mail visible Mailpit).

### 3.3 DLQ audit listener

- Dans `worker/index.ts`, `worker.on('failed', async (job, err) => { ... })` : si `job.attemptsMade >= job.opts.attempts` (dernier retry), `recordAudit` selon le job name :
  - `send-invitation` → `auth.invitation.send_failed`
  - `send-password-reset` → `auth.password.reset_send_failed`
  - `send-password-reset-confirmation` → `auth.password.reset_confirmation_send_failed`
- `metadata: { jobId, attempts, error: err.message.slice(0, 200) }`. `actor: { id: job.data.userId }`.

**Tests** : 1 integration test simulant 5 échecs (mock `email.ts` throw) → vérifie `AuditLog` row.

### 3.4 Pino redactor

À confirmer en implémentation : si `lib/logger.ts` n'a pas de redactor sur les clefs `['password', 'token', 'secret', 'authorization', 'cookie']`, l'ajouter (cohérent avec `src/lib/audit-log.ts:39-49` SENSITIVE_KEYS).

## 4. Module 1 — Users panel admin

### 4.1 Procedures `admin.users`

| Procedure            | Input                                        | Behaviour                                                                                                                                                      | Audit                         |
| -------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `list`               | `{ q?, status?, role?, cursor?, limit: 20 }` | Pagination cursor (cuid). Tri `createdAt DESC`. `q` matche `email` + `displayName` (citext).                                                                   | —                             |
| `get`                | `{ id }`                                     | User + counts (sessions, invitations, libraryMembers). 2FA flag inclus.                                                                                        | —                             |
| `suspend`            | `{ id, reason: string (3..500) }`            | `User.status = SUSPENDED` + révoque sessions actives via `revokeAllSessionsForUser(id)`. Refus si `id === ctx.user.id`. Refus si dernier `GLOBAL_ADMIN` actif. | `admin.user.suspended`        |
| `reactivate`         | `{ id }`                                     | `User.status = ACTIVE`. Idempotent.                                                                                                                            | `admin.user.reactivated`      |
| `delete`             | `{ id, confirmEmail }`                       | `confirmEmail === user.email` requis. Refus self. Refus dernier GLOBAL_ADMIN. Cascade FK auditée (cf. 2.2).                                                    | `admin.user.deleted`          |
| `changeRole`         | `{ id, newRole }`                            | Refus self. Refus rétrograde dernier GLOBAL_ADMIN. Pas de session kill (refresh à la prochaine request).                                                       | `admin.user.role_changed`     |
| `invitations.list`   | `{ userId }`                                 | Invitations créées par ce user.                                                                                                                                | —                             |
| `invitations.revoke` | `{ invitationId }`                           | Réutilise `lib/invitations.ts:revokeInvitation` Phase 1B.                                                                                                      | `auth.invitation.revoked`     |
| `resetTwoFactor`     | `{ id, reason }`                             | Force-clear 2FA + kill toutes sessions du target. **Refus si target = `GLOBAL_ADMIN`** (runbook DBA).                                                          | `admin.user.two_factor_reset` |

### 4.2 Helpers serveur

`src/lib/user-admin.ts` :

- `assertNotLastGlobalAdmin(userId, role)` — utilisé par `suspend`, `delete`, `changeRole`.
- `revokeAllSessionsForUser(userId, exceptSessionId?: string)` — extraction/réutilisation du pattern Phase 1A.

### 4.3 UI `/admin/users`

Routes :

- `/admin/users` — liste (server component) : filtres + table paginée + lien « Inviter » (vers `/admin/users/invite` Phase 1B).
- `/admin/users/[id]` — fiche détail. Tabs : Actions / Sessions / Invitations / Audit excerpt (10 dernières entrées avec `actorId === userId` ou `targetId === userId`).

Composants : `UsersTable`, `UserDetailHeader`, `UserActionsPanel`, `SuspendDialog`, `DeleteUserDialog`, `ChangeRoleDialog`, `ResetTwoFactorDialog`.

### 4.4 Tests

- Unit : `assertNotLastGlobalAdmin`, transformations user-list, `revokeAllSessionsForUser` avec exception.
- Integration : 1 par procedure (~9 fichiers), couvrant cross-role, last-admin guard, audit row, sessions invalidation.
- E2E (Module 4) : `admin-suspend-user-flow.spec.ts`.

### 4.5 i18n

Clés `admin.users.*` (~40).

## 5. Module 2 — Libraries panel admin

### 5.1 Champs Library 1C

Champs éditables : `name` (3..120), `description` (0..1000). `slug` généré au create (`slugify(name)` + suffix collision), figé après. Pas de `visibility`/`coverImageUrl`/`theme` (Phase 2+).

### 5.2 Procedures `admin.libraries`

| Procedure             | Input                                                   | Behaviour                                                                                                     | Audit                        |
| --------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `list`                | `{ q?, includeArchived?: boolean, cursor?, limit: 20 }` | Pagination. `q` sur `name` + `slug`.                                                                          | —                            |
| `get`                 | `{ id }`                                                | Library + counts (members, books) + `archivedAt`.                                                             | —                            |
| `create`              | `{ name, description? }`                                | Slug unique généré (boucle `-2`/`-3`/...).                                                                    | `admin.library.created`      |
| `rename`              | `{ id, name, description? }`                            | Refus si archived. Slug figé.                                                                                 | `admin.library.renamed`      |
| `archive`             | `{ id, reason }`                                        | Soft-delete. Idempotent.                                                                                      | `admin.library.archived`     |
| `unarchive`           | `{ id }`                                                | Restaure.                                                                                                     | `admin.library.unarchived`   |
| `members.list`        | `{ libraryId, q?, cursor?, limit: 20 }`                 | Joint user (email, displayName) + role + flags.                                                               | —                            |
| `members.add`         | `{ libraryId, userId, role, flags }`                    | Refus si déjà membre (409). Refus si library archived. Suggère uniquement users existants (pas d'invite ici). | `admin.member.added`         |
| `members.remove`      | `{ membershipId }`                                      | Refus si dernier `LIBRARY_ADMIN`.                                                                             | `admin.member.removed`       |
| `members.changeRole`  | `{ membershipId, newRole }`                             | Refus si rétrograde le dernier `LIBRARY_ADMIN`.                                                               | `admin.member.role_changed`  |
| `members.updateFlags` | `{ membershipId, flags }`                               | Au moins un flag à `true`.                                                                                    | `admin.member.flags_changed` |

### 5.3 Helpers serveur

`src/lib/library-admin.ts` :

- `assertLibraryNotArchived(libraryId)`
- `assertNotLastLibraryAdmin(libraryId, membershipId)`
- `slugifyUnique(name, db)` (max 100 itérations)

### 5.4 UI `/admin/libraries`

Routes :

- `/admin/libraries` — liste avec status badge, action « Open », bouton « New library ».
- `/admin/libraries/[slug]` — fiche détail. Tabs : Settings / Members / Audit excerpt.

URL utilise `slug` (lisible, stable). tRPC accepte `id`, server component résout slug→id.

Composants : `LibrariesTable`, `LibraryDetailHeader`, `LibrarySettingsForm`, `MembersTable`, `AddMemberDialog`, `ArchiveLibraryDialog`, `UpdateFlagsRow`.

### 5.5 Cas de bord

- GLOBAL_ADMIN peut s'auto-ajouter membre (utile dev/test).
- `members.add` sur user `SUSPENDED` autorisé (gating au login).
- Archive ne supprime pas membres ni books.

### 5.6 Tests

- Unit : `assertNotLastLibraryAdmin`, `slugifyUnique` (collisions).
- Integration : 1 par procedure (~10 fichiers).
- E2E (Module 4) : `admin-create-library-and-add-member.spec.ts`.

### 5.7 i18n

Clés `admin.libraries.*` (~30) + `admin.libraries.members.*` (~20).

## 6. Module 3 — Account self-service

### 6.1 Router `account.profile`

| Procedure | Input                                                    | Behaviour                                                                                         | Audit                                                      |
| --------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `get`     | —                                                        | `{ id, email, displayName, locale, role, status, createdAt, twoFactorEnabled }`. Email read-only. | —                                                          |
| `update`  | `{ displayName: string (1..120), locale: 'fr' \| 'en' }` | Pas de re-auth (champs non-sensibles).                                                            | `account.profile.updated` (metadata = `{ before, after }`) |

`email` non éditable en 1C (changement = flow séparé Phase 2).

### 6.2 Router `account.security`

#### `changePassword`

```ts
input: { currentPassword, newPassword (min 12, complexity), confirmPassword }
```

1. Verify `currentPassword` ; échec → `UNAUTHORIZED` + log Pino seul (pas d'audit pour éviter pollution). Rate-limiter `passwordChangeLimiter` 5/h per userId.
2. Refus si `newPassword === currentPassword` (400).
3. `hashPassword(newPassword)` → update.
4. `revokeAllSessionsForUser(ctx.user.id, ctx.session.id)` — kill sauf courante.
5. Audit succès `auth.password.changed_self` (metadata = `{ ip, sessionsRevoked: count }`).
6. Enqueue mail via template `PasswordResetConfirmation` (Phase 1B) avec param `triggerSource: 'self_change'` adaptant le copy.

#### `listSessions`

Renvoie array `{ id, createdAt, lastSeenAt, userAgentLabel, isCurrent }`. Tri : courante d'abord puis `lastSeenAt DESC`. Pas de pagination (max théorique = `MAX_SESSIONS_PER_USER` Phase 1A).

#### `revokeSession`

```ts
input: {
  sessionId;
}
```

Refus si `sessionId === ctx.session.id` (utiliser logout). Refus si `session.userId !== ctx.user.id` → **`NOT_FOUND`** (anti-IDOR, pas de leak existence). Audit `auth.session.revoked_self`.

#### `revokeAllOtherSessions`

Pas d'input. Renvoie `{ revokedCount }`. Audit `auth.session.revoked_all_others`.

#### `regenerateBackupCodes`

```ts
input: {
  (currentPassword, totpCode);
}
```

Refus si `twoFactorEnabled === false` (412). Verify password + TOTP. Génère 10 nouveaux codes, hash via `hashBackupCodes`, update `TwoFactorSecret.backupCodes`. **Affichage one-time dans la response** (jamais re-fetchable). Audit `auth.2fa.recovery_codes_regenerated_self`. Rate-limiter `backupCodesRegenLimiter` 5/h.

#### `startReEnrollWithBackup`

```ts
input: {
  backupCode: /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;
}
```

Refus si `User.role === 'GLOBAL_ADMIN'` (FORBIDDEN, runbook DBA). Refus si `twoFactorEnabled === false` (412). Verify backup code via `consumeBackupCode` (Phase 1A). Si valide : delete `TwoFactorSecret`, set `twoFactorEnabled = false`, `revokeAllSessionsForUser(userId, ctx.session.id)` (défensif). Audit `auth.2fa.reset_via_backup`. UI redirige vers `/2fa/setup` (flow enroll Phase 1A réutilisé). Rate-limiter `twoFactorReEnrollLimiter` 5/h.

### 6.3 UI `/account`

Layout sidebar (cohérent avec `/admin` après uniformisation décidée § Q8) :

- Header minimal (BrandMark + LogoutButton).
- Sidebar gauche : `Profil` (icon User Lucide) + `Sécurité` (icon Shield Lucide).
- Mobile : drawer Sheet shadcn sous breakpoint `lg:`.

Gating : `getCurrentSessionAndUser()` requis.

#### `/account` (Profil)

Card unique : avatar placeholder (initiales sur fond accent), form `email` (disabled), `displayName` (editable), `locale` (Select fr/en), boutons Save/Cancel, toast success.

#### `/account/security`

Quatre cards :

1. **Mot de passe** — Dialog avec current/new/confirm + indicateur force MDP (Phase 1A réutilisé). Alert d'avertissement « autres sessions seront déconnectées ».
2. **Sessions actives** — table `Device` / `Last active` / `Created` / `Action`. Badge `This session` (revoke disabled). Bouton « Sign out all other sessions ».
3. **Two-factor authentication** — `OFF` → bouton « Set up » (flow enroll Phase 1A). `ON` → 3 actions (Disable via `auth.disable2FA`, Regenerate backup codes, Reset via backup code).
4. **Backup codes** — compte restant `/10` lecture seule. Bouton « Regenerate » (Dialog password + TOTP).

Composants : `AccountSidebar`, `ProfileForm`, `ChangePasswordDialog`, `SessionsTable`, `RevokeAllDialog`, `TwoFactorPanel`, `RegenerateBackupCodesDialog`, `ReEnrollTwoFactorDialog`.

### 6.4 Tests

- Unit : `passwordChangeLimiter`, validation Zod inputs, helpers session reuse.
- Integration : 1 par procedure (~10 fichiers). Cas notables : changePassword wrong-current → 401 + no audit ; revokeSession cross-user → 404 ; revokeAllOtherSessions → courante préservée ; regenerateBackupCodes wrong-totp → 401 ; startReEnrollWithBackup on GLOBAL_ADMIN → 403 ; sur user sans 2FA → 412.
- E2E (Module 4) : `account-change-password-other-sessions-killed.spec.ts`, `account-reenroll-2fa-via-backup.spec.ts`, `account-revoke-other-session.spec.ts`.

### 6.5 i18n

Clés `account.profile.*` (~15) + `account.security.*` (~50).

## 7. Module 4 — Matrice rôles testable + closure

### 7.1 Harness matrice

**Fichier** : `tests/integration/permissions-matrix.test.ts` (~250 LOC).

Structure :

```ts
type Role = 'GLOBAL_ADMIN' | 'LIBRARY_ADMIN' | 'MEMBER' | 'ANON' | 'PENDING_2FA';
type ProcedureCase = {
  router: string;
  procedure: string;
  input: () => any;
  byRole: Record<Role, 'allow' | 'deny'>;
  setup?: (ctx) => Promise<any>;
};

const matrix: ProcedureCase[] = [ /* ~30 lignes */ ];

describe.each(matrix)('$router.$procedure', ({ ... }) => {
  for (const role of Object.keys(byRole) as Role[]) {
    test(`${role} → ${byRole[role]}`, async () => { ... });
  }
});
```

**Helpers** : `tests/integration/_matrix-helpers.ts` (`makeCallerForRole`, seed user fresh, createCaller tRPC avec ctx).

**Anti-drift** : test guard `it('matrix covers every registered procedure', () => { ... })` introspecte `appRouter._def.procedures` et fail si une procedure n'a pas de ligne matrice. Empêche la dérive sur futures procedures.

**Volume** : ~30 procedures × 5 rôles ≈ 150 tests générés. Cible CI <30s.

### 7.2 Doc matrice Markdown

**Fichier** : `docs/permissions-matrix.md`. Génération **manuelle** en 1C (table à plat, footnotes pour contraintes type « sauf si dernier GLOBAL_ADMIN »). Script de génération automatique = nice-to-have Phase 2.

### 7.3 E2E Playwright

5 specs dans `tests/e2e/` (réutilise helpers Phase 1B) :

1. `admin-suspend-user-flow.spec.ts`
2. `admin-create-library-and-add-member.spec.ts`
3. `account-change-password-other-sessions-killed.spec.ts`
4. `account-reenroll-2fa-via-backup.spec.ts`
5. `account-revoke-other-session.spec.ts`

### 7.4 Runbook DBA

**Fichier** : `docs/runbooks/disable-2fa-global-admin.md`. Contenu : contexte (cas hors-bande GLOBAL_ADMIN unique perd TOTP + backup codes), pré-requis SSH/psql, procédure SQL exacte (delete `TwoFactorSecret` + update `User.twoFactorEnabled` + insert `AuditLog` row trace), vérification post-op (login test + bannière 2FA).

**Fichier** : `docs/runbooks/README.md` listant l'intention de `hard-delete-library.md` (Phase 2+).

### 7.5 Polish layouts sidebar

- Vérification WCAG 2.1 AA : focus management, keyboard nav, `aria-current` sur item actif, contraste palette.
- Mobile responsive 375px / 768px / 1280px (Sheet drawer sous `lg:`).
- Animations slide-up cohérentes Phase 1A.

### 7.6 Closure

- `project_phase_1c_completed.md` (memory).
- Update `MEMORY.md`.
- Tag git `phase-1c-complete` sur merge commit.
- PR description avec stats.

## 8. Sécurité, error handling, observabilité

### 8.1 Mapping erreurs tRPC

| Cas                                           | Code                        | Audit ?                                           |
| --------------------------------------------- | --------------------------- | ------------------------------------------------- |
| Pas de session                                | `UNAUTHORIZED`              | non                                               |
| Rôle insuffisant                              | `FORBIDDEN`                 | **oui** (`permission.denied` middleware existant) |
| Resource introuvable                          | `NOT_FOUND`                 | non                                               |
| Resource d'autre user (anti-IDOR)             | `NOT_FOUND` (pas FORBIDDEN) | non                                               |
| Resource état invalide (archived, last-admin) | `PRECONDITION_FAILED`       | non                                               |
| Conflit unicité (slug, déjà membre)           | `CONFLICT`                  | non                                               |
| Validation Zod                                | `BAD_REQUEST`               | non                                               |
| Rate-limit                                    | `TOO_MANY_REQUESTS`         | non                                               |
| Mauvais credentials                           | `UNAUTHORIZED`              | **oui** sur cas sensibles (Phase 1A pattern)      |

### 8.2 Rate-limiters 1C

Étendus dans `src/lib/rate-limit.ts` :

| Nom                           | Limite | Clef   | Cible                                      |
| ----------------------------- | ------ | ------ | ------------------------------------------ |
| `passwordChangeLimiter`       | 5/h    | userId | `account.security.changePassword`          |
| `twoFactorReEnrollLimiter`    | 5/h    | userId | `account.security.startReEnrollWithBackup` |
| `backupCodesRegenLimiter`     | 5/h    | userId | `account.security.regenerateBackupCodes`   |
| `accountProfileUpdateLimiter` | 30/h   | userId | `account.profile.update`                   |

Pattern `rate-limiter-flexible` Redis (Phase 1A). Consume **avant** verif credentials (anti-timing leak).

### 8.3 Session invalidation — règles transversales

| Action                                     | Sessions tuées                          |
| ------------------------------------------ | --------------------------------------- |
| `account.security.changePassword`          | toutes sauf courante                    |
| `account.security.revokeSession`           | la session ciblée                       |
| `account.security.revokeAllOtherSessions`  | toutes sauf courante                    |
| `account.security.startReEnrollWithBackup` | toutes sauf courante (défensif)         |
| `password.consume` (reset 1B)              | toutes (re-login forcé)                 |
| `admin.users.suspend` (target)             | toutes du target                        |
| `admin.users.delete` (target)              | toutes (cascade Prisma)                 |
| `admin.users.changeRole` (target)          | aucune (refresh à la prochaine request) |
| `admin.users.resetTwoFactor` (target)      | toutes du target                        |

### 8.4 Anti-énumération

- `members.add` ne suggère que users existants. Pas d'invite depuis biblio en 1C.
- `revokeSession` cross-user → `NOT_FOUND` (pas de leak).
- Ids exposés en URL = cuid (longs, non-séquentiels).

### 8.5 Open redirect

Phase 1A hardening fermé. Pages 1C n'exposent aucun `redirectTo`. Pas de test nouveau requis (le test générique 1A couvre).

### 8.6 Logging Pino

- `info` : succès actions admin.
- `warn` : refus métier (rate-limit, last-admin guard, archived refus).
- `error` : exceptions inattendues (DB conflict, worker DLQ).

PII : userId/libraryId (cuid OK), **jamais** email en clair, **jamais** password/token. Redactor Pino à confirmer/ajouter Module 0.

### 8.7 Observabilité

Pas de Prometheus/OTEL en 1C. Sources :

- Pino logs structurés (Phase 0).
- AuditLog Postgres (Phase 1A).
- BullMQ stats via DLQ listener (Module 0).

Dashboard Grafana = Phase 8.

## 9. Tests — stratégie consolidée

| Niveau                                | Volume                   | Couverture                                             | Module(s)  |
| ------------------------------------- | ------------------------ | ------------------------------------------------------ | ---------- |
| Unit (Vitest)                         | ~12 fichiers, ~50 tests  | Helpers, validators, rate-limiters                     | 0, 1, 2, 3 |
| Integration (Vitest + Prisma test DB) | ~30 fichiers, ~150 tests | 1 par procedure (happy + unhappy), audit, sessions     | 0, 1, 2, 3 |
| Matrice (générée)                     | 1 fichier, ~150 tests    | 30 procedures × 5 rôles, anti-drift                    | 4          |
| Attack tests                          | ~3 fichiers, ~10 tests   | IDOR, enum, timing budget changePassword (delta <80ms) | 1, 3       |
| E2E (Playwright)                      | 5 specs, ~15 scénarios   | Flux complets, multi-tab session kill                  | 4          |
| **Total**                             | **~375 tests**           | CI cible <8 min                                        | —          |

**Patterns obligatoires** (héritage Phase 1B) :

- `truncateAll()` partout integration.
- `expiresAt:` + 64-char placeholders pour `ipHash`/`userAgentHash` dans seeds session.
- `useActionState` from `react`.
- `&apos;` dans react-email.
- Pas de `as any`.
- `pnpm format:check` avant push.

## 10. i18n

Volume estimé : ~150 nouvelles clés.

```
admin.users.*                ~40
admin.libraries.*            ~30
admin.libraries.members.*    ~20
account.profile.*            ~15
account.security.*           ~50
common.actions.*             ~5
errors.*                     ~10
```

`fr` primaire. `en` synchronisé en placeholder seulement si `en.json` existe (pas de localisation pro 1C). Pas d'emojis. Lucide icons seuls. Côté `/account` : pas de jargon technique. Côté `/admin` : technique acceptable.

## 11. Risques & mitigations

| Risque                                                                        | Probabilité | Impact | Mitigation                                                                                                             |
| ----------------------------------------------------------------------------- | ----------- | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| Cascade FK Prisma incorrecte sur `User` delete                                | Moyen       | Élevé  | Audit du schéma Module 1 → migration corrective. Tests integration vérifient survivants.                               |
| Matrice testable lente (>30s)                                                 | Moyen       | Faible | `test.concurrent` ou seed partagé par rôle si dépassement.                                                             |
| Sidebar mobile drawer non responsive                                          | Faible      | Moyen  | Tests Playwright mobile viewport (375px) sur les 5 specs.                                                              |
| Reset 2FA via backup laisse fenêtre `twoFactorEnabled = false` sans re-enroll | Faible      | Élevé  | UI redirige hard vers `/2fa/setup`. Si fermeture onglet, bannière 7j Phase 1A re-déclenchée. Gap acceptable documenté. |
| Drift audit union vs `AuditLog.action` Postgres                               | Faible      | Moyen  | `action` est `String` libre côté DB. Test integration vérifie chaque action écrit/lu identique.                        |

## 12. Hors-scope explicite (NE PAS FAIRE en 1C)

Cadenassé pour empêcher scope creep :

1. Audit log viewer global (filtres, recherche, export). → Phase 2/3.
2. Dashboard admin avec stats agrégées. → Phase 2/3.
3. Suppression dure de Library. → Runbook DBA documenté à terme.
4. Changement d'email user (avec verification token). → Phase 2.
5. Avatar upload `/account`. → Phase 2/3.
6. Préférences notifs `/account`. → Phase 2 (router `notifications`).
7. Geo-IP sessions affichage. → Phase 2/3.
8. Lint rule custom Prisma scope (annotations privées). → Phase 2 (avec router books).
9. Drift CI guard `src/emails/` ↔ `worker/emails/`. → Phase 2 (suivi 1B reporté).
10. Smoke staging Coolify Resend DNS. → Pré-prod ops indépendante.
11. Storybook composants admin. → Hors-scope toutes phases sauf demande explicite.
12. Champ `User.twoFactorRequiredBy` (re-déclenchement 7j sur promotion). → Phase 2 si gating fort requis.

## 13. Estimation effort

Basé sur vélocité Phase 1B (28 commits, 7 jours wall, 17 tasks acted en 19) :

| Module                    | Effort                    | Tasks plan    |
| ------------------------- | ------------------------- | ------------- |
| 0 — Plumbing & dette 1B   | 1 jour                    | ~3            |
| 1 — Users panel admin     | 2-2.5 jours               | ~5            |
| 2 — Libraries panel admin | 2-2.5 jours               | ~5            |
| 3 — Account self-service  | 2.5-3 jours               | ~6            |
| 4 — Matrice + closure     | 1.5-2 jours               | ~4            |
| **Total**                 | **~9-11 jours wall-time** | **~23 tasks** |

Plan détaillé à rédiger : `docs/superpowers/plans/2026-04-28-phase-1c-admin-account.md` (via `superpowers:writing-plans` post-validation).

## 14. Décisions actées (récap brainstorming)

- **Q1 — Scope panel admin** : B (Users + Libraries). Pas d'audit viewer global, pas de dashboard.
- **Q2 — Scope `/account`** : B (Profil + Sécurité). Email immuable 1C.
- **Q3 — Matrice rôles** : B (matrice testable + helper générique). Pas de lint rule custom (Phase 2).
- **Q4 — Politique changePassword** : B (kill autres sessions, garder courante) + Oui (confirmation password actuel).
- **Q5a — Sessions UI métadonnées** : B (`userAgentLabel` clair stocké séparément, pas de geo-IP).
- **Q5b — Session courante** : badge + revoke disabled.
- **Q6a — Re-enroll 2FA** : B (backup code + fallback admin si épuisé).
- **Q6b — Regen backup codes** : password + TOTP + affichage one-time.
- **Q6c — Disable 2FA GLOBAL_ADMIN admin** : pas d'override UI, runbook DBA.
- **Q7 — Suivis 1B** : 1, 2, 5 in 1C ; 3, 4 reportés.
- **Q8 — Layout admin** : top nav initialement, **uniformisé en sidebar** (admin + account).

## 15. Références

- Design doc projet : `docs/superpowers/specs/2026-04-25-biblioshare-design.md`
- ADR permissions : `docs/adr/0003-permissions-model.md`
- Phase 1A spec : `docs/superpowers/specs/2026-04-26-phase-1-auth-design.md`
- Phase 1B spec : `docs/superpowers/specs/2026-04-27-phase-1b-invitations-reset-design.md`
- Phase 1A clôture (memory) : `project_phase_1a_completed.md`
- Phase 1B clôture (memory) : `project_phase_1b_completed.md`
