import { redirect } from 'next/navigation';
import { getCurrentSessionAndUser } from '@/server/auth/session-bridge';
import { db } from '@/lib/db';

/**
 * Resolves the current user. Redirects to /login if anonymous or pending 2FA.
 * Returns the user. Use in server components for the /libraries and /library/* tree.
 */
export async function requireAuthedUser() {
  const result = await getCurrentSessionAndUser();
  if (!result || result.session.pending2fa) redirect('/login');
  return result.user;
}

/**
 * For /library/[slug]/* routes: also ensures the user has access to that slug.
 * Redirects to /libraries with ?error=not-a-member if they don't.
 */
export async function requireMembership(slug: string) {
  const user = await requireAuthedUser();
  if (user.role === 'GLOBAL_ADMIN') {
    const lib = await db.library.findUnique({ where: { slug } });
    if (!lib) redirect('/libraries?error=not-found');
    return { user, library: lib, membership: null };
  }
  const lib = await db.library.findUnique({ where: { slug } });
  if (!lib || lib.archivedAt !== null) redirect('/libraries?error=not-found');
  const membership = await db.libraryMember.findUnique({
    where: { userId_libraryId: { userId: user.id, libraryId: lib.id } },
  });
  if (!membership) redirect('/libraries?error=not-a-member');
  return { user, library: lib, membership };
}
