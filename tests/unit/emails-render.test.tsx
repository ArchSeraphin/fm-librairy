import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/env', () => ({
  getEnv: () => ({ EMAIL_LOG_SALT: 'a'.repeat(32) }),
}));

import { renderEmail } from '@/lib/email';
import InvitationNewUserEmail from '@/emails/invitation-new-user';
import InvitationJoinLibraryEmail from '@/emails/invitation-join-library';
import PasswordResetEmail from '@/emails/password-reset';
import PasswordResetConfirmationEmail from '@/emails/password-reset-confirmation';

describe('email templates render', () => {
  const future = new Date(Date.now() + 72 * 3600 * 1000);

  it('invitation-new-user', async () => {
    const out = await renderEmail(InvitationNewUserEmail, {
      inviterName: 'Alice',
      libraryName: 'Médiathèque test',
      signupUrl: 'https://app.test/invitations/abc123',
      expiresAt: future,
    });
    expect(out.html).toContain('Alice');
    expect(out.html).toContain('Médiathèque test');
    expect(out.html).toContain('https://app.test/invitations/abc123');
    expect(out.text).toContain('Médiathèque test');
  });

  it('invitation-new-user without libraryName', async () => {
    const out = await renderEmail(InvitationNewUserEmail, {
      inviterName: 'Alice',
      libraryName: null,
      signupUrl: 'https://app.test/x',
      expiresAt: future,
    });
    // React Email injects HTML comments between adjacent text nodes,
    // so we assert each token plus the absence of the libraryName branch.
    expect(out.html).toContain('rejoindre');
    expect(out.html).toContain('BiblioShare');
    expect(out.html).not.toContain('la bibliothèque');
  });

  it('invitation-join-library', async () => {
    const out = await renderEmail(InvitationJoinLibraryEmail, {
      inviterName: 'Alice',
      libraryName: 'Médiathèque',
      userDisplayName: 'Bob',
      joinUrl: 'https://app.test/invitations/xyz',
      expiresAt: future,
    });
    expect(out.html).toContain('Bob');
    expect(out.html).toContain('Rejoindre');
  });

  it('password-reset', async () => {
    const out = await renderEmail(PasswordResetEmail, {
      resetUrl: 'https://app.test/password/reset/tok',
      expiresAt: new Date(Date.now() + 3600 * 1000),
    });
    expect(out.html).toContain('https://app.test/password/reset/tok');
    expect(out.html).toContain('1 heure');
  });

  it('password-reset-confirmation', async () => {
    const out = await renderEmail(PasswordResetConfirmationEmail, {
      userDisplayName: 'Bob',
      occurredAt: new Date('2026-04-27T10:30:00Z'),
    });
    expect(out.html).toContain('Bob');
    expect(out.html).toContain('Mot de passe modifié');
  });
});
