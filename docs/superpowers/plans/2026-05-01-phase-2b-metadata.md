# Phase 2B' — Metadata fetch chain + cover cache — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-fetch external metadata (Google Books → Open Library, per-field merge) for `Book` rows when an admin saves with an ISBN, plus a manual "Refresh metadata" admin action. Cache normalized cover JPEGs locally under `STORAGE_ROOT/covers/{bookId}.jpg`.

**Architecture:** tRPC `library.books.create` enqueues a BullMQ `fetch-metadata` job (mode `auto`) when the new book has an ISBN. New tRPC `library.books.refreshMetadata` mutation does the same with mode `manual` and rate-limit gates. Worker job calls Google Books then Open Library (per-field merge), applies a fill-only or overwrite policy depending on mode, downloads + normalizes cover via `sharp`, atomically writes under `STORAGE_ROOT/covers/`, and updates `Book` in a single transaction. Pure libs live under `worker/lib/metadata/` (worker self-contained pattern from Phase 2A').

**Tech Stack:** Next.js 15 + tRPC v11, Prisma 6 (Postgres 16), BullMQ + Redis 7, `sharp` (new dep) for cover normalization, Node 22 global `fetch` (no `undici` dep needed), `rate-limiter-flexible` (already used).

**Spec:** [`docs/superpowers/specs/2026-05-01-phase-2b-metadata-design.md`](../specs/2026-05-01-phase-2b-metadata-design.md)

---

## Pre-flight

- Branch convention from Phase 2A' : the spec already lives on `docs/phase-2b-metadata-design`. Either rename to `feat/phase-2b-metadata` or branch off it. Final PR title : `feat(phase-2b): metadata fetch chain + cover cache`.
- Postgres 16 + Redis 7 must be running locally for integration/E2E tests : `docker compose up -d pg redis`.
- `pnpm install` after Module 0.1 (sharp install).
- ClamAV is **not** required for this phase — covers are not scanned (best-effort, magic-byte gated).
- Real Google Books / Open Library calls must be **outbound-allowed** from the dev machine. Tests use `nock` or `MockAgent` (built into Node 22's `undici`) to avoid real network in CI.

## File Structure

**New files:**

```
worker/lib/metadata/
  types.ts                         # NormalizedPayload, MetadataFetchMode, ProviderTransientError
  google-books-client.ts           # fetchByIsbn → NormalizedPayload | null
  open-library-client.ts           # fetchByIsbn → NormalizedPayload | null
  merge.ts                         # mergePayloads + applyPolicy
  cover-storage.ts                 # downloadAndNormalize → { relPath } | null
worker/jobs/fetch-metadata.ts      # BullMQ handler

src/server/trpc/routers/library/books.ts                # MODIFIED: refreshMetadata + create extension
src/lib/rate-limit.ts                                   # MODIFIED: 3 new buckets
src/lib/env.ts                                          # MODIFIED: 4 new env vars
src/app/api/covers/[bookId]/route.ts                    # cover serving route handler

src/components/books/MetadataSourceBadge.tsx            # source label + refresh button (admin)
src/components/books/MetadataFetchStatusBadge.tsx       # PENDING/FETCHED/ERROR pill

prisma/migrations/<ts>_phase_2b_metadata_fetch/migration.sql

scripts/check-worker-isolation.ts                       # ensures worker/ has no src/ imports

tests/unit/metadata/
  merge-fill-only.test.ts
  merge-overwrite.test.ts
  merge-per-field.test.ts
  cover-storage-normalize.test.ts
  cover-storage-reject.test.ts
tests/integration/metadata/
  google-books-client.test.ts
  open-library-client.test.ts
tests/integration/worker-fetch-metadata.test.ts
tests/integration/library-books-refresh-metadata.test.ts
tests/integration/covers-route.test.ts
tests/e2e/book-metadata.spec.ts
tests/fixtures/metadata/
  google-books-9782070612758.json     # Le Petit Prince (FR popular)
  google-books-9780451524935.json     # 1984 (EN popular)
  google-books-9782226208620.json     # FR rare
  open-library-9782070612758.json
  open-library-9780451524935.json
  open-library-9782226208620.json
  cover-sample.jpg                    # tiny valid JPEG
  cover-oversized.bin                 # 6 MB random bytes
  cover-fake-pdf.jpg                  # PDF magic bytes with .jpg ext
```

**Modified files:**

```
prisma/schema.prisma                  # MetadataFetchStatus enum + 3 new Book fields
package.json                          # +sharp dep
worker/index.ts                       # register 'metadata' queue + fetch-metadata Worker
worker/lib/storage-paths.ts           # +coverPath(bookId) helper
.env.example                          # +OPEN_LIBRARY_USER_AGENT, METADATA_FETCH_TIMEOUT_MS, COVER_MAX_BYTES
src/server/trpc/schemas/book.ts       # +refreshMetadataInput zod schema
src/lib/audit-log.ts                  # +'library.book.metadata_refresh_requested' + '..._failed' actions
src/components/books/BookCard.tsx     # show fetch status pill
src/app/library/[slug]/books/[bookId]/page.tsx   # source badge + refresh button
src/app/library/[slug]/books/[bookId]/BookDetailClient.tsx (or equiv) # refresh mutation wiring
tests/integration/permissions-matrix.test.ts     # +library.books.refreshMetadata + cover route
docs/permissions-matrix.md            # extend matrix
```

---

## Module 2B'.0 — Schema, env, deps

### Task 0.1 — Install sharp

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml`

- [ ] **Step 1: Install**

```bash
pnpm add sharp@^0.33
```

- [ ] **Step 2: Verify**

```bash
node -e "console.log(require('sharp').versions)"
```

Expected: prints sharp + libvips versions.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "deps(phase-2b): add sharp for cover normalization"
```

### Task 0.2 — Add Prisma migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<ts>_phase_2b_metadata_fetch/migration.sql`

- [ ] **Step 1: Edit schema.prisma**

Add the enum (above the `Book` model) :

```prisma
enum MetadataFetchStatus {
  PENDING
  FETCHED
  NOT_FOUND
  ERROR
}
```

Inside `model Book { ... }`, after `metadataSource` :

```prisma
  metadataFetchStatus  MetadataFetchStatus?
  metadataFetchedAt    DateTime?
  metadataAttemptCount Int                  @default(0)
```

- [ ] **Step 2: Try `prisma migrate dev --create-only --name phase_2b_metadata_fetch`**

```bash
pnpm prisma migrate dev --create-only --name phase_2b_metadata_fetch
```

Expected: migration SQL generated. If Prisma refuses due to an unrelated drift on a prior migration (per Phase 2A' clôture mémoire), drop to manual SQL — see Step 3.

- [ ] **Step 3 (fallback): Hand-write the SQL**

Create `prisma/migrations/20260501<HHMMSS>_phase_2b_metadata_fetch/migration.sql` :

```sql
-- CreateEnum
CREATE TYPE "MetadataFetchStatus" AS ENUM ('PENDING', 'FETCHED', 'NOT_FOUND', 'ERROR');

-- AlterTable
ALTER TABLE "Book"
  ADD COLUMN "metadataFetchStatus" "MetadataFetchStatus",
  ADD COLUMN "metadataFetchedAt" TIMESTAMP(3),
  ADD COLUMN "metadataAttemptCount" INTEGER NOT NULL DEFAULT 0;
```

Then `pnpm prisma migrate resolve --applied <migration-name>` to register if applied manually, or `pnpm prisma migrate dev` to push.

- [ ] **Step 4: Regenerate client**

```bash
pnpm prisma generate
```

- [ ] **Step 5: Verify typecheck still passes**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add prisma/
git commit -m "feat(phase-2b): add MetadataFetchStatus + Book metadata fetch fields"
```

### Task 0.3 — Add env vars

**Files:**
- Modify: `src/lib/env.ts`
- Modify: `.env.example`

- [ ] **Step 1: Extend `src/lib/env.ts` zod schema**

Find the existing schema and add :

```ts
GOOGLE_BOOKS_API_KEY: z.string().min(1).optional(),
OPEN_LIBRARY_USER_AGENT: z
  .string()
  .min(10)
  .default('BiblioShare/2B (admin@biblio.test)'),
METADATA_FETCH_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(10_000),
COVER_MAX_BYTES: z.coerce.number().int().min(102_400).max(20_971_520).default(5_242_880),
```

- [ ] **Step 2: Update `.env.example`**

In the `# === APIs métadonnées (Phase 2+) ===` section, replace the commented stubs with :

```
# === APIs métadonnées (Phase 2B') ===
# GOOGLE_BOOKS_API_KEY=                # optional ; without key the public quota is ~1000/day
OPEN_LIBRARY_USER_AGENT=BiblioShare/2B (admin@biblio.test)
METADATA_FETCH_TIMEOUT_MS=10000
COVER_MAX_BYTES=5242880
# ISBNDB_API_KEY=                       # not implemented in 2B' (deferred to Phase 3+)
```

- [ ] **Step 3: Verify typecheck + tests load env**

```bash
pnpm typecheck && pnpm test --run env
```

Expected: pass. If a test snapshots the env shape, update the snapshot.

- [ ] **Step 4: Commit**

```bash
git add src/lib/env.ts .env.example
git commit -m "feat(phase-2b): env vars for metadata fetch + cover normalization"
```

### Task 0.4 — Add rate-limit buckets

**Files:**
- Modify: `src/lib/rate-limit.ts`
- Test: `tests/unit/rate-limit.test.ts` (extend if exists, otherwise inline assertion in this task)

- [ ] **Step 1: Add to `src/lib/rate-limit.ts`**

```ts
export const metadataRefreshPerBookLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:meta_refresh_book',
  points: 1,
  duration: 3600, // 1/hour per bookId
});

export const metadataRefreshPerAdminLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:meta_refresh_admin',
  points: 20,
  duration: 86400, // 20/day per adminId
});

export const metadataApiBudgetLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:meta_api_budget',
  points: 800,
  duration: 86400, // 800 outbound calls/day total (single key)
});
```

(Use the same `redis` import the file already uses for the existing `RateLimiterRedis` exports.)

- [ ] **Step 2: Verify build**

```bash
pnpm typecheck
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/rate-limit.ts
git commit -m "feat(phase-2b): rate-limit buckets for metadata refresh + API budget"
```

---

## Module 2B'.A — Pure libs under `worker/lib/metadata/`

### Task A.1 — Types

**Files:**
- Create: `worker/lib/metadata/types.ts`

- [ ] **Step 1: Write types**

```ts
// worker/lib/metadata/types.ts
export type MetadataSource = 'GOOGLE_BOOKS' | 'OPEN_LIBRARY';
export type MetadataFetchMode = 'auto' | 'manual';

export interface NormalizedPayload {
  source: MetadataSource;
  description: string | null;
  publisher: string | null;
  publishedYear: number | null;
  language: string | null; // ISO 639-1, lowercase
  coverUrl: string | null; // HTTPS absolute
}

export class ProviderTransientError extends Error {
  constructor(message: string, public readonly status: number | null = null) {
    super(message);
    this.name = 'ProviderTransientError';
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add worker/lib/metadata/types.ts
git commit -m "feat(phase-2b/A): metadata payload types"
```

### Task A.2 — Merge logic (TDD)

**Files:**
- Create: `worker/lib/metadata/merge.ts`
- Test: `tests/unit/metadata/merge-fill-only.test.ts`, `merge-overwrite.test.ts`, `merge-per-field.test.ts`

- [ ] **Step 1: Write `merge-per-field.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { mergePayloads } from '../../../worker/lib/metadata/merge.js';
import type { NormalizedPayload } from '../../../worker/lib/metadata/types.js';

const google: NormalizedPayload = {
  source: 'GOOGLE_BOOKS',
  description: 'A great book.',
  publisher: null,
  publishedYear: 1943,
  language: 'fr',
  coverUrl: 'https://google/cover.jpg',
};
const openLib: NormalizedPayload = {
  source: 'OPEN_LIBRARY',
  description: 'Different desc.',
  publisher: 'Gallimard',
  publishedYear: null,
  language: 'fr',
  coverUrl: null,
};

describe('mergePayloads', () => {
  it('takes first non-null per field, source = first to contribute', () => {
    const merged = mergePayloads([google, openLib]);
    expect(merged.description).toBe('A great book.');
    expect(merged.publisher).toBe('Gallimard'); // google had null
    expect(merged.publishedYear).toBe(1943);
    expect(merged.coverUrl).toBe('https://google/cover.jpg');
    expect(merged.source).toBe('GOOGLE_BOOKS');
  });

  it('returns null payload when all sources are empty', () => {
    const empty: NormalizedPayload = {
      source: 'GOOGLE_BOOKS', description: null, publisher: null,
      publishedYear: null, language: null, coverUrl: null,
    };
    expect(mergePayloads([empty])).toEqual(empty);
  });

  it('skips entirely-null sources for the source attribution', () => {
    const empty: NormalizedPayload = {
      source: 'GOOGLE_BOOKS', description: null, publisher: null,
      publishedYear: null, language: null, coverUrl: null,
    };
    const merged = mergePayloads([empty, openLib]);
    expect(merged.source).toBe('OPEN_LIBRARY');
    expect(merged.description).toBe('Different desc.');
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```bash
pnpm vitest run tests/unit/metadata/merge-per-field.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `merge.ts` — `mergePayloads`**

```ts
// worker/lib/metadata/merge.ts
import type { NormalizedPayload, MetadataFetchMode, MetadataSource } from './types.js';

const FIELDS = ['description', 'publisher', 'publishedYear', 'language', 'coverUrl'] as const;
type Field = (typeof FIELDS)[number];

function isNonEmpty(p: NormalizedPayload): boolean {
  return FIELDS.some((f) => p[f] !== null);
}

export function mergePayloads(payloads: NormalizedPayload[]): NormalizedPayload {
  const merged: NormalizedPayload = {
    source: payloads[0]?.source ?? 'GOOGLE_BOOKS',
    description: null, publisher: null, publishedYear: null,
    language: null, coverUrl: null,
  };
  let attributedSource: MetadataSource | null = null;

  for (const p of payloads) {
    if (!attributedSource && isNonEmpty(p)) attributedSource = p.source;
    for (const f of FIELDS) {
      if (merged[f] === null && p[f] !== null) {
        // @ts-expect-error narrow per-field
        merged[f] = p[f];
      }
    }
  }
  if (attributedSource) merged.source = attributedSource;
  return merged;
}
```

- [ ] **Step 4: Run merge-per-field test, verify PASS**

```bash
pnpm vitest run tests/unit/metadata/merge-per-field.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: Write `merge-fill-only.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { applyPolicy } from '../../../worker/lib/metadata/merge.js';
import type { NormalizedPayload } from '../../../worker/lib/metadata/types.js';

const merged: NormalizedPayload = {
  source: 'GOOGLE_BOOKS',
  description: 'New desc.',
  publisher: 'New Pub.',
  publishedYear: 2020,
  language: 'fr',
  coverUrl: 'https://x/cover.jpg',
};

describe('applyPolicy(mode=auto)', () => {
  it('writes only fields where current is null', () => {
    const patch = applyPolicy(
      { description: null, publisher: 'Old Pub.', publishedYear: null, language: 'en', coverPath: null },
      merged,
      'auto',
    );
    expect(patch.description).toBe('New desc.');
    expect(patch.publisher).toBeUndefined(); // already set
    expect(patch.publishedYear).toBe(2020);
    expect(patch.language).toBeUndefined(); // already set
  });

  it('treats empty string and 0 as "set" (admin explicitly cleared)', () => {
    const patch = applyPolicy(
      { description: '', publisher: '', publishedYear: 0, language: '', coverPath: null },
      merged,
      'auto',
    );
    expect(patch.description).toBeUndefined();
    expect(patch.publisher).toBeUndefined();
    expect(patch.publishedYear).toBeUndefined();
    expect(patch.language).toBeUndefined();
  });

  it('attaches metadataSource when at least one field was written', () => {
    const patch = applyPolicy(
      { description: null, publisher: null, publishedYear: null, language: null, coverPath: null },
      merged,
      'auto',
    );
    expect(patch.metadataSource).toBe('GOOGLE_BOOKS');
  });
});
```

- [ ] **Step 6: Run, verify FAIL**

```bash
pnpm vitest run tests/unit/metadata/merge-fill-only.test.ts
```

Expected: FAIL (`applyPolicy` not exported).

- [ ] **Step 7: Implement `applyPolicy` in `merge.ts`**

Append to `worker/lib/metadata/merge.ts` :

```ts
type CurrentBookFields = {
  description: string | null;
  publisher: string | null;
  publishedYear: number | null;
  language: string | null;
  coverPath: string | null;
};

type BookPatch = Partial<{
  description: string;
  publisher: string;
  publishedYear: number;
  language: string;
  metadataSource: 'GOOGLE_BOOKS' | 'OPEN_LIBRARY';
}>;

export function applyPolicy(
  current: CurrentBookFields,
  merged: NormalizedPayload,
  mode: MetadataFetchMode,
): BookPatch {
  const patch: BookPatch = {};
  const writable: Array<keyof CurrentBookFields & keyof NormalizedPayload> = [
    'description', 'publisher', 'publishedYear', 'language',
  ];
  let wroteAny = false;

  for (const f of writable) {
    const newVal = merged[f];
    if (newVal === null) continue;
    const shouldWrite =
      mode === 'manual'
        ? true
        : current[f] === null; // auto = fill-only on strictly null
    if (shouldWrite) {
      // @ts-expect-error narrow per-field
      patch[f] = newVal;
      wroteAny = true;
    }
  }

  if (wroteAny || merged.coverUrl !== null) {
    patch.metadataSource = merged.source;
  }
  return patch;
}
```

- [ ] **Step 8: Write `merge-overwrite.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { applyPolicy } from '../../../worker/lib/metadata/merge.js';
import type { NormalizedPayload } from '../../../worker/lib/metadata/types.js';

const merged: NormalizedPayload = {
  source: 'OPEN_LIBRARY',
  description: 'Fresh desc.',
  publisher: 'Fresh Pub.',
  publishedYear: 2024,
  language: 'fr',
  coverUrl: null,
};

describe('applyPolicy(mode=manual)', () => {
  it('overwrites every non-null field even when current is set', () => {
    const patch = applyPolicy(
      { description: 'Old.', publisher: 'Old Pub.', publishedYear: 1990, language: 'en', coverPath: null },
      merged,
      'manual',
    );
    expect(patch.description).toBe('Fresh desc.');
    expect(patch.publisher).toBe('Fresh Pub.');
    expect(patch.publishedYear).toBe(2024);
    expect(patch.language).toBe('fr');
    expect(patch.metadataSource).toBe('OPEN_LIBRARY');
  });

  it('does not include fields the merged payload has null', () => {
    const partial: NormalizedPayload = {
      source: 'GOOGLE_BOOKS',
      description: 'Only desc.',
      publisher: null, publishedYear: null, language: null, coverUrl: null,
    };
    const patch = applyPolicy(
      { description: 'X', publisher: 'X', publishedYear: 1, language: 'x', coverPath: null },
      partial,
      'manual',
    );
    expect(patch.description).toBe('Only desc.');
    expect(patch).not.toHaveProperty('publisher');
    expect(patch).not.toHaveProperty('publishedYear');
    expect(patch).not.toHaveProperty('language');
  });
});
```

- [ ] **Step 9: Run all merge tests, verify PASS**

```bash
pnpm vitest run tests/unit/metadata/
```

Expected: 8 passed (3 + 3 + 2).

- [ ] **Step 10: Commit**

```bash
git add worker/lib/metadata/merge.ts tests/unit/metadata/merge-*.test.ts
git commit -m "feat(phase-2b/A): metadata merge + apply-policy with fill-only/overwrite modes"
```

### Task A.3 — Google Books client (TDD)

**Files:**
- Create: `worker/lib/metadata/google-books-client.ts`
- Create: `tests/fixtures/metadata/google-books-9782070612758.json`, `google-books-9780451524935.json`, `google-books-9782226208620.json`
- Test: `tests/integration/metadata/google-books-client.test.ts`

- [ ] **Step 1: Capture fixtures**

For each ISBN (`9782070612758`, `9780451524935`, `9782226208620`), run :

```bash
ISBN=9782070612758
curl -s "https://www.googleapis.com/books/v1/volumes?q=isbn:${ISBN}" | jq . > "tests/fixtures/metadata/google-books-${ISBN}.json"
```

If the API rate-limits during capture, copy a known good JSON from a colleague or use an offline copy. Each fixture must contain at least one `items[0]` with `volumeInfo`.

- [ ] **Step 2: Write `google-books-client.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici';
import { readFileSync } from 'node:fs';
import { fetchByIsbn } from '../../../worker/lib/metadata/google-books-client.js';
import { ProviderTransientError } from '../../../worker/lib/metadata/types.js';

let agent: MockAgent;
let originalDispatcher: ReturnType<typeof getGlobalDispatcher>;

beforeEach(() => {
  originalDispatcher = getGlobalDispatcher();
  agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
});
afterEach(() => {
  setGlobalDispatcher(originalDispatcher);
});

describe('googleBooks.fetchByIsbn', () => {
  it('returns normalized payload for Le Petit Prince fixture', async () => {
    const body = readFileSync('tests/fixtures/metadata/google-books-9782070612758.json', 'utf-8');
    agent
      .get('https://www.googleapis.com')
      .intercept({ path: /\/books\/v1\/volumes/, method: 'GET' })
      .reply(200, body);

    const payload = await fetchByIsbn('9782070612758');
    expect(payload).not.toBeNull();
    expect(payload!.source).toBe('GOOGLE_BOOKS');
    expect(payload!.language).toBe('fr');
    expect(payload!.publishedYear).toBeGreaterThan(1900);
    expect(payload!.coverUrl).toMatch(/^https:\/\//);
  });

  it('returns null when totalItems = 0', async () => {
    agent
      .get('https://www.googleapis.com')
      .intercept({ path: /\/books\/v1\/volumes/, method: 'GET' })
      .reply(200, { totalItems: 0, items: [] });
    expect(await fetchByIsbn('0000000000000')).toBeNull();
  });

  it('returns null on 404', async () => {
    agent
      .get('https://www.googleapis.com')
      .intercept({ path: /\/books\/v1\/volumes/, method: 'GET' })
      .reply(404, '');
    expect(await fetchByIsbn('1111111111111')).toBeNull();
  });

  it('throws ProviderTransientError on 503', async () => {
    agent
      .get('https://www.googleapis.com')
      .intercept({ path: /\/books\/v1\/volumes/, method: 'GET' })
      .reply(503, 'try later');
    await expect(fetchByIsbn('9782070612758')).rejects.toBeInstanceOf(ProviderTransientError);
  });

  it('throws ProviderTransientError on 429', async () => {
    agent
      .get('https://www.googleapis.com')
      .intercept({ path: /\/books\/v1\/volumes/, method: 'GET' })
      .reply(429, 'rate limited');
    await expect(fetchByIsbn('9782070612758')).rejects.toBeInstanceOf(ProviderTransientError);
  });
});
```

- [ ] **Step 3: Run, verify FAIL**

```bash
pnpm vitest run tests/integration/metadata/google-books-client.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement `google-books-client.ts`**

```ts
// worker/lib/metadata/google-books-client.ts
import { ProviderTransientError, type NormalizedPayload } from './types.js';

const ENDPOINT = 'https://www.googleapis.com/books/v1/volumes';
const TIMEOUT_MS = Number(process.env.METADATA_FETCH_TIMEOUT_MS ?? 10_000);

interface GBVolume {
  volumeInfo?: {
    description?: string;
    publisher?: string;
    publishedDate?: string; // YYYY or YYYY-MM-DD
    language?: string;      // ISO 639-1 (sometimes upper)
    imageLinks?: { thumbnail?: string; smallThumbnail?: string };
  };
}

function parseYear(s?: string): number | null {
  if (!s) return null;
  const m = /^\d{4}/.exec(s);
  return m ? Number(m[0]) : null;
}

function normalizeCoverUrl(u?: string): string | null {
  if (!u) return null;
  // Google Books returns http: for thumbnails — force https.
  return u.replace(/^http:/, 'https:');
}

export async function fetchByIsbn(isbn: string): Promise<NormalizedPayload | null> {
  const url = new URL(ENDPOINT);
  url.searchParams.set('q', `isbn:${isbn}`);
  if (process.env.GOOGLE_BOOKS_API_KEY) {
    url.searchParams.set('key', process.env.GOOGLE_BOOKS_API_KEY);
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { signal: ac.signal });
  } catch (err) {
    throw new ProviderTransientError(`google-books fetch failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 404) return null;
  if (res.status === 429 || res.status >= 500) {
    throw new ProviderTransientError(`google-books HTTP ${res.status}`, res.status);
  }
  if (!res.ok) return null;

  const data = (await res.json()) as { totalItems?: number; items?: GBVolume[] };
  const v = data.items?.[0]?.volumeInfo;
  if (!v) return null;

  return {
    source: 'GOOGLE_BOOKS',
    description: v.description ?? null,
    publisher: v.publisher ?? null,
    publishedYear: parseYear(v.publishedDate),
    language: v.language ? v.language.toLowerCase() : null,
    coverUrl: normalizeCoverUrl(v.imageLinks?.thumbnail ?? v.imageLinks?.smallThumbnail),
  };
}
```

- [ ] **Step 5: Run, verify PASS**

```bash
pnpm vitest run tests/integration/metadata/google-books-client.test.ts
```

Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add worker/lib/metadata/google-books-client.ts tests/integration/metadata/google-books-client.test.ts tests/fixtures/metadata/google-books-*.json
git commit -m "feat(phase-2b/A): Google Books client + 3 ISBN fixtures"
```

### Task A.4 — Open Library client (TDD)

**Files:**
- Create: `worker/lib/metadata/open-library-client.ts`
- Create: `tests/fixtures/metadata/open-library-{isbn}.json` × 3
- Test: `tests/integration/metadata/open-library-client.test.ts`

- [ ] **Step 1: Capture fixtures**

```bash
ISBN=9782070612758
curl -s "https://openlibrary.org/api/books?bibkeys=ISBN:${ISBN}&format=json&jscmd=data" \
  -H "User-Agent: BiblioShare/2B (admin@biblio.test)" \
  | jq . > "tests/fixtures/metadata/open-library-${ISBN}.json"
```

Repeat for the other two ISBNs.

- [ ] **Step 2: Write test**

```ts
// tests/integration/metadata/open-library-client.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici';
import { readFileSync } from 'node:fs';
import { fetchByIsbn } from '../../../worker/lib/metadata/open-library-client.js';
import { ProviderTransientError } from '../../../worker/lib/metadata/types.js';

let agent: MockAgent;
let originalDispatcher: ReturnType<typeof getGlobalDispatcher>;

beforeEach(() => {
  originalDispatcher = getGlobalDispatcher();
  agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
});
afterEach(() => {
  setGlobalDispatcher(originalDispatcher);
});

describe('openLibrary.fetchByIsbn', () => {
  it('returns normalized payload for Le Petit Prince fixture', async () => {
    const body = readFileSync('tests/fixtures/metadata/open-library-9782070612758.json', 'utf-8');
    agent
      .get('https://openlibrary.org')
      .intercept({ path: /\/api\/books/, method: 'GET' })
      .reply(200, body);

    const payload = await fetchByIsbn('9782070612758');
    expect(payload).not.toBeNull();
    expect(payload!.source).toBe('OPEN_LIBRARY');
    // The fixture should have at least publisher OR description set; assert on whichever is non-null
    expect(payload!.publisher !== null || payload!.description !== null).toBe(true);
  });

  it('returns null when bibkey absent from response object', async () => {
    agent
      .get('https://openlibrary.org')
      .intercept({ path: /\/api\/books/, method: 'GET' })
      .reply(200, {});
    expect(await fetchByIsbn('0000000000000')).toBeNull();
  });

  it('returns null on 404', async () => {
    agent
      .get('https://openlibrary.org')
      .intercept({ path: /\/api\/books/, method: 'GET' })
      .reply(404, '');
    expect(await fetchByIsbn('1111111111111')).toBeNull();
  });

  it('throws ProviderTransientError on 503', async () => {
    agent
      .get('https://openlibrary.org')
      .intercept({ path: /\/api\/books/, method: 'GET' })
      .reply(503, 'try later');
    await expect(fetchByIsbn('9782070612758')).rejects.toBeInstanceOf(ProviderTransientError);
  });

  it('throws ProviderTransientError on 429', async () => {
    agent
      .get('https://openlibrary.org')
      .intercept({ path: /\/api\/books/, method: 'GET' })
      .reply(429, 'rate limited');
    await expect(fetchByIsbn('9782070612758')).rejects.toBeInstanceOf(ProviderTransientError);
  });
});
```

- [ ] **Step 3: Run, FAIL**

```bash
pnpm vitest run tests/integration/metadata/open-library-client.test.ts
```

- [ ] **Step 4: Implement client**

```ts
// worker/lib/metadata/open-library-client.ts
import { ProviderTransientError, type NormalizedPayload } from './types.js';

const ENDPOINT = 'https://openlibrary.org/api/books';
const TIMEOUT_MS = Number(process.env.METADATA_FETCH_TIMEOUT_MS ?? 10_000);

interface OLBook {
  publishers?: Array<{ name: string }>;
  publish_date?: string;       // free-form
  notes?: string | { value: string };
  excerpts?: Array<{ text: string }>;
  cover?: { large?: string; medium?: string; small?: string };
  languages?: Array<{ key: string }>; // e.g. "/languages/fre"
  description?: string | { value: string };
}

function parseYear(s?: string): number | null {
  if (!s) return null;
  const m = /\b\d{4}\b/.exec(s);
  return m ? Number(m[0]) : null;
}
function langKeyToIso2(key?: string): string | null {
  if (!key) return null;
  const code = key.replace('/languages/', '').toLowerCase();
  // crude ISO 639-2 → 639-1 (cover the few we expect)
  const map: Record<string, string> = { fre: 'fr', fra: 'fr', eng: 'en', spa: 'es', ger: 'de', deu: 'de', ita: 'it' };
  return map[code] ?? (code.length === 2 ? code : null);
}
function asString(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && 'value' in (v as object)) {
    const val = (v as { value: unknown }).value;
    return typeof val === 'string' ? val : null;
  }
  return null;
}

export async function fetchByIsbn(isbn: string): Promise<NormalizedPayload | null> {
  const url = new URL(ENDPOINT);
  url.searchParams.set('bibkeys', `ISBN:${isbn}`);
  url.searchParams.set('format', 'json');
  url.searchParams.set('jscmd', 'data');

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: ac.signal,
      headers: { 'User-Agent': process.env.OPEN_LIBRARY_USER_AGENT ?? 'BiblioShare/2B' },
    });
  } catch (err) {
    throw new ProviderTransientError(`open-library fetch failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 404) return null;
  if (res.status === 429 || res.status >= 500) {
    throw new ProviderTransientError(`open-library HTTP ${res.status}`, res.status);
  }
  if (!res.ok) return null;

  const data = (await res.json()) as Record<string, OLBook>;
  const book = data[`ISBN:${isbn}`];
  if (!book) return null;

  return {
    source: 'OPEN_LIBRARY',
    description:
      asString(book.description) ?? asString(book.notes) ?? book.excerpts?.[0]?.text ?? null,
    publisher: book.publishers?.[0]?.name ?? null,
    publishedYear: parseYear(book.publish_date),
    language: langKeyToIso2(book.languages?.[0]?.key),
    coverUrl: book.cover?.large ?? book.cover?.medium ?? book.cover?.small ?? null,
  };
}
```

- [ ] **Step 5: Run, PASS**

```bash
pnpm vitest run tests/integration/metadata/open-library-client.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add worker/lib/metadata/open-library-client.ts tests/integration/metadata/open-library-client.test.ts tests/fixtures/metadata/open-library-*.json
git commit -m "feat(phase-2b/A): Open Library client + fixtures"
```

### Task A.5 — Cover storage (TDD)

**Files:**
- Modify: `worker/lib/storage-paths.ts` (add `coverPath` helper)
- Create: `worker/lib/metadata/cover-storage.ts`
- Create: `tests/fixtures/metadata/cover-sample.jpg`, `cover-oversized.bin`, `cover-fake-pdf.jpg`
- Test: `tests/unit/metadata/cover-storage-normalize.test.ts`, `cover-storage-reject.test.ts`

- [ ] **Step 1: Generate fixtures**

```bash
# tiny valid 64×64 red JPEG
node -e "const sharp=require('sharp'); sharp({create:{width:64,height:64,channels:3,background:{r:255,g:0,b:0}}}).jpeg().toFile('tests/fixtures/metadata/cover-sample.jpg')"
# 6 MB random bytes
head -c 6291456 /dev/urandom > tests/fixtures/metadata/cover-oversized.bin
# PDF magic bytes pretending to be JPEG
printf '%%PDF-1.4\n%%bogus\n' > tests/fixtures/metadata/cover-fake-pdf.jpg
```

- [ ] **Step 2: Add `coverPath()` to `worker/lib/storage-paths.ts`**

Find the existing exports and add :

```ts
export function coverPath(bookId: string): string {
  // STORAGE_ROOT/covers/{bookId}.jpg
  // bookId is a CUID — already path-safe (alphanumeric, no slashes), but defense-in-depth:
  if (!/^[a-z0-9]+$/.test(bookId)) {
    throw new Error(`invalid bookId for path: ${bookId}`);
  }
  const root = process.env.STORAGE_ROOT;
  if (!root) throw new Error('STORAGE_ROOT not set');
  return `${root}/covers/${bookId}.jpg`;
}

