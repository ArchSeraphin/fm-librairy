'use client';

import { useTranslations } from 'next-intl';
import { Monitor } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useDateFormat } from '@/lib/format-client';

export function SessionsCard() {
  const t = useTranslations('account.security.sessions');
  const tRoot = useTranslations('account.security');
  const { toast } = useToast();
  const { dateTime } = useDateFormat();
  const utils = trpc.useUtils();

  const list = trpc.account.security.listSessions.useQuery();

  const revokeSession = trpc.account.security.revokeSession.useMutation({
    onSuccess: () => {
      toast({ title: t('revokedToast') });
      utils.account.security.listSessions.invalidate();
    },
    onError: (err) =>
      toast({ title: tRoot('errorToast'), description: err.message, variant: 'destructive' }),
  });

  const revokeAllOthers = trpc.account.security.revokeAllOtherSessions.useMutation({
    onSuccess: () => {
      toast({ title: t('revokedAllToast') });
      utils.account.security.listSessions.invalidate();
    },
    onError: (err) =>
      toast({ title: tRoot('errorToast'), description: err.message, variant: 'destructive' }),
  });

  const items = list.data?.items ?? [];
  const otherCount = items.filter((s) => !s.isCurrent).length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Monitor className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div>
            <CardTitle className="text-base">{t('title')}</CardTitle>
            <CardDescription className="mt-1">{t('description')}</CardDescription>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={otherCount === 0 || revokeAllOthers.isPending}
          onClick={() => revokeAllOthers.mutate()}
        >
          {t('revokeAllOthers')}
        </Button>
      </CardHeader>
      <CardContent>
        {list.isLoading ? (
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
            {t('loading')}
          </p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul className="divide-y">
            {items.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {s.userAgentLabel ?? t('unknownDevice')}
                    </span>
                    {s.isCurrent && (
                      <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary ring-1 ring-inset ring-primary/20">
                        {t('currentBadge')}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t('lastActive', { time: dateTime(s.lastSeenAt) })}
                  </p>
                </div>
                {!s.isCurrent && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={revokeSession.isPending}
                    onClick={() => revokeSession.mutate({ sessionId: s.id })}
                  >
                    {t('revoke')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
