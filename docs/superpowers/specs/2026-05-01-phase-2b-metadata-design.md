# Phase 2B' — Design : metadata fetch chain + cover cache

**Date** : 2026-05-01
**Statut** : Spec validée en brainstorming, prête pour rédaction du plan d'implémentation
**Auteur** : Nicolas (avec assistance IA)
**Phase précédente** : 2A' (upload pipeline + ClamAV + dédup) — clôturée 2026-04-30, tag `phase-2a-complete`
**Phase suivante** : 2C' (tags UX) — TBD

---

## 1. Objectifs & non-objectifs

### 1.1 Objectifs

Permettre l'enrichissement automatique des `Book` à partir d'APIs externes :

- Chaîne de sources : **Google Books → Open Library** (per-field merge), gratuites, sans clé API obligatoire.
- Trigger **async post-création** : quand un admin crée un `Book` avec ISBN, un job worker fetch les metadata en arrière-plan.
- Trigger **manuel** : bouton "Rafraîchir metadata" sur la fiche livre, admin only.
- **Cache local couvertures** sous `STORAGE_ROOT/covers/{bookId}.jpg`, normalisées via `sharp`.
- Politique d'écriture protégeant les éditions manuelles (fill-only en auto, overwrite total sauf `title`+`authors` en manuel).
- Rate-limits par book / par admin / par budget API.
- AuditLog des refresh + des erreurs significatives.

### 1.2 Non-objectifs (différé Phase 2C+ ou plus tard)

- **ISBNdb** (3ᵉ source du master design) — payant, reporté Phase 3+ si Google + OL insuffisants en pratique.
- **Fallback titre+auteur** quand pas d'ISBN — trop bruité (homonymes, traductions, faux positifs). L'admin doit ajouter l'ISBN puis cliquer Refresh.
- **Pré-création preview** (formulaire qui pré-remplit avant save) — décision E du brainstorming exclut le path sync.
- **Thumbnails / variantes pré-générées** de cover — `next/image` génère à la volée. Un seul fichier original (post-normalisation JPEG) stocké.
- **Polling / SSE** pour MAJ statut — refresh page suffit, cohérent avec Phase 2A'.
- **Diff/merge interactif champ par champ** (option C du brainstorming Q2) — overestimation UX vs valeur pour MVP.
- **Re-fetch automatique programmé** (cron daily) — uniquement manuel admin.
- **Cache cross-library / dédup par ISBN** — un fichier cover par `bookId` ; cleanup simple à la suppression du book.
- **Édition manuelle de cover** (upload depuis disque) — Phase 2C' ou 3.
- **Internationalisation des sources** (Babelio, BNF, etc.) — Phase 3+ si demande.

### 1.3 Critère de réussite

Un admin crée un `Book` avec `isbn13 = "9782070612758"` (Le Petit Prince) → la mutation tRPC retourne 200 immédiatement → la fiche livre affiche un badge "Métadonnées en cours" → après ≤ 30 s + refresh, les champs `description`, `publisher`, `publishedYear`, `language` sont remplis et la cover s'affiche. Un admin clique **Rafraîchir** sur un livre déjà fetché → tous les champs (sauf `title`+`authors`) sont écrasés par les données fraîches. Un livre sans ISBN ne déclenche pas de fetch (status reste `null`). Toutes les sources en erreur → status `ERROR` + AuditLog visible côté admin.

---

## 2. Décisions verrouillées en brainstorming

