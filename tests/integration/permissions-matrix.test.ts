import { beforeEach, describe, expect, test } from 'vitest';
import { TRPCError } from '@trpc/server';
import { appRouter } from '@/server/trpc/routers/_app';
import { truncateAll, getTestPrisma } from './setup/prisma';
import { makeCtxForRole, type RoleKey, type RoleCtx } from './_helpers/auth-ctx';

type Outcome = 'allow' | 'deny';
type Caller = ReturnType<typeof appRouter.createCaller>;

interface MatrixCase {
  router: string;
  procedure: string;
  byRole: Record<RoleKey, Outcome>;
  call: (caller: Caller, ctx: RoleCtx) => Promise<unknown>;
}

const ANY_DENY: Record<RoleKey, Outcome> = {
  GLOBAL_ADMIN: 'deny',
  LIBRARY_ADMIN: 'deny',
  MEMBER: 'deny',
  ANON: 'deny',
  PENDING_2FA: 'deny',
};

const GLOBAL_ONLY: Record<RoleKey, Outcome> = { ...ANY_DENY, GLOBAL_ADMIN: 'allow' };
const AUTHED_ONLY: Record<RoleKey, Outcome> = {
  ...ANY_DENY,
  GLOBAL_ADMIN: 'allow',
  LIBRARY_ADMIN: 'allow',
  MEMBER: 'allow',
};
const ADMIN_ONLY: Record<RoleKey, Outcome> = {
  ...ANY_DENY,
  GLOBAL_ADMIN: 'allow',
  LIBRARY_ADMIN: 'allow',
};

// Stub cuid (length 25) used as input where the procedure expects a cuid.
// Allow path will surface NOT_FOUND/BAD_REQUEST/CONFLICT, which is silenced.
const STUB_CUID = 'cabcdefghijklmnopqrstuvwx';

const prisma = getTestPrisma();

async function resolveSlugFromCtx(ctx: RoleCtx): Promise<string> {
  // For roles that have a seeded library (LIBRARY_ADMIN, MEMBER), look up its slug
  // so the membership middleware passes. For roles without a library (GA, ANON,
  // PENDING_2FA), any non-empty slug passes Zod — those roles fail at the auth
  // gate (or, for GA, hit a procedure-body NOT_FOUND which the harness silences).
  if (ctx.libraryId) {
    const lib = await prisma.library.findUnique({ where: { id: ctx.libraryId } });
    if (lib) return lib.slug;
  }
  return 'placeholder-slug';
}

