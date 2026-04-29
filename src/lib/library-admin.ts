import { TRPCError } from '@trpc/server';
import type { PrismaClient } from '@prisma/client';
import { db } from './db';

export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'library'
  );
}

export async function slugifyUnique(
  name: string,
  client: PrismaClient = db as unknown as PrismaClient,
): Promise<string> {
  const base = slugify(name);
  for (let i = 1; i <= 100; i++) {
    const candidate = i === 1 ? base : `${base}-${i}`;
    const exists = await client.library.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!exists) return candidate;
  }
  throw new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: `unable to generate unique slug from "${name}" (base: "${base}")`,
  });
}

export async function assertLibraryNotArchived(libraryId: string): Promise<void> {
  const lib = await db.library.findUnique({
    where: { id: libraryId },
    select: { archivedAt: true },
  });
  if (!lib) throw new TRPCError({ code: 'NOT_FOUND' });
  if (lib.archivedAt) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'library archived' });
  }
}

export async function assertNotLastLibraryAdmin(membership: {
  libraryId: string;
  userId: string;
}): Promise<void> {
  const target = await db.libraryMember.findUnique({
    where: { userId_libraryId: { userId: membership.userId, libraryId: membership.libraryId } },
    select: { role: true },
  });
  if (!target || target.role !== 'LIBRARY_ADMIN') return;
  const otherAdmins = await db.libraryMember.count({
    where: {
      libraryId: membership.libraryId,
      role: 'LIBRARY_ADMIN',
      NOT: { userId: membership.userId },
    },
  });
  if (otherAdmins === 0) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'cannot remove or demote the last library admin',
    });
  }
}
