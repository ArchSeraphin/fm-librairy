import { notFound, redirect } from 'next/navigation';
import { requireMembership } from '@/server/auth/member-guard';
import { db } from '@/lib/db';
import { getTranslations } from 'next-intl/server';
import { EditBookForm } from './EditBookForm';

export default async function EditBookPage({
  params,
}: {
  params: Promise<{ slug: string; bookId: string }>;
}) {
  const { slug, bookId } = await params;
  const t = await getTranslations('books.edit');
  const { user, library, membership } = await requireMembership(slug);
  const isAdmin = user.role === 'GLOBAL_ADMIN' || membership?.role === 'LIBRARY_ADMIN';
  if (!isAdmin) redirect(`/library/${slug}/books?error=forbidden`);
  const book = await db.book.findUnique({ where: { id: bookId } });
  if (!book || book.libraryId !== library.id) notFound();
  return (
    <section className="max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t('pageTitle')}</h1>
      </header>
      <EditBookForm slug={slug} book={book} />
    </section>
  );
}