const matrix: MatrixCase[] = [
  // -------- admin.users -- global admin only --------
  {
    router: 'admin.users',
    procedure: 'list',
    byRole: GLOBAL_ONLY,
    call: (c) => c.admin.users.list({ limit: 20 }),
  },
  {
    router: 'admin.users',
    procedure: 'get',
    byRole: GLOBAL_ONLY,
    call: (c) => c.admin.users.get({ id: STUB_CUID }),
  },
  {
    router: 'admin.users',
    procedure: 'suspend',
    byRole: GLOBAL_ONLY,
    call: (c) => c.admin.users.suspend({ id: STUB_CUID, reason: 'matrix probe' }),
  },
  {
    router: 'admin.users',
    procedure: 'reactivate',
    byRole: GLOBAL_ONLY,
    call: (c) => c.admin.users.reactivate({ id: STUB_CUID }),
  },
  {
    router: 'admin.users',
    procedure: 'delete',
    byRole: GLOBAL_ONLY,
    call: (c) => c.admin.users.delete({ id: STUB_CUID, confirmEmail: 'noone@example.test' }),
  },
  {
    router: 'admin.users',
    procedure: 'changeRole',
    byRole: GLOBAL_ONLY,
    call: (c) => c.admin.users.changeRole({ id: STUB_CUID, newRole: 'USER' }),
  },
  {
    router: 'admin.users',
    procedure: 'resetTwoFactor',
    byRole: GLOBAL_ONLY,
    call: (c) => c.admin.users.resetTwoFactor({ id: STUB_CUID, reason: 'matrix probe' }),
  },
  {
    router: 'admin.users.invitations',
    procedure: 'list',
    byRole: GLOBAL_ONLY,
    call: (c) => c.admin.users.invitations.list({ userId: STUB_CUID }),
  },
  {
    router: 'admin.users.invitations',
    procedure: 'revoke',
    byRole: GLOBAL_ONLY,
    call: (c) => c.admin.users.invitations.revoke({ invitationId: STUB_CUID }),
  },
  {
    router: 'admin.users.sessions',
    procedure: 'list',
    byRole: GLOBAL_ONLY,
    call: (c) => c.admin.users.sessions.list({ userId: STUB_CUID }),
  },
  {
    router: 'admin.users.audit',
    procedure: 'list',
    byRole: GLOBAL_ONLY,
    call: (c) => c.admin.users.audit.list({ userId: STUB_CUID, limit: 10 }),
  },

  // -------- admin.libraries -- global admin only --------
  {
    router: 'admin.libraries',
    procedure: 'list',
    byRole: GLOBAL_ONLY,
    call: (c) => c.admin.libraries.list({ limit: 20 }),
  },
  {
    router: 'admin.libraries',
    procedure: 'get',
    byRole: GLOBAL_ONLY,
    call: (c) => c.admin.libraries.get({ id: STUB_CUID }),
  },
  {
    router: 'admin.libraries',
    procedure: 'create',
    byRole: GLOBAL_ONLY,
    call: (c) =>
      c.admin.libraries.create({
        name: `Lib-${Math.random().toString(36).slice(2, 8)}`,
      }),
  },
  {
    router: 'admin.libraries',
    procedure: 'rename',
    byRole: GLOBAL_ONLY,
    call: (c) => c.admin.libraries.rename({ id: STUB_CUID, name: 'New Name' }),
  },
  {
    router: 'admin.libraries',
    procedure: 'archive',
    byRole: GLOBAL_ONLY,
    call: (c) => c.admin.libraries.archive({ id: STUB_CUID, reason: 'matrix probe' }),
  },
  {
    router: 'admin.libraries',
    procedure: 'unarchive',
    byRole: GLOBAL_ONLY,
    call: (c) => c.admin.libraries.unarchive({ id: STUB_CUID }),
  },
  {
    router: 'admin.libraries.members',
    procedure: 'list',
    byRole: GLOBAL_ONLY,
    call: (c) => c.admin.libraries.members.list({ libraryId: STUB_CUID, limit: 20 }),
  },
  {
    router: 'admin.libraries.members',
    procedure: 'add',
    byRole: GLOBAL_ONLY,
    call: (c) =>
      c.admin.libraries.members.add({
        libraryId: STUB_CUID,
        userId: STUB_CUID,
        role: 'MEMBER',
        flags: { canRead: true, canUpload: false, canDownload: true },
      }),
  },
  {
    router: 'admin.libraries.members',
    procedure: 'remove',
    byRole: GLOBAL_ONLY,
    call: (c) => c.admin.libraries.members.remove({ libraryId: STUB_CUID, userId: STUB_CUID }),
  },
  {
    router: 'admin.libraries.members',
    procedure: 'changeRole',
    byRole: GLOBAL_ONLY,
    call: (c) =>
      c.admin.libraries.members.changeRole({
        libraryId: STUB_CUID,
        userId: STUB_CUID,
        newRole: 'MEMBER',
      }),
  },
  {
    router: 'admin.libraries.members',
    procedure: 'updateFlags',
    byRole: GLOBAL_ONLY,
    call: (c) =>
      c.admin.libraries.members.updateFlags({
        libraryId: STUB_CUID,
        userId: STUB_CUID,
        flags: { canRead: true, canUpload: false, canDownload: true },
      }),
  },

  // -------- account.profile -- any authed user --------
  {
    router: 'account.profile',
    procedure: 'get',
    byRole: AUTHED_ONLY,
    call: (c) => c.account.profile.get(),
  },
  {
    router: 'account.profile',
    procedure: 'update',
    byRole: AUTHED_ONLY,
    call: (c) => c.account.profile.update({ displayName: 'Probe', locale: 'fr' }),
  },

  // -------- account.security -- any authed user --------
  {
    router: 'account.security',
    procedure: 'changePassword',
    byRole: AUTHED_ONLY,
    call: (c) =>
      c.account.security.changePassword({
        currentPassword: 'Pwd12345!XYZ',
        newPassword: 'NewPwd123!XYZ',
        confirmPassword: 'NewPwd123!XYZ',
      }),
  },
  {
    router: 'account.security',
    procedure: 'listSessions',
    byRole: AUTHED_ONLY,
    call: (c) => c.account.security.listSessions(),
  },
  {
    router: 'account.security',
    procedure: 'revokeSession',
    byRole: AUTHED_ONLY,
    call: (c) => c.account.security.revokeSession({ sessionId: STUB_CUID }),
  },
  {
    router: 'account.security',
    procedure: 'revokeAllOtherSessions',
    byRole: AUTHED_ONLY,
    call: (c) => c.account.security.revokeAllOtherSessions(),
  },
  {
    router: 'account.security',
    procedure: 'regenerateBackupCodes',
    byRole: AUTHED_ONLY,
    call: (c) =>
      c.account.security.regenerateBackupCodes({
        currentPassword: 'Pwd12345!XYZ',
        totpCode: '123456',
      }),
  },
  {
    // GLOBAL_ADMIN is intentionally denied at the procedure level: the global-admin
    // 2FA reset must go through the DBA runbook, not the self-service backup-code path.
    // So for this row only, GLOBAL_ADMIN is a deny outcome (FORBIDDEN from business code).
    router: 'account.security',
    procedure: 'startReEnrollWithBackup',
    byRole: { ...AUTHED_ONLY, GLOBAL_ADMIN: 'deny' },
    call: (c) => c.account.security.startReEnrollWithBackup({ backupCode: 'ABCD-EFGH' }),
  },

  // -------- library.books × 5 roles -- read = AUTHED_ONLY, mutations = ADMIN_ONLY, delete = GLOBAL_ONLY --------
  {
    router: 'library.books',
    procedure: 'list',
    byRole: AUTHED_ONLY,
    call: async (c, ctx) => {
      const slug = await resolveSlugFromCtx(ctx);
      return c.library.books.list({ slug, limit: 24 });
    },
  },
  {
    router: 'library.books',
    procedure: 'get',
    byRole: AUTHED_ONLY,
    call: async (c, ctx) => {
      const slug = await resolveSlugFromCtx(ctx);
      return c.library.books.get({ slug, id: STUB_CUID });
    },
  },
  {
    router: 'library.books',
    procedure: 'create',
    byRole: ADMIN_ONLY,
    call: async (c, ctx) => {
      const slug = await resolveSlugFromCtx(ctx);
      return c.library.books.create({ slug, title: 'matrix probe', authors: ['X'] });
    },
  },
  {
    router: 'library.books',
    procedure: 'update',
    byRole: ADMIN_ONLY,
    call: async (c, ctx) => {
      const slug = await resolveSlugFromCtx(ctx);
      return c.library.books.update({
        slug,
        id: STUB_CUID,
        expectedUpdatedAt: new Date(),
        patch: { title: 'matrix probe updated' },
      });
    },
  },
  {
    router: 'library.books',
    procedure: 'archive',
    byRole: ADMIN_ONLY,
    call: async (c, ctx) => {
      const slug = await resolveSlugFromCtx(ctx);
      return c.library.books.archive({ slug, id: STUB_CUID });
    },
  },
  {
    router: 'library.books',
    procedure: 'unarchive',
    byRole: ADMIN_ONLY,
    call: async (c, ctx) => {
      const slug = await resolveSlugFromCtx(ctx);
      return c.library.books.unarchive({ slug, id: STUB_CUID });
    },
  },
  {
    router: 'library.books',
    procedure: 'delete',
    byRole: GLOBAL_ONLY,
    call: async (c, ctx) => {
      const slug = await resolveSlugFromCtx(ctx);
      return c.library.books.delete({ slug, id: STUB_CUID });
    },
  },
  {
    router: 'library.libraries',
    procedure: 'listAccessible',
    byRole: AUTHED_ONLY,
    call: (c) => c.library.libraries.listAccessible(),
  },
];

