import { BrandMark } from '@/components/brand/BrandMark';
import { LogoutButton } from '@/components/auth/LogoutButton';

export function AccountHeader() {
  return (
    <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
      <div className="container mx-auto flex h-14 items-center justify-between px-4">
        <BrandMark size="sm" />
        <LogoutButton className="text-muted-foreground hover:text-foreground" />
      </div>
    </header>
  );
}
