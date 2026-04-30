'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LibraryBig, BookOpen, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

export function MemberSidebar({ slug }: { slug?: string }) {
  const t = useTranslations('member.nav');
  const pathname = usePathname();
  const items: Array<{
    href: string;
    label: string;
    icon: typeof LibraryBig;
    active: boolean;
    disabled?: boolean;
  }> = [
    {
      href: '/libraries',
      label: t('myLibraries'),
      icon: LibraryBig,
      active: pathname === '/libraries',
    },
    ...(slug
      ? [
          {
            href: `/library/${slug}/books`,
            label: t('catalog'),
            icon: BookOpen,
            active: pathname.startsWith(`/library/${slug}/books`),
          },
          {
            href: '#',
            label: `${t('loans')} (${t('loansComingSoon')})`,
            icon: Clock,
            active: false,
            disabled: true,
          },
        ]
      : []),
  ];
  return (
    <nav aria-label="Member navigation" className="flex flex-col gap-1">
      {items.map((it) => (
        <Link
          key={it.href + it.label}
          href={it.disabled ? '#' : it.href}
          aria-disabled={it.disabled || undefined}
          className={cn(
            'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition',
            it.active && 'bg-muted font-medium',
            !it.active && !it.disabled && 'hover:bg-muted/50',
            it.disabled && 'pointer-events-none text-muted-foreground/60',
          )}
        >
          <it.icon className="h-4 w-4" aria-hidden />
          {it.label}
        </Link>
      ))}
    </nav>
  );
}
