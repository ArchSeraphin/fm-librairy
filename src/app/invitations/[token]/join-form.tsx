'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, BookOpen, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { submitJoin, type JoinState } from './actions';

export function JoinForm({
  rawToken,
  libraryName,
}: {
  rawToken: string;
  libraryName: string;
}) {
  const t = useTranslations('invitation');
  const [pending, startTransition] = React.useTransition();
  const [state, setState] = React.useState<JoinState>({ status: 'idle' });

  function handleJoin() {
    startTransition(async () => {
      const result = await submitJoin(rawToken);
      setState(result);
    });
  }

  return (
    <Card className="animate-slide-up">
      <CardHeader className="space-y-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent/10">
          <BookOpen className="h-5 w-5 text-accent" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <CardTitle className="text-xl">{t('join.title', { libraryName })}</CardTitle>
          <CardDescription>{t('join.lead')}</CardDescription>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {state.status === 'error' && (
          <Alert variant="destructive" className="animate-fade-in">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        )}

        <Button
          type="button"
          disabled={pending}
          className="w-full"
          onClick={handleJoin}
        >
          {pending ? (
            <>
              <Loader2 className="animate-spin" aria-hidden="true" />
              {t('join.submit')}
            </>
          ) : (
            t('join.submit')
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
