'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ShieldCheck } from 'lucide-react';
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

interface BackupCodesCardProps {
  remaining: number;
}

export function BackupCodesCard({ remaining }: BackupCodesCardProps) {
  const t = useTranslations('account.security.backupCodes');
  const tRoot = useTranslations('account.security');
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [pwd, setPwd] = useState('');
  const [totp, setTotp] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);

  const regenerate = trpc.account.security.regenerateBackupCodes.useMutation({
    onSuccess: (data) => {
      setCodes(data.codes);
      toast({ title: tRoot('successToast') });
    },
    onError: (err) =>
      toast({ title: tRoot('errorToast'), description: err.message, variant: 'destructive' }),
  });

  function handleOpenChange(o: boolean) {
    setOpen(o);
    if (!o) {
      setCodes(null);
      setPwd('');
      setTotp('');
    }
  }

  const formValid = pwd.length >= 1 && totp.length === 6;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <ShieldCheck
            className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <div>
            <CardTitle className="text-base">{t('title')}</CardTitle>
            <CardDescription className="mt-1">{t('description')}</CardDescription>
          </div>
        </div>

        <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              {t('regenerateCta')}
            </Button>
          </DialogTrigger>
          <DialogContent>
            {codes ? (
              <>
                <DialogHeader>
                  <DialogTitle>{t('newCodesTitle')}</DialogTitle>
                  <DialogDescription>{t('newCodesDescription')}</DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-2 gap-2 rounded-md bg-muted p-4 font-mono text-sm">
                  {codes.map((code) => (
                    <span key={code} className="select-all">
                      {code}
                    </span>
                  ))}
                </div>
                <DialogFooter>
                  <Button onClick={() => handleOpenChange(false)}>{t('close')}</Button>
                </DialogFooter>
              </>
            ) : (
              <>
                <DialogHeader>
                  <DialogTitle>{t('regenerateDialogTitle')}</DialogTitle>
                  <DialogDescription>{t('regenerateDialogDescription')}</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label htmlFor="regen-password">{t('passwordLabel')}</Label>
                    <Input
                      id="regen-password"
                      type="password"
                      autoComplete="current-password"
                      value={pwd}
                      onChange={(e) => setPwd(e.target.value)}
                      maxLength={128}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="regen-totp">{t('totpLabel')}</Label>
                    <Input
                      id="regen-totp"
                      inputMode="numeric"
                      maxLength={6}
                      autoComplete="one-time-code"
                      value={totp}
                      onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => handleOpenChange(false)}>
                    Annuler
                  </Button>
                  <Button
                    onClick={() => regenerate.mutate({ currentPassword: pwd, totpCode: totp })}
                    disabled={!formValid || regenerate.isPending}
                  >
                    {t('submit')}
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{t('remaining', { count: remaining })}</p>
      </CardContent>
    </Card>
  );
}
