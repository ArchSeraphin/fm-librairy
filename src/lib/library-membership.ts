import { TRPCError } from '@trpc/server';
import type { Library, LibraryMember, LibraryRole, UserRole } from '@prisma/client';
import { db } from './db';

export interface MembershipActor {
  id: string;
  role: UserRole;
}

export interface MembershipResult {
  library: Library;
  membership: LibraryMember | null;
}

/**
 * Resolve a Library by slug and assert the actor has access.
 *
 * @param actor  - The authenticated user (`{ id, role }`).
 * @param slug   - The library slug to look up.
 * @param requiredRole - Optional minimum LibraryRole. When provided, the actor's
 *                       LibraryMember.role must match exactly (LIBRARY_ADMIN > MEMBER
 *                       is NOT implied — pass undefined to skip this check).
 *
 * Rules:
 * - GLOBAL_ADMIN: bypasses membership check, returns `{ library, membership: null }`.
 *   Sees archived libraries too.
 * - Non-admin without a LibraryMember row → NOT_FOUND (same error as missing slug,
 *   to prevent slug enumeration).
 * - Non-admin on an archived library → NOT_FOUND (same opacity).
 * - If requiredRole is passed and the actor's role doesn't match → FORBIDDEN.
 */
export async function assertMembership(
  actor: MembershipActor,
  slug: string,
  requiredRole?: LibraryRole,
): Promise<MembershipResult> {
  if (actor.role === 'GLOBAL_ADMIN') {
    const library = await db.library.findUnique({ where: { slug } });
    if (!library) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
    return { library, membership: null };
  }

  // For non-admins: only surface active libraries (treat archived as NOT_FOUND)
  const library = await db.library.findUnique({
    where: { slug },
  });

  if (!library || library.archivedAt) {
    throw new TRPCError({ code: 'NOT_FOUND' });
  }

  const membership = await db.libraryMember.findUnique({
    where: { userId_libraryId: { userId: actor.id, libraryId: library.id } },
  });

  if (!membership) {
    throw new TRPCError({ code: 'NOT_FOUND' });
  }

  if (requiredRole && membership.role !== requiredRole) {
    throw new TRPCError({ code: 'FORBIDDEN' });
  }

  return { library, membership };
}
