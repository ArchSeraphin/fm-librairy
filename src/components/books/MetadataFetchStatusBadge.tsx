import { Badge } from '@/components/ui/badge';
import type { MetadataFetchStatus } from '@prisma/client';

const LABELS: Record<
  MetadataFetchStatus,
  { text: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  PENDING: { text: 'Métadonnées en cours', variant: 'secondary' },
  FETCHED: { text: 'Métadonnées récupérées', variant: 'outline' },
  NOT_FOUND: { text: 'Aucune metadata trouvée', variant: 'outline' },
  ERROR: { text: 'Échec metadata', variant: 'destructive' },
};

export function MetadataFetchStatusBadge({ status }: { status: MetadataFetchStatus | null }) {
  if (!status) return null;
  const { text, variant } = LABELS[status];
  return <Badge variant={variant}>{text}</Badge>;
}
