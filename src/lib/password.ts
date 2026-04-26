import { hash, verify } from '@node-rs/argon2';

const PARAMS = {
  // Argon2id (Algorithm enum value 2) — using literal because const enum is incompatible with isolatedModules.
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, PARAMS);
}

export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain, PARAMS);
  } catch {
    return false;
  }
}
