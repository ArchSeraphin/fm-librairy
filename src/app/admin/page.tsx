import type { Metadata } from 'next';
import { useTranslations } from 'next-intl';
import { LayoutDashboard } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = {
  title: 'Administration — BiblioShare',
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  const t = useTranslations('admin.welcome');
  return (
    <Card className="mx-auto max-w-2xl animate-slide-up">
      <CardHeader className="space-y-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent/10">
          <LayoutDashboard className="h-5 w-5 text-accent" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <CardTitle className="text-xl">{t('title')}</CardTitle>
          <CardDescription>{t('subtitle')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-foreground/80">{t('body')}</p>
        <div className="space-y-2">
          <p className="text-sm font-medium">{t('todoTitle')}</p>
          <ul className="ml-4 list-disc space-y-1 text-sm text-muted-foreground">
            <li>{t('todoEnableTfa')}</li>
            <li>{t('todoSignOut')}</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
