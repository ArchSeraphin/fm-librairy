import { redirect } from 'next/navigation';
import { getCurrentSessionAndUser } from '@/server/auth/session-bridge';
import { SEVEN_DAYS_MS } from '@/lib/permissions';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { TwoFactorBanner } from '@/components/auth/TwoFactorBanner';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const result = await getCurrentSessionAndUser();
  if (!result) redirect('/login');
  if (result.user.role !== 'GLOBAL_ADMIN') redirect('/');

  const requiredByMs = result.user.createdAt.getTime() + SEVEN_DAYS_MS;
  const showBanner = !result.user.twoFactorEnabled && Date.now() < requiredByMs;

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <AdminHeader />
      {showBanner && <TwoFactorBanner requiredBy={new Date(requiredByMs).toISOString()} />}
      <div className="container mx-auto flex flex-1 gap-8 px-4 py-8">
        <aside className="shrink-0 lg:w-56 lg:border-r lg:pr-6">
          <AdminSidebar />
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
