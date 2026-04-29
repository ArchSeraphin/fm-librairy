import type { Metadata } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { UserPlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { UsersTable } from './UsersTable';

export const metadata: Metadata = {
  title: 'Utilisateurs — BiblioShare Admin',
  robots: { index: false, follow: false },
};

export default function AdminUsersPage() {
  const t = useTranslations('admin.users');

  return (
    <section className="animate-slide-up space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t('pageTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button asChild size="sm">
          <Link href="/admin/users/invite">
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            {t('inviteCta')}
          </Link>
        </Button>
      </div>

      <UsersTable />
    </section>
  );
}
