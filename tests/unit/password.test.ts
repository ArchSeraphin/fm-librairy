import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '@/lib/password';

describe('hashPassword / verifyPassword', () => {
  it('produit un hash argon2id (préfixe $argon2id$)', async () => {
    const h = await hashPassword('correct horse battery staple');
    expect(h).toMatch(/^\$argon2id\$/);
  });

  it('verify accepte le bon mot de passe', async () => {
    const h = await hashPassword('s3cret-passphrase!');
    await expect(verifyPassword(h, 's3cret-passphrase!')).resolves.toBe(true);
  });

  it('verify refuse un mauvais mot de passe', async () => {
    const h = await hashPassword('s3cret-passphrase!');
    await expect(verifyPassword(h, 'wrong')).resolves.toBe(false);
  });

  it('verify refuse un hash altéré sans throw', async () => {
    const h = await hashPassword('x');
    const tampered = h.slice(0, -2) + 'XX';
    await expect(verifyPassword(tampered, 'x')).resolves.toBe(false);
  });
});
