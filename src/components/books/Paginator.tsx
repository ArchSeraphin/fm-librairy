'use client';

import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function Paginator({
  hasNext,
  onNext,
  hasPrev,
  onPrev,
}: {
  hasNext: boolean;
  onNext: () => void;
  hasPrev: boolean;
  onPrev: () => void;
}) {
  const t = useTranslations('books.paginator');
  return (
    <div className="flex items-center justify-between border-t pt-4">
      <Button variant="outline" size="sm" onClick={onPrev} disabled={!hasPrev}>
        <ChevronLeft className="mr-1 h-4 w-4" aria-hidden />
        {t('prev')}
      </Button>
      <Button variant="outline" size="sm" onClick={onNext} disabled={!hasNext}>
        {t('next')}
        <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
      </Button>
    </div>
  );
}
