'use client';

import { useState } from 'react';
import { Menu } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { BrandMark } from '@/components/brand/BrandMark';
import { LogoutButton } from '@/components/auth/LogoutButton';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { AdminSidebar } from './AdminSidebar';

export function AdminHeader() {
  const t = useTranslations('admin.header');
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
      <div className="container mx-auto flex h-14 items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label={t('openMenu')}>
                <Menu className="h-5 w-5" aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0">
              <SheetHeader className="sr-only">
                <SheetTitle>{t('menuTitle')}</SheetTitle>
              </SheetHeader>
              <div className="p-4" onClick={() => setOpen(false)}>
                <AdminSidebar />
              </div>
            </SheetContent>
          </Sheet>
          <BrandMark size="sm" />
          <span className="hidden text-xs uppercase tracking-wider text-muted-foreground sm:inline">
            {t('phase')}
          </span>
        </div>
        <LogoutButton className="text-muted-foreground hover:text-foreground" />
      </div>
    </header>
  );
}
