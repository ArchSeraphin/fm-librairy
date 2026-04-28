import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    user: { findUnique: vi.fn() },
    invitation: { create: vi.fn() },
  },
}));
vi.mock('@/lib/env', () => ({
  getEnv: () => ({ APP_URL: 'https://app.test', IP_HASH_SALT: 'a'.repeat(16) }),
}));
vi.mock('@/lib/audit-log', () => ({ recordAudit: vi.fn() }));

import { db } from '@/lib/db';
import { createInvitation } from '@/lib/invitations';

// Typed shorthand helpers for the mocked db methods.
const mockUserFindUnique = vi.mocked(db.user.findUnique);
const mockInvitationCreate = vi.mocked(db.invitation.create);

describe('createInvitation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a signup-mode invitation when email does not exist', async () => {
    mockUserFindUnique.mockResolvedValue(null);
    mockInvitationCreate.mockResolvedValue({
      id: 'inv1',
      email: 'new@x.test',
      tokenHash: 'h',
      expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
    } as never);

    const out = await createInvitation({
      invitedById: 'u1',
      email: 'New@X.test',
      libraryId: 'lib1',
      proposedRole: 'MEMBER',
    });

    expect(out.mode).toBe('signup');
    expect(typeof out.rawToken).toBe('string');
    expect(out.rawToken.length).toBeGreaterThan(20);
    expect(out.invitationId).toBe('inv1');
    expect(mockInvitationCreate).toHaveBeenCalledOnce();
  });

  it('creates a join-mode invitation when email matches existing user', async () => {
    mockUserFindUnique.mockResolvedValue({ id: 'u9', email: 'old@x.test' } as never);
    mockInvitationCreate.mockResolvedValue({
      id: 'inv2',
      email: 'old@x.test',
      tokenHash: 'h',
      expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
    } as never);

    const out = await createInvitation({
      invitedById: 'u1',
      email: 'old@x.test',
      libraryId: 'lib1',
      proposedRole: 'MEMBER',
    });

    expect(out.mode).toBe('join');
  });

  it('lowercases email before storage', async () => {
    mockUserFindUnique.mockResolvedValue(null);
    mockInvitationCreate.mockResolvedValue({ id: 'inv', email: 'mixed@x.test' } as never);

    await createInvitation({ invitedById: 'u1', email: 'Mixed@X.TEST' });

    expect(mockInvitationCreate.mock.calls[0]?.[0]?.data.email).toBe('mixed@x.test');
  });
});
