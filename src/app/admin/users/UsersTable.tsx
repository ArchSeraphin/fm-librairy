'use client';

import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Check, Loader2, Search, Users } from 'lucide-react';

import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StatusFilter = 'ACTIVE' | 'SUSPENDED' | 'all';
type RoleFilter = 'GLOBAL_ADMIN' | 'USER' | 'all';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const selectClass = cn(
  'flex h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm',
  'transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
  'disabled:cursor-not-allowed disabled:opacity-50',
);

function SkeletonRow() {
  return (
    <tr className="border-b">
      {Array.from({ length: 7 }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div
            className="h-4 animate-pulse rounded bg-muted"
            style={{ width: i === 0 ? '60%' : i === 6 ? '40%' : '50%' }}
          />
        </td>
      ))}
    </tr>
  );
}

function StatusBadge({ status, label }: { status: string; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        status === 'ACTIVE'
          ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20'
          : 'bg-orange-50 text-orange-700 ring-1 ring-orange-600/20',
      )}
    >
      {label}
    </span>
  );
}

function RoleBadge({ role, label }: { role: string; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        role === 'GLOBAL_ADMIN'
          ? 'bg-primary/10 text-primary ring-1 ring-primary/20'
          : 'bg-secondary text-secondary-foreground',
      )}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function UsersTable() {
  const t = useTranslations('admin.users');

  // Controlled input state — raw typing
  const [inputValue, setInputValue] = React.useState('');
  // Debounced query value (300ms)
  const [q, setQ] = React.useState('');
  const [status, setStatus] = React.useState<StatusFilter>('all');
  const [role, setRole] = React.useState<RoleFilter>('all');

  // Debounce effect — avoids a tRPC request per keystroke
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setQ(inputValue.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [inputValue]);

  const query = trpc.admin.users.list.useInfiniteQuery(
    { q: q || undefined, status, role, limit: 20 },
    { getNextPageParam: (last) => last.nextCursor ?? undefined },
  );

  const users = query.data?.pages.flatMap((p) => p.items) ?? [];
  const isLoading = query.isLoading;
  const isEmpty = !isLoading && users.length === 0;

  return (
    <div className="space-y-4">
      {/* Filters bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            placeholder={t('search')}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            className="pl-9"
            aria-label={t('search')}
          />
        </div>

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          className={selectClass}
          aria-label={t('filterStatus')}
        >
          <option value="all">{t('statusAll')}</option>
          <option value="ACTIVE">{t('statusActive')}</option>
          <option value="SUSPENDED">{t('statusSuspended')}</option>
        </select>

        <select
          value={role}
          onChange={(e) => setRole(e.target.value as RoleFilter)}
          className={selectClass}
          aria-label={t('filterRole')}
        >
          <option value="all">{t('roleAll')}</option>
          <option value="GLOBAL_ADMIN">{t('roleAdmin')}</option>
          <option value="USER">{t('roleUser')}</option>
        </select>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  {t('tableEmail')}
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  {t('tableName')}
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  {t('tableRole')}
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  {t('tableStatus')}
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  {t('table2fa')}
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  {t('tableLastLogin')}
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                  {t('tableActions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading && Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}

              {!isLoading &&
                users.map((u) => (
                  <tr
                    key={u.id}
                    className="border-b transition-colors last:border-0 hover:bg-muted/40"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-foreground/80">{u.email}</td>
                    <td className="px-4 py-3 text-foreground">
                      {u.displayName ?? <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <RoleBadge
                        role={u.role}
                        label={u.role === 'GLOBAL_ADMIN' ? t('roleAdmin') : t('roleUser')}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        status={u.status}
                        label={u.status === 'ACTIVE' ? t('statusActive') : t('statusSuspended')}
                      />
                    </td>
                    <td className="px-4 py-3">
                      {u.twoFactorEnabled ? (
                        <Check
                          className="h-4 w-4 text-emerald-600"
                          aria-label={t('table2faActive')}
                        />
                      ) : (
                        <span
                          className="text-muted-foreground"
                          aria-label={t('table2faInactive')}
                        >
                          —
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString('fr-FR') : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <Link
                          href={`/admin/users/${u.id}`}
                        >
                          {t('viewDetails')}
                        </Link>
                      </Button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {/* Empty state */}
        {isEmpty && (
          <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Users className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            </div>
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
          </div>
        )}
      </div>

      {/* Load more */}
      {query.hasNextPage && (
        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
          >
            {query.isFetchingNextPage ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                {t('loadMore')}
              </>
            ) : (
              t('loadMore')
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
