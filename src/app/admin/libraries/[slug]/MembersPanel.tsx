'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, X } from 'lucide-react';
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

export function MembersPanel({ libraryId, archived }: { libraryId: string; archived: boolean }) {
  const t = useTranslations('admin.libraries.members');
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [openAdd, setOpenAdd] = useState(false);
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<'LIBRARY_ADMIN' | 'MEMBER'>('MEMBER');
  const [flags, setFlags] = useState({ canRead: true, canUpload: false, canDownload: true });

  const list = trpc.admin.libraries.members.list.useQuery({ libraryId, limit: 50 });
  const add = trpc.admin.libraries.members.add.useMutation({
    onSuccess: () => {
      utils.admin.libraries.members.invalidate();
      setOpenAdd(false);
      setUserId('');
      toast({ title: 'OK' });
    },
    onError: (err) => toast({ title: 'Erreur', description: err.message, variant: 'destructive' }),
  });
  const remove = trpc.admin.libraries.members.remove.useMutation({
    onSuccess: () => {
      utils.admin.libraries.members.invalidate();
      toast({ title: 'OK' });
    },
    onError: (err) => toast({ title: 'Erreur', description: err.message, variant: 'destructive' }),
  });

  const items = list.data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={openAdd} onOpenChange={setOpenAdd}>
          <DialogTrigger asChild>
            <Button disabled={archived}>
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              {t('addCta')}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('addDialogTitle')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="member-user">{t('addDialogUserLabel')}</Label>
                <Input
                  id="member-user"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  placeholder="cl..."
                />
              </div>
              <div className="space-y-1">
                <Label>Rôle</Label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as 'LIBRARY_ADMIN' | 'MEMBER')}
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                >
                  <option value="MEMBER">{t('roleMember')}</option>
                  <option value="LIBRARY_ADMIN">{t('roleLibraryAdmin')}</option>
                </select>
              </div>
              <div className="flex flex-wrap gap-3">
                {(['canRead', 'canUpload', 'canDownload'] as const).map((flag) => (
                  <label key={flag} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={flags[flag]}
                      onChange={(e) => setFlags({ ...flags, [flag]: e.target.checked })}
                    />
                    {flag === 'canRead'
                      ? t('flagRead')
                      : flag === 'canUpload'
                        ? t('flagUpload')
                        : t('flagDownload')}
                  </label>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpenAdd(false)}>
                Annuler
              </Button>
              <Button
                onClick={() => add.mutate({ libraryId, userId, role, flags })}
                disabled={userId.length < 20 || add.isPending}
              >
                {t('addCta')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-2 py-2">{t('tableUser')}</th>
              <th className="px-2 py-2">{t('tableRole')}</th>
              <th className="px-2 py-2">{t('tableFlags')}</th>
              <th className="px-2 py-2 text-right">{t('tableAction')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((m) => (
              <tr key={m.userId} className="border-t">
                <td className="px-2 py-2">
                  {m.user.displayName}
                  <br />
                  <span className="font-mono text-xs text-muted-foreground">{m.user.email}</span>
                </td>
                <td className="px-2 py-2">
                  {m.role === 'LIBRARY_ADMIN' ? t('roleLibraryAdmin') : t('roleMember')}
                </td>
                <td className="px-2 py-2 text-xs">
                  {m.canRead && 'R'}
                  {m.canUpload && 'U'}
                  {m.canDownload && 'D'}
                </td>
                <td className="px-2 py-2 text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={archived || remove.isPending}
                    onClick={() => remove.mutate({ libraryId, userId: m.userId })}
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
