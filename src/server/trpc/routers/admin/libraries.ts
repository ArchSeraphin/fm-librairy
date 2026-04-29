import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { Prisma } from '@prisma/client';
import { t } from '../../trpc';
import { globalAdminProcedure } from '../../procedures';
import { db } from '@/lib/db';
import { recordAudit } from '@/lib/audit-log';
import {
  assertLibraryNotArchived,
  assertNotLastLibraryAdmin,
  slugifyUnique,
} from '@/lib/library-admin';

const cuid = z.string().min(20).max(40);
const reasonInput = z.string().trim().min(3).max(500);
const nameInput = z.string().trim().min(3).max(120);
const descriptionInput = z.string().trim().max(1000).nullish();

export const adminLibrariesRouter = t.router({
  list: globalAdminProcedure
    .input(
      z.object({
        q: z.string().trim().max(120).optional(),
        includeArchived: z.boolean().default(false),
        cursor: cuid.optional(),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(async ({ input }) => {
      const where: Prisma.LibraryWhereInput = {};
      if (!input.includeArchived) where.archivedAt = null;
      if (input.q) {
        where.OR = [
          { name: { contains: input.q, mode: 'insensitive' } },
          { slug: { contains: input.q, mode: 'insensitive' } },
        ];
      }
      const items = await db.library.findMany({
        where,
        take: input.limit + 1,
        cursor: input.cursor ? { id: input.cursor } : undefined,
        skip: input.cursor ? 1 : 0,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          archivedAt: true,
          createdAt: true,
          _count: { select: { members: true, books: true } },
        },
      });
      const nextCursor = items.length > input.limit ? items.pop()!.id : null;
      return {
        items: items.map((l) => ({
          ...l,
          counts: { members: l._count.members, books: l._count.books },
        })),
        nextCursor,
      };
    }),

  get: globalAdminProcedure.input(z.object({ id: cuid })).query(async ({ input }) => {
    const lib = await db.library.findUnique({
      where: { id: input.id },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        archivedAt: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { members: true, books: true } },
      },
    });
    if (!lib) throw new TRPCError({ code: 'NOT_FOUND' });
    return { ...lib, counts: { members: lib._count.members, books: lib._count.books } };
  }),

  create: globalAdminProcedure
    .input(z.object({ name: nameInput, description: descriptionInput }))
    .mutation(async ({ ctx, input }) => {
      const slug = await slugifyUnique(input.name);
      let lib: {
        id: string;
        name: string;
        slug: string;
        description: string | null;
        archivedAt: Date | null;
        createdAt: Date;
      };
      try {
        lib = await db.library.create({
          data: { name: input.name, slug, description: input.description ?? null },
          select: {
            id: true,
            name: true,
            slug: true,
            description: true,
            archivedAt: true,
            createdAt: true,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          // Slug race: retry once with a fresh slugifyUnique
          const retrySlug = await slugifyUnique(input.name);
          try {
            lib = await db.library.create({
              data: { name: input.name, slug: retrySlug, description: input.description ?? null },
              select: {
                id: true,
                name: true,
                slug: true,
                description: true,
                archivedAt: true,
                createdAt: true,
              },
            });
          } catch (retryErr) {
            if (
              retryErr instanceof Prisma.PrismaClientKnownRequestError &&
              retryErr.code === 'P2002'
            ) {
              throw new TRPCError({ code: 'CONFLICT', message: 'slug_collision' });
            }
            throw retryErr;
          }
        } else {
          throw err;
        }
      }
      await recordAudit({
        action: 'admin.library.created',
        actor: { id: ctx.user.id },
        target: { type: 'LIBRARY', id: lib.id },
        metadata: { name: lib.name, slug: lib.slug },
        req: { ip: ctx.ip },
      });
      return lib;
    }),

  rename: globalAdminProcedure
    .input(z.object({ id: cuid, name: nameInput, description: descriptionInput }))
    .mutation(async ({ ctx, input }) => {
      const data: Prisma.LibraryUpdateInput = { name: input.name };
      if (input.description !== undefined) {
        data.description = input.description; // null clears, string sets
      }

      const result = await db.$transaction(async (tx) => {
        const before = await tx.library.findUnique({
          where: { id: input.id },
          select: { name: true, description: true, archivedAt: true },
        });
        if (!before) throw new TRPCError({ code: 'NOT_FOUND' });
        if (before.archivedAt) {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'library_archived' });
        }
        await tx.library.update({ where: { id: input.id }, data });
        return { before };
      });

      const afterDescription =
        input.description !== undefined ? (input.description ?? null) : result.before.description;

      await recordAudit({
        action: 'admin.library.renamed',
        actor: { id: ctx.user.id },
        target: { type: 'LIBRARY', id: input.id },
        metadata: {
          before: { name: result.before.name, description: result.before.description },
          after: { name: input.name, description: afterDescription },
        },
        req: { ip: ctx.ip },
      });
      return { ok: true };
    }),

  archive: globalAdminProcedure
    .input(z.object({ id: cuid, reason: reasonInput }))
    .mutation(async ({ ctx, input }) => {
      const lib = await db.library.findUnique({
        where: { id: input.id },
        select: { archivedAt: true },
      });
      if (!lib) throw new TRPCError({ code: 'NOT_FOUND' });
      if (lib.archivedAt) return { ok: true };
      await db.library.update({ where: { id: input.id }, data: { archivedAt: new Date() } });
      await recordAudit({
        action: 'admin.library.archived',
        actor: { id: ctx.user.id },
        target: { type: 'LIBRARY', id: input.id },
        metadata: { reason: input.reason },
        req: { ip: ctx.ip },
      });
      return { ok: true };
    }),

  unarchive: globalAdminProcedure.input(z.object({ id: cuid })).mutation(async ({ ctx, input }) => {
    const lib = await db.library.findUnique({
      where: { id: input.id },
      select: { archivedAt: true },
    });
    if (!lib) throw new TRPCError({ code: 'NOT_FOUND' });
    if (!lib.archivedAt) return { ok: true };
    await db.library.update({ where: { id: input.id }, data: { archivedAt: null } });
    await recordAudit({
      action: 'admin.library.unarchived',
      actor: { id: ctx.user.id },
      target: { type: 'LIBRARY', id: input.id },
      req: { ip: ctx.ip },
    });
    return { ok: true };
  }),

  members: t.router({
    list: globalAdminProcedure
      .input(
        z.object({
          libraryId: cuid,
          q: z.string().trim().max(120).optional(),
          cursor: z.string().optional(),
          limit: z.number().int().min(1).max(50).default(20),
        }),
      )
      .query(async ({ input }) => {
        const items = await db.libraryMember.findMany({
          where: {
            libraryId: input.libraryId,
            ...(input.q
              ? {
                  user: {
                    OR: [
                      { email: { contains: input.q, mode: 'insensitive' } },
                      { displayName: { contains: input.q, mode: 'insensitive' } },
                    ],
                  },
                }
              : {}),
          },
          take: input.limit + 1,
          orderBy: { joinedAt: 'asc' },
          select: {
            libraryId: true,
            userId: true,
            role: true,
            canRead: true,
            canUpload: true,
            canDownload: true,
            joinedAt: true,
            user: { select: { email: true, displayName: true, status: true } },
          },
        });
        const nextCursor = items.length > input.limit ? items.pop()!.userId : null;
        return { items, nextCursor };
      }),

    add: globalAdminProcedure
      .input(
        z.object({
          libraryId: cuid,
          userId: cuid,
          role: z.enum(['LIBRARY_ADMIN', 'MEMBER']),
          flags: z.object({
            canRead: z.boolean(),
            canUpload: z.boolean(),
            canDownload: z.boolean(),
          }),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await assertLibraryNotArchived(input.libraryId);
        const exists = await db.libraryMember.findUnique({
          where: { userId_libraryId: { userId: input.userId, libraryId: input.libraryId } },
          select: { libraryId: true },
        });
        if (exists) throw new TRPCError({ code: 'CONFLICT', message: 'already a member' });
        await db.libraryMember.create({
          data: {
            libraryId: input.libraryId,
            userId: input.userId,
            role: input.role,
            canRead: input.flags.canRead,
            canUpload: input.flags.canUpload,
            canDownload: input.flags.canDownload,
          },
        });
        await recordAudit({
          action: 'admin.member.added',
          actor: { id: ctx.user.id },
          target: { type: 'MEMBER', id: `${input.libraryId}:${input.userId}` },
          metadata: {
            libraryId: input.libraryId,
            userId: input.userId,
            role: input.role,
            flags: input.flags,
          },
          req: { ip: ctx.ip },
        });
        return { ok: true };
      }),

    remove: globalAdminProcedure
      .input(z.object({ libraryId: cuid, userId: cuid }))
      .mutation(async ({ ctx, input }) => {
        await assertLibraryNotArchived(input.libraryId);
        await assertNotLastLibraryAdmin({ libraryId: input.libraryId, userId: input.userId });
        await db.libraryMember.delete({
          where: { userId_libraryId: { userId: input.userId, libraryId: input.libraryId } },
        });
        await recordAudit({
          action: 'admin.member.removed',
          actor: { id: ctx.user.id },
          target: { type: 'MEMBER', id: `${input.libraryId}:${input.userId}` },
          metadata: { libraryId: input.libraryId, userId: input.userId },
          req: { ip: ctx.ip },
        });
        return { ok: true };
      }),

    changeRole: globalAdminProcedure
      .input(
        z.object({
          libraryId: cuid,
          userId: cuid,
          newRole: z.enum(['LIBRARY_ADMIN', 'MEMBER']),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await assertLibraryNotArchived(input.libraryId);
        const current = await db.libraryMember.findUnique({
          where: { userId_libraryId: { userId: input.userId, libraryId: input.libraryId } },
          select: { role: true },
        });
        if (!current) throw new TRPCError({ code: 'NOT_FOUND' });
        if (current.role === input.newRole) return { ok: true };
        if (current.role === 'LIBRARY_ADMIN') {
          await assertNotLastLibraryAdmin({ libraryId: input.libraryId, userId: input.userId });
        }
        await db.libraryMember.update({
          where: { userId_libraryId: { userId: input.userId, libraryId: input.libraryId } },
          data: { role: input.newRole },
        });
        await recordAudit({
          action: 'admin.member.role_changed',
          actor: { id: ctx.user.id },
          target: { type: 'MEMBER', id: `${input.libraryId}:${input.userId}` },
          metadata: {
            libraryId: input.libraryId,
            userId: input.userId,
            from: current.role,
            to: input.newRole,
          },
          req: { ip: ctx.ip },
        });
        return { ok: true };
      }),

    updateFlags: globalAdminProcedure
      .input(
        z.object({
          libraryId: cuid,
          userId: cuid,
          flags: z.object({
            canRead: z.boolean(),
            canUpload: z.boolean(),
            canDownload: z.boolean(),
          }),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await assertLibraryNotArchived(input.libraryId);
        const anyTrue = input.flags.canRead || input.flags.canUpload || input.flags.canDownload;
        if (!anyTrue) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'at least one flag must be true' });
        }
        const before = await db.libraryMember.findUnique({
          where: { userId_libraryId: { userId: input.userId, libraryId: input.libraryId } },
          select: { canRead: true, canUpload: true, canDownload: true },
        });
        if (!before) throw new TRPCError({ code: 'NOT_FOUND' });
        await db.libraryMember.update({
          where: { userId_libraryId: { userId: input.userId, libraryId: input.libraryId } },
          data: input.flags,
        });
        await recordAudit({
          action: 'admin.member.flags_changed',
          actor: { id: ctx.user.id },
          target: { type: 'MEMBER', id: `${input.libraryId}:${input.userId}` },
          metadata: {
            libraryId: input.libraryId,
            userId: input.userId,
            before,
            after: input.flags,
          },
          req: { ip: ctx.ip },
        });
        return { ok: true };
      }),
  }),
});
