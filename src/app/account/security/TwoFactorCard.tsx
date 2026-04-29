'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Shield, ShieldOff } from 'lucide-react';
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

interface TwoFactorCardProps {
  twoFactorEnabled: boolean;
  isGlobalAdmin: boolean;
}

export function TwoFactorCard({ twoFactorEnabled, isGlobalAdmin }: TwoFactorCardProps) {
  const t = useTranslations('account.security.twofactor');
  const tRoot = useTranslations('account.security');
  const { toast } = useToast();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [backupCode, setBackupCode] = useState('');

  const startReEnroll = trpc.account.security.startReEnrollWithBackup.useMutation({
    onSuccess: () => {
      toast({ title: t('successToast') });
      setOpen(false);
      setBackupCode('');
      router.push('/2fa/setup');
    },
    onError: (err) =>
      toast({ title: tRoot('errorToast'), description: err.message, variant: 'destructive' }),
  });

  function handleOpenChange(o: boolean) {
    setOpen(o);
    if (!o) {
      setBackupCode('');
    }
  }

  const backupCodeValid = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(backupCode);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          {twoFactorEnabled ? (
            <Shield className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          ) : (
            <ShieldOff
              className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          )}
          <div>
            <CardTitle className="text-base">{t('title')}</CardTitle>
            <CardDescription className="mt-1">
              {twoFactorEnabled ? t('descriptionOn') : t('descriptionOff')}
            </CardDescription>
          </div>
        </div>

        <div className="flex shrink-0 gap-2">
          {!twoFactorEnabled && (
            <Button variant="outline" size="sm" asChild>
              <Link href="/2fa/setup">{t('setupCta')}</Link>
            </Button>
          )}

          {twoFactorEnabled && !isGlobalAdmin && (
            <Dialog open={open} onOpenChange={handleOpenChange}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  {t('resetViaBackupCta')}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('resetDialogTitle')}</DialogTitle>
                  <DialogDescription>{t('resetDialogDescription')}</DialogDescription>
                </DialogHeader>
                <div className="space-y-1">
                  <Label htmlFor="backup-code-input">{t('backupCodeLabel')}</Label>
                  <Input
                    id="backup-code-input"
                    placeholder="XXXX-XXXX"
                    value={backupCode}
                    onChange={(e) => setBackupCode(e.target.value.toUpperCase())}
                    maxLength={9}
                    autoComplete="off"
                  />
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => handleOpenChange(false)}>
                    Annuler
                  </Button>
                  <Button
                    onClick={() => startReEnroll.mutate({ backupCode })}
                    disabled={!backupCodeValid || startReEnroll.isPending}
                  >
                    {t('submit')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </CardHeader>
      <CardContent />
    </Card>
  );
}
