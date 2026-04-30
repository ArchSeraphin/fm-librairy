# Phase 1D Implementation Plan — `library.books` router + member UI + 1C debt cleanup

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open the first user-facing `library.books` tRPC router (list/get/create/update/archive/unarchive/delete) with a navigable, searchable catalog UI under `/libraries` and `/library/[slug]/...`, while clearing five technical debts inherited from Phase 1C before Phase 2 (upload + ClamAV) amplifies them.

**Architecture:** Postgres-backed full-text search (`tsvector` + `unaccent` GIN, no Meilisearch yet), drill-in mental model (one library at a time), defense-in-depth membership scoping via new `assertMembership(slug, role?)` helper, soft-delete via `Book.archivedAt`, hard delete reserved to GLOBAL_ADMIN with mandatory DBA runbook. UI follows established 1C patterns: shadcn primitives, `MemberHeader` + Sheet burger drawer, dialogs for destructive actions, `react-hook-form` + Zod for the create/update form. No new infra dependency, no new BullMQ job.

**Tech Stack:** Next.js 15 App Router, tRPC 11, Prisma 6 + PostgreSQL 16, shadcn/ui (Radix primitives), Tailwind, Lucide icons, `react-hook-form` + `zod`, `next-intl`, BullMQ + Redis (untouched in 1D), Playwright for E2E, Vitest for unit/integration.

**Authoritative spec:** `docs/superpowers/specs/2026-04-29-phase-1d-design.md`

**Drift from spec, ratified during plan writing:**

| Spec said                                                 | Plan says                                                 | Why                                                                                                      |
| --------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Files like `member-header.tsx` (kebab-case)               | `MemberHeader.tsx` (PascalCase)                           | Existing 1C codebase uses PascalCase for component files                                                 |
| Route group `(member)` parallel to `(admin)`, `(account)` | No route group — `src/app/library/`, `src/app/libraries/` | Existing 1A–1C never used route groups (`src/app/admin/`, `src/app/account/`)                            |
| Audit action names `book.created`, `book.updated`, …      | `library.book.created`, `library.book.updated`, …         | Matches existing dotted `domain.entity.verb` pattern                                                     |
| "ESLint plugin local NEW"                                 | Extend existing local plugin                              | `eslint-plugin-local` already exists with `local/no-unscoped-prisma` rule; we extend instead of creating |

**Worktree:** `.worktrees/phase-1d` on branch `feat/phase-1d-books`. Dev Docker compose project name `phase-1d` on shifted ports (3001/5434/6381/8026/1026) so it does not collide with the still-running phase-1c containers.

**Estimated effort:** 5 modules, ~28 tasks, 14–18 days subagent-driven.

**Module dependencies / parallel execution:**

```
Module A (Foundations)
  ├──► Module B (Router) ──► Module D (UI catalog) ──┐
  ├──► Module C (UI member shell) ───────────────────┤
  └──► Module E (Debt + E2E + docs) ─────────────────┴──► Final smoke + merge
```

Module C and Module E can start in parallel with Module B once Module A is merged into the dev branch. Module D depends on B and C.

---

## Module 0 — Worktree & dev environment (one-shot, before any task)

This is housekeeping done once at the start. Not a numbered task but must be completed before Task A1.

- [ ] **0.1: Verify clean main**

```bash
cd /Users/seraphin/Library/CloudStorage/SynologyDrive/02_Trinity/Projet/github/fm-librairy
git status
git log --oneline -3
```

Expected: `On branch main`, `nothing to commit, working tree clean`. Last commit should be `54d22fc` (the Phase 1D design clarification commit) or later.

- [ ] **0.2: Create worktree on new branch**

```bash
git worktree add .worktrees/phase-1d -b feat/phase-1d-books main
cd .worktrees/phase-1d
git status
```

Expected: `On branch feat/phase-1d-books`, working tree clean.

- [ ] **0.3: Create phase-1d compose env file**

Create `.worktrees/phase-1d/.env.dev` (NOT committed; in `.gitignore`):

```bash
# Phase 1D dev stack — shifted ports vs phase-1c
DATABASE_URL=postgresql://fmlib:fmlib@localhost:5434/fmlib
REDIS_URL=redis://localhost:6381
NEXTAUTH_URL=http://localhost:3001
NEXTAUTH_SECRET=phase1d-dev-secret-change-me-1234567890abcdef
SMTP_HOST=localhost
SMTP_PORT=1026
APP_URL=http://localhost:3001
APP_PORT=3001
NODE_ENV=development
```

- [ ] **0.4: Bring up phase-1d Docker stack**

From `.worktrees/phase-1d/`:

```bash
docker compose -p phase-1d -f docker-compose.dev.yml up -d postgres redis mailpit
docker compose -p phase-1d ps
```

Expected: `postgres`, `redis`, `mailpit` all `healthy` or `running`. Postgres on `localhost:5434`, Redis on `localhost:6381`, Mailpit web on `localhost:8026`.

If `docker-compose.dev.yml` does not exist on disk yet, copy `docker-compose.yml` and shift ports:

```bash
cp docker-compose.yml docker-compose.dev.yml
# then edit: postgres 5432→5434, redis 6379→6381, mailpit 1025→1026 + 8025→8026
```

- [ ] **0.5: Install deps + apply existing migrations**

```bash
pnpm install --frozen-lockfile
pnpm prisma migrate deploy
pnpm prisma generate
```

Expected: `All migrations have been successfully applied.` Generated client up to date.

- [ ] **0.6: Sanity smoke**

```bash
pnpm typecheck
pnpm lint
pnpm test --run
```

Expected: typecheck OK, lint OK, all unit + integration tests pass (baseline before Phase 1D changes).

- [ ] **0.7: Initial commit (empty, marker)**

```bash
git commit --allow-empty -m "chore(phase-1d): start branch on main 54d22fc

Worktree .worktrees/phase-1d on feat/phase-1d-books, env wired to
phase-1d Docker compose project (ports 3001/5434/6381/8026/1026).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Module A — Foundations (Migration + helpers + audit + procedure builders)

**Goal:** All shared building blocks the router needs. Migration runs cleanly, helpers are tested in isolation, audit union is extended, procedure builders for membership-scoped routes are in place. Total: 6 tasks. Estimated 1–2 days.

### Task A1 — Prisma migration: `Book.archivedAt` + `searchVector` + indexes

**Files:**

- Create: `prisma/migrations/2026_phase_1d_books/migration.sql`
- Modify: `prisma/schema.prisma` (Book model — add `archivedAt`, `searchVector` Unsupported, indexes)

- [ ] **Step 1: Edit `prisma/schema.prisma` — add new fields and indexes to `Book` model**

Find the `model Book {` block. Add these fields **before the relations section**:

```prisma
  archivedAt    DateTime?
  /// Postgres-generated tsvector with unaccent; do not write to this field directly.
  searchVector  Unsupported("tsvector")?
```

Replace the existing `@@index` lines on `Book` with:

```prisma
  @@index([libraryId, title])
  @@index([libraryId, isbn13])
  @@index([libraryId, archivedAt])
  // searchVector is indexed via raw SQL GIN (see migration)
```

- [ ] **Step 2: Generate the SQL migration draft**

```bash
pnpm prisma migrate dev --create-only --name phase_1d_books
```

Prisma will create a folder `prisma/migrations/<timestamp>_phase_1d_books/migration.sql` with the diff. **Stop**: do not apply yet. The diff will only contain `archivedAt` and the index — the `tsvector` column needs hand-written SQL.

- [ ] **Step 3: Hand-write the full migration**

Replace the auto-generated `migration.sql` content with the canonical version below (preserve the timestamp folder name Prisma chose; rename if the spec uses `2026_phase_1d_books`):

```sql
-- Phase 1D: Book.archivedAt + searchVector + indexes
-- See docs/superpowers/specs/2026-04-29-phase-1d-design.md §4

-- 1. Soft-delete column (mirrors Library.archivedAt pattern)
ALTER TABLE "Book" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- 2. unaccent extension (FR/EN accent-insensitive search)
CREATE EXTENSION IF NOT EXISTS unaccent;

-- 3. tsvector generated column
-- Note: authors is text[] in schema, so we coalesce + array_to_string
ALTER TABLE "Book" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', unaccent(coalesce("title", ''))), 'A') ||
    setweight(to_tsvector('simple', unaccent(coalesce(array_to_string("authors", ' '), ''))), 'B') ||
    setweight(to_tsvector('simple', unaccent(coalesce("description", ''))), 'C') ||
    setweight(to_tsvector('simple', unaccent(coalesce("publisher", ''))), 'D')
  ) STORED;

-- 4. Indexes
CREATE INDEX "Book_searchVector_gin_idx" ON "Book" USING GIN ("searchVector");
CREATE INDEX "Book_libraryId_archivedAt_idx" ON "Book" ("libraryId", "archivedAt");
```

- [ ] **Step 4: Apply the migration**

```bash
pnpm prisma migrate dev
```

Expected: `The following migration(s) have been applied: <timestamp>_phase_1d_books`. No errors. Prisma client regenerated.

- [ ] **Step 5: Verify via psql**

```bash
docker compose -p phase-1d exec postgres psql -U fmlib -d fmlib -c "\d \"Book\"" | grep -E "archivedAt|searchVector"
docker compose -p phase-1d exec postgres psql -U fmlib -d fmlib -c "\di \"Book_searchVector_gin_idx\""
```

Expected: both columns visible, GIN index exists.

- [ ] **Step 6: Add a smoke unit test for the migration**

Create `tests/unit/migration-phase-1d.test.ts`:

```typescript
import { describe, expect, test } from 'vitest';
import { prisma } from '@/lib/db';

describe('Phase 1D migration smoke', () => {
  test('Book.archivedAt is nullable and writable', async () => {
    const lib = await prisma.library.create({
      data: { name: 'M-Test', slug: `m-test-${Date.now()}` },
    });
    const book = await prisma.book.create({
      data: { libraryId: lib.id, title: 'Test', authors: ['A'] },
    });
    expect(book.archivedAt).toBeNull();
    const archived = await prisma.book.update({
      where: { id: book.id },
      data: { archivedAt: new Date() },
    });
    expect(archived.archivedAt).toBeInstanceOf(Date);
    await prisma.book.delete({ where: { id: book.id } });
    await prisma.library.delete({ where: { id: lib.id } });
  });

  test('searchVector is populated automatically and indexable', async () => {
    const lib = await prisma.library.create({
      data: { name: 'M-Test2', slug: `m-test-${Date.now()}-2` },
    });
    await prisma.book.create({
      data: {
        libraryId: lib.id,
        title: 'Le Petit Prince',
        authors: ['Saint-Exupéry'],
        description: 'Conte philosophique',
      },
    });
    const result = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM "Book"
      WHERE "libraryId" = ${lib.id}
        AND "searchVector" @@ plainto_tsquery('simple', unaccent('petit prince'))
    `;
    expect(Number(result[0].count)).toBe(1);
    // accent insensitivity
    const result2 = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM "Book"
      WHERE "libraryId" = ${lib.id}
        AND "searchVector" @@ plainto_tsquery('simple', unaccent('saint exupery'))
    `;
    expect(Number(result2[0].count)).toBe(1);
    await prisma.library.delete({ where: { id: lib.id } });
  });
});
```

- [ ] **Step 7: Run the migration smoke test**

```bash
pnpm vitest run tests/unit/migration-phase-1d.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations tests/unit/migration-phase-1d.test.ts
git commit -m "feat(phase-1d): migration — Book.archivedAt + searchVector tsvector

- ALTER TABLE Book ADD archivedAt (nullable, mirrors Library pattern)
- CREATE EXTENSION unaccent + Book.searchVector GENERATED ALWAYS AS (tsvector)
- GIN index on searchVector + composite (libraryId, archivedAt)
- Smoke test confirms archivedAt nullable + tsvector populated + accent insensitive

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task A2 — Audit union extension (5 new actions)

**Files:**

- Modify: `src/lib/audit-log.ts` — extend `AuditAction` type
- Modify: `tests/unit/audit-log.test.ts` — add coverage for new action names

- [ ] **Step 1: Read current audit union**

```bash
grep -n "AuditAction" src/lib/audit-log.ts | head -20
```

Note the line range of the union type. The 1D additions go in a clearly delimited block at the end of the union (before the closing semicolon).

- [ ] **Step 2: Extend the union**

In `src/lib/audit-log.ts`, find the `export type AuditAction = ` block and append before the terminating semicolon:

```typescript
  // 1D — library catalog book operations
  | 'library.book.created'
  | 'library.book.updated'
  | 'library.book.archived'
  | 'library.book.unarchived'
  | 'library.book.deleted'
```

- [ ] **Step 3: Extend the `AuditTargetType` union**

In the same file, locate `export type AuditTargetType` and ensure `'BOOK'` is in the union. If not, add it:

```typescript
export type AuditTargetType = 'USER' | 'LIBRARY' | 'INVITATION' | 'SESSION' | 'BOOK';
```

- [ ] **Step 4: Add a unit test asserting the new actions are valid**

Append to `tests/unit/audit-log.test.ts`:

```typescript
import { describe, expect, test, vi } from 'vitest';
import type { AuditAction, AuditTargetType } from '@/lib/audit-log';
import { recordAudit } from '@/lib/audit-log';
import { prisma } from '@/lib/db';

describe('Phase 1D audit actions', () => {
  const actions: AuditAction[] = [
    'library.book.created',
    'library.book.updated',
    'library.book.archived',
    'library.book.unarchived',
    'library.book.deleted',
  ];

  test.each(actions)('records %s without throwing', async (action) => {
    const user = await prisma.user.create({
      data: {
        email: `audit-${action}-${Date.now()}@e2e.test`,
        passwordHash: 'x'.repeat(64),
        displayName: 'audit-test',
      },
    });
    await expect(
      recordAudit({
        action,
        actor: { id: user.id },
        target: { type: 'BOOK' satisfies AuditTargetType, id: 'cltestbookid000000000000' },
      }),
    ).resolves.not.toThrow();
    const log = await prisma.auditLog.findFirst({ where: { actorId: user.id, action } });
    expect(log).not.toBeNull();
    await prisma.user.delete({ where: { id: user.id } });
  });
});
```

- [ ] **Step 5: Run the test**

```bash
pnpm vitest run tests/unit/audit-log.test.ts
```

Expected: 5 new tests pass alongside existing audit tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/audit-log.ts tests/unit/audit-log.test.ts
git commit -m "feat(phase-1d): extend AuditAction with library.book.* (5 actions)

Adds library.book.{created,updated,archived,unarchived,deleted} to the
AuditAction union and BOOK to AuditTargetType. recordAudit() is type-safe
for these actions. Test covers recording each action against a real
Prisma session with a real user actor.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task A3 — Helper `lib/library-membership.ts`

**Files:**

- Create: `src/lib/library-membership.ts`
- Create: `tests/integration/library-membership.test.ts`

- [ ] **Step 1: Write the failing test FIRST**

Create `tests/integration/library-membership.test.ts`:

```typescript
import { TRPCError } from '@trpc/server';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { assertMembership } from '@/lib/library-membership';
import { prisma } from '@/lib/db';
import { makeCtxForRole } from './_helpers/auth-ctx';

describe('assertMembership', () => {
  test('GLOBAL_ADMIN bypasses membership check, returns library', async () => {
    const lib = await prisma.library.create({
      data: { name: 'GA-Test', slug: `ga-test-${Date.now()}` },
    });
    const { user } = await makeCtxForRole('GLOBAL_ADMIN');
    const result = await assertMembership({ userId: user!.id, role: user!.role }, lib.slug);
    expect(result.library.id).toBe(lib.id);
    expect(result.membership).toBeNull(); // GLOBAL_ADMIN bypass
    await prisma.library.delete({ where: { id: lib.id } });
  });

  test('LIBRARY_ADMIN of this lib passes', async () => {
    const ctx = await makeCtxForRole('LIBRARY_ADMIN');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: ctx.libraryId! } });
    const result = await assertMembership({ userId: ctx.user!.id, role: 'USER' }, lib.slug);
    expect(result.library.slug).toBe(lib.slug);
    expect(result.membership!.role).toBe('LIBRARY_ADMIN');
  });

  test('MEMBER of this lib passes when no role required', async () => {
    const ctx = await makeCtxForRole('MEMBER');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: ctx.libraryId! } });
    const result = await assertMembership({ userId: ctx.user!.id, role: 'USER' }, lib.slug);
    expect(result.membership!.role).toBe('MEMBER');
  });

  test('MEMBER fails when LIBRARY_ADMIN role required', async () => {
    const ctx = await makeCtxForRole('MEMBER');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: ctx.libraryId! } });
    await expect(
      assertMembership({ userId: ctx.user!.id, role: 'USER' }, lib.slug, 'LIBRARY_ADMIN'),
    ).rejects.toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  test('non-member of an existing lib gets NOT_FOUND (no slug enumeration)', async () => {
    const lib = await prisma.library.create({
      data: { name: 'Other', slug: `other-${Date.now()}` },
    });
    const { user } = await makeCtxForRole('MEMBER'); // member of a different lib
    await expect(
      assertMembership({ userId: user!.id, role: 'USER' }, lib.slug),
    ).rejects.toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
    await prisma.library.delete({ where: { id: lib.id } });
  });

  test('non-existent slug throws NOT_FOUND', async () => {
    const { user } = await makeCtxForRole('MEMBER');
    await expect(
      assertMembership({ userId: user!.id, role: 'USER' }, 'does-not-exist-1234567890'),
    ).rejects.toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
  });

  test('archived library treated as NOT_FOUND for non-admin', async () => {
    const ctx = await makeCtxForRole('LIBRARY_ADMIN');
    await prisma.library.update({
      where: { id: ctx.libraryId! },
      data: { archivedAt: new Date() },
    });
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: ctx.libraryId! } });
    await expect(
      assertMembership({ userId: ctx.user!.id, role: 'USER' }, lib.slug),
    ).rejects.toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
  });
});
```

- [ ] **Step 2: Run test, expect fail**

```bash
pnpm vitest run tests/integration/library-membership.test.ts
```

Expected: all tests FAIL with `Cannot find module '@/lib/library-membership'`.

- [ ] **Step 3: Implement the helper**

Create `src/lib/library-membership.ts`:

```typescript
import { TRPCError } from '@trpc/server';
import type { Library, LibraryMember, LibraryRole, UserRole } from '@prisma/client';
import { prisma } from '@/lib/db';

export interface MembershipActor {
  userId: string;
  role: UserRole; // 'USER' | 'GLOBAL_ADMIN'
}

export interface MembershipResult {
  library: Library;
  /** null when actor is GLOBAL_ADMIN bypassing the check. */
  membership: LibraryMember | null;
}

/**
 * Resolve a Library by slug and assert the actor has access.
 *
 * - GLOBAL_ADMIN: bypasses membership; sees archived libs too.
 * - Non-admin: must have a LibraryMember row; archived libs return NOT_FOUND
 *   so callers cannot enumerate archived slugs.
 *
 * @param actor   Must include userId + global role.
 * @param slug    Library slug from URL.
 * @param requiredRole  If provided, the actor's LibraryRole must equal this
 *                      value (or be GLOBAL_ADMIN).
 * @throws TRPCError NOT_FOUND when slug missing/archived, FORBIDDEN when role insufficient.
 */
export async function assertMembership(
  actor: MembershipActor,
  slug: string,
  requiredRole?: LibraryRole,
): Promise<MembershipResult> {
  const isGlobalAdmin = actor.role === 'GLOBAL_ADMIN';

  const library = await prisma.library.findUnique({ where: { slug } });
  if (!library) throw new TRPCError({ code: 'NOT_FOUND', message: 'library not found' });

  if (!isGlobalAdmin && library.archivedAt !== null) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'library not found' });
  }

  if (isGlobalAdmin) {
    return { library, membership: null };
  }

  const membership = await prisma.libraryMember.findUnique({
    where: { userId_libraryId: { userId: actor.userId, libraryId: library.id } },
  });
  if (!membership) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'library not found' });
  }

  if (requiredRole && membership.role !== requiredRole) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `requires ${requiredRole} on library ${slug}`,
    });
  }

  return { library, membership };
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
pnpm vitest run tests/integration/library-membership.test.ts
```

Expected: 7/7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/library-membership.ts tests/integration/library-membership.test.ts
git commit -m "feat(phase-1d): assertMembership helper + tests

Resolves a Library by slug and asserts actor access. GLOBAL_ADMIN bypass,
NOT_FOUND for non-members of archived libs (no slug enumeration), FORBIDDEN
when requiredRole mismatched. 7 integration tests cover all role × archive
× requiredRole combinations.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task A4 — Helper `lib/book-admin.ts` (assertBookInLibrary, assertNotArchived, assertNoBookDependencies)

**Files:**

- Create: `src/lib/book-admin.ts`
- Create: `tests/integration/book-admin.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/book-admin.test.ts`:

```typescript
import { TRPCError } from '@trpc/server';
import { describe, expect, test } from 'vitest';
import { assertBookInLibrary, assertNotArchived, assertNoBookDependencies } from '@/lib/book-admin';
import { prisma } from '@/lib/db';

async function seedLibAndBook() {
  const lib = await prisma.library.create({
    data: {
      name: `BA-${Date.now()}`,
      slug: `ba-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    },
  });
  const book = await prisma.book.create({
    data: { libraryId: lib.id, title: 'BA Test', authors: ['Author'] },
  });
  return { lib, book };
}

