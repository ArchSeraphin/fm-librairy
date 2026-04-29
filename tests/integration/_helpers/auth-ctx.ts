import { hashPassword } from '@/lib/password';
import type { Session, User } from '@prisma/client';
import { getTestPrisma } from '../setup/prisma';

const HASH_64 = 'a'.repeat(64);
const prisma = getTestPrisma();

export type RoleKey = 'GLOBAL_ADMIN' | 'LIBRARY_ADMIN' | 'MEMBER' | 'ANON' | 'PENDING_2FA';

export interface RoleCtx {
  session: Session | null;
  user: User | null;
  ip: string;
  libraryId?: string;
}

/**
 * Build a minimal tRPC context for a given role.
 *
 * - ANON: no session, no user.
 * - PENDING_2FA: a USER row + a Session row with pending2fa=true (so authedProcedure denies).
 * - MEMBER / LIBRARY_ADMIN: regular USER + Session + a Library + LibraryMember row at the matching role.
 * - GLOBAL_ADMIN: USER row with role=GLOBAL_ADMIN, twoFactorEnabled=true (to pass the 7-day budget check).
 *
 * The DB rows are created fresh for each call; tests must `truncateAll()` between iterations to keep
 * unique-constraint pressure (email, slug, sessionToken) low.
 */
export async function makeCtxForRole(role: RoleKey): Promise<RoleCtx> {
  if (role === 'ANON') return { session: null, user: null, ip: '203.0.113.1' };

  const suffix = Math.random().toString(36).slice(2, 8);
  const baseEmail = `${role.toLowerCase()}-${suffix}@e2e.test`;
  const user = await prisma.user.create({
    data: {
      email: baseEmail,
      passwordHash: await hashPassword('Pwd12345!XYZ'),
      displayName: role,
      role: role === 'GLOBAL_ADMIN' ? 'GLOBAL_ADMIN' : 'USER',
      twoFactorEnabled: role === 'GLOBAL_ADMIN',
      status: 'ACTIVE',
    },
  });

  const session = await prisma.session.create({
    data: {
      sessionToken: `${role}-${user.id}`,
      userId: user.id,
      expiresAt: new Date(Date.now() + 60_000),
      ipHash: HASH_64,
      userAgentHash: HASH_64,
      pending2fa: role === 'PENDING_2FA',
    },
  });

  let libraryId: string | undefined;
  if (role === 'LIBRARY_ADMIN' || role === 'MEMBER') {
    const lib = await prisma.library.create({
      data: {
        name: `Lib-${role}-${user.id}`,
        slug: `lib-${role.toLowerCase()}-${user.id}`,
      },
    });
    await prisma.libraryMember.create({
      data: {
        userId: user.id,
        libraryId: lib.id,
        role: role === 'LIBRARY_ADMIN' ? 'LIBRARY_ADMIN' : 'MEMBER',
      },
    });
    libraryId = lib.id;
  }

  return { session, user, ip: '203.0.113.1', libraryId };
}
