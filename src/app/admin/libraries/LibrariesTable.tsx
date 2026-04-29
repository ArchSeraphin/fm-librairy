'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function LibrariesTable() {
  const t = useTranslations('admin.libraries');
  const [q, setQ] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);

  const query = trpc.admin.libraries.list.useInfiniteQuery(
    { q: q || undefined, includeArchived, limit: 20 },
    { getNextPageParam: (last) => last.nextCursor ?? undefined },
  );
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex flex-wrap gap-3 border-b p-4">
          <div className="min-w-[220px] flex-1">
            <Label htmlFor="q-lib" className="sr-only">
              {t('search')}
            </Label>
            <Input
              id="q-lib"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('search')}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
            />
            {t('includeArchived')}
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2">{t('tableName')}</th>
                <th className="px-4 py-2">{t('tableSlug')}</th>
                <th className="px-4 py-2">{t('tableMembers')}</th>
                <th className="px-4 py-2">{t('tableBooks')}</th>
                <th className="px-4 py-2">{t('tableStatus')}</th>
                <th className="px-4 py-2 text-right">{t('tableAction')}</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && !query.isLoading && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                    {t('empty')}
                  </td>
                </tr>
              )}
              {items.map((l) => (
                <tr key={l.id} className="border-t">
                  <td className="px-4 py-2 font-medium">{l.name}</td>
                  <td className="px-4 py-2 font-mono text-xs">{l.slug}</td>
                  <td className="px-4 py-2">{l.counts.members}</td>
                  <td className="px-4 py-2">{l.counts.books}</td>
                  <td className="px-4 py-2">
                    {l.archivedAt ? (
                      <span className="text-destructive">{t('statusArchived')}</span>
                    ) : (
                      <span>{t('statusActive')}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/admin/libraries/${l.slug}`}>{t('open')}</Link>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
