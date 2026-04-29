'use client';

import { useState } from 'react';
import { Menu } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { BrandMark } from '@/components/brand/BrandMark';
import { LogoutButton } from '@/components/auth/LogoutButton';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { AccountSidebar } from './AccountSidebar';

export function AccountHeader() {
  const t = useTranslations('account.header');
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
              <div onClick={() => setOpen(false)}>
                <AccountSidebar />
              </div>
            </SheetContent>
          </Sheet>
          <BrandMark size="sm" />
        </div>
        <LogoutButton className="text-muted-foreground hover:text-foreground" />
      </div>
    </header>
  );
}
