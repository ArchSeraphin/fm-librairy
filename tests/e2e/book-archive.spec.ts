import { test, expect } from '@playwright/test';

import {
  getPrisma,
  cleanupTestData,
  cleanupE2ELibrary,
  flushRateLimit,
  disconnect,
} from './helpers/db';
import { submitLogin } from './helpers/auth';
import { hashPassword } from '../../src/lib/password';
// Static import ensures crypto.ts is compiled by Playwright's esbuild and
// cached in Node's module registry before cleanupTestData() dynamic-imports it.
import '../../src/lib/crypto';

const PASSWORD = 'TestPass-123!';
const LIBRARY_SLUG = 'e2e-1d-archive';
const LIBRARY_NAME = 'E2E 1D Archive';

const prisma = getPrisma();

test.beforeEach(async () => {
  await cleanupE2ELibrary(LIBRARY_SLUG);
  await cleanupTestData();
  await flushRateLimit();
});

test.afterEach(async () => {
  await cleanupE2ELibrary(LIBRARY_SLUG);
});

test.afterAll(async () => {
  await disconnect();
});

test('admin archives a book; member cannot see it; admin unarchives it; member sees it again', async ({ browser }) => {
  // -------------------------------------------------------------------------
  // Seed
  // -------------------------------------------------------------------------
  const admin = await prisma.user.create({
    data: {
      email: 'admin-archive@e2e.test',
      displayName: 'Admin Archive',
      passwordHash: await hashPassword(PASSWORD),
      role: 'GLOBAL_ADMIN',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });

  const member = await prisma.user.create({
    data: {
      email: 'member-archive@e2e.test',
      displayName: 'Member Archive',
      passwordHash: await hashPassword(PASSWORD),
      role: 'USER',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });

  const library = await prisma.library.create({
    data: { name: LIBRARY_NAME, slug: LIBRARY_SLUG },
  });

  await prisma.libraryMember.create({
    data: { userId: member.id, libraryId: library.id, role: 'MEMBER' },
  });

  const book = await prisma.book.create({
    data: {
      title: 'Livre à Archiver',
      authors: ['Auteur Test'],
      language: 'fr',
      libraryId: library.id,
      uploadedById: admin.id,
    },
  });

  // -------------------------------------------------------------------------
  // Admin context: open detail → archive
  // -------------------------------------------------------------------------
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();

  await submitLogin(adminPage, 'admin-archive@e2e.test', PASSWORD);
  await adminPage.goto(`/library/${LIBRARY_SLUG}/books/${book.id}`);

  // Open the actions menu
  await adminPage.getByRole('button', { name: "Ouvrir le menu d'actions", exact: true }).click();

  // Click "Archiver" in the dropdown
  await adminPage.getByRole('menuitem', { name: 'Archiver', exact: true }).click();

  // Dialog appears — click the confirm "Archiver" button in the dialog
  const archiveDialog = adminPage.getByRole('dialog');
  await archiveDialog.getByRole('button', { name: 'Archiver', exact: true }).click();

  // Expect success toast (use exact match to avoid aria-live duplicate)
  await expect(adminPage.getByText('Livre archivé', { exact: true }).first()).toBeVisible({ timeout: 10_000 });

  // Verify in DB: archivedAt is set
  const archivedBook = await prisma.book.findUnique({ where: { id: book.id } });
  expect(archivedBook?.archivedAt).not.toBeNull();

  // -------------------------------------------------------------------------
  // Member context: book should NOT appear in catalog
  // -------------------------------------------------------------------------
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();

  await submitLogin(memberPage, 'member-archive@e2e.test', PASSWORD);
  await memberPage.goto(`/library/${LIBRARY_SLUG}/books`);

  // Book should NOT be visible (archived, members can't see it)
  await expect(memberPage.getByText('Livre à Archiver')).not.toBeVisible({ timeout: 10_000 });

  await memberContext.close();

  // -------------------------------------------------------------------------
  // Admin: toggle "Inclure les livres archivés" — book reappears with badge
  // -------------------------------------------------------------------------
  await adminPage.goto(`/library/${LIBRARY_SLUG}/books`);

  // Check the "Inclure les livres archivés" checkbox
  await adminPage.getByText('Inclure les livres archivés').click();

  // Book should reappear
  await expect(adminPage.getByText('Livre à Archiver')).toBeVisible({ timeout: 10_000 });

  // The "Archivé" badge should be visible on the card
  await expect(adminPage.getByText('Archivé').first()).toBeVisible({ timeout: 5_000 });

  // -------------------------------------------------------------------------
  // Admin: navigate to detail → unarchive
  // -------------------------------------------------------------------------
  await adminPage.goto(`/library/${LIBRARY_SLUG}/books/${book.id}`);

  // Open actions menu
  await adminPage.getByRole('button', { name: "Ouvrir le menu d'actions", exact: true }).click();

  // Click "Désarchiver"
  await adminPage.getByRole('menuitem', { name: 'Désarchiver', exact: true }).click();

  // Confirm in dialog
  const unarchiveDialog = adminPage.getByRole('dialog');
  await unarchiveDialog.getByRole('button', { name: 'Désarchiver', exact: true }).click();

  // Expect success toast (use exact match to avoid aria-live duplicate)
  await expect(adminPage.getByText('Livre désarchivé', { exact: true }).first()).toBeVisible({ timeout: 10_000 });

  await adminContext.close();

  // -------------------------------------------------------------------------
  // Member: book should be visible again
  // -------------------------------------------------------------------------
  const memberContext2 = await browser.newContext();
  const memberPage2 = await memberContext2.newPage();

  await submitLogin(memberPage2, 'member-archive@e2e.test', PASSWORD);
  await memberPage2.goto(`/library/${LIBRARY_SLUG}/books`);

  await expect(memberPage2.getByText('Livre à Archiver')).toBeVisible({ timeout: 10_000 });

  await memberContext2.close();
});
