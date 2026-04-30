'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { BookOpen, Package, Archive } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export interface BookCardData {
  id: string;
  title: string;
  authors: string[];
  coverPath: string | null;
  hasDigital: boolean;
  hasPhysical: boolean;
  archivedAt: Date | null;
}

export function BookCard({ slug, book }: { slug: string; book: BookCardData }) {
  const t = useTranslations('books.card');
  return (
    <Link href={`/library/${slug}/books/${book.id}`} className="block focus:outline-none">
      <Card
        className={cn(
          'group h-full overflow-hidden transition hover:border-foreground/30 hover:shadow-sm',
          book.archivedAt && 'opacity-60',
        )}
      >
        <div className="relative aspect-[2/3] overflow-hidden bg-muted">
          {book.coverPath ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={book.coverPath}
              alt={t('coverAlt', { title: book.title })}
              className="h-full w-full object-cover transition group-hover:scale-105"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <BookOpen className="h-12 w-12" aria-hidden />
            </div>
          )}
          {book.archivedAt && (
            <div className="absolute right-2 top-2 rounded-full bg-background/90 px-2 py-1 text-xs">
              <Archive className="mr-1 inline h-3 w-3" aria-hidden />
              {t('archived')}
            </div>
          )}
        </div>
        <CardContent className="space-y-1.5 p-3">
          <h3 className="line-clamp-2 font-medium leading-tight">{book.title}</h3>
          <p className="line-clamp-1 text-xs text-muted-foreground">
            {book.authors.join(', ')}
          </p>
          <div className="flex gap-1.5 pt-1">
            {book.hasDigital && (
              <Badge variant="secondary" className="text-xs">
                <BookOpen className="mr-1 h-3 w-3" aria-hidden />
                {t('digital')}
              </Badge>
            )}
            {book.hasPhysical && (
              <Badge variant="secondary" className="text-xs">
                <Package className="mr-1 h-3 w-3" aria-hidden />
                {t('physical')}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
