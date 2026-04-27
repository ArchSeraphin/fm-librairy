'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { AlertCircle, ArrowLeft, Loader2, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { OtpInput } from '@/components/auth/OtpInput';
import { trpc } from '@/lib/trpc/client';

export function TwoFactorChallenge() {
  const t = useTranslations('auth.tfa');
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') ?? '/admin';
  const { update } = useSession();

  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const verify = trpc.auth.verify2FA.useMutation({
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
      setCode('');
    },
  });

  function handleComplete(value: string) {
    setError(null);
    verify.mutate({ code: value });
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (code.length !== 6) return;
    handleComplete(code);
  }

  return (
    <Card className="animate-slide-up">
      <CardHeader className="space-y-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent/10">
          <ShieldCheck className="h-5 w-5 text-accent" aria-hidden="true" />
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
          <OtpInput
            length={6}
            value={code}
            onChange={(next) => {
              setError(null);
              setCode(next);
            }}
            onComplete={handleComplete}
            disabled={verify.isPending}
            autoFocus
            ariaLabel={t('codeLabel')}
            hasError={!!error}
          />
          <Button type="submit" disabled={verify.isPending || code.length !== 6} className="w-full">
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
      <CardFooter className="flex-col items-stretch gap-2 border-t pt-4">
        <Button asChild variant="link" size="sm" className="justify-center">
          <Link href={`/login/2fa/backup?callbackUrl=${encodeURIComponent(callbackUrl)}`}>
            {t('useBackupCode')}
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="justify-center text-muted-foreground"
        >
          <ArrowLeft />
          {t('backToLogin')}
        </Button>
      </CardFooter>
    </Card>
  );
}
