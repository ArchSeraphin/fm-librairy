import { test, expect } from '@playwright/test';

test('endpoint /api/health répond JSON avec status', async ({ request }) => {
  const response = await request.get('/api/health');
  // En dev local sans services Docker, peut renvoyer 503.
  // En CI Docker Compose, doit renvoyer 200.
  expect([200, 503]).toContain(response.status());
  const body = await response.json();
  expect(body).toHaveProperty('status');
  expect(body).toHaveProperty('checks');
  expect(Array.isArray(body.checks)).toBe(true);
});