export function coverRelPath(bookId: string): string {
  return `covers/${bookId}.jpg`;
}
```

- [ ] **Step 3: Write `cover-storage-normalize.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici';
import { readFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadAndNormalize } from '../../../worker/lib/metadata/cover-storage.js';

let agent: MockAgent;
let originalDispatcher: ReturnType<typeof getGlobalDispatcher>;
let storageRoot: string;

beforeEach(async () => {
  originalDispatcher = getGlobalDispatcher();
  agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  storageRoot = await mkdtemp(join(tmpdir(), 'cover-test-'));
  process.env.STORAGE_ROOT = storageRoot;
  process.env.COVER_MAX_BYTES = String(5 * 1024 * 1024);
});
afterEach(async () => {
  setGlobalDispatcher(originalDispatcher);
  await rm(storageRoot, { recursive: true, force: true });
});

describe('downloadAndNormalize — normalize', () => {
  it('downloads JPEG and writes JPEG under STORAGE_ROOT/covers/', async () => {
    const sample = await readFile('tests/fixtures/metadata/cover-sample.jpg');
    agent.get('https://cover.example').intercept({ path: '/x.jpg' }).reply(200, sample, {
      headers: { 'content-type': 'image/jpeg' },
    });
    const result = await downloadAndNormalize('https://cover.example/x.jpg', 'ckabc123');
    expect(result).not.toBeNull();
    expect(result!.relPath).toBe('covers/ckabc123.jpg');
    const written = await stat(join(storageRoot, 'covers', 'ckabc123.jpg'));
    expect(written.size).toBeGreaterThan(0);
  });

  it('atomically replaces an existing cover', async () => {
    const sample = await readFile('tests/fixtures/metadata/cover-sample.jpg');
    agent.get('https://cover.example').intercept({ path: '/x.jpg' }).reply(200, sample, {
      headers: { 'content-type': 'image/jpeg' },
    }).times(2);
    await downloadAndNormalize('https://cover.example/x.jpg', 'ckabc123');
    const result = await downloadAndNormalize('https://cover.example/x.jpg', 'ckabc123');
    expect(result).not.toBeNull();
  });
});
```

- [ ] **Step 4: Write `cover-storage-reject.test.ts`**

```ts
// (same beforeEach/afterEach scaffold as above)
describe('downloadAndNormalize — reject', () => {
  it('returns null on PDF bytes with .jpg extension (magic-byte mismatch)', async () => {
    const fake = await readFile('tests/fixtures/metadata/cover-fake-pdf.jpg');
    agent.get('https://cover.example').intercept({ path: '/p.jpg' }).reply(200, fake);
    expect(await downloadAndNormalize('https://cover.example/p.jpg', 'ckabc123')).toBeNull();
  });

  it('returns null when payload exceeds COVER_MAX_BYTES', async () => {
    const big = await readFile('tests/fixtures/metadata/cover-oversized.bin');
    agent.get('https://cover.example').intercept({ path: '/big' }).reply(200, big, {
      headers: { 'content-length': String(big.length) },
    });
    expect(await downloadAndNormalize('https://cover.example/big', 'ckabc123')).toBeNull();
  });

  it('returns null on HTTP 404', async () => {
    agent.get('https://cover.example').intercept({ path: '/missing' }).reply(404, '');
    expect(await downloadAndNormalize('https://cover.example/missing', 'ckabc123')).toBeNull();
  });

  it('returns null on timeout', async () => {
    process.env.METADATA_FETCH_TIMEOUT_MS = '50';
    agent.get('https://cover.example').intercept({ path: '/slow' }).reply(200, async () => {
      await new Promise((r) => setTimeout(r, 200));
      return Buffer.from('x');
    });
    expect(await downloadAndNormalize('https://cover.example/slow', 'ckabc123')).toBeNull();
  });
});
```

- [ ] **Step 5: Run, FAIL**

```bash
pnpm vitest run tests/unit/metadata/cover-storage-*.test.ts
```

- [ ] **Step 6: Implement `cover-storage.ts`**

```ts
// worker/lib/metadata/cover-storage.ts
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { coverPath, coverRelPath } from '../storage-paths.js';

