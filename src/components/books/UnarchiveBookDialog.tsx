'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export function UnarchiveBookDialog({
  slug,
  bookId,
  onClose,
}: {
  slug: string;
  bookId: string;
  onClose: () => void;
}) {
  const t = useTranslations('books.dialogs.unarchive');
  const router = useRouter();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const unarchive = trpc.library.books.unarchive.useMutation({
    onSuccess: () => {
      toast({ title: t('successToast') });
      utils.library.books.invalidate();
      router.refresh();
      onClose();
    },
    onError: (err) => toast({ title: t('errorToast'), description: err.message, variant: 'destructive' }),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={unarchive.isPending}>
            {t('cancel')}
          </Button>
          <Button onClick={() => unarchive.mutate({ slug, id: bookId })} disabled={unarchive.isPending}>
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
