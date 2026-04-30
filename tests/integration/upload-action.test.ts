import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Inlined here (not in helpers/auth-context.ts) because vi.mock is only hoisted
// to the top of the file that *contains* it. Putting it in the helper would not
// intercept the `@/server/auth` import chain triggered by the action import below.
vi.mock('@/server/auth', () => ({
  auth: vi.fn(async () => null),
  signIn: vi.fn(),
  signOut: vi.fn(),
  handlers: { GET: vi.fn(), POST: vi.fn() },
  GET: vi.fn(),
  POST: vi.fn(),
}));

// Mock the BullMQ Queue at module boundary so the action does not need a worker.
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
import { withAuthedRequest } from './helpers/auth-context';
import { getTestPrisma, truncateAll } from './setup/prisma';

const prisma = getTestPrisma();
let storageRoot: string;
let user: { id: string };
let library: { id: string; slug: string };
let book: { id: string };

beforeEach(async () => {
  await truncateAll();
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
    data: { libraryId: library.id, title: 'T', authors: ['A'], uploadedById: user.id },
  });
});

afterEach(() => {
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
    expect(enqueued[0]?.name).toBe('scan-file');
    expect(enqueued[0]?.data.bookFileId).toBe(result.bookFileId);
  });
});
