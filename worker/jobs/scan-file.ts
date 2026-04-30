// worker/jobs/scan-file.ts
import type { Job } from 'bullmq';
import type { Logger } from 'pino';
import type { PrismaClient } from '@prisma/client';
import { rm, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { scanFile } from '../lib/clamav.js';
import { finalPath, assertUnderRoot } from '../../src/lib/upload/storage-paths.js';
import { recordAudit } from '../../src/lib/audit-log.js';

export interface ScanFileDeps {
  prisma: PrismaClient;
  logger: Logger;
  clamavHost: string;
  clamavPort: number;
}

const FORMAT_TO_EXT = { EPUB: 'epub', PDF: 'pdf', TXT: 'txt', DOCX: 'docx' } as const;

export async function handleScanFile(
  job: Job<{ bookFileId: string; storageRoot: string }>,
  deps: ScanFileDeps,
): Promise<void> {
  const { bookFileId, storageRoot } = job.data;
  const { prisma, logger, clamavHost, clamavPort } = deps;

  const bf = await prisma.bookFile.findUnique({ where: { id: bookFileId } });
  if (!bf) {
    logger.warn({ bookFileId }, 'scan-file: BookFile vanished, skipping');
    return;
  }

  if (bf.scanStatus !== 'PENDING') {
    logger.info({ bookFileId, status: bf.scanStatus }, 'scan-file: already settled');
    return;
  }

  let scan;
  try {
    scan = await scanFile(bf.storagePath, { host: clamavHost, port: clamavPort }, logger);
  } catch (err) {
    await prisma.bookFile.update({
      where: { id: bookFileId },
      data: { scanStatus: 'ERROR', scannedAt: new Date() },
    });
    throw err;
  }

  if (scan.verdict === 'ERROR') {
    await prisma.bookFile.update({
      where: { id: bookFileId },
      data: { scanStatus: 'ERROR', scannedAt: new Date() },
    });
    throw new Error(`scan-file: clamav error: ${scan.errorMessage ?? 'unknown'}`);
  }

  if (scan.verdict === 'INFECTED') {
    await rm(bf.storagePath, { force: true });
    await prisma.bookFile.update({
      where: { id: bookFileId },
      data: { scanStatus: 'INFECTED', scannedAt: new Date() },
    });
    await recordAudit({
      action: 'library.book_file.infected',
      target: { type: 'BOOK_FILE', id: bookFileId },
      metadata: {
        virusName: scan.virusName ?? null,
        sha256: bf.sha256,
        libraryId: bf.libraryId,
        bookId: bf.bookId,
      },
    });
    logger.warn(
      { bookFileId, virus: scan.virusName, sha256: bf.sha256 },
      'scan-file: INFECTED quarantined',
    );
    return;
  }

  // CLEAN — move staging → final
  const ext = FORMAT_TO_EXT[bf.format];
  const dest = finalPath(storageRoot, bf.libraryId, bf.bookId, bf.sha256, ext);
  assertUnderRoot(storageRoot, dest);
  await mkdir(path.dirname(dest), { recursive: true });
  await rename(bf.storagePath, dest);

  await prisma.bookFile.update({
    where: { id: bookFileId },
    data: {
      scanStatus: 'CLEAN',
      scannedAt: new Date(),
      storagePath: dest,
    },
  });
  logger.info({ bookFileId, sha256: bf.sha256 }, 'scan-file: CLEAN finalized');
}
