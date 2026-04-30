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
const LIBRARY_SLUG = 'e2e-1d-create';
const LIBRARY_NAME = 'E2E 1D Create';

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

test('admin creates a book; member can see it in the catalog', async ({ browser }) => {
  // -------------------------------------------------------------------------
  // Seed: 1 GLOBAL_ADMIN, 1 USER, 1 Library, 1 LibraryMember
  // -------------------------------------------------------------------------
  const adminUser = await prisma.user.create({
    data: {
      email: 'admin-create@e2e.test',
      displayName: 'Admin Create',
      passwordHash: await hashPassword(PASSWORD),
      role: 'GLOBAL_ADMIN',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });

  const memberUser = await prisma.user.create({
    data: {
      email: 'member-create@e2e.test',
      displayName: 'Member Create',
      passwordHash: await hashPassword(PASSWORD),
      role: 'USER',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });

  const library = await prisma.library.create({
    data: {
      name: LIBRARY_NAME,
      slug: LIBRARY_SLUG,
    },
  });

  await prisma.libraryMember.create({
    data: {
      userId: memberUser.id,
      libraryId: library.id,
      role: 'MEMBER',
    },
  });

  // -------------------------------------------------------------------------
  // Admin context: login → create book
  // -------------------------------------------------------------------------
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();

  await submitLogin(adminPage, 'admin-create@e2e.test', PASSWORD);

  await adminPage.goto(`/library/${LIBRARY_SLUG}/books`);

  // Click "Ajouter un livre" link/button to navigate to /new
  await adminPage.getByRole('link', { name: 'Ajouter un livre', exact: true }).click();
  await expect(adminPage).toHaveURL(new RegExp(`/library/${LIBRARY_SLUG}/books/new$`), {
    timeout: 10_000,
  });

  // Fill in the create book form
  await adminPage.getByLabel('Titre').fill('Le Petit Prince');
  await adminPage.getByLabel('Auteurs').fill('Saint-Exupéry');
  await adminPage.getByLabel('Langue').fill('fr');
  await adminPage.getByLabel('URL de la couverture').fill('https://example.com/c.jpg');

  // Submit
  await adminPage.getByRole('button', { name: 'Créer le livre', exact: true }).click();

  // Expect redirect to book detail page
  await expect(adminPage).toHaveURL(new RegExp(`/library/${LIBRARY_SLUG}/books/[a-z0-9]+$`), {
    timeout: 15_000,
  });

  // Expect the book title on the detail page
  await expect(adminPage.getByRole('heading', { name: 'Le Petit Prince' })).toBeVisible({
    timeout: 10_000,
  });

  await adminContext.close();

  // -------------------------------------------------------------------------
  // Member context: login → see the book in catalog
  // -------------------------------------------------------------------------
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();

  await submitLogin(memberPage, 'member-create@e2e.test', PASSWORD);

  await memberPage.goto(`/library/${LIBRARY_SLUG}/books`);

  // Book should be visible in the catalog
  await expect(memberPage.getByText('Le Petit Prince')).toBeVisible({ timeout: 10_000 });

  await memberContext.close();
});
