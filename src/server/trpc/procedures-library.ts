import { TRPCError } from '@trpc/server';
import { assertMembership } from '@/lib/library-membership';
import { authedProcedure } from './procedures';

interface SlugInput {
  slug: string;
}

/**
 * Procedure that requires the actor to be a member (any role) of the library
 * identified by `input.slug`, OR a GLOBAL_ADMIN. Injects ctx.library + ctx.membership.
 */
export const libraryMemberProcedure = authedProcedure.use(async ({ ctx, getRawInput, next }) => {
  const rawInput = await getRawInput();
  const slug = (rawInput as SlugInput | undefined)?.slug;
  if (typeof slug !== 'string') {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'slug required in input' });
  }
  const { library, membership } = await assertMembership(
    { id: ctx.user.id, role: ctx.user.role },
    slug,
  );
  return next({ ctx: { ...ctx, library, membership } });
});

/**
 * Same but requires LIBRARY_ADMIN role (or GLOBAL_ADMIN).
 */
export const libraryAdminProcedure = authedProcedure.use(async ({ ctx, getRawInput, next }) => {
  const rawInput = await getRawInput();
  const slug = (rawInput as SlugInput | undefined)?.slug;
  if (typeof slug !== 'string') {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'slug required in input' });
  }
  const { library, membership } = await assertMembership(
    { id: ctx.user.id, role: ctx.user.role },
    slug,
    'LIBRARY_ADMIN',
  );
  return next({ ctx: { ...ctx, library, membership } });
});
