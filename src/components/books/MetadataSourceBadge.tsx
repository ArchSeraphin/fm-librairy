'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import type { MetadataSource } from '@prisma/client';

const SOURCE_LABEL: Record<MetadataSource, string> = {
  GOOGLE_BOOKS: 'Google Books',
  OPEN_LIBRARY: 'Open Library',
  ISBNDB: 'ISBNdb',
  MANUAL: 'Saisie manuelle',
};

export function MetadataSourceBadge({
  slug,
  bookId,
  source,
  fetchedAt,
  canRefresh,
  isPending,
}: {
  slug: string;
  bookId: string;
  source: MetadataSource | null;
  fetchedAt: Date | null;
  canRefresh: boolean;
  isPending: boolean;
}) {
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const refresh = trpc.library.books.refreshMetadata.useMutation({
    onSuccess: () => {
      toast({ title: 'Rafraîchissement demandé', description: 'La récupération est en cours.' });
      utils.library.books.get.invalidate({ slug, id: bookId });
    },
    onError: (err) => {
      const msg =
        err.data?.code === 'TOO_MANY_REQUESTS'
          ? 'Trop de tentatives — réessayez dans 1 h.'
          : err.message;
      toast({ variant: 'destructive', title: 'Échec', description: msg });
    },
    onSettled: () => setBusy(false),
  });

  const sourceLabel = source ? SOURCE_LABEL[source] : 'Aucune';
  const dateLabel = fetchedAt ? new Intl.DateTimeFormat('fr-FR').format(fetchedAt) : '—';

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <span>
        Source : {sourceLabel}
        {fetchedAt && ` · récupéré le ${dateLabel}`}
      </span>
      {canRefresh && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy || isPending}
          onClick={() => {
            setBusy(true);
            refresh.mutate({ slug, id: bookId });
          }}
        >
          {isPending ? 'En cours…' : 'Rafraîchir'}
        </Button>
      )}
    </div>
  );
}
