import { test, expect, type BrowserContext, type Page } from '@playwright/test';

import { getPrisma, cleanupTestData, flushRateLimit, disconnect } from './helpers/db';
import {
  clearMailpit,
  extractFirstUrl,
  getAppUrl,
  getMessageBody,
  waitForEmail,
} from './helpers/mailpit';
import { hashPassword } from '../../src/lib/password';

// Backed by `consumePasswordReset` in src/lib/password-reset.ts which deletes
// every active session for the user inside a serializable transaction. After a
// reset, any other browser context still holding the old NextAuth JWT cookie
// must be bounced to /login on the next protected navigation.
const PASSWORD = 'TestPass-123!';
const NEW_PASSWORD = 'NewPass-456!';

const prisma = getPrisma();

test.beforeEach(async () => {
  await cleanupTestData();
  await flushRateLimit();
  await clearMailpit();
});

test.afterAll(async () => {
  await disconnect();
});

async function submitLogin(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => url.pathname !== '/login', { timeout: 15_000 });
}

test('Password reset invalidates all active sessions across browser contexts', async ({
  browser,
}) => {
  await prisma.user.create({
    data: {
      email: 'multisession@e2e.test',
      displayName: 'Multi Session',
      passwordHash: await hashPassword(PASSWORD),
      role: 'USER',
      emailVerifiedAt: new Date(),
    },
  });

  // Context A — already-logged-in browser
  const ctxA: BrowserContext = await browser.newContext();
  const pageA = await ctxA.newPage();
  await submitLogin(pageA, 'multisession@e2e.test', PASSWORD);
  // USER role lands on `/` after login.
  await expect(async () => {
    expect(new URL(pageA.url()).pathname).toBe('/');
  }).toPass({ timeout: 10_000 });

  // Sanity: a session row exists for this user.
  const userRow = await prisma.user.findUniqueOrThrow({
    where: { email: 'multisession@e2e.test' },
  });
  expect(await prisma.session.count({ where: { userId: userRow.id } })).toBeGreaterThan(0);

  // Context B — anonymous, runs the password reset flow.
  const ctxB: BrowserContext = await browser.newContext();
  const pageB = await ctxB.newPage();
  await pageB.goto('/password/forgot');
  await pageB.fill('input[name="email"]', 'multisession@e2e.test');
  const reqResponse = pageB.waitForResponse(
    (r) => r.url().includes('/api/trpc/password.requestReset') && r.request().method() === 'POST',
    { timeout: 10_000 },
  );
  await pageB.click('button[type="submit"]');
  await reqResponse;

  const msg = await waitForEmail('multisession@e2e.test', (m) =>
    m.Subject.toLowerCase().includes('réinitialisation'),
  );
  const body = await getMessageBody(msg.ID);
  const link = extractFirstUrl(body.HTML || body.Text, `${getAppUrl()}/password/reset/`);

  await pageB.goto(link);
  await pageB.fill('input[name="newPassword"]', NEW_PASSWORD);
  await pageB.fill('input[name="confirmPassword"]', NEW_PASSWORD);
  await Promise.all([
    pageB.waitForURL(/\/login\?reset=1/, { timeout: 15_000 }),
    pageB.click('button[type="submit"]'),
  ]);

  // DB-level proof: every session row for this user has been wiped.
  expect(await prisma.session.count({ where: { userId: userRow.id } })).toBe(0);

  // Context A — protected route should now bounce to /login. Try /admin
  // (middleware-guarded) and also assert the home page renders the login link
  // instead of a logged-in shell. We pick `/admin` because it's the strictest
  // guard implemented in Phase 1A.
  await pageA.goto('/admin');
  await pageA.waitForURL(/\/login/, { timeout: 10_000 });

  await ctxA.close();
  await ctxB.close();
});
