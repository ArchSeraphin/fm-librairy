import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendPasswordResetConfirmation } from '../../worker/jobs/send-password-reset-confirmation';
import { getTestPrisma, truncateAll } from './setup/prisma';

const prisma = getTestPrisma();

// sendEmail is the actual export name in worker/lib/email.ts
const sendEmailMock = vi.hoisted(() => vi.fn(async () => ({ id: 'mock-id' })));
vi.mock('../../worker/lib/email', () => ({
  sendEmail: sendEmailMock,
  renderEmail: vi.fn(async () => ({
    html: '<p>Votre mot de passe a été changé</p>',
    text: 'Votre mot de passe a été changé',
  })),
  getTransport: vi.fn(),
  hashRecipient: vi.fn(() => 'hash'),
}));

describe('worker handler: send-password-reset-confirmation', () => {
  beforeEach(async () => {
    await truncateAll();
    sendEmailMock.mockClear();
  });
  afterAll(() => vi.restoreAllMocks());

  it('renders and sends the confirmation email', async () => {
    const user = await prisma.user.create({
      data: { email: 'conf@e2e.test', passwordHash: 'x', displayName: 'Conf User' },
    });
    await sendPasswordResetConfirmation({ userId: user.id });
    expect(sendEmailMock).toHaveBeenCalledOnce();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const emailArg = (sendEmailMock.mock.calls as any)[0][0] as {
      to: string;
      subject: string;
      html: string;
      text: string;
    };
    expect(emailArg.to).toBe('conf@e2e.test');
    expect(emailArg.subject).toMatch(/mot de passe/i);
    expect(emailArg.html).toMatch(/changé/i);
  });

  it('throws when user no longer exists', async () => {
    await expect(sendPasswordResetConfirmation({ userId: 'nope' })).rejects.toThrow(/not found/i);
  });
});
