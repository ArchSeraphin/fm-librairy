# ADR 0003 — Modèle de permissions

**Date** : 2026-04-25
**Statut** : Accepté

## Contexte

BiblioShare gère plusieurs bibliothèques avec des accès différenciés. Le brief demande un modèle « clair et testable » avec une matrice rôles/actions. Trois modèles ont été envisagés.

## Décision

**Modèle à 3 rôles hiérarchiques** :

1. **Admin global** (sur `User.role`) : crée bibliothèques, comptes système, modifie rôles. 2FA obligatoire. Toutes ses actions dans `AuditLog`.
2. **Admin de bibliothèque** (sur `LibraryMember.role`) : gère membres et catalogue de **sa** bibliothèque uniquement. Ne peut pas promouvoir/rétrograder d'autres admins de sa biblio (réservé Admin global).
3. **Membre** (sur `LibraryMember`) : permissions par bibliothèque modulées par flags `canRead`, `canUpload`, `canDownload`.

**Invariants forts** :
- Les annotations privées (`Annotation`, `Bookmark`, `ReadingProgress`, `ReadingSession`) sont strictement privées. Aucun rôle, y compris Admin global, ne peut les lire.
- Tout refus de permission = HTTP 403 + entrée `AuditLog`.
- Tout download est loggué dans `DownloadLog` **avant** le début du stream (transactionnel).

**Implémentation defense in depth, 3 couches** :
1. Couche tRPC procedure : middleware `requirePermission(perm)` charge `LibraryMember` et vérifie.
2. Couche service : helper `assertCan*(user, resource)`, indépendant de tRPC.
3. Couche DB : queries Prisma avec scope toujours présent. Lint rule custom interdit `findMany`/`findFirst` sans `where`.

**Pour les annotations privées** : type Brand TypeScript `PrivateScope` non-construisible hors d'un helper `withCurrentUserScope(userId)`. Toute query annotation/bookmark/progress doit recevoir ce type. Compile error si oubli.

## Alternatives considérées

- **Modèle 1 — 2 rôles (Admin global / Membre)** : plus simple mais ne permet pas de déléguer l'admin d'une bibliothèque, ce qui devient critique à scaling 500 users.
- **Modèle 3 — Permissions granulaires (capabilities)** : très flexible mais complexité UX réelle (panel admin chargé), plus de surface pour bugs sécurité. YAGNI à l'échelle cible.

## Conséquences

**Positives** :
- Modèle clair, 3 rôles nommés.
- Délégation possible (Admin biblio) sans donner les clefs du royaume.
- Defense in depth → un oubli à une couche n'expose pas les données.
- Tests systématiques par cellule de la matrice.

**Négatives** :
- Légère friction : Admin biblio doit demander à Admin global pour promouvoir un autre admin (acceptable).
- Coût initial de mise en place du type `PrivateScope` et de la lint rule (compense largement le risque évité).

**Tests obligatoires** : pour chaque ligne de la matrice, un test « happy path » et un test « unauthorized ». TDD.
