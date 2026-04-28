'use client';

import { useTranslations } from 'next-intl';
import { Monitor } from 'lucide-react';

import { trpc } from '@/lib/trpc/client';
import { useDateFormat } from '@/lib/format-client';

interface Props {
  userId: string;
}

export function UserSessionsList({ userId }: Props) {
  const t = useTranslations('admin.users.detail');
  const format = useDateFormat();

  const query = trpc.admin.users.sessions.list.useQuery({ userId });

  if (query.isLoading) {
    return (
      <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
        {t('loading')}
      </p>
    );
  }

  const items = query.data?.items ?? [];

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
          <Monitor className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        </div>
        <p className="text-sm text-muted-foreground">{t('noSessions')}</p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {items.map((session) => (
        <li key={session.id} className="flex flex-col gap-0.5 py-3 first:pt-0 last:pb-0">
          <p className="text-sm font-medium text-foreground">
            {session.userAgentLabel ?? t('sessionUnknownDevice')}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('sessionCreatedAt')}{' '}
            {format.date(session.createdAt)}{' '}
            &middot; {t('sessionLastActiveAt')}{' '}
            {format.date(session.lastSeenAt)}
          </p>
        </li>
      ))}
    </ul>
  );
}