const TIMEOUT_MS_DEFAULT = 10_000;
const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export async function downloadAndNormalize(
  url: string,
  bookId: string,
): Promise<{ relPath: string } | null> {
  const timeoutMs = Number(process.env.METADATA_FETCH_TIMEOUT_MS ?? TIMEOUT_MS_DEFAULT);
  const maxBytes = Number(process.env.COVER_MAX_BYTES ?? 5 * 1024 * 1024);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { signal: ac.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) return null;

  const contentLength = Number(res.headers.get('content-length') ?? '0');
  if (contentLength > maxBytes) return null;

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) return null;

  const ft = await fileTypeFromBuffer(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  if (!ft || !ALLOWED_MIMES.has(ft.mime)) return null;

  let normalized: Buffer;
  try {
    normalized = await sharp(buf).jpeg({ quality: 85 }).toBuffer();
  } catch {
    return null;
  }
  if (normalized.byteLength > 2 * 1024 * 1024) return null; // post-normalize cap 2 MB

  const finalPath = coverPath(bookId);
  await mkdir(dirname(finalPath), { recursive: true });
  const tmp = `${finalPath}.${randomBytes(8).toString('hex')}.tmp`;
  await writeFile(tmp, normalized);
  try {
    await rename(tmp, finalPath);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
  return { relPath: coverRelPath(bookId) };
}
```

- [ ] **Step 7: Run, PASS**

```bash
pnpm vitest run tests/unit/metadata/cover-storage-*.test.ts
```

Expected: 6 passed.

- [ ] **Step 8: Commit**

```bash
git add worker/lib/storage-paths.ts worker/lib/metadata/cover-storage.ts tests/unit/metadata/cover-storage-*.test.ts tests/fixtures/metadata/cover-*
git commit -m "feat(phase-2b/A): cover download + sharp normalize + atomic write"
```

---

## Module 2B'.B — Worker job + queue registration

### Task B.1 — `fetch-metadata.ts` job handler (TDD)

**Files:**
- Create: `worker/jobs/fetch-metadata.ts`
- Test: `tests/integration/worker-fetch-metadata.test.ts`

- [ ] **Step 1: Write integration test — mocks cover-storage to focus on orchestration; the download path is already covered by Task A.5**

```ts
// tests/integration/worker-fetch-metadata.test.ts
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getTestPrisma, truncateAll } from './setup/prisma';

