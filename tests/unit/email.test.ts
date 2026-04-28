import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';

vi.mock('@/lib/env', () => ({
  getEnv: () => ({
    EMAIL_TRANSPORT: 'smtp',
    EMAIL_FROM: 'Test <noreply@test.local>',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: 1025,
    EMAIL_LOG_SALT: 'a'.repeat(32),
  }),
}));

import { renderEmail, getTransport } from '@/lib/email';

const Hello: React.FC<{ name: string }> = ({ name }) =>
  React.createElement('div', null, `Hello ${name}`);

describe('renderEmail', () => {
  it('renders both html and text from a react component', async () => {
    const out = await renderEmail(Hello, { name: 'Alice' });
    expect(out.html).toContain('Hello Alice');
    expect(out.text).toContain('Hello Alice');
    expect(out.html.startsWith('<')).toBe(true);
  });
});

describe('getTransport', () => {
  beforeEach(() => vi.resetModules());

  it('returns an object with a send function', () => {
    const t = getTransport();
    expect(typeof t.send).toBe('function');
  });
});
