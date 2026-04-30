import { beforeEach, describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import { assertBookInLibrary, assertNotArchived, assertNoBookDependencies } from '@/lib/book-admin';
import { getTestPrisma, truncateAll } from './setup/prisma';

const prisma = getTestPrisma();

/** Minimal Book fixture — only required fields. */
async function createBook(libraryId: string, overrides: Record<string, unknown> = {}) {
  return prisma.book.create({
    data: {
      libraryId,
      title: 'Test Book',
      authors: ['Test Author'],
      ...overrides,
    },
  });
}

/** Minimal Library fixture. */
async function createLibrary(slug = 'test-lib') {
  return prisma.library.create({ data: { name: 'Test Library', slug } });
}

/** Minimal User fixture (needed for PhysicalCopy ownerId). */
async function createUser(suffix = '') {
  return prisma.user.create({
    data: {
      email: `testuser${suffix}@e2e.test`,
      passwordHash: 'x',
      displayName: `Test User ${suffix}`,
      role: 'USER',
      status: 'ACTIVE',
    },
  });
}

describe('assertBookInLibrary', () => {
  beforeEach(truncateAll);

  // 1. Returns the book when bookId + libraryId match
  it('returns the book when it belongs to the library', async () => {
    const lib = await createLibrary();
    const book = await createBook(lib.id);

    const result = await assertBookInLibrary(book.id, lib.id);

    expect(result.id).toBe(book.id);
    expect(result.libraryId).toBe(lib.id);
  });

  // 2. Throws NOT_FOUND when the bookId does not exist
  it('throws NOT_FOUND for a non-existent bookId', async () => {
    const lib = await createLibrary();

    await expect(assertBookInLibrary('nonexistent-id', lib.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  // 3. Throws NOT_FOUND when the book belongs to a different library (no enumeration)
  it('throws NOT_FOUND when the book belongs to a different library', async () => {
    const lib1 = await createLibrary('lib-1');
    const lib2 = await createLibrary('lib-2');
    const book = await createBook(lib1.id);

    await expect(assertBookInLibrary(book.id, lib2.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('assertNotArchived', () => {
  // 4. Does not throw when archivedAt is null
  it('does not throw when archivedAt is null', () => {
    expect(() => assertNotArchived({ archivedAt: null })).not.toThrow();
  });

  // 5. Throws BAD_REQUEST when archivedAt is set
  it('throws BAD_REQUEST when archivedAt is set', () => {
    expect(() => assertNotArchived({ archivedAt: new Date() })).toThrow(
      expect.objectContaining({ code: 'BAD_REQUEST' } satisfies Partial<TRPCError>),
    );
  });
});

describe('assertNoBookDependencies', () => {
  beforeEach(truncateAll);

  // 6. Does not throw when the book has no dependent rows
  it('does not throw when the book has no dependencies', async () => {
    const lib = await createLibrary();
    const book = await createBook(lib.id);

    await expect(assertNoBookDependencies(book.id)).resolves.toBeUndefined();
  });

  // 7. Throws NOT_FOUND when bookId does not exist
  it('throws NOT_FOUND for a non-existent bookId', async () => {
    await expect(assertNoBookDependencies('nonexistent-id')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  // 8. Throws BAD_REQUEST listing dependencies — PhysicalCopy (1-to-1)
  it('throws BAD_REQUEST listing physicalCopy when a PhysicalCopy exists', async () => {
    const lib = await createLibrary();
    const book = await createBook(lib.id);
    const user = await createUser('owner');

    await prisma.physicalCopy.create({
      data: {
        bookId: book.id,
        ownerId: user.id,
      },
    });

    await expect(assertNoBookDependencies(book.id)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringContaining('physicalCopy'),
    });
  });
});