// Mock cover-storage so the job doesn't try to actually download/normalize an image
vi.mock('../../worker/lib/metadata/cover-storage', () => ({
  downloadAndNormalize: vi.fn(async (_url: string, bookId: string) => ({
    relPath: `covers/${bookId}.jpg`,
  })),
}));
import { downloadAndNormalize } from '../../worker/lib/metadata/cover-storage';
import { fetchMetadataJob } from '../../worker/jobs/fetch-metadata';

const prisma = getTestPrisma();
let agent: MockAgent;
let originalDispatcher: ReturnType<typeof getGlobalDispatcher>;

async function makeLibAndBook(opts: Partial<{ isbn13: string; description: string | null }> = {}) {
  const lib = await prisma.library.create({
    data: { name: `Lib ${Date.now()}`, slug: `lib-${Math.random().toString(36).slice(2, 8)}` },
  });
  const book = await prisma.book.create({
    data: {
      libraryId: lib.id,
      title: 'Le Petit Prince',
      authors: ['Antoine de Saint-Exupéry'],
      isbn13: opts.isbn13 ?? '9782070612758',
      description: opts.description ?? null,
    },
  });
  return { lib, book };
}

beforeAll(async () => {
  process.env.STORAGE_ROOT = await mkdtemp(join(tmpdir(), 'fetch-meta-'));
});
beforeEach(async () => {
  await truncateAll();
  vi.mocked(downloadAndNormalize).mockClear();
  originalDispatcher = getGlobalDispatcher();
  agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
});
afterEach(() => {
  setGlobalDispatcher(originalDispatcher);
});

function mkJob(bookId: string, mode: 'auto' | 'manual', attemptsMade = 1, attempts = 3) {
  return { data: { bookId, mode }, attemptsMade, opts: { attempts } } as any;
}

