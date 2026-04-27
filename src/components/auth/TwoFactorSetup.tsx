'use client';

import * as React from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import QRCode from 'qrcode';
import { AlertCircle, Check, Copy, Loader2, Smartphone } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { OtpInput } from '@/components/auth/OtpInput';
import { Stepper } from '@/components/ui/stepper';
import { trpc } from '@/lib/trpc/client';

const SETUP_STORAGE_KEY = 'biblio.recoveryCodes';

export function TwoFactorSetup() {
  const t = useTranslations('auth.tfaSetup');
  const router = useRouter();

  const [qr, setQr] = React.useState<string | null>(null);
  const [secret, setSecret] = React.useState<string | null>(null);
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const enrollStarted = React.useRef(false);

  const enroll = trpc.auth.enroll2FA.useMutation({
    onSuccess: async (data) => {
      const url = await QRCode.toDataURL(data.uri, { margin: 1, width: 192 });
      setQr(url);
      setSecret(data.secret);
    },
    onError: () => {
      setError(t('error.expired'));
    },
  });

  const confirm = trpc.auth.confirm2FA.useMutation({
    onSuccess: (data) => {
      sessionStorage.setItem(SETUP_STORAGE_KEY, JSON.stringify(data.backupCodes));
      router.push('/2fa/setup/recovery-codes');
    },
    onError: () => {
      setError(t('error.invalid'));
      setCode('');
    },
  });

  React.useEffect(() => {
    if (enrollStarted.current) return;
    enrollStarted.current = true;
    enroll.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleComplete(value: string) {
    setError(null);
    confirm.mutate({ code: value });
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (code.length !== 6) return;
    handleComplete(code);
  }

  async function copySecret() {
    if (!secret) return;
    await navigator.clipboard.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const isLoading = enroll.isPending || (!qr && !error);

  return (
    <Card className="animate-slide-up">
      <CardHeader className="space-y-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent/10">
          <Smartphone className="h-5 w-5 text-accent" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <CardTitle className="text-xl">{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </div>
        <Stepper currentStep={1} totalSteps={2} />
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading && (
          <div className="space-y-3">
            <div className="mx-auto h-48 w-48 animate-pulse rounded-md bg-muted" />
            <div className="h-9 animate-pulse rounded-md bg-muted" />
          </div>
        )}

        {qr && secret && (
          <>
            <div className="mx-auto w-fit rounded-md border bg-white p-3">
              <Image src={qr} alt={t('qrAlt')} width={192} height={192} unoptimized priority />
            </div>

            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{t('manualLabel')}</p>
              <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2">
                <code className="flex-1 truncate font-mono text-sm tracking-wider">{secret}</code>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={copySecret}
                  aria-label={copied ? t('copied') : t('copySecret')}
                  className="h-7 w-7"
                >
                  {copied ? (
                    <Check className="text-success" aria-hidden="true" />
                  ) : (
                    <Copy aria-hidden="true" />
                  )}
                </Button>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <Alert variant="destructive" className="animate-fade-in">
                  <AlertCircle />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <p className="text-sm font-medium">{t('codeLabel')}</p>
                <OtpInput
                  length={6}
                  value={code}
                  onChange={(next) => {
                    setError(null);
                    setCode(next);
                  }}
                  onComplete={handleComplete}
                  disabled={confirm.isPending}
                  ariaLabel={t('codeLabel')}
                  hasError={!!error}
                />
              </div>
              <Button
                type="submit"
                disabled={confirm.isPending || code.length !== 6}
                className="w-full"
              >
                {confirm.isPending ? (
                  <>
                    <Loader2 className="animate-spin" />
                    {t('submitPending')}
                  </>
                ) : (
                  t('submit')
                )}
              </Button>
            </form>
          </>
        )}

        {error && !qr && (
          <Alert variant="destructive" className="animate-fade-in">
            <AlertCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
