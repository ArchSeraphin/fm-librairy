// tests/integration/scan-file-job.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { handleScanFile } from '../../worker/jobs/scan-file';

const prisma = new PrismaClient();
const logger = pino({ level: 'silent' });
const HOST = process.env.CLAMAV_HOST ?? 'localhost';
const PORT = Number(process.env.CLAMAV_PORT ?? 3310);

let storageRoot: string;
let library: { id: string };
let book: { id: string };

beforeEach(async () => {
  storageRoot = path.join(tmpdir(), `biblio-scan-test-${Date.now()}-${Math.random()}`);
  mkdirSync(path.join(storageRoot, 'staging'), { recursive: true });

  library = await prisma.library.create({
    data: { name: 'ScanTest', slug: `scan-test-${Date.now()}` },
  });
  book = await prisma.book.create({
    data: { libraryId: library.id, title: 'T', authors: ['A'] },
  });
});

afterEach(async () => {
  await prisma.bookFile.deleteMany({ where: { libraryId: library.id } });
  await prisma.book.deleteMany({ where: { libraryId: library.id } });
  await prisma.library.delete({ where: { id: library.id } });
  rmSync(storageRoot, { recursive: true, force: true });
});

describe('handleScanFile', () => {
  it('CLEAN: moves staging→final, sets scanStatus=CLEAN, updates storagePath', async () => {
    const stagingPath = path.join(storageRoot, 'staging', 'abc.epub');
    writeFileSync(stagingPath, 'BiblioShare clean test.');
    const bf = await prisma.bookFile.create({
      data: {
        bookId: book.id,
        libraryId: library.id,
        format: 'EPUB',
        isOriginal: true,
        storagePath: stagingPath,
        fileSizeBytes: BigInt(20),
        sha256: 'abc',
        mimeType: 'application/epub+zip',
        scanStatus: 'PENDING',
      },
    });

    await handleScanFile({ id: 'job1', data: { bookFileId: bf.id, storageRoot } } as any, {
      prisma,
      logger,
      clamavHost: HOST,
      clamavPort: PORT,
    });

    const updated = await prisma.bookFile.findUniqueOrThrow({ where: { id: bf.id } });
    expect(updated.scanStatus).toBe('CLEAN');
    expect(updated.scannedAt).toBeInstanceOf(Date);
    expect(updated.storagePath).toBe(
      path.join(storageRoot, 'library', library.id, book.id, 'abc.epub'),
    );
    expect(existsSync(updated.storagePath)).toBe(true);
    expect(existsSync(stagingPath)).toBe(false);
  });

  it('INFECTED: removes staging, sets scanStatus=INFECTED, writes AuditLog', async () => {
    const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
    const stagingPath = path.join(storageRoot, 'staging', 'evil.epub');
    writeFileSync(stagingPath, EICAR);
    const bf = await prisma.bookFile.create({
      data: {
        bookId: book.id,
        libraryId: library.id,
        format: 'EPUB',
        isOriginal: true,
        storagePath: stagingPath,
        fileSizeBytes: BigInt(EICAR.length),
        sha256: 'evil',
        mimeType: 'application/epub+zip',
        scanStatus: 'PENDING',
      },
    });

    await handleScanFile({ id: 'job2', data: { bookFileId: bf.id, storageRoot } } as any, {
      prisma,
      logger,
      clamavHost: HOST,
      clamavPort: PORT,
    });

    const updated = await prisma.bookFile.findUniqueOrThrow({ where: { id: bf.id } });
    expect(updated.scanStatus).toBe('INFECTED');
    expect(existsSync(stagingPath)).toBe(false);

    const audit = await prisma.auditLog.findFirst({
      where: { targetId: bf.id, action: 'library.book_file.infected' },
    });
    expect(audit).not.toBeNull();
    expect(audit!.targetType).toBe('BOOK_FILE');
  });

  it('ERROR: missing staging file → scanStatus=ERROR (let BullMQ retry)', async () => {
    const bf = await prisma.bookFile.create({
      data: {
        bookId: book.id,
        libraryId: library.id,
        format: 'EPUB',
        isOriginal: true,
        storagePath: path.join(storageRoot, 'staging', 'nonexistent.epub'),
        fileSizeBytes: BigInt(0),
        sha256: 'noexist',
        mimeType: 'application/epub+zip',
        scanStatus: 'PENDING',
      },
    });

    await expect(
      handleScanFile({ id: 'job3', data: { bookFileId: bf.id, storageRoot } } as any, {
        prisma,
        logger,
        clamavHost: HOST,
        clamavPort: PORT,
      }),
    ).rejects.toThrow();

    const updated = await prisma.bookFile.findUniqueOrThrow({ where: { id: bf.id } });
    expect(updated.scanStatus).toBe('ERROR');
  });
});
