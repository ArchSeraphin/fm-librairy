'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { trpc } from '@/lib/trpc/client';
import { useUrlState } from '@/lib/url-state';
import { BookSearchBar } from '@/components/books/BookSearchBar';
import { BookFilters } from '@/components/books/BookFilters';
import { BookSortSelect } from '@/components/books/BookSortSelect';
import { BookListGrid } from '@/components/books/BookListGrid';
import { Paginator } from '@/components/books/Paginator';

export function BooksCatalog({ slug, isAdmin }: { slug: string; isAdmin: boolean }) {
  const t = useTranslations('books.catalog');
  const { searchParams, set } = useUrlState();
  const q = searchParams.get('q') ?? undefined;
  const hasDigital = searchParams.get('hasDigital') === 'true' ? true : undefined;
  const hasPhysical = searchParams.get('hasPhysical') === 'true' ? true : undefined;
  const language = searchParams.get('language') ?? undefined;
  const sort = (searchParams.get('sort') ?? 'createdAt_desc') as
    | 'createdAt_desc'
    | 'createdAt_asc'
    | 'title_asc';
  const cursor = searchParams.get('cursor') ?? undefined;
  const includeArchived = isAdmin && searchParams.get('includeArchived') === 'true';

  // Cursor history for "previous" navigation
  const [history, setHistory] = useState<string[]>([]);

  const { data, isLoading, isFetching } = trpc.library.books.list.useQuery({
    slug,
    q,
    hasDigital,
    hasPhysical,
    language,
    sort,
    cursor,
    limit: 24,
    includeArchived,
  });

  const onNext = () => {
    if (data?.nextCursor) {
      setHistory((h) => [...h, cursor ?? '']);
      set({ cursor: data.nextCursor });
    }
  };
  const onPrev = () => {
    setHistory((h) => {
      const next = [...h];
      const popped = next.pop() ?? '';
      set({ cursor: popped || undefined });
      return next;
    });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
      <div className="space-y-4">
        <BookFilters />
        {isAdmin && (
          <label className="flex cursor-pointer items-center gap-2 px-1 text-sm">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => set({ includeArchived: e.target.checked || undefined })}
            />
            {t('showArchived')}
          </label>
        )}
      </div>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-[240px] flex-1">
            <BookSearchBar />
          </div>
          <BookSortSelect />
        </div>
        <BookListGrid slug={slug} books={data?.items ?? []} isLoading={isLoading || isFetching} />
        <Paginator
          hasNext={Boolean(data?.nextCursor)}
          onNext={onNext}
          hasPrev={history.length > 0}
          onPrev={onPrev}
        />
      </div>
    </div>
  );
}
