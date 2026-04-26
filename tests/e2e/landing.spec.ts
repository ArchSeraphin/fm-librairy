import { test, expect } from '@playwright/test';

test('landing page se charge avec le titre BiblioShare', async ({ page }) => {
  await page.goto('/');
  // Scope à <main> pour éviter le strict-mode violation contre <title>BiblioShare</title>
  // exposé par Next 15.5+ (cf. dette #20).
  const main = page.getByRole('main');
  await expect(main.getByText('BiblioShare')).toBeVisible();
  await expect(main.getByText('Phase 0 — Fondations')).toBeVisible();
});

test('headers de sécurité présents', async ({ request }) => {
  const response = await request.get('/');
  expect(response.headers()['x-frame-options']).toBe('DENY');
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  expect(response.headers()['strict-transport-security']).toContain('max-age=31536000');
});
