'use client';

import * as React from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { AlertCircle, BookOpen, Eye, EyeOff, Loader2, UserPlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { submitSignup, type SignupState } from './actions';

const initial: SignupState = { status: 'idle' };

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

export function SignupForm({
  rawToken,
  email,
  libraryName,
}: {
  rawToken: string;
  email: string;
  libraryName?: string | null;
}) {
  const t = useTranslations('invitation.signup');
  const [state, action] = useActionState(submitSignup, initial);
  const [showPassword, setShowPassword] = React.useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = React.useState(false);

  return (
    <Card className="animate-slide-up">
      <CardHeader className="space-y-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent/10">
          {libraryName ? (
            <BookOpen className="h-5 w-5 text-accent" aria-hidden="true" />
          ) : (
            <UserPlus className="h-5 w-5 text-accent" aria-hidden="true" />
          )}
        </div>
        <div className="space-y-1">
          <CardTitle className="text-xl">{t('title')}</CardTitle>
          <CardDescription>
            {libraryName ? t('lead', { libraryName }) : t('leadGlobal')}
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent>
        <form action={action} className="space-y-4" noValidate>
          {/* Hidden fields */}
          <input type="hidden" name="rawToken" value={rawToken} />
          <input type="hidden" name="email" value={email} />

          {state.status === 'error' && (
            <Alert variant="destructive" className="animate-fade-in">
              <AlertCircle aria-hidden="true" />
              <AlertDescription>{state.message}</AlertDescription>
            </Alert>
          )}

          {/* Readonly email display */}
          <div className="space-y-2">
            <Label htmlFor="email-display">{t('email')}</Label>
            <Input
              id="email-display"
              type="email"
              readOnly
              value={email}
              className={cn('cursor-not-allowed bg-muted text-muted-foreground')}
            />
          </div>

          {/* Display name */}
          <div className="space-y-2">
            <Label htmlFor="displayName">{t('displayName')}</Label>
            <Input
              id="displayName"
              name="displayName"
              type="text"
              autoComplete="name"
              autoFocus
              required
              maxLength={80}
            />
          </div>

          {/* Password */}
          <div className="space-y-2">
            <Label htmlFor="password">{t('password')}</Label>
            <div className="relative">
              <Input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={200}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className={cn(
                  'absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1',
                  'text-muted-foreground transition-colors hover:text-foreground',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                )}
                tabIndex={-1}
                aria-label={showPassword ? t('passwordToggleHide') : t('passwordToggleShow')}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          {/* Confirm password */}
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">{t('passwordConfirm')}</Label>
            <div className="relative">
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type={showPasswordConfirm ? 'text' : 'password'}
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={200}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPasswordConfirm((v) => !v)}
                className={cn(
                  'absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1',
                  'text-muted-foreground transition-colors hover:text-foreground',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                )}
                tabIndex={-1}
                aria-label={
                  showPasswordConfirm
                    ? t('passwordConfirmToggleHide')
                    : t('passwordConfirmToggleShow')
                }
              >
                {showPasswordConfirm ? (
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