1. **Trigger = E** (B + C) : auto async post-création si ISBN présent + bouton manuel admin sur fiche livre. Pas de path sync sur formulaire.
2. **Apply policy = B** : fill-only en mode auto (n'écrit que si champ null), overwrite total en mode manuel sauf `title` + `authors` qui sont toujours protégés (le LIBRARY_ADMIN les a explicitement tapés).
3. **Sources MVP = Google Books + Open Library**, per-field merge (option B+ii). ISBNdb reporté.
4. **Pas de fallback titre+auteur** quand ISBN absent — silent skip.
5. **Cover storage** = `STORAGE_ROOT/covers/{bookId}.jpg`, fichier unique normalisé JPEG quality 85, cap 5 MB raw / 2 MB post-normalize, pas de thumbnails.
6. **Status tracking** = nouveaux champs `Book.metadataFetchStatus` (enum `PENDING | FETCHED | NOT_FOUND | ERROR`) + `Book.metadataFetchedAt: DateTime?` + `Book.metadataAttemptCount: Int` (pour observability).
7. **Re-fetch policy** = 1/h/book + 20/jour/admin, pas de re-fetch auto.
8. **Tests** = fixtures HTTP réelles (3 ISBN représentatifs : 1 EN populaire, 1 FR récent, 1 FR ancien) + mocks pour cas d'erreur.
9. **Erreurs providers** : 404/no-result = `NOT_FOUND` (pas de retry). 5xx/timeout/429 = retry exponentiel 30s/2min/10min, après 3 échecs → `ERROR` + AuditLog.
10. **Worker pattern** = self-contained (cf. Phase 2A' clôture mémoire) : vendor des libs partagées dans `worker/lib/`, pas d'import depuis `src/lib/audit-log.ts` ; utiliser `prisma.auditLog.create()` direct.

---

## 3. Architecture en un coup d'œil

```
[Admin Save Book w/ ISBN]            [Admin clicks Refresh]
         │                                       │
         ▼                                       ▼
  tRPC library.books.create           tRPC library.books.refreshMetadata
  (writes Book + status=PENDING)      (rate-limit check, status=PENDING)
         │                                       │
         └──────────────┬────────────────────────┘
                        │ enqueue 'fetch-metadata' { bookId, mode: 'auto'|'manual' }
                        ▼
                  Redis (BullMQ queue: metadata)
                        │
                        ▼
            ┌──────────────────────────────────┐
            │ worker: fetch-metadata.ts        │
            │  1. lookup Book.isbn13 || isbn10 │
            │  2. Google Books fetch           │
            │  3. Open Library fetch           │
            │  4. per-field merge → patch      │
            │  5. apply policy (mode)          │
            │  6. download cover (sharp norm)  │
            │  7. atomic write covers/{id}.jpg │
            │  8. tx: update Book + status     │
            │  9. recordAudit (manual or err)  │
            └──────────────────────────────────┘
                        │
                        ▼
            [Postgres + STORAGE_ROOT/covers/]
```

---

## 4. Découpage en unités

### 4.1 Pure libs (`worker/lib/metadata/`)

Tous les modules vivent **directement** sous `worker/lib/metadata/` (pas dans `src/lib/`), parce que seul le worker consomme la chaîne de fetch — les routers tRPC ne font qu'enqueuer, ils n'appellent jamais ces libs. Cela évite la duplication imposée par le pattern self-contained de Phase 2A'.

| Module | Rôle | Dépendances |
|---|---|---|
| `google-books-client.ts` | `fetchByIsbn(isbn): Promise<NormalizedPayload \| null>`. HTTP GET + mapping vers shape interne. Mappe 404 → `null`, 5xx/timeout/429 → throw `ProviderTransientError`. | `undici` (déjà bundled), env `GOOGLE_BOOKS_API_KEY` (optionnel). |
| `open-library-client.ts` | Idem shape. Endpoint `/api/books?bibkeys=ISBN:...`. | `undici`, env `OPEN_LIBRARY_USER_AGENT`. |
| `merge.ts` | `mergePayloads(payloads: NormalizedPayload[]): NormalizedPayload` (per-field, premier non-null gagne) + `applyPolicy(book, merged, mode): Partial<Book>` (fill-only vs overwrite). | Aucune. |
| `cover-storage.ts` | `downloadAndNormalize(url, bookId): Promise<{ relPath: string } \| null>`. Fetch HTTP (timeout, size cap), magic-byte validate, `sharp` → JPEG 85, atomic write. | `undici`, `sharp`, `worker/lib/storage-paths.ts`. |
| `types.ts` | `NormalizedPayload`, `MetadataFetchMode`, `ProviderTransientError`. | Aucune. |

**Note sémantique** : "fill-only" signifie qu'on n'écrit que si le champ courant est strictement `null` (côté Prisma). Une chaîne vide (`""`) ou `0` compte comme "set" et n'est **pas** écrasée — l'admin a explicitement vidé le champ.

**Shape `NormalizedPayload`** :
```ts
type NormalizedPayload = {
  source: 'GOOGLE_BOOKS' | 'OPEN_LIBRARY';
  description: string | null;
  publisher: string | null;
  publishedYear: number | null;
  language: string | null;       // ISO 639-1, lowercase
  coverUrl: string | null;       // HTTPS URL absolue
};
```

`title`, `authors`, `isbn` ne sont **pas** dans la payload normalisée car jamais écrits par le worker.

### 4.2 Worker job (`worker/jobs/fetch-metadata.ts`)

Self-contained. Imports internes uniquement depuis `worker/lib/` :
- `worker/lib/storage-paths.ts` (déjà existant, étendre avec un helper `coverPath(bookId)` qui retourne le chemin absolu sous `STORAGE_ROOT/covers/{bookId}.jpg`).
- `worker/lib/metadata/{google-books-client,open-library-client,merge,cover-storage,types}.ts` (cf. 4.1).

Pattern arrêté en Phase 2A' clôture : worker ne doit pas importer `src/`. Vérifier que `scripts/check-worker-isolation.ts` (s'il existe ; sinon le créer) couvre tout `worker/`.

**Job handler signature** :
```ts
async function fetchMetadataJob(job: Job<{ bookId: string; mode: 'auto'|'manual' }>) {
  // 1. read Book (must have isbn)
  // 2. budget check (apiBudgetLimiter)
  // 3. Promise.allSettled([googleFetch, openLibFetch])
  // 4. if both null → status NOT_FOUND
  // 5. if all transient errors → throw → BullMQ retry
  // 6. merge + apply policy
  // 7. cover download (best-effort, errors logged but non-fatal)
  // 8. tx: book.update + (optional) audit
}
```

**Retry config BullMQ** : `attempts: 3, backoff: { type: 'exponential', delay: 30_000 }` (30s, 2min, 10min approx).

### 4.3 tRPC router (`src/server/trpc/routers/library/books.ts`)

Modifications :
- `create` mutation : après `db.book.create()`, si `book.isbn13 || book.isbn10`, set `metadataFetchStatus = 'PENDING'` et enqueue `fetch-metadata` (mode `'auto'`). Idempotent : si l'enqueue échoue, on log + continue (le book est créé, l'admin pourra cliquer Refresh).
- `update` mutation : **ne déclenche pas** de fetch automatique même si l'admin ajoute l'ISBN après coup. Cohérent avec "manual via fiche livre" (option C du trigger).
- **`refreshMetadata` mutation** (nouvelle, `libraryAdminProcedure`) :
  ```ts
  refreshMetadata: libraryAdminProcedure
    .input(z.object({ id: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      // 1. metadataRefreshPerAdminLimiter.consume(ctx.user.id)
      // 2. assertBookInLibrary(input.id, ctx.library.id)
      // 3. metadataRefreshPerBookLimiter.consume(input.id)
      // 4. if !book.isbn13 && !book.isbn10 → BAD_REQUEST 'NO_ISBN'
      // 5. db.book.update({ metadataFetchStatus: 'PENDING' })
      // 6. enqueue fetch-metadata mode 'manual'
      // 7. recordAudit 'library.book.metadata_refresh_requested'
    })
  ```

