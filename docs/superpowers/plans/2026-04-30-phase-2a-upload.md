# Phase 2A' — Upload pipeline + ClamAV + dédup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a secure file-upload pipeline that lets a `canUpload` library member attach EPUB/PDF/TXT/DOCX files (≤100 MB) to existing books, with magic-byte MIME validation, per-library SHA-256 deduplication, and async ClamAV scanning via worker.

**Architecture:** Server Action receives FormData → streams to staging path while computing SHA-256 → magic-byte check → dedup query → INSERT BookFile (status PENDING) → enqueue BullMQ `scan-file` job. Worker picks up job → ClamAV INSTREAM scan → CLEAN: move staging→final + UPDATE; INFECTED: rm + UPDATE + AuditLog SECURITY; ERROR: retry 3× then DLQ.

**Tech Stack:** Next.js 15 Server Actions, Prisma 6 (Postgres 16), BullMQ + Redis 7, ClamAV 1.4 via `clamscan` npm package (already installed), `file-type` npm package, `rate-limiter-flexible` (already used).

**Spec:** [`docs/superpowers/specs/2026-04-30-phase-2a-upload-design.md`](../specs/2026-04-30-phase-2a-upload-design.md)

---

## Pre-flight

Worktree convention from Phase 1D: each module merges back to a single feature branch `feat/phase-2a-upload`, then one final non-squash merge to `main` at module 2A'.4 close.

Before starting work :

- Branch is `feat/phase-2a-upload-design` (currently holds the spec). Either rename to `feat/phase-2a-upload` or branch off it. Final PR title : `feat(phase-2a): upload pipeline + ClamAV + dedup`.
- Clamav 1.4 + Redis 7 must be running locally for integration/E2E tests : `docker compose up -d clamav redis pg`.

## File Structure

**New files:**

```
src/lib/upload/
  storage-paths.ts        # path helpers, traversal-proof
  sha256-stream.ts        # Transform stream computing SHA-256 + byteCount
  mime-validator.ts       # file-type wrapper, returns {format, mimeType}
  staging-io.ts           # orchestrator: writeToStaging(stream)
src/server/trpc/routers/library/files.ts   # get + delete procedures
src/app/library/[slug]/books/[bookId]/upload/actions.ts  # uploadBookFile Server Action
src/components/books/BookFileUpload.tsx     # client form
src/components/books/ScanStatusBadge.tsx    # status display
worker/lib/clamav.ts                        # clamscan wrapper
worker/jobs/scan-file.ts                    # BullMQ handler
prisma/migrations/<ts>_phase_2a_book_file_library_unique/migration.sql
tests/unit/upload/storage-paths.test.ts
tests/unit/upload/sha256-stream.test.ts
tests/unit/upload/mime-validator.test.ts
tests/unit/upload/staging-io.test.ts
tests/integration/scan-file-job.test.ts
tests/integration/upload-action.test.ts
tests/integration/upload-action-attacks.test.ts
tests/integration/library-files-router.test.ts
tests/e2e/book-upload.spec.ts
tests/attacks/upload.test.ts
tests/fixtures/upload/                      # tiny valid EPUB/PDF/TXT/DOCX + EICAR + spoofed exe
```

**Modified files:**

```
prisma/schema.prisma              # BookFile.libraryId + @@unique([libraryId, sha256])
docker-compose.yml                # library_data volume on app + worker
.env.example                      # STORAGE_ROOT
worker/index.ts                   # register scan queue + scan-file job
src/lib/rate-limit.ts             # libraryFileUploadLimiter, libraryFileDeleteLimiter
src/server/trpc/routers/library/index.ts   # mount files router
src/app/library/[slug]/books/[bookId]/page.tsx   # show upload zone or file status
src/components/books/BookCard.tsx          # show ScanStatusBadge
tests/integration/permissions-matrix.test.ts    # extend with library.files.*
docs/permissions-matrix.md        # extend matrix
```

---

## Module 2A'.0 — Infra + Schema

### Task 0.1 — Add shared `library_data` Docker volume

**Files:**

- Modify: `docker-compose.yml`

- [ ] **Step 1: Add volume declaration**

In the `volumes:` block at bottom of `docker-compose.yml`, add `library_data:` alongside existing volumes (`pg_data`, `redis_data`, `meili_data`, `clamav_db`).

- [ ] **Step 2: Mount on `app` service**

Find the `app:` service block. Under its `volumes:` section, add :

```yaml
- library_data:/data
```

- [ ] **Step 3: Mount on `worker` service**

Find the `worker:` service block. Under its `volumes:` section (create if missing), add the same line :

```yaml
- library_data:/data
```

- [ ] **Step 4: Verify config**

Run: `docker compose config --quiet`
Expected: no errors. Run `docker compose config | grep -A 2 library_data` and verify the volume appears under both services.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml
git commit -m "infra(phase-2a): add shared library_data volume between app and worker"
```

### Task 0.2 — Add `STORAGE_ROOT` env var

**Files:**

- Modify: `.env.example`
- Modify: `src/lib/env.ts` (add to schema)
- Modify: `worker/index.ts` (add to worker env schema)

- [ ] **Step 1: Update `.env.example`**

Add at the bottom :

```
# Phase 2A' — Library file storage (shared volume on app + worker)
STORAGE_ROOT=/data
```

- [ ] **Step 2: Add to app env schema (`src/lib/env.ts`)**

Find the Zod schema and add :

```ts
STORAGE_ROOT: z.string().min(1).default('/data'),
```

- [ ] **Step 3: Add to worker env schema (`worker/index.ts`)**

In the `z.object({...})` at top, add the same line as step 2.

- [ ] **Step 4: Verify**

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .env.example src/lib/env.ts worker/index.ts
git commit -m "feat(phase-2a): add STORAGE_ROOT env var to app and worker"
```

### Task 0.3 — Prisma migration: BookFile.libraryId + unique constraint

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_phase_2a_book_file_library_unique/migration.sql`

- [ ] **Step 1: Edit `prisma/schema.prisma`**

In the `BookFile` model, add the `libraryId` field and relation, then the `@@unique` line at the bottom of the model :

```prisma
model BookFile {
  id            String     @id @default(cuid())
  bookId        String
  book          Book       @relation(fields: [bookId], references: [id], onDelete: Cascade)
  libraryId     String                                            // NEW
  library       Library    @relation(fields: [libraryId], references: [id], onDelete: Cascade)  // NEW
  format        BookFormat
  isOriginal    Boolean
  storagePath   String
  fileSizeBytes BigInt
  sha256        String
  mimeType      String
  scanStatus    ScanStatus @default(PENDING)
  scannedAt     DateTime?
  indexedAt     DateTime?
  createdAt     DateTime   @default(now())

  downloadLogs  DownloadLog[]

  @@unique([bookId, format])
  @@unique([libraryId, sha256])      // NEW
  @@index([sha256])
}
```

In the `Library` model, add the back-relation alongside existing ones :

```prisma
  books       Book[]
  bookFiles   BookFile[]   // NEW
```

- [ ] **Step 2: Generate migration**

Run :

```bash
pnpm prisma migrate dev --name phase_2a_book_file_library_unique --create-only
```

Expected : creates `prisma/migrations/<timestamp>_phase_2a_book_file_library_unique/migration.sql` but does not apply it.

- [ ] **Step 3: Replace generated SQL with safe backfill**

Open the generated `migration.sql` and **replace** its content entirely with :

```sql
-- Add libraryId nullable, backfill from Book, set NOT NULL, add FK + unique
ALTER TABLE "BookFile" ADD COLUMN "libraryId" TEXT;

UPDATE "BookFile" bf
SET "libraryId" = b."libraryId"
FROM "Book" b
WHERE bf."bookId" = b.id;

ALTER TABLE "BookFile" ALTER COLUMN "libraryId" SET NOT NULL;

