'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';

export function CreateLibraryDialog() {
  const t = useTranslations('admin.libraries.create');
  const tList = useTranslations('admin.libraries');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const router = useRouter();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const create = trpc.admin.libraries.create.useMutation({
    onSuccess: (lib) => {
      toast({ title: t('submit') + ' OK' });
      utils.admin.libraries.invalidate();
      setOpen(false);
      setName('');
      setDescription('');
      router.push(`/admin/libraries/${lib.slug}`);
    },
    onError: (err) => toast({ title: 'Erreur', description: err.message, variant: 'destructive' }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          {tList('createCta')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="lib-name">{t('nameLabel')}</Label>
            <Input
              id="lib-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="lib-desc">{t('descriptionLabel')}</Label>
            <Input
              id="lib-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={1000}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t('cancel')}
          </Button>
          <Button
            onClick={() => create.mutate({ name, description: description || undefined })}
            disabled={name.trim().length < 3 || create.isPending}
          >
            {t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
