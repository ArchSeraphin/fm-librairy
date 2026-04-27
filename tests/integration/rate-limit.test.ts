import { describe, it, expect, beforeEach } from 'vitest';
import {
  loginLimiter,
  twoFactorLimiter,
  resetRequestLimiter,
  invitationLimiter,
} from '@/lib/rate-limit';

describe('loginLimiter', () => {
  beforeEach(async () => {
    await loginLimiter.delete('test:user@x.test');
  });

  it('autorise 5 tentatives sur 15 min', async () => {
    for (let i = 0; i < 5; i++) {
      await expect(loginLimiter.consume('test:user@x.test')).resolves.toBeDefined();
    }
  });

  it('refuse la 6ᵉ tentative', async () => {
    for (let i = 0; i < 5; i++) await loginLimiter.consume('test:user@x.test');
    await expect(loginLimiter.consume('test:user@x.test')).rejects.toBeDefined();
  });

  it('reset autorise à nouveau', async () => {
    for (let i = 0; i < 5; i++) await loginLimiter.consume('test:user@x.test');
    await loginLimiter.delete('test:user@x.test');
    await expect(loginLimiter.consume('test:user@x.test')).resolves.toBeDefined();
  });
});

describe('twoFactorLimiter', () => {
  beforeEach(async () => {
    await twoFactorLimiter.delete('session-id-test');
  });

  it('autorise 5 codes en 5 min', async () => {
    for (let i = 0; i < 5; i++) await twoFactorLimiter.consume('session-id-test');
    await expect(twoFactorLimiter.consume('session-id-test')).rejects.toBeDefined();
  });
});

describe('resetRequestLimiter', () => {
  beforeEach(async () => {
    await resetRequestLimiter.delete('reset@x.test');
  });

  it('autorise 3 demandes par heure', async () => {
    for (let i = 0; i < 3; i++) await resetRequestLimiter.consume('reset@x.test');
    await expect(resetRequestLimiter.consume('reset@x.test')).rejects.toBeDefined();
  });
});

describe('invitationLimiter', () => {
  beforeEach(async () => {
    await invitationLimiter.delete('user-id-1');
  });

  it('autorise 10 invitations par heure', async () => {
    for (let i = 0; i < 10; i++) await invitationLimiter.consume('user-id-1');
    await expect(invitationLimiter.consume('user-id-1')).rejects.toBeDefined();
  });
});
