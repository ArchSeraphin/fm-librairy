import { useTranslations } from 'next-intl';
import { BrandMark } from '@/components/brand/BrandMark';

export const dynamic = 'force-dynamic';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('auth.layout');
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-muted p-6">
      <BrandMark className="mb-8" />
      <div className="w-full max-w-sm">{children}</div>
      <p className="mt-6 text-center text-xs text-muted-foreground">{t('invite')}</p>
    </main>
  );
}
