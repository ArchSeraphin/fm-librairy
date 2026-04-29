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
// Unique-enough name so the slug doesn't collide with prior runs that may have
// crashed before cleanup. The slug is derived from this name by slugifyUnique.
const LIBRARY_NAME = 'E2E Library Phase1C';
const LIBRARY_SLUG = 'e2e-library-phase1c';

const prisma = getPrisma();

test.beforeEach(async () => {
  await cleanupE2ELibrary(LIBRARY_SLUG);
  await cleanupTestData();
  await flushRateLimit();
});

test.afterEach(async () => {
  // Library is not cleaned by cleanupTestData (no email FK) — wipe it explicitly.
  await cleanupE2ELibrary(LIBRARY_SLUG);
});

test.afterAll(async () => {
  await disconnect();
});

test('admin creates a library, adds a member by cuid, then archives it', async ({ page }) => {
  await prisma.user.create({
    data: {
      email: 'admin-lib@e2e.test',
      displayName: 'Admin Lib',
      passwordHash: await hashPassword(PASSWORD),
      role: 'GLOBAL_ADMIN',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });

  const memberUser = await prisma.user.create({
    data: {
      email: 'member-lib@e2e.test',
      displayName: 'Member Lib',
      passwordHash: await hashPassword(PASSWORD),
      role: 'USER',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });

  await submitLogin(page, 'admin-lib@e2e.test', PASSWORD);
  await expect(page).toHaveURL(/\/admin/);

  // -------------------------------------------------------------------------
  // Step 1: create library via /admin/libraries
  // -------------------------------------------------------------------------
  await page.goto('/admin/libraries');
  await page.getByRole('button', { name: 'Nouvelle bibliothèque', exact: true }).click();
  await page.fill('#lib-name', LIBRARY_NAME);
  await page.fill('#lib-desc', 'Created by E2E spec');

  const createResponse = page.waitForResponse(
    (r) => r.url().includes('/api/trpc/admin.libraries.create') && r.request().method() === 'POST',
    { timeout: 10_000 },
  );
  await page.getByRole('button', { name: 'Créer', exact: true }).click();
  const created = await createResponse;
  expect(created.status()).toBe(200);

  // Server-side proof: library exists with an auto-generated slug.
  const lib = await prisma.library.findFirstOrThrow({
    where: { name: LIBRARY_NAME },
    select: { id: true, slug: true },
  });
  expect(lib.slug).toBe(LIBRARY_SLUG);

  // The dialog redirects to /admin/libraries/<slug>.
  await expect(page).toHaveURL(new RegExp(`/admin/libraries/${LIBRARY_SLUG}$`), {
    timeout: 10_000,
  });

  // -------------------------------------------------------------------------
  // Step 2: add the member by cuid via the Members tab
  // -------------------------------------------------------------------------
  // MembersPanel exposes a trigger button "Ajouter un membre" that opens a
  // dialog whose submit button reuses the same i18n key. Disambiguate by
  // scoping the submit click to the [role=dialog] container.
  await page.getByRole('button', { name: 'Ajouter un membre', exact: true }).first().click();
  const addDialog = page.getByRole('dialog');
  await addDialog.locator('#member-user').fill(memberUser.id);

  const addResponse = page.waitForResponse(
    (r) =>
      r.url().includes('/api/trpc/admin.libraries.members.add') && r.request().method() === 'POST',
    { timeout: 10_000 },
  );
  await addDialog.getByRole('button', { name: 'Ajouter un membre', exact: true }).click();
  const added = await addResponse;
  expect(added.status()).toBe(200);

  // DB: LibraryMember row exists.
  const member = await prisma.libraryMember.findUniqueOrThrow({
    where: { userId_libraryId: { libraryId: lib.id, userId: memberUser.id } },
  });
  expect(member.role).toBe('MEMBER');

  // -------------------------------------------------------------------------
  // Step 3: archive the library
  // -------------------------------------------------------------------------
  // LibrarySettings exposes a trigger "Archiver"; the confirm button inside the
  // dialog reuses the same i18n key — scope the submit to [role=dialog].
  await page.getByRole('button', { name: 'Archiver', exact: true }).first().click();
  const archiveDialog = page.getByRole('dialog');
  await archiveDialog.locator('#archive-reason').fill('E2E test cleanup');

  const archiveResponse = page.waitForResponse(
    (r) => r.url().includes('/api/trpc/admin.libraries.archive') && r.request().method() === 'POST',
    { timeout: 10_000 },
  );
  await archiveDialog.getByRole('button', { name: 'Archiver', exact: true }).click();
  const archived = await archiveResponse;
  expect(archived.status()).toBe(200);

  // DB: archivedAt is set.
  const archivedLib = await prisma.library.findUniqueOrThrow({ where: { id: lib.id } });
  expect(archivedLib.archivedAt).not.toBeNull();
});
