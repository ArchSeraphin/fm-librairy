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
