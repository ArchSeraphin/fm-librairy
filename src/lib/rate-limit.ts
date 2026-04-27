import { RateLimiterRedis, RateLimiterMemory } from 'rate-limiter-flexible';
import { getRedis } from './redis';

const memInsurance = (points: number, duration: number) =>
  new RateLimiterMemory({ points, duration });

const baseOpts = () => ({ storeClient: getRedis() });

export const loginLimiter = new RateLimiterRedis({
  ...baseOpts(),
  keyPrefix: 'rl:login',
  points: 5,
  duration: 15 * 60,
  blockDuration: 60 * 60,
  insuranceLimiter: memInsurance(5, 15 * 60),
});

export const loginIpOnlyLimiter = new RateLimiterRedis({
  ...baseOpts(),
  keyPrefix: 'rl:login_ip',
  points: 50,
  duration: 15 * 60,
  blockDuration: 60 * 60,
  insuranceLimiter: memInsurance(50, 15 * 60),
});

export const twoFactorLimiter = new RateLimiterRedis({
  ...baseOpts(),
  keyPrefix: 'rl:2fa',
  points: 5,
  duration: 5 * 60,
  blockDuration: 15 * 60,
  insuranceLimiter: memInsurance(5, 5 * 60),
});

export const resetRequestLimiter = new RateLimiterRedis({
  ...baseOpts(),
  keyPrefix: 'rl:reset',
  points: 3,
  duration: 60 * 60,
  insuranceLimiter: memInsurance(3, 60 * 60),
});

export const invitationLimiter = new RateLimiterRedis({
  ...baseOpts(),
  keyPrefix: 'rl:invite',
  points: 10,
  duration: 60 * 60,
  insuranceLimiter: memInsurance(10, 60 * 60),
});
