import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getCurrentSessionAndUser } from '@/server/auth/session-bridge';
import { db } from '@/lib/db';
import { PasswordCard } from './PasswordCard';
import { SessionsCard } from './SessionsCard';
import { TwoFactorCard } from './TwoFactorCard';
import { BackupCodesCard } from './BackupCodesCard';

export const metadata: Metadata = {
  title: 'Sécurité — BiblioShare',
  robots: { index: false, follow: false },
};

export default async function SecurityPage() {
  const result = await getCurrentSessionAndUser();
  if (!result) redirect('/login');

  const { user } = result;

  const twoFactorSecret = user.twoFactorEnabled
    ? await db.twoFactorSecret.findUnique({
        where: { userId: user.id },
        select: { backupCodes: true },
      })
    : null;

  const backupRemaining = twoFactorSecret?.backupCodes.length ?? 0;

  const t = await getTranslations('account.security');

  return (
    <section className="animate-slide-up space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      <PasswordCard />

      <SessionsCard />

      <TwoFactorCard
        twoFactorEnabled={user.twoFactorEnabled}
        isGlobalAdmin={user.role === 'GLOBAL_ADMIN'}
      />

      {user.twoFactorEnabled && <BackupCodesCard remaining={backupRemaining} />}
    </section>
  );
}