ALTER TABLE "BookFile"
  ADD CONSTRAINT "BookFile_libraryId_fkey"
  FOREIGN KEY ("libraryId") REFERENCES "Library"(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX "BookFile_libraryId_sha256_key"
  ON "BookFile"("libraryId", "sha256");

CREATE INDEX "BookFile_libraryId_idx" ON "BookFile"("libraryId");
```

- [ ] **Step 4: Apply migration**

```bash
pnpm prisma migrate dev
pnpm prisma generate
```

Expected : both succeed. Verify with `pnpm typecheck`.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(phase-2a): BookFile.libraryId + per-library sha256 unique constraint"
```

---

### Task 0.4 — Extend audit types for BookFile actions

`AuditLog.action` is a `String` column gated by a TypeScript union in `src/lib/audit-log.ts` — no Prisma migration needed, just type extension. Same for `AuditTargetType`.

**Files:**

- Modify: `src/lib/audit-log.ts`

- [ ] **Step 1: Add `BOOK_FILE` to `AuditTargetType`**

```ts
export type AuditTargetType =
  | 'USER'
  | 'LIBRARY'
  | 'INVITATION'
  | 'SESSION'
  | 'EMAIL'
  | 'AUTH'
  | 'MEMBER'
  | 'BOOK'
  | 'BOOK_FILE'; // NEW
```

- [ ] **Step 2: Add three actions to `AuditAction` union**

In the same file, append :

```ts
  // 2A' — book file lifecycle
  | 'library.book_file.uploaded'
  | 'library.book_file.infected'
  | 'library.book_file.deleted'
```

- [ ] **Step 3: Verify**

```bash
pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/audit-log.ts
git commit -m "feat(phase-2a): extend AuditAction + AuditTargetType for BookFile lifecycle"
```

---

## Module 2A'.1 — Pure libs (TDD)

### Task 1.1 — `storage-paths.ts` (paths + traversal protection)

**Files:**

- Create: `src/lib/upload/storage-paths.ts`
- Test: `tests/unit/upload/storage-paths.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/upload/storage-paths.test.ts
import { describe, it, expect } from 'vitest';
import { stagingPath, finalPath, assertUnderRoot } from '@/lib/upload/storage-paths';

const ROOT = '/tmp/biblio-test';

describe('stagingPath', () => {
  it('returns /tmp/biblio-test/staging/<sha>.<ext>', () => {
    expect(stagingPath(ROOT, 'abc123', 'epub')).toBe('/tmp/biblio-test/staging/abc123.epub');
  });
});

describe('finalPath', () => {
  it('returns /tmp/biblio-test/library/<libId>/<bookId>/<sha>.<ext>', () => {
    expect(finalPath(ROOT, 'libX', 'bookY', 'abc123', 'pdf')).toBe(
      '/tmp/biblio-test/library/libX/bookY/abc123.pdf',
    );
  });
});

describe('assertUnderRoot', () => {
  it('passes when path is inside root', () => {
    expect(() => assertUnderRoot(ROOT, '/tmp/biblio-test/staging/x.epub')).not.toThrow();
  });
  it('throws on path traversal via ..', () => {
    expect(() => assertUnderRoot(ROOT, '/tmp/biblio-test/../etc/passwd')).toThrow(/PATH_TRAVERSAL/);
  });
  it('throws when path escapes root entirely', () => {
    expect(() => assertUnderRoot(ROOT, '/etc/passwd')).toThrow(/PATH_TRAVERSAL/);
  });
});
```

- [ ] **Step 2: Run tests, confirm fail**

```bash
pnpm vitest run tests/unit/upload/storage-paths.test.ts
```

Expected : FAIL with `Cannot find module '@/lib/upload/storage-paths'`.

- [ ] **Step 3: Implement minimal**

```ts
// src/lib/upload/storage-paths.ts
import path from 'node:path';

export function stagingPath(root: string, sha256: string, ext: string): string {
  return path.join(root, 'staging', `${sha256}.${ext}`);
}

export function finalPath(
  root: string,
  libraryId: string,
  bookId: string,
  sha256: string,
  ext: string,
): string {
  return path.join(root, 'library', libraryId, bookId, `${sha256}.${ext}`);
}

export function assertUnderRoot(root: string, candidate: string): void {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    throw new Error(`PATH_TRAVERSAL: ${candidate} escapes ${root}`);
  }
}
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
pnpm vitest run tests/unit/upload/storage-paths.test.ts
```

Expected : 4/4 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/upload/storage-paths.ts tests/unit/upload/storage-paths.test.ts
git commit -m "feat(phase-2a): storage-paths with traversal-proof assertUnderRoot"
```

### Task 1.2 — `sha256-stream.ts` (Transform stream)

**Files:**

- Create: `src/lib/upload/sha256-stream.ts`
- Test: `tests/unit/upload/sha256-stream.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/upload/sha256-stream.test.ts
import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { createSha256Hasher } from '@/lib/upload/sha256-stream';

describe('createSha256Hasher', () => {
  it('hashes empty stream → SHA-256("") and counts 0 bytes', async () => {
    const hasher = createSha256Hasher();
    await new Promise((resolve, reject) => {
      Readable.from([]).pipe(hasher).on('finish', resolve).on('error', reject);
    });
    const r = hasher.result();
    expect(r.bytesWritten).toBe(0);
    expect(r.sha256).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('hashes "hello" correctly and counts bytes', async () => {
    const hasher = createSha256Hasher();
    await new Promise((resolve, reject) => {
      Readable.from(['hello']).pipe(hasher).on('finish', resolve).on('error', reject);
    });
    const r = hasher.result();
    expect(r.bytesWritten).toBe(5);
    expect(r.sha256).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('throws when result() called before stream end', () => {
    const hasher = createSha256Hasher();
    expect(() => hasher.result()).toThrow(/not finalized/i);
  });
});
```

- [ ] **Step 2: Run tests, confirm fail**

```bash
pnpm vitest run tests/unit/upload/sha256-stream.test.ts
```

Expected : FAIL.

- [ ] **Step 3: Implement minimal**

```ts
// src/lib/upload/sha256-stream.ts
import { Transform, type TransformCallback } from 'node:stream';
import { createHash, type Hash } from 'node:crypto';

export interface Sha256Result {
  sha256: string;
  bytesWritten: number;
}

export interface Sha256Hasher extends Transform {
  result(): Sha256Result;
}

export function createSha256Hasher(): Sha256Hasher {
  const hash: Hash = createHash('sha256');
  let bytesWritten = 0;
  let finalized = false;
  let digest = '';

  const stream = new Transform({
    transform(chunk: Buffer, _enc: string, cb: TransformCallback) {
      hash.update(chunk);
      bytesWritten += chunk.length;
      cb(null, chunk);
    },
    flush(cb: TransformCallback) {
      digest = hash.digest('hex');
      finalized = true;
      cb();
    },
  }) as Sha256Hasher;

  stream.result = () => {
    if (!finalized) throw new Error('sha256-stream: not finalized — call after stream end');
    return { sha256: digest, bytesWritten };
  };

  return stream;
}
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
pnpm vitest run tests/unit/upload/sha256-stream.test.ts
```

Expected : 3/3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/upload/sha256-stream.ts tests/unit/upload/sha256-stream.test.ts
git commit -m "feat(phase-2a): streaming SHA-256 hasher with byte counter"
```

### Task 1.3 — `mime-validator.ts` (`file-type` wrapper)

**Files:**

- Create: `src/lib/upload/mime-validator.ts`
- Test: `tests/unit/upload/mime-validator.test.ts`
- Create test fixtures: `tests/fixtures/upload/{tiny.epub,tiny.pdf,tiny.txt,tiny.docx,fake.pdf}`

- [ ] **Step 1: Add `file-type` dependency**

```bash
pnpm add file-type
```

- [ ] **Step 2: Create fixtures**

Create `tests/fixtures/upload/`. Build minimal valid files:

```bash
mkdir -p tests/fixtures/upload

# tiny.txt — plain ASCII
echo "BiblioShare test fixture." > tests/fixtures/upload/tiny.txt

# tiny.pdf — minimal valid PDF (header + EOF)
printf '%%PDF-1.4\n%%%%EOF\n' > tests/fixtures/upload/tiny.pdf

# tiny.epub — needs to be a real ZIP with mimetype = application/epub+zip
# Build it via node script:
node -e "
const { mkdirSync, writeFileSync } = require('fs');
const { execSync } = require('child_process');
const dir = 'tests/fixtures/upload/.epub-build';
mkdirSync(dir, { recursive: true });
writeFileSync(dir + '/mimetype', 'application/epub+zip');
mkdirSync(dir + '/META-INF', { recursive: true });
writeFileSync(dir + '/META-INF/container.xml', '<?xml version=\"1.0\"?><container/>');
process.chdir(dir);
execSync('zip -X0q ../tiny.epub mimetype && zip -Xrq9 ../tiny.epub META-INF');
"
rm -rf tests/fixtures/upload/.epub-build

# tiny.docx — minimal ZIP with [Content_Types].xml (file-type detects via OOXML signature)
node -e "
const { mkdirSync, writeFileSync } = require('fs');
const { execSync } = require('child_process');
const dir = 'tests/fixtures/upload/.docx-build';
mkdirSync(dir, { recursive: true });
writeFileSync(dir + '/[Content_Types].xml', '<?xml version=\"1.0\"?><Types/>');
process.chdir(dir);
execSync('zip -Xrq9 ../tiny.docx [Content_Types].xml');
"
rm -rf tests/fixtures/upload/.docx-build

# fake.pdf — Windows PE (MZ) header bytes, renamed .pdf
printf '\x4d\x5a\x90\x00\x03\x00\x00\x00\x04\x00' > tests/fixtures/upload/fake.pdf
```

Verify they exist :

```bash
ls -la tests/fixtures/upload/
```

Expected : tiny.epub, tiny.pdf, tiny.txt, tiny.docx, fake.pdf all present (non-zero size).

- [ ] **Step 3: Write failing tests**

```ts
// tests/unit/upload/mime-validator.test.ts
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { validateMime } from '@/lib/upload/mime-validator';

const fixture = (name: string) => path.join(process.cwd(), 'tests/fixtures/upload', name);

describe('validateMime', () => {
  it('accepts EPUB → BookFormat.EPUB', async () => {
    const buf = await readFile(fixture('tiny.epub'));
    const r = await validateMime(buf, 'tiny.epub');
    expect(r.format).toBe('EPUB');
    expect(r.mimeType).toBe('application/epub+zip');
  });
  it('accepts PDF → BookFormat.PDF', async () => {
    const buf = await readFile(fixture('tiny.pdf'));
    const r = await validateMime(buf, 'tiny.pdf');
    expect(r.format).toBe('PDF');
    expect(r.mimeType).toBe('application/pdf');
  });
  it('accepts TXT (UTF-8 text) → BookFormat.TXT', async () => {
    const buf = await readFile(fixture('tiny.txt'));
    const r = await validateMime(buf, 'tiny.txt');
    expect(r.format).toBe('TXT');
    expect(r.mimeType).toBe('text/plain');
  });
  it('accepts DOCX → BookFormat.DOCX', async () => {
    const buf = await readFile(fixture('tiny.docx'));
    const r = await validateMime(buf, 'tiny.docx');
    expect(r.format).toBe('DOCX');
    expect(r.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });
  it('rejects spoofed PE binary renamed .pdf', async () => {
    const buf = await readFile(fixture('fake.pdf'));
    await expect(validateMime(buf, 'fake.pdf')).rejects.toThrow(/INVALID_MIME/);
  });
  it('rejects empty buffer', async () => {
    await expect(validateMime(Buffer.alloc(0), 'empty.epub')).rejects.toThrow(/INVALID_MIME/);
  });
});
```

- [ ] **Step 4: Run tests, confirm fail**

```bash
pnpm vitest run tests/unit/upload/mime-validator.test.ts
```

Expected : FAIL.

- [ ] **Step 5: Implement**

```ts
// src/lib/upload/mime-validator.ts
import { fileTypeFromBuffer } from 'file-type';
import type { BookFormat } from '@prisma/client';

export interface MimeResult {
  format: BookFormat;
  mimeType: string;
}

const EXT_TO_FORMAT: Record<string, { format: BookFormat; mimeType: string }> = {
  epub: { format: 'EPUB', mimeType: 'application/epub+zip' },
  pdf: { format: 'PDF', mimeType: 'application/pdf' },
  docx: {
    format: 'DOCX',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
};

function isLikelyText(buf: Buffer): boolean {
  if (buf.length === 0) return false;
  const sample = buf.subarray(0, Math.min(buf.length, 512));
  for (const b of sample) {
    if (b === 0) return false;
    if (b < 0x09 || (b > 0x0d && b < 0x20 && b !== 0x1b)) return false;
  }
  // Reject ASCII-only that happens to start with PE magic bytes via UTF-8 fallback
  return true;
}

export async function validateMime(buf: Buffer, filename: string): Promise<MimeResult> {
  if (buf.length === 0) throw new Error('INVALID_MIME: empty buffer');

  const detected = await fileTypeFromBuffer(buf);

  if (detected) {
    const mapped = EXT_TO_FORMAT[detected.ext];
    if (mapped && mapped.mimeType === detected.mime) return mapped;
    throw new Error(`INVALID_MIME: detected ${detected.mime} (${detected.ext}) not in whitelist`);
  }

  // file-type returns undefined for plain text. Heuristic: filename .txt + valid UTF-8/ASCII.
  if (filename.toLowerCase().endsWith('.txt') && isLikelyText(buf)) {
    return { format: 'TXT', mimeType: 'text/plain' };
  }

  throw new Error('INVALID_MIME: unrecognized format');
}
```

- [ ] **Step 6: Run tests, confirm pass**

```bash
pnpm vitest run tests/unit/upload/mime-validator.test.ts
```

Expected : 6/6 PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/upload/mime-validator.ts tests/unit/upload/mime-validator.test.ts tests/fixtures/upload/ package.json pnpm-lock.yaml
git commit -m "feat(phase-2a): magic-byte MIME validator with whitelist (EPUB/PDF/TXT/DOCX)"
```

### Task 1.4 — `staging-io.ts` (orchestrator)

**Files:**

- Create: `src/lib/upload/staging-io.ts`
- Test: `tests/unit/upload/staging-io.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/upload/staging-io.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { writeToStaging } from '@/lib/upload/staging-io';

let tmpRoot: string;
beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), 'biblio-staging-'));
});
afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('writeToStaging', () => {
  it('writes EPUB to staging path keyed by SHA, returns metadata', async () => {
    // Prepare a real EPUB fixture buffer (use tiny.epub from fixtures)
    const fs = await import('node:fs/promises');
    const buf = await fs.readFile(path.join(process.cwd(), 'tests/fixtures/upload/tiny.epub'));
    const stream = Readable.from(buf);

    const result = await writeToStaging({ root: tmpRoot, stream, filename: 'tiny.epub' });

    expect(result.format).toBe('EPUB');
    expect(result.mimeType).toBe('application/epub+zip');
    expect(result.bytesWritten).toBe(buf.length);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.stagingPath).toBe(path.join(tmpRoot, 'staging', `${result.sha256}.epub`));
    expect(existsSync(result.stagingPath)).toBe(true);
    expect(readFileSync(result.stagingPath)).toEqual(buf);
  });

  it('throws and removes staging file on INVALID_MIME', async () => {
    const fs = await import('node:fs/promises');
    const buf = await fs.readFile(path.join(process.cwd(), 'tests/fixtures/upload/fake.pdf'));
    const stream = Readable.from(buf);

    await expect(writeToStaging({ root: tmpRoot, stream, filename: 'fake.pdf' })).rejects.toThrow(
      /INVALID_MIME/,
    );

    // staging dir should be empty (file cleaned up)
    const fsSync = await import('node:fs');
    const stagingDir = path.join(tmpRoot, 'staging');
    if (fsSync.existsSync(stagingDir)) {
      expect(fsSync.readdirSync(stagingDir)).toEqual([]);
    }
  });

  it('throws OVERSIZE if bytesWritten > maxBytes', async () => {
    const big = Buffer.alloc(1024, 0x41); // 1 KB of 'A'
    const stream = Readable.from(big);
    await expect(
      writeToStaging({ root: tmpRoot, stream, filename: 'big.txt', maxBytes: 100 }),
    ).rejects.toThrow(/OVERSIZE/);
  });
});
```

- [ ] **Step 2: Run tests, confirm fail**

```bash
pnpm vitest run tests/unit/upload/staging-io.test.ts
```

Expected : FAIL.

- [ ] **Step 3: Implement**

```ts
// src/lib/upload/staging-io.ts
import { mkdir, rename, unlink, rm, readFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { createSha256Hasher } from './sha256-stream';
import { validateMime } from './mime-validator';
import { stagingPath, assertUnderRoot } from './storage-paths';
import type { BookFormat } from '@prisma/client';

const FORMAT_TO_EXT: Record<BookFormat, string> = {
  EPUB: 'epub',
  PDF: 'pdf',
  TXT: 'txt',
  DOCX: 'docx',
};

export interface StagingResult {
  sha256: string;
  bytesWritten: number;
  format: BookFormat;
  mimeType: string;
  stagingPath: string;
}

export interface WriteToStagingArgs {
  root: string;
  stream: Readable;
  filename: string;
  maxBytes?: number;
}

const DEFAULT_MAX = 100 * 1024 * 1024;

export async function writeToStaging(args: WriteToStagingArgs): Promise<StagingResult> {
  const max = args.maxBytes ?? DEFAULT_MAX;
  const stagingDir = path.join(args.root, 'staging');
  await mkdir(stagingDir, { recursive: true });

  const tmpName = `.tmp-${randomBytes(16).toString('hex')}`;
  const tmpFile = path.join(stagingDir, tmpName);
  assertUnderRoot(args.root, tmpFile);

  const hasher = createSha256Hasher();
  let aborted = false;
  hasher.on('data', () => {
    if (hasher.result === undefined) return;
  });

  // Enforce maxBytes by inspecting bytes through hasher
  const sizeGuard = (() => {
    let total = 0;
    return (chunk: Buffer): void => {
      total += chunk.length;
      if (total > max) {
        aborted = true;
        throw new Error(`OVERSIZE: > ${max} bytes`);
      }
    };
  })();

  hasher.on('data', sizeGuard);

  try {
    await pipeline(args.stream, hasher, createWriteStream(tmpFile));
  } catch (err) {
    await rm(tmpFile, { force: true });
    if (aborted) throw new Error('OVERSIZE');
    throw err;
  }

  const { sha256, bytesWritten } = hasher.result();

  // Validate MIME from on-disk content (read first 64KB is enough for file-type)
  const head = await readFile(tmpFile);
  let mime;
  try {
    mime = await validateMime(head.subarray(0, Math.min(head.length, 64 * 1024)), args.filename);
  } catch (err) {
    await rm(tmpFile, { force: true });
    throw err;
  }

  const ext = FORMAT_TO_EXT[mime.format];
  const finalStaging = stagingPath(args.root, sha256, ext);
  assertUnderRoot(args.root, finalStaging);

  await rename(tmpFile, finalStaging);

  return {
    sha256,
    bytesWritten,
    format: mime.format,
    mimeType: mime.mimeType,
    stagingPath: finalStaging,
  };
}
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
pnpm vitest run tests/unit/upload/staging-io.test.ts
```

Expected : 3/3 PASS.

- [ ] **Step 5: Run all upload unit tests together**

```bash
pnpm vitest run tests/unit/upload/
```

Expected : all green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/upload/staging-io.ts tests/unit/upload/staging-io.test.ts
git commit -m "feat(phase-2a): staging-io orchestrator with size cap and cleanup-on-error"
```

---

## Module 2A'.2 — Worker ClamAV scan job

### Task 2.1 — ClamAV INSTREAM client wrapper

**Files:**

- Create: `worker/lib/clamav.ts`
- Test: `tests/integration/clamav-client.test.ts` (real ClamAV daemon — needs `docker compose up -d clamav`)

- [ ] **Step 1: Write failing tests**

```ts
// tests/integration/clamav-client.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scanFile, ScanVerdict } from '../../worker/lib/clamav';

const HOST = process.env.CLAMAV_HOST ?? 'localhost';
const PORT = Number(process.env.CLAMAV_PORT ?? 3310);

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

let cleanFile: string;
let infectedFile: string;

beforeAll(() => {
  const dir = path.join(tmpdir(), `biblio-clamav-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  cleanFile = path.join(dir, 'clean.txt');
  infectedFile = path.join(dir, 'eicar.txt');
  writeFileSync(cleanFile, 'BiblioShare test — clean file.');
  writeFileSync(infectedFile, EICAR);
});

