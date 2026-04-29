import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ProfileForm } from './ProfileForm';

export const metadata: Metadata = {
  title: 'Profil — BiblioShare',
  robots: { index: false, follow: false },
};

export default async function AccountPage() {
  const t = await getTranslations('account.profile');
  return (
    <section className="animate-slide-up space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ProfileForm />
        </CardContent>
      </Card>
    </section>
  );
}
