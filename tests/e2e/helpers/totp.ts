import { generateSync, NobleCryptoPlugin, ScureBase32Plugin } from 'otplib';

// otplib v13 requires explicit crypto + base32 plugins. Mirrors src/lib/totp.ts
// so generated tokens match what verifyTotpCode() accepts.
const cryptoPlugin = new NobleCryptoPlugin();
const base32Plugin = new ScureBase32Plugin();

export function totpFor(secret: string): string {
  return generateSync({ secret, crypto: cryptoPlugin, base32: base32Plugin, period: 30 });
}
