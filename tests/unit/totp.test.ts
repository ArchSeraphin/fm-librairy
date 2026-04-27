import { describe, it, expect, beforeAll } from 'vitest';
import { generateSync, NobleCryptoPlugin, ScureBase32Plugin } from 'otplib';
import {
  generateTotpSecret,
  buildTotpUri,
  verifyTotpCode,
  generateBackupCodes,
  hashBackupCodes,
  consumeBackupCode,
} from '@/lib/totp';

beforeAll(() => {
  process.env.CRYPTO_MASTER_KEY = 'a'.repeat(32);
  process.env.IP_HASH_SALT = 'b'.repeat(16);
  process.env.UA_HASH_SALT = 'c'.repeat(16);
});

const TOTP_OPTS = {
  crypto: new NobleCryptoPlugin(),
  base32: new ScureBase32Plugin(),
  period: 30,
};

describe('generateTotpSecret', () => {
  it('produit un secret base32 ≥ 16 chars', () => {
    const s = generateTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]+$/);
    expect(s.length).toBeGreaterThanOrEqual(16);
  });

  it('produit des secrets uniques', () => {
    expect(generateTotpSecret()).not.toBe(generateTotpSecret());
  });
});

describe('buildTotpUri', () => {
  it('produit un otpauth:// URI valide', () => {
    const secret = generateTotpSecret();
    const uri = buildTotpUri({ secret, accountName: 'admin@x.test' });
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain('issuer=BiblioShare');
    expect(uri).toContain('admin%40x.test');
  });
});

describe('verifyTotpCode', () => {
  it('accepte un code généré pour le secret', () => {
    const secret = generateTotpSecret();
    const code = generateSync({ secret, ...TOTP_OPTS });
    expect(verifyTotpCode(secret, code)).toBe(true);
  });

  it('refuse un code aléatoire', () => {
    const secret = generateTotpSecret();
    expect(verifyTotpCode(secret, '000000')).toBe(false);
  });

  it('refuse un code de mauvaise longueur', () => {
    const secret = generateTotpSecret();
    expect(verifyTotpCode(secret, '12345')).toBe(false);
  });
});

describe('backup codes', () => {
  it('génère 8 codes alphanumériques uniques', () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    codes.forEach((c) => expect(c).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/));
  });

  it('hashe les 8 codes', async () => {
    const codes = generateBackupCodes();
    const hashes = await hashBackupCodes(codes);
    expect(hashes).toHaveLength(8);
    hashes.forEach((h) => expect(h).toMatch(/^\$argon2id\$/));
  });

  it('consumeBackupCode retire le code consommé et renvoie les hashes restants', async () => {
    const codes = generateBackupCodes();
    const hashes = await hashBackupCodes(codes);
    const result = await consumeBackupCode(codes[0]!, hashes);
    expect(result).not.toBeNull();
    expect(result!.remainingHashes).toHaveLength(7);
  });

  it('consumeBackupCode renvoie null pour un code invalide', async () => {
    const codes = generateBackupCodes();
    const hashes = await hashBackupCodes(codes);
    const result = await consumeBackupCode('XXXX-XXXX', hashes);
    expect(result).toBeNull();
  });
});
