// tests/integration/worker-fetch-metadata.test.ts
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getTestPrisma, truncateAll } from './setup/prisma';

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
    agent
      .get('https://openlibrary.org')
      .intercept({ path: /api\/books/ })
      .reply(200, ol);

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
    agent
      .get('https://www.googleapis.com')
      .intercept({ path: /books/ })
      .reply(200, { totalItems: 0 });
    agent
      .get('https://openlibrary.org')
      .intercept({ path: /api\/books/ })
      .reply(200, {});

    await fetchMetadataJob(mkJob(book.id, 'auto'));

    const updated = await prisma.book.findUniqueOrThrow({ where: { id: book.id } });
    expect(updated.metadataFetchStatus).toBe('NOT_FOUND');
    expect(downloadAndNormalize).not.toHaveBeenCalled();
  });

  it('throws on transient error so BullMQ retries (attempts not exhausted)', async () => {
    const { book } = await makeLibAndBook();
    agent.get('https://www.googleapis.com').intercept({ path: /books/ }).reply(503, '');
    agent
      .get('https://openlibrary.org')
      .intercept({ path: /api\/books/ })
      .reply(503, '');

    await expect(fetchMetadataJob(mkJob(book.id, 'auto', 1, 3))).rejects.toThrow();

    const updated = await prisma.book.findUniqueOrThrow({ where: { id: book.id } });
    expect(updated.metadataFetchStatus).toBeNull();
  });

  it('marks ERROR + writes audit on the last failed attempt', async () => {
    const { book } = await makeLibAndBook();
    agent.get('https://www.googleapis.com').intercept({ path: /books/ }).reply(503, '');
    agent
      .get('https://openlibrary.org')
      .intercept({ path: /api\/books/ })
      .reply(503, '');

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
    agent
      .get('https://openlibrary.org')
      .intercept({ path: /api\/books/ })
      .reply(200, {});

    await fetchMetadataJob(mkJob(book.id, 'manual'));

    const updated = await prisma.book.findUniqueOrThrow({ where: { id: book.id } });
    expect(updated.description).not.toBe('Old description.');
    expect(updated.description).not.toBeNull();
  });
});
