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
const SLUG_A = 'e2e-1d-isol-a';
const SLUG_B = 'e2e-1d-isol-b';
const NAME_A = 'E2E Isolation A';
const NAME_B = 'E2E Isolation B';

const prisma = getPrisma();

test.beforeEach(async () => {
  await cleanupE2ELibrary(SLUG_A);
  await cleanupE2ELibrary(SLUG_B);
  await cleanupTestData();
  await flushRateLimit();
});

test.afterEach(async () => {
  await cleanupE2ELibrary(SLUG_A);
  await cleanupE2ELibrary(SLUG_B);
});

test.afterAll(async () => {
  await disconnect();
});

test('member of A is redirected away from library B and gets 404 for B book via A slug', async ({ page }) => {
  // Seed
  const admin = await prisma.user.create({
    data: {
      email: 'admin-isol@e2e.test',
      displayName: 'Admin Isol',
      passwordHash: await hashPassword(PASSWORD),
      role: 'GLOBAL_ADMIN',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });

  const member = await prisma.user.create({
    data: {
      email: 'member-isol@e2e.test',
      displayName: 'Member Isol A',
      passwordHash: await hashPassword(PASSWORD),
      role: 'USER',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });

  const libraryA = await prisma.library.create({
    data: { name: NAME_A, slug: SLUG_A },
  });

  const libraryB = await prisma.library.create({
    data: { name: NAME_B, slug: SLUG_B },
  });

  // Member is only in library A
  await prisma.libraryMember.create({
    data: { userId: member.id, libraryId: libraryA.id, role: 'MEMBER' },
  });

  // 2 books in A
  for (let i = 1; i <= 2; i++) {
    await prisma.book.create({
      data: {
        title: `Livre A ${i}`,
        authors: ['Auteur A'],
        libraryId: libraryA.id,
        uploadedById: admin.id,
      },
    });
  }

  // 2 books in B
  const [bookB1] = await Promise.all([
    prisma.book.create({
      data: {
        title: 'Livre B 1',
        authors: ['Auteur B'],
        libraryId: libraryB.id,
        uploadedById: admin.id,
      },
    }),
    prisma.book.create({
      data: {
        title: 'Livre B 2',
        authors: ['Auteur B'],
        libraryId: libraryB.id,
        uploadedById: admin.id,
      },
    }),
  ]);

  await submitLogin(page, 'member-isol@e2e.test', PASSWORD);

  // Member can see 2 books in library A
  await page.goto(`/library/${SLUG_A}/books`);
  await expect(page.getByText('Livre A 1')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Livre A 2')).toBeVisible({ timeout: 10_000 });

  // Member tries to access library B → should be redirected to /libraries
  await page.goto(`/library/${SLUG_B}/books`);
  await expect(page).toHaveURL(/\/libraries/, { timeout: 10_000 });

  // Member tries to access book from B using slug A → should get 404
  // The page.tsx server component calls notFound() if book.libraryId !== library.id.
  // Next.js renders its default 404 without changing the URL.
  await page.goto(`/library/${SLUG_A}/books/${bookB1.id}`, { waitUntil: 'domcontentloaded' });

  // Wait for the page to settle (Next.js server component may need a moment)
  await page.waitForLoadState('networkidle');

  // Accept: any redirect away from the book URL, OR a 404-style page.
  // Next.js default 404 shows "404\nThis page could not be found."
  const currentUrl = page.url();
  const redirectedAway = !currentUrl.includes(`/library/${SLUG_A}/books/${bookB1.id}`);
  if (!redirectedAway) {
    // Still on the book URL — must be a 404 render
    const bodyText = await page.locator('body').innerText();
    const is404 =
      bodyText.includes('404') ||
      bodyText.toLowerCase().includes('not found') ||
      bodyText.toLowerCase().includes('introuvable') ||
      bodyText.toLowerCase().includes('could not be found');
    expect(is404).toBe(true);
  }
});

test('library switcher only shows libraries where the member has access', async ({ page }) => {
  // Seed
  await prisma.user.create({
    data: {
      email: 'admin-isol2@e2e.test',
      displayName: 'Admin Isol2',
      passwordHash: await hashPassword(PASSWORD),
      role: 'GLOBAL_ADMIN',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });

  const member = await prisma.user.create({
    data: {
      email: 'member-isol2@e2e.test',
      displayName: 'Member Isol B',
      passwordHash: await hashPassword(PASSWORD),
      role: 'USER',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });

  const libraryA = await prisma.library.create({
    data: { name: NAME_A, slug: SLUG_A },
  });

  await prisma.library.create({
    data: { name: NAME_B, slug: SLUG_B },
  });

  // Member is only in library A
  await prisma.libraryMember.create({
    data: { userId: member.id, libraryId: libraryA.id, role: 'MEMBER' },
  });

  await submitLogin(page, 'member-isol2@e2e.test', PASSWORD);

  await page.goto(`/library/${SLUG_A}/books`);

  // Open the LibrarySwitcher (combobox in the header)
  const switcherTrigger = page.getByRole('combobox', { name: /biblioth/i });
  await switcherTrigger.click();

  // Library A should be listed
  await expect(page.getByRole('option', { name: NAME_A })).toBeVisible({ timeout: 5_000 });

  // Library B should NOT be listed
  await expect(page.getByRole('option', { name: NAME_B })).not.toBeVisible({ timeout: 3_000 });
});
