import { describe, it, expect } from 'vitest';
import { generateRawToken, hashToken, verifyToken } from '@/lib/tokens';

describe('generateRawToken', () => {
  it('génère un token base64url 32 octets (≥ 43 chars)', () => {
    const t = generateRawToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(t.length).toBeGreaterThanOrEqual(43);
  });

  it('génère des tokens uniques sur 1000 itérations', () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) set.add(generateRawToken());
    expect(set.size).toBe(1000);
  });
});

describe('hashToken / verifyToken', () => {
  it('vérifie correctement un token valide', async () => {
    const raw = generateRawToken();
    const hash = await hashToken(raw);
    expect(hash).not.toBe(raw);
    await expect(verifyToken(raw, hash)).resolves.toBe(true);
  });

  it('rejette un token altéré', async () => {
    const raw = generateRawToken();
    const hash = await hashToken(raw);
    const tampered = raw.slice(0, -2) + 'XX';
    await expect(verifyToken(tampered, hash)).resolves.toBe(false);
  });

  it('rejette un hash altéré', async () => {
    const raw = generateRawToken();
    const hash = await hashToken(raw);
    const tampered = hash.slice(0, -2) + 'XX';
    await expect(verifyToken(raw, tampered)).resolves.toBe(false);
  });
});
