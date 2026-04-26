import { TOTP, NobleCryptoPlugin, ScureBase32Plugin, generateSync, verifySync } from 'otplib';
import { randomBytes } from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';

const ARGON_OPTS = {
  // Argon2id (Algorithm enum value 2) — using literal because const enum is incompatible with isolatedModules.
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

const ISSUER = 'BiblioShare';

const cryptoPlugin = new NobleCryptoPlugin();
const base32Plugin = new ScureBase32Plugin();

const totp = new TOTP({
  crypto: cryptoPlugin,
  base32: base32Plugin,
  period: 30,
});

const TOTP_OPTS = { crypto: cryptoPlugin, base32: base32Plugin, period: 30, epochTolerance: 30 };

export function generateTotpSecret(): string {
  return totp.generateSecret();
}

export function buildTotpUri(input: { secret: string; accountName: string }): string {
  return totp.toURI({ label: input.accountName, issuer: ISSUER, secret: input.secret });
}

export function verifyTotpCode(secret: string, code: string): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  try {
    const result = verifySync({ token: code, secret, ...TOTP_OPTS });
    return result.valid;
  } catch {
    return false;
  }
}

function randomSegment(len: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i]! % alphabet.length];
  return out;
}

export function generateBackupCodes(): string[] {
  const codes = new Set<string>();
  while (codes.size < 8) codes.add(`${randomSegment(4)}-${randomSegment(4)}`);
  return [...codes];
}

export async function hashBackupCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map((c) => argonHash(c, ARGON_OPTS)));
}

// Verifies `attempt` against each stored hash and removes the matched hash.
// CALLER MUST persist `remainingHashes` atomically — failure to do so allows replay.
// Returns null if no hash matches.
export async function consumeBackupCode(
  attempt: string,
  storedHashes: string[],
): Promise<{ remainingHashes: string[] } | null> {
  for (let i = 0; i < storedHashes.length; i++) {
    const ok = await argonVerify(storedHashes[i]!, attempt, ARGON_OPTS).catch(() => false);
    if (ok) {
      const remaining = [...storedHashes.slice(0, i), ...storedHashes.slice(i + 1)];
      return { remainingHashes: remaining };
    }
  }
  return null;
}
