// tests/integration/library-files-router.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { appRouter } from '@/server/trpc/routers/_app';
import type { TrpcContext } from '@/server/trpc/context';
import { getTestPrisma, truncateAll } from './setup/prisma';

const prisma = getTestPrisma();
let user: { id: string };
let library: { id: string; slug: string };
let book: { id: string };
let bf: { id: string; storagePath: string };
let storageRoot: string;
let session: any;
let userRow: any;

beforeEach(async () => {
  await truncateAll();
  storageRoot = mkdtempSync(path.join(tmpdir(), 'biblio-files-router-'));
  process.env.STORAGE_ROOT = storageRoot;

  userRow = await prisma.user.create({
    data: {
      email: `f-${Date.now()}@x.local`,
      displayName: 'F',
      passwordHash: 'x',
      emailVerifiedAt: new Date(),
      role: 'USER',
      status: 'ACTIVE',
    },
  });
  user = { id: userRow.id };
  library = await prisma.library.create({
    data: { name: 'L', slug: `f-${Date.now()}` },
  });
  await prisma.libraryMember.create({
    data: { userId: user.id, libraryId: library.id, role: 'LIBRARY_ADMIN' },
  });
  book = await prisma.book.create({
    data: { libraryId: library.id, title: 'T', authors: ['A'], uploadedById: user.id },
  });
  const dir = path.join(storageRoot, 'library', library.id, book.id);
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'aaaa.epub');
  writeFileSync(filePath, 'content');
  const bfRow = await prisma.bookFile.create({
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
  bf = { id: bfRow.id, storagePath: bfRow.storagePath };

  // Build a session row for the user — uses sessionToken (not tokenHash)
  session = await prisma.session.create({
    data: {
      sessionToken: `test-${user.id}-${Date.now()}`,
      userId: user.id,
      expiresAt: new Date(Date.now() + 3600_000),
      ipHash: 'a'.repeat(64),
      userAgentHash: 'a'.repeat(64),
      pending2fa: false,
    },
  });
});

afterEach(() => {
  rmSync(storageRoot, { recursive: true, force: true });
});

function callerFor(currentUserRow: any, currentSession: any) {
  const ctx: TrpcContext = { session: currentSession, user: currentUserRow, ip: '203.0.113.1' };
  return appRouter.createCaller(ctx);
}

describe('library.files.get', () => {
  it('returns BookFile rows for the book scoped to the library', async () => {
    const caller = callerFor(userRow, session);
    const r = await caller.library.files.get({ slug: library.slug, bookId: book.id });
    expect(r).toHaveLength(1);
    const first = r[0]!;
    expect(first.id).toBe(bf.id);
    expect(first.scanStatus).toBe('CLEAN');
  });
});

describe('library.files.delete', () => {
  it('LIBRARY_ADMIN deletes file (DB + disk) and writes AuditLog', async () => {
    const caller = callerFor(userRow, session);
    await caller.library.files.delete({ slug: library.slug, id: bf.id });
    const remaining = await prisma.bookFile.findUnique({ where: { id: bf.id } });
    expect(remaining).toBeNull();
    expect(existsSync(bf.storagePath)).toBe(false);
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
    const refreshedUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const caller = callerFor(refreshedUser, session);
    await expect(
      caller.library.files.delete({ slug: library.slug, id: bf.id }),
    ).rejects.toThrow(/FORBIDDEN/);
  });
});
