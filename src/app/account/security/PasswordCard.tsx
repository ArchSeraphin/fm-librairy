'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { KeyRound } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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

export function PasswordCard() {
  const t = useTranslations('account.security');
  const tp = useTranslations('account.security.password');
  const { toast } = useToast();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const changePassword = trpc.account.security.changePassword.useMutation({
    onSuccess: () => {
      toast({ title: tp('successToast') });
      setOpen(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      router.refresh();
    },
    onError: (err) =>
      toast({ title: t('errorToast'), description: err.message, variant: 'destructive' }),
  });

  const valid =
    currentPassword.length >= 1 &&
    newPassword.length >= 12 &&
    /[A-Z]/.test(newPassword) &&
    /[a-z]/.test(newPassword) &&
    /[0-9]/.test(newPassword) &&
    newPassword === confirmPassword &&
    newPassword !== currentPassword;

  function handleOpenChange(o: boolean) {
    setOpen(o);
    if (!o) {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div>
            <CardTitle className="text-base">{tp('title')}</CardTitle>
            <CardDescription className="mt-1">{tp('description')}</CardDescription>
          </div>
        </div>
        <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              {tp('changeCta')}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{tp('title')}</DialogTitle>
              <DialogDescription>{tp('description')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="current-password">{tp('currentLabel')}</Label>
                <Input
                  id="current-password"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  maxLength={128}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="new-password">{tp('newLabel')}</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  maxLength={128}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="confirm-password">{tp('confirmLabel')}</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  maxLength={128}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => handleOpenChange(false)}>
                Annuler
              </Button>
              <Button
                onClick={() =>
                  changePassword.mutate({ currentPassword, newPassword, confirmPassword })
                }
                disabled={!valid || changePassword.isPending}
              >
                {tp('submit')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent />
    </Card>
  );
}
