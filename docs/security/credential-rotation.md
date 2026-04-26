# Calendrier de rotation des credentials

Tous les secrets sont en variables d'environnement, jamais en code, jamais loggués (redact pino).

| Credential                 | Localisation              | Rotation                       | Procédure                                                                                                                                              |
| -------------------------- | ------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POSTGRES_PASSWORD`        | Coolify env               | 12 mois                        | Générer nouveau, modifier env, redémarrer `pg` + `app`.                                                                                                |
| `MEILI_MASTER_KEY`         | Coolify env               | 6 mois                         | Générer nouveau, modifier env, redémarrer `meili` + `app`. Réindexation possible si Meili la requiert.                                                 |
| `SESSION_SECRET`           | Coolify env               | 6 mois                         | Générer nouveau (`openssl rand -hex 32`), modifier env, redémarrer `app`. **Effet : invalide toutes les sessions** (les users devront se reconnecter). |
| `CRYPTO_MASTER_KEY`        | Coolify env               | 12 mois                        | **ATTENTION** : rotation complexe, déchiffre/rechiffre tous les `TwoFactorSecret.secretCipher`. Procédure dédiée à écrire (Phase 8).                   |
| `RESEND_API_KEY`           | Coolify env               | 6 mois                         | Régénérer dans dashboard Resend, modifier env, redémarrer `app`.                                                                                       |
| `GOOGLE_BOOKS_API_KEY`     | Coolify env               | 12 mois                        | Régénérer dans Google Cloud Console.                                                                                                                   |
| `ISBNDB_API_KEY`           | Coolify env               | 12 mois                        | Régénérer dans dashboard ISBNdb.                                                                                                                       |
| Borg passphrase            | Gestionnaire MdP + papier | jamais (sans procédure dédiée) | Si nécessaire : créer un nouveau dépôt borg avec nouvelle passphrase, migrer les sauvegardes.                                                          |
| Clés SSH VPS ↔ NAS         | `~/.ssh/` sur VPS         | 12 mois                        | Générer nouvelle paire, ajouter authorized_keys NAS, retirer ancienne.                                                                                 |
| Mot de passe admin Coolify | gestionnaire MdP          | 6 mois                         | UI Coolify.                                                                                                                                            |

**Calendrier suivi** : un événement récurrent dans le calendrier personnel rappelle chaque rotation. Toutes les rotations sont consignées dans `AuditLog` (rotation manuelle) ou commit Git (rotation env vars).

**Procédure d'urgence** (compromission suspectée) : tout rotater dans l'heure, déconnecter tous les users (rotation `SESSION_SECRET`), notifier les admins.
