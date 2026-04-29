'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Archive, ArchiveRestore } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';

type Props = {
  libraryId: string;
  initialName: string;
  initialDescription: string | null;
  archivedAt: string | null;
};

export function LibrarySettings({ libraryId, initialName, initialDescription, archivedAt }: Props) {
  const t = useTranslations('admin.libraries.detail');
  const tLib = useTranslations('admin.libraries');
  const router = useRouter();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const archived = archivedAt !== null;
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? '');
  const [reason, setReason] = useState('');
  const [archiveOpen, setArchiveOpen] = useState(false);

  const onSuccess = () => {
    utils.admin.libraries.invalidate();
    router.refresh();
    toast({ title: tLib('successToast') });
    setArchiveOpen(false);
    setReason('');
  };
  const onError = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    toast({ title: tLib('errorToast'), description: message, variant: 'destructive' });
  };
  const rename = trpc.admin.libraries.rename.useMutation({ onSuccess, onError });
  const archive = trpc.admin.libraries.archive.useMutation({ onSuccess, onError });
  const unarchive = trpc.admin.libraries.unarchive.useMutation({ onSuccess, onError });

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="rename-name">Nom</Label>
        <Input
          id="rename-name"
          value={name}
          disabled={archived}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="rename-desc">Description</Label>
        <Input
          id="rename-desc"
          value={description}
          disabled={archived}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={1000}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={archived || rename.isPending || name.trim().length < 3}
          onClick={() =>
            rename.mutate({ id: libraryId, name, description: description || undefined })
          }
        >
          {t('renameSubmit')}
        </Button>
        {archived ? (
          <Button
            variant="outline"
            onClick={() => unarchive.mutate({ id: libraryId })}
            disabled={unarchive.isPending}
          >
            <ArchiveRestore className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('unarchiveCta')}
          </Button>
        ) : (
          <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Archive className="mr-2 h-4 w-4" aria-hidden="true" />
                {t('archiveCta')}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t('archiveDialogTitle')}</DialogTitle>
                <DialogDescription>{t('archiveDialogDescription')}</DialogDescription>
              </DialogHeader>
              <div className="space-y-1">
                <Label htmlFor="archive-reason">{t('reasonLabel')}</Label>
                <Input
                  id="archive-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={500}
                />
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setArchiveOpen(false)}>
                  Annuler
                </Button>
                <Button
                  onClick={() => archive.mutate({ id: libraryId, reason })}
                  disabled={reason.trim().length < 3 || archive.isPending}
                >
                  {t('archiveCta')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </div>
  );
}
