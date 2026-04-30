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
const LIBRARY_SLUG = 'e2e-1d-nav';
const LIBRARY_NAME = 'E2E 1D Nav';

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

test('mobile burger drawer lists nav items and navigates to Mes bibliothèques', async ({
  browser,
}) => {
  // Seed member + library
  const member = await prisma.user.create({
    data: {
      email: 'member-nav@e2e.test',
      displayName: 'Member Nav',
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

  // Use a mobile viewport
  const context = await browser.newContext({ viewport: { width: 375, height: 700 } });
  const page = await context.newPage();

  await submitLogin(page, 'member-nav@e2e.test', PASSWORD);
  await page.goto(`/library/${LIBRARY_SLUG}/books`);

  // The burger button is rendered by MemberHeader with aria-label t('openMenu') = "Ouvrir le menu"
  // It is only visible on small screens (lg:hidden)
  const burgerBtn = page.getByRole('button', { name: 'Ouvrir le menu', exact: true });
  await expect(burgerBtn).toBeVisible({ timeout: 10_000 });

  // Click to open the drawer
  await burgerBtn.click();

  // The Sheet (drawer) content includes MemberSidebar with nav items
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible({ timeout: 5_000 });

  // Check "Mes bibliothèques" link is in the drawer
  const myLibsLink = drawer.getByRole('link', { name: 'Mes bibliothèques', exact: true });
  await expect(myLibsLink).toBeVisible();

  // Check "Catalogue" link is in the drawer (only visible when currentSlug is set)
  const catalogLink = drawer.getByRole('link', { name: 'Catalogue', exact: true });
  await expect(catalogLink).toBeVisible();

  // Click "Mes bibliothèques" — should navigate to /libraries
  await myLibsLink.click();
  await expect(page).toHaveURL(/\/libraries$/, { timeout: 10_000 });

  await context.close();
});

test('a11y smoke: /libraries page has the burger button and a navigation landmark', async ({
  browser,
}) => {
  // Seed member + library
  const member = await prisma.user.create({
    data: {
      email: 'member-nav2@e2e.test',
      displayName: 'Member Nav 2',
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

  // Mobile viewport
  const context = await browser.newContext({ viewport: { width: 375, height: 700 } });
  const page = await context.newPage();

  await submitLogin(page, 'member-nav2@e2e.test', PASSWORD);
  await page.goto('/libraries');

  // The MemberHeader is present — it renders on /libraries (slug is undefined there, so no
  // "Catalogue" item in sidebar, but the burger should still be there)
  const burgerBtn = page.getByRole('button', { name: 'Ouvrir le menu', exact: true });
  await expect(burgerBtn).toBeVisible({ timeout: 10_000 });

  // Click the burger — sidebar "Mes bibliothèques" should be present
  await burgerBtn.click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible({ timeout: 5_000 });

  // A nav landmark with "Member navigation" label should exist inside the drawer
  const nav = drawer.getByRole('navigation', { name: 'Member navigation' });
  await expect(nav).toBeVisible();

  await context.close();
});
