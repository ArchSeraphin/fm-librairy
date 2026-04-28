import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { t } from '../../trpc';
import { globalAdminProcedure } from '../../procedures';
import { db } from '@/lib/db';

const cuid = z.string().min(20).max(40);

const listInput = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'all']).default('all'),
  role: z.enum(['GLOBAL_ADMIN', 'USER', 'all']).default('all'),
  cursor: cuid.optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

export const adminUsersRouter = t.router({
  list: globalAdminProcedure.input(listInput).query(async ({ input }) => {
    const where: Parameters<typeof db.user.findMany>[0] extends infer X
      ? X extends { where?: infer W }
        ? W
        : never
      : never = {};
    if (input.status !== 'all') (where as any).status = input.status;
    if (input.role !== 'all') (where as any).role = input.role;
    if (input.q) {
      (where as any).OR = [
        { email: { contains: input.q, mode: 'insensitive' } },
        { displayName: { contains: input.q, mode: 'insensitive' } },
      ];
    }
    const items = await db.user.findMany({
      where: where as any,
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
    const nextCursor = items.length > input.limit ? items.pop()!.id : null;
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
  }),
});
