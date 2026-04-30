'use client';

import { useTranslations } from 'next-intl';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useUrlState } from '@/lib/url-state';

const SORTS = ['createdAt_desc', 'createdAt_asc', 'title_asc'] as const;

export function BookSortSelect() {
  const t = useTranslations('books.sort');
  const { searchParams, set } = useUrlState();
  const value = (searchParams.get('sort') ?? 'createdAt_desc') as (typeof SORTS)[number];
  return (
    <Select value={value} onValueChange={(v) => set({ sort: v, cursor: undefined })}>
      <SelectTrigger className="w-[200px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SORTS.map((s) => (
          <SelectItem key={s} value={s}>
            {t(s)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
