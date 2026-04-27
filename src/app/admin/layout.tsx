import { redirect } from 'next/navigation';
import { getCurrentSessionAndUser } from '@/server/auth/session-bridge';
import { SEVEN_DAYS_MS } from '@/lib/permissions';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { TwoFactorBanner } from '@/components/auth/TwoFactorBanner';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const result = await getCurrentSessionAndUser();
  if (!result) redirect('/login');
  if (result.user.role !== 'GLOBAL_ADMIN') redirect('/');

  const requiredByMs = result.user.createdAt.getTime() + SEVEN_DAYS_MS;
  const showBanner = !result.user.twoFactorEnabled && Date.now() < requiredByMs;

  return (
    <div className="min-h-dvh bg-background">
      <AdminHeader />
      {showBanner && <TwoFactorBanner requiredBy={new Date(requiredByMs).toISOString()} />}
      <main className="container mx-auto px-4 py-8">{children}</main>
    </div>
  );
}
