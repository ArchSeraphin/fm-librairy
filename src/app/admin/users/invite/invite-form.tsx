'use client';

import * as React from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, Loader2, UserPlus } from 'lucide-react';

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
import { cn } from '@/lib/utils';
import { submitInvite, type InviteState } from './actions';

interface Library {
  id: string;
  name: string;
}

const initial: InviteState = { status: 'idle' };

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

export function InviteForm({ libraries }: { libraries: Library[] }) {
  const t = useTranslations('admin.invite');
  const [state, action] = useActionState(submitInvite, initial);

  const errorMessage =
    state.status === 'error'
      ? state.code === 'VALIDATION'
        ? t('errors.validation')
        : state.code === 'FORBIDDEN'
          ? t('errors.permissionDenied')
          : state.code === 'TOO_MANY_REQUESTS'
            ? t('errors.rateLimited')
            : t('errors.unknown')
      : null;

  return (
    <Card className="animate-slide-up">
      <CardHeader className="space-y-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent/10">
          <UserPlus className="h-5 w-5 text-accent" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <CardTitle className="text-xl">{t('title')}</CardTitle>
          <CardDescription>{t('lead')}</CardDescription>
        </div>
      </CardHeader>

      <CardContent>
        <form action={action} className="space-y-5" noValidate>
          {state.status === 'error' && errorMessage && (
            <Alert variant="destructive" className="animate-fade-in">
              <AlertCircle aria-hidden="true" />
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}

          {state.status === 'success' && (
            <Alert variant="success" className="animate-fade-in">
              <CheckCircle2 aria-hidden="true" />
              <AlertDescription>{t('success', { email: state.email })}</AlertDescription>
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
              placeholder="membre@exemple.com"
            />
          </div>

          {libraries.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="libraryId">{t('library.label')}</Label>
              <select
                id="libraryId"
                name="libraryId"
                defaultValue=""
                className={cn(
                  'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                )}
              >
                <option value="">— Aucune (invitation globale) —</option>
                {libraries.map((lib) => (
                  <option key={lib.id} value={lib.id}>
                    {lib.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('role.label')}</legend>
            <div className="mt-2 space-y-2">
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="radio"
                  name="proposedRole"
                  value="MEMBER"
                  defaultChecked
                  className={cn(
                    'h-4 w-4 border-input text-primary',
                    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                  )}
                />
                <span className="text-sm text-foreground">{t('role.member')}</span>
              </label>
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="radio"
                  name="proposedRole"
                  value="LIBRARY_ADMIN"
                  className={cn(
                    'h-4 w-4 border-input text-primary',
                    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                  )}
                />
                <span className="text-sm text-foreground">{t('role.admin')}</span>
              </label>
            </div>
          </fieldset>

          <SubmitButton>{t('submit')}</SubmitButton>
        </form>
      </CardContent>

      <CardFooter className="justify-center">
        <Button variant="link" size="sm" asChild className="text-muted-foreground">
          <a href="/admin">{t('cancel')}</a>
        </Button>
      </CardFooter>
    </Card>
  );
}
