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
  storageRoot = mkdtempSync(path.join(tmpdir(), 'biblio-upload-attacks-'));
  process.env.STORAGE_ROOT = storageRoot;
  enqueued.length = 0;

  user = await prisma.user.create({
    data: {
      email: `upload-atk-${Date.now()}@test.local`,
      displayName: 'Attacker',
      passwordHash: 'x',
      emailVerifiedAt: new Date(),
      role: 'USER',
      status: 'ACTIVE',
    },
  });
  library = await prisma.library.create({
    data: { name: 'L', slug: `up-atk-${Date.now()}` },
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

    // Cleanup library B (also runs at afterEach via truncateAll, but explicit here helps locality)
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
