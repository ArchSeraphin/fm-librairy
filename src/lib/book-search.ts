import { Prisma, type ScanStatus, type MetadataFetchStatus } from '@prisma/client';
import { db } from '@/lib/db';

export type BookSort = 'title_asc' | 'createdAt_desc' | 'createdAt_asc';

export interface SearchInput {
  libraryId: string;
  q?: string;
  hasDigital?: boolean;
  hasPhysical?: boolean;
  language?: string;
  sort?: BookSort;
  cursor?: string;
  limit: number;
  includeArchived?: boolean;
}

export interface BookRow {
  id: string;
  libraryId: string;
  title: string;
  authors: string[];
  isbn10: string | null;
  isbn13: string | null;
  publisher: string | null;
  publishedYear: number | null;
  language: string | null;
  description: string | null;
  coverPath: string | null;
  hasDigital: boolean;
  hasPhysical: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** scanStatus of the earliest file for this book, or null if none. */
  firstFileScanStatus: ScanStatus | null;
  metadataFetchStatus: MetadataFetchStatus | null;
}

export interface SearchResult {
  items: BookRow[];
  nextCursor: string | null;
}

const MIN_Q_CHARS = 2;

export async function buildSearchQuery(input: SearchInput): Promise<SearchResult> {
  const sort: BookSort = input.sort ?? 'createdAt_desc';
  const useFullText = (input.q?.trim().length ?? 0) >= MIN_Q_CHARS;
  const fetchLimit = input.limit + 1; // over-fetch by one to detect nextCursor

  // Build parameterized WHERE clauses — every value goes through Prisma.sql bindings.
  const where: Prisma.Sql[] = [Prisma.sql`b."libraryId" = ${input.libraryId}`];

  if (!input.includeArchived) {
    where.push(Prisma.sql`b."archivedAt" IS NULL`);
  }

  if (input.hasDigital !== undefined) {
    where.push(Prisma.sql`b."hasDigital" = ${input.hasDigital}`);
  }

  if (input.hasPhysical !== undefined) {
    where.push(Prisma.sql`b."hasPhysical" = ${input.hasPhysical}`);
  }

  if (input.language) {
    where.push(Prisma.sql`b."language" = ${input.language}`);
  }

  if (useFullText) {
    // q is guaranteed ≥ MIN_Q_CHARS here; bind it as a parameter (never interpolated).
    where.push(
      Prisma.sql`b."searchVector" @@ plainto_tsquery('simple', unaccent(${input.q!.trim()}))`,
    );
  }

  // Cursor: opaque base64url of "<sortKey>|<id>".
  // sortKey is title (for title_asc) or ISO datetime (for createdAt sorts).
  if (input.cursor) {
    const decoded = Buffer.from(input.cursor, 'base64url').toString('utf8');
    const pipeIndex = decoded.indexOf('|');
    const sortKey = decoded.slice(0, pipeIndex);
    const id = decoded.slice(pipeIndex + 1);

    if (sort === 'title_asc') {
      // (title, id) > (sortKey, id) — keyset over tuple
      where.push(Prisma.sql`(b."title", b."id") > (${sortKey}, ${id})`);
    } else if (sort === 'createdAt_desc') {
      where.push(Prisma.sql`(b."createdAt", b."id") < (${new Date(sortKey)}, ${id})`);
    } else {
      // createdAt_asc
      where.push(Prisma.sql`(b."createdAt", b."id") > (${new Date(sortKey)}, ${id})`);
    }
  }

  let orderBy: Prisma.Sql;
  if (sort === 'title_asc') {
    orderBy = Prisma.sql`b."title" ASC, b."id" ASC`;
  } else if (sort === 'createdAt_desc') {
    orderBy = Prisma.sql`b."createdAt" DESC, b."id" DESC`;
  } else {
    orderBy = Prisma.sql`b."createdAt" ASC, b."id" ASC`;
  }

  const whereClause = Prisma.join(where, ' AND ');

  const rows = await db.$queryRaw<BookRow[]>`
    SELECT b."id", b."libraryId", b."title", b."authors", b."isbn10", b."isbn13",
           b."publisher", b."publishedYear", b."language", b."description",
           b."coverPath", b."hasDigital", b."hasPhysical", b."archivedAt",
           b."createdAt", b."updatedAt", b."metadataFetchStatus",
           (
             SELECT f."scanStatus"
             FROM "BookFile" f
             WHERE f."bookId" = b."id"
             ORDER BY f."createdAt" ASC
             LIMIT 1
           ) AS "firstFileScanStatus"
    FROM "Book" b
    WHERE ${whereClause}
    ORDER BY ${orderBy}
    LIMIT ${fetchLimit}
  `;

  let nextCursor: string | null = null;
  let items = rows;

  if (rows.length > input.limit) {
    items = rows.slice(0, input.limit);
    const last = items[items.length - 1]!;
    const sortKey = sort === 'title_asc' ? last.title : last.createdAt.toISOString();
    nextCursor = Buffer.from(`${sortKey}|${last.id}`, 'utf8').toString('base64url');
  }

  return { items, nextCursor };
}
