import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getEnv } from './env';

const ALGO = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

// SHA-256 used as a KDF only because CRYPTO_MASTER_KEY must be a high-entropy random value (e.g. `openssl rand -hex 32`). Never use a human-chosen passphrase.
function deriveKey(): Buffer {
  const masterKey = getEnv().CRYPTO_MASTER_KEY;
  return createHash('sha256').update(masterKey).digest().subarray(0, KEY_LENGTH);
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, deriveKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':');
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(':');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Invalid cipher payload');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  if (tag.length !== TAG_LENGTH) throw new Error(`Invalid GCM tag length: expected ${TAG_LENGTH} bytes, got ${tag.length}`);
  const data = Buffer.from(dataB64, 'base64');
  const decipher = createDecipheriv(ALGO, deriveKey(), iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
}

export function hashIp(ip: string): string {
  const salt = getEnv().IP_HASH_SALT;
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex');
}

export function hashUa(ua: string): string {
  const salt = getEnv().UA_HASH_SALT;
  return createHash('sha256').update(`${salt}:${ua}`).digest('hex').slice(0, 32);
}

export function hmac(message: string, key: string): string {
  return createHmac('sha256', key).update(message).digest('hex');
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return timingSafeEqual(ba, bb);
}

export function hashEmail(email: string): string {
  const salt = getEnv().IP_HASH_SALT; // réutilisé volontairement, c'est juste un anti-leak
  return createHash('sha256').update(`email:${salt}:${email.toLowerCase()}`).digest('hex').slice(0, 32);
}
