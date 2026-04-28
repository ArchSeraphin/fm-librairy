import { describe, it, expect, vi, beforeEach } from 'vitest';

const addMock = vi.fn().mockResolvedValue(undefined);

vi.mock('bullmq', () => ({
  Queue: vi.fn(function MockQueue(this: { add: typeof addMock }) {
    this.add = addMock;
  }),
}));
vi.mock('@/lib/redis', () => ({ getRedis: () => ({}) }));

import { enqueueMail, __resetMailQueueForTest } from '@/lib/mail-queue';

describe('enqueueMail', () => {
  beforeEach(() => {
    addMock.mockClear();
    __resetMailQueueForTest();
  });

  it('forwards name + data to BullMQ', async () => {
    await enqueueMail('send-password-reset', {
      to: 'a@b.test',
      resetUrl: 'https://x',
      expiresAtIso: '2026-01-01T00:00:00Z',
    });
    expect(addMock).toHaveBeenCalledWith(
      'send-password-reset',
      expect.objectContaining({ to: 'a@b.test' }),
    );
  });
});
