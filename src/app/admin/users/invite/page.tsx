import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { getCurrentSessionAndUser } from '@/server/auth/session-bridge';
import { InviteForm } from './invite-form';

export const metadata: Metadata = {
  title: 'Inviter un membre — BiblioShare',
};

export default async function InviteUserPage() {
  const result = await getCurrentSessionAndUser();
  if (!result || !result.user) redirect('/login');
  if (result.session.pending2fa) redirect('/login/2fa');
  const user = result.user;

  let libraries: { id: string; name: string }[] = [];
  if (user.role === 'GLOBAL_ADMIN') {
    // eslint-disable-next-line local/no-unscoped-prisma -- raison: GLOBAL_ADMIN doit voir toutes les bibliothèques pour inviter dans n'importe laquelle
    libraries = await db.library.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  } else {
    const memberships = await db.libraryMember.findMany({
      where: { userId: user.id, role: 'LIBRARY_ADMIN' },
      include: { library: { select: { id: true, name: true } } },
    });
    libraries = memberships.map((m) => m.library);
    if (libraries.length === 0) redirect('/admin');
  }

  return <InviteForm libraries={libraries} />;
}
