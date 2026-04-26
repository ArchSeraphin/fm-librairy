import { randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

const ARGON_OPTS = {
  // Argon2id (Algorithm enum value 2) — using literal because const enum is incompatible with isolatedModules.
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export function generateRawToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(raw: string): Promise<string> {
  return hash(raw, ARGON_OPTS);
}

export async function verifyToken(raw: string, storedHash: string): Promise<boolean> {
  try {
    return await verify(storedHash, raw, ARGON_OPTS);
  } catch {
    return false;
  }
}