describe('scanFile', () => {
  it('returns CLEAN for benign file', async () => {
    const r = await scanFile(cleanFile, { host: HOST, port: PORT });
    expect(r.verdict).toBe<ScanVerdict>('CLEAN');
  });

  it('returns INFECTED with virus name for EICAR', async () => {
    const r = await scanFile(infectedFile, { host: HOST, port: PORT });
    expect(r.verdict).toBe<ScanVerdict>('INFECTED');
    expect(r.virusName).toMatch(/EICAR/i);
  });
});
```

- [ ] **Step 2: Run tests, confirm fail**

```bash
docker compose up -d clamav  # if not already running
# wait ~30s for ClamAV to load DB on first start (check `docker compose logs clamav`)
pnpm vitest run --config vitest.integration.config.ts tests/integration/clamav-client.test.ts
```

Expected : FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// worker/lib/clamav.ts
import NodeClam from 'clamscan';
import type { Logger } from 'pino';

export type ScanVerdict = 'CLEAN' | 'INFECTED' | 'ERROR';

export interface ScanResult {
  verdict: ScanVerdict;
  virusName?: string;
  errorMessage?: string;
}

export interface ScanOptions {
  host: string;
  port: number;
  timeoutMs?: number;
}

export async function scanFile(
  filePath: string,
  opts: ScanOptions,
  logger?: Logger,
): Promise<ScanResult> {
  try {
    const clam = await new NodeClam().init({
      removeInfected: false,
      clamdscan: {
        host: opts.host,
        port: opts.port,
        timeout: opts.timeoutMs ?? 60_000,
        localFallback: false,
      },
    });
    const result = await clam.scanFile(filePath);
    if (result.isInfected) {
      return {
        verdict: 'INFECTED',
        virusName: (result.viruses ?? ['UNKNOWN']).join(','),
      };
    }
    return { verdict: 'CLEAN' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger?.error({ err, filePath }, 'clamav scan error');
    return { verdict: 'ERROR', errorMessage: message };
  }
}
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
pnpm vitest run --config vitest.integration.config.ts tests/integration/clamav-client.test.ts
```

