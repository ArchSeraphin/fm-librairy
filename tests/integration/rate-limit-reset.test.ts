import { describe, it, expect, beforeEach } from 'vitest';
import { resetIpOnlyLimiter } from '@/lib/rate-limit';
import { getRedis } from '@/lib/redis';

beforeEach(async () => {
  const redis = getRedis();
  const keys = await redis.keys('rl:reset_ip:*');
  if (keys.length) await redis.del(...keys);
});

describe('resetIpOnlyLimiter', () => {
  it('blocks after 30 attempts in the same window', async () => {
    const ipKey = 'iphash-test-1';
    for (let i = 0; i < 30; i++) {
      await resetIpOnlyLimiter.consume(ipKey);
    }
    await expect(resetIpOnlyLimiter.consume(ipKey)).rejects.toMatchObject({
      consumedPoints: expect.any(Number),
    });
  });
});
