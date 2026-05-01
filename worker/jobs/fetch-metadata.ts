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

// Worker-side budget limiter using the same Redis key as src/lib/rate-limit.ts
// metadataApiBudgetLimiter — they share a single 800-call/day counter.
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
  if (!book) return;
  const isbn = book.isbn13 ?? book.isbn10;
  if (!isbn) {
    await prisma.book.update({
      where: { id: bookId },
      data: { metadataFetchStatus: 'NOT_FOUND', metadataAttemptCount: { increment: 1 } },
    });
    return;
  }

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