Expected : 2/2 PASS. (If "ClamAV connection refused", wait longer for daemon to load DB.)

- [ ] **Step 5: Commit**

```bash
git add worker/lib/clamav.ts tests/integration/clamav-client.test.ts
git commit -m "feat(phase-2a): ClamAV INSTREAM scanner wrapper using clamscan package"
```

### Task 2.2 — `scan-file` BullMQ job handler

**Files:**

- Create: `worker/jobs/scan-file.ts`
- Test: `tests/integration/scan-file-job.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/integration/scan-file-job.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { handleScanFile } from '../../worker/jobs/scan-file';

const prisma = new PrismaClient();
const logger = pino({ level: 'silent' });
const HOST = process.env.CLAMAV_HOST ?? 'localhost';
const PORT = Number(process.env.CLAMAV_PORT ?? 3310);

let storageRoot: string;
let library: { id: string };
let book: { id: string };

beforeEach(async () => {
  storageRoot = path.join(tmpdir(), `biblio-scan-test-${Date.now()}-${Math.random()}`);
  mkdirSync(path.join(storageRoot, 'staging'), { recursive: true });

  library = await prisma.library.create({
    data: { name: 'ScanTest', slug: `scan-test-${Date.now()}` },
  });
  book = await prisma.book.create({
    data: { libraryId: library.id, title: 'T', authors: ['A'] },
  });
});

afterEach(async () => {
  await prisma.bookFile.deleteMany({ where: { libraryId: library.id } });
  await prisma.book.deleteMany({ where: { libraryId: library.id } });
  await prisma.library.delete({ where: { id: library.id } });
  rmSync(storageRoot, { recursive: true, force: true });
});

describe('handleScanFile', () => {
  it('CLEAN: moves staging→final, sets scanStatus=CLEAN, updates storagePath', async () => {
    const stagingPath = path.join(storageRoot, 'staging', 'abc.epub');
    writeFileSync(stagingPath, 'BiblioShare clean test.');
    const bf = await prisma.bookFile.create({
      data: {
        bookId: book.id,
        libraryId: library.id,
        format: 'EPUB',
        isOriginal: true,
        storagePath: stagingPath,
        fileSizeBytes: BigInt(20),
        sha256: 'abc',
        mimeType: 'application/epub+zip',
        scanStatus: 'PENDING',
      },
    });

    await handleScanFile({ id: 'job1', data: { bookFileId: bf.id, storageRoot } } as any, {
      prisma,
      logger,
      clamavHost: HOST,
      clamavPort: PORT,
    });

    const updated = await prisma.bookFile.findUniqueOrThrow({ where: { id: bf.id } });
    expect(updated.scanStatus).toBe('CLEAN');
    expect(updated.scannedAt).toBeInstanceOf(Date);
    expect(updated.storagePath).toBe(
      path.join(storageRoot, 'library', library.id, book.id, 'abc.epub'),
    );
    expect(existsSync(updated.storagePath)).toBe(true);
    expect(existsSync(stagingPath)).toBe(false);
  });

  it('INFECTED: removes staging, sets scanStatus=INFECTED, writes AuditLog', async () => {
    const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
    const stagingPath = path.join(storageRoot, 'staging', 'evil.epub');
    writeFileSync(stagingPath, EICAR);
    const bf = await prisma.bookFile.create({
      data: {
        bookId: book.id,
        libraryId: library.id,
        format: 'EPUB',
        isOriginal: true,
        storagePath: stagingPath,
        fileSizeBytes: BigInt(EICAR.length),
        sha256: 'evil',
        mimeType: 'application/epub+zip',
        scanStatus: 'PENDING',
      },
    });

    await handleScanFile({ id: 'job2', data: { bookFileId: bf.id, storageRoot } } as any, {
      prisma,
      logger,
      clamavHost: HOST,
      clamavPort: PORT,
    });

    const updated = await prisma.bookFile.findUniqueOrThrow({ where: { id: bf.id } });
    expect(updated.scanStatus).toBe('INFECTED');
    expect(existsSync(stagingPath)).toBe(false);

    const audit = await prisma.auditLog.findFirst({
      where: { targetId: bf.id, action: 'library.book_file.infected' },
    });
    expect(audit).not.toBeNull();
    expect(audit!.targetType).toBe('BOOK_FILE');
  });

  it('ERROR: missing staging file → scanStatus=ERROR (let BullMQ retry)', async () => {
    const bf = await prisma.bookFile.create({
      data: {
        bookId: book.id,
        libraryId: library.id,
        format: 'EPUB',
        isOriginal: true,
        storagePath: path.join(storageRoot, 'staging', 'nonexistent.epub'),
        fileSizeBytes: BigInt(0),
        sha256: 'noexist',
        mimeType: 'application/epub+zip',
        scanStatus: 'PENDING',
      },
    });

    await expect(
      handleScanFile({ id: 'job3', data: { bookFileId: bf.id, storageRoot } } as any, {
        prisma,
        logger,
        clamavHost: HOST,
        clamavPort: PORT,
      }),
    ).rejects.toThrow();

    const updated = await prisma.bookFile.findUniqueOrThrow({ where: { id: bf.id } });
    expect(updated.scanStatus).toBe('ERROR');
  });
});
```

- [ ] **Step 2: Run tests, confirm fail**

```bash
docker compose up -d clamav redis pg
pnpm vitest run --config vitest.integration.config.ts tests/integration/scan-file-job.test.ts
```

Expected : FAIL.

- [ ] **Step 3: Implement scan-file job**

(Audit types already extended in Task 0.4. `AuditLog` has no `severity` column — actions like `'library.book_file.infected'` are themselves the security signal, surfaced via grep on action strings.)

```ts
// worker/jobs/scan-file.ts
import type { Job } from 'bullmq';
import type { Logger } from 'pino';
import type { PrismaClient } from '@prisma/client';
import { rm, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { scanFile } from '../lib/clamav.js';
import { finalPath, assertUnderRoot } from '../../src/lib/upload/storage-paths.js';
import { recordAudit } from '../../src/lib/audit-log.js';

export interface ScanFileDeps {
  prisma: PrismaClient;
  logger: Logger;
  clamavHost: string;
  clamavPort: number;
}

const FORMAT_TO_EXT = { EPUB: 'epub', PDF: 'pdf', TXT: 'txt', DOCX: 'docx' } as const;

export async function handleScanFile(
  job: Job<{ bookFileId: string; storageRoot: string }>,
  deps: ScanFileDeps,
): Promise<void> {
  const { bookFileId, storageRoot } = job.data;
  const { prisma, logger, clamavHost, clamavPort } = deps;

  const bf = await prisma.bookFile.findUnique({ where: { id: bookFileId } });
  if (!bf) {
    logger.warn({ bookFileId }, 'scan-file: BookFile vanished, skipping');
    return;
  }

  if (bf.scanStatus !== 'PENDING') {
    logger.info({ bookFileId, status: bf.scanStatus }, 'scan-file: already settled');
    return;
  }

  let scan;
  try {
    scan = await scanFile(bf.storagePath, { host: clamavHost, port: clamavPort }, logger);
  } catch (err) {
    await prisma.bookFile.update({
      where: { id: bookFileId },
      data: { scanStatus: 'ERROR', scannedAt: new Date() },
    });
    throw err;
  }

  if (scan.verdict === 'ERROR') {
    await prisma.bookFile.update({
      where: { id: bookFileId },
      data: { scanStatus: 'ERROR', scannedAt: new Date() },
    });
    throw new Error(`scan-file: clamav error: ${scan.errorMessage ?? 'unknown'}`);
  }

  if (scan.verdict === 'INFECTED') {
    await rm(bf.storagePath, { force: true });
    await prisma.bookFile.update({
      where: { id: bookFileId },
      data: { scanStatus: 'INFECTED', scannedAt: new Date() },
    });
    await recordAudit({
      action: 'library.book_file.infected',
      target: { type: 'BOOK_FILE', id: bookFileId },
      metadata: {
        virusName: scan.virusName ?? null,
        sha256: bf.sha256,
        libraryId: bf.libraryId,
        bookId: bf.bookId,
      },
    });
    logger.warn(
      { bookFileId, virus: scan.virusName, sha256: bf.sha256 },
      'scan-file: INFECTED quarantined',
    );
    return;
  }

  // CLEAN — move staging → final
  const ext = FORMAT_TO_EXT[bf.format];
  const dest = finalPath(storageRoot, bf.libraryId, bf.bookId, bf.sha256, ext);
  assertUnderRoot(storageRoot, dest);
  await mkdir(path.dirname(dest), { recursive: true });
  await rename(bf.storagePath, dest);

  await prisma.bookFile.update({
    where: { id: bookFileId },
    data: {
      scanStatus: 'CLEAN',
      scannedAt: new Date(),
      storagePath: dest,
    },
  });
  logger.info({ bookFileId, sha256: bf.sha256 }, 'scan-file: CLEAN finalized');
}
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
pnpm vitest run --config vitest.integration.config.ts tests/integration/scan-file-job.test.ts
```

Expected : 3/3 PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/jobs/scan-file.ts tests/integration/scan-file-job.test.ts
git commit -m "feat(phase-2a): scan-file BullMQ handler with CLEAN/INFECTED/ERROR transitions + AuditLog"
```

### Task 2.3 — Register scan queue + job in `worker/index.ts`

**Files:**

- Modify: `worker/index.ts`

- [ ] **Step 1: Add CLAMAV_HOST + CLAMAV_PORT + STORAGE_ROOT to worker env schema**

(STORAGE_ROOT was added in Task 0.2.) Add :

```ts
CLAMAV_HOST: z.string().default('clamav'),
CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
```

- [ ] **Step 2: Register queue + worker**

After the existing `mailQueue` / `mailWorker` block, add :

```ts
// =========================================================================
// Scan queue (Phase 2A')
// =========================================================================
const SCAN_QUEUE = 'scan';
const scanQueue = new Queue(SCAN_QUEUE, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { count: 1000, age: 24 * 3600 },
    removeOnFail: { count: 5000 },
  },
});

