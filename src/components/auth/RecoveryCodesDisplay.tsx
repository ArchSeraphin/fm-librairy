'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { AlertCircle, Check, Copy, Download, LifeBuoy, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Stepper } from '@/components/ui/stepper';

const STORAGE_KEY = 'biblio.recoveryCodes';

export function RecoveryCodesDisplay() {
  const t = useTranslations('auth.recovery');
  const router = useRouter();
  const { update } = useSession();

  const [codes, setCodes] = React.useState<string[] | null>(null);
  const [confirmed, setConfirmed] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [continuing, setContinuing] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      router.replace('/2fa/setup');
      return;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.every((c) => typeof c === 'string')) {
        setCodes(parsed);
        return;
      }
    } catch {
      /* fall through */
    }
    router.replace('/2fa/setup');
  }, [router]);

  React.useEffect(() => {
    if (!codes) return;
    const handler = (e: BeforeUnloadEvent) => {
      if (!confirmed) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [codes, confirmed]);

  async function copyAll() {
    if (!codes) return;
    await navigator.clipboard.writeText(codes.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function downloadAll() {
    if (!codes) return;
    const blob = new Blob([codes.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const date = new Date().toISOString().slice(0, 10);
    const a = document.createElement('a');
    a.href = url;
    a.download = `biblioshare-recovery-codes-${date}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleContinue() {
    setContinuing(true);
    sessionStorage.removeItem(STORAGE_KEY);
    // Pass a non-empty object so next-auth sends POST /api/auth/session (not GET).
    // Without a body, update() sends GET and the JWT callback trigger==='update'
    // path never fires — pending2fa stays true in the cookie.
    await update({});
    // Force full navigation to guarantee Set-Cookie applied + middleware re-reads JWT.
    // router.push() keeps the client cache and races the cookie write.
    window.location.assign('/admin');
  }

  if (!codes) {
    return (
      <Card className="animate-slide-up">
        <CardContent className="flex h-48 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="animate-slide-up">
      <CardHeader className="space-y-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent/10">
          <LifeBuoy className="h-5 w-5 text-accent" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <CardTitle className="text-xl">{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </div>
        <Stepper currentStep={2} totalSteps={2} />
      </CardHeader>
      <CardContent className="space-y-5">
        <Alert variant="warning">
          <AlertCircle />
          <AlertDescription className="font-medium">{t('warning')}</AlertDescription>
        </Alert>

        <ul role="list" className="grid grid-cols-2 gap-2">
          {codes.map((codeValue) => (
            <li
              key={codeValue}
              className="rounded-md bg-muted px-3 py-2 text-center font-mono text-sm tracking-wider"
            >
              {codeValue}
            </li>
          ))}
        </ul>

        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" size="sm" onClick={copyAll}>
            {copied ? <Check className="text-success" /> : <Copy />}
            {copied ? t('copied') : t('copyAll')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={downloadAll}>
            <Download />
            {t('download')}
          </Button>
        </div>

        <div className="flex items-start gap-3 rounded-md border bg-card p-3">
          <Checkbox
            id="recovery-confirm"
            checked={confirmed}
            onCheckedChange={(c) => setConfirmed(c === true)}
            className="mt-0.5"
          />
          <Label htmlFor="recovery-confirm" className="cursor-pointer leading-snug">
            {t('confirm')}
          </Label>
        </div>

        <Button
          type="button"
          onClick={handleContinue}
          disabled={!confirmed || continuing}
          className="w-full"
        >
          {continuing ? (
            <>
              <Loader2 className="animate-spin" />
              {t('continuing')}
            </>
          ) : (
            t('continue')
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
