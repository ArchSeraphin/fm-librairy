'use client';

import { useTranslations } from 'next-intl';
import { ClipboardList } from 'lucide-react';

import { trpc } from '@/lib/trpc/client';

interface Props {
  userId: string;
  limit?: number;
}

export function UserAuditExcerpt({ userId, limit = 10 }: Props) {
  const t = useTranslations('admin.users.detail');

  const query = trpc.admin.users.audit.list.useQuery({ userId, limit });

  if (query.isLoading) {
    return <p className="text-sm text-muted-foreground">…</p>;
  }

  const items = query.data?.items ?? [];

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
          <ClipboardList className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        </div>
        <p className="text-sm text-muted-foreground">{t('noAudit')}</p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {items.map((entry) => (
        <li
          key={entry.id}
          className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-xs font-medium text-foreground">{entry.action}</p>
            {entry.metadata != null && (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {JSON.stringify(entry.metadata)}
              </p>
            )}
          </div>
          <time
            dateTime={new Date(entry.createdAt).toISOString()}
            className="shrink-0 text-xs text-muted-foreground"
          >
            {new Date(entry.createdAt).toLocaleDateString('fr-FR', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
          </time>
        </li>
      ))}
    </ul>
  );
}
