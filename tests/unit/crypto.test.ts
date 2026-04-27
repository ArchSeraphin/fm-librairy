import { describe, it, expect, beforeAll } from 'vitest';
import {
  encryptSecret,
  decryptSecret,
  hashIp,
  hashUa,
  hmac,
  constantTimeEqual,
} from '@/lib/crypto';

beforeAll(() => {
  process.env.CRYPTO_MASTER_KEY = 'a'.repeat(32);
  process.env.IP_HASH_SALT = 'salt-for-ip-1234';
  process.env.UA_HASH_SALT = 'salt-for-ua-1234';
});

describe('AES-256-GCM round-trip', () => {
  it('chiffre puis déchiffre correctement', () => {
    const plain = 'JBSWY3DPEHPK3PXP'; // exemple secret TOTP
    const cipher = encryptSecret(plain);
    expect(cipher).not.toBe(plain);
    expect(cipher).toMatch(/^[A-Za-z0-9+/=:]+$/);
    expect(decryptSecret(cipher)).toBe(plain);
  });

  it('produit des chiffrés différents (nonce unique) pour la même entrée', () => {
    const a = encryptSecret('same-input');
    const b = encryptSecret('same-input');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe('same-input');
    expect(decryptSecret(b)).toBe('same-input');
  });

  it('refuse un chiffré altéré (auth tag check)', () => {
    const cipher = encryptSecret('payload');
    const tampered = cipher.slice(0, -2) + 'XX';
    expect(() => decryptSecret(tampered)).toThrow();
  });
});

describe('hashIp / hashUa', () => {
  it('hash IP déterministe avec le même sel', () => {
    expect(hashIp('192.168.1.1')).toBe(hashIp('192.168.1.1'));
  });

  it('hash IP différent pour des IPs différentes', () => {
    expect(hashIp('192.168.1.1')).not.toBe(hashIp('192.168.1.2'));
  });

  it('hash UA tronqué (collision-resistant mais non-réversible)', () => {
    const h = hashUa('Mozilla/5.0 (X11; Linux x86_64) ...');
    expect(h).toMatch(/^[a-f0-9]{32}$/);
  });
});

describe('hmac', () => {
  it('produit le même HMAC pour la même entrée + clé', () => {
    expect(hmac('msg', 'key')).toBe(hmac('msg', 'key'));
  });
  it('HMAC différent pour clés différentes', () => {
    expect(hmac('msg', 'k1')).not.toBe(hmac('msg', 'k2'));
  });
});

describe('constantTimeEqual', () => {
  it('renvoie true pour strings égales', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
  });
  it('renvoie false pour strings différentes', () => {
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
  });
  it('renvoie false pour longueurs différentes', () => {
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });
});
