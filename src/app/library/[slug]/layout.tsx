import { requireMembership } from '@/server/auth/member-guard';
import { MemberHeader } from '@/components/member/MemberHeader';
import { MemberSidebar } from '@/components/member/MemberSidebar';

export default async function LibraryLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  await requireMembership(slug);
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <MemberHeader currentSlug={slug} />
      <div className="container mx-auto flex flex-1 gap-8 px-4 py-8">
        <aside className="hidden lg:block lg:w-56 lg:shrink-0 lg:border-r lg:pr-6">
          <MemberSidebar slug={slug} />
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
