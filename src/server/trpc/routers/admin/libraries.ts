import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { Prisma } from '@prisma/client';
import { t } from '../../trpc';
import { globalAdminProcedure } from '../../procedures';
import { db } from '@/lib/db';
import { recordAudit } from '@/lib/audit-log';
import { slugifyUnique } from '@/lib/library-admin';

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
});