describe('fetchMetadataJob', () => {
  it('happy path: fills empty fields in auto mode + sets coverPath via mocked storage', async () => {
    const { book } = await makeLibAndBook();
    const gb = await readFile('tests/fixtures/metadata/google-books-9782070612758.json', 'utf-8');
    const ol = await readFile('tests/fixtures/metadata/open-library-9782070612758.json', 'utf-8');
    agent.get('https://www.googleapis.com').intercept({ path: /books/ }).reply(200, gb);
    agent.get('https://openlibrary.org').intercept({ path: /api\/books/ }).reply(200, ol);

    await fetchMetadataJob(mkJob(book.id, 'auto'));

    const updated = await prisma.book.findUniqueOrThrow({ where: { id: book.id } });
    expect(updated.metadataFetchStatus).toBe('FETCHED');
    expect(updated.metadataFetchedAt).not.toBeNull();
    expect(updated.description).not.toBeNull();
    expect(updated.metadataAttemptCount).toBe(1);
    expect(updated.coverPath).toBe(`covers/${book.id}.jpg`);
    expect(downloadAndNormalize).toHaveBeenCalledOnce();
  });

  it('NOT_FOUND when both providers return null', async () => {
    const { book } = await makeLibAndBook({ isbn13: '0000000000000' });
    agent.get('https://www.googleapis.com').intercept({ path: /books/ }).reply(200, { totalItems: 0 });
    agent.get('https://openlibrary.org').intercept({ path: /api\/books/ }).reply(200, {});

    await fetchMetadataJob(mkJob(book.id, 'auto'));

    const updated = await prisma.book.findUniqueOrThrow({ where: { id: book.id } });
    expect(updated.metadataFetchStatus).toBe('NOT_FOUND');
    expect(downloadAndNormalize).not.toHaveBeenCalled();
  });

  it('throws on transient error so BullMQ retries (attempts not exhausted)', async () => {
    const { book } = await makeLibAndBook();
    agent.get('https://www.googleapis.com').intercept({ path: /books/ }).reply(503, '');
    agent.get('https://openlibrary.org').intercept({ path: /api\/books/ }).reply(503, '');

    await expect(fetchMetadataJob(mkJob(book.id, 'auto', 1, 3))).rejects.toThrow();

    const updated = await prisma.book.findUniqueOrThrow({ where: { id: book.id } });
    // Status should not flip to ERROR yet — BullMQ will retry
    expect(updated.metadataFetchStatus).toBeNull();
  });

  it('marks ERROR + writes audit on the last failed attempt', async () => {
    const { book } = await makeLibAndBook();
    agent.get('https://www.googleapis.com').intercept({ path: /books/ }).reply(503, '');
    agent.get('https://openlibrary.org').intercept({ path: /api\/books/ }).reply(503, '');

    await fetchMetadataJob(mkJob(book.id, 'auto', 3, 3));

    const updated = await prisma.book.findUniqueOrThrow({ where: { id: book.id } });
    expect(updated.metadataFetchStatus).toBe('ERROR');
    const audits = await prisma.auditLog.findMany({
      where: { action: 'library.book.metadata_fetch_failed', targetId: book.id },
    });
    expect(audits.length).toBe(1);
  });

  it('overwrite mode: replaces existing description', async () => {
    const { book } = await makeLibAndBook({ description: 'Old description.' });
    const gb = await readFile('tests/fixtures/metadata/google-books-9782070612758.json', 'utf-8');
    agent.get('https://www.googleapis.com').intercept({ path: /books/ }).reply(200, gb);
    agent.get('https://openlibrary.org').intercept({ path: /api\/books/ }).reply(200, {});

    await fetchMetadataJob(mkJob(book.id, 'manual'));

    const updated = await prisma.book.findUniqueOrThrow({ where: { id: book.id } });
    expect(updated.description).not.toBe('Old description.');
    expect(updated.description).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run, FAIL**

```bash
pnpm vitest run tests/integration/worker-fetch-metadata.test.ts
```

- [ ] **Step 3: Implement `worker/jobs/fetch-metadata.ts`**

```ts
// worker/jobs/fetch-metadata.ts
import { PrismaClient } from '@prisma/client';
import type { Job } from 'bullmq';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import IORedis from 'ioredis';
import { fetchByIsbn as fetchGoogle } from '../lib/metadata/google-books-client.js';
import { fetchByIsbn as fetchOpenLibrary } from '../lib/metadata/open-library-client.js';
import { mergePayloads, applyPolicy } from '../lib/metadata/merge.js';
import { downloadAndNormalize } from '../lib/metadata/cover-storage.js';
import { ProviderTransientError, type MetadataFetchMode, type NormalizedPayload } from '../lib/metadata/types.js';

const prisma = new PrismaClient();

// Budget limiter is co-located here so the worker stays self-contained (no src/ import).
// Same Redis key prefix as the app-side bucket in src/lib/rate-limit.ts → both share the
// 800-call/day budget against the same Redis counter.
const budgetRedis = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
const apiBudget = new RateLimiterRedis({
  storeClient: budgetRedis,
  keyPrefix: 'rl:meta_api_budget',
  points: 800,
  duration: 86400,
});

export interface FetchMetadataJobData {
  bookId: string;
  mode: MetadataFetchMode;
}

export async function fetchMetadataJob(job: Job<FetchMetadataJobData>): Promise<void> {
  const { bookId, mode } = job.data;
  const book = await prisma.book.findUnique({ where: { id: bookId } });
  if (!book) return; // book deleted — silent no-op
  const isbn = book.isbn13 ?? book.isbn10;
  if (!isbn) {
    await prisma.book.update({
      where: { id: bookId },
      data: { metadataFetchStatus: 'NOT_FOUND', metadataAttemptCount: { increment: 1 } },
    });
    return;
  }

  // Budget check — 1 token covers the pair of upstream calls in this job invocation
  try {
    await apiBudget.consume('global', 1);
  } catch {
    await prisma.$transaction([
      prisma.book.update({
        where: { id: bookId },
        data: { metadataFetchStatus: 'ERROR', metadataAttemptCount: { increment: 1 } },
      }),
      prisma.auditLog.create({
        data: {
          action: 'library.book.metadata_fetch_failed',
          actorId: null,
          targetType: 'BOOK',
          targetId: bookId,
          metadata: { reason: 'api_budget_exhausted', isbn } as any,
        },
      }),
    ]);
    return;
  }

  const results = await Promise.allSettled([fetchGoogle(isbn), fetchOpenLibrary(isbn)]);

  const transient = results.filter(
    (r) => r.status === 'rejected' && r.reason instanceof ProviderTransientError,
  );
  const fulfilled = results
    .filter((r): r is PromiseFulfilledResult<NormalizedPayload | null> => r.status === 'fulfilled')
    .map((r) => r.value)
    .filter((v): v is NormalizedPayload => v !== null);

  // All transient AND no successful payloads → either retry or terminal ERROR
  if (fulfilled.length === 0 && transient.length === results.length) {
    const isLast = job.attemptsMade >= (job.opts.attempts ?? 1);
    if (!isLast) {
      throw new Error('All metadata providers transient-failed; will retry');
    }
    await prisma.$transaction([
      prisma.book.update({
        where: { id: bookId },
        data: { metadataFetchStatus: 'ERROR', metadataAttemptCount: { increment: 1 } },
      }),
      prisma.auditLog.create({
        data: {
          action: 'library.book.metadata_fetch_failed',
          actorId: null,
          targetType: 'BOOK',
          targetId: bookId,
          metadata: { isbn, attempts: job.attemptsMade } as any,
        },
      }),
    ]);
    return;
  }

  if (fulfilled.length === 0) {
    await prisma.book.update({
      where: { id: bookId },
      data: { metadataFetchStatus: 'NOT_FOUND', metadataAttemptCount: { increment: 1 } },
    });
    return;
  }

  const merged = mergePayloads(fulfilled);
  const patch = applyPolicy(
    {
      description: book.description,
      publisher: book.publisher,
      publishedYear: book.publishedYear,
      language: book.language,
      coverPath: book.coverPath,
    },
    merged,
    mode,
  );

  let coverRel: string | null = book.coverPath;
  if (merged.coverUrl && (mode === 'manual' || book.coverPath === null)) {
    try {
      const result = await downloadAndNormalize(merged.coverUrl, bookId);
      if (result) coverRel = result.relPath;
    } catch (err) {
      // best-effort, keep going
      console.warn('[fetch-metadata] cover download failed', err);
    }
  }

  await prisma.book.update({
    where: { id: bookId },
    data: {
      ...patch,
      coverPath: coverRel,
      metadataFetchStatus: 'FETCHED',
      metadataFetchedAt: new Date(),
      metadataAttemptCount: { increment: 1 },
    },
  });
}
```

- [ ] **Step 4: Run, PASS**

```bash
pnpm vitest run tests/integration/worker-fetch-metadata.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add worker/jobs/fetch-metadata.ts tests/integration/worker-fetch-metadata.test.ts
git commit -m "feat(phase-2b/B): fetch-metadata job (auto/manual modes, transient retry, audit on failure)"
```

### Task B.2 — Register queue + worker in `worker/index.ts`

**Files:**
- Modify: `worker/index.ts`

- [ ] **Step 1: Add queue + Worker registration**

In `worker/index.ts`, locate the existing `Queue` / `Worker` setup pattern (cf. scan-file in Phase 2A'). Add :

```ts
import { fetchMetadataJob, type FetchMetadataJobData } from './jobs/fetch-metadata.js';

// Near the other queue declarations:
export const metadataQueue = new Queue('metadata', { connection });

new Worker<FetchMetadataJobData>(
  'metadata',
  async (job) => {
    if (job.name === 'fetch-metadata') return fetchMetadataJob(job);
  },
  { connection, concurrency: 2 },
);
```

- [ ] **Step 2: Build worker**

```bash
pnpm --filter ./worker run build 2>/dev/null || (cd worker && pnpm tsc -p tsconfig.json)
```

Expected: clean build, no missing modules.

- [ ] **Step 3: Smoke-run worker locally**

```bash
docker compose up -d redis pg
STORAGE_ROOT=/tmp/biblio-data pnpm tsx worker/index.ts &
WORKER_PID=$!
sleep 3
kill $WORKER_PID
```

Expected: log lines indicating "metadata" queue ready, no crashes.

- [ ] **Step 4: Commit**

```bash
git add worker/index.ts
git commit -m "feat(phase-2b/B): register metadata queue + worker"
```

### Task B.3 — Worker isolation guard

**Files:**
- Create: `scripts/check-worker-isolation.ts`
- Modify: `package.json` (add script if not present)

- [ ] **Step 1: Write script**

```ts
// scripts/check-worker-isolation.ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(process.cwd(), 'worker');
const FORBIDDEN = /from\s+['"`](\.\.\/)+src\//;

const offenders: Array<{ file: string; match: string }> = [];
function walk(dir: string) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      walk(p);
      continue;
    }
    if (!/\.(m?ts|m?js)$/.test(entry)) continue;
    const text = readFileSync(p, 'utf-8');
    for (const line of text.split('\n')) {
      const m = FORBIDDEN.exec(line);
      if (m) offenders.push({ file: relative(process.cwd(), p), match: line.trim() });
    }
  }
}
walk(ROOT);

if (offenders.length) {
  console.error('Worker self-containment violation: imports from src/ are forbidden.');
  for (const o of offenders) console.error(`  ${o.file}: ${o.match}`);
  process.exit(1);
}
console.log('worker/: no src/ imports — OK');
```

- [ ] **Step 2: Add npm script**

In `package.json` `scripts` :

```json
"check:worker-isolation": "tsx scripts/check-worker-isolation.ts"
```

- [ ] **Step 3: Run**

```bash
pnpm check:worker-isolation
```

Expected: `worker/: no src/ imports — OK`. If a violation is reported, fix the import (vendor the dep into `worker/lib/`).

- [ ] **Step 4: Wire into CI** — locate `.github/workflows/ci.yml` "Lint, typecheck, unit tests" job and append `pnpm check:worker-isolation` after `pnpm typecheck`.

- [ ] **Step 5: Commit**

```bash
git add scripts/check-worker-isolation.ts package.json .github/workflows/ci.yml
git commit -m "ci(phase-2b/B): enforce worker self-containment via static check"
```

---

## Module 2B'.C — tRPC integration

### Task C.1 — Add `refreshMetadata` mutation

**Files:**
- Modify: `src/server/trpc/schemas/book.ts` (add input)
- Modify: `src/server/trpc/routers/library/books.ts`
- Modify: `src/lib/audit-log.ts` (add 2 actions)
- Test: `tests/integration/library-books-refresh-metadata.test.ts`

- [ ] **Step 1: Add zod input**

In `src/server/trpc/schemas/book.ts` :

```ts
export const refreshMetadataInput = z.object({ id: z.string().cuid() });
```

- [ ] **Step 2: Add audit actions**

In `src/lib/audit-log.ts`, in the union of `action`, append :

```ts
| 'library.book.metadata_refresh_requested'
| 'library.book.metadata_fetch_failed'
```

- [ ] **Step 3: Write integration test — follows pattern from `tests/integration/library-books-create.test.ts`**

```ts
// tests/integration/library-books-refresh-metadata.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appRouter } from '@/server/trpc/routers/_app';
import type { TrpcContext } from '@/server/trpc/context';
import { metadataQueue } from '@/server/queues/metadata';
import { getTestPrisma, truncateAll } from './setup/prisma';
import { makeCtxForRole } from './_helpers/auth-ctx';

const prisma = getTestPrisma();

describe('library.books.refreshMetadata', () => {
  beforeEach(async () => {
    await truncateAll();
    vi.restoreAllMocks();
  });

  it('LIBRARY_ADMIN can refresh — book → PENDING + audit recorded + queue.add called with mode "manual"', async () => {
    const addSpy = vi.spyOn(metadataQueue, 'add').mockResolvedValue(undefined as any);
    const { session, user, libraryId } = await makeCtxForRole('LIBRARY_ADMIN');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId } });
    const book = await prisma.book.create({
      data: { libraryId: lib.id, title: 'X', authors: ['A'], isbn13: '9782070612758' },
    });

    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = appRouter.createCaller(ctx);
    await caller.library.books.refreshMetadata({ slug: lib.slug, id: book.id });

    const updated = await prisma.book.findUniqueOrThrow({ where: { id: book.id } });
    expect(updated.metadataFetchStatus).toBe('PENDING');

    expect(addSpy).toHaveBeenCalledWith(
      'fetch-metadata',
      { bookId: book.id, mode: 'manual' },
    );

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'library.book.metadata_refresh_requested', targetId: book.id },
    });
    expect(audit).not.toBeNull();
    expect(audit!.actorId).toBe(user!.id);
  });

  it('returns BAD_REQUEST when book has no ISBN', async () => {
    vi.spyOn(metadataQueue, 'add').mockResolvedValue(undefined as any);
    const { session, user, libraryId } = await makeCtxForRole('LIBRARY_ADMIN');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId } });
    const book = await prisma.book.create({
      data: { libraryId: lib.id, title: 'No ISBN', authors: ['A'] },
    });
    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.library.books.refreshMetadata({ slug: lib.slug, id: book.id }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('MEMBER cannot refresh — FORBIDDEN', async () => {
    const { session, user, libraryId } = await makeCtxForRole('MEMBER');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId } });
    const book = await prisma.book.create({
      data: { libraryId: lib.id, title: 'X', authors: ['A'], isbn13: '9782070612758' },
    });
    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.library.books.refreshMetadata({ slug: lib.slug, id: book.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('per-book rate limit → TOO_MANY_REQUESTS on second call', async () => {
    vi.spyOn(metadataQueue, 'add').mockResolvedValue(undefined as any);
    const { session, user, libraryId } = await makeCtxForRole('LIBRARY_ADMIN');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId } });
    const book = await prisma.book.create({
      data: { libraryId: lib.id, title: 'X', authors: ['A'], isbn13: '9782070612758' },
    });
    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = appRouter.createCaller(ctx);
    await caller.library.books.refreshMetadata({ slug: lib.slug, id: book.id });
    await expect(
      caller.library.books.refreshMetadata({ slug: lib.slug, id: book.id }),
    ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
  });
});
```

Note: the `slug` field in inputs is required because library router middleware resolves `ctx.library` from it (cf. existing `library.books.create` tests). Add `slug: z.string()` to `refreshMetadataInput` :

```ts
export const refreshMetadataInput = z.object({
  slug: z.string(),
  id: z.string().cuid(),
});
```

- [ ] **Step 4: Run, FAIL**

```bash
pnpm vitest run tests/integration/library-books-refresh-metadata.test.ts
```

- [ ] **Step 5: Implement mutation in `src/server/trpc/routers/library/books.ts`**

Append after `hardDelete` :

```ts
import { metadataRefreshPerAdminLimiter, metadataRefreshPerBookLimiter } from '@/lib/rate-limit';
import { metadataQueue } from '@/server/queues/metadata'; // see Step 6
import { refreshMetadataInput } from '../../schemas/book';

  refreshMetadata: libraryAdminProcedure
    .input(refreshMetadataInput)
    .mutation(async ({ ctx, input }) => {
      try { await metadataRefreshPerAdminLimiter.consume(ctx.user.id); }
      catch { throw new TRPCError({ code: 'TOO_MANY_REQUESTS' }); }

      const book = await assertBookInLibrary(input.id, ctx.library.id);
      if (!book.isbn13 && !book.isbn10) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'NO_ISBN' });
      }

      try { await metadataRefreshPerBookLimiter.consume(input.id); }
      catch { throw new TRPCError({ code: 'TOO_MANY_REQUESTS' }); }

      await db.book.update({
        where: { id: input.id },
        data: { metadataFetchStatus: 'PENDING' },
      });
      await metadataQueue.add('fetch-metadata', { bookId: input.id, mode: 'manual' });
      await recordAudit({
        action: 'library.book.metadata_refresh_requested',
        actor: { id: ctx.user.id },
        target: { type: 'BOOK', id: input.id },
        metadata: { libraryId: ctx.library.id },
        req: { ip: ctx.ip },
      });
      return { ok: true as const };
    }),
