import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { AlertCircle } from 'lucide-react';

import { appRouter } from '@/server/trpc/routers/_app';
import { createContext } from '@/server/trpc/context';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ResetForm } from './reset-form';

export const metadata: Metadata = {
  title: 'Réinitialisation du mot de passe — BiblioShare',
};

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function ResetPasswordPage({ params }: PageProps) {
  const { token } = await params;
  const ctx = await createContext({ headers: await headers() });
  const caller = appRouter.createCaller(ctx);
  const validation = await caller.password.validateToken({ rawToken: token });
  const t = await getTranslations('password.reset');

  if (!validation.valid) {
    return (
      <Card className="animate-slide-up">
        <CardHeader className="space-y-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-destructive/10">
            <AlertCircle className="h-5 w-5 text-destructive" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <CardTitle className="text-xl">{t('invalid.title')}</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{t('invalid.body')}</AlertDescription>
          </Alert>
        </CardContent>
        <CardFooter className="justify-center">
          <Button asChild variant="link" size="sm" className="text-muted-foreground">
            <Link href="/password/forgot">Demander un nouveau lien</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return <ResetForm rawToken={token} />;
}
