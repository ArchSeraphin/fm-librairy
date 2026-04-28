import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { t } from '../trpc';
import { authedProcedure, publicProcedure } from '../procedures';
import { db } from '@/lib/db';
import {
  createInvitation,
  findInvitationByRawToken,
  consumeInvitationNewUser,
  consumeInvitationJoinLibrary,
  revokeInvitation,
} from '@/lib/invitations';
import { recordAudit } from '@/lib/audit-log';
import { invitationLimiter } from '@/lib/rate-limit';
import { hashEmail } from '@/lib/crypto';
import { getEnv } from '@/lib/env';
import { enqueueMail } from '@/lib/mail-queue';

const createInput = z.object({
  email: z.string().email().max(254),
  libraryId: z.string().cuid().optional(),
  proposedRole: z.enum(['MEMBER', 'LIBRARY_ADMIN']).optional(),
});

const consumeSignupInput = z.object({
  rawToken: z.string().min(20).max(100),
  displayName: z.string().min(1).max(80),
  password: z.string().min(12).max(200),
});

const consumeJoinInput = z.object({
  rawToken: z.string().min(20).max(100),
});

const validateInput = z.object({ rawToken: z.string().min(20).max(100) });

const revokeInput = z.object({ invitationId: z.string().cuid() });

export const invitationRouter = t.router({
  create: authedProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    if (input.libraryId) {
      const isGlobal = ctx.user.role === 'GLOBAL_ADMIN';
      if (!isGlobal) {
        const membership = await db.libraryMember.findUnique({
          where: {
            userId_libraryId: { userId: ctx.user.id, libraryId: input.libraryId },
          },
        });
        if (!membership || membership.role !== 'LIBRARY_ADMIN') {
          await recordAudit({
            action: 'permission.denied',
            actor: { id: ctx.user.id },
            metadata: { perm: 'invite_to_library', libraryId: input.libraryId },
          });
          throw new TRPCError({ code: 'FORBIDDEN' });
        }
      }
    } else if (ctx.user.role !== 'GLOBAL_ADMIN') {
      await recordAudit({
        action: 'permission.denied',
        actor: { id: ctx.user.id },
        metadata: { perm: 'invite_global' },
      });
      throw new TRPCError({ code: 'FORBIDDEN' });
    }

    try {
      await invitationLimiter.consume(ctx.user.id);
    } catch {
      throw new TRPCError({ code: 'TOO_MANY_REQUESTS' });
    }

    const inviter = await db.user.findUnique({ where: { id: ctx.user.id } });
    const library = input.libraryId
      ? await db.library.findUnique({ where: { id: input.libraryId } })
      : null;

    const result = await createInvitation({
      invitedById: ctx.user.id,
      email: input.email,
      libraryId: input.libraryId,
      proposedRole: input.proposedRole,
    });

    await recordAudit({
      action: 'auth.invitation.created',
      actor: { id: ctx.user.id },
      target: { type: 'INVITATION', id: result.invitationId },
      metadata: {
        emailHash: hashEmail(result.email),
        libraryId: input.libraryId,
        role: input.proposedRole,
        mode: result.mode,
      },
    });

    const baseUrl = getEnv().APP_URL.replace(/\/$/, '');
    const url = `${baseUrl}/invitations/${result.rawToken}`;
    const expiresAtIso = result.expiresAt.toISOString();

    if (result.mode === 'signup') {
      await enqueueMail('send-invitation-new-user', {
        to: result.email,
        inviterName: inviter?.displayName ?? 'Un administrateur',
        libraryName: library?.name ?? null,
        signupUrl: url,
        expiresAtIso,
      });
    } else {
      const target = await db.user.findUnique({ where: { email: result.email } });
      await enqueueMail('send-invitation-join-library', {
        to: result.email,
        inviterName: inviter?.displayName ?? 'Un administrateur',
        libraryName: library?.name ?? '',
        userDisplayName: target?.displayName ?? '',
        joinUrl: url,
        expiresAtIso,
      });
    }

    return { invitationId: result.invitationId, mode: result.mode };
  }),

  validate: publicProcedure.input(validateInput).query(async ({ input }) => {
    const inv = await findInvitationByRawToken(input.rawToken);
    if (!inv) return { valid: false } as const;
    const target = await db.user.findUnique({ where: { email: inv.email } });
    const lib = inv.libraryId
      ? await db.library.findUnique({ where: { id: inv.libraryId } })
      : null;
    return {
      valid: true as const,
      mode: target ? ('join' as const) : ('signup' as const),
      email: inv.email,
      libraryName: lib?.name ?? null,
    };
  }),

  consumeSignup: publicProcedure.input(consumeSignupInput).mutation(async ({ input }) => {
    try {
      const out = await consumeInvitationNewUser(input);
      await recordAudit({
        action: 'auth.invitation.consumed',
        actor: { id: out.userId },
        metadata: { mode: 'signup', libraryId: out.libraryId },
      });
      return { userId: out.userId };
    } catch (err) {
      if (err instanceof Error && err.message === 'INVALID_TOKEN') {
        await recordAudit({
          action: 'auth.invitation.invalid_attempt',
          metadata: { reason: 'not_found_or_consumed_or_expired' },
        });
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'INVALID_TOKEN' });
      }
      throw err;
    }
  }),

  consumeJoin: authedProcedure.input(consumeJoinInput).mutation(async ({ ctx, input }) => {
    try {
      const out = await consumeInvitationJoinLibrary(input.rawToken, ctx.user.id);
      await recordAudit({
        action: 'auth.invitation.consumed',
        actor: { id: ctx.user.id },
        metadata: { mode: 'join', libraryId: out.libraryId },
      });
      return { libraryId: out.libraryId };
    } catch (err) {
      if (err instanceof Error) {
        if (err.message === 'INVALID_TOKEN') {
          await recordAudit({
            action: 'auth.invitation.invalid_attempt',
            actor: { id: ctx.user.id },
            metadata: { reason: 'not_found_or_consumed_or_expired' },
          });
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'INVALID_TOKEN' });
        }
        if (err.message === 'EMAIL_MISMATCH') {
          await recordAudit({
            action: 'auth.invitation.invalid_attempt',
            actor: { id: ctx.user.id },
            metadata: { reason: 'email_mismatch' },
          });
          throw new TRPCError({ code: 'FORBIDDEN', message: 'EMAIL_MISMATCH' });
        }
        if (err.message === 'ALREADY_MEMBER') {
          throw new TRPCError({ code: 'CONFLICT', message: 'ALREADY_MEMBER' });
        }
      }
      throw err;
    }
  }),

  revoke: authedProcedure.input(revokeInput).mutation(async ({ ctx, input }) => {
    const inv = await db.invitation.findUnique({ where: { id: input.invitationId } });
    if (!inv) throw new TRPCError({ code: 'NOT_FOUND' });
    if (inv.invitedById !== ctx.user.id && ctx.user.role !== 'GLOBAL_ADMIN') {
      await recordAudit({
        action: 'permission.denied',
        actor: { id: ctx.user.id },
        metadata: { perm: 'revoke_invitation', invitationId: inv.id },
      });
      throw new TRPCError({ code: 'FORBIDDEN' });
    }
    await revokeInvitation(input.invitationId);
    await recordAudit({
      action: 'auth.invitation.revoked',
      actor: { id: ctx.user.id },
      target: { type: 'INVITATION', id: input.invitationId },
      metadata: { revokedBy: ctx.user.id },
    });
    return { ok: true as const };
  }),
});
