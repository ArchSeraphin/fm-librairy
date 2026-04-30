'use server';

import { Queue } from 'bullmq';
import { Readable } from 'node:stream';
import { rm } from 'node:fs/promises';
import { getRedis } from '@/lib/redis';
import { db } from '@/lib/db';
import { auth } from '@/server/auth';
import { writeToStaging } from '@/lib/upload/staging-io';
import { libraryFileUploadLimiter } from '@/lib/rate-limit';
import { getEnv } from '@/lib/env';
import { recordAudit } from '@/lib/audit-log';

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
  // The real `auth()` (NextAuth JWT strategy) returns a JWT-like object where
  // user id lives at top-level `userId` (see config.ts jwt callback). We accept
  // either shape so test mocks that expose `user.id` also work.
  const session = (await auth()) as
    | (Record<string, unknown> & { userId?: string; user?: { id?: string } })
    | null;
  const userId = session?.userId ?? session?.user?.id ?? null;
  if (!userId) return { ok: false, error: 'UNAUTHORIZED' };

  const slug = String(formData.get('slug') ?? '');
  const bookId = String(formData.get('bookId') ?? '');
  const file = formData.get('file');

  if (!slug || !bookId || !(file instanceof Blob)) {
    return { ok: false, error: 'INVALID_INPUT' };
  }

  // Inline membership check — does NOT call requireMembership() because that
  // helper redirects on failure (Next.js navigation), which would short-circuit
  // the result-type contract for this Server Action.
  const lib = await db.library.findUnique({ where: { slug } });
  if (!lib || lib.archivedAt !== null) {
    return { ok: false, error: 'UNAUTHORIZED' };
  }
  const member = await db.libraryMember.findUnique({
    where: { userId_libraryId: { userId, libraryId: lib.id } },
  });
  if (!member) return { ok: false, error: 'UNAUTHORIZED' };
  if (!member.canUpload) return { ok: false, error: 'UNAUTHORIZED' };

  try {
    await libraryFileUploadLimiter.consume(`${userId}:${lib.id}`);
  } catch {
    return { ok: false, error: 'RATE_LIMITED' };
  }

  // Confirm book exists and belongs to this library.
  const book = await db.book.findUnique({ where: { id: bookId } });
  if (!book || book.libraryId !== lib.id) {
    return { ok: false, error: 'INVALID_INPUT' };
  }

  // Read STORAGE_ROOT from process.env first to honour test-time overrides; the
  // getEnv() cache is populated at module-import time and ignores later mutations.
  // getEnv() still acts as the validated fallback at production start-up.
  const storageRoot = process.env.STORAGE_ROOT ?? getEnv().STORAGE_ROOT;
  const filename = file instanceof File ? file.name : 'upload.bin';
  // Blob.stream() returns a web ReadableStream<Uint8Array>; Readable.fromWeb's
  // stricter typing rejects it across realm boundaries, but it works at runtime.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stream = Readable.fromWeb(file.stream() as any);

  let staged;
  try {
    staged = await writeToStaging({
      root: storageRoot,
      stream,
      filename,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('OVERSIZE')) return { ok: false, error: 'OVERSIZE' };
    if (msg.includes('INVALID_MIME')) return { ok: false, error: 'INVALID_MIME' };
    return { ok: false, error: 'INTERNAL_ERROR' };
  }

  // Dedup check (per-library, on Task 0.3 compound unique).
  const dup = await db.bookFile.findUnique({
    where: { libraryId_sha256: { libraryId: lib.id, sha256: staged.sha256 } },
  });
  if (dup) {
    await rm(staged.stagingPath, { force: true });
    return {
      ok: false,
      error: 'DUPLICATE',
      details: { existingBookId: dup.bookId },
    };
  }

  // Format unique check (BookFile @@unique([bookId, format])).
  const sameFormat = await db.bookFile.findUnique({
    where: { bookId_format: { bookId, format: staged.format } },
  });
  if (sameFormat) {
    await rm(staged.stagingPath, { force: true });
    return { ok: false, error: 'FORMAT_TAKEN' };
  }

  let bookFile;
  try {
    bookFile = await db.bookFile.create({
      data: {
        bookId,
        libraryId: lib.id,
        format: staged.format,
        isOriginal: true,
        storagePath: staged.stagingPath,
        fileSizeBytes: BigInt(staged.bytesWritten),
        sha256: staged.sha256,
        mimeType: staged.mimeType,
        scanStatus: 'PENDING',
      },
    });
  } catch {
    await rm(staged.stagingPath, { force: true });
    return { ok: false, error: 'INTERNAL_ERROR' };
  }

  await recordAudit({
    action: 'library.book_file.uploaded',
    actor: { id: userId },
    target: { type: 'BOOK_FILE', id: bookFile.id },
    metadata: {
      libraryId: lib.id,
      bookId,
      sha256: staged.sha256,
      format: staged.format,
    },
  });

  await scanQueue().add('scan-file', {
    bookFileId: bookFile.id,
    storageRoot,
  });

  return { ok: true, bookFileId: bookFile.id, scanStatus: 'PENDING' };
}