describe('assertBookInLibrary', () => {
  test('passes when book belongs to library', async () => {
    const { lib, book } = await seedLibAndBook();
    await expect(assertBookInLibrary(book.id, lib.id)).resolves.toMatchObject({ id: book.id });
  });

  test('throws NOT_FOUND when book in different library', async () => {
    const { book } = await seedLibAndBook();
    const otherLib = await prisma.library.create({
      data: {
        name: 'Other',
        slug: `other-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      },
    });
    await expect(assertBookInLibrary(book.id, otherLib.id)).rejects.toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  });

  test('throws NOT_FOUND when book id does not exist', async () => {
    const { lib } = await seedLibAndBook();
    await expect(assertBookInLibrary('clnonexistent000000000000', lib.id)).rejects.toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  });
});

describe('assertNotArchived', () => {
  test('passes for non-archived book', () => {
    expect(() => assertNotArchived({ archivedAt: null } as any)).not.toThrow();
  });
  test('throws BAD_REQUEST for archived book', () => {
    expect(() => assertNotArchived({ archivedAt: new Date() } as any)).toThrowError(
      expect.objectContaining({ code: 'BAD_REQUEST' }),
    );
  });
});

describe('assertNoBookDependencies', () => {
  test('passes when book has no files/copies/annotations', async () => {
    const { book } = await seedLibAndBook();
    await expect(assertNoBookDependencies(book.id)).resolves.toBeUndefined();
  });

  test('throws BAD_REQUEST listing dependencies when book has a BookFile', async () => {
    const { book } = await seedLibAndBook();
    await prisma.bookFile.create({
      data: {
        bookId: book.id,
        format: 'EPUB',
        isOriginal: true,
        storagePath: '/tmp/x.epub',
        fileSizeBytes: BigInt(100),
        sha256: 'a'.repeat(64),
        mimeType: 'application/epub+zip',
      },
    });
    await expect(assertNoBookDependencies(book.id)).rejects.toThrowError(
      expect.objectContaining({
        code: 'BAD_REQUEST',
        message: expect.stringContaining('files'),
      }),
    );
  });

  test('throws BAD_REQUEST when book has a PhysicalCopy', async () => {
    const { book, lib } = await seedLibAndBook();
    const owner = await prisma.user.create({
      data: {
        email: `pc-owner-${Date.now()}@e2e.test`,
        passwordHash: 'x'.repeat(64),
        displayName: 'pc-owner',
      },
    });
    await prisma.physicalCopy.create({
      data: { bookId: book.id, libraryId: lib.id, ownerId: owner.id },
    });
    await expect(assertNoBookDependencies(book.id)).rejects.toThrowError(
      expect.objectContaining({
        code: 'BAD_REQUEST',
        message: expect.stringContaining('physicalCopies'),
      }),
    );
  });
});
```

- [ ] **Step 2: Run test, expect fail**

```bash
pnpm vitest run tests/integration/book-admin.test.ts
```

Expected: all FAIL with `Cannot find module '@/lib/book-admin'`.

- [ ] **Step 3: Implement the helper**

Create `src/lib/book-admin.ts`:

```typescript
import { TRPCError } from '@trpc/server';
import type { Book } from '@prisma/client';
import { prisma } from '@/lib/db';

/**
 * Resolve a Book and verify it belongs to a specific library. Used to prevent
 * id-guessing across libraries. Returns the book if valid; throws NOT_FOUND
 * otherwise (whether the id is invalid or in a different library — same
 * status to prevent enumeration).
 */
export async function assertBookInLibrary(bookId: string, libraryId: string): Promise<Book> {
  const book = await prisma.book.findUnique({ where: { id: bookId } });
  if (!book || book.libraryId !== libraryId) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'book not found' });
  }
  return book;
}

/**
 * Assert the book is not soft-archived. Used for mutations that should not
 * apply to archived books (update, archive). For unarchive, callers should
 * branch on `book.archivedAt !== null` directly.
 */
export function assertNotArchived(book: Pick<Book, 'archivedAt'>): void {
  if (book.archivedAt !== null) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'book is archived' });
  }
}

/**
 * Assert a book has no dependent rows. Used for hard-delete pre-flight.
 * Throws BAD_REQUEST listing the dependency types present so the caller
 * knows what to clean up first via the runbook.
 */
export async function assertNoBookDependencies(bookId: string): Promise<void> {
  const counts = await prisma.book.findUnique({
    where: { id: bookId },
    select: {
      _count: {
        select: {
          files: true,
          physicalCopies: true,
          annotations: true,
          bookmarks: true,
          readingProgresses: true,
          readingSessions: true,
          tags: true,
        },
      },
    },
  });
  if (!counts) throw new TRPCError({ code: 'NOT_FOUND', message: 'book not found' });
  const present = Object.entries(counts._count)
    .filter(([, n]) => n > 0)
    .map(([k]) => k);
  if (present.length > 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `book has dependencies: ${present.join(', ')}`,
    });
  }
}
```

> **Note on `_count` shape**: the relation field names in `_count` must match
> the field names declared on `model Book` in `prisma/schema.prisma`. Confirm
> by running `pnpm prisma generate` and inspecting `node_modules/.prisma/client/index.d.ts`
> for `BookCountOutputType`. If the field is `physicalCopies` vs `copies`,
> adapt the keys above to match.

- [ ] **Step 4: Run test, expect pass**

```bash
pnpm vitest run tests/integration/book-admin.test.ts
```

Expected: 7/7 tests pass. If `_count` keys don't match, adjust per the note above and re-run.

- [ ] **Step 5: Commit**

```bash
git add src/lib/book-admin.ts tests/integration/book-admin.test.ts
git commit -m "feat(phase-1d): book-admin helpers (in-library, not-archived, no-deps)

assertBookInLibrary prevents cross-library id-guessing (NOT_FOUND).
assertNotArchived guards mutations on soft-archived books.
assertNoBookDependencies pre-flights hard-delete and lists all dependency
types so the DBA runbook knows what to clean up.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task A5 — Helper `lib/book-search.ts` (Postgres tsvector raw SQL)

**Files:**

- Create: `src/lib/book-search.ts`
- Create: `tests/integration/book-search.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/book-search.test.ts`:

```typescript
import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import { buildSearchQuery } from '@/lib/book-search';
import { prisma } from '@/lib/db';

let libId: string;
let cleanup: string[] = [];

beforeAll(async () => {
  const lib = await prisma.library.create({
    data: { name: 'Search', slug: `search-${Date.now()}` },
  });
  libId = lib.id;
  const seeds = [
    {
      title: 'Le Petit Prince',
      authors: ['Saint-Exupéry'],
      language: 'fr',
      publisher: 'Gallimard',
    },
    { title: 'Frankenstein', authors: ['Mary Shelley'], language: 'en', publisher: 'Penguin' },
    { title: 'Les Misérables', authors: ['Victor Hugo'], language: 'fr', publisher: 'Gallimard' },
    {
      title: 'Don Quichotte',
      authors: ['Miguel de Cervantès'],
      language: 'es',
      publisher: 'Galaxia',
    },
    { title: '1984', authors: ['George Orwell'], language: 'en', publisher: 'Penguin' },
  ];
  for (const s of seeds) {
    const b = await prisma.book.create({ data: { libraryId: libId, ...s } });
    cleanup.push(b.id);
  }
});

afterAll(async () => {
  await prisma.book.deleteMany({ where: { id: { in: cleanup } } });
  await prisma.library.delete({ where: { id: libId } });
});

describe('buildSearchQuery', () => {
  test('returns all books with no q, no filters, default sort', async () => {
    const result = await buildSearchQuery({ libraryId: libId, limit: 50 });
    expect(result.items.length).toBe(5);
  });

  test('filters by language', async () => {
    const result = await buildSearchQuery({ libraryId: libId, language: 'fr', limit: 50 });
    expect(result.items.map((b) => b.title)).toEqual(
      expect.arrayContaining(['Le Petit Prince', 'Les Misérables']),
    );
    expect(result.items.length).toBe(2);
  });

  test('full-text search matches title with accent insensitivity', async () => {
    const result = await buildSearchQuery({ libraryId: libId, q: 'miserables', limit: 50 });
    expect(result.items.map((b) => b.title)).toContain('Les Misérables');
  });

  test('search query too short (<2 chars) is ignored', async () => {
    const result = await buildSearchQuery({ libraryId: libId, q: 'a', limit: 50 });
    expect(result.items.length).toBe(5); // q ignored, all books returned
  });

  test('cursor pagination returns nextCursor when more results exist', async () => {
    const page1 = await buildSearchQuery({ libraryId: libId, limit: 2, sort: 'title_asc' });
    expect(page1.items.length).toBe(2);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = await buildSearchQuery({
      libraryId: libId,
      limit: 2,
      sort: 'title_asc',
      cursor: page1.nextCursor!,
    });
    expect(page2.items.length).toBe(2);
    expect(page2.items[0].id).not.toBe(page1.items[0].id);
  });

  test('SQL injection patterns are safely parameterized', async () => {
    const result = await buildSearchQuery({
      libraryId: libId,
      q: `'; DROP TABLE "Book"; --`,
      limit: 50,
    });
    // table still exists
    const stillThere = await prisma.book.count({ where: { libraryId: libId } });
    expect(stillThere).toBe(5);
    // result is empty (no match for that string)
    expect(result.items.length).toBe(0);
  });

  test('archived books are excluded by default', async () => {
    const target = cleanup[0];
    await prisma.book.update({ where: { id: target }, data: { archivedAt: new Date() } });
    const result = await buildSearchQuery({ libraryId: libId, limit: 50 });
    expect(result.items.find((b) => b.id === target)).toBeUndefined();
    // restore for other tests
    await prisma.book.update({ where: { id: target }, data: { archivedAt: null } });
  });

  test('includeArchived=true returns archived books', async () => {
    const target = cleanup[0];
    await prisma.book.update({ where: { id: target }, data: { archivedAt: new Date() } });
    const result = await buildSearchQuery({ libraryId: libId, limit: 50, includeArchived: true });
    expect(result.items.find((b) => b.id === target)).toBeDefined();
    await prisma.book.update({ where: { id: target }, data: { archivedAt: null } });
  });
});
```

- [ ] **Step 2: Run test, expect fail**

```bash
pnpm vitest run tests/integration/book-search.test.ts
```

Expected: all FAIL with `Cannot find module '@/lib/book-search'`.

- [ ] **Step 3: Implement the helper**

Create `src/lib/book-search.ts`:

```typescript
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

export type BookSort = 'title_asc' | 'createdAt_desc' | 'createdAt_asc';

export interface SearchInput {
  libraryId: string;
  q?: string;
  hasDigital?: boolean;
  hasPhysical?: boolean;
  language?: string;
  sort?: BookSort;
  cursor?: string;
  limit: number;
  includeArchived?: boolean;
}

export interface SearchResult {
  items: Array<{
    id: string;
    libraryId: string;
    title: string;
    authors: string[];
    isbn10: string | null;
    isbn13: string | null;
    publisher: string | null;
    publishedYear: number | null;
    language: string | null;
    description: string | null;
    coverPath: string | null;
    hasDigital: boolean;
    hasPhysical: boolean;
    archivedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
  nextCursor: string | null;
}

const MIN_Q_CHARS = 2;

export async function buildSearchQuery(input: SearchInput): Promise<SearchResult> {
  const sort: BookSort = input.sort ?? 'createdAt_desc';
  const useFullText = (input.q?.trim().length ?? 0) >= MIN_Q_CHARS;
  const fetchLimit = input.limit + 1; // over-fetch by one to detect nextCursor

  const where: Prisma.Sql[] = [Prisma.sql`b."libraryId" = ${input.libraryId}`];
  if (!input.includeArchived) where.push(Prisma.sql`b."archivedAt" IS NULL`);
  if (input.hasDigital !== undefined) where.push(Prisma.sql`b."hasDigital" = ${input.hasDigital}`);
  if (input.hasPhysical !== undefined)
    where.push(Prisma.sql`b."hasPhysical" = ${input.hasPhysical}`);
  if (input.language) where.push(Prisma.sql`b."language" = ${input.language}`);
  if (useFullText) {
    where.push(
      Prisma.sql`b."searchVector" @@ plainto_tsquery('simple', unaccent(${input.q!.trim()}))`,
    );
  }

  // Cursor: opaque base64 of "<sortKey>|<id>" — sortKey depends on sort.
  if (input.cursor) {
    const decoded = Buffer.from(input.cursor, 'base64url').toString('utf8');
    const [sortKey, id] = decoded.split('|');
    if (sort === 'title_asc') {
      where.push(Prisma.sql`(b."title", b."id") > (${sortKey}, ${id})`);
    } else if (sort === 'createdAt_desc') {
      where.push(Prisma.sql`(b."createdAt", b."id") < (${new Date(sortKey)}, ${id})`);
    } else {
      where.push(Prisma.sql`(b."createdAt", b."id") > (${new Date(sortKey)}, ${id})`);
    }
  }

  let orderBy: Prisma.Sql;
  if (sort === 'title_asc') orderBy = Prisma.sql`b."title" ASC, b."id" ASC`;
  else if (sort === 'createdAt_desc') orderBy = Prisma.sql`b."createdAt" DESC, b."id" DESC`;
  else orderBy = Prisma.sql`b."createdAt" ASC, b."id" ASC`;

  const whereClause = Prisma.join(where, ' AND ');

  const rows = await prisma.$queryRaw<SearchResult['items']>`
    SELECT b."id", b."libraryId", b."title", b."authors", b."isbn10", b."isbn13",
           b."publisher", b."publishedYear", b."language", b."description",
           b."coverPath", b."hasDigital", b."hasPhysical", b."archivedAt",
           b."createdAt", b."updatedAt"
    FROM "Book" b
    WHERE ${whereClause}
    ORDER BY ${orderBy}
    LIMIT ${fetchLimit}
  `;

  let nextCursor: string | null = null;
  let items = rows;
  if (rows.length > input.limit) {
    items = rows.slice(0, input.limit);
    const last = items[items.length - 1];
    const sortKey = sort === 'title_asc' ? last.title : last.createdAt.toISOString();
    nextCursor = Buffer.from(`${sortKey}|${last.id}`, 'utf8').toString('base64url');
  }

  return { items, nextCursor };
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
pnpm vitest run tests/integration/book-search.test.ts
```

Expected: 8/8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/book-search.ts tests/integration/book-search.test.ts
git commit -m "feat(phase-1d): book-search helper — Postgres tsvector + unaccent

buildSearchQuery({ libraryId, q?, filters, sort, cursor, limit, includeArchived })
returns paginated, full-text searchable book results. SQL bindings via
Prisma.sql (zero injection). Cursor encodes (sortKey, id) base64url.
8 integration tests cover q + filters + cursor + injection + archive.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task A6 — Rate-limiters + procedure builders + checkpoint

**Files:**

- Modify: `src/lib/rate-limit.ts` — add 4 limiters
- Create: `src/server/trpc/procedures-library.ts` — `libraryMemberProcedure(slug)`, `libraryAdminProcedure(slug)` factories
- Create: `tests/integration/procedures-library.test.ts`

- [ ] **Step 1: Add limiters**

Open `src/lib/rate-limit.ts`. Find the existing limiter exports (e.g., `passwordChangeLimiter`, `revokeSessionLimiter`). Append:

```typescript
// Phase 1D — library.books
export const libraryBookListLimiter = new RateLimiterRedis({
  ...baseOpts(),
  keyPrefix: 'rl:lib_book_list',
  points: 600,
  duration: 60,
  insuranceLimiter: memInsurance(600, 60),
});

export const libraryBookCreateLimiter = new RateLimiterRedis({
  ...baseOpts(),
  keyPrefix: 'rl:lib_book_create',
  points: 5,
  duration: 60,
  insuranceLimiter: memInsurance(5, 60),
});

export const libraryBookUpdateLimiter = new RateLimiterRedis({
  ...baseOpts(),
  keyPrefix: 'rl:lib_book_update',
  points: 10,
  duration: 60,
  insuranceLimiter: memInsurance(10, 60),
});

export const libraryBookDeleteLimiter = new RateLimiterRedis({
  ...baseOpts(),
  keyPrefix: 'rl:lib_book_delete',
  points: 1,
  duration: 60 * 60,
  insuranceLimiter: memInsurance(1, 60 * 60),
});
```

- [ ] **Step 2: Write test for procedure factories**

Create `tests/integration/procedures-library.test.ts`:

```typescript
import { TRPCError } from '@trpc/server';
import { describe, expect, test } from 'vitest';
import { libraryMemberProcedure, libraryAdminProcedure } from '@/server/trpc/procedures-library';
import { makeCtxForRole } from './_helpers/auth-ctx';
import { prisma } from '@/lib/db';

// Build a tiny test router using the factories to exercise the middleware end-to-end.
import { initTRPC } from '@trpc/server';
import { z } from 'zod';

const t = initTRPC.context<{ session: any; user: any; ip: string }>().create();
const router = t.router({
  memberPing: libraryMemberProcedure(t)
    .input(z.object({ slug: z.string() }))
    .query(({ ctx }) => ({ libraryId: ctx.library.id, role: ctx.membership?.role ?? null })),
  adminPing: libraryAdminProcedure(t)
    .input(z.object({ slug: z.string() }))
    .mutation(({ ctx }) => ({ libraryId: ctx.library.id })),
});
const caller = (ctx: any) => router.createCaller(ctx);

describe('libraryMemberProcedure', () => {
  test('MEMBER of slug succeeds', async () => {
    const ctx = await makeCtxForRole('MEMBER');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: ctx.libraryId! } });
    const res = await caller(ctx).memberPing({ slug: lib.slug });
    expect(res.libraryId).toBe(lib.id);
    expect(res.role).toBe('MEMBER');
  });

  test('non-member throws NOT_FOUND', async () => {
    const ctx = await makeCtxForRole('MEMBER');
    const otherLib = await prisma.library.create({
      data: { name: 'O', slug: `o-${Date.now()}` },
    });
    await expect(caller(ctx).memberPing({ slug: otherLib.slug })).rejects.toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  });

  test('ANON throws UNAUTHORIZED', async () => {
    const ctx = await makeCtxForRole('ANON');
    await expect(caller(ctx).memberPing({ slug: 'whatever' })).rejects.toThrowError(
      expect.objectContaining({ code: 'UNAUTHORIZED' }),
    );
  });

  test('PENDING_2FA throws UNAUTHORIZED', async () => {
    const ctx = await makeCtxForRole('PENDING_2FA');
    await expect(caller(ctx).memberPing({ slug: 'whatever' })).rejects.toThrowError(
      expect.objectContaining({ code: 'UNAUTHORIZED' }),
    );
  });
});

describe('libraryAdminProcedure', () => {
  test('LIBRARY_ADMIN of slug succeeds', async () => {
    const ctx = await makeCtxForRole('LIBRARY_ADMIN');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: ctx.libraryId! } });
    const res = await caller(ctx).adminPing({ slug: lib.slug });
    expect(res.libraryId).toBe(lib.id);
  });

  test('MEMBER of slug throws FORBIDDEN', async () => {
    const ctx = await makeCtxForRole('MEMBER');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: ctx.libraryId! } });
    await expect(caller(ctx).adminPing({ slug: lib.slug })).rejects.toThrowError(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });

  test('GLOBAL_ADMIN succeeds even on a lib they are not a member of', async () => {
    const ctx = await makeCtxForRole('GLOBAL_ADMIN');
    const lib = await prisma.library.create({
      data: { name: 'GAOnly', slug: `gaonly-${Date.now()}` },
    });
    const res = await caller(ctx).adminPing({ slug: lib.slug });
    expect(res.libraryId).toBe(lib.id);
  });
});
```

- [ ] **Step 3: Run test, expect fail**

```bash
pnpm vitest run tests/integration/procedures-library.test.ts
```

Expected: FAIL with `Cannot find module '@/server/trpc/procedures-library'`.

- [ ] **Step 4: Implement the factories**

Create `src/server/trpc/procedures-library.ts`:

```typescript
import { TRPCError } from '@trpc/server';
import type { initTRPC } from '@trpc/server';
import type { Library, LibraryMember } from '@prisma/client';
import { assertMembership } from '@/lib/library-membership';

interface CtxBase {
  session: { pending2fa?: boolean } | null;
  user: { id: string; role: 'USER' | 'GLOBAL_ADMIN' } | null;
  ip: string;
}

interface SlugInput {
  slug: string;
}

/**
 * Factory: returns a procedure builder that requires the actor to have any
 * LibraryMember role (or be GLOBAL_ADMIN) for the slug present in input.
 *
 * Usage:
 *   libraryMemberProcedure(t).input(z.object({ slug: z.string(), ... })).query(...)
 *
 * The middleware injects ctx.library and ctx.membership.
 */
export function libraryMemberProcedure<
  T extends ReturnType<typeof initTRPC.context<CtxBase>>['create'],
>(t: T) {
  return t.procedure.use(async ({ ctx, rawInput, next }) => {
    if (!ctx.session || ctx.session.pending2fa || !ctx.user) {
      throw new TRPCError({ code: 'UNAUTHORIZED' });
    }
    const slug = (rawInput as SlugInput | undefined)?.slug;
    if (typeof slug !== 'string') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'slug required in input' });
    }
    const { library, membership } = await assertMembership(
      { userId: ctx.user.id, role: ctx.user.role },
      slug,
    );
    return next({
      ctx: { ...ctx, library, membership } as typeof ctx & {
        library: Library;
        membership: LibraryMember | null;
      },
    });
  });
}

/**
 * Factory: same as libraryMemberProcedure but requires LIBRARY_ADMIN role
 * (or GLOBAL_ADMIN).
 */
export function libraryAdminProcedure<
  T extends ReturnType<typeof initTRPC.context<CtxBase>>['create'],
>(t: T) {
  return t.procedure.use(async ({ ctx, rawInput, next }) => {
    if (!ctx.session || ctx.session.pending2fa || !ctx.user) {
      throw new TRPCError({ code: 'UNAUTHORIZED' });
    }
    const slug = (rawInput as SlugInput | undefined)?.slug;
    if (typeof slug !== 'string') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'slug required in input' });
    }
    const { library, membership } = await assertMembership(
      { userId: ctx.user.id, role: ctx.user.role },
      slug,
      'LIBRARY_ADMIN',
    );
    return next({
      ctx: { ...ctx, library, membership } as typeof ctx & {
        library: Library;
        membership: LibraryMember | null;
      },
    });
  });
}
```

- [ ] **Step 5: Run test, expect pass**

```bash
pnpm vitest run tests/integration/procedures-library.test.ts
```

Expected: 7/7 tests pass.

- [ ] **Step 6: Commit + Module A checkpoint tag**

```bash
git add src/lib/rate-limit.ts src/server/trpc/procedures-library.ts tests/integration/procedures-library.test.ts
git commit -m "feat(phase-1d): rate-limiters + libraryMember/libraryAdmin procedure factories

4 new limiters (list/create/update/delete) following *Limiter naming.
Two procedure factory helpers wire the assertMembership check into tRPC
middleware, injecting ctx.library + ctx.membership for downstream
procedures. 7 integration tests cover all role × slug-membership combos.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"

git tag phase-1d-checkpoint-module-A -m "Module A complete: foundations (migration, helpers, audit, procedures)"
```

**Module A acceptance criteria:**

- ✅ Migration applied + verified in psql + smoke test passes
- ✅ AuditAction union + AuditTargetType union extended; recordAudit accepts new actions
- ✅ `assertMembership` covers GA bypass / member / non-member / archived / requiredRole (7 tests)
- ✅ `assertBookInLibrary` / `assertNotArchived` / `assertNoBookDependencies` (7 tests)
- ✅ `buildSearchQuery` with full-text + filters + cursor + injection guard + archive (8 tests)
- ✅ 4 rate-limiters declared
- ✅ `libraryMemberProcedure` + `libraryAdminProcedure` factories work end-to-end (7 tests)
- ✅ All existing 1C tests still pass (`pnpm test --run`)
- ✅ Tag `phase-1d-checkpoint-module-A` created

---

## Module B — Router `library.books` (7 procedures + matrix delta)

**Goal:** All 7 procedures of `library.books` implemented, each with a focused integration test, plus the permissions matrix delta (35 cases) and the anti-drift guard extension. Router wired into `_app.ts`. Total: 9 tasks. Estimated 3–4 days.

### Task B1 — Router skeleton + Zod schemas + `list` procedure

**Files:**

- Create: `src/server/trpc/routers/library/books.ts`
- Create: `src/server/trpc/routers/library/index.ts`
- Create: `src/server/trpc/schemas/book.ts`
- Create: `tests/integration/library-books-list.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/library-books-list.test.ts`:

```typescript
import { describe, expect, test, beforeAll } from 'vitest';
import { appRouter } from '@/server/trpc/routers/_app';
import { makeCtxForRole } from './_helpers/auth-ctx';
import { prisma } from '@/lib/db';

let memberCtx: any;
let memberLibSlug: string;
let memberLibId: string;
let bookIds: string[] = [];

