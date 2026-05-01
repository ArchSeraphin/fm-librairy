import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getTestPrisma, truncateAll } from './setup/prisma';
import { makeCtxForRole } from './_helpers/auth-ctx';

const prisma = getTestPrisma();

const sessionMock = vi.hoisted(() => vi.fn());
vi.mock('@/server/auth/session-bridge', () => ({
  getCurrentSessionAndUser: sessionMock,
}));

import { GET } from '@/app/api/covers/[bookId]/route';

async function callRoute(bookId: string) {
  return GET(new Request(`http://localhost/api/covers/${bookId}`) as any, {
    params: Promise.resolve({ bookId }),
  });
}

let storageRoot: string;

beforeAll(async () => {
  storageRoot = await mkdtemp(join(tmpdir(), 'biblio-covers-test-'));
  process.env.STORAGE_ROOT = storageRoot;
});

describe('GET /api/covers/[bookId]', () => {
  beforeEach(async () => {
    await truncateAll();
    sessionMock.mockReset();
  });

  it('returns 200 + image/jpeg for an authed member of the book library', async () => {
    const { user, libraryId } = await makeCtxForRole('MEMBER');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId! } });
    const book = await prisma.book.create({
      data: { libraryId: lib.id, title: 'X', authors: ['A'] },
    });
    await prisma.book.update({
      where: { id: book.id },
      data: { coverPath: `covers/${book.id}.jpg` },
    });
    await mkdir(join(storageRoot, 'covers'), { recursive: true });
    await writeFile(join(storageRoot, 'covers', `${book.id}.jpg`), Buffer.from([0xff, 0xd8, 0xff, 0xe0]));

    sessionMock.mockResolvedValue({ session: {}, user: { id: user!.id, role: 'USER' } });
    const res = await callRoute(book.id);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toMatch(/max-age/);
  });

  it('returns 404 when book has no cover', async () => {
    const { user, libraryId } = await makeCtxForRole('MEMBER');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId! } });
    const book = await prisma.book.create({
      data: { libraryId: lib.id, title: 'X', authors: ['A'] },
    });
    sessionMock.mockResolvedValue({ session: {}, user: { id: user!.id, role: 'USER' } });
    const res = await callRoute(book.id);
    expect(res.status).toBe(404);
  });

  it('returns 401 when no session', async () => {
    const { libraryId } = await makeCtxForRole('MEMBER');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId! } });
    const book = await prisma.book.create({
      data: { libraryId: lib.id, title: 'X', authors: ['A'], coverPath: 'covers/x.jpg' },
    });
    sessionMock.mockResolvedValue(null);
    const res = await callRoute(book.id);
    expect(res.status).toBe(401);
  });

  it('returns 403 for an outsider (not a member of the library)', async () => {
    const { libraryId } = await makeCtxForRole('MEMBER');
    const lib = await prisma.library.findUniqueOrThrow({ where: { id: libraryId! } });
    const book = await prisma.book.create({
      data: { libraryId: lib.id, title: 'X', authors: ['A'], coverPath: 'covers/x.jpg' },
    });
    const outsider = await prisma.user.create({
      data: {
        email: `outsider-cover-${Date.now()}@e2e.test`,
        passwordHash: 'x',
        displayName: 'Outsider',
        role: 'USER',
        status: 'ACTIVE',
      },
    });
    sessionMock.mockResolvedValue({ session: {}, user: { id: outsider.id, role: 'USER' } });
    const res = await callRoute(book.id);
    expect(res.status).toBe(403);
  });
});
