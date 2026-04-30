// src/lib/upload/mime-validator.ts
import { fileTypeFromBuffer } from 'file-type';
import type { BookFormat } from '@prisma/client';

export interface MimeResult {
  format: BookFormat;
  mimeType: string;
}

const EXT_TO_FORMAT: Record<string, { format: BookFormat; mimeType: string }> = {
  epub: { format: 'EPUB', mimeType: 'application/epub+zip' },
  pdf: { format: 'PDF', mimeType: 'application/pdf' },
  docx: {
    format: 'DOCX',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
};

function isLikelyText(buf: Buffer): boolean {
  if (buf.length === 0) return false;
  const sample = buf.subarray(0, Math.min(buf.length, 512));
  for (const b of sample) {
    if (b === 0) return false;
    if (b < 0x09 || (b > 0x0d && b < 0x20 && b !== 0x1b)) return false;
  }
  // Reject ASCII-only that happens to start with PE magic bytes via UTF-8 fallback
  return true;
}

export async function validateMime(buf: Buffer, filename: string): Promise<MimeResult> {
  if (buf.length === 0) throw new Error('INVALID_MIME: empty buffer');

  // Normalize to Uint8Array to satisfy file-type's runtime instanceof check across JS realms
  const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const detected = await fileTypeFromBuffer(u8);

  if (detected) {
    const mapped = EXT_TO_FORMAT[detected.ext];
    if (mapped && mapped.mimeType === detected.mime) return mapped;
    throw new Error(`INVALID_MIME: detected ${detected.mime} (${detected.ext}) not in whitelist`);
  }

  // file-type returns undefined for plain text. Heuristic: filename .txt + valid UTF-8/ASCII.
  if (filename.toLowerCase().endsWith('.txt') && isLikelyText(buf)) {
    return { format: 'TXT', mimeType: 'text/plain' };
  }

  throw new Error('INVALID_MIME: unrecognized format');
}
