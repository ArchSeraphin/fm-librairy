'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useUrlState } from '@/lib/url-state';

const DEBOUNCE_MS = 300;

export function BookSearchBar() {
  const t = useTranslations('books.search');
  const { searchParams, set } = useUrlState();
  const initial = searchParams.get('q') ?? '';
  const [value, setValue] = useState(initial);

  useEffect(() => {
    const id = setTimeout(() => {
      if (value !== initial) set({ q: value, cursor: undefined });
    }, DEBOUNCE_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t('placeholder')}
        aria-label={t('label')}
        className="pl-9"
      />
    </div>
  );
}
