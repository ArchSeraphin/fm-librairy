import { test, expect } from '@playwright/test';

test('landing page se charge avec le titre BiblioShare', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('BiblioShare')).toBeVisible();
  await expect(page.getByText('Phase 0 — Fondations')).toBeVisible();
});

test('headers de sécurité présents', async ({ request }) => {
  const response = await request.get('/');
  expect(response.headers()['x-frame-options']).toBe('DENY');
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  expect(response.headers()['strict-transport-security']).toContain('max-age=31536000');
});
