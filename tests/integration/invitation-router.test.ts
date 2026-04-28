import { describe, it, expect, beforeEach } from 'vitest';
import { appRouter } from '@/server/trpc/routers/_app';
import { getTestPrisma, truncateAll } from './setup/prisma';
import { hashPassword } from '@/lib/password';

const prisma = getTestPrisma();

async function buildCtx(opts: { user?: any; session?: any } = {}) {
  return { user: opts.user ?? null, session: opts.session ?? null };
}

async function seedSession(userId: string) {
  return prisma.session.create({
    data: {
      userId,
      sessionToken: `s-${Date.now()}-${Math.random()}`,
      expiresAt: new Date(Date.now() + 3600_000),
      pending2fa: false,
      lastActivityAt: new Date(),
      ipHash: 'x'.repeat(64),
      userAgentHash: 'x'.repeat(64),
    },
  });
}

beforeEach(async () => {
  await truncateAll();
});

describe('invitation router', () => {
  it('global admin creates a global invitation (no libraryId)', async () => {
    const u = await prisma.user.create({
      data: {
        email: `admin-${Date.now()}@x.test`,
        displayName: 'Admin',
        passwordHash: await hashPassword('x'),
        role: 'GLOBAL_ADMIN',
        twoFactorEnabled: true,
        createdAt: new Date(Date.now() - 365 * 86400 * 1000),
      },
    });
    const session = await seedSession(u.id);
    const caller = appRouter.createCaller(await buildCtx({ user: u, session }));
    const out = await caller.invitation.create({ email: 'new@x.test' });
    expect(out.mode).toBe('signup');
    const audits = await prisma.auditLog.findMany({ where: { action: 'auth.invitation.created' } });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.metadata).toMatchObject({ mode: 'signup' });
  });

  it('library admin invites to their library', async () => {
    const u = await prisma.user.create({
      data: {
        email: `libadmin-${Date.now()}@x.test`,
        displayName: 'L',
        passwordHash: await hashPassword('x'),
        role: 'USER',
        twoFactorEnabled: false,
      },
    });
    const lib = await prisma.library.create({ data: { name: 'L', slug: `l-${Date.now()}` } });
    await prisma.libraryMember.create({
      data: { userId: u.id, libraryId: lib.id, role: 'LIBRARY_ADMIN' },
    });
    const session = await seedSession(u.id);
    const caller = appRouter.createCaller(await buildCtx({ user: u, session }));
    const out = await caller.invitation.create({
      email: 'new2@x.test',
      libraryId: lib.id,
      proposedRole: 'MEMBER',
    });
    expect(out.invitationId).toBeTruthy();
  });

  it('non-admin trying to invite to a library is forbidden', async () => {
    const u = await prisma.user.create({
      data: {
        email: `plain-${Date.now()}@x.test`,
        displayName: 'P',
        passwordHash: await hashPassword('x'),
        role: 'USER',
      },
    });
    const lib = await prisma.library.create({ data: { name: 'L', slug: `l-${Date.now()}` } });
    const session = await seedSession(u.id);
    const caller = appRouter.createCaller(await buildCtx({ user: u, session }));
    await expect(
      caller.invitation.create({ email: 'x@x.test', libraryId: lib.id }),
    ).rejects.toThrow(/FORBIDDEN/);
  });
});
