// tests/e2e/book-upload.spec.ts
import { test, expect } from '@playwright/test';
import path from 'node:path';

import {
  getPrisma,
  cleanupTestData,
  cleanupE2ELibrary,
  flushRateLimit,
  disconnect,
} from './helpers/db';
import { submitLogin } from './helpers/auth';
import { hashPassword } from '../../src/lib/password';

const PASSWORD = 'TestPass-123!';
const LIBRARY_SLUG = 'e2e-2a-upload';
const LIBRARY_NAME = 'E2E 2A Upload';

const prisma = getPrisma();

test.beforeEach(async () => {
  await cleanupTestData();
  await cleanupE2ELibrary(LIBRARY_SLUG);
  await flushRateLimit();
});

test.afterAll(async () => {
  await disconnect();
});

test('uploader sees PENDING then CLEAN after refresh', async ({ page }) => {
  const email = `uploader-${Date.now()}@e2e.test`;
  const user = await prisma.user.create({
    data: {
      email,
      displayName: 'E2E Uploader',
      passwordHash: await hashPassword(PASSWORD),
      emailVerifiedAt: new Date(),
      role: 'USER',
      status: 'ACTIVE',
    },
  });
  const lib = await prisma.library.create({
    data: { name: LIBRARY_NAME, slug: LIBRARY_SLUG },
  });
  await prisma.libraryMember.create({
    data: {
      userId: user.id,
      libraryId: lib.id,
      role: 'LIBRARY_ADMIN',
      canUpload: true,
    },
  });
  const book = await prisma.book.create({
    data: { libraryId: lib.id, title: 'E2E Upload Test', authors: ['A'] },
  });

  await submitLogin(page, email, PASSWORD);
  await page.goto(`/library/${LIBRARY_SLUG}/books/${book.id}`);

  await page.setInputFiles(
    'input[type="file"][name="file"]',
    path.join(process.cwd(), 'tests/fixtures/upload/tiny.epub'),
  );
  await page.getByRole('button', { name: 'Envoyer' }).click();

  // PENDING badge appears after action returns
  await expect(page.getByTestId('scan-status-pending')).toBeVisible({ timeout: 10_000 });

  // Wait up to 30s for worker to complete scan, then refresh
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId('scan-status-clean')).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
});
