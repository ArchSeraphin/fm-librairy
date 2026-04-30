'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { LibraryBig, Users, BookOpen } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export function LibrariesGrid() {
  const t = useTranslations('member.libraries');
  const { data, isLoading } = trpc.library.libraries.listAccessible.useQuery();

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-32 rounded-lg" />
        ))}
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {t('empty')}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {data.map((lib) => (
        <Link key={lib.id} href={`/library/${lib.slug}/books`}>
          <Card className="h-full transition hover:border-foreground/30 hover:shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LibraryBig className="h-5 w-5" aria-hidden />
                {lib.name}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" aria-hidden />
              </span>
              <span className="flex items-center gap-1">
                <BookOpen className="h-3.5 w-3.5" aria-hidden />
              </span>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
