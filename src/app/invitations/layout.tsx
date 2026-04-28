import { BrandMark } from '@/components/brand/BrandMark';

export const dynamic = 'force-dynamic';

export default function InvitationsLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-muted p-6">
      <BrandMark className="mb-8" />
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
