# ADR 0004 — Stratégie de sauvegarde

**Date** : 2026-04-25
**Statut** : Accepté

## Contexte

BiblioShare est self-hosted. Perte de données = perte définitive (pas de provider cloud avec snapshots). Un NAS personnel est disponible pour héberger les backups via SSH. Risque ransomware réel à considérer.

## Décision

**borgbackup en mode push depuis le VPS vers le NAS, dépôt en mode `append-only`.**

- Cron quotidien 03:00 sur le VPS lance `borg create` puis `borg prune`.
- Le NAS expose un dépôt borg via SSH avec une clé dédiée et la commande forcée `borg serve --append-only`.
- Conséquence : le VPS peut **ajouter** des sauvegardes mais **ne peut pas en supprimer** (protection ransomware).
- Repo borg chiffré au repos (passphrase indépendante de la clé SSH, stockée dans gestionnaire de mots de passe + papier en lieu sûr).
- Rétention : 7 quotidiens / 4 hebdomadaires / 12 mensuels.
- Couvre :
  - Dump PostgreSQL (`pg_dump --format=custom`) → fichier dans volume backups avant snapshot.
  - Volume `uploads/` (fichiers livres).
  - Volume `covers/` (cache couvertures).
  - Snapshot Meilisearch (via API `/dumps`).
  - Configuration Coolify (hors secrets).
- **Test de restauration mensuel automatisé** : déchiffrement dans volume isolé, vérification checksum d'un échantillon, suppression. Échec → email Admin global.

## Alternatives considérées

- **rsync simple** : pas de déduplication (rétention longue très coûteuse en espace), pas de chiffrement client-side, pas de protection ransomware native (le VPS peut écraser/supprimer les fichiers existants).
- **restic** : équivalent fonctionnel à borg, choisi borg pour le mode `append-only` natif via SSH command.
- **Snapshots OVH** : payant, non testé pour les usages BiblioShare, dépendance fournisseur.

## Conséquences

**Positives** :

- Déduplication efficace → 7+4+12 backups = très peu d'espace réel sur le NAS.
- Chiffrement bout-en-bout → si le NAS est compromis, données illisibles.
- Mode append-only → protection contre ransomware sur le VPS.
- Test de restauration automatisé → garantit que les backups sont effectivement utilisables.

**Négatives** :

- Si la passphrase est perdue, les backups sont irrécupérables. Mitigation : double stockage (gestionnaire + papier).
- Si la clé SSH du VPS est compromise, l'attaquant peut **lire** les anciens backups (déchiffrables uniquement avec la passphrase, qui n'est pas sur le VPS) et **ajouter** des fichiers, mais **ne peut pas effacer**.

**Critère de validation** : sinistre simulé (perte VPS) → restauration complète en < 2h, données intègres. À jouer en Phase 8.
