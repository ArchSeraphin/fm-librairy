'use client';

import * as React from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, Mail } from 'lucide-react';
import Link from 'next/link';

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
import { submitForgot, type ForgotState } from './actions';

const initial: ForgotState = { status: 'idle' };

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

export function ForgotForm() {
  const t = useTranslations('password.forgot');
  const [state, action] = useActionState(submitForgot, initial);

  if (state.status === 'submitted') {
    return (
      <Card className="animate-slide-up">
        <CardHeader className="space-y-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent/10">
            <CheckCircle2 className="h-5 w-5 text-accent" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <CardTitle className="text-xl">{t('title')}</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <Alert className="animate-fade-in">
            <CheckCircle2 aria-hidden="true" />
            <AlertDescription>{t('confirmation')}</AlertDescription>
          </Alert>
        </CardContent>
        <CardFooter className="justify-center">
          <Button asChild variant="link" size="sm" className="text-muted-foreground">
            <Link href="/login">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Retour à la connexion
            </Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="animate-slide-up">
      <CardHeader className="space-y-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent/10">
          <Mail className="h-5 w-5 text-accent" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <CardTitle className="text-xl">{t('title')}</CardTitle>
          <CardDescription>{t('lead')}</CardDescription>
        </div>
      </CardHeader>

      <CardContent>
        <form action={action} className="space-y-4" noValidate>
          {state.status === 'error' && (
            <Alert variant="destructive" className="animate-fade-in">
              <AlertCircle aria-hidden="true" />
              <AlertDescription>{state.message}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="email">{t('email.label')}</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              autoFocus
              required
              maxLength={254}
            />
          </div>

          <SubmitButton>{t('submit')}</SubmitButton>
        </form>
      </CardContent>

      <CardFooter className="justify-center">
        <Button asChild variant="link" size="sm" className="text-muted-foreground">
          <Link href="/login">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Retour à la connexion
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