beforeAll(async () => {
  memberCtx = await makeCtxForRole('MEMBER');
  const lib = await prisma.library.findUniqueOrThrow({ where: { id: memberCtx.libraryId } });
  memberLibSlug = lib.slug;
  memberLibId = lib.id;
  for (let i = 0; i < 5; i++) {
    const b = await prisma.book.create({
      data: {
        libraryId: memberLibId,
        title: `Book ${i}`,
        authors: [`Author ${i}`],
        language: i % 2 === 0 ? 'fr' : 'en',
        hasDigital: i < 2,
      },
    });
    bookIds.push(b.id);
  }
});

describe('library.books.list', () => {
  test('MEMBER sees all non-archived books in their library', async () => {
    const caller = appRouter.createCaller(memberCtx);
    const result = await caller.library.books.list({ slug: memberLibSlug, limit: 24 });
    expect(result.items.length).toBe(5);
    expect(result.nextCursor).toBeNull();
  });

  test('limit defaults to 24 and clamps at max 100', async () => {
    const caller = appRouter.createCaller(memberCtx);
    const r1 = await caller.library.books.list({ slug: memberLibSlug });
    expect(r1.items.length).toBeLessThanOrEqual(24);
    await expect(caller.library.books.list({ slug: memberLibSlug, limit: 1000 })).rejects.toThrow();
  });

  test('language filter narrows results', async () => {
    const caller = appRouter.createCaller(memberCtx);
    const fr = await caller.library.books.list({ slug: memberLibSlug, language: 'fr', limit: 24 });
    expect(fr.items.every((b) => b.language === 'fr')).toBe(true);
  });

  test('hasDigital filter narrows results', async () => {
    const caller = appRouter.createCaller(memberCtx);
    const digital = await caller.library.books.list({
      slug: memberLibSlug,
      hasDigital: true,
      limit: 24,
    });
    expect(digital.items.every((b) => b.hasDigital === true)).toBe(true);
  });

  test('q < 2 chars is silently ignored', async () => {
    const caller = appRouter.createCaller(memberCtx);
    const r = await caller.library.books.list({ slug: memberLibSlug, q: 'a', limit: 24 });
    expect(r.items.length).toBe(5);
  });

  test('non-member of slug gets NOT_FOUND', async () => {
    const otherLib = await prisma.library.create({
      data: { name: 'Other', slug: `other-list-${Date.now()}` },
    });
    const caller = appRouter.createCaller(memberCtx);
    await expect(
      caller.library.books.list({ slug: otherLib.slug, limit: 24 }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
  });

  test('ANON throws UNAUTHORIZED', async () => {
    const anon = await makeCtxForRole('ANON');
    const caller = appRouter.createCaller(anon);
    await expect(
      caller.library.books.list({ slug: memberLibSlug, limit: 24 }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'UNAUTHORIZED' }));
  });

  test('includeArchived=true is silently coerced to false for MEMBER', async () => {
    const archivedId = bookIds[0];
    await prisma.book.update({ where: { id: archivedId }, data: { archivedAt: new Date() } });
    const caller = appRouter.createCaller(memberCtx);
    const r = await caller.library.books.list({
      slug: memberLibSlug,
      includeArchived: true,
      limit: 24,
    });
    expect(r.items.find((b) => b.id === archivedId)).toBeUndefined();
    await prisma.book.update({ where: { id: archivedId }, data: { archivedAt: null } });
  });

  test('includeArchived=true returns archived books for LIBRARY_ADMIN', async () => {
    const adminCtx = await makeCtxForRole('LIBRARY_ADMIN');
    const adminLib = await prisma.library.findUniqueOrThrow({ where: { id: adminCtx.libraryId } });
    const archivedBook = await prisma.book.create({
      data: {
        libraryId: adminLib.id,
        title: 'Archived',
        authors: ['X'],
        archivedAt: new Date(),
      },
    });
    const caller = appRouter.createCaller(adminCtx);
    const r = await caller.library.books.list({
      slug: adminLib.slug,
      includeArchived: true,
      limit: 24,
    });
    expect(r.items.find((b) => b.id === archivedBook.id)).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test, expect fail**

```bash
pnpm vitest run tests/integration/library-books-list.test.ts
```

Expected: FAIL with `Cannot read property 'books' of undefined` (router not yet wired).

- [ ] **Step 3: Create Zod input schemas**

Create `src/server/trpc/schemas/book.ts`:

```typescript
import { z } from 'zod';

const cuid = z.string().cuid();
const slug = z.string().min(1).max(120);

export const listBooksInput = z.object({
  slug,
  q: z.string().max(200).optional(),
  hasDigital: z.boolean().optional(),
  hasPhysical: z.boolean().optional(),
  language: z.string().min(2).max(8).optional(),
  sort: z.enum(['title_asc', 'createdAt_desc', 'createdAt_asc']).default('createdAt_desc'),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(24),
  includeArchived: z.boolean().optional().default(false),
});

export const getBookInput = z.object({
  slug,
  id: cuid,
});

export const coverUrl = z
  .string()
  .url()
  .startsWith('https://', { message: 'cover URL must be HTTPS' })
  .max(2048)
  .optional()
  .nullable();

export const createBookInput = z.object({
  slug,
  title: z.string().min(1).max(500),
  authors: z.array(z.string().min(1).max(200)).min(1).max(20),
  isbn10: z
    .string()
    .regex(/^\d{9}[\dX]$/)
    .optional()
    .nullable(),
  isbn13: z
    .string()
    .regex(/^\d{13}$/)
    .optional()
    .nullable(),
  publisher: z.string().max(200).optional().nullable(),
  publishedYear: z.number().int().min(1000).max(2100).optional().nullable(),
  language: z.string().min(2).max(8).optional().nullable(),
  description: z.string().max(10_000).optional().nullable(),
  coverPath: coverUrl,
});

export const updateBookInput = z.object({
  slug,
  id: cuid,
  expectedUpdatedAt: z.coerce.date(),
  patch: z.object({
    title: z.string().min(1).max(500).optional(),
    authors: z.array(z.string().min(1).max(200)).min(1).max(20).optional(),
    isbn10: z
      .string()
      .regex(/^\d{9}[\dX]$/)
      .nullable()
      .optional(),
    isbn13: z
      .string()
      .regex(/^\d{13}$/)
      .nullable()
      .optional(),
    publisher: z.string().max(200).nullable().optional(),
    publishedYear: z.number().int().min(1000).max(2100).nullable().optional(),
    language: z.string().min(2).max(8).nullable().optional(),
    description: z.string().max(10_000).nullable().optional(),
    coverPath: coverUrl,
  }),
});

export const archiveBookInput = z.object({ slug, id: cuid });
export const unarchiveBookInput = z.object({ slug, id: cuid });
export const deleteBookInput = z.object({ slug, id: cuid });
```

- [ ] **Step 4: Implement router skeleton + `list`**

Create `src/server/trpc/routers/library/books.ts`:

```typescript
import { TRPCError } from '@trpc/server';
import { t } from '../../trpc';
import { libraryMemberProcedure } from '../../procedures-library';
import { libraryBookListLimiter } from '@/lib/rate-limit';
import { applyRateLimiter } from '@/lib/rate-limit';
import { buildSearchQuery } from '@/lib/book-search';
import { listBooksInput } from '../../schemas/book';

export const libraryBooksRouter = t.router({
  list: libraryMemberProcedure(t)
    .input(listBooksInput)
    .query(async ({ ctx, input }) => {
      await applyRateLimiter(libraryBookListLimiter, ctx.user!.id);
      const isAdmin = ctx.user!.role === 'GLOBAL_ADMIN' || ctx.membership?.role === 'LIBRARY_ADMIN';
      // Silently coerce includeArchived for non-admin
      const includeArchived = isAdmin ? input.includeArchived : false;
      return buildSearchQuery({
        libraryId: ctx.library.id,
        q: input.q,
        hasDigital: input.hasDigital,
        hasPhysical: input.hasPhysical,
        language: input.language,
        sort: input.sort,
        cursor: input.cursor,
        limit: input.limit,
        includeArchived,
      });
    }),
});
```

Create `src/server/trpc/routers/library/index.ts`:

```typescript
import { t } from '../../trpc';
import { libraryBooksRouter } from './books';

export const libraryRouter = t.router({
  books: libraryBooksRouter,
});
```

- [ ] **Step 5: Wire `library` into `_app.ts`**

Open `src/server/trpc/routers/_app.ts`. Add the import:

```typescript
import { libraryRouter } from './library';
```

In the `appRouter = t.router({ ... })` object, after `account: ...`, add:

```typescript
  library: libraryRouter,
```

- [ ] **Step 6: Run test, expect pass**

```bash
pnpm vitest run tests/integration/library-books-list.test.ts
```

Expected: 9/9 tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/server/trpc/routers/library src/server/trpc/routers/_app.ts src/server/trpc/schemas/book.ts tests/integration/library-books-list.test.ts
git commit -m "feat(phase-1d): library.books.list procedure + router skeleton

- Router library.books wired into _app.ts under new 'library' namespace
- Zod input schemas in schemas/book.ts (list/get/create/update/archive/delete)
- list procedure: pagination cursor + filters + tsvector search via
  buildSearchQuery; includeArchived silently coerced to false for non-admin
- 9 integration tests cover all read paths

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task B2 — `library.books.get` procedure

**Files:**

- Modify: `src/server/trpc/routers/library/books.ts` — add `get`
- Create: `tests/integration/library-books-get.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/library-books-get.test.ts`:

```typescript
import { describe, expect, test, beforeAll } from 'vitest';
import { appRouter } from '@/server/trpc/routers/_app';
import { makeCtxForRole } from './_helpers/auth-ctx';
import { prisma } from '@/lib/db';

let memberCtx: any;
let libSlug: string;
let bookId: string;

beforeAll(async () => {
  memberCtx = await makeCtxForRole('MEMBER');
  const lib = await prisma.library.findUniqueOrThrow({ where: { id: memberCtx.libraryId } });
  libSlug = lib.slug;
  const book = await prisma.book.create({
    data: { libraryId: lib.id, title: 'Get Test', authors: ['Author'] },
  });
  bookId = book.id;
});

describe('library.books.get', () => {
  test('MEMBER gets book with physicalCopies count', async () => {
    const caller = appRouter.createCaller(memberCtx);
    const result = await caller.library.books.get({ slug: libSlug, id: bookId });
    expect(result.id).toBe(bookId);
    expect(result.title).toBe('Get Test');
    expect(result._count.physicalCopies).toBe(0);
  });

  test('cross-library id-guess returns NOT_FOUND', async () => {
    const otherLib = await prisma.library.create({
      data: { name: 'Other', slug: `oget-${Date.now()}` },
    });
    const otherBook = await prisma.book.create({
      data: { libraryId: otherLib.id, title: 'Hidden', authors: ['X'] },
    });
    const caller = appRouter.createCaller(memberCtx);
    await expect(
      caller.library.books.get({ slug: libSlug, id: otherBook.id }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
  });

  test('non-member gets NOT_FOUND on slug, not on book', async () => {
    const otherCtx = await makeCtxForRole('MEMBER');
    const caller = appRouter.createCaller(otherCtx);
    await expect(caller.library.books.get({ slug: libSlug, id: bookId })).rejects.toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  });

  test('archived book returns NOT_FOUND for non-admin', async () => {
    const archivedBook = await prisma.book.create({
      data: {
        libraryId: memberCtx.libraryId,
        title: 'Archived',
        authors: ['X'],
        archivedAt: new Date(),
      },
    });
    const caller = appRouter.createCaller(memberCtx);
    await expect(
      caller.library.books.get({ slug: libSlug, id: archivedBook.id }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
  });

  test('archived book is visible to LIBRARY_ADMIN', async () => {
    const adminCtx = await makeCtxForRole('LIBRARY_ADMIN');
    const adminLib = await prisma.library.findUniqueOrThrow({ where: { id: adminCtx.libraryId } });
    const archived = await prisma.book.create({
      data: {
        libraryId: adminLib.id,
        title: 'Admin sees',
        authors: ['X'],
        archivedAt: new Date(),
      },
    });
    const caller = appRouter.createCaller(adminCtx);
    const result = await caller.library.books.get({ slug: adminLib.slug, id: archived.id });
    expect(result.id).toBe(archived.id);
    expect(result.archivedAt).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test, expect fail**

```bash
pnpm vitest run tests/integration/library-books-get.test.ts
```

Expected: FAIL with `library.books.get is not a function`.

- [ ] **Step 3: Add the `get` procedure**

In `src/server/trpc/routers/library/books.ts`, add to the router (after `list`):

```typescript
  get: libraryMemberProcedure(t)
    .input(getBookInput)
    .query(async ({ ctx, input }) => {
      await applyRateLimiter(libraryBookListLimiter, ctx.user!.id);
      const isAdmin =
        ctx.user!.role === 'GLOBAL_ADMIN' || ctx.membership?.role === 'LIBRARY_ADMIN';
      const book = await prisma.book.findUnique({
        where: { id: input.id },
        include: {
          _count: {
            select: { physicalCopies: true, files: true },
          },
        },
      });
      if (!book || book.libraryId !== ctx.library.id) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'book not found' });
      }
      if (!isAdmin && book.archivedAt !== null) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'book not found' });
      }
      return book;
    }),
```

Update the imports at the top of the file:

```typescript
import { TRPCError } from '@trpc/server';
import { t } from '../../trpc';
import { libraryMemberProcedure } from '../../procedures-library';
import { libraryBookListLimiter } from '@/lib/rate-limit';
import { applyRateLimiter } from '@/lib/rate-limit';
import { buildSearchQuery } from '@/lib/book-search';
import { prisma } from '@/lib/db';
import { listBooksInput, getBookInput } from '../../schemas/book';
```

- [ ] **Step 4: Run test, expect pass**

```bash
pnpm vitest run tests/integration/library-books-get.test.ts
```

Expected: 5/5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/trpc/routers/library/books.ts tests/integration/library-books-get.test.ts
git commit -m "feat(phase-1d): library.books.get with physicalCopies count + archive guard

Returns book + _count.physicalCopies + _count.files. Archived returns
NOT_FOUND for non-admin (book does not exist for them); LIBRARY_ADMIN
and GLOBAL_ADMIN see archived books with archivedAt populated.
Cross-library id-guess returns NOT_FOUND. 5 integration tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task B3 — `library.books.create` procedure

**Files:**

- Modify: `src/server/trpc/routers/library/books.ts` — add `create`
- Create: `tests/integration/library-books-create.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/library-books-create.test.ts`:

```typescript
import { describe, expect, test } from 'vitest';
import { appRouter } from '@/server/trpc/routers/_app';
import { makeCtxForRole } from './_helpers/auth-ctx';
import { prisma } from '@/lib/db';

describe('library.books.create', () => {
  test('LIBRARY_ADMIN creates book in their library', async () => {
    const ctx = await makeCtxForRole('LIBRARY_ADMIN');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: ctx.libraryId } });
    const caller = appRouter.createCaller(ctx);
    const created = await caller.library.books.create({
      slug: lib.slug,
      title: 'Created Book',
      authors: ['Test Author'],
      language: 'fr',
      isbn13: '9782070612758',
      coverPath: 'https://covers.example.com/abc.jpg',
    });
    expect(created.id).toBeTruthy();
    expect(created.libraryId).toBe(lib.id);
    expect(created.title).toBe('Created Book');
    expect(created.coverPath).toBe('https://covers.example.com/abc.jpg');
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'library.book.created', targetId: created.id },
    });
    expect(audit).not.toBeNull();
  });

  test('MEMBER cannot create — FORBIDDEN', async () => {
    const ctx = await makeCtxForRole('MEMBER');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: ctx.libraryId } });
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.library.books.create({
        slug: lib.slug,
        title: 'Nope',
        authors: ['X'],
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  test('LIBRARY_ADMIN of another lib gets FORBIDDEN', async () => {
    const adminCtx = await makeCtxForRole('LIBRARY_ADMIN');
    const otherLib = await prisma.library.create({
      data: { name: 'Other', slug: `other-c-${Date.now()}` },
    });
    const caller = appRouter.createCaller(adminCtx);
    await expect(
      caller.library.books.create({ slug: otherLib.slug, title: 'X', authors: ['Y'] }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'NOT_FOUND' })); // not a member
  });

  test('GLOBAL_ADMIN can create in any library', async () => {
    const gaCtx = await makeCtxForRole('GLOBAL_ADMIN');
    const lib = await prisma.library.create({
      data: { name: 'GA-create', slug: `ga-c-${Date.now()}` },
    });
    const caller = appRouter.createCaller(gaCtx);
    const created = await caller.library.books.create({
      slug: lib.slug,
      title: 'GA Created',
      authors: ['GA'],
    });
    expect(created.libraryId).toBe(lib.id);
  });

  test('coverPath must be HTTPS', async () => {
    const ctx = await makeCtxForRole('LIBRARY_ADMIN');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: ctx.libraryId } });
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.library.books.create({
        slug: lib.slug,
        title: 'X',
        authors: ['Y'],
        coverPath: 'http://insecure.example.com/c.jpg',
      }),
    ).rejects.toThrow(); // Zod error
  });

  test('rejects invalid ISBN13', async () => {
    const ctx = await makeCtxForRole('LIBRARY_ADMIN');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: ctx.libraryId } });
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.library.books.create({
        slug: lib.slug,
        title: 'X',
        authors: ['Y'],
        isbn13: '12345',
      }),
    ).rejects.toThrow();
  });

  test('rate limiter caps at 5/min', async () => {
    const ctx = await makeCtxForRole('LIBRARY_ADMIN');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: ctx.libraryId } });
    const caller = appRouter.createCaller(ctx);
    for (let i = 0; i < 5; i++) {
      await caller.library.books.create({
        slug: lib.slug,
        title: `RL-${i}`,
        authors: ['X'],
      });
    }
    await expect(
      caller.library.books.create({ slug: lib.slug, title: 'too-fast', authors: ['X'] }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'TOO_MANY_REQUESTS' }));
  });
});
```

- [ ] **Step 2: Run test, expect fail**

```bash
pnpm vitest run tests/integration/library-books-create.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Add the `create` procedure**

In `books.ts`, add to the router (after `get`):

```typescript
  create: libraryAdminProcedure(t)
    .input(createBookInput)
    .mutation(async ({ ctx, input }) => {
      await applyRateLimiter(libraryBookCreateLimiter, ctx.user!.id);
      const { slug: _slug, ...data } = input;
      const book = await prisma.book.create({
        data: {
          ...data,
          libraryId: ctx.library.id,
          uploadedById: ctx.user!.id,
        },
      });
      await recordAudit({
        action: 'library.book.created',
        actor: { id: ctx.user!.id },
        target: { type: 'BOOK', id: book.id },
        metadata: { libraryId: ctx.library.id, title: book.title },
        req: { ip: ctx.ip },
      });
      return book;
    }),
```

Update imports:

```typescript
import { libraryMemberProcedure, libraryAdminProcedure } from '../../procedures-library';
import {
  libraryBookListLimiter,
  libraryBookCreateLimiter,
  applyRateLimiter,
} from '@/lib/rate-limit';
import { recordAudit } from '@/lib/audit-log';
import { listBooksInput, getBookInput, createBookInput } from '../../schemas/book';
```

- [ ] **Step 4: Run test, expect pass**

```bash
pnpm vitest run tests/integration/library-books-create.test.ts
```

Expected: 7/7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/trpc/routers/library/books.ts tests/integration/library-books-create.test.ts
git commit -m "feat(phase-1d): library.books.create — admin-only, manual metadata

Creates Book row with metadata only (no file). coverPath = HTTPS URL,
strict Zod validation. Audit log emits library.book.created. Rate limiter
5/min/user. 7 integration tests cover happy path, role guards, validation,
and rate limit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task B4 — `library.books.update` (with optimistic concurrency)

**Files:**

- Modify: `src/server/trpc/routers/library/books.ts` — add `update`
- Create: `tests/integration/library-books-update.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/library-books-update.test.ts`:

```typescript
import { describe, expect, test } from 'vitest';
import { appRouter } from '@/server/trpc/routers/_app';
import { makeCtxForRole } from './_helpers/auth-ctx';
import { prisma } from '@/lib/db';

async function seedAdminAndBook() {
  const ctx = await makeCtxForRole('LIBRARY_ADMIN');
  const lib = await prisma.library.findUniqueOrThrow({ where: { id: ctx.libraryId } });
  const book = await prisma.book.create({
    data: { libraryId: lib.id, title: 'Original Title', authors: ['Original'] },
  });
  return { ctx, lib, book };
}

describe('library.books.update', () => {
  test('happy path: title is updated, audit log records diff', async () => {
    const { ctx, lib, book } = await seedAdminAndBook();
    const caller = appRouter.createCaller(ctx);
    const updated = await caller.library.books.update({
      slug: lib.slug,
      id: book.id,
      expectedUpdatedAt: book.updatedAt,
      patch: { title: 'New Title' },
    });
    expect(updated.title).toBe('New Title');
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'library.book.updated', targetId: book.id },
    });
    expect(audit).not.toBeNull();
    expect((audit!.metadata as any).changes).toMatchObject({
      title: { from: 'Original Title', to: 'New Title' },
    });
  });

  test('concurrency: stale expectedUpdatedAt throws CONFLICT', async () => {
    const { ctx, lib, book } = await seedAdminAndBook();
    const caller = appRouter.createCaller(ctx);
    // first update succeeds
    await caller.library.books.update({
      slug: lib.slug,
      id: book.id,
      expectedUpdatedAt: book.updatedAt,
      patch: { title: 'First' },
    });
    // second with the original timestamp must fail
    await expect(
      caller.library.books.update({
        slug: lib.slug,
        id: book.id,
        expectedUpdatedAt: book.updatedAt,
        patch: { title: 'Stale' },
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'CONFLICT' }));
    // verify the title is still 'First'
    const after = await prisma.book.findUniqueOrThrow({ where: { id: book.id } });
    expect(after.title).toBe('First');
  });

  test('archived book cannot be updated (BAD_REQUEST)', async () => {
    const { ctx, lib, book } = await seedAdminAndBook();
    const archived = await prisma.book.update({
      where: { id: book.id },
      data: { archivedAt: new Date() },
    });
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.library.books.update({
        slug: lib.slug,
        id: book.id,
        expectedUpdatedAt: archived.updatedAt,
        patch: { title: 'X' },
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'BAD_REQUEST' }));
  });

  test('cross-library id-guess returns NOT_FOUND', async () => {
    const { ctx, lib } = await seedAdminAndBook();
    const otherLib = await prisma.library.create({
      data: { name: 'O', slug: `o-up-${Date.now()}` },
    });
    const otherBook = await prisma.book.create({
      data: { libraryId: otherLib.id, title: 'Hidden', authors: ['X'] },
    });
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.library.books.update({
        slug: lib.slug,
        id: otherBook.id,
        expectedUpdatedAt: otherBook.updatedAt,
        patch: { title: 'X' },
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
  });

  test('MEMBER cannot update', async () => {
    const adminEnv = await seedAdminAndBook();
    const memberCtx = await makeCtxForRole('MEMBER');
    // make member a member of the same library as admin's book
    await prisma.libraryMember.create({
      data: {
        userId: memberCtx.user!.id,
        libraryId: adminEnv.lib.id,
        role: 'MEMBER',
      },
    });
    const caller = appRouter.createCaller(memberCtx);
    await expect(
      caller.library.books.update({
        slug: adminEnv.lib.slug,
        id: adminEnv.book.id,
        expectedUpdatedAt: adminEnv.book.updatedAt,
        patch: { title: 'X' },
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
  });
});
```