```

- [ ] **Step 6: Create app-side queue handle**

`src/server/queues/metadata.ts` :

```ts
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { getEnv } from '@/lib/env';

const connection = new IORedis(getEnv().REDIS_URL, { maxRetriesPerRequest: null });
export const metadataQueue = new Queue('metadata', { connection });
```

(Or follow the existing pattern if `src/server/queues/` already centralizes BullMQ producers — re-use it.)

- [ ] **Step 7: Run test, PASS**

```bash
pnpm vitest run tests/integration/library-books-refresh-metadata.test.ts
```

Expected: 4 passed.

- [ ] **Step 8: Commit**

```bash
git add src/server/trpc/schemas/book.ts src/server/trpc/routers/library/books.ts src/lib/audit-log.ts src/server/queues/metadata.ts tests/integration/library-books-refresh-metadata.test.ts
git commit -m "feat(phase-2b/C): library.books.refreshMetadata mutation + audit + rate limits"
```

### Task C.2 — Auto-enqueue on `create`

**Files:**
- Modify: `src/server/trpc/routers/library/books.ts` (the existing `create` mutation)
- Test: extend `tests/integration/library-books-refresh-metadata.test.ts` OR create `tests/integration/library-books-create-enqueue.test.ts`

- [ ] **Step 1: Write test**

```ts
// tests/integration/library-books-create-enqueue.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appRouter } from '@/server/trpc/routers/_app';
import type { TrpcContext } from '@/server/trpc/context';
import { metadataQueue } from '@/server/queues/metadata';
import { getTestPrisma, truncateAll } from './setup/prisma';
import { makeCtxForRole } from './_helpers/auth-ctx';

const prisma = getTestPrisma();

describe('library.books.create — metadata enqueue', () => {
  beforeEach(async () => {
    await truncateAll();
    vi.restoreAllMocks();
  });

  it('enqueues fetch-metadata in auto mode when ISBN provided', async () => {
    const addSpy = vi.spyOn(metadataQueue, 'add').mockResolvedValue(undefined as any);
    const { session, user, libraryId } = await makeCtxForRole('LIBRARY_ADMIN');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId } });
    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = appRouter.createCaller(ctx);
    const book = await caller.library.books.create({
      slug: lib.slug,
      title: 'T',
      authors: ['A'],
      isbn13: '9782070612758',
    });
    expect(addSpy).toHaveBeenCalledWith(
      'fetch-metadata',
      { bookId: book.id, mode: 'auto' },
    );
  });

  it('does NOT enqueue when no ISBN provided', async () => {
    const addSpy = vi.spyOn(metadataQueue, 'add').mockResolvedValue(undefined as any);
    const { session, user, libraryId } = await makeCtxForRole('LIBRARY_ADMIN');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId } });
    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = appRouter.createCaller(ctx);
    await caller.library.books.create({ slug: lib.slug, title: 'T', authors: ['A'] });
    expect(addSpy).not.toHaveBeenCalled();
  });

  it('does not fail the create if enqueue throws (best-effort)', async () => {
    vi.spyOn(metadataQueue, 'add').mockRejectedValue(new Error('redis down'));
    const { session, user, libraryId } = await makeCtxForRole('LIBRARY_ADMIN');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId } });
    const ctx: TrpcContext = { session, user, ip: '203.0.113.1' };
    const caller = appRouter.createCaller(ctx);
    const book = await caller.library.books.create({
      slug: lib.slug,
      title: 'T',
      authors: ['A'],
      isbn13: '9782070612758',
    });
    expect(book.id).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run, FAIL**

```bash
pnpm vitest run tests/integration/library-books-create-enqueue.test.ts
```

- [ ] **Step 3: Modify `create` mutation**

In `src/server/trpc/routers/library/books.ts`, after the existing `db.book.create({...})` and `recordAudit({...})` calls, before `return book;`, append :

```ts
if (book.isbn13 || book.isbn10) {
  try {
    await db.book.update({
      where: { id: book.id },
      data: { metadataFetchStatus: 'PENDING' },
    });
    await metadataQueue.add('fetch-metadata', { bookId: book.id, mode: 'auto' });
  } catch (err) {
    console.warn('[library.books.create] metadata enqueue failed (non-fatal)', err);
  }
}
```

- [ ] **Step 4: Run, PASS**

```bash
pnpm vitest run tests/integration/library-books-create-enqueue.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/server/trpc/routers/library/books.ts tests/integration/library-books-create-enqueue.test.ts
git commit -m "feat(phase-2b/C): auto-enqueue fetch-metadata when create has ISBN"
```

### Task C.3 — Permissions matrix update

**Files:**
- Modify: `tests/integration/permissions-matrix.test.ts`
- Modify: `docs/permissions-matrix.md`

- [ ] **Step 1: Add row to `permissions-matrix.test.ts`**

Locate the matrix definition (the array of `{ action, expectAllow: { ... } }` cases) and add :

