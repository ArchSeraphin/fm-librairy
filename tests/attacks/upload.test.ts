import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { handleScanFile } from '../../worker/jobs/scan-file';

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
import { withAuthedRequest } from '../integration/helpers/auth-context';
import { getTestPrisma, truncateAll } from '../integration/setup/prisma';

const prisma = getTestPrisma();
const pinoTestLogger = pino({ level: 'silent' });
const HOST = process.env.CLAMAV_HOST ?? 'localhost';
const PORT = Number(process.env.CLAMAV_PORT ?? 3310);

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

describe('upload pipeline — security attacks', () => {
  it('EICAR upload: BookFile transitions to INFECTED + AuditLog SECURITY', async () => {
    const EICAR_BUF = Buffer.from(
      'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*\n',
    );

    // Wrap EICAR in a TXT-named file (file-type detects as text, scan still fires)
    const fd = new FormData();
    fd.set('slug', library.slug);
    fd.set('bookId', book.id);
    fd.set('file', new Blob([EICAR_BUF]), 'evil.txt');

    const r = await withAuthedRequest(user.id, () => uploadBookFile(fd));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Drive the worker job inline against real ClamAV
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
