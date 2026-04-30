import { notFound } from 'next/navigation';
import { requireMembership } from '@/server/auth/member-guard';
import { db } from '@/lib/db';
import { BookDetail } from './BookDetail';

export default async function BookDetailPage({
  params,
}: {
  params: Promise<{ slug: string; bookId: string }>;
}) {
  const { slug, bookId } = await params;
  const { user, library, membership } = await requireMembership(slug);
  const isAdmin = user.role === 'GLOBAL_ADMIN' || membership?.role === 'LIBRARY_ADMIN';
  const isGlobalAdmin = user.role === 'GLOBAL_ADMIN';
  const book = await db.book.findUnique({
    where: { id: bookId },
    include: {
      physicalCopy: true,
      _count: { select: { files: true } },
    },
  });
  if (!book || book.libraryId !== library.id) notFound();
  if (!isAdmin && book.archivedAt !== null) notFound();
  return <BookDetail slug={slug} book={book} isAdmin={isAdmin} isGlobalAdmin={isGlobalAdmin} />;
}
