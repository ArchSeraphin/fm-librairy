# BiblioShare

Webapp self-hosted de gestion collective de bibliothèques numériques (epub, pdf, txt, docx) et physiques. Liseuse en ligne avec annotations privées, outils sociaux légers, administration fine des accès.

> Statut : **Phase 1A — Auth core livrée**. Voir [`docs/superpowers/specs/2026-04-25-biblioshare-design.md`](docs/superpowers/specs/2026-04-25-biblioshare-design.md) pour le design global.

## Stack

- Next.js 15 (App Router), TypeScript strict
- Prisma 6 + PostgreSQL 16
- Auth.js v5 + 2FA TOTP (Phase 1)
- Meilisearch 1.x, Redis 7 + BullMQ
- ClamAV daemon, Calibre `ebook-convert`
- Tailwind 3.4 + shadcn/ui + Lucide icons
- Vitest + Playwright

## Démarrage rapide

### Prérequis

- Node.js 22+
- pnpm 9+ (`corepack enable && corepack prepare pnpm@9 --activate`)
- Docker Desktop ou Docker Engine + Docker Compose v2

### Installation

```bash
git clone <repo-url> biblioshare
cd biblioshare

# Dépendances
pnpm install
pnpm prisma:generate

# Variables d'environnement (mode dev local)
cp .env.example .env.local
sed -i.bak \
  -e "s/please-generate-with-openssl-rand-hex-32/$(openssl rand -hex 32)/g" \
  -e "s/please-change-me-min-16-chars/$(openssl rand -hex 16)/g" \
  -e "s/please-change-me-in-prod/$(openssl rand -hex 16)/g" \
  .env.local
rm -f .env.local.bak

# Variables d'environnement (mode docker-compose)
cp .env.example .env
sed -i.bak \
  -e "s/please-generate-with-openssl-rand-hex-32/$(openssl rand -hex 32)/g" \
  -e "s/please-change-me-min-16-chars/$(openssl rand -hex 16)/g" \
  -e "s/please-change-me-in-prod/$(openssl rand -hex 16)/g" \
  .env
rm -f .env.bak
```

> **Note** : `SESSION_SECRET` et `CRYPTO_MASTER_KEY` exigent min 32 chars, `MEILI_MASTER_KEY` min 16 chars (validé par `src/lib/env.ts`). Les commandes `sed` ci-dessus génèrent des secrets conformes.

### Lancer la stack complète (Docker)

```bash
docker compose up -d --build

# Première fois : appliquer la migration Prisma
docker compose exec app pnpm prisma:migrate:deploy
```

> **Note** : si la commande échoue avec `EROFS` (read-only filesystem), exécuter la migration depuis l'hôte avec `DATABASE_URL` explicite (cf. mode dev ci-dessous). Le container `app` est `read_only: true` par sécurité ; Prisma CLI peut tenter d'écrire des binaires d'engine en cache.

L'app est disponible sur http://localhost:3000. Healthcheck : http://localhost:3000/api/health.

### Mode dev (Next.js local + services Docker)

```bash
# Démarrer uniquement les dépendances
docker compose up -d pg redis meili clamav

# Migrer la DB (depuis l'hôte)
DATABASE_URL=postgresql://biblioshare:$(grep ^POSTGRES_PASSWORD .env | cut -d= -f2)@localhost:5432/biblioshare \
  pnpm prisma:migrate:dev

# Lancer Next.js en local (hot reload)
pnpm dev
```

> **Note** : pour ce mode, exposer temporairement le port 5432 de `pg` dans `docker-compose.yml`, ou utiliser un tunnel.

## Scripts pnpm

| Script                       | Description                           |
| ---------------------------- | ------------------------------------- |
| `pnpm dev`                   | Next.js dev server avec hot reload    |
| `pnpm build`                 | Build production                      |
| `pnpm start`                 | Lancer le build production            |
| `pnpm lint`                  | ESLint                                |
| `pnpm typecheck`             | Vérification TypeScript               |
| `pnpm format`                | Prettier write                        |
| `pnpm format:check`          | Prettier check                        |
| `pnpm test`                  | Tests unitaires Vitest                |
| `pnpm test:watch`            | Vitest watch mode                     |
| `pnpm test:coverage`         | Tests Vitest avec couverture          |
| `pnpm e2e`                   | Tests Playwright                      |
| `pnpm e2e:ui`                | Playwright en mode UI                 |
| `pnpm prisma:generate`       | Régénérer le client Prisma            |
| `pnpm prisma:migrate:dev`    | Créer/appliquer une migration en dev  |
| `pnpm prisma:migrate:deploy` | Appliquer les migrations en prod      |
| `pnpm prisma:studio`         | UI graphique Prisma                   |
| `pnpm env:check`             | Valider les variables d'environnement |