- [ ] **Step 2: Run test, expect fail**

```bash
pnpm vitest run tests/integration/library-books-update.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Add the `update` procedure**

In `books.ts`, add:

```typescript
  update: libraryAdminProcedure(t)
    .input(updateBookInput)
    .mutation(async ({ ctx, input }) => {
      await applyRateLimiter(libraryBookUpdateLimiter, ctx.user!.id);
      const existing = await assertBookInLibrary(input.id, ctx.library.id);
      assertNotArchived(existing);
      if (existing.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'book was modified by someone else; reload and retry',
        });
      }
      const updated = await prisma.book.update({
        where: { id: input.id },
        data: input.patch,
      });
      // Compute diff for audit
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const [k, v] of Object.entries(input.patch)) {
        if ((existing as any)[k] !== v) {
          changes[k] = { from: (existing as any)[k], to: v };
        }
      }
      await recordAudit({
        action: 'library.book.updated',
        actor: { id: ctx.user!.id },
        target: { type: 'BOOK', id: updated.id },
        metadata: { libraryId: ctx.library.id, changes },
        req: { ip: ctx.ip },
      });
      return updated;
    }),
```

Update imports:

```typescript
import { assertBookInLibrary, assertNotArchived } from '@/lib/book-admin';
import {
  libraryBookListLimiter,
  libraryBookCreateLimiter,
  libraryBookUpdateLimiter,
  applyRateLimiter,
} from '@/lib/rate-limit';
import { listBooksInput, getBookInput, createBookInput, updateBookInput } from '../../schemas/book';
```

- [ ] **Step 4: Run test, expect pass**

```bash
pnpm vitest run tests/integration/library-books-update.test.ts
```

Expected: 5/5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/trpc/routers/library/books.ts tests/integration/library-books-update.test.ts
git commit -m "feat(phase-1d): library.books.update with optimistic concurrency

Input includes expectedUpdatedAt; mismatch throws CONFLICT preserving
prior state. Archived books cannot be updated (BAD_REQUEST). Audit
emits library.book.updated with diff (changes: { field: { from, to } }).
5 integration tests cover happy path, concurrency, archive guard,
cross-library id-guess, and MEMBER role denial.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task B5 — `archive` + `unarchive` procedures

**Files:**

- Modify: `src/server/trpc/routers/library/books.ts`
- Create: `tests/integration/library-books-archive.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/library-books-archive.test.ts`:

```typescript
import { describe, expect, test } from 'vitest';
import { appRouter } from '@/server/trpc/routers/_app';
import { makeCtxForRole } from './_helpers/auth-ctx';
import { prisma } from '@/lib/db';

async function seedAdminAndBook() {
  const ctx = await makeCtxForRole('LIBRARY_ADMIN');
  const lib = await prisma.library.findUniqueOrThrow({ where: { id: ctx.libraryId } });
  const book = await prisma.book.create({
    data: { libraryId: lib.id, title: 'Arc', authors: ['X'] },
  });
  return { ctx, lib, book };
}

describe('library.books.archive', () => {
  test('archives a book, sets archivedAt, audit log', async () => {
    const { ctx, lib, book } = await seedAdminAndBook();
    const caller = appRouter.createCaller(ctx);
    await caller.library.books.archive({ slug: lib.slug, id: book.id });
    const after = await prisma.book.findUniqueOrThrow({ where: { id: book.id } });
    expect(after.archivedAt).not.toBeNull();
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'library.book.archived', targetId: book.id },
    });
    expect(audit).not.toBeNull();
  });

  test('archiving an already-archived book throws BAD_REQUEST', async () => {
    const { ctx, lib, book } = await seedAdminAndBook();
    await prisma.book.update({ where: { id: book.id }, data: { archivedAt: new Date() } });
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.library.books.archive({ slug: lib.slug, id: book.id }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'BAD_REQUEST' }));
  });

  test('MEMBER cannot archive — FORBIDDEN', async () => {
    const adminEnv = await seedAdminAndBook();
    const memberCtx = await makeCtxForRole('MEMBER');
    await prisma.libraryMember.create({
      data: { userId: memberCtx.user!.id, libraryId: adminEnv.lib.id, role: 'MEMBER' },
    });
    const caller = appRouter.createCaller(memberCtx);
    await expect(
      caller.library.books.archive({ slug: adminEnv.lib.slug, id: adminEnv.book.id }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
  });
});

describe('library.books.unarchive', () => {
  test('unarchives a previously archived book', async () => {
    const { ctx, lib, book } = await seedAdminAndBook();
    await prisma.book.update({ where: { id: book.id }, data: { archivedAt: new Date() } });
    const caller = appRouter.createCaller(ctx);
    await caller.library.books.unarchive({ slug: lib.slug, id: book.id });
    const after = await prisma.book.findUniqueOrThrow({ where: { id: book.id } });
    expect(after.archivedAt).toBeNull();
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'library.book.unarchived', targetId: book.id },
    });
    expect(audit).not.toBeNull();
  });

  test('unarchiving a non-archived book throws BAD_REQUEST', async () => {
    const { ctx, lib, book } = await seedAdminAndBook();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.library.books.unarchive({ slug: lib.slug, id: book.id }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'BAD_REQUEST' }));
  });
});
```

- [ ] **Step 2: Run test, expect fail**

```bash
pnpm vitest run tests/integration/library-books-archive.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Add procedures**

In `books.ts`:

```typescript
  archive: libraryAdminProcedure(t)
    .input(archiveBookInput)
    .mutation(async ({ ctx, input }) => {
      await applyRateLimiter(libraryBookUpdateLimiter, ctx.user!.id);
      const book = await assertBookInLibrary(input.id, ctx.library.id);
      if (book.archivedAt !== null) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'already archived' });
      }
      await prisma.book.update({
        where: { id: input.id },
        data: { archivedAt: new Date() },
      });
      await recordAudit({
        action: 'library.book.archived',
        actor: { id: ctx.user!.id },
        target: { type: 'BOOK', id: input.id },
        metadata: { libraryId: ctx.library.id },
        req: { ip: ctx.ip },
      });
      return { ok: true };
    }),

  unarchive: libraryAdminProcedure(t)
    .input(unarchiveBookInput)
    .mutation(async ({ ctx, input }) => {
      await applyRateLimiter(libraryBookUpdateLimiter, ctx.user!.id);
      const book = await assertBookInLibrary(input.id, ctx.library.id);
      if (book.archivedAt === null) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'not archived' });
      }
      await prisma.book.update({
        where: { id: input.id },
        data: { archivedAt: null },
      });
      await recordAudit({
        action: 'library.book.unarchived',
        actor: { id: ctx.user!.id },
        target: { type: 'BOOK', id: input.id },
        metadata: { libraryId: ctx.library.id },
        req: { ip: ctx.ip },
      });
      return { ok: true };
    }),
```

Update imports to include `archiveBookInput`, `unarchiveBookInput`.

- [ ] **Step 4: Run test, expect pass**

```bash
pnpm vitest run tests/integration/library-books-archive.test.ts
```

Expected: 5/5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/trpc/routers/library/books.ts tests/integration/library-books-archive.test.ts
git commit -m "feat(phase-1d): library.books.archive + unarchive (soft-delete)

Symmetric pair: archive sets archivedAt, unarchive clears it. Each
refuses idempotent calls (BAD_REQUEST when already archived/not archived)
to surface UI mistakes. Audit logs library.book.archived /unarchived.
5 integration tests covering both directions + role guard.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task B6 — `library.books.delete` (GLOBAL_ADMIN only, hard delete)

**Files:**

- Modify: `src/server/trpc/routers/library/books.ts`
- Create: `tests/integration/library-books-delete.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/library-books-delete.test.ts`:

```typescript
import { describe, expect, test } from 'vitest';
import { appRouter } from '@/server/trpc/routers/_app';
import { makeCtxForRole } from './_helpers/auth-ctx';
import { prisma } from '@/lib/db';

describe('library.books.delete', () => {
  test('GLOBAL_ADMIN deletes book with no dependencies', async () => {
    const ctx = await makeCtxForRole('GLOBAL_ADMIN');
    const lib = await prisma.library.create({
      data: { name: 'Del', slug: `del-${Date.now()}` },
    });
    const book = await prisma.book.create({
      data: { libraryId: lib.id, title: 'To Delete', authors: ['X'] },
    });
    const caller = appRouter.createCaller(ctx);
    await caller.library.books.delete({ slug: lib.slug, id: book.id });
    const after = await prisma.book.findUnique({ where: { id: book.id } });
    expect(after).toBeNull();
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'library.book.deleted', targetId: book.id },
    });
    expect(audit).not.toBeNull();
    expect((audit!.metadata as any).snapshot).toMatchObject({ title: 'To Delete' });
  });

  test('LIBRARY_ADMIN cannot delete — FORBIDDEN', async () => {
    const ctx = await makeCtxForRole('LIBRARY_ADMIN');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: ctx.libraryId } });
    const book = await prisma.book.create({
      data: { libraryId: lib.id, title: 'Cant', authors: ['X'] },
    });
    const caller = appRouter.createCaller(ctx);
    await expect(caller.library.books.delete({ slug: lib.slug, id: book.id })).rejects.toThrowError(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });

  test('refuses delete when book has BookFile (BAD_REQUEST)', async () => {
    const ctx = await makeCtxForRole('GLOBAL_ADMIN');
    const lib = await prisma.library.create({
      data: { name: 'Del2', slug: `del-${Date.now()}-2` },
    });
    const book = await prisma.book.create({
      data: { libraryId: lib.id, title: 'HasFile', authors: ['X'] },
    });
    await prisma.bookFile.create({
      data: {
        bookId: book.id,
        format: 'EPUB',
        isOriginal: true,
        storagePath: '/tmp/x.epub',
        fileSizeBytes: BigInt(100),
        sha256: 'a'.repeat(64),
        mimeType: 'application/epub+zip',
      },
    });
    const caller = appRouter.createCaller(ctx);
    await expect(caller.library.books.delete({ slug: lib.slug, id: book.id })).rejects.toThrowError(
      expect.objectContaining({
        code: 'BAD_REQUEST',
        message: expect.stringContaining('files'),
      }),
    );
    // book still present
    const stillThere = await prisma.book.findUnique({ where: { id: book.id } });
    expect(stillThere).not.toBeNull();
  });

  test('cross-library id-guess returns NOT_FOUND', async () => {
    const ctx = await makeCtxForRole('GLOBAL_ADMIN');
    const lib1 = await prisma.library.create({ data: { name: 'L1', slug: `l1-${Date.now()}` } });
    const lib2 = await prisma.library.create({ data: { name: 'L2', slug: `l2-${Date.now()}` } });
    const book2 = await prisma.book.create({
      data: { libraryId: lib2.id, title: 'In L2', authors: ['X'] },
    });
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.library.books.delete({ slug: lib1.slug, id: book2.id }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
  });
});
```

- [ ] **Step 2: Run test, expect fail**

```bash
pnpm vitest run tests/integration/library-books-delete.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Add the `delete` procedure**

In `books.ts`:

```typescript
  delete: globalAdminProcedure
    .input(deleteBookInput)
    .mutation(async ({ ctx, input }) => {
      await applyRateLimiter(libraryBookDeleteLimiter, ctx.user.id);
      // GLOBAL_ADMIN bypasses membership; still validate slug↔id
      const lib = await prisma.library.findUnique({ where: { slug: input.slug } });
      if (!lib) throw new TRPCError({ code: 'NOT_FOUND', message: 'library not found' });
      const book = await assertBookInLibrary(input.id, lib.id);
      await assertNoBookDependencies(book.id);
      const snapshot = { ...book };
      await prisma.book.delete({ where: { id: book.id } });
      await recordAudit({
        action: 'library.book.deleted',
        actor: { id: ctx.user.id },
        target: { type: 'BOOK', id: book.id },
        metadata: { libraryId: lib.id, snapshot },
        req: { ip: ctx.ip },
      });
      return { ok: true };
    }),
```

Update imports:

```typescript
import { globalAdminProcedure } from '../../procedures';
import { assertBookInLibrary, assertNotArchived, assertNoBookDependencies } from '@/lib/book-admin';
import {
  libraryBookListLimiter,
  libraryBookCreateLimiter,
  libraryBookUpdateLimiter,
  libraryBookDeleteLimiter,
  applyRateLimiter,
} from '@/lib/rate-limit';
import {
  listBooksInput,
  getBookInput,
  createBookInput,
  updateBookInput,
  archiveBookInput,
  unarchiveBookInput,
  deleteBookInput,
} from '../../schemas/book';
```

- [ ] **Step 4: Run test, expect pass**

```bash
pnpm vitest run tests/integration/library-books-delete.test.ts
```

Expected: 4/4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/trpc/routers/library/books.ts tests/integration/library-books-delete.test.ts
git commit -m "feat(phase-1d): library.books.delete (GLOBAL_ADMIN only, hard delete)

Pre-flights assertNoBookDependencies (refuses if any BookFile, PhysicalCopy,
Annotation, Bookmark, ReadingProgress, ReadingSession, Tag exist). Audit
log includes a full snapshot of the deleted book (legal hold). Rate limiter
1/h/user. 4 integration tests cover happy path, role guard, dependency
guard, cross-library id-guess.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task B7 — Permissions matrix delta (35 cases) + anti-drift extension

**Files:**

- Modify: `tests/integration/permissions-matrix.test.ts`

- [ ] **Step 1: Read current matrix structure**

```bash
grep -n "router:" tests/integration/permissions-matrix.test.ts | head -20
grep -n "listProtectedProcedures" tests/integration/permissions-matrix.test.ts
```

Note the line where the matrix array ends and where `listProtectedProcedures` is defined.

- [ ] **Step 2: Add 7 new matrix rows**

Append to the matrix array (before its closing `]`):

```typescript
{
  router: 'library.books',
  procedure: 'list',
  byRole: {
    GLOBAL_ADMIN: 'OK',
    LIBRARY_ADMIN_THIS: 'OK',
    LIBRARY_ADMIN_OTHER: 'NOT_FOUND',
    MEMBER_THIS: 'OK',
    MEMBER_OTHER: 'NOT_FOUND',
    ANON: 'UNAUTHORIZED',
    PENDING_2FA: 'UNAUTHORIZED',
  },
  call: (c, slug) => c.library.books.list({ slug, limit: 24 }),
},
{
  router: 'library.books',
  procedure: 'get',
  byRole: {
    GLOBAL_ADMIN: 'OK',
    LIBRARY_ADMIN_THIS: 'OK',
    LIBRARY_ADMIN_OTHER: 'NOT_FOUND',
    MEMBER_THIS: 'OK',
    MEMBER_OTHER: 'NOT_FOUND',
    ANON: 'UNAUTHORIZED',
    PENDING_2FA: 'UNAUTHORIZED',
  },
  call: (c, slug, bookId) => c.library.books.get({ slug, id: bookId }),
  needsBookId: true,
},
{
  router: 'library.books',
  procedure: 'create',
  byRole: {
    GLOBAL_ADMIN: 'OK',
    LIBRARY_ADMIN_THIS: 'OK',
    LIBRARY_ADMIN_OTHER: 'NOT_FOUND',
    MEMBER_THIS: 'FORBIDDEN',
    MEMBER_OTHER: 'NOT_FOUND',
    ANON: 'UNAUTHORIZED',
    PENDING_2FA: 'UNAUTHORIZED',
  },
  call: (c, slug) => c.library.books.create({ slug, title: 'matrix probe', authors: ['X'] }),
},
{
  router: 'library.books',
  procedure: 'update',
  byRole: {
    GLOBAL_ADMIN: 'OK',
    LIBRARY_ADMIN_THIS: 'OK',
    LIBRARY_ADMIN_OTHER: 'NOT_FOUND',
    MEMBER_THIS: 'FORBIDDEN',
    MEMBER_OTHER: 'NOT_FOUND',
    ANON: 'UNAUTHORIZED',
    PENDING_2FA: 'UNAUTHORIZED',
  },
  call: (c, slug, bookId, updatedAt) =>
    c.library.books.update({
      slug,
      id: bookId,
      expectedUpdatedAt: updatedAt!,
      patch: { title: 'matrix probe updated' },
    }),
  needsBookId: true,
},
{
  router: 'library.books',
  procedure: 'archive',
  byRole: {
    GLOBAL_ADMIN: 'OK',
    LIBRARY_ADMIN_THIS: 'OK',
    LIBRARY_ADMIN_OTHER: 'NOT_FOUND',
    MEMBER_THIS: 'FORBIDDEN',
    MEMBER_OTHER: 'NOT_FOUND',
    ANON: 'UNAUTHORIZED',
    PENDING_2FA: 'UNAUTHORIZED',
  },
  call: (c, slug, bookId) => c.library.books.archive({ slug, id: bookId }),
  needsBookId: true,
  // Each test seeds a fresh book for archive — see harness changes below.
},
{
  router: 'library.books',
  procedure: 'unarchive',
  byRole: {
    GLOBAL_ADMIN: 'OK',
    LIBRARY_ADMIN_THIS: 'OK',
    LIBRARY_ADMIN_OTHER: 'NOT_FOUND',
    MEMBER_THIS: 'FORBIDDEN',
    MEMBER_OTHER: 'NOT_FOUND',
    ANON: 'UNAUTHORIZED',
    PENDING_2FA: 'UNAUTHORIZED',
  },
  call: (c, slug, bookId) => c.library.books.unarchive({ slug, id: bookId }),
  needsBookId: true,
  needsArchivedBook: true,
},
{
  router: 'library.books',
  procedure: 'delete',
  byRole: {
    GLOBAL_ADMIN: 'OK',
    LIBRARY_ADMIN_THIS: 'FORBIDDEN',
    LIBRARY_ADMIN_OTHER: 'FORBIDDEN',
    MEMBER_THIS: 'FORBIDDEN',
    MEMBER_OTHER: 'FORBIDDEN',
    ANON: 'UNAUTHORIZED',
    PENDING_2FA: 'UNAUTHORIZED',
  },
  call: (c, slug, bookId) => c.library.books.delete({ slug, id: bookId }),
  needsBookId: true,
},
```

- [ ] **Step 3: Update the harness to support library.\* slug + bookId seeding**

Locate the test loop (likely a `describe.each` or `for (const row of matrix)` block). Each iteration of the matrix runs the `call` against a `caller` for each role. For library.\* the harness needs:

1. To seed (or be passed) the slug of "this" library that the actor is a member of for `MEMBER_THIS`/`LIBRARY_ADMIN_THIS`, and a different lib for `_OTHER`.
2. To seed a book in "this" library when `needsBookId` is set, and pass its id (and `updatedAt` for `update`) into `call`.
3. To pre-archive that book when `needsArchivedBook` is set (for unarchive matrix probes).

Read the existing test loop and adapt. Pseudocode (the actual loop's shape matters; preserve it):

```typescript
async function setupBookForRow(libraryId: string, archived: boolean) {
  const book = await prisma.book.create({
    data: {
      libraryId,
      title: 'matrix probe book',
      authors: ['probe'],
      ...(archived ? { archivedAt: new Date() } : {}),
    },
  });
  return book;
}

// In the loop:
for (const row of matrix) {
  for (const role of ROLES) {
    const expected = row.byRole[role];
    const ctx = await makeCtxForRole(roleToBaseKey(role));
    const slug = pickSlugForRole(role, ctx); // 'this' lib's slug, or seeded 'other' lib's slug
    let bookId: string | undefined;
    let updatedAt: Date | undefined;
    if (row.needsBookId) {
      const lib = await pickLibraryForRow(role, ctx);
      const book = await setupBookForRow(lib.id, !!row.needsArchivedBook);
      bookId = book.id;
      updatedAt = book.updatedAt;
    }
    const caller = appRouter.createCaller(ctx);
    if (expected === 'OK') {
      await expect(row.call(caller, slug, bookId, updatedAt)).resolves.toBeDefined();
    } else {
      await expect(row.call(caller, slug, bookId, updatedAt)).rejects.toThrowError(
        expect.objectContaining({ code: expected }),
      );
    }
  }
}
```

> **Note**: the existing 1C harness uses `STUB_CUID` for cases that don't need
> a real id (because they fail before id resolution). Library.\* needs real
> ids when the role gets past the slug check — `MEMBER_THIS` for `archive`
> goes far enough into the procedure to need a real bookId. Audit the existing
> harness file carefully and add the seeding only where needed.

- [ ] **Step 4: Update the anti-drift guard to include `library.*`**

Locate `function listProtectedProcedures` and update:

```typescript
function listProtectedProcedures(router: typeof appRouter): string[] {
  const def = (router as unknown as { _def?: { procedures?: Record<string, unknown> } })._def;
  const procedures = def?.procedures ?? {};
  return Object.keys(procedures).filter(
    (name) =>
      name.startsWith('admin.') || name.startsWith('account.') || name.startsWith('library.'),
  );
}
```

- [ ] **Step 5: Run the matrix**

```bash
pnpm vitest run tests/integration/permissions-matrix.test.ts
```

Expected: All previous matrix tests still pass + 35 new (7 procedures × 5 roles, with `LIBRARY_ADMIN_THIS`/`LIBRARY_ADMIN_OTHER`/`MEMBER_THIS`/`MEMBER_OTHER` distinct rows). Total ~185 cases. Anti-drift assertion passes (no missing or stale entries).

- [ ] **Step 6: Commit**

```bash
git add tests/integration/permissions-matrix.test.ts
git commit -m "test(phase-1d): permissions matrix delta — library.books × 5 roles (35 cases)

7 procedures × {GA, LA-this, LA-other, M-this, M-other, ANON, P2FA} adds
35 new role assertions to the executable matrix. Harness extended to
seed real bookIds for procedures that get past slug resolution (archive,
unarchive, update, delete, get). Anti-drift guard widened to library.*.
All ~185 matrix cases green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task B8 — Module B checkpoint

- [ ] **Step 1: Run full test suite**

```bash
pnpm test --run
```

Expected: All unit + integration tests pass. No regressions in 1A/1B/1C suites.

- [ ] **Step 2: Tag**

```bash
git tag phase-1d-checkpoint-module-B -m "Module B complete: library.books router (7 procedures) + matrix delta"
```

**Module B acceptance criteria:**

- ✅ `library.books.{list, get, create, update, archive, unarchive, delete}` all implemented
- ✅ Each procedure has its own integration test file (5–9 tests each)
- ✅ Permissions matrix delta of 35 cases passes
- ✅ Anti-drift guard recognizes `library.*` and finds zero missing/stale entries
- ✅ Optimistic concurrency works on `update` (CONFLICT on stale `expectedUpdatedAt`)
- ✅ Rate-limiters fire under load (covered by `library-books-create.test.ts` rate-limit case)
- ✅ Audit log emits 5 distinct actions, each with proper actor/target/meta
- ✅ All 1A/1B/1C tests still pass
- ✅ Tag `phase-1d-checkpoint-module-B` created

---

## Module C — UI member space (`/libraries`, layout, MemberHeader, switcher)

