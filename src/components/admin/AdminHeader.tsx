import { useTranslations } from 'next-intl';

import { BrandMark } from '@/components/brand/BrandMark';
import { LogoutButton } from '@/components/auth/LogoutButton';

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
        <LogoutButton className="text-muted-foreground hover:text-foreground" />
      </div>
    </header>
  );
}