```ts
{
  action: 'library.books.refreshMetadata',
  call: (caller, libBookId) => caller.books.refreshMetadata({ id: libBookId.bookId }),
  needsBook: true,
  expectAllow: {
    visitor: false,
    member: false,
    memberCanUpload: false,
    libraryAdmin: true,
    globalAdmin: true,
  },
},
```

- [ ] **Step 2: Update `docs/permissions-matrix.md`**

Add the row to the markdown table.

- [ ] **Step 3: Run**

```bash
pnpm vitest run tests/integration/permissions-matrix.test.ts
```

Expected: PASS (now 5 more cases covered).

- [ ] **Step 4: Commit**

```bash
git add tests/integration/permissions-matrix.test.ts docs/permissions-matrix.md
git commit -m "test(phase-2b/C): permissions matrix row for refreshMetadata"
```

---

## Module 2B'.D — UI integration

### Task D.1 — Cover serving route

**Files:**
- Create: `src/app/api/covers/[bookId]/route.ts`
- Test: `tests/integration/covers-route.test.ts`

- [ ] **Step 1: Write test (uses `vi.mock` on `@/lib/auth` because the route reads session directly)**

```ts
// tests/integration/covers-route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getTestPrisma, truncateAll } from './setup/prisma';
import { makeCtxForRole } from './_helpers/auth-ctx';

const prisma = getTestPrisma();

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth: authMock }));

// Import the route AFTER the mock is hoisted
import { GET } from '@/app/api/covers/[bookId]/route';

async function callRoute(bookId: string) {
  return GET(new Request(`http://localhost/api/covers/${bookId}`) as any, {
    params: Promise.resolve({ bookId }),
  });
}

describe('GET /api/covers/[bookId]', () => {
  beforeEach(async () => {
    await truncateAll();
    authMock.mockReset();
  });

  it('returns 200 + image/jpeg for an authed member of the book library', async () => {
    const { user, libraryId } = await makeCtxForRole('MEMBER');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId } });
    const book = await prisma.book.create({
      data: { libraryId: lib.id, title: 'X', authors: ['A'], coverPath: '' },
    });
    // Patch coverPath now that we know the bookId
    await prisma.book.update({
      where: { id: book.id },
      data: { coverPath: `covers/${book.id}.jpg` },
    });
    const root = process.env.STORAGE_ROOT!;
    await mkdir(join(root, 'covers'), { recursive: true });
    await writeFile(join(root, 'covers', `${book.id}.jpg`), Buffer.from([0xff, 0xd8, 0xff, 0xe0]));

    authMock.mockResolvedValue({ user: { id: user!.id, role: 'USER' } });
    const res = await callRoute(book.id);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toMatch(/max-age/);
  });

  it('returns 404 when book has no cover', async () => {
    const { user, libraryId } = await makeCtxForRole('MEMBER');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId } });
    const book = await prisma.book.create({
      data: { libraryId: lib.id, title: 'X', authors: ['A'] },
    });
    authMock.mockResolvedValue({ user: { id: user!.id, role: 'USER' } });
    const res = await callRoute(book.id);
    expect(res.status).toBe(404);
  });

  it('returns 401 when no session', async () => {
    const { libraryId } = await makeCtxForRole('MEMBER');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId } });
    const book = await prisma.book.create({
      data: { libraryId: lib.id, title: 'X', authors: ['A'], coverPath: 'covers/x.jpg' },
    });
    authMock.mockResolvedValue(null);
    const res = await callRoute(book.id);
    expect(res.status).toBe(401);
  });

  it('returns 403 for an outsider (not a member of the library)', async () => {
    const { libraryId } = await makeCtxForRole('MEMBER');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId } });
    const book = await prisma.book.create({
      data: { libraryId: lib.id, title: 'X', authors: ['A'], coverPath: `covers/x.jpg` },
    });
    // Create an outsider user with no LibraryMember row
    const outsider = await prisma.user.create({
      data: {
        email: 'outsider-cover@e2e.test',
        passwordHash: 'x',
        displayName: 'Outsider',
        role: 'USER',
        status: 'ACTIVE',
      },
    });
    authMock.mockResolvedValue({ user: { id: outsider.id, role: 'USER' } });
    const res = await callRoute(book.id);
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run, FAIL**

```bash
pnpm vitest run tests/integration/covers-route.test.ts
```

- [ ] **Step 3: Implement route**

```ts
// src/app/api/covers/[bookId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ bookId: string }> },
) {
  const { bookId } = await params;
  const session = await auth();
  if (!session?.user?.id) return new NextResponse('unauthorized', { status: 401 });

  if (!/^[a-z0-9]+$/.test(bookId)) return new NextResponse('bad id', { status: 400 });

  const book = await db.book.findUnique({
    where: { id: bookId },
    select: { id: true, libraryId: true, coverPath: true, metadataFetchedAt: true },
  });
  if (!book || !book.coverPath) return new NextResponse('not found', { status: 404 });

  const member = await db.libraryMember.findUnique({
    where: { libraryId_userId: { libraryId: book.libraryId, userId: session.user.id } },
    select: { id: true },
  });
  if (!member && session.user.role !== 'GLOBAL_ADMIN') {
    return new NextResponse('forbidden', { status: 403 });
  }

  const root = getEnv().STORAGE_ROOT;
  const path = join(root, book.coverPath);
  try {
    await stat(path);
  } catch {
    return new NextResponse('not found', { status: 404 });
  }
  const buf = await readFile(path);
  const etag = `"${book.id}-${book.metadataFetchedAt?.getTime() ?? 0}"`;
  return new NextResponse(buf, {
    status: 200,
    headers: {
      'content-type': 'image/jpeg',
      'cache-control': 'public, max-age=86400, immutable',
      etag,
    },
  });
}
```

- [ ] **Step 4: Run, PASS**

```bash
pnpm vitest run tests/integration/covers-route.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/covers/[bookId]/route.ts tests/integration/covers-route.test.ts
git commit -m "feat(phase-2b/D): /api/covers/:bookId route with member auth + cache headers"
```

### Task D.2 — `MetadataFetchStatusBadge` + `MetadataSourceBadge`

**Files:**
- Create: `src/components/books/MetadataFetchStatusBadge.tsx`
- Create: `src/components/books/MetadataSourceBadge.tsx`

- [ ] **Step 1: Status badge**

```tsx
// src/components/books/MetadataFetchStatusBadge.tsx
import { Badge } from '@/components/ui/badge';
import type { MetadataFetchStatus } from '@prisma/client';

const LABELS: Record<MetadataFetchStatus, { text: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  PENDING: { text: 'Métadonnées en cours', variant: 'secondary' },
  FETCHED: { text: 'Métadonnées récupérées', variant: 'outline' },
  NOT_FOUND: { text: 'Aucune metadata trouvée', variant: 'outline' },
  ERROR: { text: 'Échec metadata', variant: 'destructive' },
};

export function MetadataFetchStatusBadge({ status }: { status: MetadataFetchStatus | null }) {
  if (!status) return null;
  const { text, variant } = LABELS[status];
  return <Badge variant={variant}>{text}</Badge>;
}
```

- [ ] **Step 2: Source badge + refresh button (admin)**

```tsx
// src/components/books/MetadataSourceBadge.tsx
'use client';
import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import type { MetadataSource } from '@prisma/client';

const SOURCE_LABEL: Record<MetadataSource, string> = {
  GOOGLE_BOOKS: 'Google Books',
  OPEN_LIBRARY: 'Open Library',
  ISBNDB: 'ISBNdb',
  MANUAL: 'Saisie manuelle',
};

export function MetadataSourceBadge({
  bookId,
  source,
  fetchedAt,
  canRefresh,
  isPending,
}: {
  bookId: string;
  source: MetadataSource | null;
  fetchedAt: Date | null;
  canRefresh: boolean;
  isPending: boolean;
}) {
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const refresh = trpc.library.books.refreshMetadata.useMutation({
    onSuccess: () => {
      toast({ title: 'Rafraîchissement demandé', description: 'La récupération est en cours.' });
      utils.library.books.get.invalidate({ id: bookId });
    },
    onError: (err) => {
      const msg = err.data?.code === 'TOO_MANY_REQUESTS'
        ? 'Trop de tentatives — réessayez dans 1 h.'
        : err.message;
      toast({ variant: 'destructive', title: 'Échec', description: msg });
    },
    onSettled: () => setBusy(false),
  });

  const sourceLabel = source ? SOURCE_LABEL[source] : 'Aucune';
  const dateLabel = fetchedAt ? new Intl.DateTimeFormat('fr-FR').format(fetchedAt) : '—';

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <span>Source : {sourceLabel}{fetchedAt && ` · récupéré le ${dateLabel}`}</span>
      {canRefresh && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy || isPending}
          onClick={() => { setBusy(true); refresh.mutate({ id: bookId }); }}
        >
          {isPending ? 'En cours…' : 'Rafraîchir'}
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/components/books/MetadataFetchStatusBadge.tsx src/components/books/MetadataSourceBadge.tsx
git commit -m "feat(phase-2b/D): metadata status + source badges with refresh button"
```

### Task D.3 — Wire badges into BookCard + detail page

**Files:**
- Modify: `src/components/books/BookCard.tsx`
- Modify: `src/app/library/[slug]/books/[bookId]/page.tsx`

- [ ] **Step 1: BookCard — show pill if PENDING**

In `BookCard.tsx`, where the existing `ScanStatusBadge` is rendered, also render :

```tsx
{book.metadataFetchStatus === 'PENDING' && (
  <MetadataFetchStatusBadge status="PENDING" />
)}
```

(Add the import. The list/get queries already select all Book columns — verify with `select` block ; if not, extend.)

- [ ] **Step 2: Detail page — source badge + cover**

In `src/app/library/[slug]/books/[bookId]/page.tsx`, in the metadata section, render :

```tsx
<MetadataSourceBadge
  bookId={book.id}
  source={book.metadataSource}
  fetchedAt={book.metadataFetchedAt}
  canRefresh={isAdmin}
  isPending={book.metadataFetchStatus === 'PENDING'}
/>
```

For the cover, use `next/image` :

```tsx
{book.coverPath ? (
  <Image
    src={`/api/covers/${book.id}`}
    alt={`Couverture de ${book.title}`}
    width={240} height={360}
    className="rounded-md"
    unoptimized={false}
  />
) : (
  <div className="h-[360px] w-[240px] bg-muted rounded-md flex items-center justify-center text-muted-foreground">
    Pas de couverture
  </div>
)}
```

- [ ] **Step 3: Typecheck + manual smoke**

```bash
pnpm typecheck && pnpm dev
```

Visit `http://localhost:3000/library/<slug>/books/<id>` as admin → confirm Refresh button appears, badge displays.

- [ ] **Step 4: Commit**

```bash
git add src/components/books/BookCard.tsx src/app/library/[slug]/books/[bookId]/page.tsx
git commit -m "feat(phase-2b/D): wire metadata badges + cover image into BookCard and detail page"
```

