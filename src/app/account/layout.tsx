import { redirect } from 'next/navigation';
import { getCurrentSessionAndUser } from '@/server/auth/session-bridge';
import { AccountHeader } from '@/components/account/AccountHeader';
import { AccountSidebar } from '@/components/account/AccountSidebar';

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const result = await getCurrentSessionAndUser();
  if (!result) redirect('/login');
  return (
    <div className="min-h-dvh bg-background">
      <AccountHeader />
      <div className="container mx-auto flex flex-col gap-4 px-4 py-6 lg:flex-row lg:gap-8 lg:py-8">
        <aside className="lg:w-56 lg:shrink-0 lg:border-r lg:pr-4">
          <AccountSidebar />
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