const scanWorker = new Worker(
  SCAN_QUEUE,
  async (job) => {
    if (job.name === 'scan-file') {
      const { handleScanFile } = await import('./jobs/scan-file.js');
      return handleScanFile(job, {
        prisma,
        logger,
        clamavHost: env.CLAMAV_HOST,
        clamavPort: env.CLAMAV_PORT,
      });
    }
    logger.warn({ name: job.name }, 'unknown scan job');
  },
  { connection: redis },
);

scanWorker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'scan job failed'));
```

Export the queue so the Server Action can enqueue :

```ts
export { scanQueue };
```

(Note : actual import in app code uses `import { Queue } from 'bullmq'` directly — see Task 3.1. The export here is for shared lib use only if needed.)

- [ ] **Step 3: Verify worker boots**

```bash
pnpm tsx worker/index.ts &
sleep 3
kill %1 2>/dev/null
```

Expected : starts without crash, logs "redis connected" and registers scan queue.

- [ ] **Step 4: Commit**

```bash
git add worker/index.ts
git commit -m "feat(phase-2a): register scan queue + scan-file worker with retry policy"
```

---

## Module 2A'.3 — Server Action + tRPC + rate-limit

### Task 3.1 — Add upload + delete rate limiters

**Files:**

- Modify: `src/lib/rate-limit.ts`

- [ ] **Step 1: Append two new limiters**

At the bottom of `src/lib/rate-limit.ts` :

```ts
export const libraryFileUploadLimiter = new RateLimiterRedis({
  ...baseOpts(),
  keyPrefix: 'rl:lib_file_upload',
  points: 3,
  duration: 60,
  blockDuration: 5 * 60,
  insuranceLimiter: memInsurance(3, 60),
});

export const libraryFileDeleteLimiter = new RateLimiterRedis({
  ...baseOpts(),
  keyPrefix: 'rl:lib_file_delete',
  points: 5,
  duration: 60,
  insuranceLimiter: memInsurance(5, 60),
});
```

- [ ] **Step 2: Verify**

```bash
pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/rate-limit.ts
git commit -m "feat(phase-2a): rate limiters for library file upload (3/min) and delete (5/min)"
```

### Task 3.2 — Server Action `uploadBookFile`

**Files:**

- Create: `src/app/library/[slug]/books/[bookId]/upload/actions.ts`
- Test: `tests/integration/upload-action.test.ts`

- [ ] **Step 1: Write failing happy-path integration test**

```ts
// tests/integration/upload-action.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

vi.mock('@/lib/redis', () => {
  const actual = vi.importActual('@/lib/redis');
  return actual;
});

// Mock the BullMQ Queue at module boundary so the action does not need a worker
const enqueued: Array<{ name: string; data: any }> = [];
vi.mock('bullmq', async () => {
  const actual = await vi.importActual<typeof import('bullmq')>('bullmq');
  class MockQueue {
    constructor(
      public name: string,
      public _opts: unknown,
    ) {}
    add(name: string, data: any) {
      enqueued.push({ name, data });
      return Promise.resolve({ id: 'mock-job-id' });
    }
  }
  return { ...actual, Queue: MockQueue };
});

import { uploadBookFile } from '@/app/library/[slug]/books/[bookId]/upload/actions';
// Helper to build a fake authenticated session — pattern from existing integration tests
import { withAuthedRequest } from '../helpers/auth-context';

const prisma = new PrismaClient();
let storageRoot: string;
let user: { id: string };
let library: { id: string; slug: string };
let book: { id: string };

beforeEach(async () => {
  storageRoot = mkdtempSync(path.join(tmpdir(), 'biblio-upload-test-'));
  process.env.STORAGE_ROOT = storageRoot;
  enqueued.length = 0;

  user = await prisma.user.create({
    data: {
      email: `upload-${Date.now()}@test.local`,
      displayName: 'Uploader',
      passwordHash: 'x',
      emailVerifiedAt: new Date(),
      role: 'USER',
      status: 'ACTIVE',
    },
  });
  library = await prisma.library.create({
    data: { name: 'L', slug: `up-${Date.now()}` },
  });
  await prisma.libraryMember.create({
    data: { userId: user.id, libraryId: library.id, role: 'MEMBER', canUpload: true },
  });
  book = await prisma.book.create({
    data: { libraryId: library.id, title: 'T', authors: ['A'] },
  });
});

afterEach(async () => {
  await prisma.bookFile.deleteMany({ where: { libraryId: library.id } });
  await prisma.book.deleteMany({ where: { libraryId: library.id } });
  await prisma.libraryMember.deleteMany({ where: { libraryId: library.id } });
  await prisma.library.delete({ where: { id: library.id } });
  await prisma.user.delete({ where: { id: user.id } });
  rmSync(storageRoot, { recursive: true, force: true });
});

describe('uploadBookFile (happy path)', () => {
  it('creates BookFile PENDING + enqueues scan-file job', async () => {
    const epub = readFileSync(path.join(process.cwd(), 'tests/fixtures/upload/tiny.epub'));
    const formData = new FormData();
    formData.set('slug', library.slug);
    formData.set('bookId', book.id);
    formData.set('file', new Blob([epub], { type: 'application/epub+zip' }), 'tiny.epub');

    const result = await withAuthedRequest(user.id, () => uploadBookFile(formData));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scanStatus).toBe('PENDING');

    const created = await prisma.bookFile.findUniqueOrThrow({
      where: { id: result.bookFileId },
    });
    expect(created.libraryId).toBe(library.id);
    expect(created.bookId).toBe(book.id);
    expect(created.format).toBe('EPUB');
    expect(created.sha256).toMatch(/^[0-9a-f]{64}$/);

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].name).toBe('scan-file');
    expect(enqueued[0].data.bookFileId).toBe(result.bookFileId);
  });
});
```

If `tests/integration/helpers/auth-context.ts` does not exist, check the existing pattern in `tests/integration/library-books-archive.test.ts` for how Phase 1D mocks the session, and replicate. (It typically wraps `next-auth` `auth()` via `vi.mock` — copy the recipe.)

- [ ] **Step 2: Run, confirm fail**

```bash
pnpm vitest run --config vitest.integration.config.ts tests/integration/upload-action.test.ts
```

Expected : FAIL.

- [ ] **Step 3: Implement action**

```ts
// src/app/library/[slug]/books/[bookId]/upload/actions.ts
'use server';

import { Queue } from 'bullmq';
import { getRedis } from '@/lib/redis';
import { prisma } from '@/lib/prisma';
import { auth } from '@/server/auth';
import { assertMembership } from '@/server/auth/member-guard';
import { writeToStaging } from '@/lib/upload/staging-io';
import { libraryFileUploadLimiter } from '@/lib/rate-limit';
import { getEnv } from '@/lib/env';
import { recordAudit } from '@/lib/audit-log';
import type { BookFormat } from '@prisma/client';
import { Readable } from 'node:stream';
import { rm } from 'node:fs/promises';

export type UploadResult =
  | { ok: true; bookFileId: string; scanStatus: 'PENDING' }
  | {
      ok: false;
      error:
        | 'UNAUTHORIZED'
        | 'INVALID_INPUT'
        | 'INVALID_MIME'
        | 'OVERSIZE'
        | 'DUPLICATE'
        | 'FORMAT_TAKEN'
        | 'RATE_LIMITED'
        | 'INTERNAL_ERROR';
      details?: { existingBookId?: string };
    };

let scanQueueSingleton: Queue | null = null;
function scanQueue(): Queue {
  if (!scanQueueSingleton) {
    scanQueueSingleton = new Queue('scan', { connection: getRedis() });
  }
  return scanQueueSingleton;
}

export async function uploadBookFile(formData: FormData): Promise<UploadResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'UNAUTHORIZED' };

  const slug = String(formData.get('slug') ?? '');
  const bookId = String(formData.get('bookId') ?? '');
  const file = formData.get('file');

  if (!slug || !bookId || !(file instanceof Blob)) {
    return { ok: false, error: 'INVALID_INPUT' };
  }

  let member;
  try {
    member = await assertMembership(slug, session.user.id);
  } catch {
    return { ok: false, error: 'UNAUTHORIZED' };
  }
  if (!member.canUpload) return { ok: false, error: 'UNAUTHORIZED' };

  try {
    await libraryFileUploadLimiter.consume(`${session.user.id}:${member.libraryId}`);
  } catch {
    return { ok: false, error: 'RATE_LIMITED' };
  }

  // Confirm book exists and belongs to this library
  const book = await prisma.book.findUnique({ where: { id: bookId } });
  if (!book || book.libraryId !== member.libraryId) {
    return { ok: false, error: 'INVALID_INPUT' };
  }

  const env = getEnv();
  const filename = (file instanceof File ? file.name : 'upload.bin') ?? 'upload.bin';
  const stream = Readable.fromWeb(file.stream() as any);

  let staged;
  try {
    staged = await writeToStaging({
      root: env.STORAGE_ROOT,
      stream,
      filename,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('OVERSIZE')) return { ok: false, error: 'OVERSIZE' };
    if (msg.includes('INVALID_MIME')) return { ok: false, error: 'INVALID_MIME' };
    return { ok: false, error: 'INTERNAL_ERROR' };
  }

  // Dedup query (per-library)
  const dup = await prisma.bookFile.findUnique({
    where: { libraryId_sha256: { libraryId: member.libraryId, sha256: staged.sha256 } },
  });
  if (dup) {
    await rm(staged.stagingPath, { force: true });
    return {
      ok: false,
      error: 'DUPLICATE',
      details: { existingBookId: dup.bookId },
    };
  }

  // Format unique check (BookFile @@unique([bookId, format]))
  const sameFormat = await prisma.bookFile.findUnique({
    where: { bookId_format: { bookId, format: staged.format } },
  });
  if (sameFormat) {
    await rm(staged.stagingPath, { force: true });
    return { ok: false, error: 'FORMAT_TAKEN' };
  }

  let bookFile;
  try {
    bookFile = await prisma.bookFile.create({
      data: {
        bookId,
        libraryId: member.libraryId,
        format: staged.format,
        isOriginal: true,
        storagePath: staged.stagingPath,
        fileSizeBytes: BigInt(staged.bytesWritten),
        sha256: staged.sha256,
        mimeType: staged.mimeType,
        scanStatus: 'PENDING',
      },
    });
  } catch (err) {
    await rm(staged.stagingPath, { force: true });
    return { ok: false, error: 'INTERNAL_ERROR' };
  }

  await recordAudit({
    action: 'library.book_file.uploaded',
    actor: { id: session.user.id },
    target: { type: 'BOOK_FILE', id: bookFile.id },
    metadata: { libraryId: member.libraryId, bookId, sha256: staged.sha256, format: staged.format },
  });

  await scanQueue().add('scan-file', {
    bookFileId: bookFile.id,
    storageRoot: env.STORAGE_ROOT,
  });

  return { ok: true, bookFileId: bookFile.id, scanStatus: 'PENDING' };
}
```

(Audit action already added in Task 0.4.)

- [ ] **Step 4: Run, confirm pass**

```bash
pnpm vitest run --config vitest.integration.config.ts tests/integration/upload-action.test.ts
```

Expected : 1/1 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/library tests/integration/upload-action.test.ts prisma/
git commit -m "feat(phase-2a): uploadBookFile Server Action with stage + dedup + scan enqueue"
```

