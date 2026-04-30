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
const LIBRARY_SLUG = 'e2e-1d-search';
const LIBRARY_NAME = 'E2E 1D Search';

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

test('FR accent-insensitive search finds "Les Misérables" when typing "miserables"', async ({ page }) => {
  // Seed admin + library
  const admin = await prisma.user.create({
    data: {
      email: 'admin-search@e2e.test',
      displayName: 'Admin Search',
      passwordHash: await hashPassword(PASSWORD),
      role: 'GLOBAL_ADMIN',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });

  const library = await prisma.library.create({
    data: { name: LIBRARY_NAME, slug: LIBRARY_SLUG },
  });

  // Seed 5 books: one target + 4 unrelated
  await prisma.book.create({
    data: {
      title: 'Les Misérables',
      authors: ['Victor Hugo'],
      language: 'fr',
      libraryId: library.id,
      uploadedById: admin.id,
    },
  });

  const unrelatedTitles = ['Bonjour Monde', 'Histoire Brève', 'Le Voyage', 'Contes Populaires'];
  for (const title of unrelatedTitles) {
    await prisma.book.create({
      data: {
        title,
        authors: ['Auteur Inconnu'],
        language: 'fr',
        libraryId: library.id,
        uploadedById: admin.id,
      },
    });
  }

  await submitLogin(page, 'admin-search@e2e.test', PASSWORD);
  await page.goto(`/library/${LIBRARY_SLUG}/books`);

  // Type in the search input
  const searchInput = page.getByLabel('Rechercher un livre');
  await searchInput.fill('miserables');

  // Wait for debounce + URL to update with q param
  await page.waitForURL((url) => url.searchParams.has('q'), { timeout: 5_000 });
  expect(page.url()).toContain('q=miserables');

  // Target book should be visible
  await expect(page.getByText('Les Misérables')).toBeVisible({ timeout: 10_000 });

  // At least one unrelated book should not be visible
  const unrelatedVisible = await page.getByText('Bonjour Monde').isVisible().catch(() => false);
  expect(unrelatedVisible).toBe(false);
});

test('language filter shows FR books and paginator works', async ({ page }) => {
  // Seed admin + library
  const admin = await prisma.user.create({
    data: {
      email: 'admin-search2@e2e.test',
      displayName: 'Admin Search 2',
      passwordHash: await hashPassword(PASSWORD),
      role: 'GLOBAL_ADMIN',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });

  const library = await prisma.library.create({
    data: { name: LIBRARY_NAME, slug: LIBRARY_SLUG },
  });

  // Seed 30 FR + 30 EN books
  const frBooks = Array.from({ length: 30 }, (_, i) => ({
    title: `Livre Français ${String(i + 1).padStart(2, '0')}`,
    authors: ['Auteur FR'],
    language: 'fr',
    libraryId: library.id,
    uploadedById: admin.id,
  }));
  const enBooks = Array.from({ length: 30 }, (_, i) => ({
    title: `English Book ${String(i + 1).padStart(2, '0')}`,
    authors: ['Author EN'],
    language: 'en',
    libraryId: library.id,
    uploadedById: admin.id,
  }));

  await prisma.book.createMany({ data: [...frBooks, ...enBooks] });

  await submitLogin(page, 'admin-search2@e2e.test', PASSWORD);
  await page.goto(`/library/${LIBRARY_SLUG}/books`);

  // Select "Français" from the language filter dropdown
  await page.locator('#f-lang').click();
  // Wait for the SelectContent to appear and click "Français"
  await page.getByRole('option', { name: 'Français', exact: true }).click();

  // Wait for URL to contain language=fr
  await page.waitForURL((url) => url.searchParams.get('language') === 'fr', { timeout: 5_000 });

  // With 30 FR books and page size 24, first page has 24 books; nextCursor should be set
  // Assert: "Suivant" button is enabled (there is a next page)
  const nextBtn = page.getByRole('button', { name: 'Suivant', exact: true });
  await expect(nextBtn).toBeEnabled({ timeout: 10_000 });

  // The "Précédent" button should be disabled on the first page (history is empty)
  const prevBtn = page.getByRole('button', { name: 'Précédent', exact: true });
  await expect(prevBtn).toBeDisabled();

  // Navigate to next page
  await nextBtn.click();

  // URL should now contain a cursor param
  await page.waitForURL((url) => url.searchParams.has('cursor'), { timeout: 5_000 });

  // Now "Précédent" should be enabled (we pushed to history)
  await expect(prevBtn).toBeEnabled({ timeout: 5_000 });

  // Navigate back
  await prevBtn.click();

  // Cursor should be gone from URL (back to first page)
  await page.waitForURL((url) => !url.searchParams.has('cursor'), { timeout: 5_000 });
  await expect(prevBtn).toBeDisabled({ timeout: 5_000 });
});