const ALL_ROLES: RoleKey[] = ['GLOBAL_ADMIN', 'LIBRARY_ADMIN', 'MEMBER', 'ANON', 'PENDING_2FA'];

describe('permissions matrix', () => {
  beforeEach(truncateAll);

  for (const tc of matrix) {
    describe(`${tc.router}.${tc.procedure}`, () => {
      for (const role of ALL_ROLES) {
        const expected = tc.byRole[role];
        test(`${role} -> ${expected}`, async () => {
          const ctx = await makeCtxForRole(role);
          const caller = appRouter.createCaller(ctx);
          if (expected === 'allow') {
            // Allow = the procedure runs through the auth gate. It MAY still throw a
            // business error (NOT_FOUND, BAD_REQUEST, CONFLICT, PRECONDITION_FAILED,
            // TOO_MANY_REQUESTS, UNAUTHORIZED-from-business-logic, ...) and that is fine
            // for this matrix: we only assert that the AUTH gate did not deny.
            try {
              await tc.call(caller, ctx);
            } catch (err) {
              if (err instanceof TRPCError) {
                // FORBIDDEN here means the auth gate denied: that is a real failure.
                // (UNAUTHORIZED can come from business code re-checking credentials —
                // e.g. wrong password in changePassword — so it is NOT proof of a gate
                // denial. We only fail on FORBIDDEN.)
                expect(err.code).not.toBe('FORBIDDEN');
              } else {
                throw err;
              }
            }
          } else {
            await expect(tc.call(caller, ctx)).rejects.toMatchObject({
              code: expect.stringMatching(/^(UNAUTHORIZED|FORBIDDEN)$/),
            });
          }
        });
      }
    });
  }

  // --- Anti-drift guard ----------------------------------------------------
  // tRPC v11 stores every procedure in `appRouter._def.procedures` keyed by its
  // dotted path (e.g. "admin.users.list"). We restrict coverage to the admin.*,
  // account.*, and library.* sub-trees — the auth/invitation/password routers
  // expose flows covered elsewhere (signup, password-reset, enrol-2FA) and
  // intentionally use a mix of public/pending/authed gates that this matrix does
  // not model.
  test('matrix covers every protected procedure under admin.*, account.*, and library.*', () => {
    const procedures = listProtectedProcedures(appRouter);
    const covered = new Set(matrix.map((m) => `${m.router}.${m.procedure}`));
    const missing = procedures.filter((p) => !covered.has(p));
    expect(missing).toEqual([]);
    // Also assert no stale entries: every matrix row points at a real procedure.
    const stale = [...covered].filter((p) => !procedures.includes(p));
    expect(stale).toEqual([]);
  });
});

function listProtectedProcedures(router: typeof appRouter): string[] {
  const def = (router as unknown as { _def?: { procedures?: Record<string, unknown> } })._def;
  const procedures = def?.procedures ?? {};
  return Object.keys(procedures).filter(
    (name) =>
      name.startsWith('admin.') ||
      name.startsWith('account.') ||
      name.startsWith('library.'),
  );
}
