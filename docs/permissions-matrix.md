# Matrice de permissions BiblioShare

> Source de vérité executable : `tests/integration/permissions-matrix.test.ts`. Cette page est régénérée à la main à chaque modification du test (script auto Phase 2).

Légende : ✓ allow · ✗ deny · `(*)` voir contraintes au bas de table.

## admin.users (global admin only)

| Procedure          | GLOBAL_ADMIN | LIBRARY_ADMIN | MEMBER | ANON | PENDING_2FA |
| ------------------ | ------------ | ------------- | ------ | ---- | ----------- |
| list               | ✓            | ✗             | ✗      | ✗    | ✗           |
| get                | ✓            | ✗             | ✗      | ✗    | ✗           |
| suspend            | ✓ (1)        | ✗             | ✗      | ✗    | ✗           |
| reactivate         | ✓            | ✗             | ✗      | ✗    | ✗           |
| delete             | ✓ (1)(2)     | ✗             | ✗      | ✗    | ✗           |
| changeRole         | ✓ (1)        | ✗             | ✗      | ✗    | ✗           |
| resetTwoFactor     | ✓ (3)        | ✗             | ✗      | ✗    | ✗           |
| invitations.list   | ✓            | ✗             | ✗      | ✗    | ✗           |
| invitations.revoke | ✓            | ✗             | ✗      | ✗    | ✗           |
| sessions.list      | ✓            | ✗             | ✗      | ✗    | ✗           |
| audit.list         | ✓            | ✗             | ✗      | ✗    | ✗           |

(1) Refuse si target = self ou si target est le **dernier GLOBAL_ADMIN actif**.
(2) Exige `confirmEmail` matching strictement l'email cible (anti-mistake).
(3) Refuse si target a `role = 'GLOBAL_ADMIN'` (runbook DBA `docs/runbooks/disable-2fa-global-admin.md`).

## admin.libraries (global admin only)

| Procedure           | GLOBAL_ADMIN | LIBRARY_ADMIN | MEMBER | ANON | PENDING_2FA |
| ------------------- | ------------ | ------------- | ------ | ---- | ----------- |
| list                | ✓            | ✗             | ✗      | ✗    | ✗           |
| get                 | ✓            | ✗             | ✗      | ✗    | ✗           |
| create              | ✓            | ✗             | ✗      | ✗    | ✗           |
| rename              | ✓ (4)        | ✗             | ✗      | ✗    | ✗           |
| archive             | ✓            | ✗             | ✗      | ✗    | ✗           |
| unarchive           | ✓            | ✗             | ✗      | ✗    | ✗           |
| members.list        | ✓            | ✗             | ✗      | ✗    | ✗           |
| members.add         | ✓ (4)        | ✗             | ✗      | ✗    | ✗           |
| members.remove      | ✓ (4)(5)     | ✗             | ✗      | ✗    | ✗           |
| members.changeRole  | ✓ (4)(5)     | ✗             | ✗      | ✗    | ✗           |
| members.updateFlags | ✓ (4)(6)     | ✗             | ✗      | ✗    | ✗           |

(4) Refuse si library archived (`archivedAt != null`).
(5) Refuse si retire/rétrograde le **dernier `LIBRARY_ADMIN`** de la biblio.
(6) Refuse si tous les flags sont `false` (au moins un doit être `true`).

## account.profile (authed)

| Procedure | GLOBAL_ADMIN | LIBRARY_ADMIN | MEMBER | ANON | PENDING_2FA |
| --------- | ------------ | ------------- | ------ | ---- | ----------- |
| get       | ✓            | ✓             | ✓      | ✗    | ✗           |
| update    | ✓            | ✓             | ✓      | ✗    | ✗           |

## account.security (authed)

| Procedure               | GLOBAL_ADMIN | LIBRARY_ADMIN | MEMBER | ANON | PENDING_2FA |
| ----------------------- | ------------ | ------------- | ------ | ---- | ----------- |
| changePassword          | ✓ (7)        | ✓ (7)         | ✓ (7)  | ✗    | ✗           |
| listSessions            | ✓            | ✓             | ✓      | ✗    | ✗           |
| revokeSession           | ✓ (8)        | ✓ (8)         | ✓ (8)  | ✗    | ✗           |
| revokeAllOtherSessions  | ✓            | ✓             | ✓      | ✗    | ✗           |
| regenerateBackupCodes   | ✓ (9)        | ✓ (9)         | ✓ (9)  | ✗    | ✗           |
| startReEnrollWithBackup | ✗ (10)       | ✓ (9)         | ✓ (9)  | ✗    | ✗           |

(7) Refuse `newPassword === currentPassword`. Verify password actuel ; échec → log Pino, rate-limiter `passwordChangeLimiter` 5/h. Kill toutes sessions sauf courante au succès.
(8) Refuse session courante (utiliser logout). Anti-IDOR : session d'un autre user → `NOT_FOUND` (pas `FORBIDDEN`).
(9) Refuse si `twoFactorEnabled === false` → `PRECONDITION_FAILED`.
(10) Refuse pour `GLOBAL_ADMIN` → runbook DBA.

## Hors-1C

Routers `auth.*`, `invitation.*`, `password.*` couverts par leurs propres tests Phase 1A/1B (déjà inclus dans la matrice via le test anti-drift).

## library.files (members + admins)

| Procedure | GLOBAL_ADMIN | LIBRARY_ADMIN | MEMBER | ANON | PENDING_2FA |
| --------- | ------------ | ------------- | ------ | ---- | ----------- |
| get       | ✓            | ✓             | ✓      | ✗    | ✗           |
| delete    | ✓            | ✓             | ✗      | ✗    | ✗           |

`delete` est soumis au rate-limiter `libraryFileDeleteLimiter` (5 req/min par user×library) ; un dépassement renvoie `TOO_MANY_REQUESTS` avant la suppression physique du fichier. La suppression nettoie également le fichier de staging côté serveur (`rm --force`).

`uploadBookFile` est une Server Action (non-tRPC) — couvert par `tests/integration/upload-action-attacks.test.ts`.