## Structure du projet

```
src/
  app/             Pages et API routes (Next.js App Router)
  components/ui/   Primitives UI (shadcn/ui adapté)
  hooks/           Hooks React partagés
  i18n/            Traductions et config next-intl
  lib/             Helpers (db, redis, meili, env, logger, private-scope)
worker/            Service de jobs asynchrones (BullMQ, build séparé)
prisma/            Schéma + migrations
tests/
  unit/            Tests Vitest
  e2e/             Tests Playwright
docs/
  adr/                  Architecture Decision Records
  superpowers/specs/    Spécifications de design
  superpowers/plans/    Plans d'implémentation par phase
  security/             Documentation sécurité (OWASP, threat model)
  deployment.md         Guide Coolify
eslint-rules/      Règles ESLint custom (plugin local)
```

## Authentification (Phase 1A)

BiblioShare utilise Auth.js v5 avec un Credentials provider, des sessions DB hardenées (rotation, expiration absolue 30j / inactive 7j, fingerprint UA+IP), et un 2FA TOTP obligatoire pour les Admin globaux après 7 jours.

### Bootstrap initial

Voir [`docs/deployment.md`](docs/deployment.md) section « Initialisation post-déploiement ».

```bash
BOOTSTRAP_ADMIN_EMAIL=ops@example.test pnpm bootstrap:admin
```

La commande affiche email, mot de passe initial et délai (7j) avant que le 2FA ne devienne obligatoire.

### Architecture

- Spec design : [`docs/superpowers/specs/2026-04-26-phase-1-auth-design.md`](docs/superpowers/specs/2026-04-26-phase-1-auth-design.md)
- Plan d'implémentation : [`docs/superpowers/plans/2026-04-26-phase-1a-auth-core.md`](docs/superpowers/plans/2026-04-26-phase-1a-auth-core.md)
- Hardening pass : [`docs/superpowers/plans/2026-04-27-phase-1a-hardening.md`](docs/superpowers/plans/2026-04-27-phase-1a-hardening.md)

## Sécurité

- 11 risques critiques identifiés et mitigés (cf. design doc).
- Headers de sécurité actifs (HSTS, X-Frame-Options DENY, X-Content-Type-Options, Referrer-Policy, Permissions-Policy).
- Lint rule `local/no-unscoped-prisma` interdit les queries Prisma sans scope (anti-IDOR).
- Type Brand `PrivateScope` pour annotations strictement privées par construction.
- Secrets dans `.env.local` (jamais committés). `gitleaks` en CI.
- ClamAV obligatoire avant publication d'un fichier (Phase 2).

Voir [`docs/security/owasp-mapping.md`](docs/security/owasp-mapping.md) pour la couverture OWASP _(à venir — Task 25)_.

## Déploiement

Voir [`docs/deployment.md`](docs/deployment.md) pour le guide Coolify pas-à-pas _(à venir — Task 24)_.

## Roadmap

| Phase | Titre                                    | Statut   |
| ----- | ---------------------------------------- | -------- |
| 0     | Fondations                               | complète |
| 1A    | Auth core (login + 2FA + admin)          | complète |
| 1B    | Invitations + reset password             | à venir  |
| 2     | Catalogue, upload, ClamAV, métadonnées   | à venir  |
| 3     | Liseuse, annotations, sync               | à venir  |
| 4     | Recherche, tags, collections             | à venir  |
| 5     | Conversion, téléchargements              | à venir  |
| 6     | Livres physiques                         | à venir  |
| 7     | Social, stats                            | à venir  |
| 7.5   | Recette utilisateur en local             | à venir  |
| 8     | Backups NAS, monitoring, hardening final | à venir  |

## Licence

Privée. Tous droits réservés.
