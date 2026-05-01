// worker/lib/metadata/cover-storage.ts
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { fetch, type Response } from 'undici';
import { coverPath, coverRelPath } from '../storage-paths.js';

const TIMEOUT_MS_DEFAULT = 10_000;
const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export async function downloadAndNormalize(
  url: string,
  bookId: string,
): Promise<{ relPath: string } | null> {
  const timeoutMs = Number(process.env.METADATA_FETCH_TIMEOUT_MS ?? TIMEOUT_MS_DEFAULT);
  const maxBytes = Number(process.env.COVER_MAX_BYTES ?? 5 * 1024 * 1024);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { signal: ac.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) return null;

  const contentLength = Number(res.headers.get('content-length') ?? '0');
  if (contentLength > maxBytes) return null;

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) return null;

  // file-type@22 strict: must pass a Uint8Array view that crosses JS realms cleanly.
  const ft = await fileTypeFromBuffer(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  if (!ft || !ALLOWED_MIMES.has(ft.mime)) return null;

  let normalized: Buffer;
  try {
    normalized = await sharp(buf).jpeg({ quality: 85 }).toBuffer();
  } catch {
    return null;
  }
  if (normalized.byteLength > 2 * 1024 * 1024) return null;

  const finalPath = coverPath(bookId);
  await mkdir(dirname(finalPath), { recursive: true });
  const tmp = `${finalPath}.${randomBytes(8).toString('hex')}.tmp`;
  await writeFile(tmp, normalized);
  try {
    await rename(tmp, finalPath);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
  return { relPath: coverRelPath(bookId) };
}
