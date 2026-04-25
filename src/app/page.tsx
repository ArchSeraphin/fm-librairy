import { useTranslations } from 'next-intl';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Library } from 'lucide-react';

export default function HomePage() {
  const t = useTranslations('Home');
  return (
    <main className="container mx-auto flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md animate-slide-up shadow-sm">
        <CardHeader className="space-y-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent/10">
            <Library className="h-5 w-5 text-accent" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <CardTitle className="text-xl">{t('title')}</CardTitle>
            <CardDescription>{t('subtitle')}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('phase')}</p>
          <p className="text-sm text-foreground">{t('comingSoon')}</p>
        </CardContent>
      </Card>
    </main>
  );
}