---

## Module 2B'.E — E2E + final checks

### Task E.1 — E2E spec (happy path + manual refresh)

**Files:**
- Create: `tests/e2e/book-metadata.spec.ts`

- [ ] **Step 1: Write spec — follows the in-spec direct-Prisma seeding pattern from `tests/e2e/book-create-flow.spec.ts`**

```ts
// tests/e2e/book-metadata.spec.ts
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import {
  getPrisma,
  cleanupTestData,
  cleanupE2ELibrary,
  flushRateLimit,
  disconnect,
} from './helpers/db';
import { submitLogin } from './helpers/auth';
import { hashPassword } from '../../src/lib/password';

const PASSWORD = 'TestPass-123!';
const LIBRARY_SLUG = 'e2e-2b-metadata';
const LIBRARY_NAME = 'E2E 2B Metadata';
const ADMIN_EMAIL = 'admin-meta@e2e.test';
const MEMBER_EMAIL = 'member-meta@e2e.test';
const ISBN = '9782070612758';

const prisma = getPrisma();

const GB_FIXTURE = readFileSync(`tests/fixtures/metadata/google-books-${ISBN}.json`, 'utf-8');
const OL_FIXTURE = readFileSync(`tests/fixtures/metadata/open-library-${ISBN}.json`, 'utf-8');
const COVER_FIXTURE = readFileSync('tests/fixtures/metadata/cover-sample.jpg');

async function seedAdminWithLibrary() {
  const admin = await prisma.user.create({
    data: {
      email: ADMIN_EMAIL,
      displayName: 'Admin Meta',
      passwordHash: await hashPassword(PASSWORD),
      role: 'GLOBAL_ADMIN',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });
  const library = await prisma.library.create({
    data: { name: LIBRARY_NAME, slug: LIBRARY_SLUG },
  });
  await prisma.libraryMember.create({
    data: { libraryId: library.id, userId: admin.id, role: 'LIBRARY_ADMIN', canUpload: true },
  });
  return { admin, library };
}

async function seedPlainMember(libraryId: string) {
  const user = await prisma.user.create({
    data: {
      email: MEMBER_EMAIL,
      displayName: 'Plain Member',
      passwordHash: await hashPassword(PASSWORD),
      role: 'USER',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });
  await prisma.libraryMember.create({
    data: { libraryId, userId: user.id, role: 'MEMBER', canUpload: false },
  });
  return user;
}

async function routeProviders(page: import('@playwright/test').Page) {
  await page.route(/googleapis\.com\/books/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: GB_FIXTURE });
  });
  await page.route(/openlibrary\.org\/api\/books/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: OL_FIXTURE });
  });
  await page.route(/(?:books\.google\.com|covers\.openlibrary\.org)/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'image/jpeg', body: COVER_FIXTURE });
  });
}

test.describe('@e2e.test book metadata', () => {
  test.beforeEach(async () => {
    await cleanupE2ELibrary(LIBRARY_SLUG);
    await cleanupTestData();
    await flushRateLimit();
  });
  test.afterEach(async () => {
    await cleanupE2ELibrary(LIBRARY_SLUG);
  });
  test.afterAll(async () => {
    await disconnect();
  });

  test('admin creates book with ISBN → metadata + cover appear after refresh', async ({ page }) => {
    const { library } = await seedAdminWithLibrary();
    await routeProviders(page);

    await page.goto('/login');
    await submitLogin(page, ADMIN_EMAIL, PASSWORD);

    await page.goto(`/library/${library.slug}/books/new`);
    await page.getByLabel(/titre/i).fill('Le Petit Prince');
    await page.getByLabel(/auteur/i).fill('Antoine de Saint-Exupéry');
    await page.getByLabel(/isbn-?13/i).fill(ISBN);
    await page.getByRole('button', { name: /créer/i }).click();

    await expect(page).toHaveURL(/\/books\/[a-z0-9]+$/);
    await expect(page.getByText(/Métadonnées en cours/)).toBeVisible({ timeout: 5_000 });

    let fetched = false;
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(5_000);
      await page.reload();
      if (await page.getByText(/Source\s*:\s*Google Books/).isVisible().catch(() => false)) {
        fetched = true;
        break;
      }
    }
    expect(fetched).toBe(true);
    await expect(page.getByAltText(/Couverture/)).toBeVisible();
  });

  test('admin clicks Rafraîchir on a FETCHED book → status flips to PENDING', async ({ page }) => {
    const { library } = await seedAdminWithLibrary();
    const book = await prisma.book.create({
      data: {
        libraryId: library.id,
        title: 'Le Petit Prince',
        authors: ['Antoine de Saint-Exupéry'],
        isbn13: ISBN,
        description: 'Old description.',
        metadataSource: 'GOOGLE_BOOKS',
        metadataFetchStatus: 'FETCHED',
        metadataFetchedAt: new Date(),
      },
    });
    await routeProviders(page);

    await page.goto('/login');
    await submitLogin(page, ADMIN_EMAIL, PASSWORD);

    await page.goto(`/library/${library.slug}/books/${book.id}`);
    await expect(page.getByText(/Source\s*:\s*Google Books/)).toBeVisible();
    await page.getByRole('button', { name: /Rafraîchir/ }).click();
    await expect(
      page.getByText(/Rafraîchissement demandé|Métadonnées en cours/),
    ).toBeVisible({ timeout: 5_000 });
  });

  test('non-admin member does not see Rafraîchir button', async ({ page }) => {
    const { library } = await seedAdminWithLibrary();
    await seedPlainMember(library.id);
    const book = await prisma.book.create({
      data: {
        libraryId: library.id,
        title: 'Le Petit Prince',
        authors: ['Antoine de Saint-Exupéry'],
        isbn13: ISBN,
        metadataSource: 'GOOGLE_BOOKS',
        metadataFetchStatus: 'FETCHED',
        metadataFetchedAt: new Date(),
      },
    });

    await page.goto('/login');
    await submitLogin(page, MEMBER_EMAIL, PASSWORD);
    await page.goto(`/library/${library.slug}/books/${book.id}`);
    await expect(page.getByText(/Source\s*:\s*Google Books/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Rafraîchir/ })).toHaveCount(0);
  });
});
```

- [ ] **Step 2: Run locally**

```bash
docker compose up -d redis pg
STORAGE_ROOT=/tmp/biblio-data pnpm tsx worker/index.ts &
WORKER_PID=$!
pnpm exec next dev -p 3001 &
DEV_PID=$!
sleep 5
pnpm playwright test tests/e2e/book-metadata.spec.ts
kill $DEV_PID $WORKER_PID
```

Expected: 3 passed.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/book-metadata.spec.ts
git commit -m "test(phase-2b/E): E2E for create-with-isbn + manual refresh + permission gate"
```

### Task E.2 — Wire CI

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Confirm metadata test files run in existing jobs**

The "Lint, typecheck, unit tests" job runs `pnpm test --run` which picks up `tests/unit/**` and `tests/integration/**` automatically (Vitest config). Verify by `cat vitest.config.ts`. If a new dir prefix is excluded, add it.

- [ ] **Step 2: E2E shard distribution**

`book-metadata.spec.ts` will be auto-distributed across 4 shards. No CI change needed.

- [ ] **Step 3: Confirm STORAGE_ROOT is exported in CI**

The Phase 2A' CI already exports `STORAGE_ROOT=$RUNNER_TEMP/biblio-data` via `$GITHUB_ENV`. No change.

- [ ] **Step 4: Push branch and watch CI**

```bash
git push -u origin feat/phase-2b-metadata
```

Then `gh run watch` (or via the GitHub UI). Fix any drifts and commit on the same branch.

- [ ] **Step 5: Commit (only if CI changes were needed)**

```bash
git add .github/workflows/ci.yml
git commit -m "ci(phase-2b/E): adjustments for metadata phase"
```

### Task E.3 — Final smoke + PR

**Files:** N/A (release prep)

- [ ] **Step 1: Manual smoke (option A from Phase 1D)**

1. Login as Library Admin.
2. Create a book with ISBN `9782070612758`.
3. Refresh page after 5 s → metadata + cover visible.
4. Click Rafraîchir → status passes to PENDING → after 5 s + refresh, FETCHED with new fetchedAt.
5. Create a book without ISBN → no badge, status null.
6. As plain member, visit a book → no Refresh button.

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "feat(phase-2b): metadata fetch chain + cover cache" --body "$(cat <<'EOF'
## Summary
- Async metadata fetch on book create (when ISBN present) + manual admin refresh.
- Sources: Google Books + Open Library, per-field merge (ISBNdb deferred).
- Cover cache under `STORAGE_ROOT/covers/{bookId}.jpg`, sharp-normalized JPEG.
- New Book fields: `metadataFetchStatus`, `metadataFetchedAt`, `metadataAttemptCount`.
- New rate-limit buckets: 1/h/book, 20/day/admin, 800/day API budget.
- Worker self-contained (libs under `worker/lib/metadata/`), CI-enforced via `check-worker-isolation`.

## Test plan
- [x] Unit: 8 merge tests + 6 cover-storage tests
- [x] Integration: Google Books client (5), Open Library client (5), worker job (4), refreshMetadata router (4), create-enqueue (3), covers route (3)
- [x] E2E: 3 specs (happy path, manual refresh, permission gate)
- [x] Permissions matrix extended
- [x] Manual smoke (local)
- [ ] CI 8/8 green

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: After CI green + manual review, merge (squash, like Phase 2A')**

```bash
gh pr merge --squash --delete-branch
git checkout main && git pull --ff-only
git tag phase-2b-complete
git push origin phase-2b-complete
```

- [ ] **Step 4: Update memory**

Write Phase 2B' clôture memory under `~/.claude/projects/.../memory/phase-2b-completed.md` (mirror the shape of `phase-2a-completed.md`), then add a one-liner to `MEMORY.md`.

---

## Risk register (cross-cutting)

| Risk | Mitigation |
|---|---|
| Google Books quota hit during a load test | `metadataApiBudgetLimiter` (800/day) gates outbound HTTP from worker before any provider call |
| Open Library cover URLs sometimes 302 → CDN | `fetch` follows redirects by default ; covered by `cover-storage` tests via MockAgent (add a 302 → 200 case if real fixtures show it) |
| `sharp` libvips native binary missing on CI runner | `pnpm` installs prebuilt binaries automatically ; if a runner lacks AVX, switch to `sharp@alpine` build flag in CI step (document if encountered) |
| Race : admin clicks Refresh while auto-job still in flight | First Refresh marks `PENDING` (idempotent) ; both jobs may run, last writer wins. Acceptable for MVP — second job's `attemptCount` increments. |
| ISBN with hyphens (`978-2-07-061275-8`) at creation | Strip hyphens server-side before persisting `isbn13` (already a Phase 1D concern? Verify, otherwise add a 2-line normalize in `create`). |
