'use client';

import { signOut } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { LogOut } from 'lucide-react';

import { BrandMark } from '@/components/brand/BrandMark';
import { Button } from '@/components/ui/button';

export function AdminHeader() {
  const t = useTranslations('admin.header');

  return (
    <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
      <div className="container mx-auto flex h-14 items-center justify-between px-4">
        <div className="flex items-center gap-4">
          <BrandMark size="sm" />
          <span className="hidden text-xs uppercase tracking-wider text-muted-foreground sm:inline">
            {t('phase')}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="text-muted-foreground hover:text-foreground"
        >
          <LogOut />
          <span className="hidden sm:inline">{t('signOut')}</span>
        </Button>
      </div>
    </header>
  );
}
