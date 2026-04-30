// tests/unit/upload/mime-validator.test.ts
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { validateMime } from '@/lib/upload/mime-validator';

const fixture = (name: string) => path.join(process.cwd(), 'tests/fixtures/upload', name);

describe('validateMime', () => {
  it('accepts EPUB → BookFormat.EPUB', async () => {
    const buf = await readFile(fixture('tiny.epub'));
    const r = await validateMime(buf, 'tiny.epub');
    expect(r.format).toBe('EPUB');
    expect(r.mimeType).toBe('application/epub+zip');
  });
  it('accepts PDF → BookFormat.PDF', async () => {
    const buf = await readFile(fixture('tiny.pdf'));
    const r = await validateMime(buf, 'tiny.pdf');
    expect(r.format).toBe('PDF');
    expect(r.mimeType).toBe('application/pdf');
  });
  it('accepts TXT (UTF-8 text) → BookFormat.TXT', async () => {
    const buf = await readFile(fixture('tiny.txt'));
    const r = await validateMime(buf, 'tiny.txt');
    expect(r.format).toBe('TXT');
    expect(r.mimeType).toBe('text/plain');
  });
  it('accepts DOCX → BookFormat.DOCX', async () => {
    const buf = await readFile(fixture('tiny.docx'));
    const r = await validateMime(buf, 'tiny.docx');
    expect(r.format).toBe('DOCX');
    expect(r.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });
  it('rejects spoofed PE binary renamed .pdf', async () => {
    const buf = await readFile(fixture('fake.pdf'));
    await expect(validateMime(buf, 'fake.pdf')).rejects.toThrow(/INVALID_MIME/);
  });
  it('rejects empty buffer', async () => {
    await expect(validateMime(Buffer.alloc(0), 'empty.epub')).rejects.toThrow(/INVALID_MIME/);
  });
});
