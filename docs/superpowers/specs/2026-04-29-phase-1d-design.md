# Phase 1D — Design : router `library.books` (catalogue + manual create)

**Date** : 2026-04-29
**Statut** : Design approuvé — prêt pour `writing-plans`
**Auteur** : ArchSeraphin (brainstorming session avec assistant)
**Contexte** : Suite de Phase 1C clôturée le 2026-04-29 (PR #19, tag `phase-1c-complete`). Design original (`docs/superpowers/specs/2026-04-25-biblioshare-design.md`) place le catalogue + upload + ClamAV + métadonnées en Phase 2 et la liseuse en Phase 3. Cette Phase 1D est une étape intermédiaire de "browsing read-only + manual create" qui ouvre le premier router `library.books`, valide le scoping membership en conditions réelles, et solde cinq dettes techniques héritées de 1C avant que la Phase 2 ne les amplifie.

## 1. Objectifs & non-objectifs

### Objectifs

- Ouvrir le premier router `library.books` avec scoping membership defense-in-depth.
- Permettre à un Library Admin de peupler manuellement son catalogue (métadonnées seules, pas d'upload).
- Donner aux Members une UX de catalogue navigable + recherchable (jusqu'à ~2000 livres) sans dépendance Meilisearch.
- Inaugurer l'espace user-facing (`/libraries`, `/library/[slug]/...`) avec un `MemberHeader` réutilisable.
- Solder cinq dettes 1C (E2E regex, CI scope, drift guard email, lint rule Prisma scope, doc session-bridge) avant que la Phase 2 ne les amplifie.

### Non-objectifs (explicitement reportés)

- Upload de fichier, scan ClamAV, dedup SHA-256, MIME réel → **Phase 2**.
- Métadonnées auto (Google Books / Open Library / ISBNdb) + cache couvertures → **Phase 2**.
- Tags (`BookTag`/`Tag`) → **Phase 2** (auto-tags depuis métadonnées).
- Workflow `PhysicalRequest` (prêt entre voisins) → **Phase 2 ou 3**.
- Liseuse en ligne (epub.js / pdf.js) → **Phase 3**.
- Annotations / Bookmarks / ReadingProgress → **Phase 3**.
- Audit log viewer global, hard-delete-library runbook → Phase 2/3.

## 2. Décisions verrouillées en brainstorming

| # | Décision | Choix |
|---|---|---|
| Q1 | Découpage Phase 1D vs 2 | A — sous-ensemble pré-upload, fidèle au design original |
| Q2 | Niveau d'écriture en 1D | B — `list`/`get` + admin manual `create` (sans fichier), tags reportés |
| Q3 | Niveau de richesse `list` | B — pagination + recherche Postgres `tsvector` + filtres `hasDigital`/`hasPhysical`/`language` (pas de Meili) |
| Q4 | Dettes 1C absorbées | A — toutes (5 + bonus runbook hard-delete-book) |
| Q5 | Mental model multi-bibliothèques | A — drill-in `/libraries` → `/library/[slug]/books`, + `MemberHeader` + library switcher |
| Q6 | Scope CRUD Book en 1D | A + nuances — `create` + `update` + `archive`/`unarchive` + `delete` (GLOBAL_ADMIN only) ; `coverPath` = URL HTTPS optionnelle ; `physicalCopies.count` read-only |

## 3. Architecture en un coup d'œil

```
┌──────────────────────────────────────────────────────────────────┐
│  Browser                                                         │
│  /libraries                  liste libs accessibles              │
│  /library/[slug]/books       catalogue + search + filters        │
│  /library/[slug]/books/new   form admin manual create            │
│  /library/[slug]/books/[id]  fiche livre + edit/archive          │
└─────────────────────┬────────────────────────────────────────────┘
                      │ tRPC over HTTP (existing pattern)
┌─────────────────────▼────────────────────────────────────────────┐
│  Next.js server                                                  │
│  routers/library/books.ts   list/get/create/update/archive/...   │
│  routers/library/index.ts   nouveau namespace                    │
│  helpers/                                                        │
│    library-membership.ts   assertMembership(slug, role?)         │
│    book-admin.ts           assertNotArchived, applyEdit, ...     │
│    book-search.ts          buildSearchQuery (tsvector raw SQL)   │
│  rate-limiters/library-books.ts  per-action limiters             │
└─────────────────────┬────────────────────────────────────────────┘
                      │ Prisma
┌─────────────────────▼────────────────────────────────────────────┐
│  PostgreSQL                                                      │
│  + Book.archivedAt        nullable, soft-delete pattern          │
│  + Book.searchVector      tsvector GENERATED ALWAYS AS           │
│  + GIN index on searchVector                                     │
│  + index (libraryId, archivedAt)                                 │
└──────────────────────────────────────────────────────────────────┘

  Worker BullMQ : aucun nouveau job en 1D.
  Phase 2 ajoutera scan-clamav, extract-metadata, fetch-cover.
```

**Aucune nouvelle dépendance d'infra** : pas de Meilisearch container, pas de S3/MinIO, pas de ClamAV branché. Aucun nouveau job BullMQ. Aucune nouvelle env var de runtime.

## 4. Data model — migration unique 1D

Fichier : `prisma/migrations/2026XXXX_phase_1d_books/migration.sql`

```sql
-- 1. Soft-delete pattern (cohérent avec Library.archivedAt)
ALTER TABLE "Book" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- 2. Extension unaccent (recherche FR/EN insensible aux accents)
CREATE EXTENSION IF NOT EXISTS unaccent;

-- 3. Full-text search column (Postgres-generated, zéro maintenance app-side)
ALTER TABLE "Book" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', unaccent(coalesce(title, ''))), 'A') ||
    setweight(to_tsvector('simple', unaccent(coalesce(authors, ''))), 'B') ||
    setweight(to_tsvector('simple', unaccent(coalesce(description, ''))), 'C') ||
    setweight(to_tsvector('simple', unaccent(coalesce(publisher, ''))), 'D')
  ) STORED;

-- 4. Indexes
CREATE INDEX "Book_searchVector_gin_idx" ON "Book" USING GIN ("searchVector");
CREATE INDEX "Book_libraryId_archivedAt_idx" ON "Book" ("libraryId", "archivedAt");
```

**Rationale config `'simple'` + `unaccent`** :

- `'simple'` (au lieu de `'french'`/`'english'`) évite le stemming. Catalogue multilingue (cible FR principale mais auteurs/titres internationaux), `'simple'` évite les fausses correspondances de stemming inter-langues.
- `unaccent` (extension Postgres standard, présente sur OVH PG16) couvre l'invariant `Müller` ≈ `muller`, `Café` ≈ `cafe`, `François` ≈ `Francois`. Critique pour un catalogue FR.
- Phase 4 / Meili règlera le multilingue propre (analyse par langue via `language` field).

Côté `schema.prisma` : `searchVector` typé `Unsupported("tsvector")?`. Prisma ne génère pas ce type, on requête en `$queryRaw` quand nécessaire — le router fait la requête textuelle dans un helper isolé `lib/book-search.ts`, le reste reste idiomatique Prisma. L'index GIN est utilisé automatiquement par les `WHERE searchVector @@ ...`.

## 5. Router `library.books` — surface API

Namespace nouveau : `library` (parallèle à `admin`, `account`). Sous-router `books`.

| Procédure | Type | Rôles autorisés | Limiter | Notes |
|---|---|---|---|---|
| `library.books.list` | query | Membership any role + GLOBAL_ADMIN | `listLimiter` | Input `{ q?, hasDigital?, hasPhysical?, language?, sort, cursor?, limit, includeArchived? }`. `limit` default 24, max 100, validé Zod. Retourne `{ items, nextCursor }`. `includeArchived` accepté pour tous mais **silently coerced à `false` pour non-admin** (pas d'erreur, juste filtre archived appliqué côté server). |
| `library.books.get` | query | Membership any role + GLOBAL_ADMIN | `listLimiter` | Inclut `physicalCopies._count` read-only. Pour non-admin : si `archivedAt != null` → `NOT_FOUND` (le livre n'existe pas pour eux). |
| `library.books.create` | mutation | LIBRARY_ADMIN (this lib) + GLOBAL_ADMIN | `createLimiter` (5/min/user) | Métadonnées only, `coverPath` = URL HTTPS optionnelle, audit `book.created` |
| `library.books.update` | mutation | LIBRARY_ADMIN (this lib) + GLOBAL_ADMIN | `updateLimiter` (10/min/user) | Concurrency check optimiste : input inclut `expectedUpdatedAt: Date`, le router compare avec la valeur DB et throw `CONFLICT` (TRPCError code) si mismatch. UI affiche "Le livre a été modifié par un autre admin, recharger ?". Audit `book.updated` avec diff. |
| `library.books.archive` | mutation | LIBRARY_ADMIN (this lib) + GLOBAL_ADMIN | `updateLimiter` | Set `archivedAt = now()` ; refuse si déjà archived (BAD_REQUEST) ; audit `book.archived` |
| `library.books.unarchive` | mutation | LIBRARY_ADMIN (this lib) + GLOBAL_ADMIN | `updateLimiter` | Clear `archivedAt` ; refuse si pas archived ; audit `book.unarchived` |
| `library.books.delete` | mutation | **GLOBAL_ADMIN only** | `deleteLimiter` (1/h/user) | Hard delete, refuse si `_count.bookFiles > 0` OR `_count.physicalCopies > 0` OR `_count.annotations > 0` etc. ; audit `book.deleted` ; runbook DBA obligatoire |

### Helpers

- `lib/library-membership.ts::assertMembership(ctx, slug, requiredRole?)` — résout `Library` par `slug`, vérifie `LibraryMember` (ou GLOBAL_ADMIN bypass), throws `FORBIDDEN`/`NOT_FOUND` selon. Réutilisé par tous les futurs routers `library.*`.
- `lib/book-admin.ts::assertBookInLibrary(bookId, libraryId)` — garantit pas de cross-library access via id-guessing → `NOT_FOUND` si mismatch.
- `lib/book-admin.ts::assertNotArchived(book)` — pattern soft-delete (sauf `unarchive` qui exige l'inverse).
- `lib/book-admin.ts::assertNoBookDependencies(bookId)` — utilisé par `delete`, lève si `BookFile`/`PhysicalCopy`/`Annotation`/`Bookmark`/`ReadingProgress` rattachés.
- `lib/book-search.ts::buildSearchQuery({ q, libraryId, filters, sort, cursor, limit })` — encapsule le raw SQL tsvector → renvoie `{ items, nextCursor }`. Tous les bindings via `Prisma.sql` (zéro injection).

### Audit log

Audit union 1D étendue : `book.created`, `book.updated`, `book.archived`, `book.unarchived`, `book.deleted`. Toutes scopées `libraryId` + `bookId`. `book.deleted` audit-log inclut un snapshot complet du livre supprimé (legal hold).

## 6. UI — pages + composants

### Nouveau route group `(member)`

Sous `app/(member)/...` — segment route group nouveau, parallèle à `(admin)` et `(account)`.

| Page | Path | Rôle minimum |
|---|---|---|
| Liste libs accessibles | `/libraries` | Membership any role + GLOBAL_ADMIN |
| Layout member (header + sidebar) | `/library/[slug]/...` | Membership de cette lib + GLOBAL_ADMIN |
| Catalogue | `/library/[slug]/books` | Membership any role |
| Création livre | `/library/[slug]/books/new` | LIBRARY_ADMIN this lib + GLOBAL_ADMIN |
| Fiche livre | `/library/[slug]/books/[bookId]` | Membership any role |

### Nouveaux composants (tous réutilisables Phase 2+)

- `components/member/member-header.tsx` — parallèle de `admin-header.tsx`, burger drawer mobile (Sheet shadcn, pattern 1C), library switcher combobox.
- `components/member/library-switcher.tsx` — combobox shadcn `cmdk`, persist sélection en localStorage + URL slug source de vérité.
- `components/books/book-card.tsx` — card livre (cover URL externe + title + authors + badges hasDigital/hasPhysical).
- `components/books/book-search-bar.tsx` — debounced (300ms), query string `?q=`.
- `components/books/book-filters.tsx` — toggles hasDigital/hasPhysical, select language, query string source de vérité.
- `components/books/book-sort-select.tsx` — `title_asc | createdAt_desc | createdAt_asc`.
- `components/books/book-list-grid.tsx` — grid responsive (1/2/3/4 cols), skeleton loading.
- `components/books/book-form.tsx` — form create/update partagé, `react-hook-form` + Zod resolver.
- `components/books/book-archive-dialog.tsx`, `book-unarchive-dialog.tsx`, `book-delete-dialog.tsx` — confirmations.
- `components/books/paginator.tsx` — cursor-based, "Charger plus" + "Précédent/Suivant".

### Design quality

- Invocation `frontend-design` skill au moment du plan d'implémentation pour les pages catalogue + fiche livre + form (rituel établi en mémoire — pas de rendu générique AI).
- Lucide pour les icônes (jamais d'emojis).
- Couleurs et typographie cohérentes avec l'admin (palette déjà figée en 1C).

## 7. Permissions matrix delta

7 nouvelles procédures × 5 rôles = **35 nouveaux cases** à ajouter dans `tests/integration/permissions-matrix.test.ts`. L'anti-drift guard 1C les force à apparaître (sinon CI fail).

| Procédure | GLOBAL_ADMIN | LIBRARY_ADMIN (this) | LIBRARY_ADMIN (other) | MEMBER (this) | MEMBER (other) | ANON | PENDING_2FA |
|---|---|---|---|---|---|---|---|
| `list` | OK | OK | NOT_FOUND | OK | NOT_FOUND | UNAUTHORIZED | UNAUTHORIZED |
| `get` | OK | OK | NOT_FOUND | OK | NOT_FOUND | UNAUTHORIZED | UNAUTHORIZED |
| `create` | OK | OK | FORBIDDEN | FORBIDDEN | FORBIDDEN | UNAUTHORIZED | UNAUTHORIZED |
| `update` | OK | OK | FORBIDDEN | FORBIDDEN | FORBIDDEN | UNAUTHORIZED | UNAUTHORIZED |
| `archive` | OK | OK | FORBIDDEN | FORBIDDEN | FORBIDDEN | UNAUTHORIZED | UNAUTHORIZED |
| `unarchive` | OK | OK | FORBIDDEN | FORBIDDEN | FORBIDDEN | UNAUTHORIZED | UNAUTHORIZED |
| `delete` | OK | FORBIDDEN | FORBIDDEN | FORBIDDEN | FORBIDDEN | UNAUTHORIZED | UNAUTHORIZED |

**Conventions** : `NOT_FOUND` (au lieu de `FORBIDDEN`) sur les routes de lecture cross-library — évite l'enumeration de slugs. `FORBIDDEN` sur les écritures cross-library (l'utilisateur sait que la lib existe mais n'a pas le droit).

### Edge cases couverts par les tests

- `archive` d'un livre déjà archivé → `BAD_REQUEST`.
- `unarchive` d'un livre non archivé → `BAD_REQUEST`.
- `update`/`get` cross-library id-guess (book id valide mais d'une autre lib) → `NOT_FOUND` via `assertBookInLibrary`.
- `delete` avec dépendances → `BAD_REQUEST`, message explicite listant les types de dépendances présentes.
- `list` avec `includeArchived: true` côté MEMBER → param accepté, server force `false` (filtre archived appliqué) ; pas d'erreur renvoyée. Test vérifie : payload identique à `includeArchived: false`.
- `update` avec `expectedUpdatedAt` périmé → `CONFLICT`, livre non modifié. Test vérifie idempotence (un autre `update` simultané ne corrompt pas l'état).
- Search avec patterns SQL-injection (`'; DROP TABLE...`) → handled par `Prisma.sql` (paramétrage), tests dédiés.
- Search avec query trop courte (< 2 chars) → ignore le filtre `q`, applique seulement les autres.
- `coverPath` non-HTTPS / non-URL → `BAD_REQUEST` Zod.

## 8. Dettes 1C absorbées

| # | Tâche | Livrable | Effort |
|---|---|---|---|
| 1 | Fix regex `toHaveURL` 5 specs | Patch `tests/e2e/{health,password-reset,reset-invalidates-sessions,invitation-existing-user,invitation-new-user}.spec.ts` — utilise `await expect(page).toHaveURL(/\/(\?.*)?$/)` ou `expect(new URL(page.url()).pathname).toBe('/')` | 30 min |
| 2 | CI e2e élargie | `.github/workflows/ci.yml` job e2e fait tourner **all specs** avec services Docker (postgres :5432, redis :6379, mailpit :1025/:8025) ; cache pnpm + `npx playwright install --with-deps chromium` ; timeout 15 min | 3 h |
| 3 | Drift guard `src/emails/` ↔ `worker/emails/` | Script `scripts/check-email-templates-drift.ts` qui SHA-256-compare les paires de templates et fail-CI si divergence ; ajout au workflow lint | 1 h |
| 4 | Lint rule custom Prisma scope | ESLint plugin local `eslint-plugin-prisma-scope` qui détecte `prisma.annotation.findMany`/`prisma.bookmark.*`/`prisma.readingProgress.*` sans `userId` dans le `where` ; warn pour `Book`/`BookFile` sans `libraryId` | 2 h |
| 5 | Doc finding session-bridge | `docs/architecture/session-bridge.md` — explique le shape `Session.userAgentLabel` et le rationale du parsing au lieu de hash | 30 min |
| 6 | Bonus runbook hard-delete-book | `docs/runbooks/hard-delete-book.md` — procédure DBA pour `library.books.delete` (rare), check des dépendances en pré-flight | 30 min |

**Total** : ~7h30 d'effort dette technique, intégré dans le module E du plan.

## 9. Tests

- **Unit (~+15 fichiers)** : helpers `library-membership`, `book-admin`, `book-search` (notamment SQL-injection guards), Zod schemas (URL HTTPS validator pour `coverPath`).
- **Integration (~+45 fichiers)** :
  - 7 fichiers procédures × ~5 cas chacun (happy + edge + error + auth)
  - 1 fichier matrix delta (35 cas, intégré dans `permissions-matrix.test.ts`)
  - 1 fichier `book-search.integration.test.ts` (tsvector + GIN, dataset de 50 livres seedés, validation accents + multi-mots + ranking)
  - 1 fichier `book-archive.integration.test.ts` (soft-delete invariants : archived n'apparaît pas en list/get sauf flag `includeArchived` admin)
  - 1 fichier `book-search-injection.integration.test.ts` (bindings paramétrés)
- **E2E (~+5 specs)** :
  - `book-create-flow.spec.ts` (Library Admin crée livre + le voit en liste + le member le voit aussi)
  - `book-search.spec.ts` (recherche FR avec accents + filtre + pagination)
  - `book-archive.spec.ts` (archive masque le livre côté member, admin le voit en `?includeArchived=1`)
  - `book-cross-library-isolation.spec.ts` (member lib A ne voit pas livres lib B, ni par list ni par id direct)
  - `member-nav.spec.ts` (combobox switcher + burger drawer mobile + a11y)

**Total après 1D** : ~80 unit, ~365 integration, ~17 E2E (vs ~64 / ~318 / ~12 fin 1C).

## 10. Risques & mitigations

| Risque | Mitigation |
|---|---|
| Recherche tsvector `'simple'` rate les accents | `unaccent` extension dans la column generated → couvre `Müller`/`muller`, `François`/`Francois`. |
| `coverPath` URL externe = mixed content / SSRF si on fetch côté server | **On ne fetch jamais côté server en 1D** ; balise `<img src>` directe + CSP `img-src 'self' https:` ajoutée au middleware Next. Validation Zod URL HTTPS only à la création. |
| Soft-delete pattern oublié sur futur join (`PhysicalCopy.book.archivedAt`) | Lint rule Prisma scope (#4 dettes) couvrira partiellement ; pattern documenté dans `docs/architecture/soft-delete.md` (à co-rédiger en module E). |
| Hard delete avec dépendances cassées | `delete` procédure refuse explicitement si `_count.bookFiles > 0 \|\| _count.physicalCopies > 0 \|\| _count.annotations > 0 \|\| _count.bookmarks > 0 \|\| _count.readingProgresses > 0` ; runbook DBA pour orchestrer le cleanup. |
| Migration tsvector lente sur table existante | Table vide en dev/staging an 1, négligeable. Quand on aura 2k livres en prod, `GENERATED STORED` se calcule one-shot à la migration, ~secondes max sur PG16 OVH 8Go. |
| Combobox switcher cache la lib courante en localStorage qui désync de l'URL | URL = source de vérité, localStorage = simple last-seen pour le default sur `/libraries` redirect. |
| `unaccent` pas présent sur instance Postgres staging/prod | Migration teste `CREATE EXTENSION IF NOT EXISTS unaccent` ; si KO → fallback sans unaccent (warning logué) — à valider en smoke staging. |
| Specs E2E élargies font exploser le CI time | Job e2e en parallel matrix (4 shards Playwright) si > 10 min ; timeout strict 15 min ; logs sur fail uniquement. |

## 11. Estimate & découpage du futur plan

Le plan d'implémentation détaillé (à écrire via `superpowers:writing-plans` après validation de ce design) découpera vraisemblablement en **5 modules** (analogie 1C) :

1. **Module A — Migration + helpers + audit union** (1-2 j) — migration tsvector/unaccent/archivedAt, helpers `library-membership` / `book-admin` / `book-search`, extension audit union, rate-limiters.
2. **Module B — Router `library.books` (7 procédures + matrix delta)** (3-4 j) — implémentation des 7 procédures, intégration matrix delta, intégration tests par procédure.
3. **Module C — UI member space (`/libraries`, layout, MemberHeader, switcher)** (2-3 j) — route group `(member)`, header + sidebar + switcher, page `/libraries`.
4. **Module D — UI catalogue + form (search, filters, list, create/edit/archive)** (3-4 j) — page catalogue + fiche + form + dialogs, invocation frontend-design.
5. **Module E — Dettes 1C + E2E + runbook + doc** (2-3 j) — fix regex E2E, CI scope élargie, drift guard email, lint rule Prisma scope, doc session-bridge, runbook hard-delete-book, 5 nouvelles specs E2E.

**Total estimé** : ~14-18 jours subagent-driven. ~5500-6500 lignes de plan attendues. Branche `feat/phase-1d-books` en worktree (pattern 1C).

## 12. Pattern d'exécution

- **Worktree dédié** : `.worktrees/phase-1d` sur `feat/phase-1d-books` (pattern 1C, env Docker compose dédié `phase-1d-*` sur ports différents pour ne pas écraser le worktree 1C qui est encore présent).
- **Subagent-driven** : modules indépendants → dispatching parallel agents quand possible (ex : Module C et Module E peuvent démarrer en parallèle de Module B une fois Module A mergé en branche dev).
- **Checkpoints CI** : tag git `phase-1d-checkpoint-module-{A,B,C,D,E}` à chaque fin de module, CI verte exigée avant de passer au suivant.
- **Smoke manuel** avant merge final : checklist à co-rédiger dans le plan (catalogue browse + create + edit + archive + cross-library isolation + mobile drawer + a11y).
- **Clôture** : tag `phase-1d-complete` sur merge commit non-squash, mise à jour mémoire (project_phase_1d_completed.md), rituel récap.

## 13. Annexes

### Liens

- Design original : `docs/superpowers/specs/2026-04-25-biblioshare-design.md`
- Phase 1C closure : PR #19, tag `phase-1c-complete` sur `12ab82c`
- ADRs concernés : `0001-stack-choice`, `0002-storage-strategy`, `0003-permissions-model`

### Patterns réutilisés depuis 1C

- Helpers ctx test partagés (`tests/integration/_helpers/auth-ctx.ts::makeCtxForRole`)
- Rate-limiter naming `*Limiter`, ordre fixe (helper → auth → logic)
- Soft-delete avec `archivedAt` (pattern Library)
- Anti-drift matrice (introspection `appRouter._def.procedures`)
- Permissions matrix harness (table déclarative générant ~150 cases)
- Burger drawer Sheet shadcn (`AdminHeader`/`AccountHeader` → `MemberHeader`)

### Nouveaux patterns introduits en 1D

- Route group `(member)` pour l'espace user-facing
- Helper `assertMembership(slug, role?)` (vs admin-only `assertGlobalAdmin`)
- Search Postgres tsvector via raw SQL helper isolé
- Lint rule custom ESLint pour scope Prisma (annotations privées + library scope)
- ESLint plugin local pattern (sera réutilisé Phase 2 pour scan-clamav guards, Phase 3 pour annotations privacy)

---

**Statut** : Design validé en brainstorming session 2026-04-29. Prêt pour génération du plan d'implémentation détaillé via `superpowers:writing-plans`.
