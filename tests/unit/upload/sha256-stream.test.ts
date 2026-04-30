// tests/unit/upload/sha256-stream.test.ts
import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { createSha256Hasher } from '@/lib/upload/sha256-stream';

describe('createSha256Hasher', () => {
  it('hashes empty stream → SHA-256("") and counts 0 bytes', async () => {
    const hasher = createSha256Hasher();
    await new Promise((resolve, reject) => {
      Readable.from([]).pipe(hasher).on('finish', resolve).on('error', reject);
    });
    const r = hasher.result();
    expect(r.bytesWritten).toBe(0);
    expect(r.sha256).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('hashes "hello" correctly and counts bytes', async () => {
    const hasher = createSha256Hasher();
    await new Promise((resolve, reject) => {
      Readable.from(['hello']).pipe(hasher).on('finish', resolve).on('error', reject);
    });
    const r = hasher.result();
    expect(r.bytesWritten).toBe(5);
    expect(r.sha256).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('throws when result() called before stream end', () => {
    const hasher = createSha256Hasher();
    expect(() => hasher.result()).toThrow(/not finalized/i);
  });
});
