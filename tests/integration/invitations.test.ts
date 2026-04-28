import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import {
  createInvitation,
  findInvitationByRawToken,
  consumeInvitationNewUser,
  consumeInvitationJoinLibrary,
  revokeInvitation,
} from '@/lib/invitations';
import { hashPassword } from '@/lib/password';

async function seedAdmin() {
  return db.user.create({
    data: {
      email: `admin-${Date.now()}@x.test`,
      displayName: 'Admin',
      passwordHash: await hashPassword('x'),
      role: 'GLOBAL_ADMIN',
    },
  });
}

async function seedLibrary() {
  return db.library.create({
    data: { name: `Lib-${Date.now()}`, slug: `lib-${Date.now()}` },
  });
}

beforeEach(async () => {
  await db.libraryMember.deleteMany();
  await db.invitation.deleteMany();
  await db.user.deleteMany();
  await db.library.deleteMany();
});

describe('invitations integration', () => {
  it('creates + finds + consumes signup', async () => {
    const admin = await seedAdmin();
    const lib = await seedLibrary();
    const r = await createInvitation({
      invitedById: admin.id,
      email: 'newbie@x.test',
      libraryId: lib.id,
      proposedRole: 'MEMBER',
    });
    expect(r.mode).toBe('signup');
    const found = await findInvitationByRawToken(r.rawToken);
    expect(found?.id).toBe(r.invitationId);
    const out = await consumeInvitationNewUser({
      rawToken: r.rawToken,
      displayName: 'Newbie',
      password: 'CorrectHorseBatteryStaple',
    });
    expect(out.userId).toBeTruthy();
    const member = await db.libraryMember.findFirst({
      where: { userId: out.userId, libraryId: lib.id },
    });
    expect(member?.role).toBe('MEMBER');
  });

  it('detects existing user → join mode + consumes', async () => {
    const admin = await seedAdmin();
    const lib = await seedLibrary();
    const u = await db.user.create({
      data: {
        email: 'old@x.test',
        displayName: 'Old',
        passwordHash: await hashPassword('x'),
      },
    });
    const r = await createInvitation({
      invitedById: admin.id,
      email: 'old@x.test',
      libraryId: lib.id,
      proposedRole: 'MEMBER',
    });
    expect(r.mode).toBe('join');
    const out = await consumeInvitationJoinLibrary(r.rawToken, u.id);
    expect(out.libraryId).toBe(lib.id);
    const member = await db.libraryMember.findFirst({
      where: { userId: u.id, libraryId: lib.id },
    });
    expect(member).toBeTruthy();
  });

  it('replay attack: 2nd consume of same token fails', async () => {
    const admin = await seedAdmin();
    const r = await createInvitation({ invitedById: admin.id, email: 'r@x.test' });
    await consumeInvitationNewUser({
      rawToken: r.rawToken,
      displayName: 'A',
      password: 'CorrectHorseBatteryStaple',
    });
    await expect(
      consumeInvitationNewUser({
        rawToken: r.rawToken,
        displayName: 'A2',
        password: 'CorrectHorseBatteryStaple',
      }),
    ).rejects.toThrow('INVALID_TOKEN');
  });

  it('expired token: not found', async () => {
    const admin = await seedAdmin();
    const r = await createInvitation({ invitedById: admin.id, email: 'e@x.test' });
    await db.invitation.update({
      where: { id: r.invitationId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await findInvitationByRawToken(r.rawToken)).toBeNull();
  });

  it('email mismatch on join: throws', async () => {
    const admin = await seedAdmin();
    const lib = await seedLibrary();
    await db.user.create({
      data: {
        email: 'a@x.test',
        displayName: 'A',
        passwordHash: await hashPassword('x'),
      },
    });
    const userB = await db.user.create({
      data: {
        email: 'b@x.test',
        displayName: 'B',
        passwordHash: await hashPassword('x'),
      },
    });
    const r = await createInvitation({
      invitedById: admin.id,
      email: 'a@x.test',
      libraryId: lib.id,
    });
    await expect(consumeInvitationJoinLibrary(r.rawToken, userB.id)).rejects.toThrow(
      'EMAIL_MISMATCH',
    );
  });

  it('tampered token: not found', async () => {
    const admin = await seedAdmin();
    const r = await createInvitation({ invitedById: admin.id, email: 't@x.test' });
    const tampered = r.rawToken.slice(0, -1) + (r.rawToken.endsWith('a') ? 'b' : 'a');
    expect(await findInvitationByRawToken(tampered)).toBeNull();
  });

  it('revoke: marks consumedAt → no longer findable', async () => {
    const admin = await seedAdmin();
    const r = await createInvitation({ invitedById: admin.id, email: 'rev@x.test' });
    await revokeInvitation(r.invitationId);
    expect(await findInvitationByRawToken(r.rawToken)).toBeNull();
  });
});