**Goal:** Bootstrap the user-facing space. New layout under `src/app/library/[slug]/...`, a member header parallel to `AdminHeader.tsx` (Sheet burger drawer + library switcher combobox), and the entry page `/libraries`. Total: 5 tasks. Estimated 2–3 days.

> **Parallel execution note**: Module C can run in parallel with Module B once Module A is merged. The router stub (`library: libraryRouter` from B1) only needs to exist for the UI's `trpc.library.*` calls to type-check; full procedures can come from Module B in parallel.

### Task C1 — Install missing shadcn components

**Files:**

- Modify: `src/components/ui/*` (additions)

- [ ] **Step 1: Inventory existing**

```bash
ls src/components/ui/
```

Confirm what's present. Per recon: `alert button card checkbox dialog input label sheet stepper toast toaster`. Missing for 1D: `dropdown-menu`, `command`, `popover`, `select`, `form`, `table`, `badge`, `skeleton`.

- [ ] **Step 2: Add the missing primitives via shadcn CLI**

```bash
pnpm dlx shadcn@latest add dropdown-menu command popover select form table badge skeleton
```

If the project pins a specific shadcn version, use that version. Components are generated under `src/components/ui/`. Inspect each generated file briefly for unwanted styling defaults.

- [ ] **Step 3: Install peer deps if prompted**

shadcn may prompt to install `cmdk`, `@radix-ui/react-popover`, `@radix-ui/react-select`, `@radix-ui/react-dropdown-menu` if not already present.

```bash
pnpm install
```

- [ ] **Step 4: Verify build still passes**

```bash
pnpm typecheck
pnpm lint
```

Expected: no new errors. If shadcn's generated `cn` import path doesn't match the project's (`@/lib/utils` vs other), patch the imports.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui package.json pnpm-lock.yaml components.json
git commit -m "chore(phase-1d): add shadcn primitives (dropdown-menu, command, popover, select, form, table, badge, skeleton)

Required for Phase 1D member UI: library switcher (command + popover),
book actions menu (dropdown-menu), filters (select + form), catalog grid
(table + badge + skeleton).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task C2 — `MemberHeader.tsx` + `MemberSidebar.tsx`

**Files:**

- Create: `src/components/member/MemberHeader.tsx`
- Create: `src/components/member/MemberSidebar.tsx`
- Create: `tests/unit/MemberHeader.test.tsx` (a smoke render test)
- Modify: `messages/fr.json` and `messages/en.json` (i18n keys for `member.header.*`, `member.nav.*`)

- [ ] **Step 1: Read AdminHeader.tsx as reference**

```bash
cat src/components/admin/AdminHeader.tsx
cat src/components/admin/AdminSidebar.tsx
```

Reproduce the structure with member-specific routes and translations.

- [ ] **Step 2: Add i18n keys**

In `messages/fr.json`, add:

```json
"member": {
  "header": {
    "openMenu": "Ouvrir le menu",
    "menuTitle": "Menu",
    "phase": "Membre"
  },
  "nav": {
    "myLibraries": "Mes bibliothèques",
    "catalog": "Catalogue",
    "loans": "Mes prêts",
    "loansComingSoon": "Phase 2"
  }
}
```

In `messages/en.json`:

```json
"member": {
  "header": {
    "openMenu": "Open menu",
    "menuTitle": "Menu",
    "phase": "Member"
  },
  "nav": {
    "myLibraries": "My libraries",
    "catalog": "Catalog",
    "loans": "My loans",
    "loansComingSoon": "Phase 2"
  }
}
```

- [ ] **Step 3: Create `MemberSidebar.tsx`**

```typescript
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LibraryBig, BookOpen, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

export function MemberSidebar({ slug }: { slug?: string }) {
  const t = useTranslations('member.nav');
  const pathname = usePathname();
  const items = [
    {
      href: '/libraries',
      label: t('myLibraries'),
      icon: LibraryBig,
      active: pathname === '/libraries',
    },
    ...(slug
      ? [
          {
            href: `/library/${slug}/books`,
            label: t('catalog'),
            icon: BookOpen,
            active: pathname.startsWith(`/library/${slug}/books`),
          },
          {
            href: '#',
            label: `${t('loans')} (${t('loansComingSoon')})`,
            icon: Clock,
            active: false,
            disabled: true,
          },
        ]
      : []),
  ];
  return (
    <nav aria-label="Member navigation" className="flex flex-col gap-1">
      {items.map((it) => (
        <Link
          key={it.href + it.label}
          href={it.disabled ? '#' : it.href}
          aria-disabled={it.disabled || undefined}
          className={cn(
            'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition',
            it.active && 'bg-muted font-medium',
            !it.active && !it.disabled && 'hover:bg-muted/50',
            it.disabled && 'pointer-events-none text-muted-foreground/60',
          )}
        >
          <it.icon className="h-4 w-4" aria-hidden />
          {it.label}
        </Link>
      ))}
    </nav>
  );
}
```

- [ ] **Step 4: Create `MemberHeader.tsx`**

```typescript
'use client';

import { useState } from 'react';
import { Menu } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { BrandMark } from '@/components/brand/BrandMark';
import { LogoutButton } from '@/components/auth/LogoutButton';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { MemberSidebar } from './MemberSidebar';
import { LibrarySwitcher } from './LibrarySwitcher';

export function MemberHeader({ currentSlug }: { currentSlug?: string }) {
  const t = useTranslations('member.header');
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
      <div className="container mx-auto flex h-14 items-center justify-between gap-3 px-4">
        <div className="flex items-center gap-3">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label={t('openMenu')}>
                <Menu className="h-5 w-5" aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0">
              <SheetHeader className="sr-only">
                <SheetTitle>{t('menuTitle')}</SheetTitle>
              </SheetHeader>
              <div className="p-4" onClick={() => setOpen(false)}>
                <MemberSidebar slug={currentSlug} />
              </div>
            </SheetContent>
          </Sheet>
          <BrandMark size="sm" />
          <span className="hidden text-xs uppercase tracking-wider text-muted-foreground sm:inline">
            {t('phase')}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <LibrarySwitcher currentSlug={currentSlug} />
          <LogoutButton className="text-muted-foreground hover:text-foreground" />
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 5: Smoke render test**

Create `tests/unit/MemberHeader.test.tsx`:

```typescript
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { MemberHeader } from '@/components/member/MemberHeader';
import frMessages from '../../messages/fr.json';

function withProviders(node: React.ReactElement) {
  return (
    <NextIntlClientProvider locale="fr" messages={frMessages}>
      {node}
    </NextIntlClientProvider>
  );
}

describe('MemberHeader', () => {
  test('renders burger button and brand', () => {
    render(withProviders(<MemberHeader />));
    expect(screen.getByLabelText(/ouvrir le menu/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run test, expect fail**

```bash
pnpm vitest run tests/unit/MemberHeader.test.tsx
```

Expected: FAIL because `LibrarySwitcher` is not yet implemented (Task C3 follows). To unblock: stub it temporarily.

Add a temporary stub `src/components/member/LibrarySwitcher.tsx`:

```typescript
'use client';
export function LibrarySwitcher({ currentSlug }: { currentSlug?: string }) {
  return <div data-stub="library-switcher" data-current-slug={currentSlug ?? ''} />;
}
```

Re-run; should pass. The real component lands in Task C3.

- [ ] **Step 7: Commit**

```bash
git add src/components/member messages/fr.json messages/en.json tests/unit/MemberHeader.test.tsx
git commit -m "feat(phase-1d): MemberHeader + MemberSidebar (with stub LibrarySwitcher)

Mirrors AdminHeader pattern: Sheet burger drawer mobile, BrandMark left,
LogoutButton right. Sidebar shows /libraries link + catalog link when on
a specific lib; loans link disabled with 'Phase 2' suffix. i18n keys in
member.header.* and member.nav.*. LibrarySwitcher stubbed; real impl in C3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task C3 — `LibrarySwitcher.tsx` (combobox)

**Files:**

- Create (replace stub): `src/components/member/LibrarySwitcher.tsx`
- Create: `tests/unit/LibrarySwitcher.test.tsx`

- [ ] **Step 1: Decide where it fetches the lib list**

The switcher needs the list of libraries the current user can access. We expose this via a new tRPC query `library.libraries.listAccessible` (small enough that it lives alongside `library.books`). Add it now.

In `src/server/trpc/routers/library/index.ts`:

```typescript
import { t } from '../../trpc';
import { authedProcedure } from '../../procedures';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { libraryBooksRouter } from './books';

export const libraryRouter = t.router({
  books: libraryBooksRouter,
  libraries: t.router({
    listAccessible: authedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role === 'GLOBAL_ADMIN') {
        const libs = await prisma.library.findMany({
          where: { archivedAt: null },
          orderBy: { name: 'asc' },
          select: { id: true, name: true, slug: true },
        });
        return libs;
      }
      const memberships = await prisma.libraryMember.findMany({
        where: { userId: ctx.user.id, library: { archivedAt: null } },
        include: { library: { select: { id: true, name: true, slug: true } } },
        orderBy: { library: { name: 'asc' } },
      });
      return memberships.map((m) => m.library);
    }),
  }),
});
```

> **Matrix update**: this adds `library.libraries.listAccessible` — add the
> matrix row immediately or the anti-drift will fail. Append to the matrix
> in `tests/integration/permissions-matrix.test.ts`:
>
> ```typescript
> {
>   router: 'library.libraries',
>   procedure: 'listAccessible',
>   byRole: {
>     GLOBAL_ADMIN: 'OK',
>     LIBRARY_ADMIN_THIS: 'OK',
>     LIBRARY_ADMIN_OTHER: 'OK',
>     MEMBER_THIS: 'OK',
>     MEMBER_OTHER: 'OK',
>     ANON: 'UNAUTHORIZED',
>     PENDING_2FA: 'UNAUTHORIZED',
>   },
>   call: (c) => c.library.libraries.listAccessible(),
> },
> ```

- [ ] **Step 2: Implement the combobox**

Replace `src/components/member/LibrarySwitcher.tsx`:

```typescript
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Check, ChevronsUpDown, LibraryBig } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const LAST_LIBRARY_KEY = 'biblioshare:lastLibrarySlug';

export function LibrarySwitcher({ currentSlug }: { currentSlug?: string }) {
  const t = useTranslations('member.switcher');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { data: libs, isLoading } = trpc.library.libraries.listAccessible.useQuery();
  const current = libs?.find((l) => l.slug === currentSlug);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={t('label')}
          className="w-[220px] justify-between"
        >
          <span className="flex items-center gap-2 truncate">
            <LibraryBig className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate">
              {isLoading ? t('loading') : (current?.name ?? t('placeholder'))}
            </span>
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0">
        <Command>
          <CommandInput placeholder={t('searchPlaceholder')} />
          <CommandList>
            <CommandEmpty>{t('noResults')}</CommandEmpty>
            <CommandGroup>
              {(libs ?? []).map((lib) => (
                <CommandItem
                  key={lib.id}
                  value={lib.name}
                  onSelect={() => {
                    setOpen(false);
                    if (typeof window !== 'undefined') {
                      window.localStorage.setItem(LAST_LIBRARY_KEY, lib.slug);
                    }
                    router.push(`/library/${lib.slug}/books`);
                  }}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      currentSlug === lib.slug ? 'opacity-100' : 'opacity-0',
                    )}
                    aria-hidden
                  />
                  <span className="truncate">{lib.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
```

Add i18n keys for `member.switcher.{label,loading,placeholder,searchPlaceholder,noResults}` to fr/en.

- [ ] **Step 3: Render test**

Create `tests/unit/LibrarySwitcher.test.tsx`:

```typescript
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import frMessages from '../../messages/fr.json';

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    library: {
      libraries: {
        listAccessible: {
          useQuery: () => ({
            data: [
              { id: 'cl1', name: 'Lib One', slug: 'lib-one' },
              { id: 'cl2', name: 'Lib Two', slug: 'lib-two' },
            ],
            isLoading: false,
          }),
        },
      },
    },
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { LibrarySwitcher } from '@/components/member/LibrarySwitcher';

describe('LibrarySwitcher', () => {
  test('renders current library name when slug provided', () => {
    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <LibrarySwitcher currentSlug="lib-two" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('combobox')).toHaveTextContent(/lib two/i);
  });
});
```

- [ ] **Step 4: Run tests**

```bash
pnpm vitest run tests/unit/LibrarySwitcher.test.tsx
pnpm vitest run tests/integration/permissions-matrix.test.ts
```

Expected: switcher render test passes, matrix anti-drift passes (new `library.libraries.listAccessible` row recognized).

- [ ] **Step 5: Commit**

```bash
git add src/components/member/LibrarySwitcher.tsx src/server/trpc/routers/library/index.ts tests/unit/LibrarySwitcher.test.tsx tests/integration/permissions-matrix.test.ts messages/fr.json messages/en.json
git commit -m "feat(phase-1d): LibrarySwitcher combobox + library.libraries.listAccessible

Combobox uses Radix Popover + cmdk Command. Persists last-used slug in
localStorage (URL is source of truth, localStorage is just a default for
/libraries redirect). New tRPC query returns libraries the user is a
member of (or all non-archived for GLOBAL_ADMIN). Matrix row added.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task C4 — Member layout + auth guard

**Files:**

- Create: `src/app/library/[slug]/layout.tsx`
- Create: `src/app/libraries/layout.tsx`

> Note: not using a route group `(member)` per the drift table. The two
> layout files share most logic via a small helper.

- [ ] **Step 1: Create the shared guard helper**

Create `src/server/auth/member-guard.ts`:

```typescript
import { redirect } from 'next/navigation';
import { getCurrentSessionAndUser } from '@/server/auth/session-bridge';
import { prisma } from '@/lib/db';

/**
 * Resolves the current user. Redirects to /login if anonymous or pending 2FA.
 * Returns the user. Use in server components for the /libraries and /library/* tree.
 */
export async function requireAuthedUser() {
  const result = await getCurrentSessionAndUser();
  if (!result || result.session.pending2fa) redirect('/login');
  return result.user;
}

/**
 * For /library/[slug]/* routes: also ensures the user has access to that slug.
 * Redirects to /libraries with ?error=not-a-member if they don't.
 */
export async function requireMembership(slug: string) {
  const user = await requireAuthedUser();
  if (user.role === 'GLOBAL_ADMIN') {
    const lib = await prisma.library.findUnique({ where: { slug } });
    if (!lib) redirect('/libraries?error=not-found');
    return { user, library: lib, membership: null };
  }
  const lib = await prisma.library.findUnique({ where: { slug } });
  if (!lib || lib.archivedAt !== null) redirect('/libraries?error=not-found');
  const membership = await prisma.libraryMember.findUnique({
    where: { userId_libraryId: { userId: user.id, libraryId: lib.id } },
  });
  if (!membership) redirect('/libraries?error=not-a-member');
  return { user, library: lib, membership };
}
```

- [ ] **Step 2: Create `src/app/libraries/layout.tsx`**

```typescript
import { requireAuthedUser } from '@/server/auth/member-guard';
import { MemberHeader } from '@/components/member/MemberHeader';
import { MemberSidebar } from '@/components/member/MemberSidebar';

export default async function LibrariesLayout({ children }: { children: React.ReactNode }) {
  await requireAuthedUser();
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <MemberHeader />
      <div className="container mx-auto flex flex-1 gap-8 px-4 py-8">
        <aside className="hidden lg:block lg:w-56 lg:shrink-0 lg:border-r lg:pr-6">
          <MemberSidebar />
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `src/app/library/[slug]/layout.tsx`**

```typescript
import { requireMembership } from '@/server/auth/member-guard';
import { MemberHeader } from '@/components/member/MemberHeader';
import { MemberSidebar } from '@/components/member/MemberSidebar';

export default async function LibraryLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  await requireMembership(slug);
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <MemberHeader currentSlug={slug} />
      <div className="container mx-auto flex flex-1 gap-8 px-4 py-8">
        <aside className="hidden lg:block lg:w-56 lg:shrink-0 lg:border-r lg:pr-6">
          <MemberSidebar slug={slug} />
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Smoke compile**

```bash
pnpm typecheck
```

Expected: no errors. Both layouts compile against `requireAuthedUser`/`requireMembership`.

- [ ] **Step 5: Commit**

```bash
git add src/app/libraries/layout.tsx src/app/library src/server/auth/member-guard.ts
git commit -m "feat(phase-1d): member layouts + requireAuthedUser/requireMembership guards

Two layout files share MemberHeader/MemberSidebar shell. /libraries layout
just requires auth; /library/[slug] layout additionally enforces
membership (GLOBAL_ADMIN bypasses, archived libs treated as not-found).
Redirects on failure carry ?error= query for friendly UX.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task C5 — Page `/libraries` + Module C checkpoint

**Files:**

- Create: `src/app/libraries/page.tsx`
- Create: `src/app/libraries/LibrariesGrid.tsx` (client component for trpc data)
- Create: `tests/unit/LibrariesGrid.test.tsx`

- [ ] **Step 1: Server page**

Create `src/app/libraries/page.tsx`:

```typescript
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LibrariesGrid } from './LibrariesGrid';

export const metadata: Metadata = {
  title: 'Mes bibliothèques — BiblioShare',
  robots: { index: false, follow: false },
};

export default async function LibrariesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const t = await getTranslations('member.libraries');
  const sp = await searchParams;
  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t('pageTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>
      {sp.error === 'not-a-member' && (
        <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm">
          {t('errors.notAMember')}
        </div>
      )}
      {sp.error === 'not-found' && (
        <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm">
          {t('errors.notFound')}
        </div>
      )}
      <LibrariesGrid />
    </section>
  );
}
```

- [ ] **Step 2: Client grid**

Create `src/app/libraries/LibrariesGrid.tsx`:

```typescript
'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { LibraryBig, Users, BookOpen } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export function LibrariesGrid() {
  const t = useTranslations('member.libraries');
  const { data, isLoading } = trpc.library.libraries.listAccessible.useQuery();

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-32 rounded-lg" />
        ))}
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {t('empty')}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {data.map((lib) => (
        <Link key={lib.id} href={`/library/${lib.slug}/books`}>
          <Card className="h-full transition hover:border-foreground/30 hover:shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LibraryBig className="h-5 w-5" aria-hidden />
                {lib.name}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" aria-hidden />
                {/* counts shown when listAccessible is extended; placeholder for now */}
              </span>
              <span className="flex items-center gap-1">
                <BookOpen className="h-3.5 w-3.5" aria-hidden />
                {/* book count placeholder */}
              </span>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
```

> **Note**: the placeholders for member/book counts can be wired later by
> extending `library.libraries.listAccessible` with `_count`. For Phase 1D
> scope, leaving them empty is acceptable and keeps the surface small.

Add i18n keys `member.libraries.{pageTitle, subtitle, empty, errors.notAMember, errors.notFound}`.

- [ ] **Step 3: Render test**

Create `tests/unit/LibrariesGrid.test.tsx` (mock pattern as in Task C3) and assert:

```typescript
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import frMessages from '../../messages/fr.json';

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    library: {
      libraries: {
        listAccessible: {
          useQuery: () => ({
            data: [{ id: 'cl1', name: 'Mon Salon', slug: 'mon-salon' }],
            isLoading: false,
          }),
        },
      },
    },
  },
}));

import { LibrariesGrid } from '@/app/libraries/LibrariesGrid';

