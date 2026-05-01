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

const PASSWORD = 'TestPass-123!';
const LIBRARY_SLUG = 'e2e-2b-metadata';
const LIBRARY_NAME = 'E2E 2B Metadata';
const ADMIN_EMAIL = 'admin-meta@e2e.test';
const MEMBER_EMAIL = 'member-meta@e2e.test';
const ISBN = '9782070612758';

const prisma = getPrisma();

async function seedAdminWithLibrary() {
  const admin = await prisma.user.create({
    data: {
      email: ADMIN_EMAIL,
      displayName: 'Admin Meta',
      passwordHash: await hashPassword(PASSWORD),
      role: 'GLOBAL_ADMIN',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });
  const library = await prisma.library.create({
    data: { name: LIBRARY_NAME, slug: LIBRARY_SLUG },
  });
  await prisma.libraryMember.create({
    data: { libraryId: library.id, userId: admin.id, role: 'LIBRARY_ADMIN', canUpload: true },
  });
  return { admin, library };
}

async function seedPlainMember(libraryId: string) {
  const user = await prisma.user.create({
    data: {
      email: MEMBER_EMAIL,
      displayName: 'Plain Member',
      passwordHash: await hashPassword(PASSWORD),
      role: 'USER',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });
  await prisma.libraryMember.create({
    data: { libraryId, userId: user.id, role: 'MEMBER', canUpload: false },
  });
  return user;
}

test.describe('@e2e.test book metadata', () => {
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

  test('admin creates book with ISBN → metadata badge shows PENDING immediately', async ({ page }) => {
    const { library } = await seedAdminWithLibrary();

    await page.goto('/login');
    await submitLogin(page, ADMIN_EMAIL, PASSWORD);

    await page.goto(`/library/${library.slug}/books/new`);
    await page.getByLabel(/titre/i).fill('Le Petit Prince');
    await page.getByLabel(/auteur/i).fill('Antoine de Saint-Exupéry');
    await page.getByLabel(/isbn-?13/i).fill(ISBN);
    await page.getByRole('button', { name: /créer/i }).click();

    await expect(page).toHaveURL(/\/books\/[a-z0-9]+$/);
    // The create mutation flips metadataFetchStatus to PENDING synchronously before
    // enqueueing the async fetch job, so the badge is observable immediately on the
    // detail page. Worker completion is NOT asserted here (separate Node process,
    // not interceptable from Playwright).
    await expect(page.getByText(/Métadonnées en cours/)).toBeVisible({ timeout: 5_000 });
  });

  test('admin clicks Rafraîchir on a FETCHED book → status flips to PENDING', async ({ page }) => {
    const { library } = await seedAdminWithLibrary();
    const book = await prisma.book.create({
      data: {
        libraryId: library.id,
        title: 'Le Petit Prince',
        authors: ['Antoine de Saint-Exupéry'],
        isbn13: ISBN,
        description: 'Old description.',
        metadataSource: 'GOOGLE_BOOKS',
        metadataFetchStatus: 'FETCHED',
        metadataFetchedAt: new Date(),
      },
    });

    await page.goto('/login');
    await submitLogin(page, ADMIN_EMAIL, PASSWORD);

    await page.goto(`/library/${library.slug}/books/${book.id}`);
    await expect(page.getByText(/Source\s*:\s*Google Books/)).toBeVisible();
    await page.getByRole('button', { name: /Rafraîchir/ }).click();
    // Either the toast appears or the status badge swaps to PENDING — both are valid
    // UI feedback for the queued refresh.
    await expect(
      page.getByText(/Rafraîchissement demandé|Métadonnées en cours/),
    ).toBeVisible({ timeout: 5_000 });
  });

  test('non-admin member does not see Rafraîchir button', async ({ page }) => {
    const { library } = await seedAdminWithLibrary();
    await seedPlainMember(library.id);
    const book = await prisma.book.create({
      data: {
        libraryId: library.id,
        title: 'Le Petit Prince',
        authors: ['Antoine de Saint-Exupéry'],
        isbn13: ISBN,
        metadataSource: 'GOOGLE_BOOKS',
        metadataFetchStatus: 'FETCHED',
        metadataFetchedAt: new Date(),
      },
    });

    await page.goto('/login');
    await submitLogin(page, MEMBER_EMAIL, PASSWORD);
    await page.goto(`/library/${library.slug}/books/${book.id}`);
    await expect(page.getByText(/Source\s*:\s*Google Books/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Rafraîchir/ })).toHaveCount(0);
  });
});
