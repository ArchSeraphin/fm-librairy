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

export function DeleteBookDialog({
  slug,
  bookId,
  onClose,
}: {
  slug: string;
  bookId: string;
  onClose: () => void;
}) {
  const t = useTranslations('books.dialogs.delete');
  const router = useRouter();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const del = trpc.library.books.delete.useMutation({
    onSuccess: () => {
      toast({ title: t('successToast') });
      utils.library.books.invalidate();
      router.push(`/library/${slug}/books`);
      onClose();
    },
    onError: (err) => {
      if (err.data?.code === 'BAD_REQUEST' && err.message?.includes('dependencies')) {
        toast({
          title: t('depsTitle'),
          description: err.message,
          variant: 'destructive',
        });
      } else {
        toast({ title: t('errorToast'), description: err.message, variant: 'destructive' });
      }
    },
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-destructive">{t('warning')}</p>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={del.isPending}>
            {t('cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={() => del.mutate({ slug, id: bookId })}
            disabled={del.isPending}
          >
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
