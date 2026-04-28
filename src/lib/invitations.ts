import { Prisma, type Invitation, type LibraryRole } from '@prisma/client';
import { db } from './db';
import { generateRawToken, hashToken, verifyToken } from './tokens';
import { hashPassword } from './password';

const INVITATION_TTL_MS = 72 * 3600 * 1000;

export interface CreateInvitationInput {
  invitedById: string;
  email: string;
  libraryId?: string;
  proposedRole?: LibraryRole;
}

export interface CreateInvitationResult {
  invitationId: string;
  rawToken: string;
  mode: 'signup' | 'join';
  email: string;
  expiresAt: Date;
}

export async function createInvitation(
  input: CreateInvitationInput,
): Promise<CreateInvitationResult> {
  const email = input.email.toLowerCase();
  const existing = await db.user.findUnique({ where: { email } });
  const mode: 'signup' | 'join' = existing ? 'join' : 'signup';
  const rawToken = generateRawToken();
  const tokenHash = await hashToken(rawToken);
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

  const inv = await db.invitation.create({
    data: {
      email,
      invitedById: input.invitedById,
      libraryId: input.libraryId,
      proposedRole: input.proposedRole,
      tokenHash,
      expiresAt,
    },
  });

  return { invitationId: inv.id, rawToken, mode, email, expiresAt };
}

export async function findInvitationByRawToken(rawToken: string): Promise<Invitation | null> {
  const candidates = await db.invitation.findMany({
    where: { consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  for (const inv of candidates) {
    if (await verifyToken(rawToken, inv.tokenHash)) return inv;
  }
  return null;
}

export interface ConsumeSignupInput {
  rawToken: string;
  displayName: string;
  password: string;
}

export async function consumeInvitationNewUser(
  input: ConsumeSignupInput,
): Promise<{ userId: string; libraryId?: string }> {
  const inv = await findInvitationByRawToken(input.rawToken);
  if (!inv) throw new Error('INVALID_TOKEN');
  const passwordHash = await hashPassword(input.password);
  return db.$transaction(
    async (tx) => {
      const updated = await tx.invitation.updateMany({
        where: { id: inv.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      if (updated.count === 0) throw new Error('INVALID_TOKEN');
      const user = await tx.user.create({
        data: {
          email: inv.email,
          displayName: input.displayName,
          passwordHash,
          role: 'USER',
        },
      });
      await tx.invitation.update({
        where: { id: inv.id },
        data: { consumedById: user.id },
      });
      if (inv.libraryId) {
        await tx.libraryMember.create({
          data: {
            userId: user.id,
            libraryId: inv.libraryId,
            role: inv.proposedRole ?? 'MEMBER',
          },
        });
      }
      return { userId: user.id, libraryId: inv.libraryId ?? undefined };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function consumeInvitationJoinLibrary(
  rawToken: string,
  userId: string,
): Promise<{ libraryId: string }> {
  const inv = await findInvitationByRawToken(rawToken);
  if (!inv) throw new Error('INVALID_TOKEN');
  if (!inv.libraryId) throw new Error('INVALID_TOKEN');
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('INVALID_TOKEN');
  if (user.email.toLowerCase() !== inv.email.toLowerCase()) throw new Error('EMAIL_MISMATCH');
  return db.$transaction(
    async (tx) => {
      const updated = await tx.invitation.updateMany({
        where: { id: inv.id, consumedAt: null },
        data: { consumedAt: new Date(), consumedById: userId },
      });
      if (updated.count === 0) throw new Error('INVALID_TOKEN');
      try {
        await tx.libraryMember.create({
          data: {
            userId,
            libraryId: inv.libraryId!,
            role: inv.proposedRole ?? 'MEMBER',
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new Error('ALREADY_MEMBER');
        }
        throw err;
      }
      return { libraryId: inv.libraryId! };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function revokeInvitation(invitationId: string): Promise<void> {
  await db.invitation.update({
    where: { id: invitationId },
    data: { consumedAt: new Date() },
  });
}
