import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ChevronLeft, Check, ShieldOff, Calendar, Clock } from 'lucide-react';

import { formatDate } from '@/lib/format';

import { db } from '@/lib/db';
import { Button } from '@/components/ui/button';
import { StatusBadge, RoleBadge } from '@/components/admin/UserBadges';
import { UserActions } from './UserActions';
import { UserSessionsList } from './UserSessionsList';
import { UserAuditExcerpt } from './UserAuditExcerpt';

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: 'Fiche utilisateur — BiblioShare Admin',
  robots: { index: false, follow: false },
};

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AdminUserDetailPage({ params }: Props) {
  const { id } = await params;
  const t = await getTranslations('admin.users');

  const user = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      status: true,
      twoFactorEnabled: true,
      locale: true,
      createdAt: true,
      lastLoginAt: true,
      _count: {
        select: {
          sessions: true,
          invitationsCreated: true,
          libraryMembers: true,
        },
      },
    },
  });

  if (!user) notFound();

  const createdAtFormatted = await formatDate(user.createdAt);
  const lastLoginAtFormatted = user.lastLoginAt ? await formatDate(user.lastLoginAt) : null;

  const displayName = user.displayName ?? user.email;
  const roleLabel = user.role === 'GLOBAL_ADMIN' ? t('roleAdmin') : t('roleUser');
  const statusLabel = user.status === 'ACTIVE' ? t('statusActive') : t('statusSuspended');
  const twoFactorLabel = user.twoFactorEnabled ? t('detail.twoFactorOn') : t('detail.twoFactorOff');

  return (
    <section className="animate-slide-up space-y-6">
      {/* Back link */}
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link href="/admin/users">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            {t('detail.back')}
          </Link>
        </Button>
      </div>

      {/* Header card */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          {/* Identity */}
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">{displayName}</h1>
            {user.displayName && (
              <p className="font-mono text-sm text-muted-foreground">{user.email}</p>
            )}
            {/* Badges row */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <RoleBadge role={user.role} label={roleLabel} />
              <StatusBadge status={user.status} label={statusLabel} />
              <span
                className={
                  user.twoFactorEnabled
                    ? 'inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-600/20'
                    : 'inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'
                }
              >
                {user.twoFactorEnabled ? (
                  <Check className="h-3 w-3" aria-hidden="true" />
                ) : (
                  <ShieldOff className="h-3 w-3" aria-hidden="true" />
                )}
                {twoFactorLabel}
              </span>
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-3 gap-4 sm:text-right">
            <div className="space-y-0.5">
              <p className="text-2xl font-bold tabular-nums">{user._count.sessions}</p>
              <p className="text-xs text-muted-foreground">{t('detail.statsSessions')}</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-2xl font-bold tabular-nums">{user._count.invitationsCreated}</p>
              <p className="text-xs text-muted-foreground">{t('detail.statsInvitations')}</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-2xl font-bold tabular-nums">{user._count.libraryMembers}</p>
              <p className="text-xs text-muted-foreground">{t('detail.statsLibraries')}</p>
            </div>
          </div>
        </div>

        {/* Meta row */}
        <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-border pt-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
            {t('detail.memberSince')} {createdAtFormatted}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            {lastLoginAtFormatted
              ? `${t('detail.lastLogin')} ${lastLoginAtFormatted}`
              : t('detail.neverLoggedIn')}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {t('detail.tabActions')}
        </h2>
        <UserActions
          userId={user.id}
          userEmail={user.email}
          currentRole={user.role}
          currentStatus={user.status}
          twoFactorEnabled={user.twoFactorEnabled}
        />
      </div>

      {/* Sessions */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {t('detail.tabSessions')}
        </h2>
        <div className="min-h-[140px]">
          <UserSessionsList userId={user.id} />
        </div>
      </div>

      {/* Audit */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {t('detail.tabAudit')}
        </h2>
        <div className="min-h-[140px]">
          <UserAuditExcerpt userId={user.id} />
        </div>
      </div>
    </section>
  );
}
