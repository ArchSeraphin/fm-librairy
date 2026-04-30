import { beforeEach, describe, expect, it } from 'vitest';
import { buildSearchQuery } from '@/lib/book-search';
import { getTestPrisma, truncateAll } from './setup/prisma';

const prisma = getTestPrisma();

const SEEDS = [
  { title: 'Le Petit Prince', authors: ['Saint-Exupéry'], language: 'fr', publisher: 'Gallimard' },
  { title: 'Frankenstein', authors: ['Mary Shelley'], language: 'en', publisher: 'Penguin' },
  { title: 'Les Misérables', authors: ['Victor Hugo'], language: 'fr', publisher: 'Gallimard' },
  {
    title: 'Don Quichotte',
    authors: ['Miguel de Cervantès'],
    language: 'es',
    publisher: 'Galaxia',
  },
  { title: '1984', authors: ['George Orwell'], language: 'en', publisher: 'Penguin' },
];

let libId: string;
const bookIds: string[] = [];

describe('buildSearchQuery', () => {
  // Use beforeEach + truncateAll because containers.ts runs truncateAll between tests.
  // Each test pays a small seeding cost but is fully isolated.
  beforeEach(async () => {
    await truncateAll();
    bookIds.length = 0;

    const lib = await prisma.library.create({
      data: { name: 'Search Test Lib', slug: `search-${Date.now()}` },
    });
    libId = lib.id;

    for (const s of SEEDS) {
      const b = await prisma.book.create({ data: { libraryId: libId, ...s } });
      bookIds.push(b.id);
    }
  });

  // 1: returns all books with no q, no filters
  it('returns all books with no q, no filters, default sort', async () => {
    const result = await buildSearchQuery({ libraryId: libId, limit: 50 });
    expect(result.items.length).toBe(5);
    expect(result.nextCursor).toBeNull();
  });

  // 2: filters by language (fr → 2 books)
  it('filters by language', async () => {
    const result = await buildSearchQuery({ libraryId: libId, language: 'fr', limit: 50 });
    expect(result.items.length).toBe(2);
    expect(result.items.map((b) => b.title)).toEqual(
      expect.arrayContaining(['Le Petit Prince', 'Les Misérables']),
    );
  });

  // 3: full-text accent-insensitive (miserables finds Les Misérables)
  it('full-text search matches title with accent insensitivity', async () => {
    const result = await buildSearchQuery({ libraryId: libId, q: 'miserables', limit: 50 });
    expect(result.items.map((b) => b.title)).toContain('Les Misérables');
  });

  // 4: q < 2 chars is silently ignored (returns all)
  it('search query too short (<2 chars) is silently ignored', async () => {
    const result = await buildSearchQuery({ libraryId: libId, q: 'a', limit: 50 });
    expect(result.items.length).toBe(5);
  });

  // 5: cursor pagination — page 1 has nextCursor, page 2 advances correctly
  it('cursor pagination returns nextCursor when more results exist', async () => {
    const page1 = await buildSearchQuery({ libraryId: libId, limit: 2, sort: 'title_asc' });
    expect(page1.items.length).toBe(2);
    expect(page1.nextCursor).toBeTruthy();

    const page2 = await buildSearchQuery({
      libraryId: libId,
      limit: 2,
      sort: 'title_asc',
      cursor: page1.nextCursor!,
    });
    expect(page2.items.length).toBe(2);
    expect(page2.items[0]!.id).not.toBe(page1.items[0]!.id);
    expect(page2.items[0]!.id).not.toBe(page1.items[1]!.id);
  });

  // 6: SQL injection patterns are safely parameterized
  it('SQL injection patterns are safely parameterized', async () => {
    const result = await buildSearchQuery({
      libraryId: libId,
      q: `'; DROP TABLE "Book"; --`,
      limit: 50,
    });
    // table still exists and all books are intact
    const stillThere = await prisma.book.count({ where: { libraryId: libId } });
    expect(stillThere).toBe(5);
    // no match for that injection string
    expect(result.items.length).toBe(0);
  });

  // 7: archived books excluded by default
  it('archived books are excluded by default', async () => {
    const target = bookIds[0];
    await prisma.book.update({ where: { id: target }, data: { archivedAt: new Date() } });

    const result = await buildSearchQuery({ libraryId: libId, limit: 50 });
    expect(result.items.find((b) => b.id === target)).toBeUndefined();
    expect(result.items.length).toBe(4);
  });

  // 8: includeArchived=true returns archived too
  it('includeArchived=true returns archived books', async () => {
    const target = bookIds[0];
    await prisma.book.update({ where: { id: target }, data: { archivedAt: new Date() } });

    const result = await buildSearchQuery({ libraryId: libId, limit: 50, includeArchived: true });
    expect(result.items.find((b) => b.id === target)).toBeDefined();
    expect(result.items.length).toBe(5);
  });
});