### 4.4 UI deltas

| Surface | Changement |
|---|---|
| `BookCard` (catalog grid) | Si `metadataFetchStatus === 'PENDING'` → micro-badge "metadata…". Si `coverPath === null && metadataFetchStatus !== 'PENDING'` → placeholder neutre (déjà existant). |
| Page detail `/library/[slug]/books/[bookId]` | Section "Source des métadonnées" : `metadataSource` ("Google Books · récupéré le 01/05/2026") OU "Saisie manuelle" si `metadataSource === 'MANUAL'`. Bouton **Rafraîchir les métadonnées** (admin only). Disabled + spinner si `PENDING`. Toast d'erreur si `ERROR` (avec lien "voir audit"). |
| Page detail (cover area) | `next/image` pointant `/api/covers/{bookId}.jpg` (route handler qui sert depuis `STORAGE_ROOT/covers/`, header `Cache-Control: public, max-age=86400, immutable` + `ETag` basé sur `metadataFetchedAt`). |

**Cover serving route** (`src/app/api/covers/[bookId]/route.ts`) : auth gate `libraryMemberProcedure`-equivalent (l'utilisateur doit être membre de la library du book), puis stream le fichier. Pas d'URL signée, pas de pre-signed S3 (storage local).

### 4.5 Permissions matrix

Ajout d'une ligne :

| Action | Visiteur | Membre | Membre canUpload | Library Admin | Global Admin |
|---|---|---|---|---|---|
| `library.books.refreshMetadata` | — | — | — | O LOG | O LOG |
| `GET /api/covers/:bookId` | — | O (si membre lib) | O | O | O |

---

## 5. Data model (migration `phase_2b_metadata_fetch`)

```prisma
enum MetadataFetchStatus {
  PENDING
  FETCHED
  NOT_FOUND
  ERROR
}

model Book {
  // ... existing fields unchanged
  metadataFetchStatus  MetadataFetchStatus?
  metadataFetchedAt    DateTime?
  metadataAttemptCount Int                  @default(0)
}
```

`metadataSource` enum (déjà existant) :
- Set par le worker à la 1ère source qui contribue ≥1 champ non-null à la payload mergée.
- Reste `MANUAL` si l'admin a saisi tous les champs manuellement (jamais écrasé en mode auto fill-only sauf si null).

**SQL drifts attendus** : aucun, c'est une migration purement additive.

---

## 6. Env & validation Zod

Ajouts à `src/lib/env.ts` (et `worker/index.ts` schema parsing) :

```
GOOGLE_BOOKS_API_KEY       optional string
OPEN_LIBRARY_USER_AGENT    required string, default "BiblioShare/2B (admin@biblio.test)"
METADATA_FETCH_TIMEOUT_MS  number, default 10_000, min 1000, max 60_000
COVER_MAX_BYTES            number, default 5_242_880 (5 MB)
```

`.env.example` à mettre à jour (les stubs `GOOGLE_BOOKS_API_KEY` et `ISBNDB_API_KEY` existent déjà commentés).

---

## 7. Rate-limits (`src/lib/rate-limit.ts`)

```ts
export const metadataRefreshPerBookLimiter = new RateLimiter({
  points: 1, duration: 3600, keyPrefix: 'rl:meta_refresh_book',
});
export const metadataRefreshPerAdminLimiter = new RateLimiter({
  points: 20, duration: 86400, keyPrefix: 'rl:meta_refresh_admin',
});
// Worker-side, called from inside the job
export const metadataApiBudgetLimiter = new RateLimiter({
  points: 800, duration: 86400, keyPrefix: 'rl:meta_api_budget',
});
```

`metadataApiBudgetLimiter` consumed avant tout appel HTTP externe. Si épuisé → throw → status `ERROR` + AuditLog `SECURITY` (saturation possible = signal d'attaque ou de bug).

---

## 8. Erreurs & retries

| Cas | Status final | Retry BullMQ | AuditLog |
|---|---|---|---|
| Book sans ISBN au moment du job | `NOT_FOUND` | non | non |
| Toutes sources retournent 404 / no-result | `NOT_FOUND` | non | non |
| ≥1 source 5xx/timeout/429, ≥1 succès | `FETCHED` | n/a | non |
| Toutes sources erreur transitoire | retry | 3× exp (30s/2m/10m) puis `ERROR` | oui après dernier échec |
| Cover download échoue, metadata ok | `FETCHED` (sans cover) | non | warn log |
| Budget API dépassé | `ERROR` | non | oui SECURITY |
| Cover MIME invalide / oversize | metadata ok, cover skip | non | warn log |
| Refresh manuel mais Book sans ISBN | tRPC `BAD_REQUEST 'NO_ISBN'` (avant enqueue) | n/a | non |

---

## 9. Tests (livrable bar)

- **Unit (`tests/unit/metadata/`)** :
  - `merge.fill-only.test.ts` — n'écrit pas si champ déjà set
  - `merge.overwrite.test.ts` — écrase tout sauf title/authors en mode manual
  - `merge.per-field.test.ts` — Google Books a description, Open Library a publisher → merged a les deux
  - `cover-storage.normalize.test.ts` — JPEG, PNG, WebP → JPEG out
  - `cover-storage.reject.test.ts` — PDF déguisé .jpg, oversize, magic-byte fail
- **Integration provider (`tests/integration/metadata/`)** :
  - `google-books-client.test.ts` — 3 fixtures ISBN + cas 404 + cas 429 + cas timeout (mock undici)
  - `open-library-client.test.ts` — idem
- **Integration worker (`tests/integration/worker-fetch-metadata.test.ts`)** :
  - Happy path : enqueue → run → DB updated + cover sur disque
  - Retry path : 1ère tentative 503, 2ᵉ OK
  - Failure path : 3 échecs → status ERROR + AuditLog
  - Budget exhausted path
- **E2E (`tests/e2e/book-metadata.spec.ts`)** :
  - Admin crée Book avec ISBN connu (HTTP intercept fixture) → page detail → poll-via-refresh ≤30s → cover + description visibles
  - Admin clique Refresh → confirmation toast → status `PENDING` → `FETCHED` au refresh
  - Permission : member non-admin n'a pas le bouton Refresh
- **Permissions matrix (`tests/integration/permissions-matrix.test.ts`)** : `library.books.refreshMetadata` × 5 rôles + `GET /api/covers/:bookId` × 5 rôles.
- **Worker isolation check** : confirmer (via `scripts/check-worker-isolation.ts` si existant, sinon créer) qu'aucun fichier sous `worker/` n'importe depuis `src/`.

---

## 10. Drifts vs master design (BiblioShare Phase 0)

| Drift | Justification |
|---|---|
| ISBNdb non implémenté en 2B' | Payant, et Google + OL couvrent 95%+ du catalogue cible (FR + EN). À évaluer sur retours réels avant d'engager le coût. |
| Pas de fallback titre+auteur | Trop bruité pour un MVP, risque d'écraser des champs avec de la mauvaise data. Documenté en non-objectif. |
| Champ `metadataAttemptCount` ajouté | Pas dans le master design ; utile pour debug, observability et future page admin "metadata health". Coût migration trivial. |
| Storage cover sous `STORAGE_ROOT/covers/` (pas `library/{libraryId}/`) | Les covers ne sont pas library-scoped (un même ISBN partage potentiellement la même cover). Pas de dédup MVP, mais on s'autorise un index futur sans refonte. Cleanup simple : à la suppression d'un Book, `unlink(covers/{bookId}.jpg)`. |

---

## 11. Suivis non-bloquants Phase 2C+

- Cover dédup par ISBN (économie disque sur catalogues partagés entre libraries) — Phase 3+ si volume justifie.
- Page admin "Metadata health" listant les `ERROR` avec bouton retry-all — Phase 8 hardening.
- Re-fetch programmé (cron) pour les `NOT_FOUND` historiques (les sources s'enrichissent) — Phase 8.
- Source ISBNdb comme 3ᵉ fallback — Phase 3+ si demande.
- Édition manuelle de cover (upload depuis disque) — Phase 2C' ou 3.
