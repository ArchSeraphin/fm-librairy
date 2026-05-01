import { NextRequest, NextResponse } from 'next/server';
import { stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getCurrentSessionAndUser } from '@/server/auth/session-bridge';
import { db } from '@/lib/db';
import { getEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ bookId: string }> },
) {
  const ctx = await getCurrentSessionAndUser();
  if (!ctx?.user) return new NextResponse('unauthorized', { status: 401 });

  const { bookId } = await params;

  if (!/^[a-z0-9]+$/.test(bookId)) {
    return new NextResponse('bad id', { status: 400 });
  }

  const book = await db.book.findUnique({
    where: { id: bookId },
    select: { id: true, libraryId: true, coverPath: true, metadataFetchedAt: true },
  });
  if (!book || !book.coverPath) {
    return new NextResponse('not found', { status: 404 });
  }

  if (ctx.user.role !== 'GLOBAL_ADMIN') {
    const member = await db.libraryMember.findUnique({
      where: { userId_libraryId: { userId: ctx.user.id, libraryId: book.libraryId } },
      select: { userId: true },
    });
    if (!member) {
      return new NextResponse('forbidden', { status: 403 });
    }
  }

  const root = getEnv().STORAGE_ROOT;
  const path = join(root, book.coverPath);
  try {
    await stat(path);
  } catch {
    return new NextResponse('not found', { status: 404 });
  }
  const buf = await readFile(path);
  const etag = `"${book.id}-${book.metadataFetchedAt?.getTime() ?? 0}"`;
  return new NextResponse(buf, {
    status: 200,
    headers: {
      'content-type': 'image/jpeg',
      'cache-control': 'public, max-age=86400, immutable',
      etag,
    },
  });
}
