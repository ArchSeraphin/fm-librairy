'use client';

import { useTranslations } from 'next-intl';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useUrlState } from '@/lib/url-state';

const LANGUAGES = ['fr', 'en', 'es', 'de', 'it', 'pt'];

export function BookFilters() {
  const t = useTranslations('books.filters');
  const { searchParams, set } = useUrlState();
  const hasDigital = searchParams.get('hasDigital') === 'true';
  const hasPhysical = searchParams.get('hasPhysical') === 'true';
  const language = searchParams.get('language') ?? '';

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <h3 className="text-sm font-medium">{t('title')}</h3>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Checkbox
            id="f-digital"
            checked={hasDigital}
            onCheckedChange={(c) =>
              set({ hasDigital: c === true ? 'true' : undefined, cursor: undefined })
            }
          />
          <Label htmlFor="f-digital" className="text-sm font-normal">
            {t('hasDigital')}
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="f-physical"
            checked={hasPhysical}
            onCheckedChange={(c) =>
              set({ hasPhysical: c === true ? 'true' : undefined, cursor: undefined })
            }
          />
          <Label htmlFor="f-physical" className="text-sm font-normal">
            {t('hasPhysical')}
          </Label>
        </div>
        <div className="space-y-1.5">
          <Label
            htmlFor="f-lang"
            className="text-xs uppercase tracking-wider text-muted-foreground"
          >
            {t('languageLabel')}
          </Label>
          <Select
            value={language || 'all'}
            onValueChange={(v) => set({ language: v === 'all' ? undefined : v, cursor: undefined })}
          >
            <SelectTrigger id="f-lang">
              <SelectValue placeholder={t('languageAny')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('languageAny')}</SelectItem>
              {LANGUAGES.map((l) => (
                <SelectItem key={l} value={l}>
                  {t(`languages.${l}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