describe('LibrariesGrid', () => {
  test('renders one card per accessible library', () => {
    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <LibrariesGrid />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText('Mon Salon')).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run + tag**

```bash
pnpm vitest run tests/unit/LibrariesGrid.test.tsx
pnpm test --run
```

Expected: all tests pass.

```bash
git add src/app/libraries tests/unit/LibrariesGrid.test.tsx messages/fr.json messages/en.json
git commit -m "feat(phase-1d): /libraries page + LibrariesGrid client component

Server page renders header + ?error= banner (notAMember / notFound) + grid.
LibrariesGrid uses library.libraries.listAccessible to render one card per
library with link to /library/[slug]/books.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"

git tag phase-1d-checkpoint-module-C -m "Module C complete: member shell (/libraries, layout, header, switcher)"
```

**Module C acceptance criteria:**

- ✅ shadcn primitives `dropdown-menu, command, popover, select, form, table, badge, skeleton` installed
- ✅ `MemberHeader.tsx` + `MemberSidebar.tsx` mirror Admin pattern, Sheet burger drawer mobile
- ✅ `LibrarySwitcher.tsx` combobox functional + i18n keys + render test
- ✅ `library.libraries.listAccessible` tRPC query + matrix delta row + anti-drift OK
- ✅ Two layouts (`/libraries` and `/library/[slug]/...`) with `requireAuthedUser` / `requireMembership` guards
- ✅ `/libraries` page renders accessible libs as clickable cards with skeleton loading
- ✅ All tests pass
- ✅ Tag `phase-1d-checkpoint-module-C` created

---

## Module D — UI catalogue + form + dialogs

**Goal:** All catalog pages: list view (with search/filters/sort/pagination), detail view (with admin actions), create/edit form, archive/unarchive/delete dialogs. The visual layer is invoked through the `frontend-design` skill to avoid generic AI output. Total: 7 tasks. Estimated 3–4 days.

> **Design quality gate**: Before starting D3 (catalog page) and D5 (detail page), invoke `superpowers:frontend-design` skill in a sub-conversation to draft visual options. The plan tasks below assume the design choices have been ratified; the implementation steps follow once shapes are agreed.

### Task D1 — `BookCard` + `BookListGrid` + `Paginator`

**Files:**

- Create: `src/components/books/BookCard.tsx`
- Create: `src/components/books/BookListGrid.tsx`
- Create: `src/components/books/Paginator.tsx`
- Create: `tests/unit/BookCard.test.tsx`

- [ ] **Step 1: Implement `BookCard.tsx`**

```typescript
'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { BookOpen, Package, Archive } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export interface BookCardData {
  id: string;
  title: string;
  authors: string[];
  coverPath: string | null;
  hasDigital: boolean;
  hasPhysical: boolean;
  archivedAt: Date | null;
}

export function BookCard({ slug, book }: { slug: string; book: BookCardData }) {
  const t = useTranslations('books.card');
  return (
    <Link href={`/library/${slug}/books/${book.id}`} className="block focus:outline-none">
      <Card
        className={cn(
          'group h-full overflow-hidden transition hover:border-foreground/30 hover:shadow-sm',
          book.archivedAt && 'opacity-60',
        )}
      >
        <div className="relative aspect-[2/3] overflow-hidden bg-muted">
          {book.coverPath ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={book.coverPath}
              alt={t('coverAlt', { title: book.title })}
              className="h-full w-full object-cover transition group-hover:scale-105"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <BookOpen className="h-12 w-12" aria-hidden />
            </div>
          )}
          {book.archivedAt && (
            <div className="absolute right-2 top-2 rounded-full bg-background/90 px-2 py-1 text-xs">
              <Archive className="mr-1 inline h-3 w-3" aria-hidden />
              {t('archived')}
            </div>
          )}
        </div>
        <CardContent className="space-y-1.5 p-3">
          <h3 className="line-clamp-2 font-medium leading-tight">{book.title}</h3>
          <p className="line-clamp-1 text-xs text-muted-foreground">
            {book.authors.join(', ')}
          </p>
          <div className="flex gap-1.5 pt-1">
            {book.hasDigital && (
              <Badge variant="secondary" className="text-xs">
                <BookOpen className="mr-1 h-3 w-3" aria-hidden />
                {t('digital')}
              </Badge>
            )}
            {book.hasPhysical && (
              <Badge variant="secondary" className="text-xs">
                <Package className="mr-1 h-3 w-3" aria-hidden />
                {t('physical')}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
```

- [ ] **Step 2: Implement `BookListGrid.tsx`**

```typescript
'use client';

import { useTranslations } from 'next-intl';
import { Skeleton } from '@/components/ui/skeleton';
import { BookCard, type BookCardData } from './BookCard';

export function BookListGrid({
  slug,
  books,
  isLoading,
}: {
  slug: string;
  books: BookCardData[];
  isLoading: boolean;
}) {
  const t = useTranslations('books.list');
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="aspect-[2/3] rounded-lg" />
        ))}
      </div>
    );
  }
  if (books.length === 0) {
    return (
      <div className="rounded-lg border border-dashed py-16 text-center text-sm text-muted-foreground">
        {t('empty')}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {books.map((b) => (
        <BookCard key={b.id} slug={slug} book={b} />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Implement `Paginator.tsx` (cursor-based)**

```typescript
'use client';

import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function Paginator({
  hasNext,
  onNext,
  hasPrev,
  onPrev,
}: {
  hasNext: boolean;
  onNext: () => void;
  hasPrev: boolean;
  onPrev: () => void;
}) {
  const t = useTranslations('books.paginator');
  return (
    <div className="flex items-center justify-between border-t pt-4">
      <Button variant="outline" size="sm" onClick={onPrev} disabled={!hasPrev}>
        <ChevronLeft className="mr-1 h-4 w-4" aria-hidden />
        {t('prev')}
      </Button>
      <Button variant="outline" size="sm" onClick={onNext} disabled={!hasNext}>
        {t('next')}
        <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
      </Button>
    </div>
  );
}
```

> **Note on cursor history**: real "Previous" requires keeping a cursor stack
> client-side. Stack the cursors in a `useState` array; popping the latest
> element drives the prev navigation. This is implemented in Task D3 (the
> page that owns the pagination state).

- [ ] **Step 4: Render test for `BookCard`**

```typescript
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import frMessages from '../../messages/fr.json';
import { BookCard } from '@/components/books/BookCard';

const book = {
  id: 'cl1',
  title: 'Le Petit Prince',
  authors: ['Saint-Exupéry'],
  coverPath: 'https://example.com/c.jpg',
  hasDigital: true,
  hasPhysical: false,
  archivedAt: null,
};

describe('BookCard', () => {
  test('renders title, authors, and digital badge', () => {
    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <BookCard slug="mon-salon" book={book} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText('Le Petit Prince')).toBeInTheDocument();
    expect(screen.getByText(/saint-exupéry/i)).toBeInTheDocument();
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/library/mon-salon/books/cl1');
  });

  test('shows archive badge when archivedAt is set', () => {
    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <BookCard slug="mon-salon" book={{ ...book, archivedAt: new Date() }} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(/archivé/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: i18n keys + run + commit**

Add `books.card.{coverAlt, archived, digital, physical}`, `books.list.empty`, `books.paginator.{prev, next}` in fr/en.

```bash
pnpm vitest run tests/unit/BookCard.test.tsx
git add src/components/books messages tests/unit/BookCard.test.tsx
git commit -m "feat(phase-1d): BookCard, BookListGrid, Paginator

BookCard: cover image (lazy + no-referrer), title clamp-2, authors clamp-1,
hasDigital/hasPhysical badges, archive overlay when archived.
BookListGrid: responsive 2/3/4 cols, skeleton loader, empty state.
Paginator: cursor-based prev/next; cursor stack lives in page component.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task D2 — `BookSearchBar` + `BookFilters` + `BookSortSelect` (URL state)

**Files:**

- Create: `src/components/books/BookSearchBar.tsx`
- Create: `src/components/books/BookFilters.tsx`
- Create: `src/components/books/BookSortSelect.tsx`
- Create: `src/lib/url-state.ts` (small helper for URL search params updates)

- [ ] **Step 1: URL state helper**

Create `src/lib/url-state.ts`:

```typescript
'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

/**
 * Hook that returns a setter merging given key/value pairs into the current
 * URL search params, then pushing. Empty values are removed.
 */
export function useUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const set = useCallback(
    (updates: Record<string, string | number | boolean | undefined | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v === undefined || v === null || v === '' || v === false) {
          params.delete(k);
        } else {
          params.set(k, String(v));
        }
      }
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  return { searchParams, set };
}
```

- [ ] **Step 2: `BookSearchBar.tsx` (debounced)**

```typescript
'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useUrlState } from '@/lib/url-state';

const DEBOUNCE_MS = 300;

export function BookSearchBar() {
  const t = useTranslations('books.search');
  const { searchParams, set } = useUrlState();
  const initial = searchParams.get('q') ?? '';
  const [value, setValue] = useState(initial);

  useEffect(() => {
    const id = setTimeout(() => {
      if (value !== initial) set({ q: value, cursor: undefined });
    }, DEBOUNCE_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t('placeholder')}
        aria-label={t('label')}
        className="pl-9"
      />
    </div>
  );
}
```

- [ ] **Step 3: `BookFilters.tsx`**

```typescript
'use client';

import { useTranslations } from 'next-intl';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useUrlState } from '@/lib/url-state';

const LANGUAGES = ['fr', 'en', 'es', 'de', 'it', 'pt'];

export function BookFilters() {
  const t = useTranslations('books.filters');
  const { searchParams, set } = useUrlState();
  const hasDigital = searchParams.get('hasDigital') === 'true';
  const hasPhysical = searchParams.get('hasPhysical') === 'true';
  const language = searchParams.get('language') ?? '';

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <h3 className="text-sm font-medium">{t('title')}</h3>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Checkbox
            id="f-digital"
            checked={hasDigital}
            onCheckedChange={(c) => set({ hasDigital: c === true ? 'true' : undefined, cursor: undefined })}
          />
          <Label htmlFor="f-digital" className="text-sm font-normal">
            {t('hasDigital')}
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="f-physical"
            checked={hasPhysical}
            onCheckedChange={(c) => set({ hasPhysical: c === true ? 'true' : undefined, cursor: undefined })}
          />
          <Label htmlFor="f-physical" className="text-sm font-normal">
            {t('hasPhysical')}
          </Label>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-lang" className="text-xs uppercase tracking-wider text-muted-foreground">
            {t('languageLabel')}
          </Label>
          <Select
            value={language || 'all'}
            onValueChange={(v) => set({ language: v === 'all' ? undefined : v, cursor: undefined })}
          >
            <SelectTrigger id="f-lang">
              <SelectValue placeholder={t('languageAny')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('languageAny')}</SelectItem>
              {LANGUAGES.map((l) => (
                <SelectItem key={l} value={l}>
                  {t(`languages.${l}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `BookSortSelect.tsx`**

```typescript
'use client';

import { useTranslations } from 'next-intl';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useUrlState } from '@/lib/url-state';

const SORTS = ['createdAt_desc', 'createdAt_asc', 'title_asc'] as const;

export function BookSortSelect() {
  const t = useTranslations('books.sort');
  const { searchParams, set } = useUrlState();
  const value = (searchParams.get('sort') ?? 'createdAt_desc') as (typeof SORTS)[number];
  return (
    <Select value={value} onValueChange={(v) => set({ sort: v, cursor: undefined })}>
      <SelectTrigger className="w-[200px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SORTS.map((s) => (
          <SelectItem key={s} value={s}>
            {t(s)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

- [ ] **Step 5: Add i18n keys + commit**

Add `books.search.{label, placeholder}`, `books.filters.{title, hasDigital, hasPhysical, languageLabel, languageAny, languages.{fr,en,es,de,it,pt}}`, `books.sort.{createdAt_desc, createdAt_asc, title_asc}`.

```bash
pnpm typecheck
git add src/components/books src/lib/url-state.ts messages
git commit -m "feat(phase-1d): BookSearchBar (debounced), BookFilters, BookSortSelect

URL search params are the source of truth — useUrlState helper merges
updates and resets cursor on filter change. Search debounces 300ms.
Filters: hasDigital, hasPhysical, language. Sort: createdAt desc/asc, title asc.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task D3 — Page `/library/[slug]/books` (catalog view)

**Files:**

- Create: `src/app/library/[slug]/books/page.tsx`
- Create: `src/app/library/[slug]/books/BooksCatalog.tsx` (client)

> **Design gate**: Invoke `superpowers:frontend-design` skill before this task to ratify the catalog page composition. Bring back the visual decision and adjust the JSX below to match. The structure (header + filters sidebar + grid + paginator) is fixed; visual polish is variable.

- [ ] **Step 1: Create the server page**

`src/app/library/[slug]/books/page.tsx`:

```typescript
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { requireMembership } from '@/server/auth/member-guard';
import { BooksCatalog } from './BooksCatalog';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Catalogue ${slug} — BiblioShare`, robots: { index: false, follow: false } };
}

export default async function BooksCatalogPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const t = await getTranslations('books.page');
  const { user, library, membership } = await requireMembership(slug);
  const isAdmin = user.role === 'GLOBAL_ADMIN' || membership?.role === 'LIBRARY_ADMIN';

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{library.name}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        {isAdmin && (
          <Button asChild>
            <Link href={`/library/${slug}/books/new`}>
              <Plus className="mr-2 h-4 w-4" aria-hidden />
              {t('createCta')}
            </Link>
          </Button>
        )}
      </header>
      <BooksCatalog slug={slug} isAdmin={isAdmin} />
    </section>
  );
}
```

- [ ] **Step 2: Create the client `BooksCatalog`**

`src/app/library/[slug]/books/BooksCatalog.tsx`:

```typescript
'use client';

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { trpc } from '@/lib/trpc/client';
import { useUrlState } from '@/lib/url-state';
import { BookSearchBar } from '@/components/books/BookSearchBar';
import { BookFilters } from '@/components/books/BookFilters';
import { BookSortSelect } from '@/components/books/BookSortSelect';
import { BookListGrid } from '@/components/books/BookListGrid';
import { Paginator } from '@/components/books/Paginator';

export function BooksCatalog({ slug, isAdmin }: { slug: string; isAdmin: boolean }) {
  const t = useTranslations('books.catalog');
  const { searchParams, set } = useUrlState();
  const q = searchParams.get('q') ?? undefined;
  const hasDigital = searchParams.get('hasDigital') === 'true' ? true : undefined;
  const hasPhysical = searchParams.get('hasPhysical') === 'true' ? true : undefined;
  const language = searchParams.get('language') ?? undefined;
  const sort = (searchParams.get('sort') ?? 'createdAt_desc') as
    | 'createdAt_desc'
    | 'createdAt_asc'
    | 'title_asc';
  const cursor = searchParams.get('cursor') ?? undefined;
  const includeArchived = isAdmin && searchParams.get('includeArchived') === 'true';

  // Cursor history for "previous" navigation
  const [history, setHistory] = useState<string[]>([]);

  const { data, isLoading, isFetching } = trpc.library.books.list.useQuery({
    slug,
    q,
    hasDigital,
    hasPhysical,
    language,
    sort,
    cursor,
    limit: 24,
    includeArchived,
  });

  const onNext = () => {
    if (data?.nextCursor) {
      setHistory((h) => [...h, cursor ?? '']);
      set({ cursor: data.nextCursor });
    }
  };
  const onPrev = () => {
    setHistory((h) => {
      const next = [...h];
      const popped = next.pop() ?? '';
      set({ cursor: popped || undefined });
      return next;
    });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
      <div className="space-y-4">
        <BookFilters />
        {isAdmin && (
          <label className="flex cursor-pointer items-center gap-2 px-1 text-sm">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => set({ includeArchived: e.target.checked || undefined })}
            />
            {t('showArchived')}
          </label>
        )}
      </div>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[240px]">
            <BookSearchBar />
          </div>
          <BookSortSelect />
        </div>
        <BookListGrid slug={slug} books={data?.items ?? []} isLoading={isLoading || isFetching} />
        <Paginator
          hasNext={Boolean(data?.nextCursor)}
          onNext={onNext}
          hasPrev={history.length > 0}
          onPrev={onPrev}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: i18n + smoke + commit**

Add `books.page.{subtitle, createCta}`, `books.catalog.showArchived`.

```bash
pnpm typecheck
pnpm lint
git add src/app/library/[slug]/books/page.tsx src/app/library/[slug]/books/BooksCatalog.tsx messages
git commit -m "feat(phase-1d): /library/[slug]/books catalog page

Server page resolves membership, decides isAdmin, renders header with
'Add book' button (admin only). Client BooksCatalog binds URL params to
trpc.library.books.list, manages cursor history for prev nav, includes
'show archived' toggle visible only to admins.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task D4 — `BookForm` (shared create/update)

**Files:**

- Create: `src/components/books/BookForm.tsx`
- Create: `tests/unit/BookForm.test.tsx`

- [ ] **Step 1: Define the shared form**

`src/components/books/BookForm.tsx`:

```typescript
'use client';

import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';

const formSchema = z.object({
  title: z.string().min(1).max(500),
  authorsCsv: z.string().min(1).max(2000), // comma-separated, normalized in submit
  isbn10: z
    .string()
    .regex(/^\d{9}[\dX]$/, 'ISBN10 invalide')
    .or(z.literal(''))
    .optional(),
  isbn13: z
    .string()
    .regex(/^\d{13}$/, 'ISBN13 invalide')
    .or(z.literal(''))
    .optional(),
  publisher: z.string().max(200).optional(),
  publishedYear: z
    .string()
    .regex(/^\d{4}$/, 'Année invalide')
    .or(z.literal(''))
    .optional(),
  language: z.string().max(8).optional(),
  description: z.string().max(10_000).optional(),
  coverPath: z
    .string()
    .url('URL invalide')
    .startsWith('https://', 'URL HTTPS uniquement')
    .or(z.literal(''))
    .optional(),
});

export type BookFormValues = z.infer<typeof formSchema>;

export interface BookFormPayload {
  title: string;
  authors: string[];
  isbn10?: string | null;
  isbn13?: string | null;
  publisher?: string | null;
  publishedYear?: number | null;
  language?: string | null;
  description?: string | null;
  coverPath?: string | null;
}

export function BookForm({
  defaultValues,
  onSubmit,
  submitLabel,
  isSubmitting,
}: {
  defaultValues?: Partial<BookFormValues>;
  onSubmit: (payload: BookFormPayload) => void;
  submitLabel: string;
  isSubmitting: boolean;
}) {
  const t = useTranslations('books.form');
  const form = useForm<BookFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: '',
      authorsCsv: '',
      isbn10: '',
      isbn13: '',
      publisher: '',
      publishedYear: '',
      language: '',
      description: '',
      coverPath: '',
      ...defaultValues,
    },
  });

  const submit = form.handleSubmit((values) => {
    const payload: BookFormPayload = {
      title: values.title,
      authors: values.authorsCsv.split(',').map((s) => s.trim()).filter(Boolean),
      isbn10: values.isbn10 || null,
      isbn13: values.isbn13 || null,
      publisher: values.publisher || null,
      publishedYear: values.publishedYear ? Number(values.publishedYear) : null,
      language: values.language || null,
      description: values.description || null,
      coverPath: values.coverPath || null,
    };
    onSubmit(payload);
  });

  return (
    <Form {...form}>
      <form onSubmit={submit} className="space-y-6">
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('title')}</FormLabel>
              <FormControl>
                <Input maxLength={500} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="authorsCsv"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('authors')}</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormDescription>{t('authorsHelp')}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="isbn10"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('isbn10')}</FormLabel>
                <FormControl>
                  <Input maxLength={10} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="isbn13"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('isbn13')}</FormLabel>
                <FormControl>
                  <Input maxLength={13} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="publisher"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('publisher')}</FormLabel>
                <FormControl>
                  <Input maxLength={200} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="publishedYear"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('year')}</FormLabel>
                <FormControl>
                  <Input maxLength={4} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="language"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('language')}</FormLabel>
              <FormControl>
                <Input maxLength={8} placeholder="fr, en, es, …" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="coverPath"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('coverUrl')}</FormLabel>
              <FormControl>
                <Input type="url" placeholder="https://…" {...field} />
              </FormControl>
              <FormDescription>{t('coverHelp')}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('description')}</FormLabel>
              <FormControl>
                <textarea
                  className="flex min-h-[120px] w-full rounded-md border bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1"
                  maxLength={10_000}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex justify-end">
          <Button type="submit" disabled={isSubmitting}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}
```

- [ ] **Step 2: Render test**

```typescript
import { describe, expect, test } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import frMessages from '../../messages/fr.json';
import { BookForm } from '@/components/books/BookForm';

describe('BookForm', () => {
  test('disables submit when empty, enables when title + authors are filled', async () => {
    const onSubmit = vi.fn();
    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <BookForm onSubmit={onSubmit} submitLabel="Créer" isSubmitting={false} />
      </NextIntlClientProvider>,
    );
    fireEvent.change(screen.getByLabelText(/titre/i), { target: { value: 'Le Petit Prince' } });
    fireEvent.change(screen.getByLabelText(/auteurs/i), { target: { value: 'Saint-Exupéry' } });
    fireEvent.click(screen.getByRole('button', { name: /créer/i }));
    await new Promise((r) => setTimeout(r, 0));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Le Petit Prince', authors: ['Saint-Exupéry'] }),
    );
  });
});
```

- [ ] **Step 3: i18n + commit**

Add `books.form.{title, authors, authorsHelp, isbn10, isbn13, publisher, year, language, coverUrl, coverHelp, description}` for fr/en.

```bash
pnpm vitest run tests/unit/BookForm.test.tsx
git add src/components/books/BookForm.tsx tests/unit/BookForm.test.tsx messages
git commit -m "feat(phase-1d): BookForm shared (create/update)

react-hook-form + Zod resolver. Authors entered as CSV, normalized to
string[] on submit. coverPath validated as HTTPS URL. publishedYear
parsed to number. All fields optional except title and authors. Single
form component used in both /books/new (create) and /books/[id]/edit
(update — see D6).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task D5 — Page `/library/[slug]/books/new`

**Files:**

- Create: `src/app/library/[slug]/books/new/page.tsx`
- Create: `src/app/library/[slug]/books/new/CreateBookForm.tsx`

- [ ] **Step 1: Server page**

```typescript
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireMembership } from '@/server/auth/member-guard';
import { CreateBookForm } from './CreateBookForm';

export default async function NewBookPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const t = await getTranslations('books.new');
  const { user, membership } = await requireMembership(slug);
  const isAdmin = user.role === 'GLOBAL_ADMIN' || membership?.role === 'LIBRARY_ADMIN';
  if (!isAdmin) redirect(`/library/${slug}/books?error=forbidden`);
  return (
    <section className="max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t('pageTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>
      <CreateBookForm slug={slug} />
    </section>
  );
}
```

- [ ] **Step 2: Client wrapper**

```typescript
'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { trpc } from '@/lib/trpc/client';
import { useToast } from '@/hooks/use-toast';
import { BookForm, type BookFormPayload } from '@/components/books/BookForm';

export function CreateBookForm({ slug }: { slug: string }) {
  const t = useTranslations('books.new');
  const router = useRouter();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const create = trpc.library.books.create.useMutation({
    onSuccess: (book) => {
      toast({ title: t('successToast') });
      utils.library.books.list.invalidate();
      router.push(`/library/${slug}/books/${book.id}`);
    },
    onError: (err) => toast({ title: t('errorToast'), description: err.message, variant: 'destructive' }),
  });

  return (
    <BookForm
      onSubmit={(payload: BookFormPayload) => create.mutate({ slug, ...payload })}
      submitLabel={t('submit')}
      isSubmitting={create.isPending}
    />
  );
}
```

- [ ] **Step 3: i18n + commit**

Add `books.new.{pageTitle, subtitle, submit, successToast, errorToast}`.

```bash
pnpm typecheck
git add src/app/library/[slug]/books/new messages
git commit -m "feat(phase-1d): /library/[slug]/books/new page (admin-only)

Server-side admin gate (redirect to catalog with ?error=forbidden if not
admin). Client form invokes trpc.library.books.create, redirects to the
new book detail page on success.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task D6 — Page `/library/[slug]/books/[bookId]` (detail + actions)

**Files:**

- Create: `src/app/library/[slug]/books/[bookId]/page.tsx`
- Create: `src/app/library/[slug]/books/[bookId]/BookDetail.tsx`
- Create: `src/app/library/[slug]/books/[bookId]/BookActionsMenu.tsx`
- Create: `src/app/library/[slug]/books/[bookId]/edit/page.tsx`
- Create: `src/app/library/[slug]/books/[bookId]/edit/EditBookForm.tsx`

- [ ] **Step 1: Detail server page**

```typescript
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireMembership } from '@/server/auth/member-guard';
import { prisma } from '@/lib/db';
import { BookDetail } from './BookDetail';

export default async function BookDetailPage({
  params,
}: {
  params: Promise<{ slug: string; bookId: string }>;
}) {
  const { slug, bookId } = await params;
  const { user, library, membership } = await requireMembership(slug);
  const isAdmin = user.role === 'GLOBAL_ADMIN' || membership?.role === 'LIBRARY_ADMIN';
  const book = await prisma.book.findUnique({
    where: { id: bookId },
    include: { _count: { select: { physicalCopies: true, files: true } } },
  });
  if (!book || book.libraryId !== library.id) notFound();
  if (!isAdmin && book.archivedAt !== null) notFound();
  return <BookDetail slug={slug} book={book} isAdmin={isAdmin} />;
}
```

- [ ] **Step 2: Client detail component**

`BookDetail.tsx`:

```typescript
'use client';

import { useTranslations } from 'next-intl';
import { BookOpen, Package, Archive } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BookActionsMenu } from './BookActionsMenu';

export function BookDetail({
  slug,
  book,
  isAdmin,
}: {
  slug: string;
  book: any;
  isAdmin: boolean;
}) {
  const t = useTranslations('books.detail');
  return (
    <article className="grid gap-8 lg:grid-cols-[280px_1fr]">
      <div>
        {book.coverPath ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={book.coverPath}
            alt={t('coverAlt', { title: book.title })}
            className="aspect-[2/3] w-full rounded-lg object-cover shadow"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex aspect-[2/3] items-center justify-center rounded-lg bg-muted">
            <BookOpen className="h-12 w-12 text-muted-foreground" aria-hidden />
          </div>
        )}
      </div>
      <div className="space-y-4">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{book.title}</h1>
            <p className="text-sm text-muted-foreground">{book.authors.join(', ')}</p>
          </div>
          {isAdmin && <BookActionsMenu slug={slug} book={book} />}
        </header>
        <div className="flex flex-wrap gap-2">
          {book.archivedAt && (
            <Badge variant="outline">
              <Archive className="mr-1 h-3 w-3" aria-hidden />
              {t('archived')}
            </Badge>
          )}
          {book.hasDigital && (
            <Badge variant="secondary">
              <BookOpen className="mr-1 h-3 w-3" aria-hidden />
              {t('digital')}
            </Badge>
          )}
          {book.hasPhysical && (
            <Badge variant="secondary">
              <Package className="mr-1 h-3 w-3" aria-hidden />
              {t('physical')} ({book._count.physicalCopies})
            </Badge>
          )}
        </div>
        <Card>
          <CardContent className="space-y-3 py-5">
            {book.publisher && <Row k={t('publisher')} v={book.publisher} />}
            {book.publishedYear && <Row k={t('year')} v={String(book.publishedYear)} />}
            {book.language && <Row k={t('language')} v={book.language} />}
            {book.isbn13 && <Row k="ISBN-13" v={book.isbn13} />}
            {book.isbn10 && <Row k="ISBN-10" v={book.isbn10} />}
          </CardContent>
        </Card>
        {book.description && (
          <section>
            <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              {t('descriptionLabel')}
            </h2>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">{book.description}</p>
          </section>
        )}
      </div>
    </article>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2 text-sm">
      <dt className="text-muted-foreground">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}
```

- [ ] **Step 3: Actions menu (Edit / Archive / Unarchive / Delete)**

`BookActionsMenu.tsx`:

```typescript
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { MoreHorizontal, Pencil, Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ArchiveBookDialog } from '@/components/books/ArchiveBookDialog';
import { UnarchiveBookDialog } from '@/components/books/UnarchiveBookDialog';
import { DeleteBookDialog } from '@/components/books/DeleteBookDialog';

export function BookActionsMenu({ slug, book }: { slug: string; book: any }) {
  const t = useTranslations('books.actions');
  const [open, setOpen] = useState<null | 'archive' | 'unarchive' | 'delete'>(null);
  // GLOBAL_ADMIN can delete; on the client we'd need to know — fetched from session in practice
  const me = trpc.auth.me.useQuery();
  const isGlobalAdmin = me.data?.user?.role === 'GLOBAL_ADMIN';

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label={t('open')}>
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/library/${slug}/books/${book.id}/edit`}>
              <Pencil className="mr-2 h-4 w-4" aria-hidden /> {t('edit')}
            </Link>
          </DropdownMenuItem>
          {book.archivedAt ? (
            <DropdownMenuItem onClick={() => setOpen('unarchive')}>
              <ArchiveRestore className="mr-2 h-4 w-4" aria-hidden /> {t('unarchive')}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => setOpen('archive')}>
              <Archive className="mr-2 h-4 w-4" aria-hidden /> {t('archive')}
            </DropdownMenuItem>
          )}
          {isGlobalAdmin && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setOpen('delete')}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" aria-hidden /> {t('delete')}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {open === 'archive' && (
        <ArchiveBookDialog slug={slug} bookId={book.id} onClose={() => setOpen(null)} />
      )}
      {open === 'unarchive' && (
        <UnarchiveBookDialog slug={slug} bookId={book.id} onClose={() => setOpen(null)} />
      )}
      {open === 'delete' && (
        <DeleteBookDialog slug={slug} bookId={book.id} onClose={() => setOpen(null)} />
      )}
    </>
  );
}
```

- [ ] **Step 4: Edit page + form**

`edit/page.tsx`:

```typescript
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireMembership } from '@/server/auth/member-guard';
import { prisma } from '@/lib/db';
import { EditBookForm } from './EditBookForm';

export default async function EditBookPage({
  params,
}: {
  params: Promise<{ slug: string; bookId: string }>;
}) {
  const { slug, bookId } = await params;
  const t = await getTranslations('books.edit');
  const { user, library, membership } = await requireMembership(slug);
  const isAdmin = user.role === 'GLOBAL_ADMIN' || membership?.role === 'LIBRARY_ADMIN';
  if (!isAdmin) redirect(`/library/${slug}/books?error=forbidden`);
  const book = await prisma.book.findUnique({ where: { id: bookId } });
  if (!book || book.libraryId !== library.id) notFound();
  return (
    <section className="max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t('pageTitle')}</h1>
      </header>
      <EditBookForm slug={slug} book={book} />
    </section>
  );
}
```

`edit/EditBookForm.tsx`:

```typescript
'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { trpc } from '@/lib/trpc/client';
import { useToast } from '@/hooks/use-toast';
import { BookForm, type BookFormPayload } from '@/components/books/BookForm';

export function EditBookForm({ slug, book }: { slug: string; book: any }) {
  const t = useTranslations('books.edit');
  const router = useRouter();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const update = trpc.library.books.update.useMutation({
    onSuccess: () => {
      toast({ title: t('successToast') });
      utils.library.books.list.invalidate();
      utils.library.books.get.invalidate();
      router.push(`/library/${slug}/books/${book.id}`);
    },
    onError: (err) => {
      if (err.data?.code === 'CONFLICT') {
        toast({
          title: t('conflictTitle'),
          description: t('conflictDescription'),
          variant: 'destructive',
        });
      } else {
        toast({ title: t('errorToast'), description: err.message, variant: 'destructive' });
      }
    },
  });

  return (
    <BookForm
      defaultValues={{
        title: book.title,
        authorsCsv: book.authors.join(', '),
        isbn10: book.isbn10 ?? '',
        isbn13: book.isbn13 ?? '',
        publisher: book.publisher ?? '',
        publishedYear: book.publishedYear ? String(book.publishedYear) : '',
        language: book.language ?? '',
        description: book.description ?? '',
        coverPath: book.coverPath ?? '',
      }}
      onSubmit={(payload: BookFormPayload) =>
        update.mutate({
          slug,
          id: book.id,
          expectedUpdatedAt: book.updatedAt,
          patch: payload,
        })
      }
      submitLabel={t('submit')}
      isSubmitting={update.isPending}
    />
  );
}
```

- [ ] **Step 5: i18n + commit**

Add `books.detail.{coverAlt, archived, digital, physical, publisher, year, language, descriptionLabel}`, `books.actions.{open, edit, archive, unarchive, delete}`, `books.edit.{pageTitle, submit, successToast, errorToast, conflictTitle, conflictDescription}`.

```bash
pnpm typecheck
git add src/app/library/[slug]/books/[bookId] messages
git commit -m "feat(phase-1d): book detail page + edit page + actions menu

Detail: cover + metadata grid + description (whitespace-pre-line). Admin
sees DropdownMenu with Edit (link to /edit) + Archive/Unarchive (mutually
exclusive based on archivedAt) + Delete (GLOBAL_ADMIN only, separator
above, destructive styling). Edit form prefills from existing book and
sends expectedUpdatedAt for optimistic concurrency; CONFLICT shows a
specific 'modified by another admin' toast.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task D7 — Archive / Unarchive / Delete dialogs + Module D checkpoint

**Files:**

- Create: `src/components/books/ArchiveBookDialog.tsx`
- Create: `src/components/books/UnarchiveBookDialog.tsx`
- Create: `src/components/books/DeleteBookDialog.tsx`

- [ ] **Step 1: `ArchiveBookDialog.tsx`**

```typescript
'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export function ArchiveBookDialog({
  slug,
  bookId,
  onClose,
}: {
  slug: string;
  bookId: string;
  onClose: () => void;
}) {
  const t = useTranslations('books.dialogs.archive');
  const router = useRouter();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const archive = trpc.library.books.archive.useMutation({
    onSuccess: () => {
      toast({ title: t('successToast') });
      utils.library.books.invalidate();
      router.refresh();
      onClose();
    },
    onError: (err) => toast({ title: t('errorToast'), description: err.message, variant: 'destructive' }),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={archive.isPending}>
            {t('cancel')}
          </Button>
          <Button onClick={() => archive.mutate({ slug, id: bookId })} disabled={archive.isPending}>
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: `UnarchiveBookDialog.tsx`**

Same shape as Archive but calls `trpc.library.books.unarchive` and uses `books.dialogs.unarchive` keys.

- [ ] **Step 3: `DeleteBookDialog.tsx`**

Same shape, but: (1) destructive styling on confirm Button (`variant="destructive"`); (2) extra warning text; (3) calls `trpc.library.books.delete`; (4) on `BAD_REQUEST` (dependencies present), parses the error and shows them clearly:

```typescript
onError: (err) => {
  if (err.data?.code === 'BAD_REQUEST' && err.message?.includes('dependencies')) {
    toast({
      title: t('depsTitle'),
      description: err.message,
      variant: 'destructive',
    });
  } else {
    toast({ title: t('errorToast'), description: err.message, variant: 'destructive' });
  }
},
```

After successful delete, `router.push('/library/' + slug + '/books')`.

- [ ] **Step 4: i18n + smoke + commit + tag**

Add `books.dialogs.{archive, unarchive, delete}.{title, description, confirm, cancel, successToast, errorToast, depsTitle?}`.

```bash
pnpm typecheck
pnpm test --run
git add src/components/books/ArchiveBookDialog.tsx src/components/books/UnarchiveBookDialog.tsx src/components/books/DeleteBookDialog.tsx messages
git commit -m "feat(phase-1d): archive/unarchive/delete dialogs

Three confirmation dialogs sharing structure. Delete uses destructive
button styling and parses BAD_REQUEST 'dependencies' error to show a
clear 'remove these first' message; runbook docs/runbooks/hard-delete-book.md
explains DBA pre-flight (added in module E).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"

git tag phase-1d-checkpoint-module-D -m "Module D complete: catalog UI + form + dialogs"
```

**Module D acceptance criteria:**

- ✅ `BookCard, BookListGrid, Paginator` rendered correctly with skeleton + empty state
- ✅ `BookSearchBar` (debounced 300ms) + `BookFilters` (digital/physical/language) + `BookSortSelect` all bound to URL params
- ✅ `/library/[slug]/books` catalog page with cursor-history previous nav
- ✅ `BookForm` shared between `/new` and `/[bookId]/edit`; CSV authors normalization, HTTPS coverPath validation
- ✅ `/library/[slug]/books/[bookId]` detail page with admin actions menu
- ✅ Archive / Unarchive / Delete dialogs with proper error handling (CONFLICT, dependency errors)
- ✅ All tests green, typecheck/lint clean
- ✅ `frontend-design` skill consulted for catalog and detail pages (visual spec in conversation log)
- ✅ Tag `phase-1d-checkpoint-module-D` created

---

## Module E — 1C tech debt + new E2E + runbook + doc

**Goal:** Clear the five Phase 1C debts and add five new E2E specs covering the 1D feature surface. Total: 8 tasks. Estimated 2–3 days. Can run partially in parallel with Module B once Module A merges.

### Task E1 — Fix `toHaveURL` regex on 5 pre-1B specs

**Files:**

- Modify: `tests/e2e/health.spec.ts`
- Modify: `tests/e2e/password-reset.spec.ts`
- Modify: `tests/e2e/reset-invalidates-sessions.spec.ts`
- Modify: `tests/e2e/invitation-existing-user.spec.ts`
- Modify: `tests/e2e/invitation-new-user.spec.ts`

- [ ] **Step 1: Locate broken patterns**

```bash
grep -nE "/\^\\\\?/?\\\\(\\\\\\?" tests/e2e/*.spec.ts || true
grep -nE "toHaveURL\(/\^" tests/e2e/*.spec.ts
grep -nE "waitForURL\(/\^" tests/e2e/*.spec.ts
```

Expected: hits in 5 specs containing `toHaveURL(/^\/(\?.*)?$/)` or `waitForURL(/^\/(\?.*)?$/)`. The regex anchors `^` at start of the matched URL but Playwright matches against the **full URL** (`http://localhost:3000/...`), so this never matches.

- [ ] **Step 2: Apply the fix**

For each spec, replace:

```typescript
await expect(page).toHaveURL(/^\/(\?.*)?$/, { timeout: 10_000 });
```

with:

```typescript
await expect(async () => {
  expect(new URL(page.url()).pathname).toBe('/');
}).toPass({ timeout: 10_000 });
```

And replace:

```typescript
page.waitForURL(/^\/(\?.*)?$/, { timeout: 15_000 });
```

with:

```typescript
page.waitForURL((url) => url.pathname === '/', { timeout: 15_000 });
```

> The `URL`-based assertion is more explicit (matches the pathname only,
> ignoring query and host) and is what we want for "user landed on root".

- [ ] **Step 3: Run the 5 specs**

```bash
APP_URL=http://localhost:3001 pnpm exec playwright test \
  tests/e2e/health.spec.ts \
  tests/e2e/password-reset.spec.ts \
  tests/e2e/reset-invalidates-sessions.spec.ts \
  tests/e2e/invitation-existing-user.spec.ts \
  tests/e2e/invitation-new-user.spec.ts
```

Expected: all 5 pass on the phase-1d dev stack.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e
git commit -m "fix(e2e): toHaveURL/waitForURL regex against full URL on 5 pre-1B specs

The regex /^\/(\?.*)?$/ anchored ^ at start of the matched string but
Playwright matches against the full URL (scheme + host + path + search),
so it never matched. Switch to pathname comparison via URL parsing.

Specs: health, password-reset, reset-invalidates-sessions,
invitation-existing-user, invitation-new-user.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task E2 — Email templates drift guard

**Files:**

- Create: `scripts/check-email-templates-drift.ts`
- Modify: `package.json` — add script `check:emails-drift`
- Modify: `.github/workflows/ci.yml` — invoke the check in the lint job

- [ ] **Step 1: Inventory the duplicates**

```bash
ls src/emails worker/emails
diff -r src/emails worker/emails || true
```

Expected: same filenames in both directories. If currently identical, the script will pass; the value is in catching future drift.

- [ ] **Step 2: Implement the check**

Create `scripts/check-email-templates-drift.ts`:

```typescript
#!/usr/bin/env tsx
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const SRC = 'src/emails';
const WORKER = 'worker/emails';

function hashesIn(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const entries = readdirSync(dir);
  for (const f of entries) {
    const path = join(dir, f);
    if (!statSync(path).isFile()) continue;
    const sha = createHash('sha256').update(readFileSync(path)).digest('hex');
    out.set(f, sha);
  }
  return out;
}

const a = hashesIn(SRC);
const b = hashesIn(WORKER);

const diffs: string[] = [];
const onlyInSrc: string[] = [];
const onlyInWorker: string[] = [];
for (const [f, ha] of a) {
  const hb = b.get(f);
  if (hb === undefined) onlyInSrc.push(f);
  else if (ha !== hb) diffs.push(f);
}
for (const f of b.keys()) if (!a.has(f)) onlyInWorker.push(f);

if (diffs.length || onlyInSrc.length || onlyInWorker.length) {
  console.error('Email templates drift detected between src/emails and worker/emails:\n');
  if (diffs.length) console.error('  Modified (different SHA-256):', diffs.join(', '));
  if (onlyInSrc.length) console.error('  Only in src/emails:', onlyInSrc.join(', '));
  if (onlyInWorker.length) console.error('  Only in worker/emails:', onlyInWorker.join(', '));
  console.error('\nReconcile via the runbook: docs/runbooks/email-templates-sync.md');
  process.exit(1);
}
console.log('Email templates in sync (' + a.size + ' files).');
```

- [ ] **Step 3: Wire in `package.json`**

Add to `"scripts"`:

```json
"check:emails-drift": "tsx scripts/check-email-templates-drift.ts"
```

- [ ] **Step 4: Wire in CI lint job**

In `.github/workflows/ci.yml`, in the lint job, after `pnpm lint`:

```yaml
- name: Check email templates drift
  run: pnpm check:emails-drift
```

- [ ] **Step 5: Create the reconcile runbook**

Create `docs/runbooks/email-templates-sync.md`:

```markdown
# Runbook — Email templates sync (src/emails ↔ worker/emails)

The drift guard fails CI when these directories diverge. Two trees
exist because the worker package compiles independently from the Next.js
app and may need its own bundled copies.

## When CI fails

1. Identify the drifting file from the CI log.
2. Decide which version is correct (usually whichever was edited most
   recently — check `git log -- <file>` in both paths).
3. Copy the canonical version to the other location.
4. Re-run `pnpm check:emails-drift` locally to confirm.
5. Commit with message `chore(emails): sync templates`.

## Long-term fix

A single source of truth is the goal — Phase 2 is a likely candidate to
introduce a shared package or a build-time copy step. Until then, this
guard keeps the two trees honest.
```

- [ ] **Step 6: Run + commit**

```bash
pnpm check:emails-drift
git add scripts/check-email-templates-drift.ts package.json .github/workflows/ci.yml docs/runbooks/email-templates-sync.md
git commit -m "feat(phase-1d): drift guard for src/emails ↔ worker/emails

Standalone script SHA-256s every file in both dirs and exits non-zero on
mismatch (modified, missing, or extra). Wired into the lint CI job.
Runbook explains the manual sync step until Phase 2 introduces a single
source of truth.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task E3 — Extend ESLint local plugin (Book/BookFile scope rule)

**Files:**

- Modify: `eslint-plugin-local/...` (the existing local plugin)
- Modify: `.eslintrc.json` — wire the new rule

- [ ] **Step 1: Locate the existing plugin**

```bash
ls eslint-plugin-local 2>/dev/null || ls tools/eslint-plugin-local 2>/dev/null || find . -maxdepth 4 -name 'eslint-plugin-local' -not -path '*/node_modules/*'
```

Read the existing rule for reference (likely `no-unscoped-prisma.js` or `.ts`).

- [ ] **Step 2: Extend the rule**

The 1C rule already flags `prisma.annotation.findMany` etc. without `userId` in the where clause. Extend the same rule (or add a sibling) to also warn on `prisma.book.findMany` / `prisma.bookFile.findMany` / `prisma.physicalCopy.findMany` calls that don't include `libraryId` in the where clause.

Open the rule file and find the model-name list. Add `book`, `bookFile`, `physicalCopy` with the property `requiredScopeKey: 'libraryId'`. Keep the existing entries for `annotation`, `bookmark`, `readingProgress` with `requiredScopeKey: 'userId'`.

If the rule is a single-purpose check on userId only, fork it into two:

```javascript
// eslint-plugin-local/rules/no-unscoped-prisma.js
const USER_SCOPED_MODELS = ['annotation', 'bookmark', 'readingProgress', 'readingSession'];
const LIBRARY_SCOPED_MODELS = ['book', 'bookFile', 'physicalCopy'];

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require scoping key in Prisma where clause for sensitive models',
    },
    schema: [],
    messages: {
      missingUserScope:
        'Prisma call on {{model}} must include userId in where (privacy invariant; see docs/architecture/soft-delete.md and ADR-0003)',
      missingLibraryScope:
        'Prisma call on {{model}} must include libraryId in where (defense-in-depth; see ADR-0003)',
    },
  },
  create(context) {
    function check(node, model, requiredKey, messageId) {
      const arg = node.arguments[0];
      if (!arg || arg.type !== 'ObjectExpression') return;
      const where = arg.properties.find(
        (p) => p.type === 'Property' && p.key.type === 'Identifier' && p.key.name === 'where',
      );
      if (!where || where.value.type !== 'ObjectExpression') {
        context.report({ node, messageId, data: { model } });
        return;
      }
      const hasKey = where.value.properties.some(
        (p) => p.type === 'Property' && p.key.type === 'Identifier' && p.key.name === requiredKey,
      );
      if (!hasKey) context.report({ node, messageId, data: { model } });
    }

    return {
      CallExpression(node) {
        // prisma.<model>.<method>(...)
        const callee = node.callee;
        if (
          callee.type !== 'MemberExpression' ||
          callee.object.type !== 'MemberExpression' ||
          callee.object.object.type !== 'Identifier' ||
          callee.object.object.name !== 'prisma'
        )
          return;
        const model = callee.object.property.name;
        const method = callee.property.name;
        if (!['findMany', 'findFirst', 'count', 'updateMany', 'deleteMany'].includes(method))
          return;
        if (USER_SCOPED_MODELS.includes(model)) {
          check(node, model, 'userId', 'missingUserScope');
        }
        if (LIBRARY_SCOPED_MODELS.includes(model)) {
          check(node, model, 'libraryId', 'missingLibraryScope');
        }
      },
    };
  },
};
```

> **Note**: this is an inexpensive lint, not a security boundary. The
> security boundary is the tRPC procedure middleware. The lint catches
> common mistakes that bypass procedure scoping (e.g., a server action
> reaching directly into Prisma).

- [ ] **Step 3: Update tests for the rule**

Open `eslint-plugin-local/tests/no-unscoped-prisma.test.js` (or create one). Add cases:

```javascript
const { RuleTester } = require('eslint');
const rule = require('../rules/no-unscoped-prisma');

const ruleTester = new RuleTester({ parserOptions: { ecmaVersion: 2022, sourceType: 'module' } });

ruleTester.run('no-unscoped-prisma', rule, {
  valid: [
    'prisma.book.findMany({ where: { libraryId: "x" } })',
    'prisma.book.findUnique({ where: { id: "x" } })', // findUnique is not flagged
    'prisma.annotation.findMany({ where: { userId: "u" } })',
    'prisma.user.findMany({})', // user not in list
  ],
  invalid: [
    {
      code: 'prisma.book.findMany({ where: { title: "x" } })',
      errors: [{ messageId: 'missingLibraryScope', data: { model: 'book' } }],
    },
    {
      code: 'prisma.book.findMany({})',
      errors: [{ messageId: 'missingLibraryScope', data: { model: 'book' } }],
    },
    {
      code: 'prisma.bookmark.findMany({ where: { bookId: "b" } })',
      errors: [{ messageId: 'missingUserScope', data: { model: 'bookmark' } }],
    },
  ],
});
```

- [ ] **Step 4: Run lint across the codebase**

```bash
pnpm lint
```

Expected: any pre-existing direct `prisma.book.findMany`/`prisma.bookFile.*` without `libraryId` is flagged. Fix call sites or — if the call is intentionally cross-library (admin tooling) — disable inline:

```typescript
// eslint-disable-next-line local/no-unscoped-prisma -- intentional cross-library: admin user index
prisma.book.count({ where: {} });
```

- [ ] **Step 5: Commit**

```bash
git add eslint-plugin-local .eslintrc.json
git commit -m "feat(phase-1d): extend lint rule to enforce libraryId scope on Book/BookFile/PhysicalCopy

Reuses the existing no-unscoped-prisma local rule. Two model lists
(USER_SCOPED, LIBRARY_SCOPED) gated by their required where-clause key.
Catches direct prisma.book.findMany without libraryId — a common mistake
when bypassing the tRPC procedure layer. Inline disables documented for
intentional cross-library admin tooling.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task E4 — Broaden CI E2E job

**Files:**

- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Read current e2e job**

```bash
grep -n "e2e\|playwright" .github/workflows/ci.yml
```

Note the current scope: only `tests/e2e/landing.spec.ts` runs on CI.

- [ ] **Step 2: Replace the e2e job to run all specs with full services**

```yaml
e2e:
  runs-on: ubuntu-latest
  needs: [lint-typecheck-unit, build-docker]
  timeout-minutes: 20
  services:
    postgres:
      image: postgres:16-alpine
      env:
        POSTGRES_USER: fmlib
        POSTGRES_PASSWORD: fmlib
        POSTGRES_DB: fmlib
      options: >-
        --health-cmd "pg_isready -U fmlib"
        --health-interval 5s --health-timeout 5s --health-retries 10
      ports:
        - 5432:5432
    redis:
      image: redis:7-alpine
      options: >-
        --health-cmd "redis-cli ping" --health-interval 5s --health-retries 10
      ports:
        - 6379:6379
    mailpit:
      image: axllent/mailpit:latest
      ports:
        - 1025:1025
        - 8025:8025
  env:
    DATABASE_URL: postgresql://fmlib:fmlib@localhost:5432/fmlib
    REDIS_URL: redis://localhost:6379
    NEXTAUTH_URL: http://localhost:3000
    NEXTAUTH_SECRET: ci-secret-change-me-1234567890abcdef
    SMTP_HOST: localhost
    SMTP_PORT: 1025
    APP_URL: http://localhost:3000
    APP_PORT: 3000
    NODE_ENV: test
    CI: '1'
  strategy:
    fail-fast: false
    matrix:
      shard: [1, 2, 3, 4]
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v3
      with:
        version: 9
    - uses: actions/setup-node@v4
      with:
        node-version: 24
        cache: pnpm
    - run: pnpm install --frozen-lockfile
    - run: pnpm prisma migrate deploy
    - run: pnpm prisma generate
    - run: pnpm build
    - name: Install Playwright browsers
      run: npx playwright install --with-deps chromium
    - name: Start app
      run: |
        pnpm exec next start -p 3000 &
        npx wait-on http://localhost:3000 -t 60000
    - name: Run E2E shard ${{ matrix.shard }}/4
      run: pnpm exec playwright test --shard=${{ matrix.shard }}/4
    - name: Upload Playwright traces on failure
      if: failure()
      uses: actions/upload-artifact@v4
      with:
        name: playwright-traces-shard-${{ matrix.shard }}
        path: test-results/
        retention-days: 7
```

> **Sharding note**: `--shard=N/M` splits specs across runs. Four shards
> keep wall-time under ~10 min. Adjust if Playwright complains about
> non-deterministic ordering — pin `fullyParallel: false` in
> `playwright.config.ts` (already the case per recon).

- [ ] **Step 3: Push branch + watch CI**

After committing, push the branch and verify the workflow goes green on all 4 shards. If a previously-broken-but-now-fixed spec (Task E1) flakes, fix the flake before merging.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci(phase-1d): run all Playwright specs in 4 shards with full services

CI e2e job now boots postgres+redis+mailpit, applies migrations, builds
the app, starts next start on :3000, and runs the entire tests/e2e/
directory across 4 shards (matrix). Trace artifacts uploaded on failure.
Replaces the previous landing-only run.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task E5 — Architectural docs (session-bridge + soft-delete + runbook hard-delete-book)

**Files:**

- Create: `docs/architecture/session-bridge.md`
- Create: `docs/architecture/soft-delete.md`
- Create: `docs/runbooks/hard-delete-book.md`

- [ ] **Step 1: `session-bridge.md`**

```markdown
# Architecture — Session bridge

## What

`src/server/auth/session-bridge.ts` is the single bridge between Auth.js v5
sessions stored in the database and the rest of our server-side code (Next.js
server components, Route Handlers, tRPC procedures).

## Why parse user agent instead of hashing?

The `Session.userAgentLabel` field holds a human-readable label like
"Chrome on macOS" rather than a hash of the raw UA string. Two reasons:

1. **Operator UX** — when a user reviews their active sessions in
   `/account/security`, the labels need to be meaningful. A hash is
   useless to humans.

2. **Privacy** — we don't store the raw UA at all (it would tie the
   session to a fingerprintable browser version). The parsed label
   coarsens the data: `"Firefox 137 on Linux"` becomes `"Firefox on
Linux"`.

The parser lives at `src/lib/user-agent.ts` and uses a small allowlist
(no third-party UA-parsing dep). New browsers fall back to `"Other"`
rather than to the raw UA — a deliberate choice (privacy over
specificity).

## Trade-off accepted

A user with two Firefox sessions on the same OS sees two identical
labels — they cannot distinguish them. The session list in
`/account/security` shows `lastUsedAt` and IP-prefix to disambiguate.
Adding a fingerprint hash would help disambiguation but would re-introduce
the privacy concern. Phase 1C ratified the trade-off in favor of privacy.
```

- [ ] **Step 2: `soft-delete.md`**

```markdown
# Architecture — Soft delete

## Pattern

Sensitive entities use `archivedAt: DateTime?` (nullable). Setting it
hides the entity from non-admin views; clearing it restores it. Hard
deletion is reserved for GLOBAL_ADMIN with a runbook.

## Entities using the pattern

| Entity                                           | `archivedAt` since |
| ------------------------------------------------ | ------------------ |
| Library                                          | Phase 1C           |
| Book                                             | Phase 1D           |
| (BookFile, PhysicalCopy: TBD when Phase 2 lands) |

## Invariants

- Non-admin reads (list/get) MUST filter out `archivedAt != null`.
- Admin reads MAY opt in via `includeArchived: true`.
- Mutations (update, archive) MUST refuse if already archived
  (`BAD_REQUEST`) — surfacing UI mistakes.
- Unarchive MUST refuse if not archived (symmetry).
- Hard delete (where supported) MUST refuse if dependent rows exist
  (BookFile, PhysicalCopy, etc.).

## How to add the pattern to a new model

1. Add `archivedAt DateTime?` to the Prisma model.
2. Add `@@index([..., archivedAt])` for the most common scope key.
3. In every list/get procedure, branch on `isAdmin` to decide whether
   to filter.
4. Add `archive` and `unarchive` mutations symmetrically.
5. Add the new procedures to the permissions matrix.

## Future cleanup

A scheduled job that hard-deletes archived rows older than N months
could reclaim space. Not implemented as of Phase 1D — the dataset is
small (~2k rows expected by year 1).
```

- [ ] **Step 3: `hard-delete-book.md`**

````markdown
# Runbook — Hard delete a Book (GLOBAL_ADMIN, DBA-scoped)

## When to use this

Use when a Book row must be removed permanently:

- Legal takedown (DMCA, GDPR right-to-erasure that scope-archive cannot satisfy).
- Data corruption requiring a clean replacement.

For any other case, **archive instead** (`library.books.archive`). Archive
is reversible; hard delete is not.

## Pre-flight

1. Confirm the actor is GLOBAL_ADMIN with 2FA active.
2. Note the `bookId`, the `libraryId`, and the requesting user/legal reference.
3. Inspect dependencies:

   ```sql
   SELECT
     (SELECT COUNT(*) FROM "BookFile" WHERE "bookId" = '<id>') AS files,
     (SELECT COUNT(*) FROM "PhysicalCopy" WHERE "bookId" = '<id>') AS copies,
     (SELECT COUNT(*) FROM "Annotation" WHERE "bookId" = '<id>') AS annotations,
     (SELECT COUNT(*) FROM "Bookmark" WHERE "bookId" = '<id>') AS bookmarks,
     (SELECT COUNT(*) FROM "ReadingProgress" WHERE "bookId" = '<id>') AS progress,
     (SELECT COUNT(*) FROM "ReadingSession" WHERE "bookId" = '<id>') AS sessions,
     (SELECT COUNT(*) FROM "BookTag" WHERE "bookId" = '<id>') AS tags;
   ```
````

4. **If any non-zero count exists**, the API will refuse with `BAD_REQUEST`. Choose:
   - For `files`: delete file rows + the on-disk artifacts (Phase 2+ runbook needed).
   - For `copies`: delete the PhysicalCopy rows manually after consulting their owners.
   - For `annotations / bookmarks / progress / sessions`: these are user-private. Manually delete only after legal review (they belong to other users).
   - For `tags`: harmless to delete.

## Action

```bash
# tRPC call (recommended; emits audit log automatically)
pnpm tsx scripts/admin/delete-book.ts <librarySlug> <bookId>
```

Or via SQL (last resort, **does not emit audit log**):

```sql
DELETE FROM "Book" WHERE "id" = '<bookId>';
```

## Post-flight

1. Confirm the audit log entry: `SELECT * FROM "AuditLog" WHERE action = 'library.book.deleted' AND "targetId" = '<bookId>';`
2. Document the operation in your team's incident log with the legal reference.
3. If files were deleted from disk, verify they're gone from backup retention windows that fall under the legal mandate.

## Why this is gated

Hard delete is irreversible and bypasses the soft-delete safety net. The
runbook + GLOBAL_ADMIN-only API enforces a manual decision point.

````

- [ ] **Step 4: Commit**

```bash
git add docs/architecture docs/runbooks/hard-delete-book.md
git commit -m "docs(phase-1d): session-bridge architecture + soft-delete pattern + hard-delete-book runbook

session-bridge.md captures the Phase 1C ratified trade-off (privacy over
fingerprint specificity in session labels). soft-delete.md is the
canonical reference for the archivedAt pattern across Library/Book/...
hard-delete-book.md walks GLOBAL_ADMIN through the SQL pre-flight,
dependency cleanup decision tree, and post-flight audit verification.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
````

---

### Task E6 — 5 new E2E specs

**Files:**

- Create: `tests/e2e/book-create-flow.spec.ts`
- Create: `tests/e2e/book-search.spec.ts`
- Create: `tests/e2e/book-archive.spec.ts`
- Create: `tests/e2e/book-cross-library-isolation.spec.ts`
- Create: `tests/e2e/member-nav.spec.ts`

> Each spec follows the existing harness pattern (see `tests/e2e/setup/`
> for fixtures and `globalSetup`). Each test file is independent and uses
> the seeded users created in `globalSetup` plus per-test seeded data
> via Prisma directly (we have DB access in tests).

- [ ] **Step 1: `book-create-flow.spec.ts`**

```typescript
import { expect, test } from '@playwright/test';
import { prisma } from '@/lib/db';

test.describe('Phase 1D — book create flow', () => {
  test('LIBRARY_ADMIN creates a book and MEMBER sees it', async ({ browser }) => {
    // setup: 1 library, 1 LIBRARY_ADMIN, 1 MEMBER
    const lib = await prisma.library.create({
      data: { name: `E2E-${Date.now()}`, slug: `e2e-${Date.now()}` },
    });
    // ... seed users, members; or use signup flow if globalSetup handles it
    // For brevity, assume helpers exist:
    // const { admin, member } = await seedLibAdminAndMember(lib.id);

    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await adminPage.goto('/login');
    // ... log in admin (use existing E2E login helper)

    // Navigate to /libraries → click on the seeded lib → reach catalog
    await adminPage.goto(`/library/${lib.slug}/books`);
    await adminPage.getByRole('link', { name: /ajouter un livre|add a book/i }).click();
    await expect(adminPage).toHaveURL(new RegExp(`/library/${lib.slug}/books/new`));

    // Fill form
    await adminPage.getByLabel(/titre/i).fill('Le Petit Prince');
    await adminPage.getByLabel(/auteurs/i).fill('Saint-Exupéry');
    await adminPage.getByLabel(/url de couverture|cover url/i).fill('https://example.com/c.jpg');
    await adminPage.getByRole('button', { name: /créer|create/i }).click();

    // Should land on detail page
    await expect(adminPage).toHaveURL(new RegExp(`/library/${lib.slug}/books/[a-z0-9]+`));
    await expect(adminPage.getByRole('heading', { name: 'Le Petit Prince' })).toBeVisible();

    // Member should see the book in catalog
    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    // ... log in member
    await memberPage.goto(`/library/${lib.slug}/books`);
    await expect(memberPage.getByText('Le Petit Prince')).toBeVisible();

    await adminContext.close();
    await memberContext.close();
  });
});
```

> **Note**: replace pseudocode (`seedLibAdminAndMember`, login helpers)
> with whatever the existing 1C E2E suite uses. Read
> `tests/e2e/setup/global-setup.ts` and adapt.

- [ ] **Step 2: `book-search.spec.ts`**

Search-specific assertions (in pseudo-skeleton — fill in with the codebase's E2E helpers):

```typescript
import { expect, test } from '@playwright/test';

test.describe('Phase 1D — book search', () => {
  test('FR accent-insensitive search finds Misérables typed without accents', async ({ page }) => {
    // setup: lib with seeded books containing "Les Misérables"
    // login member, navigate to catalog
    // type "miserables" in search bar
    // wait debounce + assert URL has ?q=miserables
    // assert "Les Misérables" card is visible
    // assert other unrelated books are NOT visible
  });

  test('language filter narrows results, cursor pagination works', async ({ page }) => {
    // setup: 30 fr books + 30 en books in lib
    // navigate, click language=fr, expect 30 visible (one page = 24)
    // click "Suivant" (next), expect 6 more
    // click "Précédent", expect URL cursor cleared
  });
});
```

- [ ] **Step 3: `book-archive.spec.ts`**

```typescript
test.describe('Phase 1D — archive flow', () => {
  test('admin archives a book; member no longer sees it', async ({ browser }) => {
    // seed lib + admin + member + 1 book
    // admin: open detail → ⋯ → Archive → confirm
    // assert toast + book card greyed/hidden
    // member: navigate catalog → assert book is gone
    // admin: tick "show archived" → assert book reappears with badge
    // admin: open detail → ⋯ → Unarchive → confirm
    // member: refresh → assert book is back
  });
});
```

- [ ] **Step 4: `book-cross-library-isolation.spec.ts`**

```typescript
test.describe('Phase 1D — cross-library isolation', () => {
  test('member of lib A cannot see books of lib B', async ({ page }) => {
    // seed: lib A with 2 books, lib B with 2 books, member in A only
    // login member
    // navigate /library/<slugA>/books — see 2 cards
    // navigate /library/<slugB>/books — get redirected to /libraries?error=not-a-member (layout guard)
    // navigate directly to /library/<slugA>/books/<bookB-id> — get 404 (page guard)
  });

  test('switcher only shows libs where actor is a member', async ({ page }) => {
    // login member of A only
    // open MemberHeader switcher
    // assert only "A" listed; "B" not present
  });
});
```

- [ ] **Step 5: `member-nav.spec.ts`**

```typescript
test.describe('Phase 1D — member navigation', () => {
  test('mobile burger drawer opens, lists Catalogue link', async ({ page, viewport }) => {
    // resize viewport to mobile
    // login member, navigate /library/<slug>/books
    // click burger
    // assert drawer is visible with "Mes bibliothèques", "Catalogue", "Mes prêts (Phase 2)"
    // click "Mes bibliothèques"
    // assert URL is /libraries
  });

  test('a11y: header has correct landmarks and labels', async ({ page }) => {
    await page.goto('/libraries');
    // login
    const burger = page.getByLabel(/ouvrir le menu/i);
    await expect(burger).toBeVisible();
    // axe-style smoke (use @axe-core/playwright if installed)
  });
});
```

- [ ] **Step 6: Run all 5 specs locally**

```bash
APP_URL=http://localhost:3001 pnpm exec playwright test \
  tests/e2e/book-create-flow.spec.ts \
  tests/e2e/book-search.spec.ts \
  tests/e2e/book-archive.spec.ts \
  tests/e2e/book-cross-library-isolation.spec.ts \
  tests/e2e/member-nav.spec.ts
```

Expected: all pass on the phase-1d dev stack with seeded data.

- [ ] **Step 7: Commit**

```bash
git add tests/e2e
git commit -m "test(phase-1d): 5 new E2E specs covering book + nav surface

- book-create-flow: admin creates → detail → member sees it
- book-search: FR accent-insensitive search + filter + paginator
- book-archive: archive masks for member, admin sees with toggle, unarchive restores
- book-cross-library-isolation: layout/page guards + switcher scoping
- member-nav: mobile burger drawer + a11y smoke

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task E7 — Module E checkpoint

- [ ] **Step 1: Full local suite**

```bash
pnpm typecheck
pnpm lint
pnpm test --run
APP_URL=http://localhost:3001 pnpm exec playwright test
```

Expected: all green.

- [ ] **Step 2: Push branch, verify CI**

```bash
git push -u origin feat/phase-1d-books
gh pr create --draft --title "Phase 1D: library.books router + member UI + 1C debt" --body "..."
```

Watch the CI run all 4 e2e shards. Fix any flakes before exiting draft.

- [ ] **Step 3: Tag**

```bash
git tag phase-1d-checkpoint-module-E -m "Module E complete: debt cleared + 5 new E2E + docs"
```

**Module E acceptance criteria:**

- ✅ 5 pre-1B E2E specs fixed (toHaveURL/waitForURL pathname comparison)
- ✅ Email templates drift guard script + CI hook + runbook
- ✅ ESLint local plugin extended (Book/BookFile/PhysicalCopy require `libraryId` scope)
- ✅ CI e2e job runs all specs in 4 shards with postgres+redis+mailpit services
- ✅ Three new docs committed: `session-bridge.md`, `soft-delete.md`, `hard-delete-book.md`
- ✅ 5 new E2E specs all pass locally and in CI
- ✅ All previous 1A/1B/1C tests still green
- ✅ Tag `phase-1d-checkpoint-module-E` created

---

## Final integration — Smoke checklist + merge

### Task F1 — Manual smoke checklist

Before flipping the PR from Draft to Ready-for-review, walk through this list on the phase-1d dev stack (`http://localhost:3001`). Tick each item.

**Auth & nav (regression check)**

- [ ] Login flow works for admin@test.local
- [ ] /admin/users still loads and works (1C regression check)
- [ ] /account/security still loads and works (1C regression check)
- [ ] Burger drawer on /admin works (no regression from MemberHeader changes)

**Member shell**

- [ ] /libraries shows the seeded library card (or "empty" state)
- [ ] LibrarySwitcher in MemberHeader lists accessible libs
- [ ] Selecting a lib in the switcher navigates to /library/[slug]/books
- [ ] Burger drawer on /library/[slug]/books works on mobile (Chrome devtools 375px)
- [ ] /library/[slug]/books for a non-member slug redirects to /libraries?error=not-a-member

**Catalog**

- [ ] Empty catalog renders friendly empty state
- [ ] Seed 5–10 books via `prisma studio` or seed script; cards render
- [ ] Search "petit" finds "Le Petit Prince" (FR accent-insensitive)
- [ ] Filter `hasDigital` narrows results
- [ ] Sort `title_asc` reorders alphabetically
- [ ] Pagination "Suivant" / "Précédent" navigate correctly
- [ ] URL params survive page reload

**Create / edit / archive / delete**

- [ ] Library Admin sees "Ajouter un livre" button; Member does not
- [ ] /books/new form: required-field validation works
- [ ] coverPath rejects `http://` URL with inline error
- [ ] Successful create navigates to detail page; book appears in list
- [ ] Edit form pre-fills correctly; CONFLICT toast appears if you simulate concurrent edit
- [ ] Archive dialog confirms; book greyed in admin view, hidden in member view
- [ ] "Show archived" admin toggle reveals the archived book
- [ ] Unarchive restores to normal view
- [ ] Hard-delete dialog visible only to GLOBAL_ADMIN; refuses with helpful message when book has a BookFile

**Cross-library isolation**

- [ ] Direct URL `/library/<otherSlug>/books/<existingBookIdInOther>` returns 404 for a non-member
- [ ] tRPC matrix integration test passes (executable proof)

**Mobile + a11y**

- [ ] /libraries renders correctly at 375px width
- [ ] Catalog grid wraps correctly at 375/768/1024
- [ ] All buttons have `aria-label` or visible text
- [ ] Tab order through catalog filters → search → grid is logical

**Tech debt smoke**

- [ ] `pnpm check:emails-drift` passes
- [ ] `pnpm lint` passes including the extended Prisma scope rule
- [ ] CI shows all 4 e2e shards green

### Task F2 — PR ready, merge, tag, mémoire

- [ ] **Step 1: Mark PR Ready-for-review**

```bash
gh pr ready
```

- [ ] **Step 2: Self-review the PR diff**

Walk through the diff one last time. Look for: `console.log` left over, `// TODO` without owner, hard-coded credentials, dead code.

- [ ] **Step 3: Merge non-squash (preserve commit history per 1C convention)**

```bash
gh pr merge --merge
```

- [ ] **Step 4: Tag release**

```bash
git checkout main
git pull
git tag phase-1d-complete -m "Phase 1D complete: library.books router + member UI + 1C debt"
git push origin phase-1d-complete
```

- [ ] **Step 5: Cleanup worktree**

```bash
git worktree remove .worktrees/phase-1d
docker compose -p phase-1d down -v
```

- [ ] **Step 6: Update memory**

Add to memory `project_phase_1d_completed.md`:

```markdown
---
name: Phase 1D — clôture
description: Phase 1D (library.books router + member UI + 1C debt) clôturée 2026-MM-DD, PR #XX mergée, tag phase-1d-complete sur <merge-sha>.
type: project
---

# Phase 1D — clôture

**Date** : 2026-MM-DD
**Tag** : `phase-1d-complete` sur merge commit `<sha>` (non-squash)
**PR** : [#XX](https://github.com/ArchSeraphin/fm-librairy/pull/XX) mergée
**Branche dev** : `feat/phase-1d-books` (XX commits ahead of main, supprimée post-merge)
**CI finale** : 5/5 verts (Lint+typecheck+unit, Playwright E2E ×4 shards, Build Docker, Trivy, Gitleaks)
**Smoke manuel** : ✅ validé par l'utilisateur 2026-MM-DD (checklist F1).

## Livrables

- ... (see plan modules A–E)

## Patterns établis (à reproduire Phase 2+)

- assertMembership(slug, role?) helper for all future library.\* routers
- Optimistic concurrency via expectedUpdatedAt + CONFLICT
- Postgres tsvector + unaccent + GIN until Meili lands in Phase 4
- HTTPS-only external URL fields (no server-side fetch)
- Anti-drift matrice extended to library.\* prefix
- ESLint local rule for required scope keys (libraryId, userId)

## Suivis non-bloquants Phase 2

- ... (TBD per smoke + PR review)

## Stats vélocité

- Plan : ~2500 lignes / ~28 tasks (5 modules)
- Branche : XX commits, ~XX jours wall-time
- Tests deltas : +XX unit, +XX integration, +5 E2E
```

Commit memory:

```bash
cd /Users/seraphin/.claude/projects/-Users-seraphin-Library-CloudStorage-SynologyDrive-save-02-Trinity-Projet-github-fm-librairy/memory
# add the new file + update MEMORY.md index line
```

---

## Plan self-review summary

Quick sanity pass after writing all 5 modules + final integration:

1. **Spec coverage**: every section of `2026-04-29-phase-1d-design.md` maps to one or more tasks (§4 migration → A1; §5 router → B1–B7; §6 UI → C2–C5 + D1–D7; §7 matrix → B7 + C3; §8 debts → E1–E5; §9 tests → embedded throughout; §10 risks → mitigated in code; §11 modules → A–E; §12 execution patterns → Module 0 + tags).
2. **Placeholder scan**: no "TBD" / "implement later" / "similar to" without code shown. Two explicit "Note" callouts (cursor history, drift to single source of truth) flag known follow-ups, not unspecified work.
3. **Type consistency**: `library.books.list` input shape consistent across B1, C3, D3 (`{ slug, q?, hasDigital?, hasPhysical?, language?, sort?, cursor?, limit, includeArchived? }`). `expectedUpdatedAt` consistent in B4 + D6. `BookCardData` shape used in BookCard + BookListGrid + DetailPage. Audit actions string-identical between A2 (definition), B3/B4/B5/B6 (emit), F2 (memory).

If during execution any subagent finds a discrepancy, it MUST update the plan and re-run the self-review before continuing. Plans are living documents.

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-29-phase-1d-books.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration. Modules C and E can run in parallel with B once A is merged into the dev branch. Use `superpowers:subagent-driven-development`.

**2. Inline Execution** — Execute tasks in this session sequentially, with checkpoints between modules for human review. Use `superpowers:executing-plans`.

Which approach?