### Task 3.3 — Attack tests for the Server Action

**Files:**

- Test: `tests/integration/upload-action-attacks.test.ts`

- [ ] **Step 1: Write the test file**

```ts
// tests/integration/upload-action-attacks.test.ts
// Same imports + setup as upload-action.test.ts (copy the beforeEach/afterEach scaffolding)
// then add tests:

describe('uploadBookFile (attacks + edges)', () => {
  it('UNAUTHORIZED: member without canUpload', async () => {
    await prisma.libraryMember.update({
      where: { userId_libraryId: { userId: user.id, libraryId: library.id } },
      data: { canUpload: false },
    });
    const buf = readFileSync(path.join(process.cwd(), 'tests/fixtures/upload/tiny.epub'));
    const fd = new FormData();
    fd.set('slug', library.slug);
    fd.set('bookId', book.id);
    fd.set('file', new Blob([buf]), 'tiny.epub');

    const r = await withAuthedRequest(user.id, () => uploadBookFile(fd));
    expect(r).toEqual({ ok: false, error: 'UNAUTHORIZED' });
  });

  it('INVALID_MIME: spoofed PE binary', async () => {
    const buf = readFileSync(path.join(process.cwd(), 'tests/fixtures/upload/fake.pdf'));
    const fd = new FormData();
    fd.set('slug', library.slug);
    fd.set('bookId', book.id);
    fd.set('file', new Blob([buf]), 'fake.pdf');

    const r = await withAuthedRequest(user.id, () => uploadBookFile(fd));
    expect(r).toEqual({ ok: false, error: 'INVALID_MIME' });
  });

  it('DUPLICATE: same SHA in same library', async () => {
    const buf = readFileSync(path.join(process.cwd(), 'tests/fixtures/upload/tiny.epub'));
    const fd1 = new FormData();
    fd1.set('slug', library.slug);
    fd1.set('bookId', book.id);
    fd1.set('file', new Blob([buf]), 'tiny.epub');
    const r1 = await withAuthedRequest(user.id, () => uploadBookFile(fd1));
    expect(r1.ok).toBe(true);

    // Create a 2nd book in same library and try to upload the same file
    const book2 = await prisma.book.create({
      data: { libraryId: library.id, title: 'T2', authors: ['A'] },
    });
    const fd2 = new FormData();
    fd2.set('slug', library.slug);
    fd2.set('bookId', book2.id);
    fd2.set('file', new Blob([buf]), 'tiny.epub');
    const r2 = await withAuthedRequest(user.id, () => uploadBookFile(fd2));
    expect(r2.ok).toBe(false);
    if (!r2.ok) {
      expect(r2.error).toBe('DUPLICATE');
      expect(r2.details?.existingBookId).toBe(book.id);
    }
  });

  it('Cross-library non-leak: same SHA in different library succeeds', async () => {
    // Upload to library A
    const buf = readFileSync(path.join(process.cwd(), 'tests/fixtures/upload/tiny.epub'));
    const fd1 = new FormData();
    fd1.set('slug', library.slug);
    fd1.set('bookId', book.id);
    fd1.set('file', new Blob([buf]), 'tiny.epub');
    expect((await withAuthedRequest(user.id, () => uploadBookFile(fd1))).ok).toBe(true);

    // Create library B, add user as canUpload, create book, upload same SHA
    const libB = await prisma.library.create({
      data: { name: 'B', slug: `up-b-${Date.now()}` },
    });
    await prisma.libraryMember.create({
      data: { userId: user.id, libraryId: libB.id, role: 'MEMBER', canUpload: true },
    });
    const bookB = await prisma.book.create({
      data: { libraryId: libB.id, title: 'B', authors: ['A'] },
    });
    const fd2 = new FormData();
    fd2.set('slug', libB.slug);
    fd2.set('bookId', bookB.id);
    fd2.set('file', new Blob([buf]), 'tiny.epub');
    const r2 = await withAuthedRequest(user.id, () => uploadBookFile(fd2));
    expect(r2.ok).toBe(true);

    await prisma.bookFile.deleteMany({ where: { libraryId: libB.id } });
    await prisma.book.deleteMany({ where: { libraryId: libB.id } });
    await prisma.libraryMember.deleteMany({ where: { libraryId: libB.id } });
    await prisma.library.delete({ where: { id: libB.id } });
  });

  it('FORMAT_TAKEN: same book + same format', async () => {
    const buf = readFileSync(path.join(process.cwd(), 'tests/fixtures/upload/tiny.epub'));
    const fd1 = new FormData();
    fd1.set('slug', library.slug);
    fd1.set('bookId', book.id);
    fd1.set('file', new Blob([buf]), 'tiny.epub');
    expect((await withAuthedRequest(user.id, () => uploadBookFile(fd1))).ok).toBe(true);

    // Different file content (different SHA) but same EPUB format and same book
    const buf2 = Buffer.concat([buf, Buffer.from('\n')]);
    const fd2 = new FormData();
    fd2.set('slug', library.slug);
    fd2.set('bookId', book.id);
    fd2.set('file', new Blob([buf2]), 'tiny2.epub');
    const r2 = await withAuthedRequest(user.id, () => uploadBookFile(fd2));
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toBe('FORMAT_TAKEN');
  });
});
```

- [ ] **Step 2: Run, confirm pass**

```bash
pnpm vitest run --config vitest.integration.config.ts tests/integration/upload-action-attacks.test.ts
```

Expected : 5/5 PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/upload-action-attacks.test.ts
git commit -m "test(phase-2a): upload action attacks (UNAUTHORIZED, INVALID_MIME, DUPLICATE, cross-lib, FORMAT_TAKEN)"
```

### Task 3.4 — `library.files` tRPC router

**Files:**

- Create: `src/server/trpc/routers/library/files.ts`
- Modify: `src/server/trpc/routers/library/index.ts`
- Test: `tests/integration/library-files-router.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/integration/library-files-router.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { createCallerForUser } from './helpers/trpc-caller';

const prisma = new PrismaClient();
let user: { id: string };
let library: { id: string; slug: string };
let book: { id: string };
let bf: { id: string };
let storageRoot: string;

beforeEach(async () => {
  storageRoot = mkdtempSync(path.join(tmpdir(), 'biblio-files-router-'));
  process.env.STORAGE_ROOT = storageRoot;
  // Setup user, library (admin role for delete tests), book, BookFile
  user = await prisma.user.create({
    data: {
      email: `f-${Date.now()}@x.local`,
      displayName: 'F',
      passwordHash: 'x',
      emailVerifiedAt: new Date(),
      role: 'USER',
      status: 'ACTIVE',
    },
  });
  library = await prisma.library.create({
    data: { name: 'L', slug: `f-${Date.now()}` },
  });
  await prisma.libraryMember.create({
    data: { userId: user.id, libraryId: library.id, role: 'LIBRARY_ADMIN' },
  });
  book = await prisma.book.create({
    data: { libraryId: library.id, title: 'T', authors: ['A'] },
  });
  const dir = path.join(storageRoot, 'library', library.id, book.id);
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'aaaa.epub');
  writeFileSync(filePath, 'content');
  bf = await prisma.bookFile.create({
    data: {
      bookId: book.id,
      libraryId: library.id,
      format: 'EPUB',
      isOriginal: true,
      storagePath: filePath,
      fileSizeBytes: BigInt(7),
      sha256: 'aaaa',
      mimeType: 'application/epub+zip',
      scanStatus: 'CLEAN',
      scannedAt: new Date(),
    },
  });
});

afterEach(async () => {
  await prisma.bookFile.deleteMany({ where: { libraryId: library.id } });
  await prisma.book.deleteMany({ where: { libraryId: library.id } });
  await prisma.libraryMember.deleteMany({ where: { libraryId: library.id } });
  await prisma.library.delete({ where: { id: library.id } });
  await prisma.user.delete({ where: { id: user.id } });
  rmSync(storageRoot, { recursive: true, force: true });
});

describe('library.files.get', () => {
  it('returns BookFile rows for the book scoped to the library', async () => {
    const caller = await createCallerForUser(user.id);
    const r = await caller.library.files.get({ slug: library.slug, bookId: book.id });
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe(bf.id);
    expect(r[0].scanStatus).toBe('CLEAN');
  });
});

describe('library.files.delete', () => {
  it('LIBRARY_ADMIN deletes file (DB + disk) and writes AuditLog', async () => {
    const caller = await createCallerForUser(user.id);
    await caller.library.files.delete({ slug: library.slug, id: bf.id });
    const remaining = await prisma.bookFile.findUnique({ where: { id: bf.id } });
    expect(remaining).toBeNull();
    expect(existsSync(bf.storagePath ?? '')).toBe(false); // disk cleaned
    const audit = await prisma.auditLog.findFirst({
      where: { targetId: bf.id, action: 'library.book_file.deleted' },
    });
    expect(audit).not.toBeNull();
  });

  it('MEMBER (non-admin) gets FORBIDDEN', async () => {
    await prisma.libraryMember.update({
      where: { userId_libraryId: { userId: user.id, libraryId: library.id } },
      data: { role: 'MEMBER' },
    });
    const caller = await createCallerForUser(user.id);
    await expect(caller.library.files.delete({ slug: library.slug, id: bf.id })).rejects.toThrow(
      /FORBIDDEN/,
    );
  });
});
```

(`createCallerForUser` is the existing helper used in Phase 1D integration tests — `tests/integration/helpers/trpc-caller.ts`.)

- [ ] **Step 2: Run, confirm fail**

```bash
pnpm vitest run --config vitest.integration.config.ts tests/integration/library-files-router.test.ts
```

Expected : FAIL.

- [ ] **Step 3: Implement router**

```ts
// src/server/trpc/routers/library/files.ts
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { rm } from 'node:fs/promises';
import { router } from '@/server/trpc/trpc';
import { libraryProcedure, libraryAdminProcedure } from '@/server/trpc/procedures-library';
import { libraryFileDeleteLimiter } from '@/lib/rate-limit';
import { recordAudit } from '@/lib/audit-log';

