// tests/unit/upload/staging-io.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { writeToStaging } from '@/lib/upload/staging-io';

let tmpRoot: string;
beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), 'biblio-staging-'));
});
afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('writeToStaging', () => {
  it('writes EPUB to staging path keyed by SHA, returns metadata', async () => {
    const fs = await import('node:fs/promises');
    const buf = await fs.readFile(path.join(process.cwd(), 'tests/fixtures/upload/tiny.epub'));
    const stream = Readable.from(buf);

    const result = await writeToStaging({ root: tmpRoot, stream, filename: 'tiny.epub' });

    expect(result.format).toBe('EPUB');
    expect(result.mimeType).toBe('application/epub+zip');
    expect(result.bytesWritten).toBe(buf.length);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.stagingPath).toBe(path.join(tmpRoot, 'staging', `${result.sha256}.epub`));
    expect(existsSync(result.stagingPath)).toBe(true);
    expect(readFileSync(result.stagingPath)).toEqual(buf);
  });

  it('throws and removes staging file on INVALID_MIME', async () => {
    const fs = await import('node:fs/promises');
    const buf = await fs.readFile(path.join(process.cwd(), 'tests/fixtures/upload/fake.pdf'));
    const stream = Readable.from(buf);

    await expect(writeToStaging({ root: tmpRoot, stream, filename: 'fake.pdf' })).rejects.toThrow(
      /INVALID_MIME/,
    );

    const fsSync = await import('node:fs');
    const stagingDir = path.join(tmpRoot, 'staging');
    if (fsSync.existsSync(stagingDir)) {
      expect(fsSync.readdirSync(stagingDir)).toEqual([]);
    }
  });

  it('throws OVERSIZE if bytesWritten > maxBytes', async () => {
    const big = Buffer.alloc(1024, 0x41); // 1 KB of 'A'
    const stream = Readable.from(big);
    await expect(
      writeToStaging({ root: tmpRoot, stream, filename: 'big.txt', maxBytes: 100 }),
    ).rejects.toThrow(/OVERSIZE/);
  });
});
