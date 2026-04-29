import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// StatusBadge — ACTIVE / SUSPENDED visual pill
// ---------------------------------------------------------------------------

export function StatusBadge({ status, label }: { status: string; label: string }) {
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

// ---------------------------------------------------------------------------
// RoleBadge — GLOBAL_ADMIN / USER visual pill
// ---------------------------------------------------------------------------

export function RoleBadge({ role, label }: { role: string; label: string }) {
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
