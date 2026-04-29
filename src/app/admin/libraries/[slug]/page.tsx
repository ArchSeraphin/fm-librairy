import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { db } from '@/lib/db';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LibrarySettings } from './LibrarySettings';
import { MembersPanel } from './MembersPanel';

export const metadata = { robots: { index: false, follow: false } };

export default async function AdminLibraryDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const t = await getTranslations('admin.libraries.detail');
  const lib = await db.library.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      archivedAt: true,
      createdAt: true,
    },
  });
  if (!lib) notFound();

  return (
    <section className="animate-slide-up space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href="/admin/libraries">
          <ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" />
          {t('back')}
        </Link>
      </Button>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{lib.name}</CardTitle>
          <p className="font-mono text-sm text-muted-foreground">{lib.slug}</p>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('tabSettings')}</CardTitle>
        </CardHeader>
        <CardContent>
          <LibrarySettings
            libraryId={lib.id}
            initialName={lib.name}
            initialDescription={lib.description}
            archivedAt={lib.archivedAt?.toISOString() ?? null}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('tabMembers')}</CardTitle>
        </CardHeader>
        <CardContent>
          <MembersPanel libraryId={lib.id} archived={lib.archivedAt !== null} />
        </CardContent>
      </Card>
    </section>
  );
}