const cuid = z.string().cuid();

export const filesRouter = router({
  get: libraryProcedure
    .input(z.object({ slug: z.string(), bookId: cuid }))
    .query(async ({ ctx, input }) => {
      const book = await ctx.prisma.book.findUnique({ where: { id: input.bookId } });
      if (!book || book.libraryId !== ctx.member.libraryId) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      return ctx.prisma.bookFile.findMany({
        where: { bookId: input.bookId, libraryId: ctx.member.libraryId },
        orderBy: { createdAt: 'asc' },
      });
    }),

  delete: libraryAdminProcedure
    .input(z.object({ slug: z.string(), id: cuid }))
    .mutation(async ({ ctx, input }) => {
      try {
        await libraryFileDeleteLimiter.consume(`${ctx.session.user.id}:${ctx.member.libraryId}`);
      } catch {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS' });
      }

      const bf = await ctx.prisma.bookFile.findUnique({ where: { id: input.id } });
      if (!bf || bf.libraryId !== ctx.member.libraryId) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }

      await rm(bf.storagePath, { force: true });
      await ctx.prisma.bookFile.delete({ where: { id: input.id } });
      await recordAudit({
        action: 'library.book_file.deleted',
        actor: { id: ctx.session.user.id },
        target: { type: 'BOOK_FILE', id: input.id },
        metadata: { libraryId: bf.libraryId, bookId: bf.bookId, sha256: bf.sha256 },
      });
      return { ok: true };
    }),
});
```

If `libraryAdminProcedure` does not exist in `procedures-library.ts`, define it next to `libraryProcedure` using the same `assertMembership(slug, 'LIBRARY_ADMIN')` pattern. Reuse the existing helper from `library/books.ts`.

- [ ] **Step 4: Mount in `library/index.ts`**

```ts
// src/server/trpc/routers/library/index.ts
import { router } from '@/server/trpc/trpc';
import { booksRouter } from './books';
import { filesRouter } from './files'; // NEW

export const libraryRouter = router({
  books: booksRouter,
  files: filesRouter, // NEW
});
```

(Audit action already added in Task 0.4.)

- [ ] **Step 5: Run, confirm pass**

```bash
pnpm vitest run --config vitest.integration.config.ts tests/integration/library-files-router.test.ts
```

Expected : 3/3 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/trpc/routers/library/ tests/integration/library-files-router.test.ts prisma/
git commit -m "feat(phase-2a): library.files tRPC router (get for members, delete for admins)"
```

### Task 3.5 — Permissions matrix extension

**Files:**

- Modify: `tests/integration/permissions-matrix.test.ts`
- Modify: `docs/permissions-matrix.md`

- [ ] **Step 1: Add `library.files.*` rows to integration matrix test**

Open `tests/integration/permissions-matrix.test.ts`. Find the existing `library.books.*` block and add an analogous block for `library.files`. Cover three procedures :

- `library.files.get` : ✓ for LIBRARY_ADMIN, MEMBER ; ✗ for ANON, PENDING_2FA, GLOBAL_ADMIN-not-member
- `library.files.delete` : ✓ for LIBRARY_ADMIN ; ✗ for the rest
- `uploadBookFile` Server Action : tested in `upload-action-attacks.test.ts`, leave a comment in the matrix file noting where it's covered.

Use the same fixture-builder helpers Phase 1D added.

- [ ] **Step 2: Update doc**

Append a `## library.files` section to `docs/permissions-matrix.md` with the same 5-column table (GLOBAL_ADMIN / LIBRARY_ADMIN / MEMBER / ANON / PENDING_2FA), reflecting the spec section 7.1.

- [ ] **Step 3: Run full matrix test**

```bash
pnpm vitest run --config vitest.integration.config.ts tests/integration/permissions-matrix.test.ts
```

Expected : all PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/permissions-matrix.test.ts docs/permissions-matrix.md
git commit -m "test(phase-2a): extend permissions matrix to library.files.{get,delete}"
```

---

## Module 2A'.4 — UI + E2E + Attacks

### Task 4.1 — `ScanStatusBadge` component

**Files:**

- Create: `src/components/books/ScanStatusBadge.tsx`

- [ ] **Step 1: Implement (no test — purely presentational, covered by E2E)**

```tsx
// src/components/books/ScanStatusBadge.tsx
import type { ScanStatus } from '@prisma/client';
import { Loader2, ShieldCheck, ShieldAlert, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  status: ScanStatus;
  size?: 'sm' | 'md';
  className?: string;
}

const VARIANT: Record<ScanStatus, { label: string; cls: string; Icon: typeof Loader2 }> = {
  PENDING: { label: 'En analyse', cls: 'bg-slate-100 text-slate-700', Icon: Loader2 },
  CLEAN: { label: 'Disponible', cls: 'bg-green-100 text-green-800', Icon: ShieldCheck },
  INFECTED: { label: 'Bloqué', cls: 'bg-red-100 text-red-800', Icon: ShieldAlert },
  ERROR: { label: 'Erreur d’analyse', cls: 'bg-orange-100 text-orange-800', Icon: AlertTriangle },
};

export function ScanStatusBadge({ status, size = 'md', className }: Props) {
  const v = VARIANT[status];
  const dim = size === 'sm' ? 'text-xs px-1.5 py-0.5' : 'text-sm px-2 py-1';
  const animate = status === 'PENDING' ? 'animate-spin' : '';
  return (
    <span
      data-testid={`scan-status-${status.toLowerCase()}`}
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-medium',
        v.cls,
        dim,
        className,
      )}
    >
      <v.Icon className={cn(size === 'sm' ? 'h-3 w-3' : 'h-4 w-4', animate)} />
      {v.label}
    </span>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/components/books/ScanStatusBadge.tsx
git commit -m "feat(phase-2a): ScanStatusBadge with PENDING/CLEAN/INFECTED/ERROR variants"
```

### Task 4.2 — `BookFileUpload` form component

**Files:**

- Create: `src/components/books/BookFileUpload.tsx`

- [ ] **Step 1: Implement client component**

```tsx
// src/components/books/BookFileUpload.tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  uploadBookFile,
  type UploadResult,
} from '@/app/library/[slug]/books/[bookId]/upload/actions';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';

interface Props {
  slug: string;
  bookId: string;
}

const ACCEPT =
  '.epub,.pdf,.txt,.docx,application/epub+zip,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const ERROR_MSG: Record<NonNullable<Extract<UploadResult, { ok: false }>['error']>, string> = {
  UNAUTHORIZED: 'Vous n’avez pas le droit d’uploader dans cette bibliothèque.',
  INVALID_INPUT: 'Champs manquants.',
  INVALID_MIME: 'Format non supporté. Acceptés : EPUB, PDF, TXT, DOCX.',
  OVERSIZE: 'Fichier trop volumineux (max 100 Mo).',
  DUPLICATE: 'Ce fichier existe déjà dans cette bibliothèque.',
  FORMAT_TAKEN: 'Ce livre a déjà un fichier de ce format. Demandez à un admin de le supprimer.',
  RATE_LIMITED: 'Trop d’uploads récents. Réessayez dans une minute.',
  INTERNAL_ERROR: 'Erreur serveur. Réessayez ou contactez un admin.',
};

