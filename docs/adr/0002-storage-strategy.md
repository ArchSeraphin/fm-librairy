# ADR 0002 — Stratégie de stockage des fichiers

**Date** : 2026-04-25
**Statut** : Accepté

## Contexte

BiblioShare doit stocker des fichiers livres (epub, pdf, txt, docx jusqu'à 100 Mo), des couvertures, et des conversions cachées. Volumes cibles : 500-2000 livres an 1, scaling 10k. Sécurité prioritaire (path traversal, MIME spoofing, accès non autorisé).

## Décision

**Stockage filesystem local sur le VPS, hors du webroot, accès uniquement via endpoints authentifiés du backend.**

Structure :
- `/uploads/{libraryId}/{bookId}/{format}-{sha256[:8]}.{ext}` — fichiers livres (originaux + conversions).
- `/uploads-staging/` — quarantaine pré-scan ClamAV.
- `/covers/` — cache local des couvertures.

Chemins **générés côté serveur uniquement** (jamais dérivés du nom client).

Une **abstraction `FileStorage`** est introduite dès la Phase 0 (interface avec `put`, `get`, `delete`, `getSignedUrl`). L'implémentation initiale est filesystem local. Une implémentation S3-compatible peut être ajoutée plus tard sans refonte du code applicatif.

## Alternatives considérées

- **MinIO** (S3-compatible self-hosted) : overkill à l'échelle cible, complexité ops supplémentaire, RAM consommée.
- **S3 OVH ou autre cloud** : coût récurrent, latence, dépendance externe pour un projet self-hosted par principe.

## Conséquences

**Positives** :
- Simplicité opérationnelle maximale.
- Pas de coût récurrent.
- Backups directs via volume monté (borgbackup couvre filesystem).
- Performance : accès local, pas de latence réseau.

**Négatives** :
- Couplé à une seule machine (pas de scale horizontal natif). Acceptable à l'échelle cible.
- Doit gérer manuellement les permissions filesystem dans le container.

**Sécurité** :
- Volume monté hors du webroot → impossible d'y accéder via URL directe.
- Endpoints `/download` et `/cover` font le check d'auth + permissions avant de stream le fichier.
- URLs signées (HMAC + expiration 5 min) pour le download effectif.
- `path.resolve` vérifie que le chemin résolu reste dans le base path autorisé (anti-traversal).

**Réversibilité** : grâce à l'abstraction `FileStorage`, migration vers S3 possible en une seule PR si besoin futur.
