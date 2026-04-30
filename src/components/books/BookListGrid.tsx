'use client';

import { useTranslations } from 'next-intl';
import { Skeleton } from '@/components/ui/skeleton';
import { BookCard, type BookCardData } from './BookCard';

export function BookListGrid({
  slug,
  books,
  isLoading,
}: {
  slug: string;
  books: BookCardData[];
  isLoading: boolean;
}) {
  const t = useTranslations('books.list');
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="aspect-[2/3] rounded-lg" />
        ))}
      </div>
    );
  }
  if (books.length === 0) {
    return (
      <div className="rounded-lg border border-dashed py-16 text-center text-sm text-muted-foreground">
        {t('empty')}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {books.map((b) => (
        <BookCard key={b.id} slug={slug} book={b} scanStatus={b.firstFileScanStatus ?? null} />
      ))}
    </div>
  );
}
