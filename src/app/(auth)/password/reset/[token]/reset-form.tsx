'use client';

import * as React from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { AlertCircle, Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { submitReset, type ResetState } from './actions';

const initial: ResetState = { status: 'idle' };

function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? (
        <>
          <Loader2 className="animate-spin" aria-hidden="true" />
          {children}
        </>
      ) : (
        children
      )}
    </Button>
  );
}

export function ResetForm({ rawToken }: { rawToken: string }) {
  const t = useTranslations('password.reset');
  const [state, action] = useActionState(submitReset, initial);
  const [showNew, setShowNew] = React.useState(false);
  const [showConfirm, setShowConfirm] = React.useState(false);

  return (
    <Card className="animate-slide-up">
      <CardHeader className="space-y-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent/10">
          <KeyRound className="h-5 w-5 text-accent" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <CardTitle className="text-xl">{t('title')}</CardTitle>
          <CardDescription>{t('lead')}</CardDescription>
        </div>
      </CardHeader>

      <CardContent>
        <form action={action} className="space-y-4" noValidate>
          <input type="hidden" name="rawToken" value={rawToken} />

          {state.status === 'error' && (
            <Alert variant="destructive" className="animate-fade-in">
              <AlertCircle aria-hidden="true" />
              <AlertDescription>{state.message}</AlertDescription>
            </Alert>
          )}

          {/* New password */}
          <div className="space-y-2">
            <Label htmlFor="newPassword">{t('newPassword')}</Label>
            <div className="relative">
              <Input
                id="newPassword"
                name="newPassword"
                type={showNew ? 'text' : 'password'}
                autoComplete="new-password"
                autoFocus
                required
                minLength={12}
                maxLength={200}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowNew((v) => !v)}
                className={cn(
                  'absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1',
                  'text-muted-foreground transition-colors hover:text-foreground',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                )}
                tabIndex={-1}
                aria-label={showNew ? t('passwordToggleHide') : t('passwordToggleShow')}
              >
                {showNew ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          {/* Confirm password */}
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">{t('confirmPassword')}</Label>
            <div className="relative">
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type={showConfirm ? 'text' : 'password'}
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={200}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowConfirm((v) => !v)}
                className={cn(
                  'absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1',
                  'text-muted-foreground transition-colors hover:text-foreground',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                )}
                tabIndex={-1}
                aria-label={
                  showConfirm ? t('confirmPasswordToggleHide') : t('confirmPasswordToggleShow')
                }
              >
                {showConfirm ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          <SubmitButton>{t('submit')}</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
