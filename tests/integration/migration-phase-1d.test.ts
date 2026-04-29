import { beforeEach, describe, expect, test } from 'vitest';
import { getTestPrisma, truncateAll } from './setup/prisma';

const prisma = getTestPrisma();

beforeEach(async () => {
  await truncateAll();
});

describe('Phase 1D migration smoke', () => {
  test('Book.archivedAt is nullable and writable', async () => {
    const lib = await prisma.library.create({
      data: { name: 'M-Test', slug: `m-test-${Date.now()}` },
    });
    const book = await prisma.book.create({
      data: { libraryId: lib.id, title: 'Test', authors: ['A'] },
    });
    expect(book.archivedAt).toBeNull();
    const archived = await prisma.book.update({
      where: { id: book.id },
      data: { archivedAt: new Date() },
    });
    expect(archived.archivedAt).toBeInstanceOf(Date);
  });

  test('searchVector is populated automatically and indexable, accent-insensitive', async () => {
    const lib = await prisma.library.create({
      data: { name: 'M-Test2', slug: `m-test-${Date.now()}-2` },
    });
    await prisma.book.create({
      data: {
        libraryId: lib.id,
        title: 'Le Petit Prince',
        authors: ['Saint-Exupéry'],
        description: 'Conte philosophique',
      },
    });
    const result = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM "Book"
      WHERE "libraryId" = ${lib.id}
        AND "searchVector" @@ plainto_tsquery('simple', unaccent('petit prince'))
    `;
    expect(Number(result[0]?.count)).toBe(1);
    const result2 = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM "Book"
      WHERE "libraryId" = ${lib.id}
        AND "searchVector" @@ plainto_tsquery('simple', unaccent('saint exupery'))
    `;
    expect(Number(result2[0]?.count)).toBe(1);
  });
});
