import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireMembership } from '@/server/auth/member-guard';
import { CreateBookForm } from './CreateBookForm';

export default async function NewBookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const t = await getTranslations('books.new');
  const { user, membership } = await requireMembership(slug);
  const isAdmin = user.role === 'GLOBAL_ADMIN' || membership?.role === 'LIBRARY_ADMIN';
  if (!isAdmin) redirect(`/library/${slug}/books?error=forbidden`);
  return (
    <section className="max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t('pageTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>
      <CreateBookForm slug={slug} />
    </section>
  );
}
