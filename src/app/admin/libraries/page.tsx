import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LibrariesTable } from './LibrariesTable';
import { CreateLibraryDialog } from './CreateLibraryDialog';

export const metadata: Metadata = {
  title: 'Bibliothèques — BiblioShare Admin',
  robots: { index: false, follow: false },
};

export default async function AdminLibrariesPage() {
  const t = await getTranslations('admin.libraries');
  return (
    <section className="animate-slide-up space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('pageTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <CreateLibraryDialog />
      </header>
      <LibrariesTable />
    </section>
  );
}
