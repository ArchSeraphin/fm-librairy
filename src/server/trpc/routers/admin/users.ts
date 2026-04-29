import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { Prisma } from '@prisma/client';
import { t } from '../../trpc';
import { globalAdminProcedure } from '../../procedures';
import { db } from '@/lib/db';
import { recordAudit } from '@/lib/audit-log';
import { assertNotLastGlobalAdmin, revokeAllSessionsForUser } from '@/lib/user-admin';
import { revokeInvitation } from '@/lib/invitations';

const cuid = z.string().min(20).max(40);
const reasonInput = z.string().trim().min(3).max(500);

const listInput = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'all']).default('all'),
  role: z.enum(['GLOBAL_ADMIN', 'USER', 'all']).default('all'),
  cursor: cuid.optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

export const adminUsersRouter = t.router({
  list: globalAdminProcedure.input(listInput).query(async ({ input }) => {
    const where: Prisma.UserWhereInput = {};
    if (input.status !== 'all') where.status = input.status;
    if (input.role !== 'all') where.role = input.role;
    if (input.q) {
      where.OR = [
        { email: { contains: input.q, mode: 'insensitive' } },
        { displayName: { contains: input.q, mode: 'insensitive' } },
      ];
    }
    const items = await db.user.findMany({
      where,
      take: input.limit + 1,
      cursor: input.cursor ? { id: input.cursor } : undefined,
      skip: input.cursor ? 1 : 0,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        status: true,
        twoFactorEnabled: true,
        createdAt: true,
        lastLoginAt: true,
      },
    });
    const hasNextPage = items.length > input.limit;
    if (hasNextPage) items.pop();
    const nextCursor = hasNextPage ? items[items.length - 1]!.id : null;
    return { items, nextCursor };
  }),

  get: globalAdminProcedure.input(z.object({ id: cuid })).query(async ({ input }) => {
    const user = await db.user.findUnique({
      where: { id: input.id },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        status: true,
        twoFactorEnabled: true,
        locale: true,
        createdAt: true,
        lastLoginAt: true,
        _count: {
          select: { sessions: true, invitationsCreated: true, libraryMembers: true },
        },
      },
    });
    if (!user) throw new TRPCError({ code: 'NOT_FOUND' });
    const { _count, ...rest } = user;
    return {
      ...rest,
      counts: {
        sessions: _count.sessions,
        invitationsCreated: _count.invitationsCreated,
        libraryMembers: _count.libraryMembers,
      },
    };
  }),

  suspend: globalAdminProcedure
    .input(z.object({ id: cuid, reason: reasonInput }))
    .mutation(async ({ ctx, input }) => {
      if (input.id === ctx.user.id) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'cannot suspend self' });
      }
      await assertNotLastGlobalAdmin(input.id, 'suspend');
      await db.user.update({ where: { id: input.id }, data: { status: 'SUSPENDED' } });
      const revoked = await revokeAllSessionsForUser(input.id);
      await recordAudit({
        action: 'admin.user.suspended',
        actor: { id: ctx.user.id },
        target: { type: 'USER', id: input.id },
        metadata: { reason: input.reason, sessionsRevoked: revoked },
        req: { ip: ctx.ip },
      });
      return { ok: true };
    }),

  reactivate: globalAdminProcedure
    .input(z.object({ id: cuid }))
    .mutation(async ({ ctx, input }) => {
      const user = await db.user.findUnique({
        where: { id: input.id },
        select: { status: true },
      });
      if (!user) throw new TRPCError({ code: 'NOT_FOUND' });
      if (user.status === 'ACTIVE') return { ok: true };
      await db.user.update({ where: { id: input.id }, data: { status: 'ACTIVE' } });
      await recordAudit({
        action: 'admin.user.reactivated',
        actor: { id: ctx.user.id },
        target: { type: 'USER', id: input.id },
        req: { ip: ctx.ip },
      });
      return { ok: true };
    }),

  delete: globalAdminProcedure
    .input(z.object({ id: cuid, confirmEmail: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      if (input.id === ctx.user.id) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'cannot delete self' });
      }
      const target = await db.user.findUnique({
        where: { id: input.id },
        select: { id: true, email: true, role: true },
      });
      if (!target) throw new TRPCError({ code: 'NOT_FOUND' });
      if (target.email.toLowerCase() !== input.confirmEmail.toLowerCase()) {
        await recordAudit({
          action: 'permission.denied',
          actor: { id: ctx.user.id },
          target: { type: 'USER', id: input.id },
          metadata: { reason: 'delete_confirm_mismatch' },
          req: { ip: ctx.ip },
        });
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'confirmEmail mismatch' });
      }
      await assertNotLastGlobalAdmin(input.id, 'remove');
      await db.user.delete({ where: { id: input.id } });
      await recordAudit({
        action: 'admin.user.deleted',
        actor: { id: ctx.user.id },
        target: { type: 'USER', id: input.id },
        metadata: { email: target.email, role: target.role },
        req: { ip: ctx.ip },
      });
      return { ok: true };
    }),

  changeRole: globalAdminProcedure
    .input(z.object({ id: cuid, newRole: z.enum(['GLOBAL_ADMIN', 'USER']) }))
    .mutation(async ({ ctx, input }) => {
      if (input.id === ctx.user.id) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'cannot change own role' });
      }
      const target = await db.user.findUnique({
        where: { id: input.id },
        select: { id: true, role: true },
      });
      if (!target) throw new TRPCError({ code: 'NOT_FOUND' });
      if (target.role === input.newRole) return { ok: true };
      if (target.role === 'GLOBAL_ADMIN') {
        await assertNotLastGlobalAdmin(input.id, 'demote');
      }
      await db.user.update({ where: { id: input.id }, data: { role: input.newRole } });
      await recordAudit({
        action: 'admin.user.role_changed',
        actor: { id: ctx.user.id },
        target: { type: 'USER', id: input.id },
        metadata: { from: target.role, to: input.newRole },
        req: { ip: ctx.ip },
      });
      return { ok: true };
    }),

  resetTwoFactor: globalAdminProcedure
    .input(z.object({ id: cuid, reason: reasonInput }))
    .mutation(async ({ ctx, input }) => {
      if (input.id === ctx.user.id) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'use account.security.* to manage your own 2FA',
        });
      }
      const target = await db.user.findUnique({
        where: { id: input.id },
        select: { id: true, role: true, twoFactorEnabled: true },
      });
      if (!target) throw new TRPCError({ code: 'NOT_FOUND' });
      if (target.role === 'GLOBAL_ADMIN') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'global admin 2FA reset must use DBA runbook',
        });
      }
      await db.$transaction([
        db.twoFactorSecret.deleteMany({ where: { userId: input.id } }),
        db.user.update({ where: { id: input.id }, data: { twoFactorEnabled: false } }),
      ]);
      const sessionsRevoked = await revokeAllSessionsForUser(input.id);
      await recordAudit({
        action: 'admin.user.two_factor_reset',
        actor: { id: ctx.user.id },
        target: { type: 'USER', id: input.id },
        metadata: { reason: input.reason, sessionsRevoked },
        req: { ip: ctx.ip },
      });
      return { ok: true };
    }),

  invitations: t.router({
    list: globalAdminProcedure.input(z.object({ userId: cuid })).query(async ({ input }) => {
      const items = await db.invitation.findMany({
        where: { invitedById: input.userId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          libraryId: true,
          proposedRole: true,
          expiresAt: true,
          consumedAt: true,
          createdAt: true,
        },
      });
      return { items };
    }),
    revoke: globalAdminProcedure
      .input(z.object({ invitationId: cuid }))
      .mutation(async ({ ctx, input }) => {
        const inv = await db.invitation.findUnique({
          where: { id: input.invitationId },
          select: { id: true, email: true },
        });
        if (!inv) throw new TRPCError({ code: 'NOT_FOUND' });
        await revokeInvitation(input.invitationId);
        await recordAudit({
          action: 'auth.invitation.revoked',
          actor: { id: ctx.user.id },
          target: { type: 'INVITATION', id: input.invitationId },
          metadata: { invitedEmail: inv.email },
          req: { ip: ctx.ip },
        });
        return { ok: true };
      }),
  }),

  sessions: t.router({
    list: globalAdminProcedure.input(z.object({ userId: cuid })).query(async ({ input }) => {
      const items = await db.session.findMany({
        where: { userId: input.userId },
        orderBy: { lastActivityAt: 'desc' },
        select: {
          id: true,
          createdAt: true,
          lastActivityAt: true,
          userAgentLabel: true,
        },
      });
      return {
        items: items.map((s) => ({
          id: s.id,
          createdAt: s.createdAt,
          lastSeenAt: s.lastActivityAt,
          userAgentLabel: s.userAgentLabel,
        })),
      };
    }),
  }),

  audit: t.router({
    list: globalAdminProcedure
      .input(z.object({ userId: cuid, limit: z.number().int().min(1).max(50).default(10) }))
      .query(async ({ input }) => {
        const items = await db.auditLog.findMany({
          where: {
            OR: [{ actorId: input.userId }, { targetType: 'USER', targetId: input.userId }],
          },
          orderBy: { createdAt: 'desc' },
          take: input.limit,
          select: { id: true, action: true, createdAt: true, metadata: true },
        });
        return { items };
      }),
  }),
});
