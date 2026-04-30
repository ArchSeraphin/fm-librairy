// src/lib/upload/staging-io.ts
import { mkdir, rename, unlink, rm, readFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { createSha256Hasher } from './sha256-stream';
import { validateMime } from './mime-validator';
import { stagingPath, assertUnderRoot } from './storage-paths';
import type { BookFormat } from '@prisma/client';

const FORMAT_TO_EXT: Record<BookFormat, string> = {
  EPUB: 'epub',
  PDF: 'pdf',
  TXT: 'txt',
  DOCX: 'docx',
};

export interface StagingResult {
  sha256: string;
  bytesWritten: number;
  format: BookFormat;
  mimeType: string;
  stagingPath: string;
}

export interface WriteToStagingArgs {
  root: string;
  stream: Readable;
  filename: string;
  maxBytes?: number;
}

const DEFAULT_MAX = 100 * 1024 * 1024;

export async function writeToStaging(args: WriteToStagingArgs): Promise<StagingResult> {
  const max = args.maxBytes ?? DEFAULT_MAX;
  const stagingDir = path.join(args.root, 'staging');
  await mkdir(stagingDir, { recursive: true });

  const tmpName = `.tmp-${randomBytes(16).toString('hex')}`;
  const tmpFile = path.join(stagingDir, tmpName);
  assertUnderRoot(args.root, tmpFile);

  const hasher = createSha256Hasher();
  let aborted = false;
  hasher.on('data', () => {
    if (hasher.result === undefined) return;
  });

  // Enforce maxBytes by inspecting bytes through hasher
  const sizeGuard = (() => {
    let total = 0;
    return (chunk: Buffer): void => {
      total += chunk.length;
      if (total > max) {
        aborted = true;
        throw new Error(`OVERSIZE: > ${max} bytes`);
      }
    };
  })();

  hasher.on('data', sizeGuard);

  try {
    await pipeline(args.stream, hasher, createWriteStream(tmpFile));
  } catch (err) {
    await rm(tmpFile, { force: true });
    if (aborted) throw new Error('OVERSIZE');
    throw err;
  }

  const { sha256, bytesWritten } = hasher.result();

  // Validate MIME from on-disk content (read first 64KB is enough for file-type)
  const head = await readFile(tmpFile);
  let mime;
  try {
    mime = await validateMime(head.subarray(0, Math.min(head.length, 64 * 1024)), args.filename);
  } catch (err) {
    await rm(tmpFile, { force: true });
    throw err;
  }

  const ext = FORMAT_TO_EXT[mime.format];
  const finalStaging = stagingPath(args.root, sha256, ext);
  assertUnderRoot(args.root, finalStaging);

  await rename(tmpFile, finalStaging);

  return {
    sha256,
    bytesWritten,
    format: mime.format,
    mimeType: mime.mimeType,
    stagingPath: finalStaging,
  };
}
