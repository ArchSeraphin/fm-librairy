'use client';

import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ShieldAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface TwoFactorBannerProps {
  /** ISO string of the absolute deadline (createdAt + 7 days). */
  requiredBy: string;
}

type Variant = 'urgent' | 'critical' | 'last-day';

interface RemainingState {
  variant: Variant;
  daysLeft: number;
  hoursLeft: number;
}

function computeRemaining(deadlineMs: number, nowMs: number): RemainingState | null {
  const diff = deadlineMs - nowMs;
  if (diff <= 0) return null;
  const hoursLeft = Math.ceil(diff / (60 * 60 * 1000));
  const daysLeft = Math.ceil(diff / (24 * 60 * 60 * 1000));
  const variant: Variant = hoursLeft <= 24 ? 'last-day' : daysLeft < 3 ? 'critical' : 'urgent';
  return { variant, daysLeft, hoursLeft };
}

export function TwoFactorBanner({ requiredBy }: TwoFactorBannerProps) {
  const t = useTranslations('auth.banner');
  const deadlineMs = React.useMemo(() => new Date(requiredBy).getTime(), [requiredBy]);

  const [state, setState] = React.useState<RemainingState | null>(() =>
    computeRemaining(deadlineMs, Date.now()),
  );

  React.useEffect(() => {
    const id = setInterval(() => {
      setState(computeRemaining(deadlineMs, Date.now()));
    }, 60_000);
    return () => clearInterval(id);
  }, [deadlineMs]);

  if (!state) return null;

  const { variant, daysLeft, hoursLeft } = state;
  const text =
    variant === 'last-day'
      ? t('lastDay.hours', { count: hoursLeft })
      : daysLeft === 1
        ? t('urgent.daysSingular', { count: 1 })
        : t('urgent.daysPlural', { count: daysLeft });
  const cta = variant === 'last-day' ? t('cta.urgent') : t('cta');

  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        'sticky top-0 z-40 border-b backdrop-blur',
        variant === 'last-day'
          ? 'border-destructive/30 bg-destructive/10'
          : variant === 'critical'
            ? 'border-warning/40 bg-warning/15'
            : 'border-warning/30 bg-warning/10',
      )}
    >
      <div className="container mx-auto flex items-center gap-3 px-4 py-2.5">
        <ShieldAlert
          className={cn(
            'h-4 w-4 shrink-0',
            variant === 'last-day' ? 'text-destructive' : 'text-warning',
          )}
          aria-hidden="true"
        />
        <p
          className={cn(
            'flex-1 text-sm',
            variant === 'last-day' ? 'text-destructive' : 'text-foreground',
          )}
        >
          {text}
        </p>
        <Button asChild size="sm" variant={variant === 'last-day' ? 'destructive' : 'default'}>
          <Link href="/2fa/setup">{cta}</Link>
        </Button>
      </div>
    </div>
  );
}
