'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { User, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';

const items = [
  { href: '/account', icon: User, key: 'profile' as const },
  { href: '/account/security', icon: Shield, key: 'security' as const },
];

export function AccountSidebar() {
  const t = useTranslations('account.nav');
  const pathname = usePathname();
  return (
    <nav aria-label="Account sections" className="flex flex-col gap-1 p-4">
      {items.map(({ href, icon: Icon, key }) => {
        const active =
          pathname === href || (href === '/account/security' && pathname.startsWith(href));
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
              active
                ? 'bg-accent/10 font-medium text-accent'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}
