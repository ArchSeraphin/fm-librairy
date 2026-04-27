'use client';

import { LogOut } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';

type LogoutButtonProps = {
  className?: string;
};

export function LogoutButton({ className }: LogoutButtonProps) {
  const t = useTranslations('admin.header');
  return (
    <form action="/logout" method="post">
      <Button type="submit" variant="ghost" size="sm" className={className}>
        <LogOut />
        <span className="hidden sm:inline">{t('signOut')}</span>
      </Button>
    </form>
  );
}
