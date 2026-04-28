import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { AlertCircle, AlertTriangle } from 'lucide-react';

import { appRouter } from '@/server/trpc/routers/_app';
import { createContext } from '@/server/trpc/context';
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
import { SignupForm } from './signup-form';
import { JoinForm } from './join-form';

export const metadata: Metadata = {
  title: 'Invitation — BiblioShare',
};

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function InvitationConsumePage({ params }: PageProps) {
  const { token } = await params;
  const ctx = await createContext({ headers: await headers() });
  const caller = appRouter.createCaller(ctx);
  const validation = await caller.invitation.validate({ rawToken: token });
  const t = await getTranslations('invitation');

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
          <Button variant="link" size="sm" asChild className="text-muted-foreground">
            <Link href="/login">Retour à la connexion</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (validation.mode === 'join') {
    if (!ctx.user) {
      const callbackUrl = encodeURIComponent(`/invitations/${token}`);
      redirect(`/login?callbackUrl=${callbackUrl}`);
    }
    if (ctx.user.email.toLowerCase() !== validation.email.toLowerCase()) {
      return (
        <Card className="animate-slide-up">
          <CardHeader className="space-y-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
              <AlertTriangle className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <CardTitle className="text-xl">{t('mismatch.title')}</CardTitle>
              <CardDescription>{t('mismatch.body')}</CardDescription>
            </div>
          </CardHeader>
          <CardFooter className="justify-center">
            <Button variant="outline" size="sm" asChild>
              <Link href="/logout">Se déconnecter</Link>
            </Button>
          </CardFooter>
        </Card>
      );
    }
    return <JoinForm rawToken={token} libraryName={validation.libraryName ?? ''} />;
  }

  return (
    <SignupForm rawToken={token} email={validation.email} libraryName={validation.libraryName} />
  );
}