export function BookFileUpload({ slug, bookId }: Props) {
  const [pending, startTransition] = useTransition();
  const [filename, setFilename] = useState<string | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  return (
    <form
      action={(formData) => {
        formData.set('slug', slug);
        formData.set('bookId', bookId);
        startTransition(async () => {
          const r = await uploadBookFile(formData);
          if (r.ok) {
            toast({ title: 'Upload reçu', description: 'Le fichier est en cours d’analyse.' });
            router.refresh();
          } else {
            toast({
              title: 'Échec de l’upload',
              description: ERROR_MSG[r.error],
              variant: 'destructive',
            });
          }
        });
      }}
      className="flex flex-col gap-3 rounded-md border border-dashed p-4"
    >
      <label className="flex flex-col gap-2 text-sm">
        <span className="font-medium">Ajouter un fichier</span>
        <input
          type="file"
          name="file"
          accept={ACCEPT}
          required
          onChange={(e) => setFilename(e.target.files?.[0]?.name ?? null)}
          disabled={pending}
        />
      </label>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {filename ?? 'EPUB / PDF / TXT / DOCX — 100 Mo max'}
        </span>
        <Button type="submit" disabled={pending || !filename}>
          {pending ? 'Envoi…' : 'Envoyer'}
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Verify**

```bash
pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/components/books/BookFileUpload.tsx
git commit -m "feat(phase-2a): BookFileUpload client form with transition + toast feedback"
```

### Task 4.3 — Patch book detail page + BookCard

**Files:**

- Modify: `src/app/library/[slug]/books/[bookId]/page.tsx`
- Modify: `src/components/books/BookCard.tsx`

- [ ] **Step 1: Patch book detail page**

In the book-detail page, after the book metadata section, render either the upload form or the file panel :

```tsx
// inside the page component, after fetching `book` and the current `member`
import { BookFileUpload } from '@/components/books/BookFileUpload';
import { ScanStatusBadge } from '@/components/books/ScanStatusBadge';

// ...

const files = await prisma.bookFile.findMany({
  where: { bookId: book.id, libraryId: book.libraryId },
  orderBy: { createdAt: 'asc' },
});

// ...

<section className="mt-8 space-y-3">
  <h2 className="text-lg font-semibold">Fichier</h2>
  {files.length === 0 ? (
    member.canUpload ? (
      <BookFileUpload slug={params.slug} bookId={book.id} />
    ) : (
      <p className="text-sm text-muted-foreground">Aucun fichier disponible.</p>
    )
  ) : (
    files.map((f) => (
      <div key={f.id} className="flex items-center justify-between rounded-md border p-3">
        <div className="flex items-center gap-3">
          <ScanStatusBadge status={f.scanStatus} />
          <span className="text-sm">
            {f.format} · {(Number(f.fileSizeBytes) / 1024 / 1024).toFixed(2)} MB
          </span>
        </div>
        {/* Phase 5: download button. For now: empty. */}
      </div>
    ))
  )}
</section>;
```

- [ ] **Step 2: Patch BookCard**

In `src/components/books/BookCard.tsx`, accept an optional `scanStatus?: ScanStatus | null` prop, and render `<ScanStatusBadge status={scanStatus} size="sm" />` next to the title when non-null. Update the prop drilling in `BookListGrid.tsx` to pass `book.files[0]?.scanStatus ?? null`. (Adjust the `library.books.list` Prisma include to fetch `files: { select: { scanStatus: true }, take: 1 }`.)

- [ ] **Step 3: Verify**

```bash
pnpm typecheck && pnpm lint
```

- [ ] **Step 4: Commit**

```bash
git add src/app/library src/components/books src/server/trpc
git commit -m "feat(phase-2a): book detail upload zone + ScanStatusBadge on cards"
```

### Task 4.4 — E2E happy path

**Files:**

- Create: `tests/e2e/book-upload.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
// tests/e2e/book-upload.spec.ts
import { test, expect } from '@playwright/test';
import path from 'node:path';

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
const LIBRARY_SLUG = 'e2e-2a-upload';
const LIBRARY_NAME = 'E2E 2A Upload';

const prisma = getPrisma();

test.beforeEach(async () => {
  await cleanupTestData();
  await cleanupE2ELibrary(LIBRARY_SLUG);
  await flushRateLimit();
});

test.afterAll(async () => {
  await disconnect();
});

test('uploader sees PENDING then CLEAN after refresh', async ({ page }) => {
  const email = `uploader-${Date.now()}@e2e.local`;
  const user = await prisma.user.create({
    data: {
      email,
      displayName: 'E2E Uploader',
      passwordHash: await hashPassword(PASSWORD),
      emailVerifiedAt: new Date(),
      role: 'USER',
      status: 'ACTIVE',
    },
  });
  const lib = await prisma.library.create({
    data: { name: LIBRARY_NAME, slug: LIBRARY_SLUG },
  });
  await prisma.libraryMember.create({
    data: { userId: user.id, libraryId: lib.id, role: 'LIBRARY_ADMIN', canUpload: true },
  });
  const book = await prisma.book.create({
    data: { libraryId: lib.id, title: 'E2E Upload Test', authors: ['A'] },
  });

  await submitLogin(page, email, PASSWORD);
  await page.goto(`/library/${LIBRARY_SLUG}/books/${book.id}`);

  await page.setInputFiles(
    'input[type="file"][name="file"]',
    path.join(process.cwd(), 'tests/fixtures/upload/tiny.epub'),
  );
  await page.getByRole('button', { name: 'Envoyer' }).click();

  // PENDING badge appears after action returns
  await expect(page.getByTestId('scan-status-pending')).toBeVisible({ timeout: 10_000 });

  // Wait up to 30s for worker to complete scan, then refresh
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId('scan-status-clean')).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
});
```

- [ ] **Step 2: Run locally with worker + clamav**

```bash
docker compose up -d clamav redis pg
pnpm tsx worker/index.ts &
WORKER_PID=$!
pnpm dev &
APP_PID=$!
sleep 5
pnpm playwright test tests/e2e/book-upload.spec.ts
kill $WORKER_PID $APP_PID
```

Expected : 1/1 PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/book-upload.spec.ts
git commit -m "test(phase-2a): e2e happy path — upload → PENDING → CLEAN after worker scan"
```

### Task 4.5 — Attack tests (`tests/attacks/upload.test.ts`)

**Files:**

- Create: `tests/attacks/upload.test.ts`

- [ ] **Step 1: Write the EICAR + traversal + spoof tests as integration-level (no Playwright)**

```ts
// tests/attacks/upload.test.ts
// Same Vitest setup as upload-action-attacks.test.ts, plus REAL clamav (not mocked).
// Drive the full pipeline: action → BullMQ enqueue → worker scan-file → expect INFECTED.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Worker as BullWorker, Queue } from 'bullmq';
import { handleScanFile } from '../../worker/jobs/scan-file';
// ... usual setup ...

describe('upload pipeline — security attacks', () => {
  it('EICAR upload: BookFile transitions to INFECTED + AuditLog SECURITY', async () => {
    const EICAR_BUF = Buffer.from(
      'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*\n',
    );

    // Wrap EICAR inside a TXT-named file (the EICAR string is detected regardless of wrapper)
    const fd = new FormData();
    fd.set('slug', library.slug);
    fd.set('bookId', book.id);
    fd.set('file', new Blob([EICAR_BUF]), 'evil.txt');

    const r = await withAuthedRequest(user.id, () => uploadBookFile(fd));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Drive worker job inline (no need for full BullMQ runner)
    await handleScanFile(
      { id: 'attack-eicar', data: { bookFileId: r.bookFileId, storageRoot } } as any,
      { prisma, logger: pinoTestLogger, clamavHost: HOST, clamavPort: PORT },
    );

    const updated = await prisma.bookFile.findUniqueOrThrow({ where: { id: r.bookFileId } });
    expect(updated.scanStatus).toBe('INFECTED');
    const audit = await prisma.auditLog.findFirst({
      where: { targetId: r.bookFileId, action: 'library.book_file.infected' },
    });
    expect(audit).not.toBeNull();
    expect(audit?.targetType).toBe('BOOK_FILE');
  });

  it('Path traversal in filename does not escape STORAGE_ROOT', async () => {
    const buf = readFileSync(path.join(process.cwd(), 'tests/fixtures/upload/tiny.epub'));
    const fd = new FormData();
    fd.set('slug', library.slug);
    fd.set('bookId', book.id);
    fd.set('file', new Blob([buf]), '../../../etc/passwd.epub');

    const r = await withAuthedRequest(user.id, () => uploadBookFile(fd));
    expect(r.ok).toBe(true); // upload accepted (filename is sanitized via SHA-derived path)
    if (!r.ok) return;

    const created = await prisma.bookFile.findUniqueOrThrow({ where: { id: r.bookFileId } });
    expect(created.storagePath.startsWith(storageRoot)).toBe(true);
    expect(created.storagePath).not.toContain('..');
    expect(created.storagePath).not.toContain('/etc/passwd');
  });
});
```

(Spoofed PE binary is already covered by `upload-action-attacks.test.ts` Task 3.3. No need to duplicate.)

- [ ] **Step 2: Run**

```bash
docker compose up -d clamav redis pg
pnpm vitest run --config vitest.integration.config.ts tests/attacks/upload.test.ts
```

Expected : 2/2 PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/attacks/upload.test.ts
git commit -m "test(phase-2a): attack tests — EICAR via real ClamAV + path traversal containment"
```

---

## Module 2A'.5 — Closure

### Task 5.1 — Update memory + tag

**Files:**

- (memory) `~/.claude/projects/.../memory/phase-2a-completed.md` (created at the end of the run)
- Tag : `phase-2a-complete` on the merge commit

- [ ] **Step 1: Verify all CI gates pass on the feature branch**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm vitest run --config vitest.integration.config.ts
pnpm playwright test
```

All green required. If anything red, fix before proceeding.

- [ ] **Step 2: Open PR**

Already on `feat/phase-2a-upload`. Run :

```bash
gh pr create --title "feat(phase-2a): upload pipeline + ClamAV + dedup" --body "$(cat <<'BODY'
Implements [Phase 2A' design](docs/superpowers/specs/2026-04-30-phase-2a-upload-design.md).

Modules merged on this branch (non-squash, preserve commit history):
- 2A'.0 — Infra + schema migration
- 2A'.1 — Pure libs (storage-paths, sha256-stream, mime-validator, staging-io)
- 2A'.2 — Worker scan-file job (clamscan INSTREAM)
- 2A'.3 — Server Action + library.files router + rate-limit + permissions matrix
- 2A'.4 — UI + E2E + attack tests

## Test plan
- [ ] All unit tests green (~10 new specs)
- [ ] All integration tests green (~7 new specs incl. real ClamAV)
- [ ] E2E shard covers book-upload happy path
- [ ] Attack suite green (EICAR, MIME spoof, path traversal, dedup)
BODY
)"
```

- [ ] **Step 3: After CI green and merge — tag and update memory**

```bash
git checkout main && git pull
git tag phase-2a-complete
git push --tags
```

Then write the memory file `phase-2a-completed.md` with the same structure as `phase-1d-completed.md` (date, livrables per module, patterns, follow-ups for 2B').

- [ ] **Step 4: Brainstorm 2B' (metadata fetch + cover cache)**

Run `superpowers:brainstorming` to scope Phase 2B' (Google Books / Open Library fetch chain + cover image caching). Phase 2B' depends on 2A' (BookFile must exist to attach metadata extraction job).

---

## Self-Review (run before handing the plan over)

- [ ] **Spec coverage** — every section of the design doc maps to a task :
  - § 4 (data model) → Task 0.3
  - § 5.1 (Server Action) → Task 3.2
  - § 5.2 (tRPC) → Task 3.4
  - § 6 (UI) → Tasks 4.1–4.3
  - § 7 (permissions) → Task 3.5 + 3.3
  - § 8 (tests) → Tasks 1.x, 2.2, 3.2/3.3/3.4, 4.4, 4.5
  - § 9 (risks) → mitigations woven through (rate-limit Task 3.1, traversal in 1.1/1.4, EICAR in 4.5, retry in 2.3)
  - § 10 (modules) → matches plan structure 1:1
- [ ] **No placeholders** — search for "TBD", "TODO", "implement later" : 0 hits.
- [ ] **Type consistency** — `UploadResult`, `ScanResult`, `StagingResult`, `BookFormat`, `ScanStatus`, `MimeResult` are spelled identically across tasks.
- [ ] **Audit actions** — `library.book_file.{uploaded,infected,deleted}` and `BOOK_FILE` target type all added in Task 0.4 (TS-only, no Prisma migration since `AuditLog.action` is `String`).
