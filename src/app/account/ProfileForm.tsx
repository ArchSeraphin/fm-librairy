'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { trpc } from '@/lib/trpc/client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

export function ProfileForm() {
  const t = useTranslations('account.profile');
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const profile = trpc.account.profile.get.useQuery();
  const update = trpc.account.profile.update.useMutation({
    onSuccess: () => {
      toast({ title: t('savedToast') });
      utils.account.profile.invalidate();
    },
    onError: (err) =>
      toast({ title: t('errorToast'), description: err.message, variant: 'destructive' }),
  });

  const [displayName, setDisplayName] = useState('');
  const [locale, setLocale] = useState<'fr' | 'en'>('fr');

  useEffect(() => {
    if (profile.data) {
      setDisplayName(profile.data.displayName);
      setLocale(profile.data.locale === 'en' ? 'en' : 'fr');
    }
  }, [profile.data]);

  if (!profile.data)
    return (
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {t('loading')}
      </p>
    );

  const dirty = displayName !== profile.data.displayName || locale !== profile.data.locale;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        update.mutate({ displayName, locale });
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="email">{t('emailLabel')}</Label>
        <Input id="email" value={profile.data.email} disabled aria-describedby="email-help" />
        <p id="email-help" className="text-xs text-muted-foreground">
          {t('emailHelp')}
        </p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="displayName">{t('displayNameLabel')}</Label>
        <Input
          id="displayName"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={120}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="locale">{t('localeLabel')}</Label>
        <select
          id="locale"
          value={locale}
          onChange={(e) => setLocale(e.target.value as 'fr' | 'en')}
          className="h-9 w-full rounded-md border bg-background px-3 text-sm"
        >
          <option value="fr">{t('localeFr')}</option>
          <option value="en">{t('localeEn')}</option>
        </select>
      </div>
      <Button type="submit" disabled={!dirty || update.isPending || displayName.trim().length < 1}>
        {t('save')}
      </Button>
    </form>
  );
}
