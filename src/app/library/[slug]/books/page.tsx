import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { requireMembership } from '@/server/auth/member-guard';
import { BooksCatalog } from './BooksCatalog';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Catalogue ${slug} — BiblioShare`, robots: { index: false, follow: false } };
}

export default async function BooksCatalogPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const t = await getTranslations('books.page');
  const { user, library, membership } = await requireMembership(slug);
  const isAdmin = user.role === 'GLOBAL_ADMIN' || membership?.role === 'LIBRARY_ADMIN';

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{library.name}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        {isAdmin && (
          <Button asChild>
            <Link href={`/library/${slug}/books/new`}>
              <Plus className="mr-2 h-4 w-4" aria-hidden />
              {t('createCta')}
            </Link>
          </Button>
        )}
      </header>
      <BooksCatalog slug={slug} isAdmin={isAdmin} />
    </section>
  );
}
