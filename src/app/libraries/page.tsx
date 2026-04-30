import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LibrariesGrid } from './LibrariesGrid';

export const metadata: Metadata = {
  title: 'Mes bibliothèques — BiblioShare',
  robots: { index: false, follow: false },
};

export default async function LibrariesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const t = await getTranslations('member.libraries');
  const sp = await searchParams;
  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t('pageTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>
      {sp.error === 'not-a-member' && (
        <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm">
          {t('errors.notAMember')}
        </div>
      )}
      {sp.error === 'not-found' && (
        <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm">
          {t('errors.notFound')}
        </div>
      )}
      <LibrariesGrid />
    </section>
  );
}
