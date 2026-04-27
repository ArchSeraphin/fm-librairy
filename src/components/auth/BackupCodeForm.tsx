'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { AlertCircle, ArrowLeft, KeyRound, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { trpc } from '@/lib/trpc/client';

const RAW_LENGTH = 8; // 8 chars without dash
const FORMATTED_LENGTH = 9; // XXXX-XXXX

function normalize(input: string): string {
  return input.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function format(raw: string): string {
  const upper = raw.toUpperCase();
  if (upper.length <= 4) return upper;
  return `${upper.slice(0, 4)}-${upper.slice(4, 8)}`;
}

export function BackupCodeForm() {
  const t = useTranslations('auth.backup');
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') ?? '/admin';
  const { update } = useSession();

  const [value, setValue] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const verify = trpc.auth.verifyBackupCode.useMutation({
    onSuccess: async () => {
      // Pass a non-empty object so next-auth sends POST /api/auth/session (not GET).
      // Without a body, update() sends GET and the JWT callback trigger==='update'
      // path never fires — pending2fa stays true in the cookie.
      await update({});
      // Force full navigation to guarantee Set-Cookie applied + middleware re-reads JWT.
      // router.push() keeps the client cache and races the cookie write.
      window.location.assign(callbackUrl);
    },
    onError: (err) => {
      setError(
        err.data?.code === 'TOO_MANY_REQUESTS' ? t('error.rateLimited') : t('error.invalid'),
      );
    },
  });

  const raw = normalize(value);
  const isValid = raw.length === RAW_LENGTH;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!isValid) return;
    verify.mutate({ code: format(raw) });
  }

  return (
    <Card className="animate-slide-up">
      <CardHeader className="space-y-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent/10">
          <KeyRound className="h-5 w-5 text-accent" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <CardTitle className="text-xl">{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Alert variant="destructive" className="animate-fade-in">
              <AlertCircle />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label htmlFor="backup-code" className="sr-only">
              {t('label')}
            </Label>
            <Input
              id="backup-code"
              name="code"
              type="text"
              inputMode="text"
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellCheck={false}
              autoFocus
              required
              maxLength={FORMATTED_LENGTH}
              disabled={verify.isPending}
              placeholder={t('placeholder')}
              value={format(raw)}
              onChange={(e) => {
                setError(null);
                setValue(e.target.value);
              }}
              className="text-center font-mono text-base uppercase tracking-widest"
            />
            <p className="text-xs text-muted-foreground">{t('hint')}</p>
          </div>
          <Button type="submit" disabled={verify.isPending || !isValid} className="w-full">
            {verify.isPending ? (
              <>
                <Loader2 className="animate-spin" />
                {t('submitPending')}
              </>
            ) : (
              t('submit')
            )}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="border-t pt-4">
        <Button asChild variant="ghost" size="sm" className="w-full text-muted-foreground">
          <Link href={`/login/2fa?callbackUrl=${encodeURIComponent(callbackUrl)}`}>
            <ArrowLeft />
            {t('backToTotp')}
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
